import {
  costOf,
  costing,
  type AuditLog,
  type Ingredient,
  type Money,
  type ProductVariant,
  type Recipe,
  type RecipeIngredient,
} from '@pos/shared'
import { db } from './database.ts'
import { commit, created, deleted, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * Recipes and what they cost.
 *
 * A recipe belongs to a variant rather than a product, because a 16oz latte
 * and a 12oz latte are different drinks in both price and ingredients. The
 * cost of one is derived from current ingredient rates every time it is asked
 * for, so re-pricing a sack of beans immediately re-prices everything made
 * from it - while sales already recorded keep the cost they were sold at.
 */

export interface RecipeComponent {
  ingredientId: string
  /** Always in the ingredient's base unit. */
  baseQuantity: number
  optional: boolean
}

export interface CostBreakdown {
  ingredientCost: Money
  packagingCost: Money
  otherCost: Money
  /** Cost of labour lines, whether or not it is counted in the total. */
  labourCost: Money
  /** Whether labourCost is inside cogs. */
  labourCounted: boolean
  cogs: Money
  /** What the customer pays, tax included where the shop prices that way. */
  price: Money
  /** What the shop actually keeps once tax is set aside. Margin uses this. */
  netPrice: Money
  /** Tax inside the price, and therefore never part of profit. */
  taxInPrice: Money
  grossProfit: Money
  marginPercent: number
  markupPercent: number
  lines: Array<{
    ingredientId: string
    name: string
    baseQuantity: number
    cost: Money
    /** Share of total cost, for showing what actually drives the number. */
    share: number
  }>
}

/**
 * Cost a recipe at today's ingredient rates.
 *
 * Packaging is separated from ingredients because a cup and a lid are a real
 * and often surprising share of a drink's cost, and an owner deciding on a
 * price needs to see that split rather than one merged figure.
 */
export function costRecipe(
  components: RecipeComponent[],
  ingredientsById: Map<string, Ingredient>,
  price: Money,
  /**
   * The shop's tax settings.
   *
   * Without them the margin is measured against money that was never the
   * shop's - on a VAT-inclusive menu the tax sits inside the shelf price and
   * belongs to the government. Left out, this reports the same figure it
   * always did, so an old caller is not silently changed.
   */
  tax?: { enabled: boolean; rate: number; inclusive: boolean },
  options?: { includeLabour?: boolean },
): CostBreakdown {
  let ingredientCost = 0
  let packagingCost = 0
  let otherCost = 0
  let labourCost = 0

  const lines = components.map((component) => {
    const ingredient = ingredientsById.get(component.ingredientId)
    const cost = ingredient ? costOf(component.baseQuantity, ingredient.costRate) : 0

    if (ingredient?.stockClass === 'PACKAGING') packagingCost += cost
    else if (ingredient?.stockClass === 'RETAIL') otherCost += cost
    else if (ingredient?.stockClass === 'LABOUR') labourCost += cost
    else ingredientCost += cost

    return {
      ingredientId: component.ingredientId,
      name: ingredient?.name ?? 'Unknown ingredient',
      baseQuantity: component.baseQuantity,
      cost,
      share: 0,
    }
  })

  // Labour counts only when the shop has asked for it, so a margin never
  // changes underneath somebody who never turned it on.
  const labourCounted = options?.includeLabour === true
  const cogs = ingredientCost + packagingCost + otherCost + (labourCounted ? labourCost : 0)
  for (const line of lines) line.share = cogs > 0 ? line.cost / cogs : 0

  // Only an inclusive price has tax hiding inside it. On an exclusive menu the
  // shelf price is already the shop's, and the tax is added at the till.
  const netPrice =
    tax?.enabled && tax.inclusive && tax.rate > 0
      ? Math.round(price / (1 + tax.rate / 100))
      : price

  const result = costing(netPrice, cogs)
  return {
    ingredientCost,
    packagingCost,
    otherCost,
    labourCost,
    labourCounted,
    cogs,
    price,
    netPrice,
    taxInPrice: price - netPrice,
    grossProfit: result.grossProfit,
    marginPercent: result.marginPercent,
    markupPercent: result.markupPercent,
    lines,
  }
}

/** Everything the recipe editor needs for one variant. */
export async function loadRecipeFor(variantId: string): Promise<{
  recipe: Recipe | null
  components: RecipeComponent[]
}> {
  const recipes = await db.recipes.where('variantId').equals(variantId).toArray()
  const recipe = recipes.find((entry) => entry.deletedAt === null && entry.active) ?? null
  if (!recipe) return { recipe: null, components: [] }

  const rows = await db.recipeIngredients.where('recipeId').equals(recipe.id).toArray()
  const components = rows
    .filter((row) => row.deletedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => ({
      ingredientId: row.ingredientId,
      baseQuantity: row.baseQuantity,
      optional: row.optional,
    }))

  return { recipe, components }
}

/**
 * Save a recipe.
 *
 * Rows that are gone are tombstoned rather than deleted outright: a hard
 * delete cannot travel to another device, and the ingredient would quietly
 * reappear on the next sync from a till that still had it.
 */
export async function saveRecipe(input: {
  variant: ProductVariant
  components: RecipeComponent[]
  notes: string
  userId: string
}): Promise<Recipe> {
  const now = Date.now()
  const writes: PendingWrite[] = []

  const { recipe: existing } = await loadRecipeFor(input.variant.id)

  const recipe =
    existing ??
    stamp<Recipe>({
      variantId: input.variant.id,
      productId: input.variant.productId,
      yieldQuantity: 1,
      notes: input.notes,
      active: true,
    })

  if (existing) {
    if (existing.notes !== input.notes) {
      writes.push(updated('recipes', revise(existing, { notes: input.notes }, now)))
    }
  } else {
    writes.push(created('recipes', recipe))
  }

  const currentRows = existing
    ? (await db.recipeIngredients.where('recipeId').equals(recipe.id).toArray()).filter(
        (row) => row.deletedAt === null,
      )
    : []
  const byIngredient = new Map(currentRows.map((row) => [row.ingredientId, row]))
  const keep = new Set(input.components.map((component) => component.ingredientId))

  input.components.forEach((component, index) => {
    const row = byIngredient.get(component.ingredientId)
    if (!row) {
      writes.push(
        created(
          'recipeIngredients',
          stamp<RecipeIngredient>({
            recipeId: recipe.id,
            ingredientId: component.ingredientId,
            baseQuantity: component.baseQuantity,
            optional: component.optional,
            sortOrder: index,
          }),
        ),
      )
      return
    }
    const changed =
      row.baseQuantity !== component.baseQuantity ||
      row.optional !== component.optional ||
      row.sortOrder !== index
    if (changed) {
      writes.push(
        updated(
          'recipeIngredients',
          revise(
            row,
            { baseQuantity: component.baseQuantity, optional: component.optional, sortOrder: index },
            now,
          ),
        ),
      )
    }
  })

  for (const row of currentRows) {
    if (keep.has(row.ingredientId)) continue
    writes.push(deleted('recipeIngredients', revise(row, { deletedAt: now }, now)))
  }

  writes.push(
    created(
      'auditLogs',
      stamp<AuditLog>({
        entityType: 'recipes',
        entityId: recipe.id,
        action: existing ? 'RECIPE_UPDATED' : 'RECIPE_CREATED',
        userId: input.userId,
        before: existing ? JSON.stringify({ components: currentRows.length }) : null,
        after: JSON.stringify({ components: input.components.length }),
        reason: '',
        occurredAt: now,
      }),
    ),
  )

  await commit(writes, now)
  return recipe
}

/** Change a selling price, keeping a record of who changed it and from what. */
export async function updateVariantPrice(input: {
  variant: ProductVariant
  price: Money
  userId: string
  reason?: string
}): Promise<ProductVariant> {
  if (input.price < 0) throw new Error('A price cannot be negative.')
  if (input.price === input.variant.price) return input.variant

  const now = Date.now()
  const revised = revise(input.variant, { price: input.price }, now)

  await commit(
    [
      updated('productVariants', revised),
      created(
        'auditLogs',
        stamp<AuditLog>({
          entityType: 'productVariants',
          entityId: input.variant.id,
          action: 'PRICE_CHANGED',
          userId: input.userId,
          before: JSON.stringify({ price: input.variant.price }),
          after: JSON.stringify({ price: input.price }),
          reason: input.reason ?? '',
          occurredAt: now,
        }),
      ),
    ],
    now,
  )
  return revised
}

/**
 * Suggest a price that hits a target margin.
 *
 * Rounded up to a whole currency unit, because a menu board with prices like
 * 147.83 on it is nobody's idea of a menu board.
 */
export function priceForMargin(cogs: Money, marginPercent: number, minorPerMajor = 100): Money {
  if (marginPercent >= 100) return cogs * 10
  const raw = cogs / (1 - marginPercent / 100)
  return Math.ceil(raw / minorPerMajor) * minorPerMajor
}
