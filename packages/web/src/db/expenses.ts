import type { AuditLog, ExpenseCategory, Money, OperatingExpense } from '@pos/shared'
import { db } from './database.ts'
import { commit, created, revise, stamp } from './write.ts'
import type { DateRange } from './analytics.ts'

/**
 * What it costs to keep the doors open.
 *
 * Gross profit is the number a coffee shop is proudest of and the one that
 * says least: it stops before rent, wages and everything else that actually
 * leaves the bank. Recording those here is what lets the reports carry on to
 * the figure the owner takes home.
 */

/** The built-in names. A shop code with no entry reads as itself. */
export function expenseLabel(category: ExpenseCategory): string {
  return EXPENSE_LABELS[category] ?? category
}

export const EXPENSE_LABELS: Record<string, string> = {
  PAYROLL: 'Staff pay',
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  SUPPLIES: 'Supplies',
  MAINTENANCE: 'Maintenance',
  TRANSPORT: 'Transport',
  MARKETING: 'Marketing',
  FEES: 'Fees and charges',
  OTHER: 'Other',
}

/** Overhead that arrives whether or not anyone buys a coffee. */
export const FIXED_BY_DEFAULT: ReadonlySet<ExpenseCategory> = new Set<ExpenseCategory>([
  'RENT',
  'PAYROLL',
  'FEES',
])

export async function recordExpense(input: {
  category: ExpenseCategory
  label: string
  amount: Money
  kind: 'FIXED' | 'VARIABLE'
  staffId?: string | null
  note?: string
  occurredAt: number
  userId: string
}): Promise<OperatingExpense> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Enter what it cost.')
  }

  const now = Date.now()
  const expense = stamp<OperatingExpense>({
    category: input.category,
    label: input.label.trim() || expenseLabel(input.category),
    amount: Math.round(input.amount),
    kind: input.kind,
    staffId: input.staffId ?? null,
    note: (input.note ?? '').trim(),
    occurredAt: input.occurredAt,
    userId: input.userId,
  })

  await commit(
    [
      created('operatingExpenses', expense),
      created(
        'auditLogs',
        stamp<AuditLog>({
          entityType: 'operatingExpenses',
          entityId: expense.id,
          action: 'EXPENSE_RECORDED',
          userId: input.userId,
          before: null,
          after: JSON.stringify({ category: expense.category, amount: expense.amount }),
          reason: expense.label,
          occurredAt: now,
        }),
      ),
    ],
    now,
  )
  return expense
}

/** Remove an expense entered by mistake. Tombstoned, so the removal syncs. */
export async function removeExpense(input: {
  expense: OperatingExpense
  userId: string
  reason: string
}): Promise<void> {
  const now = Date.now()
  const removed = revise(input.expense, { deletedAt: now }, now)

  await commit(
    [
      { entity: 'operatingExpenses', record: removed, op: 'DELETE' },
      created(
        'auditLogs',
        stamp<AuditLog>({
          entityType: 'operatingExpenses',
          entityId: input.expense.id,
          action: 'EXPENSE_REMOVED',
          userId: input.userId,
          before: JSON.stringify({ label: input.expense.label, amount: input.expense.amount }),
          after: null,
          reason: input.reason,
          occurredAt: now,
        }),
      ),
    ],
    now,
  )
}

export async function expensesIn(range: DateRange): Promise<OperatingExpense[]> {
  const rows = await db.operatingExpenses
    .where('occurredAt')
    .between(range.from, range.to, true, true)
    .toArray()
  return rows.filter((row) => row.deletedAt === null).sort((a, b) => b.occurredAt - a.occurredAt)
}

// ------------------------------------------------------------------- the P&L --

export interface ProfitAndLoss {
  /** What customers actually paid, net of refunds. */
  grossSales: Money
  tax: Money
  /** Sales excluding the tax collected on behalf of the government. */
  netSales: Money
  /** Ingredients and packaging consumed, at the cost they were sold at. */
  costOfGoods: Money
  grossProfit: Money
  grossMarginPercent: number

  payroll: Money
  otherExpenses: Money
  totalExpenses: Money
  byCategory: Array<{ category: ExpenseCategory; label: string; amount: Money }>

  /** What is actually left. */
  netProfit: Money
  netMarginPercent: number

  /**
   * True when some of the sales in this period were entered as a lump sum, so
   * their cost of goods is unknown and the gross profit line is incomplete.
   */
  hasUncostedSales: boolean
  uncostedSales: Money
}

export function buildProfitAndLoss(input: {
  grossSales: Money
  tax: Money
  costOfGoods: Money
  /** Sales whose cost of goods is unknown, e.g. a backfilled day. */
  uncostedSales: Money
  expenses: OperatingExpense[]
}): ProfitAndLoss {
  const netSales = input.grossSales - input.tax
  const grossProfit = netSales - input.costOfGoods

  const totals = new Map<ExpenseCategory, Money>()
  for (const expense of input.expenses) {
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount)
  }

  const payroll = totals.get('PAYROLL') ?? 0
  const totalExpenses = [...totals.values()].reduce((sum, amount) => sum + amount, 0)
  const netProfit = grossProfit - totalExpenses

  return {
    grossSales: input.grossSales,
    tax: input.tax,
    netSales,
    costOfGoods: input.costOfGoods,
    grossProfit,
    grossMarginPercent: netSales > 0 ? (grossProfit / netSales) * 100 : 0,
    payroll,
    otherExpenses: totalExpenses - payroll,
    totalExpenses,
    byCategory: [...totals.entries()]
      .map(([category, amount]) => ({ category, label: expenseLabel(category), amount }))
      .sort((a, b) => b.amount - a.amount),
    netProfit,
    netMarginPercent: netSales > 0 ? (netProfit / netSales) * 100 : 0,
    hasUncostedSales: input.uncostedSales > 0,
    uncostedSales: input.uncostedSales,
  }
}
