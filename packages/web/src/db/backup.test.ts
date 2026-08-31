import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_LOW_STOCK, DEFAULT_LOYALTY, DEFAULT_STATUTORY_RULES, RECEIPT_SECTIONS, SYNC_ENTITIES, fromDecimal, type BusinessSettings, type SyncMeta, type Sale, type User } from '@pos/shared'
import { clearBusinessData, db, META_KEYS, readMeta, writeMeta } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import {
  BACKUP_FORMAT,
  buildBackup,
  canRestore,
  inspectBackup,
  restoreBackup,
  type BackupFile,
  reconcile,
} from './backup.ts'

/**
 * Backup and restore.
 *
 * Restore is the only thing in this app that destroys data on purpose, so
 * these tests are less about the happy path than about the promises around it:
 * a device never inherits another device's identity, an altered file is
 * refused, a merge cannot overwrite, tombstones survive, and receipt numbering
 * does not silently start re-issuing numbers that are already in the books.
 */

const DEVICE = { deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' as const }

const USER: User = {
  id: 'U-OWNER',
  name: 'Ana',
  role: 'OWNER',
  pinHash: 'pbkdf2$sha256$210000$abc$def',
  active: true,
  employeeCode: '001',
  failedAttempts: 0,
  lockedUntil: null,
  permissionOverrides: {},
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  version: 1,
  deviceId: DEVICE.deviceId,
}

async function reset(): Promise<void> {
  __setIdentityForTests(DEVICE)
  await db.delete()
  await db.open()
}

beforeEach(reset)

function settingsRow(): BusinessSettings {
  return stamp<BusinessSettings>({
    branding: { businessName: 'Corner Roasters', logoDataUrl: '', addressLine: '', contactLine: '' } as never,
    tax: { enabled: true, rate: 12, label: 'VAT', inclusive: true } as never,
    receipt: { prefix: 'OR', padding: 6, nextNumber: 1 } as never,
    queue: { prefix: 'Q', padding: 3, start: 1, resetDaily: true } as never,
    currencyCode: 'PHP',
    currencySymbol: '₱',
    locale: 'en-PH',
    statutoryDiscountRate: 20,
    lowStockWarningEnabled: true,
    blockSaleWhenOutOfStock: true,
    includeLabourInCost: false,
    backdatingEnabled: false,
    requireReferenceFor: [],
    plannerPasscodeHash: null,
    dashboardTiles: {},
    statutoryRules: DEFAULT_STATUTORY_RULES,
    receiptSections: RECEIPT_SECTIONS,
    lowStock: DEFAULT_LOW_STOCK,
    loyalty: DEFAULT_LOYALTY,
  })
}

function saleRow(receiptNo: string, total = fromDecimal(100)): Sale {
  return stamp<Sale>({
    receiptNo,
    queueNo: '',
    shiftId: 'S-1',
    userId: USER.id,
    status: 'COMPLETED',
    entryMode: 'ITEMISED',
    orderType: 'DINE_IN',
    subtotal: total,
    discountTotal: 0,
    taxTotal: 0,
    taxExemptTotal: 0,
    total,
    cogsTotal: 0,
    itemCount: 1,
    customerName: '',
    note: '',
    occurredAt: Date.now(),
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
    refundOfSaleId: null,
    refundedTotal: 0,
  })
}

/** A shop with something in every table that matters to these tests. */
async function seedShop(): Promise<void> {
  await commit([
    created('settings', settingsRow()),
    created('users', USER),
    created('sales', saleRow('OR-01-000001')),
    created('sales', saleRow('OR-01-000002')),
  ])
  await db.outbox.clear()
}

/** The sales in a backup, typed - the file itself is deliberately loose. */
function salesIn(file: BackupFile): Sale[] {
  return (file.tables.sales ?? []) as unknown as Sale[]
}

async function inspect(file: BackupFile) {
  return inspectBackup(JSON.stringify(file))
}

describe('what a backup contains', () => {
  test('carries every synchronised table', async () => {
    await seedShop()
    const file = await buildBackup('Ana')
    for (const entity of SYNC_ENTITIES) {
      expect(Array.isArray(file.tables[entity])).toBe(true)
    }
    expect(file.manifest.format).toBe(BACKUP_FORMAT)
    expect(file.manifest.totalRows).toBe(4)
  })

  test('never carries the device identity or the server token', async () => {
    await seedShop()
    await writeMeta(META_KEYS.serverToken, 'super-secret-token')
    await writeMeta(META_KEYS.serverUrl, 'https://shop.example')

    const text = JSON.stringify(await buildBackup('Ana'))

    // The whole file, not just the manifest: the token must not be anywhere.
    expect(text).not.toContain('super-secret-token')
    expect(text).not.toContain('sync.token')
    expect(JSON.parse(text).tables.meta).toBeUndefined()
  })

  test('keeps tombstones, so a restore does not resurrect deleted records', async () => {
    await seedShop()
    // stamp() always writes deletedAt: null, so the tombstone is set afterwards
    // exactly as remove() would leave it.
    const gone: Sale = { ...saleRow('OR-01-000003'), deletedAt: Date.now() }
    await db.sales.put(gone)

    const file = await buildBackup('Ana')
    const restored = salesIn(file).find((row) => row.id === gone.id)
    expect(restored?.deletedAt).not.toBeNull()
  })

  test('records which migrations the data in it has already had', async () => {
    await seedShop()
    await writeMeta(META_KEYS.migrationsApplied, ['2026-08-30-remove-sweetness'])
    const file = await buildBackup('Ana')
    expect(file.manifest.migrationsApplied).toEqual(['2026-08-30-remove-sweetness'])
  })
})

describe('checking a file before trusting it', () => {
  test('refuses something that is not a backup', async () => {
    await expect(inspectBackup('not json at all')).rejects.toThrow(/not readable as JSON/i)
    await expect(inspectBackup('{"hello":"world"}')).rejects.toThrow(/not a backup/i)
  })

  test('catches a file that has been edited since it was made', async () => {
    await seedShop()
    const file = await buildBackup('Ana')
    salesIn(file)[0]!.total = fromDecimal(999_999)

    const inspection = await inspect(file)
    expect(inspection.checksumOk).toBe(false)
    expect(canRestore(inspection, 'MERGE')).toBe(false)
  })

  test('accepts an untouched file', async () => {
    await seedShop()
    const inspection = await inspect(await buildBackup('Ana'))
    expect(inspection.checksumOk).toBe(true)
    expect(canRestore(inspection, 'REPLACE')).toBe(true)
  })

  test('refuses a file written by a newer version of the app', async () => {
    await seedShop()
    const file = await buildBackup('Ana')
    file.manifest.version = 99
    const inspection = await inspect(file)
    expect(canRestore(inspection, 'MERGE')).toBe(false)
  })

  test('counts what is genuinely new against what is already here', async () => {
    await seedShop()
    const file = await buildBackup('Ana')
    // Everything in the file is already on the device.
    expect((await inspect(file)).totalNewHere).toBe(0)

    await db.sales.clear()
    expect((await inspect(file)).totalNewHere).toBe(2)
  })

  test('will not let a replace lock everybody out', async () => {
    await seedShop()
    const file = await buildBackup('Ana')
    file.tables.users = []
    file.manifest.checksum = (await inspect(await buildBackup('Ana'))).manifest.checksum

    const inspection = await inspectBackup(JSON.stringify(file))
    // The checksum no longer matches either, but the point is the mode split:
    // a lockout is fatal for REPLACE and irrelevant to MERGE.
    const lockout = inspection.problems.find((problem) => /lock everybody out/i.test(problem.message))
    expect(lockout?.severity).toBe('FATAL')
    expect(lockout?.replaceOnly).toBe(true)
  })

  test('warns when there is unsynced work that a replace would discard', async () => {
    await seedShop()
    await commit([created('sales', saleRow('OR-01-000009'))])

    const inspection = await inspect(await buildBackup('Ana'))
    expect(inspection.unsyncedCount).toBeGreaterThan(0)
    const warning = inspection.problems.find((problem) => /have not reached the server/i.test(problem.message))
    expect(warning?.severity).toBe('WARNING')
  })
})

describe('restoring', () => {
  test('replace leaves exactly what was in the file', async () => {
    await seedShop()
    const file = await buildBackup('Ana')
    const inspection = await inspect(file)

    // Something recorded after the backup was taken.
    await commit([created('sales', saleRow('OR-01-000050'))])
    expect(await db.sales.count()).toBe(3)

    await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    expect(await db.sales.count()).toBe(2)
    expect((await db.sales.toArray()).map((row) => row.receiptNo).sort()).toEqual([
      'OR-01-000001',
      'OR-01-000002',
    ])
  })

  test('merge adds what is missing and overwrites nothing', async () => {
    await seedShop()
    const file = await buildBackup('Ana')
    const inspection = await inspect(file)

    // The device's copy has moved on since the backup.
    await db.sales.clear()
    const edited = { ...saleRow('OR-01-000001'), id: salesIn(file)[0]!.id, total: fromDecimal(777) }
    await db.sales.put(edited as Sale)

    const outcome = await restoreBackup({ inspection, mode: 'MERGE', sync: 'RESYNC', user: USER })

    // Settings and the user were never cleared, so only the missing sale is new.
    expect(outcome.written).toBe(1)
    expect(outcome.skipped).toBeGreaterThan(0)
    // The record already here kept the device's version, not the file's.
    expect((await db.sales.get(edited.id))?.total).toBe(fromDecimal(777))
  })

  test('does not queue anything for the server unless asked', async () => {
    await seedShop()
    const inspection = await inspect(await buildBackup('Ana'))

    const outcome = await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })
    expect(outcome.queuedForServer).toBe(0)
    // Only the audit entry recording the restore itself is queued.
    const queued = await db.outbox.toArray()
    expect(queued.every((entry) => entry.entity === 'auditLogs')).toBe(true)
  })

  test('queues everything when this device is the surviving copy', async () => {
    await seedShop()
    const inspection = await inspect(await buildBackup('Ana'))

    const outcome = await restoreBackup({ inspection, mode: 'REPLACE', sync: 'PUSH', user: USER })
    expect(outcome.queuedForServer).toBe(4)
  })

  test('records the restore in the audit trail, and it survives the wipe', async () => {
    await seedShop()
    const inspection = await inspect(await buildBackup('Ana'))

    await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    const logs = await db.auditLogs.toArray()
    expect(logs.map((log) => log.action)).toContain('BACKUP_RESTORED')
  })

  test('refuses a file that failed its checks', async () => {
    await seedShop()
    const file = await buildBackup('Ana')
    salesIn(file)[0]!.total = fromDecimal(1)
    const inspection = await inspect(file)

    await expect(
      restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER }),
    ).rejects.toThrow(/did not pass its checks/i)
  })
})

