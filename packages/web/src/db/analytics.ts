import type { Money, PaymentMethod, Sale } from '@pos/shared'
import { db } from './database.ts'
import { countsOfSale, servingUnitOf } from './till.ts'

/**
 * Reporting.
 *
 * Every figure is computed on this device from records it already holds, so
 * the dashboard is as available as the till is - a manager can read yesterday's
 * numbers with the internet down. Sales that arrive from another device land
 * in the same tables, so the same code answers for the whole business.
 *
 * Voided sales are excluded everywhere. A void is not a sale that happened.
 */

export const RANGE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'CUSTOM',
] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export interface DateRange {
  from: number
  to: number
  label: string
  /** Hourly buckets for a single day; daily for anything longer. */
  granularity: 'HOUR' | 'DAY'
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function endOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(23, 59, 59, 999)
  return copy
}

export const RANGE_LABELS: Record<RangePreset, string> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  THIS_WEEK: 'This week',
  THIS_MONTH: 'This month',
  LAST_MONTH: 'Last month',
  CUSTOM: 'Custom',
}

/** Resolve a preset against the device clock, which is the shop's clock. */
export function resolveRange(preset: RangePreset, now = new Date()): DateRange {
  switch (preset) {
    case 'TODAY':
      return {
        from: startOfDay(now).getTime(),
        to: endOfDay(now).getTime(),
        label: 'Today',
        granularity: 'HOUR',
      }

    case 'YESTERDAY': {
      const yesterday = new Date(now.getTime() - DAY_MS)
      return {
        from: startOfDay(yesterday).getTime(),
        to: endOfDay(yesterday).getTime(),
        label: 'Yesterday',
        granularity: 'HOUR',
      }
    }

    case 'THIS_WEEK': {
      // Weeks start on Monday, which is how a rota is written.
      const start = startOfDay(now)
      const weekday = (start.getDay() + 6) % 7
      start.setDate(start.getDate() - weekday)
      return {
        from: start.getTime(),
        to: endOfDay(now).getTime(),
        label: 'This week',
        granularity: 'DAY',
      }
    }

    case 'THIS_MONTH': {
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
      return {
        from: start.getTime(),
        to: endOfDay(now).getTime(),
        label: 'This month',
        granularity: 'DAY',
      }
    }

    case 'LAST_MONTH': {
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1))
      const end = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))
      return {
        from: start.getTime(),
        to: end.getTime(),
        label: 'Last month',
        granularity: 'DAY',
      }
    }

    default:
      return {
        from: startOfDay(now).getTime(),
        to: endOfDay(now).getTime(),
        label: 'Custom',
        granularity: 'DAY',
      }
  }
}

export function customRange(fromDate: Date, toDate: Date): DateRange {
  const from = startOfDay(fromDate).getTime()
  const to = endOfDay(toDate).getTime()
  return {
    from,
    to,
    label: 'Custom',
    granularity: to - from <= DAY_MS ? 'HOUR' : 'DAY',
  }
}

// ------------------------------------------------------------------ shapes --

export interface Bucket {
  /** Start of the bucket. */
  at: number
  label: string
  revenue: Money
  orders: number
}

export interface RankedProduct {
  key: string
  name: string
  variantName: string
  categoryName: string
  quantity: number
  revenue: Money
  cogs: Money
  profit: Money
  marginPercent: number
}

export interface PaymentSlice {
  method: PaymentMethod
  label: string
  amount: Money
  count: number
  /** Recorded on an offline device and not yet confirmed with the provider. */
  unverified: Money
}

export interface StaffRow {
  userId: string
  name: string
  orders: number
  revenue: Money
  averageOrder: Money
}

export interface LoyaltySummary {
  /** How many orders were given away against a loyalty card. */
  redemptions: number
  /** What those orders would have been worth at menu price. */
  valueGivenAway: Money
  /** What they actually cost to make - the real price of the scheme. */
  cost: Money
}

