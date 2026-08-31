import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_LOW_STOCK, DEFAULT_LOYALTY, DEFAULT_STATUTORY_RULES, RECEIPT_SECTIONS, fromDecimal, type BusinessSettings, type Sale } from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import {
  actualSalesFor,
  buildPlan,
  DEFAULT_ALLOCATIONS,
  loadTarget,
  normaliseAllocations,
  periodKeyFor,
  periodRange,
  plannerIsLocked,
  removePlannerPasscode,
  saveTarget,
  setPlannerPasscode,
  shiftPeriod,
  unlockPlanner,
} from './planner.ts'

/**
 * The sales target planner.
 *
 * The arithmetic is simple; what has to hold is that the plan keeps its shape.
 * Shares are percentages, so moving the target moves every set-aside with it,
 * and the passcode has to behave like a passcode - never readable, never
 * removable by someone who does not know it.
 */

const USER = 'U-OWNER'

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()
}

beforeEach(reset)

async function seedSettings(): Promise<BusinessSettings> {
  const settings = stamp<BusinessSettings>({
    branding: { businessName: 'Test', logoDataUrl: '', addressLine: '', contactLine: '' } as never,
    tax: { enabled: true, rate: 12, label: 'VAT', inclusive: true } as never,
    receipt: {} as never,
    queue: {} as never,
    currencyCode: 'PHP',
    currencySymbol: '₱',
    locale: 'en-PH',
    statutoryDiscountRate: 20,
    lowStockWarningEnabled: true,
    blockSaleWhenOutOfStock: true,
    includeLabourInCost: false,
    backdatingEnabled: false,
    requireReferenceFor: [],
    plannerPasscodeHash: null,
    dashboardTiles: {},
    statutoryRules: DEFAULT_STATUTORY_RULES,
    receiptSections: RECEIPT_SECTIONS,
    lowStock: DEFAULT_LOW_STOCK,
    loyalty: DEFAULT_LOYALTY,
  })
  await commit([created('settings', settings)])
  return settings
}

describe('periods', () => {
  test('names a month the way it is stored', () => {
    expect(periodKeyFor(new Date(2026, 7, 30))).toBe('2026-08')
    expect(periodKeyFor(new Date(2026, 0, 1))).toBe('2026-01')
  })

  test('steps across a year boundary without landing on month 13', () => {
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01')
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12')
  })

  test('covers the whole month, first instant to last', () => {
    const { from, to } = periodRange('2026-02')
    expect(new Date(from).getDate()).toBe(1)
    // 2026 is not a leap year, so February ends on the 28th.
    expect(new Date(to).getDate()).toBe(28)
    expect(new Date(to).getMonth()).toBe(1)
  })
})

