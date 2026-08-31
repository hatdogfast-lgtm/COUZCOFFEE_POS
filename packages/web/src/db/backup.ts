import {
  CONFLICT_POLICIES,
  newId,
  SYNC_ENTITIES,
  type AuditLog,
  type SyncConflictRecord,
  type SyncEntity,
  type SyncMeta,
  type User,
} from '@pos/shared'
import type { BusinessSettings, OutboxEntry, Sale } from '@pos/shared'
import { clearBusinessData, db, META_KEYS, readMeta, tableFor, writeMeta } from './database.ts'
import { identity } from './identity.ts'
import { appliedMigrationIds, knownMigrationIds } from './migrations.ts'
import { commit, created, stamp } from './write.ts'
import { syncEngine } from '../sync/engine.ts'

/**
 * Backup and restore.
 *
 * A backup is every business record this device holds, in one readable file.
 * What it deliberately does NOT contain is the local `meta` table, because
 * that single bucket holds three different kinds of thing and there is no one
 * right answer for all of them:
 *
 *   - things that must be PRESERVED: the device id and the server token. A
 *     backup carrying those and restored onto a second terminal would clone
 *     the first one's identity, and two tills sharing a device id discard each
 *     other's changes as their own echo - a corruption that shows up on the
 *     server, not on the device where anyone could see it.
 *   - things that must be RECOMPUTED: the receipt and queue counters. They are
 *     device-local and are not part of the synced data, so restoring them from
 *     a file re-issues receipt numbers over the top of real ones, and nothing
 *     catches it - the index on receiptNo is not unique.
 *   - things that belong to the DATA rather than the device: which one-off
 *     migrations have been applied. That list is carried in the manifest and
 *     put back with the rows it describes, so the restored data gets exactly
 *     the migrations it has not already seen.
 *
 * So the file holds the business tables and the migration list, and restore
 * handles the rest deliberately rather than by accident.
 */

export const BACKUP_FORMAT = 'coffee-pos-backup'
export const BACKUP_VERSION = 1
const APP_VERSION = '0.1.0'

export interface BackupManifest {
  format: string
  version: number
  createdAt: number
  createdByName: string
  deviceId: string
  deviceLabel: string
  appVersion: string
  businessName: string
  /** Which one-off data migrations the rows in this file have already had. */
  migrationsApplied: string[]
  counts: Record<string, number>
  totalRows: number
  /** SHA-256 over the canonical form of `tables`, so a truncated or edited file is caught. */
  checksum: string
}

export interface BackupFile {
  manifest: BackupManifest
  tables: Record<string, SyncMeta[]>
}

export type RestoreMode = 'REPLACE' | 'MERGE' | 'CATCH_UP'

/**
 * What should happen with the server afterwards.
 *
 * This is the sharpest decision in a restore and there is no safe default, so
 * it is asked as a question rather than buried in the implementation.
 */
export type RestoreSyncChoice =
  /** Re-read the server from the beginning; where it has a record, it wins. */
  | 'RESYNC'
  /** This device is the surviving copy: queue everything up to a rebuilt server. */
  | 'PUSH'
  /** Cut this device off from the server entirely so nothing can be pushed. */
  | 'STANDALONE'

// ------------------------------------------------------------------ making --

