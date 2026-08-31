import {
  CONFLICT_POLICIES,
  newId,
  retryDelayMs,
  type ConnectionState,
  type OutboxEntry,
  type PullChange,
  type RealtimeMessage,
  type SyncEnvelope,
  type SyncMeta,
  type SyncSnapshot,
} from '@pos/shared'
import { db, META_KEYS, readMeta, tableFor, writeMeta } from '../db/database.ts'
import { identity } from '../db/identity.ts'
import * as transport from './transport.ts'
import type { ServerConfig } from './transport.ts'
import { onOutboxChanged } from './pending.ts'

/**
 * The synchronisation engine.
 *
 * Its contract with the rest of the application is narrow on purpose: nothing
 * else ever talks to the server, and nothing here ever blocks a sale. The till
 * writes to the local database and moves on; this runs behind it, pushes what
 * is queued, pulls what it missed, and reports honestly what state it is in.
 *
 * Failure is the expected case, not the exception. Every path through this
 * file leaves queued work queued.
 */

const APP_VERSION = '0.1.0'
const PUSH_BATCH = 200
const PULL_BATCH = 500
const IDLE_POLL_MS = 30_000
const REALTIME_RETRY_MS = 5_000
/** Long enough to batch a burst of writes, short enough to feel immediate. */
const FLUSH_DEBOUNCE_MS = 250

const EMPTY: SyncSnapshot = {
  state: 'OFFLINE',
  online: false,
  realtimeConnected: false,
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  lastSyncAt: null,
  lastError: null,
  cursor: 0,
  serverSeq: 0,
}

export class SyncEngine {
  private snapshot: SyncSnapshot = { ...EMPTY }
  private listeners = new Set<(snapshot: SyncSnapshot) => void>()
  private socket: WebSocket | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private realtimeTimer: ReturnType<typeof setTimeout> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private stopListeningForWork: (() => void) | null = null
  private cycleInFlight: Promise<void> | null = null
  private started = false
  private config: ServerConfig = { url: '', token: null }

  // ------------------------------------------------------------- lifecycle --

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    try {
      this.config = {
        url: await readMeta<string>(META_KEYS.serverUrl, ''),
        token: await readMeta<string | null>(META_KEYS.serverToken, null),
      }
      this.snapshot = {
        ...this.snapshot,
        cursor: await readMeta<number>(META_KEYS.cursor, 0),
        lastSyncAt: await readMeta<number | null>(META_KEYS.lastSyncAt, null),
      }
      await this.refreshCounts()
    } catch (error) {
      // Reading the local database failed - the browser was mid-upgrade, or
      // the tab was restored before storage was ready. Give the flag back so
      // the next attempt can actually start, rather than leaving the till
      // permanently "Offline" with sales piling up and nothing explaining it.
      this.started = false
      throw error
    }

    window.addEventListener('online', this.handleBrowserOnline)
    window.addEventListener('offline', this.handleBrowserOffline)
    document.addEventListener('visibilitychange', this.handleVisibility)

    // A completed sale should leave for the server straight away, not wait for
    // the next idle tick.
    this.stopListeningForWork = onOutboxChanged(() => this.scheduleFlush())