describe('set-asides', () => {
  const allocations = [
    { id: 'stock', label: 'Stock', percent: 30 },
    { id: 'pay', label: 'Salaries', percent: 25 },
    { id: 'reserve', label: 'Reserve', percent: 10 },
  ]

  test('gives each its share of the target', () => {
    const plan = buildPlan({
      periodKey: '2026-08',
      targetSales: fromDecimal(100_000),
      allocations,
      actualSales: 0,
      orders: 0,
    })

    expect(plan.rows.find((row) => row.id === 'stock')?.planned).toBe(fromDecimal(30_000))
    expect(plan.rows.find((row) => row.id === 'pay')?.planned).toBe(fromDecimal(25_000))
    expect(plan.unallocatedPercent).toBe(35)
    expect(plan.unallocatedPlanned).toBe(fromDecimal(35_000))
  })

  test('also shows the same share of what has actually come in', () => {
    const plan = buildPlan({
      periodKey: '2026-08',
      targetSales: fromDecimal(100_000),
      allocations,
      actualSales: fromDecimal(40_000),
      orders: 200,
    })

    // Only 40% of the target is in, so each set-aside has earned 40% of its share.
    expect(plan.rows.find((row) => row.id === 'stock')?.earned).toBe(fromDecimal(12_000))
    expect(plan.progress).toBeCloseTo(0.4)
    expect(plan.remaining).toBe(fromDecimal(60_000))
  })

  test('keeps its shape when the target moves', () => {
    const small = buildPlan({ periodKey: '2026-08', targetSales: fromDecimal(50_000), allocations, actualSales: 0, orders: 0 })
    const large = buildPlan({ periodKey: '2026-08', targetSales: fromDecimal(200_000), allocations, actualSales: 0, orders: 0 })

    expect(large.rows[0]!.planned).toBe(small.rows[0]!.planned * 4)
    expect(large.allocatedPercent).toBe(small.allocatedPercent)
  })

  test('never reports a negative remainder once the target is beaten', () => {
    const plan = buildPlan({
      periodKey: '2026-08',
      targetSales: fromDecimal(10_000),
      allocations,
      actualSales: fromDecimal(14_000),
      orders: 50,
    })
    expect(plan.remaining).toBe(0)
    expect(plan.progress).toBeGreaterThan(1)
  })

  test('drops unnamed rows and clamps a nonsense percentage', () => {
    const cleaned = normaliseAllocations([
      { id: 'a', label: '  ', percent: 10 },
      { id: 'b', label: 'Stock', percent: 400 },
      { id: 'c', label: 'Rent', percent: -5 },
    ])
    expect(cleaned).toHaveLength(2)
    expect(cleaned[0]!.percent).toBe(100)
    expect(cleaned[1]!.percent).toBe(0)
  })

  test('projects the month from the rate so far', () => {
    const { from } = periodRange('2026-08')
    // Ten days in, with 20,000 taken: the month is on course for about 62,000.
    const plan = buildPlan({
      periodKey: '2026-08',
      targetSales: fromDecimal(60_000),
      allocations: [],
      actualSales: fromDecimal(20_000),
      orders: 100,
      now: from + 9 * 86_400_000,
    })
    expect(plan.daysElapsed).toBe(10)
    expect(plan.daysInPeriod).toBe(31)
    expect(plan.projected).toBe(fromDecimal(62_000))
  })
})

describe('saving a target', () => {
  test('keeps one per month and updates it in place', async () => {
    await saveTarget({
      periodKey: '2026-08',
      targetSales: fromDecimal(80_000),
      allocations: DEFAULT_ALLOCATIONS,
      userId: USER,
    })
    await saveTarget({
      periodKey: '2026-08',
      targetSales: fromDecimal(95_000),
      allocations: DEFAULT_ALLOCATIONS,
      userId: USER,
    })

    expect(await db.salesTargets.count()).toBe(1)
    expect((await loadTarget('2026-08'))?.targetSales).toBe(fromDecimal(95_000))
  })

  test('leaves another month alone', async () => {
    await saveTarget({ periodKey: '2026-07', targetSales: fromDecimal(50_000), allocations: [], userId: USER })
    await saveTarget({ periodKey: '2026-08', targetSales: fromDecimal(90_000), allocations: [], userId: USER })

    expect((await loadTarget('2026-07'))?.targetSales).toBe(fromDecimal(50_000))
  })

  test('refuses set-asides that come to more than the whole target', async () => {
    await expect(
      saveTarget({
        periodKey: '2026-08',
        targetSales: fromDecimal(50_000),
        allocations: [
          { id: 'a', label: 'Stock', percent: 70 },
          { id: 'b', label: 'Pay', percent: 45 },
        ],
        userId: USER,
      }),
    ).rejects.toThrow(/more than the whole target/i)
  })

  test('leaves a trail without recording anything sensitive twice', async () => {
    await saveTarget({ periodKey: '2026-08', targetSales: fromDecimal(80_000), allocations: [], userId: USER })
    const logs = await db.auditLogs.toArray()
    expect(logs.map((log) => log.action)).toContain('TARGET_SET')
  })
})

