import http from 'node:http'
import process from 'node:process'
import {
  SYNC_ENTITIES,
  type PullResponse,
  type PushAccepted,
  type PushRejected,
  type PushRequest,
  type PushResponse,
  type SyncEntity,
  type SyncEnvelope,
} from '@pos/shared'
import { config } from './config.ts'
import {
  applyEnvelope,
  countChangesAfter,
  databasePath,
  readChanges,
  serverSeq,
  transaction,
} from './db.ts'
import {
  authenticate,
  enrolDevice,
  listDevices,
  setDeviceActive,
  setDeviceCursor,
  type DeviceRecord,
} from './auth.ts'
import { applyCors, bearerToken, HttpError, readJsonBody, sendError, sendJson } from './http.ts'
import { attachRealtime, broadcastBatch, connectedDeviceIds, connectionCount, setSeqSource } from './realtime.ts'

const APP_VERSION = '0.1.0'
const VALID_ENTITIES = new Set<string>(SYNC_ENTITIES)

const server = http.createServer(async (req, res) => {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  try {
    await route(req, res, url)
  } catch (error) {
    if (error instanceof HttpError) {
      sendError(res, error.status, error.message, error.code)
      return
    }
    // Operators get plain language; the detail stays in the server log.
    console.error('[server] unhandled error', error)
    sendError(
      res,
      500,
      'The server could not complete that request. Nothing was changed, and any records on the device are still safe.',
      'INTERNAL',
    )
  }
})

async function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const path = url.pathname

  if (req.method === 'GET' && path === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      version: APP_VERSION,
      serverSeq: serverSeq(),
      serverTime: Date.now(),
      realtimeConnections: connectionCount(),
    })
    return
  }

  if (req.method === 'POST' && path === '/api/devices/enrol') {
    const body = await readJsonBody<{
      deviceId?: string
      label?: string
      type?: string
      code?: string
      appVersion?: string
    }>(req)
    const result = enrolDevice({
      deviceId: String(body.deviceId ?? ''),
      label: String(body.label ?? ''),
      type: String(body.type ?? 'WEB'),
      code: String(body.code ?? ''),
      appVersion: body.appVersion,
    })
    sendJson(res, 200, { ...result, serverSeq: serverSeq(), serverTime: Date.now() })
    return
  }

  // Everything past this point requires an enrolled, active device.
  const device = authenticate(bearerToken(req))

  if (req.method === 'POST' && path === '/api/sync/push') {
    await handlePush(req, res, device)
    return
  }

  if (req.method === 'GET' && path === '/api/sync/pull') {
    handlePull(res, url, device)
    return
  }

  if (req.method === 'GET' && path === '/api/sync/status') {
    const connected = new Set(connectedDeviceIds())
    sendJson(res, 200, {
      serverSeq: serverSeq(),
      serverTime: Date.now(),
      databasePath: databasePath(),
      devices: listDevices().map((entry) => ({
        ...entry,
        connected: connected.has(entry.deviceId),
        behindBy: countChangesAfter(entry.cursor),
      })),
    })
    return
  }

  if (req.method === 'POST' && path === '/api/devices/active') {
    const body = await readJsonBody<{ deviceId?: string; active?: boolean }>(req)
    if (!body.deviceId) throw new HttpError(400, 'Which device should be changed?')
    if (body.deviceId === device.deviceId && body.active === false) {
      throw new HttpError(400, 'A device cannot deactivate itself. Do it from another terminal.')
    }
    setDeviceActive(body.deviceId, body.active !== false)
    sendJson(res, 200, { ok: true })
    return
  }

  sendError(res, 404, 'That address does not exist on this server.', 'NOT_FOUND')
}

