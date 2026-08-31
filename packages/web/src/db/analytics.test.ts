import { beforeEach, describe, expect, test } from 'vitest'
import {
  fromDecimal,
  type Category,
  type Payment,
  type Product,
  type Sale,
  type SaleItem,
  type User,
} from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import type { PendingWrite } from './write.ts'
import {
  customRange,
  loadAnalytics,
  rankProducts,
  resolveRange,
  type RankedProduct,
} from './analytics.ts'

/**
 * Reporting.
 *
 * The figures here end up in front of an owner deciding what to charge and who
 * to roster, so the tests care most about the things that would quietly
 * mislead: a voided sale still counted, tax mistaken for profit, or an empty
 * hour dropped so a quiet afternoon looks like a busy one.
 */

const DAY = 24 * 60 * 60 * 1000

function at(hour: number, dayOffset = 0): number {
  const date = new Date()
  date.setHours(hour, 30, 0, 0)
  return date.getTime() + dayOffset * DAY
}

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()
}

interface SaleSpec {
  total: number
  tax?: number
  cogs?: number
  discount?: number
  occurredAt: number
  status?: Sale['status']
  entryMode?: Sale['entryMode']
  userId?: string
  items?: Array<{ product: string; variant: string; category: string; qty: number; revenue: number; cogs: number }>
  payment?: { method: Payment['method']; verification?: Payment['verification'] }
  cupCount?: number
  snackCount?: number
}

/** A product in a category counted the given way, so cups can be told from snacks. */
async function addMenu(input: { product: string; servingUnit: 'CUP' | 'PIECE' }): Promise<void> {
  const category = stamp<Category>({
    name: `${input.product} category`,
    servingUnit: input.servingUnit,
    colour: '',
    icon: '',
    sortOrder: 0,
    active: true,
  })
  const product = stamp<Product>({
    categoryId: category.id,
    name: input.product,
    description: '',
    sku: '',
    imageDataUrl: null,
    active: true,
    available: true,
    sortOrder: 0,
    taxable: true,
    modifierGroupIds: [],
  })
  // Written under the name the sale lines use, so they join up.
  await commit([created('categories', category), created('products', { ...product, id: input.product })])
}

async function addSale(spec: SaleSpec): Promise<Sale> {
  const sale = stamp<Sale>({
    receiptNo: `OR-${Math.random().toString(36).slice(2, 8)}`,
    queueNo: '001',
    shiftId: 'SHIFT-1',
    userId: spec.userId ?? 'USER-1',
    status: spec.status ?? 'COMPLETED',
    entryMode: spec.entryMode ?? 'ITEMISED',
    orderType: 'TAKE_OUT',
    subtotal: spec.total,
    discountTotal: spec.discount ?? 0,
    taxTotal: spec.tax ?? 0,
    taxExemptTotal: 0,
    total: spec.total,
    cogsTotal: spec.cogs ?? 0,
    itemCount: (spec.items ?? []).reduce((sum, item) => sum + item.qty, 0) || 1,
    customerName: '',
    note: '',
    occurredAt: spec.occurredAt,
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
    refundOfSaleId: null,
    refundedTotal: 0,
    ...(spec.cupCount === undefined ? {} : { cupCount: spec.cupCount }),
    ...(spec.snackCount === undefined ? {} : { snackCount: spec.snackCount }),
  })

  const writes: PendingWrite[] = [created('sales', sale)]

  for (const [index, item] of (spec.items ?? []).entries()) {
    writes.push(
      created(
        'saleItems',
        stamp<SaleItem>({
          saleId: sale.id,
          productId: item.product,
          variantId: `${item.product}-${item.variant}`,
          productName: item.product,
          variantName: item.variant,
          categoryName: item.category,
          quantity: item.qty,
          unitPrice: Math.round(item.revenue / item.qty),
          modifiers: [],
          modifiersTotal: 0,
          lineSubtotal: item.revenue,
          lineDiscount: 0,
          lineTotal: item.revenue,
          lineCogs: item.cogs,
          note: '',
          sortOrder: index,
        }),
      ),
    )
  }

  if (spec.payment) {
    writes.push(
      created(
        'payments',
        stamp<Payment>({
          saleId: sale.id,
          method: spec.payment.method,
          amount: spec.total,
          tendered: spec.total,
          change: 0,
          reference: '',
          verification: spec.payment.verification ?? 'NOT_REQUIRED',
          verifiedAt: null,
        }),
      ),
    )
  }

  await commit(writes)
  return sale
}