describe('numbering after a restore', () => {
  test('never re-issues a receipt number the restored sales already use', async () => {
    await seedShop()
    // The device had reached 500 before the backup was taken.
    await commit([created('sales', saleRow('OR-01-000500'))])
    const inspection = await inspect(await buildBackup('Ana'))

    // A fresh device with its counter at the start.
    await clearBusinessData()
    await writeMeta(META_KEYS.receiptCounter, 1)

    const outcome = await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    expect(outcome.nextReceiptNumber).toBe(501)
    expect(await readMeta(META_KEYS.receiptCounter, 0)).toBe(501)
  })

  test('leaves another terminal-s numbering alone', async () => {
    await seedShop()
    // Sales from a different till: a different code, a different series.
    await commit([created('sales', saleRow('OR-ZZ-009000'))])
    const inspection = await inspect(await buildBackup('Ana'))

    await writeMeta(META_KEYS.receiptCounter, 7)
    const outcome = await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    // 9000 belongs to till ZZ and cannot collide with this one.
    expect(outcome.nextReceiptNumber).toBe(7)
  })

  test('never moves the counter backwards', async () => {
    await seedShop()
    const inspection = await inspect(await buildBackup('Ana'))

    await writeMeta(META_KEYS.receiptCounter, 4242)
    const outcome = await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    expect(outcome.nextReceiptNumber).toBe(4242)
  })

  test('resets the queue so the next sale starts the day cleanly', async () => {
    await seedShop()
    const inspection = await inspect(await buildBackup('Ana'))
    await writeMeta(META_KEYS.queueDate, '2020-01-01')
    await writeMeta(META_KEYS.queueCounter, 88)

    await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    expect(await readMeta(META_KEYS.queueDate, 'unset')).toBe('')
    expect(await readMeta(META_KEYS.queueCounter, 0)).toBe(1)
  })
})

