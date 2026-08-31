import { beforeEach, describe, expect, test } from 'vitest'
import {
  costRateFromPurchase,
  fromDecimal,
  toBase,
  type Category,
  type Ingredient,
  type InventoryMovement,
  type Product,
  type ProductVariant,
  type Recipe,
  type RecipeIngredient,
  type User,
} from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import { loadMenu, stockOnHand } from './repo.ts'
import { defaultSettings } from './seed.ts'
import { loadAnalytics, resolveRange } from './analytics.ts'
import {
  canRefund,
  canVoid,
  EMPTY_FILTERS,
  isRefund,
  refundedSoFar,
  refundableRemaining,
  refundSale,
  refundTotals,
  searchLedger,
  voidSale,
} from './ledger.ts'
import { claimedValue, completeSale, loyaltyDiscount, recordLumpSum } from '../pos/checkout.ts'

/**
 * Undoing a sale.
 *
 * These are the operations that move money back out of the till and stock back
 * onto the shelf, so the tests care about the ways that could go wrong quietly:
 * a sale voided twice, more refunded than was ever charged, or stock silently
 * returned for a drink that was made and drunk.
 */

let settings: Awaited<ReturnType<typeof defaultSettings>>
let cashier: User
let beans: Ingredient
let cup: Ingredient
let latte: Product
let latte16: ProductVariant

async function seed(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()

  settings = defaultSettings('Test Coffee')
  cashier = stamp<User>({
    name: 'Sam', role: 'OWNER', pinHash: 'x', active: true,
    employeeCode: 'S1', failedAttempts: 0, lockedUntil: null, permissionOverrides: {},
  })

  beans = stamp<Ingredient>({
    name: 'Beans', sku: 'B', stockClass: 'INGREDIENT', dimension: 'MASS', displayUnit: 'kg',
    costRate: costRateFromPurchase(fromDecimal(850), 1, 'kg'), supplierId: null,
    lowStockThresholdBase: 500, trackStock: true, active: true,
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
    productId: latte.id, name: '16oz', price: fromDecimal(100), sortOrder: 0, active: true, isDefault: true,
  })
  const recipe = stamp<Recipe>({
    variantId: latte16.id, productId: latte.id, yieldQuantity: 1, notes: '', active: true,
  })

  await commit([
    created('settings', settings),
    created('users', cashier),
    created('categories', category),
    created('ingredients', beans),
    created('ingredients', cup),
    created('products', latte),
    created('productVariants', latte16),
    created('recipes', recipe),
    created('recipeIngredients', stamp<RecipeIngredient>({
      recipeId: recipe.id, ingredientId: beans.id, baseQuantity: 20, optional: false, sortOrder: 0,
    })),
    created('recipeIngredients', stamp<RecipeIngredient>({
      recipeId: recipe.id, ingredientId: cup.id, baseQuantity: 1, optional: false, sortOrder: 1,
    })),
    created('inventoryMovements', stamp<InventoryMovement>({
      ingredientId: beans.id, type: 'OPENING', baseQuantity: toBase(1, 'kg'), costRate: beans.costRate,
      reason: '', referenceType: null, referenceId: null, shiftId: null, userId: 'SETUP', occurredAt: Date.now(),
    })),
    created('inventoryMovements', stamp<InventoryMovement>({
      ingredientId: cup.id, type: 'OPENING', baseQuantity: 100, costRate: cup.costRate,
      reason: '', referenceType: null, referenceId: null, shiftId: null, userId: 'SETUP', occurredAt: Date.now(),
    })),
  ])
}