/**
 * Canonical JSON: keys sorted at every level.
 *
 * Two backups of identical data must produce an identical checksum, and
 * property order in a JavaScript object is not something to bet that on.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
  return `{${entries.join(',')}}`
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildBackup(createdByName: string): Promise<BackupFile> {
  const tables: Record<string, SyncMeta[]> = {}
  const counts: Record<string, number> = {}
  let totalRows = 0

  for (const entity of SYNC_ENTITIES) {
    // Tombstones are included on purpose: a deletion is a fact, and a restore
    // that dropped them would resurrect everything anyone had ever deleted.
    const rows = (await tableFor(entity).toArray()) as unknown as SyncMeta[]
    tables[entity] = rows
    counts[entity] = rows.length
    totalRows += rows.length
  }

  const settings = (tables.settings ?? []) as unknown as BusinessSettings[]
  const device = identity()

  return {
    manifest: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: Date.now(),
      createdByName,
      deviceId: device.deviceId,
      deviceLabel: device.label,
      appVersion: APP_VERSION,
      businessName: settings[0]?.branding?.businessName ?? 'Point of Sale',
      migrationsApplied: await appliedMigrationIds(),
      counts,
      totalRows,
      checksum: await sha256(canonical(tables)),
    },
    tables,
  }
}

export function backupBlob(file: BackupFile): Blob {
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
}

export function backupFileName(file: BackupFile): string {
  const when = new Date(file.manifest.createdAt)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamped = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`
  const name = file.manifest.businessName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  return `${name || 'pos'}-backup-${stamped}.json`
}

/** Hands the file to the browser. Used both by the button and by the safety copy. */
export function saveBackup(file: BackupFile): void {
  const url = URL.createObjectURL(backupBlob(file))
  const link = document.createElement('a')
  link.href = url
  link.download = backupFileName(file)
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked on a later tick so the download has taken the handle first.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ---------------------------------------------------------------- checking --

export interface BackupProblem {
  severity: 'FATAL' | 'WARNING'
  message: string
  /** Only a problem when replacing; merging is unaffected. */
  replaceOnly?: boolean
}

export interface TableComparison {
  entity: string
  inFile: number
  onDevice: number
  /** Rows in the file that this device has never seen. */
  newHere: number
}

export interface BackupInspection {
  manifest: BackupManifest
  problems: BackupProblem[]
  comparison: TableComparison[]
  checksumOk: boolean
  fromThisDevice: boolean
  totalNewHere: number
  /** Work queued on this device that has not reached the server yet. */
  unsyncedCount: number
  file: BackupFile
}

/**
 * Read a file and say exactly what is in it, before anything is written.
 *
 * A restore that half-works is worse than one that refuses, so every check
 * happens here and the caller only proceeds on a clean bill.
 */
export async function inspectBackup(input: File | string): Promise<BackupInspection> {
  const text = typeof input === 'string' ? input : await input.text()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not a backup - it is not readable as JSON.')
  }

  const file = parsed as BackupFile
  if (!file || typeof file !== 'object' || !file.manifest || !file.tables) {
    throw new Error('That file is not a backup taken by this app.')
  }
  if (file.manifest.format !== BACKUP_FORMAT) {
    throw new Error('That file is not a backup taken by this app.')
  }

  const problems: BackupProblem[] = []

  if (typeof file.manifest.version !== 'number' || file.manifest.version > BACKUP_VERSION) {
    problems.push({
      severity: 'FATAL',
      message: `This backup was written by a newer version of the app (format ${String(file.manifest.version)}). Update before restoring it.`,
    })
  }

  const checksumOk = file.manifest.checksum === (await sha256(canonical(file.tables)))
  if (!checksumOk) {
    problems.push({
      severity: 'FATAL',
      message: 'This file has been changed since it was made, or did not download completely. It will not be restored.',
    })
  }

  const known = new Set<string>(SYNC_ENTITIES)
  for (const entity of Object.keys(file.tables)) {
    if (!known.has(entity)) {
      problems.push({
        severity: 'WARNING',
        message: `The file contains "${entity}", which this version does not know about. It will be skipped.`,
      })
    }
  }

  const comparison: TableComparison[] = []
  let totalNewHere = 0

  for (const entity of SYNC_ENTITIES) {
    const rows = Array.isArray(file.tables[entity]) ? file.tables[entity] : []
    const malformed = rows.filter((row) => !row || typeof row !== 'object' || typeof row.id !== 'string')
    if (malformed.length > 0) {
      problems.push({
        severity: 'FATAL',
        message: `${malformed.length} record(s) in "${entity}" have no id and cannot be restored.`,
      })
    }

    const existingIds = new Set((await tableFor(entity).toCollection().primaryKeys()) as string[])
    const newHere = rows.filter((row) => row?.id && !existingIds.has(row.id)).length
    totalNewHere += newHere

    comparison.push({ entity, inFile: rows.length, onDevice: existingIds.size, newHere })
  }

  // Replacing everything with a file that cannot produce a working till would
  // leave nobody able to sign in and no way back through the interface.
  const liveSettings = (file.tables.settings ?? []).filter((row) => row?.deletedAt === null)
  const liveUsers = (file.tables.users ?? []).filter(
    (row) => row?.deletedAt === null && (row as unknown as User).active,
  )
  if (liveSettings.length === 0) {
    problems.push({
      severity: 'FATAL',
      replaceOnly: true,
      message: 'This backup has no settings in it. Replacing everything with it would leave the till unusable.',
    })
  }
  if (liveUsers.length === 0) {
    problems.push({
      severity: 'FATAL',
      replaceOnly: true,
      message: 'This backup has no active staff in it. Replacing everything with it would lock everybody out.',
    })
  }

  const unsyncedCount = await db.outbox
    .where('status')
    .anyOf('SYNC_PENDING', 'SYNCING', 'SYNC_FAILED', 'CONFLICT')
    .count()

  if (unsyncedCount > 0) {
    problems.push({
      severity: 'WARNING',
      replaceOnly: true,
      message: `${unsyncedCount} record(s) on this device have not reached the server yet. Replacing everything will discard them. Sync first if you can.`,
    })
  }

  return {
    manifest: file.manifest,
    problems,
    comparison,
    checksumOk,
    fromThisDevice: file.manifest.deviceId === identity().deviceId,
    totalNewHere,
    unsyncedCount,
    file,
  }
}