describe('the state a restore leaves behind', () => {
  test('asks the server again from the beginning', async () => {
    await seedShop()
    const inspection = await inspect(await buildBackup('Ana'))
    await writeMeta(META_KEYS.cursor, 9_999)

    await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    expect(await readMeta(META_KEYS.cursor, -1)).toBe(0)
  })

  test('marks the device as set up so the starter menu is not seeded over the top', async () => {
    await seedShop()
    const inspection = await inspect(await buildBackup('Ana'))
    await writeMeta(META_KEYS.seeded, false)

    await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    expect(await readMeta(META_KEYS.seeded, false)).toBe(true)
  })

  test('carries the migration list with the data it describes', async () => {
    await seedShop()
    await writeMeta(META_KEYS.migrationsApplied, ['2026-08-30-remove-sweetness'])
    const inspection = await inspect(await buildBackup('Ana'))

    // This device has had no migrations; the restored data has had one.
    await writeMeta(META_KEYS.migrationsApplied, [])
    await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    expect(await readMeta<string[]>(META_KEYS.migrationsApplied, [])).toEqual([
      '2026-08-30-remove-sweetness',
    ])
  })

  test('drops migration ids this build has never heard of', async () => {
    await seedShop()
    await writeMeta(META_KEYS.migrationsApplied, ['2099-from-the-future'])
    const inspection = await inspect(await buildBackup('Ana'))

    await restoreBackup({ inspection, mode: 'REPLACE', sync: 'RESYNC', user: USER })

    expect(await readMeta<string[]>(META_KEYS.migrationsApplied, [])).toEqual([])
  })
})

