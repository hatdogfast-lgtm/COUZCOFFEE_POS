import { beforeEach, describe, expect, test } from 'vitest'
import {
  costOf,
  costRateFromPurchase,
  fromDecimal,
  type Category,
  type Ingredient,
  type InventoryMovement,
  type Product,
  type ProductVariant,
  type Recipe,
  type RecipeIngredient,
} from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import { addModifierOption, createModifierGroup, updateModifierOption } from './modifiers.ts'
import { availabilityOf, consumptionFor, loadMenu, stockLevels, unitCost } from './repo.ts'

/**
 * An option that takes something from stock.
 *
 * The sale engine has always merged an option's consumption into the recipe;
 * these prove the shop can actually say what that consumption is, that a
 * nonsense line is refused rather than quietly skipped, and that once saved
 * it reaches the costing and the ledger.
 */

let jam: Ingredient
let beans: Ingredient
let latte16: ProductVariant

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()

  jam = stamp<Ingredient>({
    name: 'Strawberry Jam', sku: 'JAM', stockClass: 'INGREDIENT', dimension: 'MASS', displayUnit: 'g',
    costRate: costRateFromPurchase(12000, 1, 'kg'), supplierId: null,
    lowStockThresholdBase: 100, trackStock: true, active: true,
  })
  beans = stamp<Ingredient>({
    name: 'Beans', sku: 'B', stockClass: 'INGREDIENT', dimension: 'MASS', displayUnit: 'kg',
    costRate: costRateFromPurchase(85000, 1, 'kg'), supplierId: null,
    lowStockThresholdBase: 500, trackStock: true, active: true,
  })

  const category = stamp<Category>({ name: 'Hot', colour: '#000', icon: 'Coffee', sortOrder: 0, active: true })
  const latte = stamp<Product>({
    categoryId: category.id, name: 'Latte', description: '', sku: 'LAT', imageDataUrl: null,
    active: true, available: true, sortOrder: 0, taxable: true, modifierGroupIds: [],
  })
  latte16 = stamp<ProductVariant>({
    productId: latte.id, name: '16oz', price: fromDecimal(160), sortOrder: 0, active: true, isDefault: true,
  })
  const recipe = stamp<Recipe>({
    variantId: latte16.id, productId: latte.id, yieldQuantity: 1, notes: '', active: true,
  })

  await commit([
    created('categories', category),
    created('ingredients', jam),
    created('ingredients', beans),
    created('products', latte),
    created('productVariants', latte16),
    created('recipes', recipe),
    created('recipeIngredients', stamp<RecipeIngredient>({
      recipeId: recipe.id, ingredientId: beans.id, baseQuantity: 18, optional: false, sortOrder: 0,
    })),
  ])
}

beforeEach(reset)