export interface Analytics {
  range: DateRange
  grossRevenue: Money
  taxTotal: Money
  netRevenue: Money
  cogsTotal: Money
  grossProfit: Money
  discountTotal: Money
  orders: number
  itemsSold: number
  /** Drinks, counted in cups. */
  cupsSold: number
  /** Everything counted by the piece. */
  snacksSold: number
  /** Cups broken down by size, largest first. */
  cupsBySize: Array<{ size: string; quantity: number }>
  /**
   * Snacks broken down by what they are, largest first.
   *
   * By name rather than by size: nobody asks how many 16oz croissants went out.
   */
  snacksByItem: Array<{ name: string; quantity: number }>
  averageOrder: Money
  marginPercent: number
  /**
   * Revenue from days entered as a single figure, before this system was in
   * use. Counted in revenue but excluded from margin, because their cost of
   * goods is unknown rather than zero.
   */
  lumpSumRevenue: Money
  lumpSumOrders: number
  /** Money handed back over the period, and how many times. */
  refundedOut: Money
  refundCount: number
  /** The revenue that margin was actually computed over. */
  marginBasis: Money
  loyalty: LoyaltySummary
  buckets: Bucket[]
  peak: Bucket | null
  products: RankedProduct[]
  categories: Array<{ name: string; revenue: Money; quantity: number }>
  payments: PaymentSlice[]
  staff: StaffRow[]
  voidedCount: number
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
  MAYA: 'Maya',
  CARD: 'Card',
  LOYALTY: 'Loyalty claim',
}

function bucketLabel(at: number, granularity: 'HOUR' | 'DAY'): string {
  const date = new Date(at)
  if (granularity === 'HOUR') {
    const hour = date.getHours()
    const suffix = hour < 12 ? 'am' : 'pm'
    const display = hour % 12 === 0 ? 12 : hour % 12
    return `${display}${suffix}`
  }
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Empty buckets are kept: a quiet hour is information, not an absence of it. */
function buildBuckets(range: DateRange): Bucket[] {
  const buckets: Bucket[] = []

  if (range.granularity === 'HOUR') {
    const start = new Date(range.from)
    start.setMinutes(0, 0, 0)
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(start).setHours(hour, 0, 0, 0)
      if (at > range.to) break
      buckets.push({ at, label: bucketLabel(at, 'HOUR'), revenue: 0, orders: 0 })
    }
    return buckets
  }

  let cursor = new Date(range.from)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= range.to && buckets.length < 400) {
    const at = cursor.getTime()
    buckets.push({ at, label: bucketLabel(at, 'DAY'), revenue: 0, orders: 0 })
    cursor = new Date(cursor.getTime() + DAY_MS)
    cursor.setHours(0, 0, 0, 0)
  }
  return buckets
}

function bucketIndexFor(sale: Sale, range: DateRange, buckets: Bucket[]): number {
  if (buckets.length === 0) return -1
  if (range.granularity === 'HOUR') {
    const index = new Date(sale.occurredAt).getHours()
    return index < buckets.length ? index : -1
  }
  const first = buckets[0]?.at ?? range.from
  const index = Math.floor((startOfDay(new Date(sale.occurredAt)).getTime() - first) / DAY_MS)
  return index >= 0 && index < buckets.length ? index : -1
}

/**
 * Aggregate everything the dashboard shows, in one pass over the period.
 *
 * Historical figures come from what was recorded on the sale itself - the cost
 * of goods frozen at the moment of sale - never from re-costing today's
 * recipes against an old order.
 */
