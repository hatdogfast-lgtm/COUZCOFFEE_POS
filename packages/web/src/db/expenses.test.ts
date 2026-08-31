import { beforeEach, describe, expect, test } from 'vitest'
import { fromDecimal, type OperatingExpense } from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { buildProfitAndLoss, expensesIn, recordExpense, removeExpense } from './expenses.ts'
import { resolveRange } from './analytics.ts'

/**
 * Running costs and the profit that survives them.
 *
 * The figure this produces is the one an owner actually plans around, so the
 * tests care most about it not being flattered: payroll counted, a backfilled
 * day flagged rather than silently treated as pure profit, and a removed cost
 * genuinely gone.
 */

const USER = 'OWNER-1'

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()
}

beforeEach(reset)

describe('the statement', () => {
  const base = { grossSales: fromDecimal(14181), tax: 0, costOfGoods: fromDecimal(4590.61), uncostedSales: 0 }

  test('runs sales down to what is actually left', () => {
    const pnl = buildProfitAndLoss({
      ...base,
      expenses: [
        { category: 'PAYROLL', amount: fromDecimal(5760) } as OperatingExpense,
        { category: 'RENT', amount: fromDecimal(2000) } as OperatingExpense,
      ],
    })

    expect(pnl.netSales).toBe(fromDecimal(14181))
    expect(pnl.grossProfit).toBe(fromDecimal(14181) - fromDecimal(4590.61))
    expect(pnl.payroll).toBe(fromDecimal(5760))
    expect(pnl.totalExpenses).toBe(fromDecimal(7760))
    // Gross profit less every running cost.
    expect(pnl.netProfit).toBe(pnl.grossProfit - fromDecimal(7760))
  })

  test('takes tax out before working out any profit', () => {
    const pnl = buildProfitAndLoss({
      grossSales: fromDecimal(112),
      tax: fromDecimal(12),
      costOfGoods: fromDecimal(40),
      uncostedSales: 0,
      expenses: [],
    })
    // Tax was collected for the government, so it is never anybody's profit.
    expect(pnl.netSales).toBe(fromDecimal(100))
    expect(pnl.grossProfit).toBe(fromDecimal(60))
    expect(pnl.netProfit).toBe(fromDecimal(60))
  })

  test('reports a loss plainly rather than clamping at zero', () => {
    const pnl = buildProfitAndLoss({
      grossSales: fromDecimal(1000),
      tax: 0,
      costOfGoods: fromDecimal(400),
      uncostedSales: 0,
      expenses: [{ category: 'RENT', amount: fromDecimal(900) } as OperatingExpense],
    })
    expect(pnl.netProfit).toBe(fromDecimal(-300))
    expect(pnl.netMarginPercent).toBeLessThan(0)
  })

  test('groups costs by category, largest first', () => {
    const pnl = buildProfitAndLoss({
      ...base,
      expenses: [
        { category: 'UTILITIES', amount: fromDecimal(500) } as OperatingExpense,
        { category: 'PAYROLL', amount: fromDecimal(5760) } as OperatingExpense,
        { category: 'UTILITIES', amount: fromDecimal(300) } as OperatingExpense,
      ],
    })
    expect(pnl.byCategory[0]?.category).toBe('PAYROLL')
    expect(pnl.byCategory[1]?.amount).toBe(fromDecimal(800))
  })

  test('flags sales whose cost of goods is unknown', () => {
    const pnl = buildProfitAndLoss({ ...base, uncostedSales: fromDecimal(4500), expenses: [] })
    // Backfilled days carry no cost, so gross profit here is overstated and
    // the statement has to say so rather than quietly present it as earned.
    expect(pnl.hasUncostedSales).toBe(true)
    expect(pnl.uncostedSales).toBe(fromDecimal(4500))
  })

  test('an empty period reports zeroes, not NaN', () => {
    const pnl = buildProfitAndLoss({ grossSales: 0, tax: 0, costOfGoods: 0, uncostedSales: 0, expenses: [] })
    expect(pnl.netProfit).toBe(0)
    expect(pnl.grossMarginPercent).toBe(0)
    expect(pnl.netMarginPercent).toBe(0)
  })
})

describe('recording a cost', () => {
  test('is saved, audited and queued for the server', async () => {
    const expense = await recordExpense({
      category: 'RENT',
      label: 'August rent',
      amount: fromDecimal(2000),
      kind: 'FIXED',
      occurredAt: Date.now(),
      userId: USER,
    })

    expect(expense.amount).toBe(fromDecimal(2000))
    expect(expense.kind).toBe('FIXED')

    const audit = await db.auditLogs.where('entityId').equals(expense.id).toArray()
    expect(audit[0]?.action).toBe('EXPENSE_RECORDED')

    const queued = await db.outbox.toArray()
    expect(queued.some((entry) => entry.entity === 'operatingExpenses')).toBe(true)
  })

  test('refuses an amount of nothing', async () => {
    await expect(
      recordExpense({ category: 'RENT', label: '', amount: 0, kind: 'FIXED', occurredAt: Date.now(), userId: USER }),
    ).rejects.toThrow(/what it cost/i)
  })

  test('falls back to the category name when nothing is typed', async () => {
    const expense = await recordExpense({
      category: 'UTILITIES', label: '  ', amount: fromDecimal(500), kind: 'VARIABLE',
      occurredAt: Date.now(), userId: USER,
    })
    expect(expense.label).toBe('Utilities')
  })

  test('payroll can name the person it was for', async () => {
    const expense = await recordExpense({
      category: 'PAYROLL', label: 'Week 1', amount: fromDecimal(3000), kind: 'FIXED',
      staffId: 'USER-MIA', occurredAt: Date.now(), userId: USER,
    })
    expect(expense.staffId).toBe('USER-MIA')
  })

  test('only costs inside the period are counted', async () => {
    const day = 24 * 60 * 60 * 1000
    await recordExpense({
      category: 'RENT', label: 'Today', amount: fromDecimal(100), kind: 'FIXED',
      occurredAt: Date.now(), userId: USER,
    })
    await recordExpense({
      category: 'RENT', label: 'Last week', amount: fromDecimal(999), kind: 'FIXED',
      occurredAt: Date.now() - 7 * day, userId: USER,
    })

    const today = await expensesIn(resolveRange('TODAY'))
    expect(today).toHaveLength(1)
    expect(today[0]?.label).toBe('Today')
  })

  test('a removed cost stops counting but leaves a trail', async () => {
    const expense = await recordExpense({
      category: 'SUPPLIES', label: 'Wrong entry', amount: fromDecimal(250), kind: 'VARIABLE',
      occurredAt: Date.now(), userId: USER,
    })

    await removeExpense({ expense, userId: USER, reason: 'Entered twice' })

    expect(await expensesIn(resolveRange('TODAY'))).toHaveLength(0)
    // Tombstoned rather than erased, so the removal reaches the other tills.
    const stored = await db.operatingExpenses.get(expense.id)
    expect(stored?.deletedAt).not.toBeNull()

    const audit = await db.auditLogs.where('entityId').equals(expense.id).toArray()
    expect(audit.some((entry) => entry.action === 'EXPENSE_REMOVED')).toBe(true)
  })
})