beforeEach(reset)

describe('date ranges', () => {
  const monday = new Date(2026, 7, 24, 15, 0, 0) // Monday 24 August 2026

  test('today runs midnight to midnight and buckets by hour', () => {
    const range = resolveRange('TODAY', monday)
    expect(new Date(range.from).getHours()).toBe(0)
    expect(new Date(range.to).getHours()).toBe(23)
    expect(range.granularity).toBe('HOUR')
  })

  test('yesterday is the whole previous day, not the last 24 hours', () => {
    const range = resolveRange('YESTERDAY', monday)
    expect(new Date(range.from).getDate()).toBe(23)
    expect(new Date(range.to).getDate()).toBe(23)
    expect(new Date(range.from).getHours()).toBe(0)
  })

  test('the week starts on Monday, the way a rota is written', () => {
    const thursday = new Date(2026, 7, 27, 12, 0, 0)
    const range = resolveRange('THIS_WEEK', thursday)
    expect(new Date(range.from).getDay()).toBe(1)
    expect(new Date(range.from).getDate()).toBe(24)
    expect(range.granularity).toBe('DAY')
  })

  test('a Sunday belongs to the week that began the previous Monday', () => {
    const sunday = new Date(2026, 7, 30, 12, 0, 0)
    const range = resolveRange('THIS_WEEK', sunday)
    expect(new Date(range.from).getDate()).toBe(24)
  })

  test('this month starts on the first', () => {
    const range = resolveRange('THIS_MONTH', monday)
    expect(new Date(range.from).getDate()).toBe(1)
    expect(new Date(range.from).getMonth()).toBe(7)
  })

  test('last month covers the whole of it, including its final day', () => {
    const range = resolveRange('LAST_MONTH', monday)
    expect(new Date(range.from).getMonth()).toBe(6)
    expect(new Date(range.from).getDate()).toBe(1)
    expect(new Date(range.to).getMonth()).toBe(6)
    expect(new Date(range.to).getDate()).toBe(31)
  })

  test('a single-day custom range still buckets by hour', () => {
    const day = new Date(2026, 7, 24)
    expect(customRange(day, day).granularity).toBe('HOUR')
    expect(customRange(day, new Date(2026, 7, 28)).granularity).toBe('DAY')
  })
})

describe('the headline figures', () => {
  test('profit is revenue net of tax, less the cost of goods', async () => {
    await addSale({ total: fromDecimal(112), tax: fromDecimal(12), cogs: fromDecimal(40), occurredAt: at(10) })

    const analytics = await loadAnalytics(resolveRange('TODAY'))

    expect(analytics.grossRevenue).toBe(fromDecimal(112))
    expect(analytics.netRevenue).toBe(fromDecimal(100))
    expect(analytics.cogsTotal).toBe(fromDecimal(40))
    // Profit is 60 on net revenue of 100 - tax is never counted as profit.
    expect(analytics.grossProfit).toBe(fromDecimal(60))
    expect(analytics.marginPercent).toBeCloseTo(60, 5)
  })

  test('a voided sale is excluded from every figure', async () => {
    await addSale({ total: fromDecimal(100), cogs: fromDecimal(30), occurredAt: at(10) })
    await addSale({ total: fromDecimal(500), cogs: fromDecimal(200), occurredAt: at(11), status: 'VOIDED' })

    const analytics = await loadAnalytics(resolveRange('TODAY'))

    expect(analytics.grossRevenue).toBe(fromDecimal(100))
    expect(analytics.orders).toBe(1)
    expect(analytics.voidedCount).toBe(1)
  })

  test('the average order is revenue over orders', async () => {
    await addSale({ total: fromDecimal(100), occurredAt: at(9) })
    await addSale({ total: fromDecimal(200), occurredAt: at(10) })
    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.orders).toBe(2)
    expect(analytics.averageOrder).toBe(fromDecimal(150))
  })

  test('an empty period reports zeroes rather than NaN', async () => {
    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.grossRevenue).toBe(0)
    expect(analytics.averageOrder).toBe(0)
    expect(analytics.marginPercent).toBe(0)
    expect(analytics.peak).toBeNull()
  })

  test('sales outside the period are left out', async () => {
    await addSale({ total: fromDecimal(100), occurredAt: at(10) })
    await addSale({ total: fromDecimal(999), occurredAt: at(10, -3) })
    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.grossRevenue).toBe(fromDecimal(100))
  })
})

