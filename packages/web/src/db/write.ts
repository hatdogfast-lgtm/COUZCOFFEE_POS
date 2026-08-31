import type { Table } from 'dexie'
import {
  newId,
  type OutboxEntry,
  type SyncEntity,
  type SyncMeta,
  type SyncOp,
} from '@pos/shared'
import { db, tableFor } from './database.ts'
import { deviceId } from './identity.ts'
import { notifyOutboxChanged } from '../sync/pending.ts'

/**
 * The only sanctioned way to change local data.
 *
 * Each write puts the record and its outbox entry inside a single IndexedDB
 * transaction. That is what makes the guarantee in the brief real: a sale is
 * either fully recorded *and* queued for the server, or neither happened.
 * There is no window in which a completed sale exists locally but will never
 * be sent, and none in which it is queued but not stored.
 */

export type NewRecord<T extends SyncMeta> = Omit<T, keyof SyncMeta> & Partial<Pick<SyncMeta, 'id' | 'createdAt'>>

/** Attach sync metadata to a brand-new record. */
export function stamp<T extends SyncMeta>(fields: NewRecord<T>, now = Date.now()): T {
  const { id, createdAt, ...rest } = fields as NewRecord<T> & { id?: string; createdAt?: number }
  return {
    ...(rest as object),
    id: id ?? newId(now),
    deviceId: deviceId(),
    createdAt: createdAt ?? now,
    updatedAt: now,
    version: 1,
    deletedAt: null,
  } as T
}

/** Advance a record for an edit: bump the version, restamp the device. */
export function revise<T extends SyncMeta>(record: T, changes: Partial<T>, now = Date.now()): T {
  return {
    ...record,
    ...changes,
    id: record.id,
    createdAt: record.createdAt,
    deviceId: deviceId(),
    updatedAt: now,
    version: record.version + 1,
  }
}

function outboxEntry(entity: SyncEntity, record: SyncMeta, op: SyncOp, now: number): OutboxEntry {
  return {
    id: newId(now),
    entity,
    entityId: record.id,
    op,
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

/** One change destined for both the local table and the outbox. */
export interface PendingWrite<T extends SyncMeta = SyncMeta> {
  entity: SyncEntity
  record: T
  op: SyncOp
}

export function created<T extends SyncMeta>(entity: SyncEntity, record: T): PendingWrite<T> {
  return { entity, record, op: 'CREATE' }
}

export function updated<T extends SyncMeta>(entity: SyncEntity, record: T): PendingWrite<T> {
  return { entity, record, op: 'UPDATE' }
}

/**
 * A tombstoned record. The row is still written - what travels is the fact
 * that it is gone, which a hard delete could never carry to another device.
 */
export function deleted<T extends SyncMeta>(entity: SyncEntity, record: T): PendingWrite<T> {
  return { entity, record, op: 'DELETE' }
}

function tablesFor(writes: PendingWrite[]): Table<unknown, string>[] {
  const names = new Set(writes.map((write) => write.entity))
  const tables = [...names].map((entity) => tableFor(entity) as unknown as Table<unknown, string>)
  return [...tables, db.outbox as unknown as Table<unknown, string>]
}

/**
 * Commit a set of changes atomically.
 *
 * A completed sale is a dozen rows across seven tables - the sale, its lines,
 * its discounts, its payments, the stock movements it caused, and the audit
 * entry. They go in together or not at all, so the books can never be left
 * describing half a transaction.
 */
export async function commit(writes: PendingWrite[], now = Date.now()): Promise<void> {
  if (writes.length === 0) return

  await db.transaction('rw', tablesFor(writes), async () => {
    for (const write of writes) {
      await tableFor(write.entity).put(write.record as { id: string })
      await db.outbox.put(outboxEntry(write.entity, write.record, write.op, now))
    }
  })

  // The transaction has committed, so the work is safe whatever happens next.
  // Only now do we nudge the sync engine, and only as a hint - it is free to
  // ignore it, and the sale is complete either way.
  notifyOutboxChanged()
}

/** Create one record and queue it. */
export async function create<T extends SyncMeta>(entity: SyncEntity, fields: NewRecord<T>): Promise<T> {
  const record = stamp<T>(fields)
  await commit([created(entity, record)])
  return record
}

/** Apply changes to one record and queue the new version. */
export async function update<T extends SyncMeta>(
  entity: SyncEntity,
  id: string,
  changes: Partial<T>,
): Promise<T> {
  const existing = (await tableFor(entity).get(id)) as T | undefined
  if (!existing) throw new Error('That record no longer exists on this device.')
  const record = revise(existing, changes)
  await commit([updated(entity, record)])
  return record
}

/**
 * Soft-delete. A tombstone can travel to other devices; a hard delete cannot,
 * and would silently reappear on the next pull from a device that still had it.
 */
export async function remove<T extends SyncMeta>(entity: SyncEntity, id: string): Promise<void> {
  const existing = (await tableFor(entity).get(id)) as T | undefined
  if (!existing) return
  const now = Date.now()
  const record = revise(existing, { deletedAt: now } as Partial<T>, now)
  await commit([{ entity, record, op: 'DELETE' }], now)
}

/**
 * Write a record that arrived from the server.
 *
 * Deliberately does not touch the outbox: echoing a server change back to the
 * server would loop forever.
 */
export async function applyFromServer(entity: SyncEntity, record: SyncMeta): Promise<void> {
  await tableFor(entity).put(record as { id: string })
}