    void this.syncNow()
    this.scheduleIdlePoll()
  }

  stop(): void {
    this.started = false
    // Guarded because stop() is legitimately called where start() never ran -
    // by a restore before it moves the tables, and under test - and throwing
    // there would abandon the caller half-way through something delicate.
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleBrowserOnline)
      window.removeEventListener('offline', this.handleBrowserOffline)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility)
    }
    this.stopListeningForWork?.()
    this.stopListeningForWork = null
    if (this.pollTimer) clearTimeout(this.pollTimer)
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.closeRealtime()
  }

  /**
   * Coalesce a burst of writes into one push.
   *
   * The count is refreshed immediately so the status indicator reacts the
   * instant a sale is saved, even while offline - the operator sees their work
   * being held, not a stale zero.
   */
  private scheduleFlush(): void {
    void this.refreshCounts()
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.syncNow()
    }, FLUSH_DEBOUNCE_MS)
  }

  private handleBrowserOnline = (): void => {
    // The browser only knows it has *a* network, not that our server is on it,
    // so this is a prompt to go and check rather than a state change.
    this.emit({ lastError: null })
    void this.syncNow()
  }

  private handleBrowserOffline = (): void => {
    this.closeRealtime()
    this.emit({ state: 'OFFLINE', online: false, realtimeConnected: false })
  }

  private handleVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.syncNow()
  }

  // -------------------------------------------------------------- observers --

  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): SyncSnapshot {
    return this.snapshot
  }

  private emit(changes: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes }
    for (const listener of this.listeners) listener(this.snapshot)
  }

  private async refreshCounts(): Promise<void> {
    const [pending, failed, conflicts] = await Promise.all([
      db.outbox.where('status').anyOf('SYNC_PENDING', 'SYNCING').count(),
      db.outbox.where('status').equals('SYNC_FAILED').count(),
      db.conflicts.filter((conflict) => conflict.resolvedAt === null).count(),
    ])
    this.emit({ pendingCount: pending, failedCount: failed, conflictCount: conflicts })
  }

  // ----------------------------------------------------------- server setup --

  isConfigured(): boolean {
    return Boolean(this.config.url && this.config.token)
  }

  serverUrl(): string {
    return this.config.url
  }

  /** Enrol this terminal with a server. Local data is untouched either way. */
  async enrol(url: string, code: string): Promise<void> {
    const device = identity()
    const normalised = url.trim().replace(/\/+$/, '')
    const result = await transport.enrol(
      { url: normalised, token: null },
      {
        deviceId: device.deviceId,
        label: device.label,
        type: device.type,
        code,
        appVersion: APP_VERSION,
      },
    )
    this.config = { url: normalised, token: result.token }
    await writeMeta(META_KEYS.serverUrl, normalised)
    await writeMeta(META_KEYS.serverToken, result.token)
    this.emit({ serverSeq: result.serverSeq, lastError: null })
    await this.syncNow()
  }

  /** Detach from the server. Everything already recorded here stays here. */
  async forgetServer(): Promise<void> {
    this.closeRealtime()
    this.config = { url: '', token: null }
    await writeMeta(META_KEYS.serverUrl, '')
    await writeMeta(META_KEYS.serverToken, null)
    this.emit({ state: 'OFFLINE', online: false, realtimeConnected: false })
  }

  // ------------------------------------------------------------- sync cycle --

  /**
   * Wait for a cycle already in flight to finish.
   *
   * stop() takes down the timers and the socket, but a push that is already
   * awaiting the network is still going to come back and write its result. A
   * restore has to wait for that before it moves the tables underneath it,
   * otherwise the response lands on an outbox that has just been emptied and
   * the work it described is lost without an error.
   */
  async settle(): Promise<void> {
    await this.cycleInFlight
  }

  /** Run a full cycle. Concurrent callers share the one in flight. */
  syncNow(): Promise<void> {
    if (this.cycleInFlight) return this.cycleInFlight
    this.cycleInFlight = this.runCycle().finally(() => {
      this.cycleInFlight = null
    })
    return this.cycleInFlight
  }

  private async runCycle(): Promise<void> {
    if (!this.isConfigured()) {
      // Standalone till: perfectly valid, and everything is safely local.
      await this.refreshCounts()
      this.emit({ state: 'OFFLINE', online: false, realtimeConnected: false })
      return
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await this.refreshCounts()
      this.emit({ state: 'OFFLINE', online: false, realtimeConnected: false })
      return
    }

    this.emit({ state: 'SYNCING' })

    try {
      const status = await transport.health(this.config)
      this.emit({ online: true, serverSeq: status.serverSeq })
    } catch {
      await this.refreshCounts()
      this.emit({ state: 'OFFLINE', online: false, realtimeConnected: false })
      this.closeRealtime()
      return
    }

    let hadError = false
    try {
      await this.drainOutbox()
      await this.pullChanges()
      const now = Date.now()
      await writeMeta(META_KEYS.lastSyncAt, now)
      this.emit({ lastSyncAt: now, lastError: null })
    } catch (error) {
      hadError = true
      const message =
        error instanceof transport.TransportError
          ? error.message
          : 'Synchronisation could not finish. Nothing was lost - it will retry automatically.'
      this.emit({ lastError: message })
    }

    await this.refreshCounts()
    this.connectRealtime()
    this.emit({ state: this.deriveState(hadError) })
  }

  private deriveState(hadError: boolean): ConnectionState {
    if (this.snapshot.conflictCount > 0) return 'CONFLICT'
    if (hadError || this.snapshot.failedCount > 0) return 'SYNC_ERROR'
    if (this.snapshot.pendingCount > 0) return 'SYNCING'
    return 'ONLINE'
  }

  // ---------------------------------------------------------------- pushing --

  private async drainOutbox(): Promise<void> {
    const now = Date.now()

    // Conflicted entries are held back until a person resolves them; retrying
    // would only produce the same conflict again.
    const ready = await db.outbox
      .where('status')
      .anyOf('SYNC_PENDING', 'SYNC_FAILED')
      .and((entry) => entry.nextAttemptAt <= now)
      .sortBy('createdAt')

    if (ready.length === 0) return

    for (let offset = 0; offset < ready.length; offset += PUSH_BATCH) {
      const batch = ready.slice(offset, offset + PUSH_BATCH)
      await this.pushBatch(batch)
    }
  }

  private async pushBatch(batch: OutboxEntry[]): Promise<void> {
    const device = identity()
    const ids = batch.map((entry) => entry.id)
    await db.outbox.where('id').anyOf(ids).modify({ status: 'SYNCING', lastAttemptAt: Date.now() })

    const envelopes: SyncEnvelope[] = batch.map((entry) => ({
      entity: entry.entity,
      entityId: entry.entityId,
      op: entry.op,
      version: entry.version,
      deviceId: device.deviceId,
      updatedAt: (entry.payload as SyncMeta).updatedAt,
      payload: entry.payload,
    }))

    let response
    try {
      response = await transport.push(this.config, device.deviceId, envelopes)
    } catch (error) {
      // The batch stays exactly where it was, with a longer wait before the
      // next attempt. Nothing is discarded, ever.
      const message = error instanceof Error ? error.message : 'The server could not be reached.'
      await db.transaction('rw', db.outbox, async () => {
        for (const entry of batch) {
          const attempts = entry.attempts + 1
          await db.outbox.update(entry.id, {
            status: 'SYNC_FAILED',
            attempts,
            lastError: message,
            nextAttemptAt: Date.now() + retryDelayMs(attempts),
          })
        }
      })
      throw error
    }

    const acceptedIds = new Set<string>(
      response.accepted.map((item) => `${item.entity}:${item.entityId}`),
    )
    const rejections = new Map<string, (typeof response.rejected)[number]>(
      response.rejected.map((item) => [`${item.entity}:${item.entityId}`, item]),
    )

    await db.transaction('rw', [db.outbox, db.conflicts], async () => {
      for (const entry of batch) {
        const key = `${entry.entity}:${entry.entityId}`

        if (acceptedIds.has(key)) {
          // Safely on the server; the local record itself stays put.
          await db.outbox.delete(entry.id)
          continue
        }

        const rejection = rejections.get(key)
        if (!rejection) {
          // The server said nothing about it. Retry rather than assume.
          const attempts = entry.attempts + 1
          await db.outbox.update(entry.id, {
            status: 'SYNC_FAILED',
            attempts,
            lastError: 'The server did not confirm this record.',
            nextAttemptAt: Date.now() + retryDelayMs(attempts),
          })
          continue
        }

        if (rejection.reason === 'CONFLICT') {
          await db.conflicts.put({
            id: newId(),
            entity: entry.entity,
            entityId: entry.entityId,
            localPayload: entry.payload,
            serverPayload: rejection.serverRecord,
            localVersion: entry.version,
            serverVersion: rejection.serverVersion ?? 0,
            detectedAt: Date.now(),
            resolvedAt: null,
            resolution: null,
            resolvedBy: null,
          })
          await db.outbox.update(entry.id, {
            status: 'CONFLICT',
            lastError: rejection.message,
            attempts: entry.attempts + 1,
          })
          continue
        }

        // INVALID or FORBIDDEN: retrying unchanged will not help, so it is
        // parked as failed and surfaced rather than silently dropped.
        await db.outbox.update(entry.id, {
          status: 'SYNC_FAILED',
          attempts: entry.attempts + 1,
          lastError: rejection.message,
          nextAttemptAt: Date.now() + retryDelayMs(entry.attempts + 6),
        })
      }
    })
  }

  // ---------------------------------------------------------------- pulling --

  private async pullChanges(): Promise<void> {
    let cursor = this.snapshot.cursor
    let guard = 0

    for (;;) {
      const response = await transport.pull(this.config, cursor, PULL_BATCH)
      if (response.changes.length > 0) {
        await this.applyChanges(response.changes)
      }
      cursor = response.cursor
      await writeMeta(META_KEYS.cursor, cursor)
      this.emit({ cursor })

      if (!response.hasMore) break
      if (++guard > 200) break // A pathological backlog should not spin forever.
    }
  }

  private async applyChanges(changes: PullChange[]): Promise<void> {
    const device = identity()

    // A record this device is still trying to push must not be overwritten by
    // an older copy of itself coming back around.
    const pendingKeys = new Set<string>(
      (await db.outbox.where('status').anyOf('SYNC_PENDING', 'SYNCING', 'SYNC_FAILED').toArray()).map(
        (entry) => `${entry.entity}:${entry.entityId}`,
      ),
    )

    const tables = [...new Set(changes.map((change) => change.entity))].map((entity) => tableFor(entity))

    await db.transaction('rw', tables, async () => {
      for (const change of changes) {
        const key = `${change.entity}:${change.entityId}`

        if (change.originDeviceId === device.deviceId && !pendingKeys.has(key)) {
          // Our own change, already applied locally before it was ever sent.
          continue
        }
        if (pendingKeys.has(key) && CONFLICT_POLICIES[change.entity] !== 'APPEND_ONLY') {
          // Leave the local edit alone; the push will settle who wins.
          continue
        }

        const record = change.payload as SyncMeta
        if (!record || typeof record !== 'object' || !record.id) continue
        await tableFor(change.entity).put(record as { id: string })
      }
    })
  }

  // --------------------------------------------------------------- realtime --

  private connectRealtime(): void {
    if (this.socket || !this.isConfigured()) return
    const url = transport.realtimeUrl(this.config)
    if (!url) return

    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      return
    }
    this.socket = socket

    socket.onopen = () => this.emit({ realtimeConnected: true })

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as RealtimeMessage | { type: string }
        if (message.type === 'READY' || message.type === 'PONG') return
        const realtime = message as RealtimeMessage
        // Our own echo tells us nothing we do not already know.
        if (realtime.originDeviceId === identity().deviceId) return
        void this.syncNow()
      } catch {
        // A malformed frame changes nothing; the poll will still catch up.
      }
    }

    const drop = () => {
      this.socket = null
      this.emit({ realtimeConnected: false })
      // Reconnect quietly. Sync correctness never depended on this socket.
      if (this.started && this.isConfigured()) {
        if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
        this.realtimeTimer = setTimeout(() => this.connectRealtime(), REALTIME_RETRY_MS)
      }
    }
    socket.onclose = drop
    socket.onerror = () => socket.close()
  }

  private closeRealtime(): void {
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    socket.onclose = null
    socket.onerror = null
    try {
      socket.close()
    } catch {
      // Already gone.
    }
    this.emit({ realtimeConnected: false })
  }

  // ------------------------------------------------------------------- poll --

  private scheduleIdlePoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => {
      void this.syncNow().finally(() => this.scheduleIdlePoll())
    }, IDLE_POLL_MS)
  }

  // -------------------------------------------------------------- conflicts --

  /** Resolve a conflict by keeping what this device recorded. */
  async resolveKeepLocal(conflictId: string, userId: string): Promise<void> {
    const conflict = await db.conflicts.get(conflictId)
    if (!conflict) return
    const local = conflict.localPayload as SyncMeta

    await db.transaction('rw', [db.conflicts, db.outbox, tableFor(conflict.entity)], async () => {
      // Re-issue above the server's version so the next push is accepted.
      const revised = { ...local, version: conflict.serverVersion + 1, updatedAt: Date.now() }
      await tableFor(conflict.entity).put(revised as { id: string })
      await db.outbox
        .where('entityId')
        .equals(conflict.entityId)
        .modify({
          status: 'SYNC_PENDING',
          payload: revised,
          version: revised.version,
          nextAttemptAt: Date.now(),
          lastError: null,
        })
      await db.conflicts.update(conflictId, {
        resolvedAt: Date.now(),
        resolution: 'KEEP_LOCAL',
        resolvedBy: userId,
      })
    })
    await this.syncNow()
  }

  /** Resolve a conflict by accepting the server's version. */
  async resolveKeepServer(conflictId: string, userId: string): Promise<void> {
    const conflict = await db.conflicts.get(conflictId)
    if (!conflict) return
    const server = conflict.serverPayload as SyncMeta | null

    await db.transaction('rw', [db.conflicts, db.outbox, tableFor(conflict.entity)], async () => {
      if (server && server.id) await tableFor(conflict.entity).put(server as { id: string })
      await db.outbox.where('entityId').equals(conflict.entityId).delete()
      await db.conflicts.update(conflictId, {
        resolvedAt: Date.now(),
        resolution: 'KEEP_SERVER',
        resolvedBy: userId,
      })
    })
    await this.refreshCounts()
    await this.syncNow()
  }

  /** Push a stuck entry again straight away, for the manual Sync button. */
  async retryFailed(): Promise<void> {
    await db.outbox
      .where('status')
      .equals('SYNC_FAILED')
      .modify({ status: 'SYNC_PENDING', nextAttemptAt: Date.now(), attempts: 0 })
    await this.syncNow()
  }
}

export const syncEngine = new SyncEngine()