describe('the time chart', () => {
  test('a day gets all twenty-four hours, including the quiet ones', async () => {
    await addSale({ total: fromDecimal(100), occurredAt: at(9) })
    const analytics = await loadAnalytics(resolveRange('TODAY'))

    // A quiet hour is information. Dropping it would make a slow day look busy.
    expect(analytics.buckets).toHaveLength(24)
    expect(analytics.buckets.filter((bucket) => bucket.revenue === 0)).toHaveLength(23)
  })

  test('sales land in the hour they happened', async () => {
    await addSale({ total: fromDecimal(100), occurredAt: at(9) })
    await addSale({ total: fromDecimal(250), occurredAt: at(14) })
    await addSale({ total: fromDecimal(50), occurredAt: at(14) })

    const analytics = await loadAnalytics(resolveRange('TODAY'))

    expect(analytics.buckets[9]?.revenue).toBe(fromDecimal(100))
    expect(analytics.buckets[14]?.revenue).toBe(fromDecimal(300))
    expect(analytics.buckets[14]?.orders).toBe(2)
  })

  test('the peak is the busiest bucket by revenue', async () => {
    await addSale({ total: fromDecimal(100), occurredAt: at(9) })
    await addSale({ total: fromDecimal(400), occurredAt: at(16) })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.peak?.revenue).toBe(fromDecimal(400))
    expect(analytics.peak?.label).toBe('4pm')
  })

  test('hour labels read as a person would say them', async () => {
    await addSale({ total: fromDecimal(1), occurredAt: at(0) })
    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.buckets[0]?.label).toBe('12am')
    expect(analytics.buckets[12]?.label).toBe('12pm')
    expect(analytics.buckets[13]?.label).toBe('1pm')
  })
})

describe('products', () => {
  const items = [
    { product: 'Latte', variant: '16oz', category: 'Hot', qty: 10, revenue: fromDecimal(1600), cogs: fromDecimal(450) },
    { product: 'Cookie', variant: 'Regular', category: 'Snacks', qty: 30, revenue: fromDecimal(1950), cogs: fromDecimal(750) },
  ]

  test('quantities and money add up across sales', async () => {
    await addSale({ total: fromDecimal(3550), occurredAt: at(10), items })
    await addSale({ total: fromDecimal(160), occurredAt: at(11), items: [items[0]!] })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    const latte = analytics.products.find((product) => product.name === 'Latte')

    expect(latte?.quantity).toBe(20)
    expect(latte?.revenue).toBe(fromDecimal(3200))
    expect(latte?.profit).toBe(fromDecimal(3200) - fromDecimal(900))
  })

  test('ranking by each measure puts a different item on top', async () => {
    await addSale({ total: fromDecimal(3550), occurredAt: at(10), items })
    const analytics = await loadAnalytics(resolveRange('TODAY'))

    // The cookie sells in greater numbers and earns more; the latte is not
    // the best seller by either, which is exactly why both views exist.
    expect(rankProducts(analytics.products, 'quantity')[0]?.name).toBe('Cookie')
    expect(rankProducts(analytics.products, 'revenue')[0]?.name).toBe('Cookie')
    expect(rankProducts(analytics.products, 'profit')[0]?.name).toBe('Cookie')
    expect(rankProducts(analytics.products, 'margin')[0]?.name).toBe('Latte')
  })

  test('ranking respects the limit', async () => {
    await addSale({ total: fromDecimal(3550), occurredAt: at(10), items })
    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(rankProducts(analytics.products, 'revenue', 1)).toHaveLength(1)
  })

  test('ranking an empty list returns an empty list', () => {
    expect(rankProducts([] as RankedProduct[], 'revenue')).toEqual([])
  })

  test('revenue rolls up by category', async () => {
    await addSale({ total: fromDecimal(3550), occurredAt: at(10), items })
    const analytics = await loadAnalytics(resolveRange('TODAY'))

    expect(analytics.categories[0]?.name).toBe('Snacks')
    expect(analytics.categories[0]?.revenue).toBe(fromDecimal(1950))
    expect(analytics.categories.find((entry) => entry.name === 'Hot')?.quantity).toBe(10)
  })
})