describe('what has actually come in', () => {
  test('ignores voided sales and nets refunds out', async () => {
    const key = periodKeyFor()
    const { from } = periodRange(key)
    const at = from + 3600_000

    const base = {
      queueNo: '',
      shiftId: 'S-1',
      userId: USER,
      entryMode: 'ITEMISED' as const,
      orderType: 'DINE_IN' as const,
      discountTotal: 0,
      taxTotal: 0,
      taxExemptTotal: 0,
      cogsTotal: 0,
      itemCount: 1,
      customerName: '',
      note: '',
      occurredAt: at,
      voidedAt: null,
      voidedBy: null,
      voidReason: '',
      refundedTotal: 0,
    }

    await commit([
      created(
        'sales',
        stamp<Sale>({ ...base, receiptNo: 'A', status: 'COMPLETED' as const, subtotal: fromDecimal(500), total: fromDecimal(500), refundOfSaleId: null }),
      ),
      created(
        'sales',
        stamp<Sale>({ ...base, receiptNo: 'B', status: 'VOIDED' as const, subtotal: fromDecimal(300), total: fromDecimal(300), refundOfSaleId: null }),
      ),
      created(
        'sales',
        stamp<Sale>({ ...base, receiptNo: 'A-R', status: 'COMPLETED' as const, subtotal: -fromDecimal(100), total: -fromDecimal(100), refundOfSaleId: 'A' }),
      ),
    ])

    const actual = await actualSalesFor(key)
    expect(actual.sales).toBe(fromDecimal(400))
    // The refund is money back out, not a second order.
    expect(actual.orders).toBe(1)
  })
})

describe('the lock', () => {
  test('is open until a passcode is set', async () => {
    await seedSettings()
    expect(await plannerIsLocked()).toBe(false)
    // With no passcode there is nothing to check, so anything gets in.
    expect(await unlockPlanner('')).toBe(true)
  })

  test('lets the right passcode through and turns the wrong one away', async () => {
    await seedSettings()
    await setPlannerPasscode({ passcode: 'coffee2026', userId: USER })

    expect(await plannerIsLocked()).toBe(true)
    expect(await unlockPlanner('coffee2026')).toBe(true)
    expect(await unlockPlanner('coffee2025')).toBe(false)
  })

  test('never stores the passcode in readable form', async () => {
    await seedSettings()
    await setPlannerPasscode({ passcode: 'coffee2026', userId: USER })

    const stored = (await db.settings.toArray())[0]?.plannerPasscodeHash ?? ''
    expect(stored).not.toContain('coffee2026')
    expect(stored.startsWith('pbkdf2$')).toBe(true)

    // Nor anywhere in the audit trail.
    const logs = JSON.stringify(await db.auditLogs.toArray())
    expect(logs).not.toContain('coffee2026')
  })

  test('will not change or remove itself without the current passcode', async () => {
    await seedSettings()
    await setPlannerPasscode({ passcode: 'coffee2026', userId: USER })

    await expect(setPlannerPasscode({ passcode: 'newone', current: 'wrong', userId: USER })).rejects.toThrow(
      /not the current passcode/i,
    )
    await expect(removePlannerPasscode({ current: 'wrong', userId: USER })).rejects.toThrow(
      /not the current passcode/i,
    )
    expect(await plannerIsLocked()).toBe(true)
  })

  test('changes and removes cleanly when the current one is right', async () => {
    await seedSettings()
    await setPlannerPasscode({ passcode: 'coffee2026', userId: USER })
    await setPlannerPasscode({ passcode: 'beans2027', current: 'coffee2026', userId: USER })

    expect(await unlockPlanner('beans2027')).toBe(true)

    await removePlannerPasscode({ current: 'beans2027', userId: USER })
    expect(await plannerIsLocked()).toBe(false)
  })

  test('refuses a passcode too short to be worth having', async () => {
    await seedSettings()
    await expect(setPlannerPasscode({ passcode: '12', userId: USER })).rejects.toThrow(/four characters/i)
  })
})
