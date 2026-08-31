import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { newId, type PullResponse, type PushResponse, type SyncEnvelope } from '@pos/shared'

/**
 * End-to-end proof of the offline scenarios the system exists to survive.
 *
 * These run against a real server process with a real SQLite file, over real
 * HTTP and a real WebSocket. Nothing here is stubbed, because the point is to
 * demonstrate that synchronisation genuinely happens rather than that a
 * status label says it did.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = 4187
const BASE = `http://127.0.0.1:${PORT}`

let child: ChildProcess
let dataDir: string

async function waitForServer(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('The test server never came up.')
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-e2e-'))
  child = spawn(
    process.execPath,
    ['--no-warnings=ExperimentalWarning', path.join(HERE, 'index.ts')],
    {
      env: {
        ...process.env,
        POS_SERVER_PORT: String(PORT),
        POS_SERVER_HOST: '127.0.0.1',
        POS_DATA_DIR: dataDir,
        POS_ENROLMENT_CODE: 'test-code',
        NODE_ENV: 'test',
      },
      stdio: 'ignore',
    },
  )
  await waitForServer()
})

after(() => {
  child?.kill()
  try {
    fs.rmSync(dataDir, { recursive: true, force: true })
  } catch {
    // Windows sometimes holds the WAL file briefly; the temp dir is disposable.
  }
})

// ------------------------------------------------------------------ helpers --

async function enrol(deviceId: string, label: string): Promise<string> {
  const response = await fetch(`${BASE}/api/devices/enrol`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, label, type: 'TABLET', code: 'test-code' }),
  })
  assert.equal(response.status, 200, `enrolment failed for ${deviceId}`)
  const body = (await response.json()) as { token: string }
  return body.token
}

async function push(token: string, deviceId: string, entries: SyncEnvelope[]): Promise<PushResponse> {
  const response = await fetch(`${BASE}/api/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, entries }),
  })
  assert.equal(response.status, 200, `push failed: ${await response.clone().text()}`)
  return (await response.json()) as PushResponse
}

async function pull(token: string, since: number): Promise<PullResponse> {
  const response = await fetch(`${BASE}/api/sync/pull?since=${since}&limit=500`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  assert.equal(response.status, 200)
  return (await response.json()) as PullResponse
}

function saleEnvelope(deviceId: string, total: number, receiptNo: string): SyncEnvelope {
  const id = newId()
  const now = Date.now()
  return {
    entity: 'sales',
    entityId: id,
    op: 'CREATE',
    version: 1,
    deviceId,
    updatedAt: now,
    payload: {
      id,
      deviceId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
      receiptNo,
      queueNo: receiptNo.slice(-3),
      shiftId: 'SHIFT-1',
      userId: 'USER-1',
      status: 'COMPLETED',
      orderType: 'TAKE_OUT',
      subtotal: total,
      discountTotal: 0,
      taxTotal: 0,
      taxExemptTotal: 0,
      total,
      cogsTotal: Math.round(total * 0.3),
      itemCount: 1,
      customerName: '',
      note: '',
      occurredAt: now,
      voidedAt: null,
      voidedBy: null,
      voidReason: '',
    },
  }
}

function movementEnvelope(deviceId: string, ingredientId: string, quantity: number): SyncEnvelope {
  const id = newId()
  const now = Date.now()
  return {
    entity: 'inventoryMovements',
    entityId: id,
    op: 'CREATE',
    version: 1,
    deviceId,
    updatedAt: now,
    payload: {
      id,
      deviceId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      deletedAt: null,
      ingredientId,
      type: 'SALE',
      baseQuantity: quantity,
      costRate: 85_000_000,
      reason: '',
      referenceType: 'SALE',
      referenceId: newId(),
      shiftId: 'SHIFT-1',
      userId: 'USER-1',
      occurredAt: now,
    },
  }
}

function productEnvelope(deviceId: string, id: string, version: number, price: number): SyncEnvelope {
  const now = Date.now()
  return {
    entity: 'productVariants',
    entityId: id,
    op: version === 1 ? 'CREATE' : 'UPDATE',
    version,
    deviceId,
    updatedAt: now,
    payload: {
      id,
      deviceId,
      createdAt: now,
      updatedAt: now,
      version,
      deletedAt: null,
      productId: 'PROD-1',
      name: '16oz',
      price,
      sortOrder: 1,
      active: true,
      isDefault: true,
    },
  }
}

// -------------------------------------------------------------------- tests --

describe('device enrolment', () => {
  test('a device without the enrolment code is refused', async () => {
    const response = await fetch(`${BASE}/api/devices/enrol`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'ROGUE', label: 'Rogue', type: 'WEB', code: 'wrong' }),
    })
    assert.equal(response.status, 403)
  })

  test('sync endpoints reject an unauthenticated device', async () => {
    const response = await fetch(`${BASE}/api/sync/pull?since=0`)
    assert.equal(response.status, 401)
  })
})

describe('scenario 51: twenty sales made offline, then reconnection', () => {
  test('every offline sale survives the reconnect and reaches the server', async () => {
    const deviceId = 'POS-TABLET-01'
    const token = await enrol(deviceId, 'POS Tablet 01')

    // The cashier completed twenty sales with no internet. They queued locally.
    const queued = Array.from({ length: 20 }, (_, index) =>
      saleEnvelope(deviceId, 15000 + index * 100, `OR-${String(index + 1).padStart(5, '0')}`),
    )

    // Internet returns; the outbox drains in one batch.
    const result = await push(token, deviceId, queued)

    assert.equal(result.accepted.length, 20, 'all twenty sales should be accepted')
    assert.equal(result.rejected.length, 0, 'none should be rejected')

    // And the server can hand all twenty back.
    const pulled = await pull(token, 0)
    const sales = pulled.changes.filter((change) => change.entity === 'sales')
    assert.equal(sales.length, 20)

    // Not one receipt number went missing.
    const receipts = new Set(sales.map((change) => (change.payload as { receiptNo: string }).receiptNo))
    assert.equal(receipts.size, 20)
  })

  test('re-sending the same batch does not duplicate anything', async () => {
    const deviceId = 'POS-TABLET-RETRY'
    const token = await enrol(deviceId, 'Retry Tablet')
    const batch = [saleEnvelope(deviceId, 25000, 'OR-RETRY-1')]

    const first = await push(token, deviceId, batch)
    const second = await push(token, deviceId, batch)

    assert.equal(first.accepted.length, 1)
    assert.equal(second.accepted.length, 1)
    assert.equal(second.rejected.length, 0)

    // A retry after a flaky connection must not create a second sale.
    const pulled = await pull(token, 0)
    const matching = pulled.changes.filter(
      (change) => change.entity === 'sales' && (change.payload as { receiptNo: string }).receiptNo === 'OR-RETRY-1',
    )
    assert.equal(matching.length, 1, 'the retried sale must appear exactly once')
  })
})

describe('scenario 52: one device offline while another stays online', () => {
  test('both devices’ sales survive - neither overwrites the other', async () => {
    const deviceA = 'POS-A'
    const deviceB = 'POS-B'
    const tokenA = await enrol(deviceA, 'Counter A')
    const tokenB = await enrol(deviceB, 'Counter B')

    const startCursor = (await pull(tokenB, 0)).cursor

    // Device B is online and sells five drinks.
    await push(
      tokenB,
      deviceB,
      Array.from({ length: 5 }, (_, index) => saleEnvelope(deviceB, 10000, `B-${index}`)),
    )

    // Device A was offline the whole time and sells three.
    await push(
      tokenA,
      deviceA,
      Array.from({ length: 3 }, (_, index) => saleEnvelope(deviceA, 12000, `A-${index}`)),
    )

    // After both have synced, all eight exist. This is the failure mode the
    // architecture is built to prevent: a last-writer wiping the other's day.
    const pulled = await pull(tokenA, startCursor)
    const receipts = pulled.changes
      .filter((change) => change.entity === 'sales')
      .map((change) => (change.payload as { receiptNo: string }).receiptNo)

    for (let index = 0; index < 5; index++) assert.ok(receipts.includes(`B-${index}`), `missing B-${index}`)
    for (let index = 0; index < 3; index++) assert.ok(receipts.includes(`A-${index}`), `missing A-${index}`)
    assert.equal(receipts.filter((receipt) => receipt.startsWith('A-') || receipt.startsWith('B-')).length, 8)
  })

  test('inventory consumed on two offline devices sums instead of overwriting', async () => {
    const deviceA = 'POS-INV-A'
    const deviceB = 'POS-INV-B'
    const tokenA = await enrol(deviceA, 'Inventory A')
    const tokenB = await enrol(deviceB, 'Inventory B')
    const ingredientId = newId()

    const startCursor = (await pull(tokenA, 0)).cursor

    // Both devices believed they had 500ml of milk and both sold from it.
    await push(tokenA, deviceA, [movementEnvelope(deviceA, ingredientId, -180)])
    await push(tokenB, deviceB, [movementEnvelope(deviceB, ingredientId, -200)])

    const pulled = await pull(tokenA, startCursor)
    const consumed = pulled.changes
      .filter((change) => change.entity === 'inventoryMovements')
      .map((change) => (change.payload as { ingredientId: string; baseQuantity: number }))
      .filter((movement) => movement.ingredientId === ingredientId)
      .reduce((sum, movement) => sum + movement.baseQuantity, 0)

    // 380ml gone, not 180 and not 200. The ledger adds up because stock is
    // derived from movements rather than stored as one mutable number.
    assert.equal(consumed, -380)
  })
})

describe('conflict handling on genuinely mutable records', () => {
  test('a concurrent price edit is reported rather than silently overwritten', async () => {
    const deviceA = 'POS-PRICE-A'
    const deviceB = 'POS-PRICE-B'
    const tokenA = await enrol(deviceA, 'Price A')
    const tokenB = await enrol(deviceB, 'Price B')
    const variantId = newId()

    // Both devices start from version 1 of the same price.
    await push(tokenA, deviceA, [productEnvelope(deviceA, variantId, 1, 15000)])

    // Each edits it independently while apart, so both submit version 2.
    const fromA = await push(tokenA, deviceA, [productEnvelope(deviceA, variantId, 2, 16000)])
    const fromB = await push(tokenB, deviceB, [productEnvelope(deviceB, variantId, 2, 17000)])

    assert.equal(fromA.accepted.length, 1, 'the first edit in wins')
    assert.equal(fromB.rejected.length, 1, 'the second must not be applied blindly')
    assert.equal(fromB.rejected[0]?.reason, 'CONFLICT')

    // The loser is handed the server's version so it can be reviewed, and its
    // own record is never thrown away by the server.
    assert.ok(fromB.rejected[0]?.serverRecord, 'the conflicting record must come back for review')
    assert.equal((fromB.rejected[0]?.serverRecord as { price: number }).price, 16000)
  })

  test('immutable records never raise a conflict', async () => {
    const deviceId = 'POS-APPEND'
    const token = await enrol(deviceId, 'Append Only')
    const sale = saleEnvelope(deviceId, 9900, 'OR-APPEND')

    await push(token, deviceId, [sale])
    // A completed sale is a fact. Re-stating it is never a disagreement.
    const again = await push(token, deviceId, [sale])
    assert.equal(again.rejected.length, 0)
  })
})

describe('realtime notification', () => {
  test('a connected device is told to catch up when another device sells', async () => {
    const watcher = 'POS-WATCH'
    const seller = 'POS-SELL'
    const watcherToken = await enrol(watcher, 'Watcher')
    const sellerToken = await enrol(seller, 'Seller')

    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/realtime?token=${watcherToken}`)

    const notified = new Promise<{ type: string; seq: number; originDeviceId: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no realtime message arrived')), 8000)
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string; seq: number; originDeviceId: string }
        if (message.type === 'SALE_CREATED') {
          clearTimeout(timer)
          resolve(message)
        }
      })
      socket.on('error', reject)
    })

    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve())
      socket.on('error', reject)
    })

    await push(sellerToken, seller, [saleEnvelope(seller, 13500, 'OR-REALTIME')])

    const message = await notified
    assert.equal(message.type, 'SALE_CREATED')
    assert.equal(message.originDeviceId, seller)
    assert.ok(message.seq > 0, 'the notice carries the sequence to catch up to')

    socket.close()
  })

  test('an unauthenticated socket is refused', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/realtime?token=not-a-real-token`)
    const refused = await new Promise<boolean>((resolve) => {
      socket.on('error', () => resolve(true))
      socket.on('open', () => resolve(false))
    })
    assert.equal(refused, true)
    socket.close()
  })
})

describe('a device catching up from its own cursor', () => {
  test('pulling from a cursor returns only what came after it', async () => {
    const deviceId = 'POS-CURSOR'
    const token = await enrol(deviceId, 'Cursor')

    const before = await pull(token, 0)
    const cursor = before.cursor

    await push(token, deviceId, [saleEnvelope(deviceId, 5000, 'OR-CURSOR-1')])
    const after = await pull(token, cursor)

    assert.ok(after.changes.length >= 1)
    assert.ok(
      after.changes.every((change) => change.seq > cursor),
      'a pull must never re-deliver what the device already has',
    )
  })
})
