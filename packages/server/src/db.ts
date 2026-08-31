import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { CONFLICT_POLICIES, type PullChange, type SyncEntity, type SyncEnvelope, type SyncOp } from '@pos/shared'
import { config, databaseFile } from './config.ts'
import {
  allColumns,
  columnName,
  createIndexSql,
  createTableSql,
  INFRASTRUCTURE_SQL,
  TABLES,
  TABLE_BY_ENTITY,
  type ColumnType,
  type TableSpec,
} from './schema.ts'

/**
 * The central store, on SQLite via Node's built-in driver.
 *
 * SQLite was chosen deliberately: it needs no server process, no native
 * compilation, and no paid hosting. The whole business lives in one file that
 * can be copied, backed up, or moved between machines - which is what makes
 * the "no mandatory hosting cost" requirement real rather than aspirational.
 */

fs.mkdirSync(config.dataDir, { recursive: true })

export const db = new DatabaseSync(databaseFile)

// WAL lets readers (reports, dashboards) run while a device is pushing.
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

for (const spec of TABLES) db.exec(createTableSql(spec))
for (const statement of INFRASTRUCTURE_SQL) db.exec(statement)

/**
 * Bring an existing database up to the current schema.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing for a table that already exists, so
 * a field added to the model would never appear in a database that predates it,
 * and every sync carrying that field would silently drop it. Adding the missing
 * columns is safe to run on every start: SQLite's ADD COLUMN is cheap, and a
 * column that is already there is simply skipped.
 *
 * Only additions are automated. Renaming or dropping a column changes the
 * meaning of data that already exists and is not something to do behind
 * anyone's back.
 */
