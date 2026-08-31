import { beforeEach, describe, expect, test } from 'vitest'
import {
  costRateFromPurchase,
  fromDecimal,
  toBase,
  type BusinessSettings,
  type Category,
  type Ingredient,
  type InventoryMovement,
  type Product,
  type ProductVariant,
  type Recipe,
  type RecipeIngredient,
  type User,
} from '@pos/shared'
import { db } from '../db/database.ts'
import { __setIdentityForTests } from '../db/identity.ts'
import { commit, created, stamp } from '../db/write.ts'
import { loadMenu, stockLevels, availabilityOf } from '../db/repo.ts'
import { defaultSettings } from '../db/seed.ts'
import { completeSale, verificationFor, type CartLine } from './checkout.ts'

/**
 * Checkout, end to end, against a real IndexedDB.
 *
 * These are the guarantees the whole architecture rests on: a sale is written
 * completely or not at all, it is queued for sync in the same breath, and the
 * stock it consumed is recorded as ledger entries rather than a decrement.
 */

let settings: BusinessSettings
let cashier: User
let beans: Ingredient
let milk: Ingredient
let cup: Ingredient
let latte: Product
let latte16: ProductVariant

async function resetDatabase(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })

  await db.delete()
  await db.open()

  settings = defaultSettings('Test Coffee')
  cashier = stamp<User>({
    name: 'Sam',
    role: 'OWNER',
    pinHash: 'pbkdf2$sha256$1$x$y',
    active: true,
    employeeCode: 'S1',
    failedAttempts: 0,
    lockedUntil: null,
    permissionOverrides: {},
  })

  beans = stamp<Ingredient>({
    name: 'Beans', sku: 'B', stockClass: 'INGREDIENT', dimension: 'MASS', displayUnit: 'kg',
    costRate: costRateFromPurchase(85000, 1, 'kg'), supplierId: null,
    lowStockThresholdBase: 500, trackStock: true, active: true,
  })
  milk = stamp<Ingredient>({
    name: 'Milk', sku: 'M', stockClass: 'INGREDIENT', dimension: 'VOLUME', displayUnit: 'L',
    costRate: costRateFromPurchase(9500, 1, 'L'), supplierId: null,
    lowStockThresholdBase: 1000, trackStock: true, active: true,
  })
  cup = stamp<Ingredient>({
    name: 'Cup 16oz', sku: 'C16', stockClass: 'PACKAGING', dimension: 'COUNT', displayUnit: 'pcs',
    costRate: costRateFromPurchase(38000, 100, 'pcs'), supplierId: null,
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
  const recipe = stamp<Recipe>({
    variantId: latte16.id, productId: latte.id, yieldQuantity: 1, notes: '', active: true,
  })

  await commit([
    created('settings', settings),
    created('users', cashier),
    created('categories', category),
    created('ingredients', beans),
    created('ingredients', milk),
    created('ingredients', cup),
    created('products', latte),
    created('productVariants', latte16),
    created('recipes', recipe),
    created('recipeIngredients', stamp<RecipeIngredient>({
      recipeId: recipe.id, ingredientId: beans.id, baseQuantity: 18, optional: false, sortOrder: 0,
    })),
    created('recipeIngredients', stamp<RecipeIngredient>({
      recipeId: recipe.id, ingredientId: milk.id, baseQuantity: 260, optional: false, sortOrder: 1,
    })),
    created('recipeIngredients', stamp<RecipeIngredient>({
      recipeId: recipe.id, ingredientId: cup.id, baseQuantity: 1, optional: false, sortOrder: 2,
    })),
    // Opening stock: 1kg of beans, 2L of milk, 10 cups.
    created('inventoryMovements', stamp<InventoryMovement>({
      ingredientId: beans.id, type: 'OPENING', baseQuantity: toBase(1, 'kg'), costRate: beans.costRate,
      reason: '', referenceType: null, referenceId: null, shiftId: null, userId: 'SETUP', occurredAt: Date.now(),
    })),
    created('inventoryMovements', stamp<InventoryMovement>({
      ingredientId: milk.id, type: 'OPENING', baseQuantity: toBase(2, 'L'), costRate: milk.costRate,
      reason: '', referenceType: null, referenceId: null, shiftId: null, userId: 'SETUP', occurredAt: Date.now(),
    })),
    created('inventoryMovements', stamp<InventoryMovement>({
      ingredientId: cup.id, type: 'OPENING', baseQuantity: 10, costRate: cup.costRate,
      reason: '', referenceType: null, referenceId: null, shiftId: null, userId: 'SETUP', occurredAt: Date.now(),
    })),
  ])

  await db.outbox.clear()
}

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1',
    productId: latte.id,
    variantId: latte16.id,
    productName: 'Latte',
    variantName: '16oz',
    categoryName: 'Hot',
    quantity: 1,
    unitPrice: fromDecimal(160),
    modifiers: [],
    note: '',
    unitCogs: 0,
    taxable: true,
    ...overrides,
  }
}