describe('clearing business data', () => {
  test('empties every synchronised table and leaves the device alone', async () => {
    await seedShop()
    await writeMeta(META_KEYS.deviceId, DEVICE.deviceId)
    await writeMeta(META_KEYS.serverToken, 'keep-me')

    await clearBusinessData()

    for (const entity of SYNC_ENTITIES) {
      expect(await db.table(entity).count()).toBe(0)
    }
    expect(await db.outbox.count()).toBe(0)
    expect(await readMeta(META_KEYS.serverToken, null)).toBe('keep-me')
    expect(await readMeta(META_KEYS.deviceId, null)).toBe(DEVICE.deviceId)
  })

  test('covers every synced entity, so a new table cannot be forgotten', async () => {
    // This is the regression that salesTargets actually hit: a hand-written
    // list silently stopped covering a table added in a later Dexie version.
    for (const entity of SYNC_ENTITIES) {
      expect(() => db.table(entity)).not.toThrow()
    }
  })
})

describe('catching up from another till', () => {
  const rec = (over: Partial<SyncMeta> = {}): SyncMeta =>
    ({ id: 'R1', deviceId: 'POS-A', version: 1, updatedAt: 1_000, createdAt: 0, deletedAt: null, ...over }) as SyncMeta

  describe('what cannot be edited is never overwritten', () => {
    test('a sale already here stands, whatever the other device says', () => {
      const mine = rec({ version: 1 })
      const theirs = rec({ version: 99, updatedAt: 9_999 })
      expect(reconcile('sales', mine, theirs)).toBe('KEEP_MINE')
      expect(reconcile('payments', mine, theirs)).toBe('KEEP_MINE')
      expect(reconcile('inventoryMovements', mine, theirs)).toBe('KEEP_MINE')
      expect(reconcile('auditLogs', mine, theirs)).toBe('KEEP_MINE')
    })
  })

  describe('an edit takes the later one', () => {
    test('a higher version wins', () => {
      expect(reconcile('products', rec({ version: 1 }), rec({ version: 2 }))).toBe('TAKE_THEIRS')
      expect(reconcile('products', rec({ version: 3 }), rec({ version: 2 }))).toBe('KEEP_MINE')
    })

    test('at the same version, the later clock wins', () => {
      const mine = rec({ version: 2, updatedAt: 5_000 })
      expect(reconcile('products', mine, rec({ version: 2, updatedAt: 6_000 }))).toBe('TAKE_THEIRS')
      expect(reconcile('products', mine, rec({ version: 2, updatedAt: 4_000 }))).toBe('KEEP_MINE')
    })

    test('two clocks that agree still land on one answer, and the same one on both tills', () => {
      const a = rec({ deviceId: 'POS-A', version: 2, updatedAt: 5_000 })
      const b = rec({ deviceId: 'POS-B', version: 2, updatedAt: 5_000 })

      // Run from A's side, then from B's side. Both must end up with B's copy.
      expect(reconcile('products', a, b)).toBe('TAKE_THEIRS')
      expect(reconcile('products', b, a)).toBe('KEEP_MINE')
    })
  })

  describe('the things worth stopping over', () => {
    test('a clear advance is taken without asking', () => {
      expect(reconcile('settings', rec({ version: 1 }), rec({ version: 2 }))).toBe('TAKE_THEIRS')
      expect(reconcile('ingredients', rec({ version: 4 }), rec({ version: 2 }))).toBe('KEEP_MINE')
    })

    test('both edited from the same point, so neither is guessed at', () => {
      const mine = rec({ version: 2, updatedAt: 5_000 })
      const theirs = rec({ version: 2, updatedAt: 6_000, deviceId: 'POS-B' })
      expect(reconcile('settings', mine, theirs)).toBe('CONFLICT')
      expect(reconcile('productVariants', mine, theirs)).toBe('CONFLICT')
    })

    test('identical records are not a disagreement', () => {
      const same = rec({ version: 2 })
      expect(reconcile('settings', same, { ...same })).toBe('KEEP_MINE')
    })
  })

  describe('a deletion travels like any other edit', () => {
    test('the other till deleting something later removes it here', () => {
      const mine = rec({ version: 1, deletedAt: null })
      const theirs = rec({ version: 2, deletedAt: 7_000 })
      expect(reconcile('products', mine, theirs)).toBe('TAKE_THEIRS')
    })

    test('but not when this till has since brought it back', () => {
      const mine = rec({ version: 3, deletedAt: null })
      const theirs = rec({ version: 2, deletedAt: 7_000 })
      expect(reconcile('products', mine, theirs)).toBe('KEEP_MINE')
    })
  })

  describe('every entity has an answer', () => {
    test('no entity falls through without a rule', () => {
      for (const entity of SYNC_ENTITIES) {
        const verdict = reconcile(entity, rec({ version: 1 }), rec({ version: 2 }))
        expect(['TAKE_THEIRS', 'KEEP_MINE', 'CONFLICT']).toContain(verdict)
      }
    })
  })
})
