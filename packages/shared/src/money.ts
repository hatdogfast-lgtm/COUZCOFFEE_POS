/**
 * Money is stored and computed exclusively in integer minor units (centavos).
 * Floating point never touches a price, a total, or a cost. Formatting to a
 * decimal string happens only at the edge, for display and printing.
 */

export type Money = number // integer minor units

export const ZERO: Money = 0

export function fromDecimal(value: number | string, minorPerMajor = 100): Money {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric)) throw new Error(`Not a valid amount: ${value}`)
  return Math.round(numeric * minorPerMajor)
}

export function toDecimal(amount: Money, minorPerMajor = 100): number {
  return amount / minorPerMajor
}

export function addMoney(...amounts: Money[]): Money {
  return amounts.reduce((sum, amount) => sum + amount, 0)
}

export function multiplyMoney(amount: Money, quantity: number): Money {
  return Math.round(amount * quantity)
}

/** Percentage of an amount, rounded half-up to the nearest minor unit. */
export function percentOf(amount: Money, percent: number): Money {
  return Math.round((amount * percent) / 100)
}

export function clampMoney(amount: Money, min: Money, max: Money): Money {
  return Math.min(Math.max(amount, min), max)
}

/**
 * Distribute a total across weighted parts without losing or inventing a
 * centavo. Used to spread an order-level discount back over line items so
 * per-line margin reporting stays exact.
 */
export function allocate(total: Money, weights: number[]): Money[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0) return weights.map(() => 0)

  const shares = weights.map((weight) => Math.floor((total * weight) / totalWeight))
  let remainder = total - shares.reduce((sum, share) => sum + share, 0)

  // Hand the leftover minor units to the largest weights first.
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight)

  let cursor = 0
  while (remainder > 0 && order.length > 0) {
    const target = order[cursor % order.length]
    if (target) shares[target.index] = (shares[target.index] ?? 0) + 1
    remainder--
    cursor++
  }
  return shares
}

export interface CurrencyFormat {
  code: string
  symbol: string
  minorPerMajor: number
  locale: string
}

export const DEFAULT_CURRENCY: CurrencyFormat = {
  code: 'PHP',
  symbol: '\u20B1',
  minorPerMajor: 100,
  locale: 'en-PH',
}

export function formatMoney(amount: Money, currency: CurrencyFormat = DEFAULT_CURRENCY): string {
  const digits = Math.max(0, Math.round(Math.log10(currency.minorPerMajor)))
  const formatted = Math.abs(toDecimal(amount, currency.minorPerMajor)).toLocaleString(currency.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${amount < 0 ? '-' : ''}${currency.symbol}${formatted}`
}
