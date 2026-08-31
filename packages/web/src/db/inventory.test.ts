import { beforeEach, describe, expect, test } from 'vitest'
import {
  costOf,
  costRateFromPurchase,
  fromDecimal,
  toBase,
  type Category,
  type Ingredient,
  type InventoryMovement,
  type Product,
  type ProductVariant,
  type User,
} from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import { stockOnHand } from './repo.ts'
import { receiveStock, recordMovement, recordStockCount, reasonRequiredFor } from './inventory.ts'
import { costRecipe, loadRecipeFor, priceForMargin, saveRecipe, updateVariantPrice } from './recipes.ts'

/**
 * Inventory and recipes, against a real IndexedDB.
 *
 * The behaviour under test is the part an owner would be furious to discover
 * was wrong six months later: that stock adds up, that a delivery at a new
 * price re-costs correctly, and that a recipe edit does not quietly strand
 * rows that will reappear on another device.
 */

let beans: Ingredient
let milk: Ingredient
let cup: Ingredient
let latte: Product
let latte16: ProductVariant
let user: User

const USER_ID = 'USER-1'

async function seed(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()

  user = stamp<User>({
    name: 'Sam', role: 'OWNER', pinHash: 'x', active: true,
    employeeCode: 'S1', failedAttempts: 0, lockedUntil: null, permissionOverrides: {},
  })

  beans = stamp<Ingredient>({
    name: 'Beans', sku: 'B', stockClass: 'INGREDIENT', dimension: 'MASS', displayUnit: 'kg',
    costRate: costRateFromPurchase(fromDecimal(850), 1, 'kg'), supplierId: null,
    lowStockThresholdBase: 500, trackStock: true, active: true,
  })
  milk = stamp<Ingredient>({
    name: 'Milk', sku: 'M', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'L',
    costRate: costRateFromPurchase(fromDecimal(95), 1, 'L'), supplierId: null,
    lowStockThresholdBase: 1000, trackStock: true, active: true,
  })
  cup = stamp<Ingredient>({
    name: 'Cup', sku: 'C', stockClass: 'PACKAGING', dimension: 'COUNT', displayUnit: 'pcs',
    costRate: costRateFromPurchase(fromDecimal(380), 100, 'pcs'), supplierId: null,
    lowStockThresholdBase: 50, trackStock: true, active: true,
  })

  const category = stamp<Category>({ name: 'Hot', colour: '#000', icon: 'Coffee', sortOrder: 0, active: true })
  latte = stamp<Product>({
    categoryId: category.id, name: 'Latte', description: '', sku: 'LAT', imageDataUrl: null,
    active: true, available: true, sortOrder: 0, taxable: true, modifierGroupIds: [],
  })
  latte16 = stamp<ProductVariant>({
    productId: latte.id, name: '16oz', price: fromDecimal(160), sortOrder: 0, active: true, isDefault: true,
  })

  await commit([
    created('users', user),
    created('categories', category),
    created('ingredients', beans),
    created('ingredients', milk),
    created('ingredients', cup),
    created('products', latte),
    created('productVariants', latte16),
    created('inventoryMovements', stamp<InventoryMovement>({
      ingredientId: beans.id, type: 'OPENING', baseQuantity: toBase(1, 'kg'), costRate: beans.costRate,
      reason: '', referenceType: null, referenceId: null, shiftId: null, userId: 'SETUP', occurredAt: Date.now(),
    })),
  ])
  await db.outbox.clear()
}

beforeEach(seed)

