import {
  costOf,
  formatQuantity,
  renderPlain,
  row,
  type BrandingSettings,
  type Money,
  type PaperWidth,
  type ReceiptRow,
} from '@pos/shared'
import { db } from './database.ts'
import { customRange, loadAnalytics, type Analytics, type DateRange, type PaymentSlice } from './analytics.ts'
import { buildProfitAndLoss, expensesIn, type ProfitAndLoss } from './expenses.ts'
import type { OperatingExpense } from '@pos/shared'

/**
 * The end-of-day summary.
 *
 * Every other report answers "how are we doing"; this one answers "what
 * happened today, and where did it come from". So each headline figure is
 * followed by the things that add up to it - takings by what was sold and how
 * it was paid for, cost by the stock that actually left the shelf - rather than
 * a total the owner has to take on trust.
 *
 * Nothing here is a new source of truth. It is the same sales, movements and
 * expenses the rest of the app reads, arranged as a close-out.
 */

export interface SalesLine {
  name: string
  quantity: number
  revenue: Money
  cogs: Money
  profit: Money
  /** Share of the day's takings, 0-100. */
  share: number
}

export interface CostLine {
  name: string
  /** How much left the shelf, in words - "1.2 kg", "18 pcs". */
  used: string
  cost: Money
  /** Share of the day's cost of goods, 0-100. */
  share: number
}

export interface EndOfDaySummary {
  day: DateRange
  /** The date the summary is for, at midnight. */
  date: number
  analytics: Analytics
  pnl: ProfitAndLoss
  /** What was spent, as recorded - not just the category totals. */
  expenses: OperatingExpense[]

  orders: number
  cups: number
  snacks: number

  /** What made up the takings. */
  byCategory: SalesLine[]
  byProduct: SalesLine[]
  payments: PaymentSlice[]

  /** What made up the cost of goods, from the stock ledger. */
  byIngredient: CostLine[]
  /**
   * Cost the ledger cannot explain.
   *
   * A sale records what it cost at the time; a backfilled day or a product with
   * no recipe records nothing. The difference is shown rather than spread
   * across the ingredients, which would invent detail that was never recorded.
   */
  unexplainedCogs: Money
  uncostedSales: Money

  /** Nothing was rung up at all - a closed day, not a bad one. */
  quiet: boolean
}

const share = (part: number, whole: number): number => (whole > 0 ? (part / whole) * 100 : 0)