/** Ring up `quantity` lattes at 100.00 each, paid in cash. */
async function sell(quantity = 2, overrides: Record<string, unknown> = {}) {
  const menu = await loadMenu()
  const total = fromDecimal(100) * quantity
  return completeSale({
    lines: [
      {
        id: 'L1',
        productId: latte.id,
        variantId: latte16.id,
        productName: 'Latte',
        variantName: '16oz',
        categoryName: 'Hot',
        quantity,
        unitPrice: fromDecimal(100),
        modifiers: [],
        note: '',
        unitCogs: fromDecimal(20),
        taxable: true,
      },
    ],
    discounts: [],
    payments: [{ method: 'CASH', amount: total, tendered: total, reference: '' }],
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

beforeEach(seed)

describe('voiding', () => {
  test('marks the sale voided without altering what it recorded', async () => {
    const { sale } = await sell()
    const voided = await voidSale({ sale, reason: 'Rung up twice', user: cashier, returnStock: true })

    expect(voided.status).toBe('VOIDED')
    expect(voided.voidedBy).toBe(cashier.id)
    expect(voided.voidReason).toBe('Rung up twice')
    // The figures on the original are untouched - only its status changed.
    expect(voided.total).toBe(sale.total)
    expect(voided.receiptNo).toBe(sale.receiptNo)
  })

  test('returns exactly the stock the sale took', async () => {
    const before = await stockOnHand(beans.id)
    const { sale } = await sell(2)
    expect(await stockOnHand(beans.id)).toBe(before - 40)

    await voidSale({ sale, reason: 'Cancelled', user: cashier, returnStock: true })
    expect(await stockOnHand(beans.id)).toBe(before)
  })

  test('leaves stock alone when the drink was already made', async () => {
    const { sale } = await sell(2)
    const afterSale = await stockOnHand(beans.id)

    // A void after the drink was poured must not put the milk back.
    await voidSale({ sale, reason: 'Customer left', user: cashier, returnStock: false })
    expect(await stockOnHand(beans.id)).toBe(afterSale)
  })

  test('needs a reason', async () => {
    const { sale } = await sell()
    await expect(
      voidSale({ sale, reason: '   ', user: cashier, returnStock: true }),
    ).rejects.toThrow(/needs a reason/i)
  })

  test('cannot be done twice', async () => {
    const { sale } = await sell()
    const voided = await voidSale({ sale, reason: 'Mistake', user: cashier, returnStock: true })
    expect(canVoid(voided).allowed).toBe(false)
    await expect(
      voidSale({ sale: voided, reason: 'Again', user: cashier, returnStock: true }),
    ).rejects.toThrow(/already been voided/i)
  })

  test('drops out of the reports entirely', async () => {
    const { sale } = await sell(2)
    await voidSale({ sale, reason: 'Mistake', user: cashier, returnStock: true })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.grossRevenue).toBe(0)
    expect(analytics.orders).toBe(0)
    expect(analytics.voidedCount).toBe(1)
  })

  test('is recorded in the audit trail with who and why', async () => {
    const { sale } = await sell()
    await voidSale({ sale, reason: 'Wrong size', user: cashier, returnStock: true })

    const audit = await db.auditLogs.where('entityId').equals(sale.id).toArray()
    const entry = audit.find((row) => row.action === 'SALE_VOIDED')
    expect(entry?.userId).toBe(cashier.id)
    expect(entry?.reason).toBe('Wrong size')
  })
})

describe('refunding', () => {
  test('is written as its own sale with negative amounts', async () => {
    const { sale } = await sell(2)
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()

    const { refund, amount } = await refundSale({
      sale,
      lines: [{ item: items[0]!, quantity: 2 }],
      reason: 'Wrong order',
      user: cashier,
      method: 'CASH',
      returnStock: false,
    })

    expect(amount).toBe(fromDecimal(200))
    expect(refund.total).toBe(fromDecimal(-200))
    expect(refund.refundOfSaleId).toBe(sale.id)
    // The original is untouched apart from its status and refunded tally.
    const original = await db.sales.get(sale.id)
    expect(original?.total).toBe(fromDecimal(200))
    expect(original?.status).toBe('REFUNDED')
    expect(original?.refundedTotal).toBe(fromDecimal(200))
  })

  test('a partial refund leaves the rest refundable', async () => {
    const { sale } = await sell(2)
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()

    await refundSale({
      sale,
      lines: [{ item: items[0]!, quantity: 1 }],
      reason: 'One was cold',
      user: cashier,
      method: 'CASH',
      returnStock: false,
    })

    const original = await db.sales.get(sale.id)
    expect(original?.status).toBe('PARTIALLY_REFUNDED')
    expect(original?.refundedTotal).toBe(fromDecimal(100))
    expect(refundableRemaining(original!)).toBe(fromDecimal(100))
    expect(canRefund(original!).allowed).toBe(true)
  })

  test('cannot refund more than was charged', async () => {
    const { sale } = await sell(2)
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()

    await refundSale({
      sale, lines: [{ item: items[0]!, quantity: 2 }], reason: 'All of it',
      user: cashier, method: 'CASH', returnStock: false,
    })

    const original = (await db.sales.get(sale.id))!
    expect(canRefund(original).allowed).toBe(false)
    await expect(
      refundSale({
        sale: original, lines: [{ item: items[0]!, quantity: 1 }], reason: 'Again',
        user: cashier, method: 'CASH', returnStock: false,
      }),
    ).rejects.toThrow(/already been refunded in full/i)
  })

  test('a refund nets out against the original in the reports', async () => {
    const { sale } = await sell(2)
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()

    const before = await loadAnalytics(resolveRange('TODAY'))
    expect(before.grossRevenue).toBe(fromDecimal(200))

    await refundSale({
      sale, lines: [{ item: items[0]!, quantity: 1 }], reason: 'One was cold',
      user: cashier, method: 'CASH', returnStock: false,
    })

    // 200 charged less 100 given back. No special handling in the reports -
    // the negative sale simply sums with the positive one.
    const after = await loadAnalytics(resolveRange('TODAY'))
    expect(after.grossRevenue).toBe(fromDecimal(100))
  })

  test('the money going back out is recorded as a negative payment', async () => {
    const { sale } = await sell(1)
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()

    const { refund } = await refundSale({
      sale, lines: [{ item: items[0]!, quantity: 1 }], reason: 'Refund',
      user: cashier, method: 'CASH', returnStock: false,
    })

    const payment = (await db.payments.where('saleId').equals(refund.id).toArray())[0]
    expect(payment?.amount).toBe(fromDecimal(-100))
    expect(payment?.method).toBe('CASH')
  })

  test('stock comes back only when someone says it should', async () => {
    const { sale } = await sell(2)
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()
    const afterSale = await stockOnHand(beans.id)

    await refundSale({
      sale, lines: [{ item: items[0]!, quantity: 1 }], reason: 'Cold',
      user: cashier, method: 'CASH', returnStock: false,
    })
    expect(await stockOnHand(beans.id)).toBe(afterSale)

    const original = (await db.sales.get(sale.id))!
    await refundSale({
      sale: original, lines: [{ item: items[0]!, quantity: 1 }], reason: 'Unopened',
      user: cashier, method: 'CASH', returnStock: true,
    })
    // Half the sale's value refunded with restocking -> half the beans back.
    expect(await stockOnHand(beans.id)).toBe(afterSale + 20)
  })

  test('needs a reason and something to refund', async () => {
    const { sale } = await sell(1)
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()

    await expect(
      refundSale({ sale, lines: [{ item: items[0]!, quantity: 1 }], reason: ' ', user: cashier, method: 'CASH', returnStock: false }),
    ).rejects.toThrow(/needs a reason/i)

    await expect(
      refundSale({ sale, lines: [{ item: items[0]!, quantity: 0 }], reason: 'x', user: cashier, method: 'CASH', returnStock: false }),
    ).rejects.toThrow(/choose what to refund/i)
  })

  test('a voided sale has nothing to refund', async () => {
    const { sale } = await sell(1)
    const voided = await voidSale({ sale, reason: 'Mistake', user: cashier, returnStock: true })
    expect(canRefund(voided).allowed).toBe(false)
  })

  test('refund totals are proportional to the quantity returned', async () => {
    const { sale } = await sell(4)
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()
    const totals = refundTotals([{ item: items[0]!, quantity: 1 }])

    expect(totals.amount).toBe(fromDecimal(100))
    expect(totals.cogs).toBe(fromDecimal(20))
    expect(totals.items).toBe(1)
  })
})

describe('searching the ledger', () => {
  test('finds a sale by receipt number, queue number or product', async () => {
    const { sale } = await sell(1)

    expect((await searchLedger({ ...EMPTY_FILTERS, query: sale.receiptNo })).length).toBe(1)
    expect((await searchLedger({ ...EMPTY_FILTERS, query: sale.queueNo })).length).toBe(1)
    expect((await searchLedger({ ...EMPTY_FILTERS, query: 'latte' })).length).toBe(1)
    expect((await searchLedger({ ...EMPTY_FILTERS, query: 'nonsense' })).length).toBe(0)
  })

  test('filters by status and by payment method', async () => {
    const first = await sell(1)
    await sell(1)
    await voidSale({ sale: first.sale, reason: 'Mistake', user: cashier, returnStock: true })

    expect((await searchLedger({ ...EMPTY_FILTERS, status: 'VOIDED' })).length).toBe(1)
    expect((await searchLedger({ ...EMPTY_FILTERS, status: 'COMPLETED' })).length).toBe(1)
    expect((await searchLedger({ ...EMPTY_FILTERS, method: 'CASH' })).length).toBe(2)
    expect((await searchLedger({ ...EMPTY_FILTERS, method: 'GCASH' })).length).toBe(0)
  })

  test('summarises what was in each order', async () => {
    await sell(2)
    const rows = await searchLedger(EMPTY_FILTERS)
    expect(rows[0]?.itemSummary).toBe('2× Latte')
    expect(rows[0]?.cashierName).toBe('Sam')
  })
})

describe('loyalty claims', () => {
  test('are free to the customer but still cost the shop', async () => {
    const menu = await loadMenu()
    const result = await completeSale({
      lines: [
        {
          id: 'L1', productId: latte.id, variantId: latte16.id, productName: 'Latte',
          variantName: '16oz', categoryName: 'Hot', quantity: 1, unitPrice: fromDecimal(100),
          modifiers: [], note: '', unitCogs: fromDecimal(20), taxable: true,
        },
      ],
      discounts: [loyaltyDiscount(fromDecimal(100), 'CARD-4471', 'Ana')],
      payments: [{ method: 'LOYALTY', amount: 0, tendered: 0, reference: 'CARD-4471' }],
      settings, cashier, shiftId: 'SHIFT-1', orderType: 'TAKE_OUT',
      customerName: '', note: '', menu, online: false,
    })

    // Nothing was taken, so nothing is revenue.
    expect(result.totals.total).toBe(0)
    // But the drink was still made, so the cost is real.
    expect(result.sale.cogsTotal).toBe(fromDecimal(20))
  })

  test('consume stock exactly like a paid drink', async () => {
    const menu = await loadMenu()
    const before = await stockOnHand(beans.id)

    await completeSale({
      lines: [
        {
          id: 'L1', productId: latte.id, variantId: latte16.id, productName: 'Latte',
          variantName: '16oz', categoryName: 'Hot', quantity: 1, unitPrice: fromDecimal(100),
          modifiers: [], note: '', unitCogs: fromDecimal(20), taxable: true,
        },
      ],
      discounts: [loyaltyDiscount(fromDecimal(100), 'CARD-4471')],
      payments: [{ method: 'LOYALTY', amount: 0, tendered: 0, reference: '' }],
      settings, cashier, shiftId: 'SHIFT-1', orderType: 'TAKE_OUT',
      customerName: '', note: '', menu, online: false,
    })

    expect(await stockOnHand(beans.id)).toBe(before - 20)
  })

  test('are counted and costed in the reports', async () => {
    const menu = await loadMenu()
    await completeSale({
      lines: [
        {
          id: 'L1', productId: latte.id, variantId: latte16.id, productName: 'Latte',
          variantName: '16oz', categoryName: 'Hot', quantity: 1, unitPrice: fromDecimal(100),
          modifiers: [], note: '', unitCogs: fromDecimal(20), taxable: true,
        },
      ],
      discounts: [loyaltyDiscount(fromDecimal(100), 'CARD-4471')],
      payments: [{ method: 'LOYALTY', amount: 0, tendered: 0, reference: '' }],
      settings, cashier, shiftId: 'SHIFT-1', orderType: 'TAKE_OUT',
      customerName: '', note: '', menu, online: false,
    })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.loyalty.redemptions).toBe(1)
    expect(analytics.loyalty.valueGivenAway).toBe(fromDecimal(100))
    expect(analytics.loyalty.cost).toBe(fromDecimal(20))
    expect(analytics.grossRevenue).toBe(0)
  })
})

describe('backfilling a past day', () => {
  const yesterday = Date.now() - 24 * 60 * 60 * 1000

  test('records the takings without inventing line items or stock', async () => {
    const before = await stockOnHand(beans.id)

    const sale = await recordLumpSum({
      amount: fromDecimal(4500),
      cups: 30,
      occurredAt: yesterday,
      method: 'CASH',
      settings,
      cashier,
      shiftId: 'SHIFT-1',
      note: 'From the notebook',
    })

    expect(sale.entryMode).toBe('LUMP_SUM')
    expect(sale.total).toBe(fromDecimal(4500))
    expect(sale.itemCount).toBe(30)
    expect(await db.saleItems.where('saleId').equals(sale.id).count()).toBe(0)
    // No stock is touched: we have no idea what went into those cups.
    expect(await stockOnHand(beans.id)).toBe(before)
  })

  test('counts towards revenue but is kept out of margin', async () => {
    await sell(1) // a real itemised sale today: 100.00, cost 20.00

    await recordLumpSum({
      amount: fromDecimal(4500), cups: 30, occurredAt: Date.now(), method: 'CASH',
      settings, cashier, shiftId: 'SHIFT-1', note: '',
    })

    const analytics = await loadAnalytics(resolveRange('TODAY'))

    expect(analytics.grossRevenue).toBe(fromDecimal(4600))
    expect(analytics.lumpSumRevenue).toBe(fromDecimal(4500))
    expect(analytics.lumpSumOrders).toBe(1)

    // Margin stands only on the sale whose cost is actually known: the 100.00
    // itemised order, less its own 12% VAT. The 4,500 backfill is excluded.
    expect(analytics.marginBasis).toBe(fromDecimal(100) - Math.round(fromDecimal(100) - fromDecimal(100) / 1.12))
    expect(analytics.cogsTotal).toBe(fromDecimal(20))

    // Had the backfill been folded in at zero cost, margin would have read
    // about 99%. Standing on the itemised sale alone, it reads about 78%.
    expect(analytics.marginPercent).toBeGreaterThan(70)
    expect(analytics.marginPercent).toBeLessThan(85)
  })

  test('refuses an empty or negative amount', async () => {
    await expect(
      recordLumpSum({
        amount: 0, cups: 10, occurredAt: yesterday, method: 'CASH',
        settings, cashier, shiftId: 'SHIFT-1', note: '',
      }),
    ).rejects.toThrow(/takings/i)
  })
})

describe('backdated orders', () => {
  test('are stamped with when they happened, not when they were keyed', async () => {
    const when = Date.now() - 3 * 60 * 60 * 1000
    const { sale } = await sell(1, { occurredAt: when })

    expect(sale.occurredAt).toBe(when)
    // createdAt still records when someone actually typed it in, so the gap
    // between the two is visible to anyone auditing the day.
    expect(sale.createdAt).toBeGreaterThan(sale.occurredAt)
  })

  test('land in the report bucket for the hour they happened', async () => {
    // Clamped to stay inside today whatever time the suite runs. Subtracting
    // three hours outright rolls into yesterday between midnight and 03:00,
    // which puts the sale outside the TODAY range and fails the test nightly
    // for reasons that have nothing to do with what it is checking.
    const earlier = new Date()
    earlier.setHours(Math.max(0, earlier.getHours() - 3), 0, 0, 0)

    await sell(1, { occurredAt: earlier.getTime() })

    const analytics = await loadAnalytics(resolveRange('TODAY'))
    expect(analytics.buckets[earlier.getHours()]?.orders).toBe(1)
  })
})

describe('records written before these fields existed', () => {
  test('are not mistaken for refunds, and do not produce NaN', async () => {
    const { sale } = await sell(1)

    // Simulate a row that predates refundOfSaleId and refundedTotal: on such a
    // record the fields come back undefined, and `undefined !== null` is true.
    // Read naively, every historical sale would be badged as a refund and every
    // refundable figure would come out NaN.
    const legacy = { ...sale } as Record<string, unknown>
    delete legacy.refundOfSaleId
    delete legacy.refundedTotal
    await db.sales.put(legacy as unknown as typeof sale)

    const stored = (await db.sales.get(sale.id))!
    expect(stored.refundOfSaleId).toBeUndefined()

    expect(isRefund(stored)).toBe(false)
    expect(refundedSoFar(stored)).toBe(0)
    expect(refundableRemaining(stored)).toBe(sale.total)
    expect(Number.isNaN(refundableRemaining(stored))).toBe(false)

    // And both operations still judge it correctly.
    expect(canVoid(stored).allowed).toBe(true)
    expect(canRefund(stored).allowed).toBe(true)
  })

  test('can still be refunded, starting from zero refunded', async () => {
    const { sale } = await sell(1)
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()

    const legacy = { ...sale } as Record<string, unknown>
    delete legacy.refundedTotal
    await db.sales.put(legacy as unknown as typeof sale)

    const stored = (await db.sales.get(sale.id))!
    await refundSale({
      sale: stored, lines: [{ item: items[0]!, quantity: 1 }], reason: 'Cold',
      user: cashier, method: 'CASH', returnStock: false,
    })

    const after = (await db.sales.get(sale.id))!
    expect(after.refundedTotal).toBe(fromDecimal(100))
    expect(after.status).toBe('REFUNDED')
  })
})

describe('a refund in the reports', () => {
  test('is not counted as an order, and does not drag the average down', async () => {
    await sell(1) // 100.00
    await sell(1) // 100.00
    const third = await sell(1) // 100.00
    const items = await db.saleItems.where('saleId').equals(third.sale.id).toArray()

    await refundSale({
      sale: third.sale, lines: [{ item: items[0]!, quantity: 1 }], reason: 'Cold',
      user: cashier, method: 'CASH', returnStock: false,
    })

    const analytics = await loadAnalytics(resolveRange('TODAY'))

    expect(analytics.grossRevenue).toBe(fromDecimal(200))
    // Three orders were placed. The refund is not a fourth.
    expect(analytics.orders).toBe(3)
    expect(analytics.refundCount).toBe(1)
    expect(analytics.refundedOut).toBe(fromDecimal(100))
    // 200 taken across 3 orders, not across 4.
    expect(analytics.averageOrder).toBe(Math.round(fromDecimal(200) / 3))
  })
})

describe('claiming part of a line', () => {
  /** One cart line of `quantity` lattes, `claimed` of them on the card. */
  async function sellWithClaim(quantity: number, claimed: number, paid: number) {
    const menu = await loadMenu()
    const line = {
      id: 'L1', productId: latte.id, variantId: latte16.id, productName: 'Latte',
      variantName: '16oz', categoryName: 'Hot', quantity, unitPrice: fromDecimal(100),
      modifiers: [], note: '', unitCogs: fromDecimal(20), taxable: true,
      loyaltyFreeQty: claimed,
    }
    const value = claimedValue(line)
    return completeSale({
      lines: [line],
      discounts: value > 0 ? [loyaltyDiscount(value, 'CARD-9931')] : [],
      payments: [{ method: 'CASH', amount: paid, tendered: paid, reference: '' }],
      settings, cashier, shiftId: 'SHIFT-1', orderType: 'TAKE_OUT',
      customerName: '', note: '', menu, online: false,
    })
  }

  test('values only the claimed portion, not the whole line', () => {
    const line = {
      id: 'L1', productId: 'p', variantId: 'v', productName: 'Latte', variantName: '16oz',
      categoryName: 'Hot', quantity: 3, unitPrice: fromDecimal(100), modifiers: [],
      note: '', unitCogs: fromDecimal(20), taxable: true, loyaltyFreeQty: 1,
    }
    expect(claimedValue(line)).toBe(fromDecimal(100))
    expect(claimedValue({ ...line, loyaltyFreeQty: 2 })).toBe(fromDecimal(200))
    expect(claimedValue({ ...line, loyaltyFreeQty: 0 })).toBe(0)
  })

  test('never values more than the line holds', () => {
    const line = {
      id: 'L1', productId: 'p', variantId: 'v', productName: 'Latte', variantName: '16oz',
      categoryName: 'Hot', quantity: 2, unitPrice: fromDecimal(100), modifiers: [],
      note: '', unitCogs: fromDecimal(20), taxable: true, loyaltyFreeQty: 9,
    }
    // A stale claim count can never give away more drinks than were ordered.
    expect(claimedValue(line)).toBe(fromDecimal(200))
  })

  test('counts the modifiers on a claimed drink too', () => {
    const line = {
      id: 'L1', productId: 'p', variantId: 'v', productName: 'Latte', variantName: '16oz',
      categoryName: 'Hot', quantity: 2, unitPrice: fromDecimal(100),
      modifiers: [{ groupId: 'g', groupName: 'Milk', optionId: 'o', optionName: 'Oat', priceDelta: fromDecimal(30) }],
      note: '', unitCogs: fromDecimal(20), taxable: true, loyaltyFreeQty: 1,
    }
    // The free drink was an oat latte, so it is worth 130, not 100.
    expect(claimedValue(line)).toBe(fromDecimal(130))
  })

  test('one free out of three: the customer pays for two', async () => {
    const result = await sellWithClaim(3, 1, fromDecimal(200))

    expect(result.totals.subtotal).toBe(fromDecimal(300))
    expect(result.totals.discountTotal).toBe(fromDecimal(100))
    expect(result.totals.total).toBe(fromDecimal(200))
  })

  test('all three drinks are still made, so all three cost and consume stock', async () => {
    const before = await stockOnHand(beans.id)
    const result = await sellWithClaim(3, 1, fromDecimal(200))

    expect(result.sale.cogsTotal).toBe(fromDecimal(60))
    expect(await stockOnHand(beans.id)).toBe(before - 60)
  })

  test('the reports show one redemption worth the claimed drink', async () => {
    await sellWithClaim(3, 1, fromDecimal(200))
    const analytics = await loadAnalytics(resolveRange('TODAY'))

    expect(analytics.grossRevenue).toBe(fromDecimal(200))
    expect(analytics.loyalty.redemptions).toBe(1)
    expect(analytics.loyalty.valueGivenAway).toBe(fromDecimal(100))
  })

  test('claiming the whole line makes the order free but still costs', async () => {
    const result = await sellWithClaim(2, 2, 0)
    expect(result.totals.total).toBe(0)
    expect(result.sale.cogsTotal).toBe(fromDecimal(40))
  })
})
