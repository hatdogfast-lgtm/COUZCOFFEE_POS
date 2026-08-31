import type { BusinessSettings, Category, PaymentMethod, ServingUnit } from '@pos/shared'

/**
 * What this till is allowed to do, and how it counts what it sells.
 *
 * Both are settings, and both have to answer sensibly for a shop that was set
 * up before they existed - a missing field must never leave a till unable to
 * take money, and must never silently switch on something an owner has not
 * asked for.
 */

export interface TillPolicy {
  /** Whether an order may be recorded against a day other than today. */
  backdatingEnabled: boolean
  /** Methods that will not be accepted without a reference number. */
  requireReferenceFor: PaymentMethod[]
}

export function tillPolicy(settings: BusinessSettings | null | undefined): TillPolicy {
  return {
    // Absent means off. Backdating rewrites the books, so it is the one
    // default that must never be inherited by accident.
    backdatingEnabled: settings?.backdatingEnabled === true,
    requireReferenceFor: Array.isArray(settings?.requireReferenceFor) ? settings.requireReferenceFor : [],
  }
}

export function referenceRequired(
  settings: BusinessSettings | null | undefined,
  method: PaymentMethod,
): boolean {
  return tillPolicy(settings).requireReferenceFor.includes(method)
}

// ---------------------------------------------------------------- counting --

/**
 * How a category is counted.
 *
 * Older categories carry no answer, and a coffee shop's categories are
 * overwhelmingly drinks, so the fallback is a cup. A shop marks its pastry and
 * snack categories once and every product filed under them is counted right
 * from then on, including ones added later.
 */
export function servingUnitOf(category: Pick<Category, 'servingUnit'> | undefined | null): ServingUnit {
  return category?.servingUnit === 'PIECE' ? 'PIECE' : 'CUP'
}

export interface Counts {
  cups: number
  snacks: number
  total: number
}

export const NO_COUNTS: Counts = { cups: 0, snacks: 0, total: 0 }

export function addCounts(a: Counts, b: Counts): Counts {
  return { cups: a.cups + b.cups, snacks: a.snacks + b.snacks, total: a.total + b.total }
}

/** Split a set of lines into cups and pieces. */
export function countLines(
  lines: Array<{ quantity: number; servingUnit?: ServingUnit }>,
): Counts {
  let cups = 0
  let snacks = 0
  for (const line of lines) {
    if (line.servingUnit === 'PIECE') snacks += line.quantity
    else cups += line.quantity
  }
  return { cups, snacks, total: cups + snacks }
}

/**
 * The counts on a stored sale.
 *
 * A sale written before the split existed only has a total. Reporting it as
 * zero cups would be a lie about the day, so the whole of it is attributed to
 * cups - which is what it was being reported as before the split existed.
 */
export function countsOfSale(sale: {
  itemCount: number
  cupCount?: number
  snackCount?: number
}): Counts {
  if (sale.cupCount === undefined && sale.snackCount === undefined) {
    return { cups: sale.itemCount, snacks: 0, total: sale.itemCount }
  }
  const cups = sale.cupCount ?? 0
  const snacks = sale.snackCount ?? 0
  return { cups, snacks, total: cups + snacks }
}

export function describeCounts(counts: Counts): string {
  const parts: string[] = []
  if (counts.cups > 0) parts.push(`${counts.cups} ${counts.cups === 1 ? 'cup' : 'cups'}`)
  if (counts.snacks > 0) parts.push(`${counts.snacks} ${counts.snacks === 1 ? 'snack' : 'snacks'}`)
  return parts.join(' · ') || 'Nothing yet'
}