describe('recording a stock movement', () => {
  test('a loss cannot be recorded without a reason', async () => {
    await expect(
      recordMovement({ ingredient: beans, type: 'WASTAGE', quantity: -100, unit: 'g', reason: '  ', userId: USER_ID }),
    ).rejects.toThrow(/needs a reason/i)

    // Nothing was written, so the ledger still adds up to the opening stock.
    expect(await stockOnHand(beans.id)).toBe(1000)
  })

  test('a delivery does not need one', async () => {
    await expect(
      recordMovement({ ingredient: beans, type: 'PURCHASE', quantity: 1, unit: 'kg', reason: '', userId: USER_ID }),
    ).resolves.toBeDefined()
  })

  test('the reason rule covers every loss and correction type', () => {
    for (const type of ['WASTAGE', 'SPOILAGE', 'DAMAGE', 'MANUAL_ADJUSTMENT', 'CORRECTION', 'TRANSFER'] as const) {
      expect(reasonRequiredFor(type)).toBe(true)
    }
    for (const type of ['PURCHASE', 'OPENING', 'SALE', 'STOCK_COUNT'] as const) {
      expect(reasonRequiredFor(type)).toBe(false)
    }
  })

  test('a zero movement is refused, because it records nothing', async () => {
    await expect(
      recordMovement({ ingredient: beans, type: 'PURCHASE', quantity: 0, unit: 'g', reason: '', userId: USER_ID }),
    ).rejects.toThrow(/other than zero/i)
  })

  test('quantities convert to the base unit, so kilos and grams agree', async () => {
    await recordMovement({ ingredient: beans, type: 'PURCHASE', quantity: 2, unit: 'kg', reason: '', userId: USER_ID })
    await recordMovement({
      ingredient: beans, type: 'WASTAGE', quantity: -250, unit: 'g', reason: 'spilled', userId: USER_ID,
    })
    expect(await stockOnHand(beans.id)).toBe(1000 + 2000 - 250)
  })

  test('every movement lands with an audit entry beside it', async () => {
    const movement = await recordMovement({
      ingredient: beans, type: 'WASTAGE', quantity: -50, unit: 'g', reason: 'dropped', userId: USER_ID,
    })
    const audit = await db.auditLogs.where('entityId').equals(movement.id).toArray()
    expect(audit).toHaveLength(1)
    expect(audit[0]?.action).toBe('STOCK_WASTAGE')
    expect(audit[0]?.reason).toBe('dropped')
  })

  test('and is queued for the server in the same breath', async () => {
    await recordMovement({
      ingredient: beans, type: 'WASTAGE', quantity: -50, unit: 'g', reason: 'dropped', userId: USER_ID,
    })
    const queued = await db.outbox.toArray()
    expect(queued.filter((entry) => entry.entity === 'inventoryMovements')).toHaveLength(1)
    expect(queued.filter((entry) => entry.entity === 'auditLogs')).toHaveLength(1)
  })
})

describe('taking in a delivery', () => {
  test('adds the stock and leaves the cost alone when no price is given', async () => {
    const result = await receiveStock({
      ingredient: beans, quantity: 1, unit: 'kg', reason: 'weekly order', userId: USER_ID,
    })
    expect(await stockOnHand(beans.id)).toBe(2000)
    expect(result.newCostRate).toBe(beans.costRate)
  })

  test('re-prices as a weighted average, not by simply taking the newest price', async () => {
    // 1 kg on hand at 850. Another 1 kg arrives at 950.
    const result = await receiveStock({
      ingredient: beans,
      quantity: 1,
      unit: 'kg',
      totalCost: fromDecimal(950),
      reason: '',
      userId: USER_ID,
    })

    // The average of the two, not 950: half the shelf still cost 850.
    const expected = costRateFromPurchase(fromDecimal(900), 1, 'kg')
    expect(result.newCostRate).toBe(expected)

    const stored = await db.ingredients.get(beans.id)
    expect(stored?.costRate).toBe(expected)
  })

  test('a re-price is recorded in the audit trail with both figures', async () => {
    await receiveStock({
      ingredient: beans, quantity: 1, unit: 'kg', totalCost: fromDecimal(950), reason: '', userId: USER_ID,
    })
    const audit = await db.auditLogs.where('entityId').equals(beans.id).toArray()
    const priceChange = audit.find((entry) => entry.action === 'COST_CHANGED')
    expect(priceChange).toBeDefined()
    expect(JSON.parse(priceChange?.before ?? '{}').costRate).toBe(beans.costRate)
  })

  test('the first delivery of something with no stock takes that price outright', async () => {
    const result = await receiveStock({
      ingredient: milk, quantity: 2, unit: 'L', totalCost: fromDecimal(220), reason: '', userId: USER_ID,
    })
    expect(result.newCostRate).toBe(costRateFromPurchase(fromDecimal(110), 1, 'L'))
  })

  test('a delivery of nothing is refused', async () => {
    await expect(
      receiveStock({ ingredient: beans, quantity: 0, unit: 'kg', reason: '', userId: USER_ID }),
    ).rejects.toThrow(/more than zero/i)
  })
})