export async function buildEndOfDay(date: Date): Promise<EndOfDaySummary> {
  const day = customRange(date, date)
  const [analytics, expenses] = await Promise.all([loadAnalytics(day), expensesIn(day)])

  const pnl = buildProfitAndLoss({
    grossSales: analytics.grossRevenue,
    tax: analytics.taxTotal,
    costOfGoods: analytics.cogsTotal,
    uncostedSales: analytics.lumpSumRevenue,
    expenses,
  })

  // Categories carry revenue and quantity but not cost, so cost is folded in
  // from the product rows that belong to them.
  const cogsByCategory = new Map<string, Money>()
  for (const product of analytics.products) {
    cogsByCategory.set(product.categoryName, (cogsByCategory.get(product.categoryName) ?? 0) + product.cogs)
  }

  const byCategory: SalesLine[] = analytics.categories
    .map((entry) => {
      const cogs = cogsByCategory.get(entry.name) ?? 0
      return {
        name: entry.name,
        quantity: entry.quantity,
        revenue: entry.revenue,
        cogs,
        profit: entry.revenue - cogs,
        share: share(entry.revenue, analytics.grossRevenue),
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  const byProduct: SalesLine[] = analytics.products
    .map((product) => ({
      name: product.variantName ? `${product.name} · ${product.variantName}` : product.name,
      quantity: product.quantity,
      revenue: product.revenue,
      cogs: product.cogs,
      profit: product.profit,
      share: share(product.revenue, analytics.grossRevenue),
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const byIngredient = await ingredientsUsed(day, analytics.cogsTotal)
  const explained = byIngredient.reduce((sum, line) => sum + line.cost, 0)

  return {
    day,
    date: day.from,
    analytics,
    pnl,
    expenses,
    orders: analytics.orders,
    cups: analytics.cupsSold,
    snacks: analytics.snacksSold,
    byCategory,
    byProduct,
    payments: analytics.payments,
    byIngredient,
    unexplainedCogs: Math.max(0, analytics.cogsTotal - explained),
    uncostedSales: analytics.lumpSumRevenue,
    quiet: analytics.orders === 0,
  }
}

/**
 * What the day's sales took off the shelf.
 *
 * Read from the movement ledger rather than back-calculated from recipes, so a
 * substitution, a spillage correction or a hand adjustment against a sale all
 * show up as what actually happened.
 */
async function ingredientsUsed(day: DateRange, cogsTotal: Money): Promise<CostLine[]> {
  const [movements, ingredients] = await Promise.all([
    db.inventoryMovements.where('occurredAt').between(day.from, day.to, true, true).toArray(),
    db.ingredients.toArray(),
  ])

  const byId = new Map(ingredients.map((entry) => [entry.id, entry]))
  const used = new Map<string, { base: number; cost: Money }>()

  for (const movement of movements) {
    if (movement.deletedAt !== null) continue
    // Only stock that moved because something was sold. A delivery arriving or
    // a stocktake correction is not a cost of the day's drinks.
    if (movement.referenceType !== 'SALE') continue

    // Netted, not counted. A void writes back the exact inverse of what the
    // sale took, so summing signed quantities cancels it; counting only the
    // negatives would leave a voided order's stock sitting in the day's cost.
    const consumed = -movement.baseQuantity
    const entry = used.get(movement.ingredientId) ?? { base: 0, cost: 0 }
    entry.base += consumed
    entry.cost += costOf(consumed, movement.costRate)
    used.set(movement.ingredientId, entry)
  }

  return [...used.entries()]
    .filter(([, entry]) => entry.base > 0 && entry.cost > 0)
    .map(([id, entry]) => {
      const ingredient = byId.get(id)
      return {
        name: ingredient?.name ?? 'Removed ingredient',
        used: ingredient ? formatQuantity(entry.base, ingredient.dimension) : `${entry.base}`,
        cost: entry.cost,
        share: share(entry.cost, cogsTotal),
      }
    })
    .sort((a, b) => b.cost - a.cost)
}

/**
 * The end-of-shift summary, laid out for the till roll.
 *
 * The shop's own name and logo head it, because this is the sheet that gets
 * pinned up or handed over - it has to say whose day it was. Everything under
 * that is the same figures the screen shows, in the order someone reads them
 * when they are standing at a counter with the lights half off.
 */
export function endOfShiftLines(input: {
  summary: EndOfDaySummary
  branding: BrandingSettings
  money: (amount: Money) => string
  paperWidth?: PaperWidth
}): string[] {
  const { summary, branding, money } = input
  const rows: ReceiptRow[] = []

  // The logo itself is drawn by the printer, not by this text; the name is
  // repeated in words so the sheet still identifies the shop if it did not.
  rows.push(row.text(branding.businessName || 'END OF SHIFT', { align: 'center', bold: true, large: true }))
  if (branding.tagline) rows.push(row.text(branding.tagline, { align: 'center' }))
  if (branding.address) rows.push(row.text(branding.address, { align: 'center' }))
  if (branding.contactNumber) rows.push(row.text(branding.contactNumber, { align: 'center' }))

  rows.push(row.feed())
  rows.push(row.text('END OF SHIFT', { align: 'center', bold: true }))
  rows.push(row.text(new Date(summary.date).toLocaleDateString(), { align: 'center' }))
  rows.push(row.text(`Printed ${new Date().toLocaleString()}`, { align: 'center' }))

  rows.push(row.divider(), row.text('COUNTS', { bold: true }))
  rows.push(row.columns('Cups sold', String(summary.cups)))
  for (const entry of summary.analytics.cupsBySize) {
    rows.push(row.columns(`  ${entry.size}`, String(entry.quantity)))
  }
  const sized = summary.analytics.cupsBySize.reduce((sum, entry) => sum + entry.quantity, 0)
  if (summary.cups > sized) {
    rows.push(row.columns('  Not itemised', String(summary.cups - sized)))
  }

  rows.push(row.columns('Snacks sold', String(summary.snacks)))
  for (const entry of summary.analytics.snacksByItem) {
    rows.push(row.columns(`  ${entry.name}`, String(entry.quantity)))
  }

  rows.push(row.columns('Orders', String(summary.orders)))

  rows.push(row.divider(), row.text('TAKINGS', { bold: true }))
  for (const line of summary.byCategory) {
    rows.push(row.columns(`${line.name} (${line.quantity})`, money(line.revenue)))
  }
  rows.push(row.columns('TOTAL SALES', money(summary.analytics.grossRevenue), { bold: true }))

  if (summary.payments.length > 0) {
    rows.push(row.divider(), row.text('HOW IT WAS PAID', { bold: true }))
    for (const slice of summary.payments) {
      rows.push(row.columns(`${slice.label} (${slice.count})`, money(slice.amount)))
    }
  }

  rows.push(row.divider(), row.text("TODAY'S EXPENSES", { bold: true }))
  if (summary.expenses.length === 0) {
    rows.push(row.text('None recorded'))
  } else {
    for (const expense of summary.expenses) {
      rows.push(row.columns(expense.label, money(expense.amount)))
    }
    rows.push(row.columns('TOTAL EXPENSES', money(summary.pnl.totalExpenses), { bold: true }))
  }

  rows.push(row.divider(), row.text('THE MONEY', { bold: true }))
  rows.push(row.columns('Total sales', money(summary.analytics.grossRevenue)))
  rows.push(row.columns('Cost of goods', `-${money(summary.analytics.cogsTotal)}`))
  rows.push(row.columns('Gross profit', money(summary.pnl.grossProfit), { bold: true }))
  if (summary.pnl.totalExpenses > 0) {
    rows.push(row.columns('Expenses', `-${money(summary.pnl.totalExpenses)}`))
  }
  rows.push(row.columns('NET PROFIT', money(summary.pnl.netProfit), { bold: true }))

  if (summary.uncostedSales > 0) {
    rows.push(row.feed())
    rows.push(row.text(`${money(summary.uncostedSales)} entered as a day total, so it has no cost behind it.`))
  }

  rows.push(row.feed())
  rows.push(row.text('Counted by ..........................'))
  rows.push(row.feed())
  rows.push(row.text('Checked by ..........................'))

  return renderPlain(rows, input.paperWidth ?? 58)
}