describe('what an option takes from stock', () => {
  test('an option can say what it takes from stock', async () => {
    const group = await createModifierGroup({ name: 'Add-ons', selection: 'MULTI', userId: 'U1' })
    const option = await addModifierOption({ group, name: 'Strawberry Jam', priceDelta: 2000, userId: 'U1' })
    expect(option.consumption).toEqual([])

    await updateModifierOption({
      option,
      changes: { consumption: [{ ingredientId: jam.id, baseQuantity: 10 }] },
      userId: 'U1',
    })

    const saved = await db.modifierOptions.get(option.id)
    expect(saved?.consumption).toEqual([{ ingredientId: jam.id, baseQuantity: 10 }])

    // Changing it again records what it took before, not only what it takes
    // now - and "before" is what is stored, not the caller's stale copy.
    await updateModifierOption({
      option,
      changes: { consumption: [{ ingredientId: beans.id, baseQuantity: 3 }] },
      userId: 'U1',
    })

    const audits = await db.auditLogs.where('entityId').equals(group.id).toArray()
    const changes = audits.filter((entry) => entry.action === 'MODIFIER_OPTION_UPDATED')
    expect(changes).toHaveLength(2)

    const first = changes.find((entry) => entry.after?.includes(jam.id))
    expect(first?.after).toContain('consumption')
    expect(first?.before).toContain('"consumption":[]')

    const second = changes.find((entry) => entry.after?.includes(beans.id))
    expect(second?.before).toContain('consumption')
    expect(second?.before).toContain(jam.id)
  })

  test('a quantity of zero, an unknown ingredient, and the same ingredient twice are refused', async () => {
    const group = await createModifierGroup({ name: 'Add-ons', selection: 'MULTI', userId: 'U1' })
    const option = await addModifierOption({ group, name: 'Strawberry Jam', priceDelta: 2000, userId: 'U1' })

    await expect(
      updateModifierOption({
        option,
        changes: { consumption: [{ ingredientId: jam.id, baseQuantity: 0 }] },
        userId: 'U1',
      }),
    ).rejects.toThrow('Quantity must be more than zero.')

    await expect(
      updateModifierOption({
        option,
        changes: { consumption: [{ ingredientId: 'nope', baseQuantity: 10 }] },
        userId: 'U1',
      }),
    ).rejects.toThrow('That ingredient is no longer in the shop.')

    await expect(
      updateModifierOption({
        option,
        changes: {
          consumption: [
            { ingredientId: jam.id, baseQuantity: 10 },
            { ingredientId: jam.id, baseQuantity: 5 },
          ],
        },
        userId: 'U1',
      }),
    ).rejects.toThrow('Strawberry Jam is listed twice.')

    // None of those touched the record.
    const saved = await db.modifierOptions.get(option.id)
    expect(saved?.consumption).toEqual([])
  })

  test('the sale engine costs and deducts the add-on', async () => {
    const group = await createModifierGroup({ name: 'Add-ons', selection: 'MULTI', userId: 'U1' })
    const option = await addModifierOption({ group, name: 'Strawberry Jam', priceDelta: 2000, userId: 'U1' })
    await updateModifierOption({
      option,
      changes: { consumption: [{ ingredientId: jam.id, baseQuantity: 10 }] },
      userId: 'U1',
    })

    const menu = await loadMenu()

    const plain = consumptionFor(latte16.id, [], menu)
    expect(plain).toEqual([{ ingredientId: beans.id, baseQuantity: 18 }])

    const withJam = consumptionFor(latte16.id, [option.id], menu)
    expect(withJam).toContainEqual({ ingredientId: jam.id, baseQuantity: 10 })
    expect(withJam).toContainEqual({ ingredientId: beans.id, baseQuantity: 18 })

    expect(unitCost(latte16.id, [option.id], menu)).toBe(
      unitCost(latte16.id, [], menu) + costOf(10, jam.costRate),
    )
  })

  test('an add-on that has run out makes the drink unavailable', async () => {
    const group = await createModifierGroup({ name: 'Add-ons', selection: 'MULTI', userId: 'U1' })
    const withJam = await addModifierOption({ group, name: 'Strawberry Jam', priceDelta: 2000, userId: 'U1' })
    await updateModifierOption({
      option: withJam,
      changes: { consumption: [{ ingredientId: jam.id, baseQuantity: 10 }] },
      userId: 'U1',
    })
    const extraShot = await addModifierOption({ group, name: 'Extra shot', priceDelta: 1500, userId: 'U1' })
    await updateModifierOption({
      option: extraShot,
      changes: { consumption: [{ ingredientId: beans.id, baseQuantity: 9 }] },
      userId: 'U1',
    })

    // A kilo of beans on the shelf and no jam at all.
    await commit([
      created('inventoryMovements', stamp<InventoryMovement>({
        ingredientId: beans.id, type: 'OPENING', baseQuantity: 1000, costRate: beans.costRate,
        reason: '', referenceType: null, referenceId: null, shiftId: null, userId: 'SETUP', occurredAt: Date.now(),
      })),
    ])

    const menu = await loadMenu()
    const stock = await stockLevels()

    const plain = availabilityOf(latte16.id, menu, stock)
    expect(plain.makeable).toBe(55) // 1000 g / 18 g
    expect(plain.outOfStock).toBe(false)

    const jammed = availabilityOf(latte16.id, menu, stock, [withJam.id])
    expect(jammed.outOfStock).toBe(true)
    expect(jammed.limitingIngredient).toBe('Strawberry Jam')

    // An option drawing on the recipe's own ingredient is judged at the
    // combined amount, not as a second, separate demand.
    const stronger = availabilityOf(latte16.id, menu, stock, [extraShot.id])
    expect(stronger.makeable).toBe(37) // 1000 g / 27 g
    expect(stronger.limitingIngredient).toBe('Beans')
  })
})