describe('counting the shelf', () => {
  test('writes the difference rather than editing history', async () => {
    // Books say 1000 g; someone counts 940 g.
    const result = await recordStockCount({
      ingredient: beans, countedQuantity: 940, unit: 'g', reason: 'Friday count', userId: USER_ID,
    })

    expect(result.difference).toBe(-60)
    expect(await stockOnHand(beans.id)).toBe(940)

    // The original opening entry is untouched; a correction sits beside it.
    const movements = await db.inventoryMovements.where('ingredientId').equals(beans.id).toArray()
    expect(movements).toHaveLength(2)
    expect(movements.find((entry) => entry.type === 'OPENING')?.baseQuantity).toBe(1000)
    expect(movements.find((entry) => entry.type === 'STOCK_COUNT')?.baseQuantity).toBe(-60)
  })

  test('a count that matches writes nothing at all', async () => {
    const result = await recordStockCount({
      ingredient: beans, countedQuantity: 1, unit: 'kg', reason: '', userId: USER_ID,
    })
    expect(result.difference).toBe(0)
    expect(result.movement).toBeNull()
    expect(await db.inventoryMovements.where('ingredientId').equals(beans.id).count()).toBe(1)
  })

  test('a count above the records adds the difference', async () => {
    const result = await recordStockCount({
      ingredient: beans, countedQuantity: 1200, unit: 'g', reason: '', userId: USER_ID,
    })
    expect(result.difference).toBe(200)
    expect(await stockOnHand(beans.id)).toBe(1200)
  })
})

describe('costing a recipe', () => {
  const ingredientsById = () => new Map([[beans.id, beans], [milk.id, milk], [cup.id, cup]])

  test('separates packaging from ingredients', () => {
    const breakdown = costRecipe(
      [
        { ingredientId: beans.id, baseQuantity: 18, optional: false },
        { ingredientId: milk.id, baseQuantity: 260, optional: false },
        { ingredientId: cup.id, baseQuantity: 1, optional: false },
      ],
      ingredientsById(),
      fromDecimal(160),
    )

    expect(breakdown.ingredientCost).toBe(costOf(18, beans.costRate) + costOf(260, milk.costRate))
    expect(breakdown.packagingCost).toBe(costOf(1, cup.costRate))
    expect(breakdown.cogs).toBe(breakdown.ingredientCost + breakdown.packagingCost)
  })

  test('reports margin on price and markup on cost, which are different numbers', () => {
    const breakdown = costRecipe(
      [{ ingredientId: beans.id, baseQuantity: 100, optional: false }],
      ingredientsById(),
      fromDecimal(200),
    )
    // 100 g of beans at 850/kg = 85.00, sold at 200.00.
    expect(breakdown.cogs).toBe(fromDecimal(85))
    expect(breakdown.grossProfit).toBe(fromDecimal(115))
    expect(breakdown.marginPercent).toBeCloseTo(57.5, 6)
    expect(breakdown.markupPercent).toBeCloseTo(135.29, 1)
  })

  test('each line reports its share of the cost', () => {
    const breakdown = costRecipe(
      [
        { ingredientId: beans.id, baseQuantity: 100, optional: false },
        { ingredientId: cup.id, baseQuantity: 1, optional: false },
      ],
      ingredientsById(),
      fromDecimal(200),
    )
    const total = breakdown.lines.reduce((sum, line) => sum + line.share, 0)
    expect(total).toBeCloseTo(1, 6)
  })

  test('an empty recipe costs nothing and does not divide by zero', () => {
    const breakdown = costRecipe([], ingredientsById(), fromDecimal(100))
    expect(breakdown.cogs).toBe(0)
    expect(breakdown.marginPercent).toBe(100)
    expect(breakdown.markupPercent).toBe(0)
  })

  test('an ingredient that no longer exists costs nothing rather than crashing', () => {
    const breakdown = costRecipe(
      [{ ingredientId: 'GONE', baseQuantity: 100, optional: false }],
      ingredientsById(),
      fromDecimal(100),
    )
    expect(breakdown.cogs).toBe(0)
    expect(breakdown.lines[0]?.name).toBe('Unknown ingredient')
  })
})

