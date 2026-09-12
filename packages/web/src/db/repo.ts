import {
  costOf,
  type BusinessSettings,
  type Ingredient,
  type IngredientUsage,
  type ModifierGroup,
  type ModifierOption,
  type Money,
  type Product,
  type ProductVariant,
  type Recipe,
  type RecipeIngredient,
  type Category,
} from '@pos/shared'
import { db } from './database.ts'
import { isLow } from './lowStock.ts'

/**
 * Read models.
 *
 * Everything here works purely from the device's own database, which is why
 * the till behaves identically online and offline. Stock is derived by summing
 * the movement ledger rather than reading a stored number - the same property
 * that lets two offline devices reconcile correctly also means there is no
 * single "current stock" field that could be wrong.
 */

const alive = <T extends { deletedAt: number | null }>(record: T): boolean => record.deletedAt === null

// ------------------------------------------------------------------- stock --

export type StockMap = Map<string, number>

/** On-hand quantity per ingredient, in base units, from the ledger. */
export async function stockLevels(): Promise<StockMap> {
  const levels: StockMap = new Map()
  await db.inventoryMovements.each((movement) => {
    if (movement.deletedAt !== null) return
    levels.set(movement.ingredientId, (levels.get(movement.ingredientId) ?? 0) + movement.baseQuantity)
  })
  return levels
}

export async function stockOnHand(ingredientId: string): Promise<number> {
  let total = 0
  await db.inventoryMovements
    .where('ingredientId')
    .equals(ingredientId)
    .each((movement) => {
      if (movement.deletedAt === null) total += movement.baseQuantity
    })
  return total
}

// -------------------------------------------------------------------- menu --

/** Everything the POS grid needs, resolved once and held in memory. */
export interface MenuData {
  categories: Category[]
  products: Product[]
  variantsByProduct: Map<string, ProductVariant[]>
  groupsById: Map<string, ModifierGroup>
  optionsByGroup: Map<string, ModifierOption[]>
  recipeByVariant: Map<string, Recipe>
  recipeIngredients: Map<string, RecipeIngredient[]>
  ingredientsById: Map<string, Ingredient>
}

export async function loadMenu(): Promise<MenuData> {
  const [categories, products, variants, groups, options, recipes, recipeIngredients, ingredients] =
    await Promise.all([
      db.categories.toArray(),
      db.products.toArray(),
      db.productVariants.toArray(),
      db.modifierGroups.toArray(),
      db.modifierOptions.toArray(),
      db.recipes.toArray(),
      db.recipeIngredients.toArray(),
      db.ingredients.toArray(),
    ])

  const variantsByProduct = new Map<string, ProductVariant[]>()
  for (const variant of variants.filter((entry) => alive(entry) && entry.active)) {
    const list = variantsByProduct.get(variant.productId) ?? []
    list.push(variant)
    variantsByProduct.set(variant.productId, list)
  }
  for (const list of variantsByProduct.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)

  const optionsByGroup = new Map<string, ModifierOption[]>()
  for (const option of options.filter((entry) => alive(entry) && entry.active)) {
    const list = optionsByGroup.get(option.groupId) ?? []
    list.push(option)
    optionsByGroup.set(option.groupId, list)
  }
  for (const list of optionsByGroup.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)

  const recipeIngredientsByRecipe = new Map<string, RecipeIngredient[]>()
  for (const entry of recipeIngredients.filter(alive)) {
    const list = recipeIngredientsByRecipe.get(entry.recipeId) ?? []
    list.push(entry)
    recipeIngredientsByRecipe.set(entry.recipeId, list)
  }

  return {
    categories: categories.filter((entry) => alive(entry) && entry.active).sort((a, b) => a.sortOrder - b.sortOrder),
    products: products.filter((entry) => alive(entry) && entry.active).sort((a, b) => a.sortOrder - b.sortOrder),
    variantsByProduct,
    groupsById: new Map(groups.filter(alive).map((group) => [group.id, group])),
    optionsByGroup,
    recipeByVariant: new Map(
      recipes.filter((entry) => alive(entry) && entry.active).map((recipe) => [recipe.variantId, recipe]),
    ),
    recipeIngredients: recipeIngredientsByRecipe,
    ingredientsById: new Map(ingredients.filter(alive).map((ingredient) => [ingredient.id, ingredient])),
  }
}

// ------------------------------------------------------------- availability --

export interface Availability {
  /** How many can be made from stock on hand. Infinity when untracked. */
  makeable: number
  outOfStock: boolean
  low: boolean
  /** The ingredient that runs out first, for a useful message. */
  limitingIngredient: string | null
}

/** Add each line's quantity to a running total per ingredient. */
function mergeUsage(into: Map<string, number>, entries: Iterable<IngredientUsage>): void {
  for (const entry of entries) {
    into.set(entry.ingredientId, (into.get(entry.ingredientId) ?? 0) + entry.baseQuantity)
  }
}

