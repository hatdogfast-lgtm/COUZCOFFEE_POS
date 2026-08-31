import { addMoney, allocate, percentOf, type Money } from './money.ts'
import { DEFAULT_STATUTORY_RULES } from './types.ts'
import type { DiscountType, SaleItemModifier, StatutoryRule, TaxSettings } from './types.ts'

/**
 * Order pricing: line totals, discounts, and tax.
 *
 * This module is deliberately pure and free of storage or UI concerns so the
 * same arithmetic runs on the POS, in the reports, and on the server when it
 * re-verifies a synced sale. Every amount is an integer in minor units.
 *
 * Senior-citizen and PWD discounts are handled as the statutory concessions
 * they actually are, not as an ordinary 20% off: the VAT is lifted from the
 * sale first, and the discount is then applied to the VAT-exempt amount. The
 * two effects are reported separately because a receipt is required to show
 * them separately.
 */

export interface PricedLine {
  id: string
  quantity: number
  unitPrice: Money
  modifiers: SaleItemModifier[]
  taxable: boolean
  /** Cost of one unit at the moment it entered the cart. */
  unitCogs: Money
}

export interface DiscountInput {
  id: string
  type: DiscountType
  label: string
  /** Percentage for rate-based types; minor units for FIXED. */
  value: number
}

export interface LineTotals {
  id: string
  modifiersTotal: Money
  unitTotal: Money
  lineSubtotal: Money
  lineDiscount: Money
  lineTotal: Money
  lineCogs: Money
}

export interface DiscountBreakdown {
  id: string
  type: DiscountType
  label: string
  value: number
  amount: Money
  taxExempt: boolean
}

export interface OrderTotals {
  lines: LineTotals[]
  discounts: DiscountBreakdown[]
  subtotal: Money
  discountTotal: Money
  /** Tax actually charged. */
  taxTotal: Money
  /** Tax waived by a statutory exemption, shown separately on the receipt. */
  taxExemptTotal: Money
  /** Portion of the sale that tax was computed on. */
  taxableSales: Money
  taxExemptSales: Money
  zeroRatedSales: Money
  total: Money
  cogsTotal: Money
  grossProfit: Money
  marginPercent: number
  itemCount: number
}

/**
 * Whether a discount carries a statutory concession.
 *
 * Decided by the shop's own rules where they are supplied, because which
 * concessions exist - and whether they touch tax at all - is a matter of local
 * law rather than of this code.
 */
export function isStatutoryDiscount(type: DiscountType, rules?: StatutoryRule[]): boolean {
  return (rules ?? DEFAULT_STATUTORY_RULES).some((rule) => rule.enabled && rule.code === type)
}

/** A bare rate means the default concessions, charged at that rate. */
function rulesFrom(statutory: number | StatutoryRule[]): StatutoryRule[] {
  if (typeof statutory !== 'number') return statutory
  return DEFAULT_STATUTORY_RULES.map((rule) => ({ ...rule, rate: statutory }))
}

export function modifiersTotal(modifiers: SaleItemModifier[]): Money {
  return addMoney(...modifiers.map((modifier) => modifier.priceDelta))
}

export function lineUnitTotal(line: PricedLine): Money {
  return line.unitPrice + modifiersTotal(line.modifiers)
}

export function lineSubtotal(line: PricedLine): Money {
  return lineUnitTotal(line) * line.quantity
}

/**
 * Compute every figure a sale needs, in one pass.
 *
 * The statutory concessions come from settings rather than being hard-coded,
 * so the same engine serves a business trading under different law: what the
 * concession is called, what it takes off, and whether it lifts tax at all are
 * all the shop's to state. A bare number means the default concessions at that
 * rate, which is what most callers want.
 */
