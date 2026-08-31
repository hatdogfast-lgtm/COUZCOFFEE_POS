import type { ModifierGroup, ModifierOption, Product } from '@pos/shared'
import { db, META_KEYS, readMeta, writeMeta } from './database.ts'
import { seedShopLists } from './shopLists.ts'
import { commit, deleted, revise, updated } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * One-off data changes.
 *
 * These run once per device and record that they have, so reinstalling or
 * syncing does not repeat them. They go through the ordinary write path rather
 * than touching tables directly, so every change they make is versioned,
 * tombstoned where appropriate, and queued for the server exactly like a
 * change someone made by hand.
 *
 * Keep them few, and keep them additive or clearly reversible. A migration
 * that silently reinterprets existing data is how books stop adding up.
 *
 * Every migration must also be safe to run twice. Restore carries the applied
 * list in the backup file and puts it back with the data it describes, so a
 * migration can legitimately be replayed against data that has not seen it.
 */

const APPLIED_KEY = META_KEYS.migrationsApplied

interface Migration {
  id: string
  describe: string
  run: () => Promise<PendingWrite[]>
}

/**
 * Remove the Sweetness modifier from the starter menu.
 *
 * Requested by the owner: the shop does not offer sweetness levels, so the
 * choice was noise on every drink. The group and its options are tombstoned
 * rather than erased, so the removal travels to the other tills, and any sale
 * already recorded against one of those options keeps its own snapshot of what
 * was chosen.
 */
const removeSweetness: Migration = {
  id: '2026-08-30-remove-sweetness',
  describe: 'Remove the Sweetness modifier',
  run: async () => {
    const writes: PendingWrite[] = []
    const now = Date.now()

    const groups = await db.modifierGroups.toArray()
    const targets = groups.filter(
      (group) => group.deletedAt === null && group.name.trim().toLowerCase() === 'sweetness',
    )
    if (targets.length === 0) return writes

    const targetIds = new Set(targets.map((group) => group.id))

    for (const group of targets) {
      writes.push(deleted('modifierGroups', revise(group, { deletedAt: now } as Partial<ModifierGroup>, now)))
    }

    const options = await db.modifierOptions.toArray()
    for (const option of options) {
      if (option.deletedAt !== null || !targetIds.has(option.groupId)) continue
      writes.push(
        deleted('modifierOptions', revise(option, { deletedAt: now } as Partial<ModifierOption>, now)),
      )
    }

    // Products must stop asking for a group that no longer exists.
    const products = await db.products.toArray()
    for (const product of products) {
      if (product.deletedAt !== null) continue
      const kept = (product.modifierGroupIds ?? []).filter((id) => !targetIds.has(id))
      if (kept.length === (product.modifierGroupIds ?? []).length) continue
      writes.push(updated('products', revise(product, { modifierGroupIds: kept } as Partial<Product>, now)))
    }

    return writes
  },
}

const MIGRATIONS: Migration[] = [removeSweetness]

/** The ids this build knows about, so a restore can only replay real ones. */
export function knownMigrationIds(): string[] {
  return MIGRATIONS.map((migration) => migration.id)
}

export async function appliedMigrationIds(): Promise<string[]> {
  return readMeta<string[]>(APPLIED_KEY, [])
}

/**
 * Apply anything not yet applied on this device.
 *
 * Failure is deliberately not fatal: a migration that cannot run must never
 * stop the till from opening. It is logged and retried on the next start.
 */
export async function runDataMigrations(): Promise<void> {
  // The shop's own lists come first: they are what the rest of the app reads
  // names out of, and seeding them is safe to repeat, so it is not tracked as
  // a one-shot migration. A shop that renamed something keeps its name.
  try {
    await seedShopLists()
  } catch (error) {
    console.warn('[migration] the shop lists could not be seeded; will try again next start', error)
  }

  const applied = new Set(await readMeta<string[]>(APPLIED_KEY, []))

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue
    try {
      const writes = await migration.run()
      if (writes.length > 0) {
        await commit(writes)
        console.info(`[migration] ${migration.describe} — ${writes.length} records changed`)
      }
      applied.add(migration.id)
      await writeMeta(APPLIED_KEY, [...applied])
    } catch (error) {
      console.warn(`[migration] ${migration.id} could not run; will try again next start`, error)
    }
  }
}