function addMissingColumns(): void {
  for (const spec of TABLES) {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info("${spec.table}")`).all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    )

    for (const [field, type] of Object.entries(allColumns(spec))) {
      const column = columnName(field)
      if (existing.has(column)) continue

      const sqlType = type === 'REAL' ? 'REAL' : type === 'INTEGER' || type === 'BOOL' ? 'INTEGER' : 'TEXT'
      db.exec(`ALTER TABLE "${spec.table}" ADD COLUMN "${column}" ${sqlType}`)
      console.log(`[server] schema: added ${spec.table}.${column}`)
    }
  }
}
addMissingColumns()

// Only now, once every column certainly exists.
for (const spec of TABLES) {
  for (const statement of createIndexSql(spec)) db.exec(statement)
}

// ------------------------------------------------------------- conversions --

type Row = Record<string, unknown>

/** The only shapes SQLite will accept as a bound parameter. */
type SqlValue = string | number | null

function encodeValue(value: unknown, type: ColumnType): SqlValue {
  if (value === undefined || value === null) return null
  switch (type) {
    case 'BOOL':
      return value ? 1 : 0
    case 'JSON':
      return JSON.stringify(value)
    case 'INTEGER':
      return Math.round(Number(value))
    case 'REAL':
      return Number(value)
    default:
      return typeof value === 'string' ? value : String(value)
  }
}

function decodeValue(value: unknown, type: ColumnType): unknown {
  if (value === null || value === undefined) return type === 'JSON' ? null : null
  switch (type) {
    case 'BOOL':
      return value === 1 || value === true
    case 'JSON':
      try {
        return JSON.parse(String(value))
      } catch {
        return null
      }
    default:
      return value
  }
}

export function rowToEntity(spec: TableSpec, row: Row): Record<string, unknown> {
  const columns = allColumns(spec)
  const out: Record<string, unknown> = {}
  for (const [field, type] of Object.entries(columns)) {
    out[field] = decodeValue(row[columnName(field)], type)
  }
  return out
}

// -------------------------------------------------------- prepared queries --

const upsertStatements = new Map<SyncEntity, ReturnType<DatabaseSync['prepare']>>()
const selectStatements = new Map<SyncEntity, ReturnType<DatabaseSync['prepare']>>()

for (const spec of TABLES) {
  const fields = Object.keys(allColumns(spec))
  const columns = fields.map((field) => `"${columnName(field)}"`)
  const placeholders = fields.map((field) => `$${field}`)
  const assignments = fields
    .filter((field) => field !== 'id')
    .map((field) => `"${columnName(field)}" = excluded."${columnName(field)}"`)

  upsertStatements.set(
    spec.entity,
    db.prepare(
      `INSERT INTO "${spec.table}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})
       ON CONFLICT("id") DO UPDATE SET ${assignments.join(', ')}`,
    ),
  )
  selectStatements.set(spec.entity, db.prepare(`SELECT * FROM "${spec.table}" WHERE "id" = ?`))
}

const insertSyncLog = db.prepare(
  `INSERT INTO "sync_log" ("entity", "entity_id", "op", "version", "origin_device_id", "server_updated_at", "payload")
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const selectMaxSeq = db.prepare(`SELECT COALESCE(MAX("seq"), 0) AS seq FROM "sync_log"`)
const selectChanges = db.prepare(
  `SELECT * FROM "sync_log" WHERE "seq" > ? ORDER BY "seq" ASC LIMIT ?`,
)

export function serverSeq(): number {
  const row = selectMaxSeq.get() as { seq: number } | undefined
  return Number(row?.seq ?? 0)
}

export function getRecord(entity: SyncEntity, id: string): Record<string, unknown> | null {
  const spec = TABLE_BY_ENTITY.get(entity)
  const statement = selectStatements.get(entity)
  if (!spec || !statement) return null
  const row = statement.get(id) as Row | undefined
  return row ? rowToEntity(spec, row) : null
}

// ------------------------------------------------------------ apply changes --

export type ApplyOutcome =
  | { status: 'APPLIED'; seq: number; serverUpdatedAt: number }
  | { status: 'IDEMPOTENT'; seq: number; serverUpdatedAt: number }
  | { status: 'STALE'; serverRecord: Record<string, unknown>; serverVersion: number }
  | { status: 'CONFLICT'; serverRecord: Record<string, unknown>; serverVersion: number }
  | { status: 'INVALID'; message: string }

function writeRecord(spec: TableSpec, payload: Record<string, unknown>): void {
  const columns = allColumns(spec)
  const bound: Record<string, SqlValue> = {}
  for (const [field, type] of Object.entries(columns)) {
    bound[field] = encodeValue(payload[field], type)
  }
  upsertStatements.get(spec.entity)?.run(bound)
}

function appendLog(
  entity: SyncEntity,
  entityId: string,
  op: SyncOp,
  version: number,
  originDeviceId: string,
  payload: unknown,
): { seq: number; serverUpdatedAt: number } {
  const serverUpdatedAt = Date.now()
  const result = insertSyncLog.run(
    entity,
    entityId,
    op,
    version,
    originDeviceId,
    serverUpdatedAt,
    JSON.stringify(payload),
  )
  return { seq: Number(result.lastInsertRowid), serverUpdatedAt }
}

/**
 * Apply one incoming change, deciding what to do when the server already
 * holds a different version of the same record.
 *
 * Immutable facts (a completed sale, a stock movement) can never truly
 * conflict, so a repeat push is absorbed idempotently instead of raising an
 * error. Only mutable records that two people genuinely edited at once are
 * escalated for review, and even then the local record is never discarded -
 * the device keeps it and surfaces the conflict.
 */
export function applyEnvelope(envelope: SyncEnvelope): ApplyOutcome {
  const spec = TABLE_BY_ENTITY.get(envelope.entity)
  if (!spec) return { status: 'INVALID', message: `Unknown entity: ${envelope.entity}` }

  const payload = envelope.payload as Record<string, unknown> | null
  if (!payload || typeof payload !== 'object') {
    return { status: 'INVALID', message: 'Change carried no record' }
  }
  if (payload['id'] !== envelope.entityId) {
    return { status: 'INVALID', message: 'Record id does not match the change it travelled in' }
  }

  const existing = getRecord(envelope.entity, envelope.entityId)
  const policy = CONFLICT_POLICIES[envelope.entity]

  if (existing) {
    const serverVersion = Number(existing['version'] ?? 0)
    const serverUpdated = Number(existing['updatedAt'] ?? 0)
    const incomingUpdated = Number(payload['updatedAt'] ?? envelope.updatedAt)

    // A device re-sending something we already hold. Absorb it quietly.
    if (envelope.version === serverVersion && incomingUpdated === serverUpdated) {
      return { status: 'IDEMPOTENT', seq: serverSeq(), serverUpdatedAt: serverUpdated }
    }

    if (envelope.version <= serverVersion) {
      if (policy === 'MANUAL_REVIEW') {
        return { status: 'CONFLICT', serverRecord: existing, serverVersion }
      }
      if (policy === 'LAST_WRITE_WINS' && incomingUpdated < serverUpdated) {
        return { status: 'STALE', serverRecord: existing, serverVersion }
      }
      // APPEND_ONLY, or a later wall-clock write: let it through.
    }
  }

  writeRecord(spec, payload)
  const { seq, serverUpdatedAt } = appendLog(
    envelope.entity,
    envelope.entityId,
    envelope.op,
    envelope.version,
    envelope.deviceId,
    payload,
  )
  return { status: 'APPLIED', seq, serverUpdatedAt }
}

/** Run a batch of changes as one all-or-nothing unit. */
export function transaction<T>(work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function readChanges(since: number, limit: number): PullChange[] {
  const rows = selectChanges.all(since, limit) as Array<Row>
  return rows.map((row) => ({
    seq: Number(row['seq']),
    entity: String(row['entity']) as SyncEntity,
    entityId: String(row['entity_id']),
    op: String(row['op']) as SyncOp,
    version: Number(row['version']),
    originDeviceId: String(row['origin_device_id']),
    serverUpdatedAt: Number(row['server_updated_at']),
    payload: JSON.parse(String(row['payload'])),
  }))
}

export function countChangesAfter(since: number): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "sync_log" WHERE "seq" > ?`).get(since) as
    | { n: number }
    | undefined
  return Number(row?.n ?? 0)
}

// ----------------------------------------------------------------- metadata --

const upsertMeta = db.prepare(
  `INSERT INTO "meta" ("key", "value") VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`,
)
const selectMeta = db.prepare(`SELECT "value" FROM "meta" WHERE "key" = ?`)

export function setMeta(key: string, value: string): void {
  upsertMeta.run(key, value)
}

export function getMeta(key: string): string | null {
  const row = selectMeta.get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function databasePath(): string {
  return path.resolve(databaseFile)
}