export function computeTotals(
  lines: PricedLine[],
  discounts: DiscountInput[],
  tax: TaxSettings,
  statutory: number | StatutoryRule[],
): OrderTotals {
  const rules = rulesFrom(statutory)
  const rate = tax.enabled ? tax.rate : 0
  const divisor = 1 + rate / 100

  const grossPerLine = lines.map(lineSubtotal)
  const subtotal = addMoney(...grossPerLine)
  const itemCount = lines.reduce((count, line) => count + line.quantity, 0)
  const cogsTotal = lines.reduce((sum, line) => sum + line.unitCogs * line.quantity, 0)

  const taxableGross = lines.reduce(
    (sum, line, index) => (line.taxable ? sum + (grossPerLine[index] ?? 0) : sum),
    0,
  )
  const untaxedGross = subtotal - taxableGross

  const applied = discounts.find((discount) => isStatutoryDiscount(discount.type, rules))
  const rule = applied ? rules.find((entry) => entry.enabled && entry.code === applied.type) : undefined
  const statutoryRate = rule?.rate ?? 0
  // A concession that does not lift tax is just a percentage off, so the
  // tax-stripping below is skipped and tax is worked out as usual.
  const liftsTax = rule?.liftsTax === true
  const ordinary = discounts.filter((discount) => !isStatutoryDiscount(discount.type, rules))

  const breakdown: DiscountBreakdown[] = []
  let taxTotal = 0
  let taxExemptTotal = 0
  let taxableSales = 0
  let taxExemptSales = 0

  // The base that discounts bite into, and the running balance after each one.
  let discountBase: Money
  let netBeforeTax: Money

  if (applied && liftsTax && tax.enabled && tax.inclusive) {
    // Strip the VAT out of the taxable portion first; that VAT is waived.
    const vatExemptSales = Math.round(taxableGross / divisor)
    taxExemptTotal = taxableGross - vatExemptSales
    discountBase = vatExemptSales + untaxedGross
    taxExemptSales = discountBase
  } else if (applied && liftsTax && tax.enabled && !tax.inclusive) {
    // Prices exclude tax, so there is no VAT embedded to strip; it simply is
    // not charged. Nothing is waived from the displayed price.
    discountBase = subtotal
    taxExemptSales = subtotal
  } else {
    discountBase = subtotal
  }

  if (applied) {
    const amount = percentOf(discountBase, statutoryRate)
    breakdown.push({
      id: applied.id,
      type: applied.type,
      label: applied.label,
      value: statutoryRate,
      amount,
      taxExempt: liftsTax,
    })
    discountBase -= amount
  }

  // Ordinary discounts apply in sequence to whatever balance remains.
  for (const discount of ordinary) {
    // A loyalty claim is the value of specific drinks being given away, so it
    // arrives as an amount rather than a rate - the same as a fixed discount.
    const isAbsolute = discount.type === 'FIXED' || discount.type === 'LOYALTY'
    const amount = isAbsolute
      ? Math.min(Math.max(0, Math.round(discount.value)), discountBase)
      : percentOf(discountBase, discount.value)
    breakdown.push({
      id: discount.id,
      type: discount.type,
      label: discount.label,
      value: discount.value,
      amount,
      taxExempt: false,
    })
    discountBase -= amount
  }

  const discountTotal = addMoney(...breakdown.map((entry) => entry.amount))
  netBeforeTax = discountBase

  let total: Money
  // Exempt only when the concession actually lifted the tax; one that is
  // merely a percentage off leaves the sale taxable.
  if ((applied && liftsTax) || !tax.enabled) {
    // Exempt sale, or tax not configured at all: nothing further to add.
    total = netBeforeTax
    taxableSales = 0
    if (!tax.enabled) taxExemptSales = 0
  } else if (tax.inclusive) {
    // Tax is already inside the price; report how much of it there is.
    const taxableShare = subtotal > 0 ? taxableGross / subtotal : 0
    const taxableNet = Math.round(netBeforeTax * taxableShare)
    taxableSales = Math.round(taxableNet / divisor)
    taxTotal = taxableNet - taxableSales
    total = netBeforeTax
  } else {
    // Tax sits on top of the discounted price.
    const taxableShare = subtotal > 0 ? taxableGross / subtotal : 0
    taxableSales = Math.round(netBeforeTax * taxableShare)
    taxTotal = percentOf(taxableSales, rate)
    total = netBeforeTax + taxTotal
  }

  // Spread the discount back over the lines so per-line margin stays honest.
  const lineDiscounts = allocate(discountTotal, grossPerLine)

  const lineTotals: LineTotals[] = lines.map((line, index) => {
    const gross = grossPerLine[index] ?? 0
    const lineDiscount = lineDiscounts[index] ?? 0
    return {
      id: line.id,
      modifiersTotal: modifiersTotal(line.modifiers),
      unitTotal: lineUnitTotal(line),
      lineSubtotal: gross,
      lineDiscount,
      lineTotal: gross - lineDiscount,
      lineCogs: line.unitCogs * line.quantity,
    }
  })

  const grossProfit = total - taxTotal - cogsTotal
  const revenueNet = total - taxTotal

  return {
    lines: lineTotals,
    discounts: breakdown,
    subtotal,
    discountTotal,
    taxTotal,
    taxExemptTotal,
    taxableSales,
    taxExemptSales,
    zeroRatedSales: 0,
    total,
    cogsTotal,
    grossProfit,
    marginPercent: revenueNet > 0 ? (grossProfit / revenueNet) * 100 : 0,
    itemCount,
  }
}

// ------------------------------------------------------------ product costing --

export interface CostingResult {
  cogs: Money
  price: Money
  grossProfit: Money
  marginPercent: number
  markupPercent: number
}

/** Margin is profit over selling price; markup is profit over cost. */
export function costing(price: Money, cogs: Money): CostingResult {
  const grossProfit = price - cogs
  return {
    cogs,
    price,
    grossProfit,
    marginPercent: price > 0 ? (grossProfit / price) * 100 : 0,
    markupPercent: cogs > 0 ? (grossProfit / cogs) * 100 : 0,
  }
}

/** Change due on a cash payment; never negative. */
export function changeDue(tendered: Money, total: Money): Money {
  return Math.max(0, tendered - total)
}

/** Sensible quick-tender buttons above the amount owed. */
export function quickTenderOptions(total: Money, minorPerMajor = 100): Money[] {
  if (total <= 0) return []
  const steps = [20, 50, 100, 200, 500, 1000]
  const options = new Set<Money>()
  options.add(Math.ceil(total / minorPerMajor) * minorPerMajor)
  for (const step of steps) {
    const value = Math.ceil(total / (step * minorPerMajor)) * step * minorPerMajor
    if (value >= total) options.add(value)
  }
  return [...options].sort((a, b) => a - b).slice(0, 5)
}