async function sell(overrides: Partial<Parameters<typeof completeSale>[0]> = {}) {
  const menu = await loadMenu()
  return completeSale({
    lines: [line()],
    discounts: [],
    payments: [{ method: 'CASH', amount: fromDecimal(160), tendered: fromDecimal(200), reference: '' }],
    settings,
    cashier,
    shiftId: 'SHIFT-1',
    orderType: 'TAKE_OUT',
    customerName: '',
    note: '',
    menu,
    online: false,
    ...overrides,
  })
}

beforeEach(resetDatabase)

describe('change', () => {
  test('is the difference between cash handed over and the amount owed', async () => {
    // Regression: change was once derived from the amount a tender settles
    // rather than the cash actually received, so it always came out as zero.
    const result = await sell()
    expect(result.changeDue).toBe(fromDecimal(40))

    const payments = await db.payments.where('saleId').equals(result.sale.id).toArray()
    expect(payments[0]?.change).toBe(fromDecimal(40))
    expect(payments[0]?.tendered).toBe(fromDecimal(200))
    expect(payments[0]?.amount).toBe(fromDecimal(160))
  })

  test('is zero on exact money', async () => {
    const result = await sell({
      payments: [{ method: 'CASH', amount: fromDecimal(160), tendered: fromDecimal(160), reference: '' }],
    })
    expect(result.changeDue).toBe(0)
  })

  test('a card is never given change', async () => {
    const result = await sell({
      payments: [{ method: 'CARD', amount: fromDecimal(160), tendered: fromDecimal(160), reference: 'x' }],
    })
    expect(result.changeDue).toBe(0)
  })

  test('a short payment is refused', async () => {
    await expect(
      sell({ payments: [{ method: 'CASH', amount: fromDecimal(100), tendered: fromDecimal(100), reference: '' }] }),
    ).rejects.toThrow(/does not cover/i)
  })

  test('an empty order is refused', async () => {
    await expect(sell({ lines: [] })).rejects.toThrow(/nothing in the order/i)
  })
})

