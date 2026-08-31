import { lowStockOf, type BusinessSettings, type Ingredient } from '@pos/shared'
import { db } from './database.ts'

/**
 * When to say an ingredient is running low.
 *
 * A fixed threshold is a number somebody typed once and then trade changed
 * around it: the shop that set "warn me at 500g of beans" in a quiet month is
 * caught out the first busy week. Working the level out from what has actually
 * been used means the warning keeps up on its own, which is the difference
 * between a system that needs looking after and one that does not.
 *
 * Which of the two applies - or both - is the shop's to choose.
 */

export interface UsageRate {
  ingredientId: string
  /** Base units consumed per day, averaged over the lookback window. */
  perDay: number
}

const DAY = 24 * 60 * 60 * 1000

/**
 * How fast each ingredient is being got through.
 *
 * Read from the movement ledger and counted only where stock left because
 * something was sold, so a delivery arriving or a stocktake correction does not
 * look like a burst of demand.
 */
export async function usageRates(lookbackDays: number, now = Date.now()): Promise<Map<string, number>> {
  const days = Math.max(1, Math.round(lookbackDays))
  const from = now - days * DAY

  const movements = await db.inventoryMovements.where('occurredAt').between(from, now, true, true).toArray()

  const consumed = new Map<string, number>()
  for (const movement of movements) {
    if (movement.deletedAt !== null) continue
    if (movement.referenceType !== 'SALE') continue
    // Netted, so a voided order's stock going back on the shelf is not counted
    // as having been used.
    consumed.set(movement.ingredientId, (consumed.get(movement.ingredientId) ?? 0) - movement.baseQuantity)
  }

  const rates = new Map<string, number>()
  for (const [ingredientId, total] of consumed) {
    if (total > 0) rates.set(ingredientId, total / days)
  }
  return rates
}

/**
 * Whether this ingredient counts as low, under the shop's chosen rule.
 *
 * An ingredient nobody has used has no rate to measure, so the usage rule says
 * nothing about it rather than guessing - silence is the honest answer, and the
 * fixed threshold is still there for anyone who wants a floor.
 */
export function isLow(input: {
  ingredient: Ingredient
  onHandBase: number
  settings: BusinessSettings | null | undefined
  /** Base units used per day, where it is known. */
  perDay?: number
}): boolean {
  const rule = lowStockOf(input.settings ?? {})
  if (!rule.enabled) return false
  if (!input.ingredient.trackStock) return false

  const byFixed =
    input.ingredient.lowStockThresholdBase > 0 && input.onHandBase <= input.ingredient.lowStockThresholdBase

  const perDay = input.perDay ?? 0
  const byUsage = perDay > 0 && input.onHandBase / perDay <= rule.daysOfCover

  switch (rule.basis) {
    case 'FIXED':
      return byFixed
    case 'USAGE':
      return byUsage
    case 'EITHER':
      return byFixed || byUsage
    default:
      return byFixed
  }
}

/** How many days of stock remain at the current rate, or null if unknown. */
export function daysOfCover(onHandBase: number, perDay: number | undefined): number | null {
  if (!perDay || perDay <= 0) return null
  return onHandBase / perDay
}