/** Whether this file may be restored in the given mode. */
export function canRestore(inspection: BackupInspection, mode: RestoreMode): boolean {
  return !inspection.problems.some(
    (problem) => problem.severity === 'FATAL' && (!problem.replaceOnly || mode === 'REPLACE'),
  )
}

export function problemsFor(inspection: BackupInspection, mode: RestoreMode): BackupProblem[] {
  return inspection.problems.filter((problem) => !problem.replaceOnly || mode === 'REPLACE')
}

// --------------------------------------------------------------- restoring --

export interface RestoreOutcome {
  mode: RestoreMode
  written: number
  skipped: number
  queuedForServer: number
  /** The receipt number the next sale on this device will take. */
  nextReceiptNumber: number
}

function outboxRowFor(entity: SyncEntity, record: SyncMeta, now: number): OutboxEntry {
  return {
    id: newId(now),
    entity,
    entityId: record.id,
    op: 'UPDATE',
    version: record.version,
    payload: record,
    status: 'SYNC_PENDING',
    attempts: 0,
    lastError: null,
    createdAt: now,
    lastAttemptAt: null,
    nextAttemptAt: now,
  }
}

/** This terminal's two-character code, exactly as checkout stamps it on a receipt. */
function deviceCode(): string {
  return identity().deviceId.slice(-2).toUpperCase()
}

/**
 * Put the document counters back where the restored data leaves them.
 *
 * The counters are device-local and were never in the file. Left alone after a
 * replace they would re-issue receipt numbers that the restored sales already
 * use, and nothing downstream would notice: the index on receiptNo is not
 * unique and the server upserts on id.
 */
async function recomputeCounters(settings: BusinessSettings | undefined): Promise<number> {
  const code = deviceCode()
  const sales = (await db.sales.toArray()) as Sale[]

  let highest = 0
  for (const sale of sales) {
    // Only this terminal's own numbering can collide; another device's code
    // occupies a different series entirely.
    const parts = String(sale.receiptNo ?? '').split('-')
    if (parts.length < 3 || parts[parts.length - 2] !== code) continue
    const sequence = Number(parts[parts.length - 1])
    if (Number.isFinite(sequence) && sequence > highest) highest = sequence
  }

  const current = await readMeta<number>(META_KEYS.receiptCounter, settings?.receipt.nextNumber ?? 1)
  const next = Math.max(current || 1, highest + 1)

  await writeMeta(META_KEYS.receiptCounter, next)
  // Blanking the date makes the next sale take the daily-reset branch, so the
  // queue starts cleanly rather than continuing a sequence from another day.
  await writeMeta(META_KEYS.queueDate, '')
  await writeMeta(META_KEYS.queueCounter, settings?.queue.start ?? 1)

  return next
}