export async function loadAnalytics(range: DateRange): Promise<Analytics> {
  const allSales = await db.sales.where('occurredAt').between(range.from, range.to, true, true).toArray()
  const live = allSales.filter((sale) => sale.deletedAt === null && sale.status !== 'VOIDED')
  const voidedCount = allSales.filter((sale) => sale.deletedAt === null && sale.status === 'VOIDED').length

  const saleIds = new Set(live.map((sale) => sale.id))
  const buckets = buildBuckets(range)

  let grossRevenue = 0
  let taxTotal = 0
  let cogsTotal = 0
  let discountTotal = 0
  let itemsSold = 0
  let cupsSold = 0
  let snacksSold = 0
  let lumpSumRevenue = 0
  let lumpSumOrders = 0
  // Margin is computed only over sales whose cost we actually know.
  let marginBasis = 0

  for (const sale of live) {
    grossRevenue += sale.total
    taxTotal += sale.taxTotal
    discountTotal += sale.discountTotal
    itemsSold += sale.itemCount
    // Split the way the sale recorded it, so a closed day never moves.
    const counts = countsOfSale(sale)
    cupsSold += counts.cups
    snacksSold += counts.snacks

    if (sale.entryMode === 'LUMP_SUM') {
      lumpSumRevenue += sale.total
      lumpSumOrders += 1
    } else {
      cogsTotal += sale.cogsTotal
      marginBasis += sale.total - sale.taxTotal
    }

    const index = bucketIndexFor(sale, range, buckets)
    const bucket = index >= 0 ? buckets[index] : undefined
    if (bucket) {
      bucket.revenue += sale.total
      bucket.orders += 1
    }
  }

  // Lines and payments are fetched whole and filtered, which is far cheaper
  // than a query per sale once a shop has a few thousand orders.
  const [allItems, allPayments, allDiscounts, users, allProducts, allCategories] = await Promise.all([
    db.saleItems.toArray(),
    db.payments.toArray(),
    db.saleDiscounts.toArray(),
    db.users.toArray(),
    db.products.toArray(),
    db.categories.toArray(),
  ])

  const items = allItems.filter((item) => item.deletedAt === null && saleIds.has(item.saleId))

  // Cups by size, so "231 cups" can say which cups they were. Only lines whose
  // category is counted in cups are included; a pastry has a size too.
  const categoryById = new Map(allCategories.map((entry) => [entry.id, entry]))
  const cupCategoryByProduct = new Map(
    allProducts.map((product) => [product.id, servingUnitOf(categoryById.get(product.categoryId)) === 'CUP']),
  )
  const bySize = new Map<string, number>()
  const byItem = new Map<string, number>()
  for (const item of items) {
    if (cupCategoryByProduct.get(item.productId) === false) {
      const name = item.productName.trim() || 'Unnamed'
      byItem.set(name, (byItem.get(name) ?? 0) + item.quantity)
      continue
    }
    const size = item.variantName.trim() || 'Regular'
    bySize.set(size, (bySize.get(size) ?? 0) + item.quantity)
  }
  const cupsBySize = [...bySize.entries()]
    .map(([size, quantity]) => ({ size, quantity }))
    .filter((entry) => entry.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity)
  const snacksByItem = [...byItem.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .filter((entry) => entry.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity)
  const payments = allPayments.filter((payment) => payment.deletedAt === null && saleIds.has(payment.saleId))
  const discounts = allDiscounts.filter((entry) => entry.deletedAt === null && saleIds.has(entry.saleId))

  const productMap = new Map<string, RankedProduct>()
  const categoryMap = new Map<string, { name: string; revenue: Money; quantity: number }>()

  for (const item of items) {
    const key = item.variantId || `${item.productId}:${item.variantName}`
    const existing = productMap.get(key)
    const entry: RankedProduct = existing ?? {
      key,
      name: item.productName,
      variantName: item.variantName,
      categoryName: item.categoryName,
      quantity: 0,
      revenue: 0,
      cogs: 0,
      profit: 0,
      marginPercent: 0,
    }
    entry.quantity += item.quantity
    entry.revenue += item.lineTotal
    entry.cogs += item.lineCogs
    productMap.set(key, entry)

    const categoryName = item.categoryName || 'Uncategorised'
    const category = categoryMap.get(categoryName) ?? { name: categoryName, revenue: 0, quantity: 0 }
    category.revenue += item.lineTotal
    category.quantity += item.quantity
    categoryMap.set(categoryName, category)
  }

  const products = [...productMap.values()].map((entry) => {
    entry.profit = entry.revenue - entry.cogs
    entry.marginPercent = entry.revenue > 0 ? (entry.profit / entry.revenue) * 100 : 0
    return entry
  })

  const paymentMap = new Map<PaymentMethod, PaymentSlice>()
  for (const payment of payments) {
    const slice =
      paymentMap.get(payment.method) ??
      ({
        method: payment.method,
        label: PAYMENT_LABELS[payment.method],
        amount: 0,
        count: 0,
        unverified: 0,
      } satisfies PaymentSlice)
    slice.amount += payment.amount
    slice.count += 1
    if (payment.verification === 'RECORDED_LOCALLY') slice.unverified += payment.amount
    paymentMap.set(payment.method, slice)
  }

  const namesById = new Map(users.filter((user) => user.deletedAt === null).map((user) => [user.id, user.name]))
  const staffMap = new Map<string, StaffRow>()
  for (const sale of live) {
    const row =
      staffMap.get(sale.userId) ??
      ({
        userId: sale.userId,
        name: namesById.get(sale.userId) ?? 'Unknown',
        orders: 0,
        revenue: 0,
        averageOrder: 0,
      } satisfies StaffRow)
    row.orders += 1
    row.revenue += sale.total
    staffMap.set(sale.userId, row)
  }
  const staff = [...staffMap.values()].map((row) => {
    row.averageOrder = row.orders > 0 ? Math.round(row.revenue / row.orders) : 0
    return row
  })

  const netRevenue = grossRevenue - taxTotal
  const grossProfit = marginBasis - cogsTotal

  // A refund is not an order. Counting one would inflate the order count and
  // drag the average order value down towards a number nobody ever paid.
  const orders = live.filter((sale) => !sale.refundOfSaleId).length
  const refunds = live.filter((sale) => Boolean(sale.refundOfSaleId))
  const refundedOut = refunds.reduce((sum, sale) => sum + Math.abs(sale.total), 0)

  // A free drink still costs what it costs. Tracking both the menu value given
  // away and the money it took to make is what makes the scheme's price visible.
  const loyaltyDiscounts = discounts.filter((entry) => entry.type === 'LOYALTY')
  const loyaltySaleIds = new Set(loyaltyDiscounts.map((entry) => entry.saleId))
  const loyalty: LoyaltySummary = {
    redemptions: loyaltySaleIds.size,
    valueGivenAway: loyaltyDiscounts.reduce((sum, entry) => sum + entry.amount, 0),
    cost: live
      .filter((sale) => loyaltySaleIds.has(sale.id))
      .reduce((sum, sale) => sum + sale.cogsTotal, 0),
  }

  const busiest = buckets.reduce<Bucket | null>(
    (best, bucket) => (bucket.revenue > (best?.revenue ?? 0) ? bucket : best),
    null,
  )

  return {
    range,
    grossRevenue,
    taxTotal,
    netRevenue,
    cogsTotal,
    grossProfit,
    discountTotal,
    orders,
    itemsSold,
    cupsSold,
    snacksSold,
    cupsBySize,
    snacksByItem,
    averageOrder: orders > 0 ? Math.round(grossRevenue / orders) : 0,
    marginPercent: marginBasis > 0 ? (grossProfit / marginBasis) * 100 : 0,
    lumpSumRevenue,
    lumpSumOrders,
    refundedOut,
    refundCount: refunds.length,
    marginBasis,
    loyalty,
    buckets,
    peak: busiest && busiest.revenue > 0 ? busiest : null,
    products,
    categories: [...categoryMap.values()].sort((a, b) => b.revenue - a.revenue),
    payments: [...paymentMap.values()].sort((a, b) => b.amount - a.amount),
    staff: staff.sort((a, b) => b.revenue - a.revenue),
    voidedCount,
  }
}

export type ProductRanking = 'quantity' | 'revenue' | 'profit' | 'margin'

/** Ranked however the manager wants to look at it today. */
export function rankProducts(
  products: RankedProduct[],
  by: ProductRanking,
  limit = 8,
): RankedProduct[] {
  const sorted = [...products].sort((a, b) => {
    switch (by) {
      case 'quantity':
        return b.quantity - a.quantity
      case 'profit':
        return b.profit - a.profit
      case 'margin':
        return b.marginPercent - a.marginPercent
      default:
        return b.revenue - a.revenue
    }
  })
  return sorted.slice(0, limit)
}

/** Items shifted per hour open, so a short day is not read as a bad one. */
export function itemsPerActiveHour(analytics: Analytics): number {
  const active = analytics.buckets.filter((bucket) => bucket.orders > 0).length
  return active > 0 ? analytics.itemsSold / active : 0
}