describe('atomic commit', () => {
  test('writes the sale, its lines, its payment, its stock and its audit entry together', async () => {
    const result = await sell()
    const saleId = result.sale.id

    expect(await db.sales.get(saleId)).toBeDefined()
    expect(await db.saleItems.where('saleId').equals(saleId).count()).toBe(1)
    expect(await db.payments.where('saleId').equals(saleId).count()).toBe(1)
    expect(await db.inventoryMovements.where('referenceId').equals(saleId).count()).toBe(3)
    expect(await db.auditLogs.where('entityId').equals(saleId).count()).toBe(1)
  })

  test('queues every one of those records for the server in the same transaction', async () => {
    const result = await sell()
    const queued = await db.outbox.toArray()

    // Sale + line + payment + three stock movements + audit = seven.
    expect(queued).toHaveLength(7)
    expect(queued.every((entry) => entry.status === 'SYNC_PENDING')).toBe(true)
    expect(queued.filter((entry) => entry.entity === 'sales')).toHaveLength(1)
    expect(queued.filter((entry) => entry.entity === 'inventoryMovements')).toHaveLength(3)

    const saleEntry = queued.find((entry) => entry.entity === 'sales')
    expect(saleEntry?.entityId).toBe(result.sale.id)
    expect(saleEntry?.op).toBe('CREATE')
  })

  test('a failed sale leaves nothing behind', async () => {
    await expect(sell({ lines: [] })).rejects.toThrow()
    expect(await db.sales.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('stock', () => {
  test('a sale consumes exactly what the recipe specifies', async () => {
    await sell()
    const levels = await stockLevels()

    expect(levels.get(beans.id)).toBe(1000 - 18)
    expect(levels.get(milk.id)).toBe(2000 - 260)
    expect(levels.get(cup.id)).toBe(10 - 1)
  })

  test('quantity multiplies the consumption', async () => {
    await sell({
      lines: [line({ quantity: 3 })],
      payments: [{ method: 'CASH', amount: fromDecimal(480), tendered: fromDecimal(500), reference: '' }],
    })
    const levels = await stockLevels()
    expect(levels.get(beans.id)).toBe(1000 - 54)
    expect(levels.get(cup.id)).toBe(10 - 3)
  })

  test('consumption is recorded as signed ledger entries, not a decrement', async () => {
    const result = await sell()
    const movements = await db.inventoryMovements.where('referenceId').equals(result.sale.id).toArray()

    expect(movements.every((movement) => movement.baseQuantity < 0)).toBe(true)
    expect(movements.every((movement) => movement.type === 'SALE')).toBe(true)
    // Nothing anywhere holds a mutable "stock on hand" that could be overwritten.
    expect(movements.map((movement) => movement.referenceType)).toEqual(['SALE', 'SALE', 'SALE'])
  })

  test('availability falls as stock is consumed and reaches zero at the limit', async () => {
    // Ten cups is the binding constraint, not the beans or the milk.
    const before = availabilityOf(latte16.id, await loadMenu(), await stockLevels())
    expect(before.makeable).toBe(7) // 2000ml milk / 260ml = 7
    expect(before.limitingIngredient).toBe('Milk')

    await sell({
      lines: [line({ quantity: 7 })],
      payments: [{ method: 'CASH', amount: fromDecimal(1120), tendered: fromDecimal(1120), reference: '' }],
    })

    const after = availabilityOf(latte16.id, await loadMenu(), await stockLevels())
    expect(after.makeable).toBe(0)
    expect(after.outOfStock).toBe(true)
  })
})

describe('numbering', () => {
  test('receipt numbers advance and carry the device code so they cannot collide', async () => {
    const first = await sell()
    const second = await sell()

    expect(first.receiptNo).toBe('OR-01-000001')
    expect(second.receiptNo).toBe('OR-01-000002')
    expect(first.receiptNo).not.toBe(second.receiptNo)
  })

  test('queue numbers advance and are padded for the display board', async () => {
    const first = await sell()
    const second = await sell()
    expect(first.queueNo).toBe('001')
    expect(second.queueNo).toBe('002')
  })

  test('the sale id is globally unique and unrelated to the receipt number', async () => {
    const first = await sell()
    const second = await sell()
    expect(first.sale.id).not.toBe(second.sale.id)
    expect(first.sale.id).not.toContain('OR-')
  })
})

describe('payment honesty', () => {
  test('cash never needs anyone to confirm it', () => {
    expect(verificationFor('CASH', false)).toBe('NOT_REQUIRED')
    expect(verificationFor('CASH', true)).toBe('NOT_REQUIRED')
  })

  test('a wallet payment taken offline is recorded, not claimed as verified', () => {
    expect(verificationFor('GCASH', false)).toBe('RECORDED_LOCALLY')
    expect(verificationFor('MAYA', false)).toBe('RECORDED_LOCALLY')
    expect(verificationFor('CARD', false)).toBe('RECORDED_LOCALLY')
  })

  test('the stored payment says which of the two it was', async () => {
    const offline = await sell({
      online: false,
      payments: [{ method: 'GCASH', amount: fromDecimal(160), tendered: fromDecimal(160), reference: 'ref' }],
    })
    const payment = (await db.payments.where('saleId').equals(offline.sale.id).toArray())[0]
    expect(payment?.verification).toBe('RECORDED_LOCALLY')
    expect(payment?.verifiedAt).toBeNull()
  })
})

describe('historical accuracy', () => {
  test('the line keeps the cost of goods from the moment of sale', async () => {
    const menu = await loadMenu()
    const result = await sell({
      lines: [line({ unitCogs: fromDecimal(42) })],
      menu,
    })
    const item = (await db.saleItems.where('saleId').equals(result.sale.id).toArray())[0]
    expect(item?.lineCogs).toBe(fromDecimal(42))
  })

  test('names are snapshotted so an old receipt never changes', async () => {
    const result = await sell()
    const item = (await db.saleItems.where('saleId').equals(result.sale.id).toArray())[0]
    expect(item?.productName).toBe('Latte')
    expect(item?.variantName).toBe('16oz')
    expect(item?.categoryName).toBe('Hot')
  })
})

describe('statutory discount through the whole checkout', () => {
  test('records the concession, the exempt VAT and the identification', async () => {
    const result = await sell({
      lines: [line({ unitPrice: 11200 })],
      discounts: [
        {
          id: 'd1',
          type: 'SENIOR',
          label: 'Senior Citizen',
          value: 20,
          referenceNo: 'SC-889231',
          beneficiaryName: 'Maria Reyes',
          authorizedBy: null,
          reason: '',
        },
      ],
      payments: [{ method: 'CASH', amount: 8000, tendered: 10000, reference: '' }],
    })

    expect(result.totals.total).toBe(8000)
    expect(result.sale.taxExemptTotal).toBe(1200)
    expect(result.sale.discountTotal).toBe(2000)
    expect(result.sale.taxTotal).toBe(0)
    expect(result.changeDue).toBe(2000)

    const discount = (await db.saleDiscounts.where('saleId').equals(result.sale.id).toArray())[0]
    expect(discount?.taxExempt).toBe(true)
    expect(discount?.referenceNo).toBe('SC-889231')
    expect(discount?.beneficiaryName).toBe('Maria Reyes')
  })
})

describe('references the shop has made compulsory', () => {
  test('refuses a GCash sale with no reference', async () => {
    settings = { ...settings, requireReferenceFor: ['GCASH'] }
    await expect(
      sell({ payments: [{ method: 'GCASH', amount: fromDecimal(160), tendered: fromDecimal(160), reference: '' }] }),
    ).rejects.toThrow(/needs its reference/i)
  })

  test('refuses whitespace pretending to be a reference', async () => {
    settings = { ...settings, requireReferenceFor: ['GCASH'] }
    await expect(
      sell({
        payments: [{ method: 'GCASH', amount: fromDecimal(160), tendered: fromDecimal(160), reference: '   ' }],
      }),
    ).rejects.toThrow(/needs its reference/i)
  })

  test('takes it once the reference is there', async () => {
    settings = { ...settings, requireReferenceFor: ['GCASH'] }
    const { sale } = await sell({
      payments: [{ method: 'GCASH', amount: fromDecimal(160), tendered: fromDecimal(160), reference: 'Ref 88213' }],
    })
    expect(sale.total).toBe(fromDecimal(160))
  })

  test('leaves methods the shop did not name alone', async () => {
    settings = { ...settings, requireReferenceFor: ['GCASH'] }
    const { sale } = await sell({
      payments: [{ method: 'MAYA', amount: fromDecimal(160), tendered: fromDecimal(160), reference: '' }],
    })
    expect(sale.total).toBe(fromDecimal(160))
  })

  test('asks nothing of a shop that has not configured it', async () => {
    settings = { ...settings, requireReferenceFor: [] }
    const { sale } = await sell({
      payments: [{ method: 'GCASH', amount: fromDecimal(160), tendered: fromDecimal(160), reference: '' }],
    })
    expect(sale.total).toBe(fromDecimal(160))
  })
})

describe('counting cups and snacks on a sale', () => {
  test('records the two figures separately', async () => {
    const { sale } = await sell({
      lines: [
        line({ id: 'a', quantity: 2, servingUnit: 'CUP' }),
        line({ id: 'b', quantity: 3, servingUnit: 'PIECE' }),
      ],
      payments: [{ method: 'CASH', amount: fromDecimal(800), tendered: fromDecimal(800), reference: '' }],
    })

    expect(sale.cupCount).toBe(2)
    expect(sale.snackCount).toBe(3)
    // The overall count still means what it always meant.
    expect(sale.itemCount).toBe(5)
  })

  test('treats a line with no serving unit as a cup', async () => {
    const { sale } = await sell({ lines: [line({ quantity: 4 })] , payments: [{ method: 'CASH', amount: fromDecimal(640), tendered: fromDecimal(640), reference: '' }] })
    expect(sale.cupCount).toBe(4)
    expect(sale.snackCount).toBe(0)
  })
})