describe('saving a recipe', () => {
  test('creates the recipe and its ingredients', async () => {
    await saveRecipe({
      variant: latte16,
      components: [
        { ingredientId: beans.id, baseQuantity: 18, optional: false },
        { ingredientId: milk.id, baseQuantity: 260, optional: false },
      ],
      notes: 'steam to 65C',
      userId: USER_ID,
    })

    const { recipe, components } = await loadRecipeFor(latte16.id)
    expect(recipe?.notes).toBe('steam to 65C')
    expect(components).toHaveLength(2)
  })

  test('editing changes quantities without duplicating rows', async () => {
    await saveRecipe({
      variant: latte16,
      components: [{ ingredientId: beans.id, baseQuantity: 18, optional: false }],
      notes: '',
      userId: USER_ID,
    })
    await saveRecipe({
      variant: latte16,
      components: [{ ingredientId: beans.id, baseQuantity: 21, optional: false }],
      notes: '',
      userId: USER_ID,
    })

    const { components } = await loadRecipeFor(latte16.id)
    expect(components).toHaveLength(1)
    expect(components[0]?.baseQuantity).toBe(21)
  })

  test('a removed ingredient is tombstoned, not hard deleted', async () => {
    await saveRecipe({
      variant: latte16,
      components: [
        { ingredientId: beans.id, baseQuantity: 18, optional: false },
        { ingredientId: milk.id, baseQuantity: 260, optional: false },
      ],
      notes: '',
      userId: USER_ID,
    })
    await saveRecipe({
      variant: latte16,
      components: [{ ingredientId: beans.id, baseQuantity: 18, optional: false }],
      notes: '',
      userId: USER_ID,
    })

    const { components } = await loadRecipeFor(latte16.id)
    expect(components).toHaveLength(1)

    // The row still exists, carrying a deletion that can reach other devices.
    // A hard delete could not travel, and the ingredient would come back on
    // the next sync from a till that still had it.
    const all = await db.recipeIngredients.toArray()
    const removed = all.find((row) => row.ingredientId === milk.id)
    expect(removed).toBeDefined()
    expect(removed?.deletedAt).not.toBeNull()

    const queued = await db.outbox.toArray()
    expect(queued.some((entry) => entry.entityId === removed?.id && entry.op === 'DELETE')).toBe(true)
  })

  test('saving is recorded in the audit trail', async () => {
    await saveRecipe({
      variant: latte16,
      components: [{ ingredientId: beans.id, baseQuantity: 18, optional: false }],
      notes: '',
      userId: USER_ID,
    })
    const audit = await db.auditLogs.toArray()
    expect(audit.some((entry) => entry.action === 'RECIPE_CREATED')).toBe(true)
  })
})

