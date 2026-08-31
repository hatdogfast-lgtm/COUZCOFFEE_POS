import type { Shift, User } from '@pos/shared'
import { db } from '../db/database.ts'
import { commit, created, stamp } from '../db/write.ts'

/**
 * Shifts.
 *
 * A sale must always belong to one, so that cash reconciliation and the X and
 * Z readings have something to add up. If a cashier starts selling without
 * having formally opened a register, one is opened for them rather than
 * blocking the queue - the reading will still balance.
 */

export async function findOpenShift(): Promise<Shift | null> {
  const open = await db.shifts.where('status').equals('OPEN').toArray()
  return open.filter((shift) => shift.deletedAt === null).sort((a, b) => b.openedAt - a.openedAt)[0] ?? null
}

export async function openShift(user: User, openingFloat = 0): Promise<Shift> {
  const existing = await findOpenShift()
  if (existing) return existing

  const now = new Date()
  const code = `S-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`

  const shift = stamp<Shift>({
    code,
    status: 'OPEN',
    openedBy: user.id,
    openedAt: Date.now(),
    closedBy: null,
    closedAt: null,
    openingFloat,
    countedCash: null,
    expectedCash: null,
    variance: null,
    varianceReason: '',
    note: '',
  })

  await commit([created('shifts', shift)])
  return shift
}

/** Guarantees a shift exists for a sale about to be committed. */
export async function ensureShift(user: User): Promise<Shift> {
  return (await findOpenShift()) ?? (await openShift(user))
}
