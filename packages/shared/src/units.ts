/**
 * Unit handling for ingredients and packaging.
 *
 * Everything is normalised to a base unit per dimension (g / ml / pcs) the
 * moment it enters the system. Recipes, stock levels and inventory movements
 * are all stored in base units, so a purchase in kilos and a recipe in grams
 * reconcile exactly without repeated conversion.
 */

export const DIMENSIONS = ['MASS', 'VOLUME', 'COUNT'] as const
export type Dimension = (typeof DIMENSIONS)[number]

export const UNITS = ['g', 'kg', 'ml', 'L', 'pcs'] as const
export type Unit = (typeof UNITS)[number]

interface UnitSpec {
  dimension: Dimension
  /** How many base units one of this unit represents. */
  perBase: number
  label: string
}

const UNIT_TABLE: Record<Unit, UnitSpec> = {
  g: { dimension: 'MASS', perBase: 1, label: 'gram' },
  kg: { dimension: 'MASS', perBase: 1000, label: 'kilogram' },
  ml: { dimension: 'VOLUME', perBase: 1, label: 'millilitre' },
  L: { dimension: 'VOLUME', perBase: 1000, label: 'litre' },
  pcs: { dimension: 'COUNT', perBase: 1, label: 'piece' },
}

export const BASE_UNIT: Record<Dimension, Unit> = {
  MASS: 'g',
  VOLUME: 'ml',
  COUNT: 'pcs',
}

export function isUnit(value: unknown): value is Unit {
  return typeof value === 'string' && (UNITS as readonly string[]).includes(value)
}

export function unitDimension(unit: Unit): Dimension {
  return UNIT_TABLE[unit].dimension
}

export function unitLabel(unit: Unit): string {
  return UNIT_TABLE[unit].label
}

export function sameDimension(a: Unit, b: Unit): boolean {
  return unitDimension(a) === unitDimension(b)
}

/** Convert a quantity into its dimension's base unit (kg -> g, L -> ml). */
export function toBase(quantity: number, unit: Unit): number {
  return quantity * UNIT_TABLE[unit].perBase
}

/** Convert a base-unit quantity back into a display unit. */
export function fromBase(quantity: number, unit: Unit): number {
  return quantity / UNIT_TABLE[unit].perBase
}

export function convert(quantity: number, from: Unit, to: Unit): number {
  if (!sameDimension(from, to)) {
    throw new Error(`Cannot convert ${from} to ${to}: different kinds of measurement`)
  }
  return fromBase(toBase(quantity, from), to)
}

/**
 * The unit a person would naturally write a quantity in.
 *
 * A recipe calls for 18 g of coffee, not 0.018 kg, even though the beans are
 * bought by the kilo. Small amounts get the base unit; large ones get the
 * bigger one.
 */
export function naturalUnit(baseQuantity: number, dimension: Dimension): Unit {
  if (dimension === 'COUNT') return 'pcs'
  const large: Unit = dimension === 'MASS' ? 'kg' : 'L'
  return Math.abs(baseQuantity) >= 1000 ? large : BASE_UNIT[dimension]
}

/** Pick the friendliest unit for showing a base-unit quantity. */
export function formatQuantity(baseQuantity: number, dimension: Dimension): string {
  if (dimension === 'COUNT') {
    return `${round(baseQuantity, 2)} pcs`
  }
  const large: Unit = dimension === 'MASS' ? 'kg' : 'L'
  const small: Unit = BASE_UNIT[dimension]
  if (Math.abs(baseQuantity) >= 1000) return `${round(fromBase(baseQuantity, large), 3)} ${large}`
  return `${round(baseQuantity, 2)} ${small}`
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * Ingredient cost is held as micro-minor-units per base unit, because a cost
 * like "9.5 centavos per ml" has no exact integer representation in centavos.
 * Storing the rate scaled by a million keeps recipe costing exact.
 */
export const COST_PRECISION = 1_000_000

/** e.g. a 1 kg bag of beans bought for 85000 centavos -> 85_000_000 per gram. */
export function costRateFromPurchase(totalCost: number, quantity: number, unit: Unit): number {
  const baseQuantity = toBase(quantity, unit)
  if (baseQuantity <= 0) throw new Error('Purchase quantity must be greater than zero')
  return Math.round((totalCost * COST_PRECISION) / baseQuantity)
}

/** Cost, in minor units, of consuming `baseQuantity` at the given rate. */
export function costOf(baseQuantity: number, costRate: number): number {
  return Math.round((baseQuantity * costRate) / COST_PRECISION)
}