/**
 * Put a backup back.
 *
 * REPLACE empties every business table first, so what is left afterwards is
 * exactly the file and nothing else - no half-merged remnants of whatever the
 * device was holding. MERGE only adds records the device has never seen and
 * overwrites nothing, which is what you want when one thing was deleted by
 * mistake rather than when a device has been lost.
 *
 * CATCH_UP is the two tills swapping notes: it brings in what the other one
 * did and lets its later edits win, using exactly the rules the server sync
 * uses. It is how a shop keeps two devices in step with a file on a memory
 * stick when there is no server between them.
 *
 * None of them touch this device's identity.
 */
export async function restoreBackup(input: {
  inspection: BackupInspection
  mode: RestoreMode
  sync: RestoreSyncChoice
  user: User
}): Promise<RestoreOutcome> {
  const { inspection, mode, user } = input
  if (!canRestore(inspection, mode)) {
    throw new Error('This backup did not pass its checks and will not be restored.')
  }

  // The engine must not be mid-cycle while the tables move underneath it: a
  // push already in flight would write its result back into an outbox that no
  // longer has the row, and a pull would drop server records into tables that
  // are about to be emptied. Stopping it also parks the timers and the socket.
  syncEngine.stop()
  await syncEngine.settle()

  const now = Date.now()
  const tables = inspection.file.tables
  let written = 0
  let skipped = 0
  let queued = 0
  const conflicts: SyncConflictRecord[] = []

  if (mode === 'REPLACE') {
    await clearBusinessData()
  }

  for (const entity of SYNC_ENTITIES) {
    const rows = (Array.isArray(tables[entity]) ? tables[entity] : []).filter(
      (row) => row && typeof row === 'object' && typeof row.id === 'string',
    )
    if (rows.length === 0) continue

    const table = tableFor(entity)

    // One table at a time: a single transaction spanning every table with a
    // large backup in it is a long lock, and a partly-written table can be
    // fixed by running the restore again whereas a wedged database cannot.
    await db.transaction('rw', [table, db.outbox], async () => {
      let toWrite = rows

      if (mode === 'MERGE') {
        const existing = new Set((await table.toCollection().primaryKeys()) as string[])
        toWrite = rows.filter((row) => !existing.has(row.id))
        skipped += rows.length - toWrite.length
      }

      if (mode === 'CATCH_UP') {
        const mine = new Map(
          ((await table.toArray()) as unknown as SyncMeta[]).map((row) => [row.id, row]),
        )
        const keep: typeof rows = []

        for (const row of rows) {
          const local = mine.get(row.id)
          if (!local) {
            keep.push(row)
            continue
          }

          const verdict = reconcile(entity, local, row as unknown as SyncMeta)
          if (verdict === 'TAKE_THEIRS') keep.push(row)
          else if (verdict === 'CONFLICT') {
            conflicts.push({
              id: newId(now),
              entity,
              entityId: row.id,
              localPayload: local,
              serverPayload: row,
              localVersion: local.version ?? 0,
              serverVersion: (row as unknown as SyncMeta).version ?? 0,
              detectedAt: now,
              resolvedAt: null,
              resolution: null,
              resolvedBy: null,
            })
            skipped += 1
          } else skipped += 1
        }

        toWrite = keep
      }

      if (toWrite.length > 0) {
        await table.bulkPut(toWrite as unknown as Array<{ id: string }>)
        written += toWrite.length
        if (input.sync === 'PUSH') {
          await db.outbox.bulkPut(toWrite.map((row) => outboxRowFor(entity, row, now)))
          queued += toWrite.length
        }
      }
    })
  }

  // Anything the two devices disagreed about is parked for a person to settle,
  // never guessed at. The sync screen already knows how to show these.
  if (conflicts.length > 0) await db.conflicts.bulkPut(conflicts)

  const settings = ((await db.settings.toArray()) as BusinessSettings[]).find(
    (row) => row.deletedAt === null,
  )
  const nextReceiptNumber = await recomputeCounters(settings)

  // The migration list belongs to the data, not to the device, so the restored
  // rows get exactly the migrations they have not already had. Unknown ids from
  // a newer build are dropped rather than blocking migrations this build owns.
  const knownIds = new Set(knownMigrationIds())
  const carried = Array.isArray(inspection.manifest.migrationsApplied)
    ? inspection.manifest.migrationsApplied.filter((id) => knownIds.has(id))
    : []
  if (mode === 'REPLACE') {
    await writeMeta(META_KEYS.migrationsApplied, carried)
  }

  if (input.sync === 'STANDALONE') {
    // Nothing restored can ever be pushed, which is the point: this device is
    // being used to look at old data, not to re-assert it over a live shop.
    await syncEngine.forgetServer()
  } else {
    // The device now holds a different set of records than the server last
    // told it about, so it must ask again from the beginning rather than carry
    // on from a cursor describing a database that no longer exists. The engine
    // caches the cursor in memory at start(), so only the reload below makes
    // this take effect.
    await writeMeta(META_KEYS.cursor, 0)
  }

  // Whatever the file said, this device is set up now - otherwise the next
  // boot would seed a fresh starter menu straight over the restored one.
  if ((tables.settings?.length ?? 0) > 0 || (tables.products?.length ?? 0) > 0) {
    await writeMeta(META_KEYS.seeded, true)
  }

  // Written after the restore, never before: a REPLACE empties auditLogs, and
  // the entry recording the restore has to survive it.
  await commit(
    [
      created(
        'auditLogs',
        stamp<AuditLog>(
          {
            entityType: 'backup',
            entityId: inspection.manifest.checksum.slice(0, 16),
            action: mode === 'REPLACE' ? 'BACKUP_RESTORED' : 'BACKUP_MERGED',
            userId: user.id,
            before: null,
            after: JSON.stringify({
              takenAt: new Date(inspection.manifest.createdAt).toISOString(),
              fromDevice: inspection.manifest.deviceLabel,
              written,
              skipped,
              server: input.sync,
              nextReceiptNumber,
            }),
            reason: `Restored a backup of ${inspection.manifest.businessName} taken ${new Date(inspection.manifest.createdAt).toLocaleString()}`,
            occurredAt: now,
          },
          now,
        ),
      ),
    ],
    now,
  )

  return { mode, written, skipped, queuedForServer: queued, nextReceiptNumber }
}