/** What the chosen options take from stock, on top of the recipe. */
function optionUsage(modifierOptionIds: string[], menu: MenuData): IngredientUsage[] {
  const usage: IngredientUsage[] = []
  for (const optionId of modifierOptionIds) {
    for (const options of menu.optionsByGroup.values()) {
      const option = options.find((entry) => entry.id === optionId)
      if (!option) continue
      usage.push(...(option.consumption ?? []))
    }
  }
  return usage
}

/**
 * How many of a variant the current stock can actually produce.
 *
 * A product with no recipe is always sellable - a pastry bought in and resold
 * is not blocked because nobody wrote a recipe for it. An add-on that takes
 * from stock counts as well, so a jam that has run out blocks the toast it
 * would have gone on.
 */
export function availabilityOf(
  variantId: string,
  menu: MenuData,
  stock: StockMap,
  /** The options chosen with it, whose own consumption is needed too. */
  modifierOptionIds: string[] = [],
  /**
   * The shop's low-stock rule and how fast things are being used.
   *
   * Left off, the old fixed thresholds still apply - which is the right answer
   * rather than a broken one, so a caller that has no rates to hand is safe.
   */
  lowStock?: { settings: BusinessSettings | null | undefined; rates: Map<string, number> },
): Availability {
  const recipe = menu.recipeByVariant.get(variantId)
  const components = recipe ? (menu.recipeIngredients.get(recipe.id) ?? []) : []

  // Per unit, on each ingredient: the recipe's required lines plus whatever
  // the chosen options add. Merged, so an extra shot on top of the recipe's
  // own beans is judged against the beans once, at the combined amount.
  const demand = new Map<string, number>()
  mergeUsage(demand, components.filter((component) => !component.optional))
  mergeUsage(demand, optionUsage(modifierOptionIds, menu))

  let makeable = Infinity
  let limiting: string | null = null
  let low = false

  for (const [ingredientId, baseQuantity] of demand) {
    const ingredient = menu.ingredientsById.get(ingredientId)
    if (!ingredient || !ingredient.trackStock) continue
    if (baseQuantity <= 0) continue

    const onHand = stock.get(ingredientId) ?? 0
    const possible = Math.floor(onHand / baseQuantity)
    if (possible < makeable) {
      makeable = possible
      limiting = ingredient.name
    }
    if (lowStock) {
      if (isLow({ ingredient, onHandBase: onHand, settings: lowStock.settings, perDay: lowStock.rates.get(ingredient.id) })) {
        low = true
      }
    } else if (ingredient.lowStockThresholdBase > 0 && onHand <= ingredient.lowStockThresholdBase) {
      low = true
    }
  }

  return {
    makeable: makeable === Infinity ? Infinity : Math.max(0, makeable),
    outOfStock: makeable !== Infinity && makeable <= 0,
    low,
    limitingIngredient: limiting,
  }
}

/** Total ingredient consumption for one unit, recipe plus chosen modifiers. */
export function consumptionFor(
  variantId: string,
  modifierOptionIds: string[],
  menu: MenuData,
): IngredientUsage[] {
  const usage = new Map<string, number>()

  const recipe = menu.recipeByVariant.get(variantId)
  if (recipe) mergeUsage(usage, menu.recipeIngredients.get(recipe.id) ?? [])
  mergeUsage(usage, optionUsage(modifierOptionIds, menu))

  return [...usage].map(([ingredientId, baseQuantity]) => ({ ingredientId, baseQuantity }))
}

/** Cost of goods for one unit, at today's ingredient rates. */
export function unitCost(variantId: string, modifierOptionIds: string[], menu: MenuData): Money {
  let total = 0
  for (const item of consumptionFor(variantId, modifierOptionIds, menu)) {
    const ingredient = menu.ingredientsById.get(item.ingredientId)
    if (!ingredient) continue
    total += costOf(item.baseQuantity, ingredient.costRate)
  }
  return total
}

// ------------------------------------------------------------------ lookups --

export async function activeUsers() {
  const users = await db.users.toArray()
  return users.filter((user) => alive(user) && user.active).sort((a, b) => a.name.localeCompare(b.name))
}

export async function openShift() {
  const shifts = await db.shifts.where('status').equals('OPEN').toArray()
  return shifts.filter(alive).sort((a, b) => b.openedAt - a.openedAt)[0] ?? null
}

export async function currentSettings() {
  const all = await db.settings.toArray()
  return all.filter(alive)[0] ?? null
}

export async function recentSales(limit = 50) {
  const sales = await db.sales.orderBy('occurredAt').reverse().limit(limit).toArray()
  return sales.filter(alive)
}