describe('payments', () => {
  test('are grouped by method, largest first', async () => {
    await addSale({ total: fromDecimal(100), occurredAt: at(9), payment: { method: 'CASH' } })
    await addSale({ total: fromDecimal(50), occurredAt: at(10), payment: { method: 'CASH' } })
    await addSale({ total: fromDecimal(300), occurredAt: at(11), payment: { method: 'GCASH' } })

    const analytics = await loadAnalytics(resolveRange('TODAY'))

    expect(analytics.payments[0]?.method).toBe('GCASH')
    expect(analytics.payments[0]?.amount).toBe(fromDecimal(300))
    expect(analytics.payments[1]?.method).toBe('CASH')
    expect(analytics.payments[1]?.amount).toBe(fromDecimal(150))
    expect(analytics.payments[1]?.count).toBe(2)
  })

  test('payments taken offline are reported as unverified', async () => {
    await addSale({
      total: fromDecimal(300),
      occurredAt: at(11),
      payment: { method: 'GCASH', verification: 'RECORDED_LOCALLY' },
    })
    await addSale({
      total: fromDecimal(200),
      occurredAt: at(12),
      payment: { method: 'GCASH', verification: 'EXTERNALLY_VERIFIED' },
    })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    const gcash = analytics.payments.find((entry) => entry.method === 'GCASH')

    // The owner can see how much of the total nobody has actually confirmed.
    expect(gcash?.amount).toBe(fromDecimal(500))
    expect(gcash?.unverified).toBe(fromDecimal(300))
  })

  test('cash is never counted as unverified', async () => {
    await addSale({ total: fromDecimal(100), occurredAt: at(9), payment: { method: 'CASH' } })
    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.payments[0]?.unverified).toBe(0)
  })
})

describe('staff', () => {
  test('sales are attributed by name, ranked by takings', async () => {
    await commit([
      created('users', stamp<User>({
        name: 'Ana', role: 'CASHIER', pinHash: 'x', active: true,
        employeeCode: 'A', failedAttempts: 0, lockedUntil: null, permissionOverrides: {}, id: 'USER-A',
      } as never)),
      created('users', stamp<User>({
        name: 'Ben', role: 'CASHIER', pinHash: 'x', active: true,
        employeeCode: 'B', failedAttempts: 0, lockedUntil: null, permissionOverrides: {}, id: 'USER-B',
      } as never)),
    ])

    await addSale({ total: fromDecimal(100), occurredAt: at(9), userId: 'USER-A' })
    await addSale({ total: fromDecimal(400), occurredAt: at(10), userId: 'USER-B' })
    await addSale({ total: fromDecimal(200), occurredAt: at(11), userId: 'USER-B' })

    const analytics = await loadAnalytics(resolveRange('TODAY'))

    expect(analytics.staff[0]?.name).toBe('Ben')
    expect(analytics.staff[0]?.orders).toBe(2)
    expect(analytics.staff[0]?.revenue).toBe(fromDecimal(600))
    expect(analytics.staff[0]?.averageOrder).toBe(fromDecimal(300))
    expect(analytics.staff[1]?.name).toBe('Ana')
  })

  test('a sale by someone no longer on the books is still counted', async () => {
    await addSale({ total: fromDecimal(100), occurredAt: at(9), userId: 'GONE' })
    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.staff[0]?.name).toBe('Unknown')
    expect(analytics.staff[0]?.revenue).toBe(fromDecimal(100))
  })
})