/**
 * Which of two versions of the same record should stand.
 *
 * The rules are the ones the server applies, so a shop that swaps files gets
 * the same answers as a shop that syncs properly - and a shop that does both
 * never sees them disagree.
 *
 * With no server to order the changes, the tie-breaks have to be decided from
 * the records alone, and they have to be decided the same way on both devices.
 * Version first, then the clock, then the device id: arbitrary, but identical
 * on both sides, which is the only property that matters. Both tills land on
 * the same record rather than each keeping its own.
 */
type Verdict = 'TAKE_THEIRS' | 'KEEP_MINE' | 'CONFLICT'

export function reconcile(entity: SyncEntity, mine: SyncMeta, theirs: SyncMeta): Verdict {
  const policy = CONFLICT_POLICIES[entity]

  // An immutable fact cannot be edited, so the copy already here is the copy.
  if (policy === 'APPEND_ONLY') return 'KEEP_MINE'

  const mineVersion = mine.version ?? 0
  const theirsVersion = theirs.version ?? 0

  if (policy === 'MANUAL_REVIEW') {
    if (theirsVersion > mineVersion) return 'TAKE_THEIRS'
    if (theirsVersion < mineVersion) return 'KEEP_MINE'
    // Same version, different content: both edited from the same starting
    // point, and nothing in the records says whose edit was meant to win.
    return sameRecord(mine, theirs) ? 'KEEP_MINE' : 'CONFLICT'
  }

  if (theirsVersion !== mineVersion) return theirsVersion > mineVersion ? 'TAKE_THEIRS' : 'KEEP_MINE'

  const mineAt = mine.updatedAt ?? 0
  const theirsAt = theirs.updatedAt ?? 0
  if (theirsAt !== mineAt) return theirsAt > mineAt ? 'TAKE_THEIRS' : 'KEEP_MINE'

  // Two clocks that agree to the millisecond. Pick by device id so both
  // devices pick the same one.
  return (theirs.deviceId ?? '') > (mine.deviceId ?? '') ? 'TAKE_THEIRS' : 'KEEP_MINE'
}

function sameRecord(a: SyncMeta, b: SyncMeta): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
