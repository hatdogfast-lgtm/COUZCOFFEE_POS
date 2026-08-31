import type { AuditLog, BusinessSettings, FundAllocation, Money, SalesTarget } from '@pos/shared'
import { hashSecret, verifySecret } from '@pos/shared'
import { db } from './database.ts'
import { commit, created, revise, stamp, updated } from './write.ts'
import { isRefund } from './ledger.ts'

/**
 * The sales target and what the money is spoken for.
 *
 * A target on its own is a wish. What makes it useful is deciding in advance
 * where each peso goes - stock, wages, a reserve - so that a good month is
 * not quietly spent before anyone notices. Shares are held as percentages, so
 * raising the target raises every set-aside with it and the plan stays whole.
 */

export const DEFAULT_ALLOCATIONS: FundAllocation[] = [
  { id: 'stock', label: 'Stock and supplies', percent: 35 },
  { id: 'salaries', label: 'Staff salaries', percent: 25 },
  { id: 'reserve', label: 'Emergency reserve', percent: 10 },
  { id: 'growth', label: 'Improvements and equipment', percent: 10 },
]

const alive = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null)

/** The month a date falls in, as YYYY-MM. */
export function periodKeyFor(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function periodLabel(key: string): string {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return key
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** Shifts a period key by whole months, so the arrows never land on month 13. */
export function shiftPeriod(key: string, months: number): string {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return key
  return periodKeyFor(new Date(year, month - 1 + months, 1))
}

/** The first and last instant of a period, for adding up what actually sold. */
export function periodRange(key: string): { from: number; to: number } {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return { from: 0, to: 0 }
  return {
    from: new Date(year, month - 1, 1, 0, 0, 0, 0).getTime(),
    to: new Date(year, month, 0, 23, 59, 59, 999).getTime(),
  }
}

export async function loadTarget(periodKey: string): Promise<SalesTarget | null> {
  const rows = alive(await db.salesTargets.toArray())
  return rows.find((row) => row.periodKey === periodKey) ?? null
}

export async function listTargets(): Promise<SalesTarget[]> {
  const rows = alive(await db.salesTargets.toArray())
  return rows.sort((a, b) => b.periodKey.localeCompare(a.periodKey))
}

export async function saveTarget(input: {
  periodKey: string
  targetSales: Money
  allocations: FundAllocation[]
  note?: string
  userId: string
}): Promise<SalesTarget> {
  const targetSales = Math.round(input.targetSales)
  if (!Number.isFinite(targetSales) || targetSales < 0) throw new Error('Enter a target.')

  const allocations = normaliseAllocations(input.allocations)
  const share = allocations.reduce((total, entry) => total + entry.percent, 0)
  if (share > 100) throw new Error('The set-asides add up to more than the whole target.')

  const now = Date.now()
  const existing = await loadTarget(input.periodKey)

  const record = existing
    ? revise<SalesTarget>(existing, { targetSales, allocations, note: input.note?.trim() ?? existing.note }, now)
    : stamp<SalesTarget>(
        {
          periodKey: input.periodKey,
          targetSales,
          allocations,
          note: input.note?.trim() ?? '',
        },
        now,
      )

  await commit(
    [
      existing ? updated('salesTargets', record) : created('salesTargets', record),
      created(
        'auditLogs',
        stamp<AuditLog>(
          {
            entityType: 'salesTargets',
            entityId: record.id,
            action: existing ? 'TARGET_UPDATED' : 'TARGET_SET',
            userId: input.userId,
            before: existing ? JSON.stringify({ targetSales: existing.targetSales }) : null,
            after: JSON.stringify({ targetSales }),
            reason: `Target for ${input.periodKey}`,
            occurredAt: now,
          },
          now,
        ),
      ),
    ],
    now,
  )

  return record
}

/** Drops blank rows and keeps percentages inside sane bounds. */
export function normaliseAllocations(allocations: FundAllocation[]): FundAllocation[] {
  return allocations
    .map((entry) => ({
      id: entry.id,
      label: entry.label.trim(),
      percent: Math.max(0, Math.min(100, Number(entry.percent) || 0)),
    }))
    .filter((entry) => entry.label.length > 0)
}

export interface PlanRow {
  id: string
  label: string
  percent: number
  /** The share of the target this set-aside is worth. */
  planned: Money
  /** The same share of what has actually come in so far. */
  earned: Money
}

export interface Plan {
  periodKey: string
  targetSales: Money
  actualSales: Money
  orders: number
  /** How much of the target has been met, as a fraction that can exceed one. */
  progress: number
  remaining: Money
  rows: PlanRow[]
  allocatedPercent: number
  /** What is left once every set-aside has taken its share. */
  unallocatedPercent: number
  unallocatedPlanned: Money
  unallocatedEarned: Money
  daysElapsed: number
  daysInPeriod: number
  /** What must come in per remaining day to still land on the target. */
  neededPerRemainingDay: Money
  /** Where the month lands if the current daily rate holds to the end. */
  projected: Money
}

const shareOf = (amount: Money, percent: number): Money => Math.round((amount * percent) / 100)

export function buildPlan(input: {
  periodKey: string
  targetSales: Money
  allocations: FundAllocation[]
  actualSales: Money
  orders: number
  now?: number
}): Plan {
  const { from, to } = periodRange(input.periodKey)
  const now = input.now ?? Date.now()
  const daysInPeriod = Math.max(1, Math.round((to - from) / 86_400_000))
  const elapsedMs = Math.min(Math.max(0, now - from), to - from)
  const daysElapsed = Math.min(daysInPeriod, Math.max(0, Math.floor(elapsedMs / 86_400_000) + 1))
  const daysLeft = Math.max(0, daysInPeriod - daysElapsed)

  const allocations = normaliseAllocations(input.allocations)
  const allocatedPercent = allocations.reduce((total, entry) => total + entry.percent, 0)
  const unallocatedPercent = Math.max(0, 100 - allocatedPercent)
  const remaining = Math.max(0, input.targetSales - input.actualSales)

  return {
    periodKey: input.periodKey,
    targetSales: input.targetSales,
    actualSales: input.actualSales,
    orders: input.orders,
    progress: input.targetSales > 0 ? input.actualSales / input.targetSales : 0,
    remaining,
    rows: allocations.map((entry) => ({
      id: entry.id,
      label: entry.label,
      percent: entry.percent,
      planned: shareOf(input.targetSales, entry.percent),
      earned: shareOf(input.actualSales, entry.percent),
    })),
    allocatedPercent,
    unallocatedPercent,
    unallocatedPlanned: shareOf(input.targetSales, unallocatedPercent),
    unallocatedEarned: shareOf(input.actualSales, unallocatedPercent),
    daysElapsed,
    daysInPeriod,
    neededPerRemainingDay: daysLeft > 0 ? Math.round(remaining / daysLeft) : remaining,
    projected: daysElapsed > 0 ? Math.round((input.actualSales / daysElapsed) * daysInPeriod) : 0,
  }
}

/** What has actually been taken in a period, refunds netted out and voids ignored. */
export async function actualSalesFor(periodKey: string): Promise<{ sales: Money; orders: number }> {
  const { from, to } = periodRange(periodKey)
  const rows = await db.sales.where('occurredAt').between(from, to, true, true).toArray()
  const live = alive(rows).filter((sale) => sale.status !== 'VOIDED')
  return {
    sales: live.reduce((total, sale) => total + sale.total, 0),
    orders: live.filter((sale) => !isRefund(sale)).length,
  }
}

// ------------------------------------------------------------------- lock --

/**
 * The planner can carry its own passcode on top of the role that reaches it.
 *
 * The role decides who may open the screen at all; this is for the shop where
 * the owner is signed in on a shared till and does not want the month's plan
 * readable by whoever walks past it. It is stored hashed, so a passcode that
 * is forgotten is gone rather than recoverable.
 */

export async function loadSettings(): Promise<BusinessSettings | null> {
  const rows = alive(await db.settings.toArray())
  return rows[0] ?? null
}

export async function plannerIsLocked(): Promise<boolean> {
  const settings = await loadSettings()
  return Boolean(settings?.plannerPasscodeHash)
}

export async function unlockPlanner(passcode: string): Promise<boolean> {
  const settings = await loadSettings()
  const stored = settings?.plannerPasscodeHash
  if (!stored) return true
  return verifySecret(passcode, stored)
}

export async function setPlannerPasscode(input: {
  passcode: string
  current?: string
  userId: string
}): Promise<void> {
  const settings = await loadSettings()
  if (!settings) throw new Error('Settings are not ready yet.')

  if (settings.plannerPasscodeHash && !(await verifySecret(input.current ?? '', settings.plannerPasscodeHash))) {
    throw new Error('That is not the current passcode.')
  }
  if (input.passcode.trim().length < 4) throw new Error('Use at least four characters.')

  await writePasscode(settings, await hashSecret(input.passcode.trim()), input.userId, 'PLANNER_LOCKED')
}

export async function removePlannerPasscode(input: { current: string; userId: string }): Promise<void> {
  const settings = await loadSettings()
  if (!settings) throw new Error('Settings are not ready yet.')
  if (!settings.plannerPasscodeHash) return
  if (!(await verifySecret(input.current, settings.plannerPasscodeHash))) {
    throw new Error('That is not the current passcode.')
  }

  await writePasscode(settings, null, input.userId, 'PLANNER_UNLOCKED')
}

async function writePasscode(
  settings: BusinessSettings,
  hash: string | null,
  userId: string,
  action: string,
): Promise<void> {
  const now = Date.now()
  const next = revise<BusinessSettings>(settings, { plannerPasscodeHash: hash }, now)

  await commit(
    [
      updated('settings', next),
      created(
        'auditLogs',
        stamp<AuditLog>(
          {
            entityType: 'settings',
            entityId: settings.id,
            action,
            userId,
            // The passcode itself is never written to the trail, only that it changed.
            before: null,
            after: null,
            reason: hash ? 'Planner passcode set' : 'Planner passcode removed',
            occurredAt: now,
          },
          now,
        ),
      ),
    ],
    now,
  )
}