async function handlePush(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  device: DeviceRecord,
): Promise<void> {
  const body = await readJsonBody<PushRequest>(req)
  // Treated as unknown until validated: a device is not trusted to send a
  // well-formed envelope just because the type says so.
  const entries: unknown[] = Array.isArray(body.entries) ? body.entries : []

  if (entries.length > config.maxPushBatch) {
    throw new HttpError(
      413,
      `Too many records in one batch. Send at most ${config.maxPushBatch} at a time.`,
      'BATCH_TOO_LARGE',
    )
  }

  const accepted: PushAccepted[] = []
  const rejected: PushRejected[] = []
  const changed: Array<{ entity: SyncEntity; entityId: string }> = []

  // One transaction for the whole batch: a device's offline work lands
  // completely or not at all, never half-applied.
  transaction(() => {
    for (const envelope of entries) {
      if (!isWellFormed(envelope)) {
        const partial = (envelope ?? {}) as Partial<SyncEnvelope>
        rejected.push({
          entity: (partial.entity ?? 'sales') as SyncEntity,
          entityId: String(partial.entityId ?? ''),
          reason: 'INVALID',
          message: 'The change was missing required fields.',
          serverRecord: null,
          serverVersion: null,
        })
        continue
      }

      // A device may only ever speak for itself.
      const stamped: SyncEnvelope = { ...envelope, deviceId: device.deviceId }
      const outcome = applyEnvelope(stamped)

      switch (outcome.status) {
        case 'APPLIED':
          accepted.push({
            entity: stamped.entity,
            entityId: stamped.entityId,
            seq: outcome.seq,
            serverUpdatedAt: outcome.serverUpdatedAt,
          })
          changed.push({ entity: stamped.entity, entityId: stamped.entityId })
          break
        case 'IDEMPOTENT':
          accepted.push({
            entity: stamped.entity,
            entityId: stamped.entityId,
            seq: outcome.seq,
            serverUpdatedAt: outcome.serverUpdatedAt,
          })
          break
        case 'STALE':
          // The server already holds something newer. The device is not in
          // error; it simply needs to pull. Treat as accepted so the outbox
          // clears, and let the pull deliver the newer record.
          accepted.push({
            entity: stamped.entity,
            entityId: stamped.entityId,
            seq: serverSeq(),
            serverUpdatedAt: Number(outcome.serverRecord['updatedAt'] ?? Date.now()),
          })
          break
        case 'CONFLICT':
          rejected.push({
            entity: stamped.entity,
            entityId: stamped.entityId,
            reason: 'CONFLICT',
            message: 'Someone else changed this record while this device was offline.',
            serverRecord: outcome.serverRecord,
            serverVersion: outcome.serverVersion,
          })
          break
        case 'INVALID':
          rejected.push({
            entity: stamped.entity,
            entityId: stamped.entityId,
            reason: 'INVALID',
            message: outcome.message,
            serverRecord: null,
            serverVersion: null,
          })
          break
      }
    }
  })

  const seq = serverSeq()
  if (changed.length > 0) {
    broadcastBatch(changed, seq, device.deviceId)
  }

  const response: PushResponse = { accepted, rejected, serverSeq: seq, serverTime: Date.now() }
  sendJson(res, 200, response)
}

function handlePull(res: http.ServerResponse, url: URL, device: DeviceRecord): void {
  const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0)
  const requested = Number(url.searchParams.get('limit') ?? 500) || 500
  const limit = Math.min(config.maxPullBatch, Math.max(1, requested))

  const changes = readChanges(since, limit)
  const cursor = changes.length > 0 ? (changes[changes.length - 1]?.seq ?? since) : since
  const hasMore = countChangesAfter(cursor) > 0

  setDeviceCursor(device.deviceId, cursor)

  const response: PullResponse = { changes, cursor, hasMore, serverTime: Date.now() }
  sendJson(res, 200, response)
}

function isWellFormed(value: unknown): value is SyncEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Partial<SyncEnvelope>
  if (typeof envelope.entity !== 'string' || !VALID_ENTITIES.has(envelope.entity)) return false
  if (typeof envelope.entityId !== 'string' || envelope.entityId.length === 0) return false
  if (typeof envelope.op !== 'string' || !['CREATE', 'UPDATE', 'DELETE'].includes(envelope.op)) return false
  if (!Number.isFinite(envelope.version)) return false
  if (envelope.payload === null || typeof envelope.payload !== 'object') return false
  return true
}

setSeqSource(serverSeq)
attachRealtime(server)

server.listen(config.port, config.host, () => {
  console.log(`[server] POS sync server listening on http://${config.host}:${config.port}`)
  console.log(`[server] database: ${databasePath()}`)
  console.log(`[server] change log at sequence ${serverSeq()}`)
})

function shutdown(signal: string): void {
  console.log(`[server] ${signal} received, closing`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