describe('cups and snacks', () => {
  test('counts cups and snacks the way the sale recorded them', async () => {
    await addSale({ total: 30000, occurredAt: at(9), cupCount: 3, snackCount: 2 })
    await addSale({ total: 10000, occurredAt: at(10), cupCount: 1, snackCount: 0 })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.cupsSold).toBe(4)
    expect(analytics.snacksSold).toBe(2)
  })

  test('treats a sale taken before cups were split as all cups', async () => {
    await addSale({
      total: 20000,
      occurredAt: at(9),
      items: [{ product: 'Latte', variant: '16oz', category: 'Coffee', qty: 2, revenue: 20000, cogs: 6000 }],
    })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.cupsSold).toBe(2)
    expect(analytics.snacksSold).toBe(0)
  })

  test('leaves a voided sale out of the cup count', async () => {
    await addSale({ total: 30000, occurredAt: at(9), cupCount: 3, status: 'VOIDED' })
    await addSale({ total: 10000, occurredAt: at(10), cupCount: 1 })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.cupsSold).toBe(1)
  })

  test('breaks cups down by size, busiest first', async () => {
    await addMenu({ product: 'Latte', servingUnit: 'CUP' })
    await addSale({
      total: 60000,
      occurredAt: at(9),
      cupCount: 6,
      items: [
        { product: 'Latte', variant: '16oz', category: 'Coffee', qty: 2, revenue: 20000, cogs: 6000 },
        { product: 'Latte', variant: '22oz', category: 'Coffee', qty: 4, revenue: 40000, cogs: 12000 },
      ],
    })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.cupsBySize).toEqual([
      { size: '22oz', quantity: 4 },
      { size: '16oz', quantity: 2 },
    ])
  })

  test('breaks snacks down by what they are, not by size', async () => {
    await addMenu({ product: 'Croissant', servingUnit: 'PIECE' })
    await addMenu({ product: 'Cookie', servingUnit: 'PIECE' })
    await addSale({
      total: 40000,
      occurredAt: at(9),
      snackCount: 5,
      items: [
        { product: 'Croissant', variant: 'Regular', category: 'Snacks', qty: 3, revenue: 28500, cogs: 9000 },
        { product: 'Cookie', variant: 'Regular', category: 'Snacks', qty: 2, revenue: 13000, cogs: 4000 },
      ],
    })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.snacksByItem).toEqual([
      { name: 'Croissant', quantity: 3 },
      { name: 'Cookie', quantity: 2 },
    ])
    // A snack never turns up among the cups.
    expect(analytics.cupsBySize).toEqual([])
  })

  test('keeps snacks out of the size breakdown', async () => {
    await addMenu({ product: 'Latte', servingUnit: 'CUP' })
    await addMenu({ product: 'Croissant', servingUnit: 'PIECE' })
    await addSale({
      total: 30000,
      occurredAt: at(9),
      cupCount: 2,
      snackCount: 1,
      items: [
        { product: 'Latte', variant: '16oz', category: 'Coffee', qty: 2, revenue: 20000, cogs: 6000 },
        { product: 'Croissant', variant: 'Regular', category: 'Snacks', qty: 1, revenue: 10000, cogs: 4000 },
      ],
    })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.cupsBySize).toEqual([{ size: '16oz', quantity: 2 }])
  })
})