describe('changing a price', () => {
  test('records who changed it and what it was before', async () => {
    const revised = await updateVariantPrice({
      variant: latte16, price: fromDecimal(175), userId: USER_ID, reason: 'bean cost up',
    })

    expect(revised.price).toBe(fromDecimal(175))
    expect(revised.version).toBe(latte16.version + 1)

    const audit = await db.auditLogs.where('entityId').equals(latte16.id).toArray()
    const change = audit.find((entry) => entry.action === 'PRICE_CHANGED')
    expect(JSON.parse(change?.before ?? '{}').price).toBe(fromDecimal(160))
    expect(JSON.parse(change?.after ?? '{}').price).toBe(fromDecimal(175))
    expect(change?.reason).toBe('bean cost up')
  })

  test('setting the same price changes nothing', async () => {
    await updateVariantPrice({ variant: latte16, price: fromDecimal(160), userId: USER_ID })
    expect(await db.auditLogs.count()).toBe(0)
  })

  test('a negative price is refused', async () => {
    await expect(
      updateVariantPrice({ variant: latte16, price: -100, userId: USER_ID }),
    ).rejects.toThrow(/cannot be negative/i)
  })
})

describe('suggesting a price', () => {
  test('hits the target margin, rounded up to a whole unit', () => {
    // 60.00 cost at a 70% margin needs 200.00.
    expect(priceForMargin(fromDecimal(60), 70)).toBe(fromDecimal(200))
  })

  test('never suggests a price below cost', () => {
    for (const margin of [10, 25, 50, 75]) {
      expect(priceForMargin(fromDecimal(60), margin)).toBeGreaterThan(fromDecimal(60))
    }
  })

  test('rounds up so the menu board reads cleanly', () => {
    const suggestion = priceForMargin(fromDecimal(43.21), 65)
    expect(suggestion % 100).toBe(0)
  })
})

describe('margin against a tax-inclusive price', () => {
  const ingredientsById = () => new Map([[beans.id, beans], [milk.id, milk], [cup.id, cup]])
  // Lazy: the fixtures are built in setup, so they do not exist yet here.
  const components = () => [{ ingredientId: beans.id, baseQuantity: 18, optional: false }]
  const VAT = { enabled: true, rate: 12, inclusive: true }

  test('takes the tax out before working out profit', () => {
    // On a VAT-inclusive menu the tax sits inside the shelf price and belongs
    // to the government, so counting it as profit overstates every drink.
    const breakdown = costRecipe(components(), ingredientsById(), fromDecimal(112), VAT)

    expect(breakdown.price).toBe(fromDecimal(112))
    expect(breakdown.netPrice).toBe(fromDecimal(100))
    expect(breakdown.taxInPrice).toBe(fromDecimal(12))
    expect(breakdown.grossProfit).toBe(fromDecimal(100) - breakdown.cogs)
  })

  test('reports a lower margin than the gross price suggests', () => {
    const gross = costRecipe(components(), ingredientsById(), fromDecimal(112))
    const net = costRecipe(components(), ingredientsById(), fromDecimal(112), VAT)

    expect(net.marginPercent).toBeLessThan(gross.marginPercent)
  })

  test('leaves an exclusive menu alone, where tax is added at the till', () => {
    const breakdown = costRecipe(components(), ingredientsById(), fromDecimal(100), {
      enabled: true,
      rate: 12,
      inclusive: false,
    })
    expect(breakdown.netPrice).toBe(fromDecimal(100))
    expect(breakdown.taxInPrice).toBe(0)
  })

  test('leaves a shop with tax switched off alone', () => {
    const breakdown = costRecipe(components(), ingredientsById(), fromDecimal(100), {
      enabled: false,
      rate: 12,
      inclusive: true,
    })
    expect(breakdown.netPrice).toBe(fromDecimal(100))
  })

  test('reports what it always did when nobody passes the tax settings', () => {
    // An older caller must not be silently changed underneath.
    const breakdown = costRecipe(components(), ingredientsById(), fromDecimal(112))
    expect(breakdown.netPrice).toBe(fromDecimal(112))
    expect(breakdown.taxInPrice).toBe(0)
  })

  test('agrees with the profit and loss statement, which also nets tax off first', () => {
    // Both should treat a 112 sale at 12% inclusive as 100 of revenue.
    const breakdown = costRecipe([], ingredientsById(), fromDecimal(112), VAT)
    expect(breakdown.netPrice).toBe(fromDecimal(112) - fromDecimal(12))
  })
})
