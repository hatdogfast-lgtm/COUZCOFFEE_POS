import { beforeEach, describe, expect, test } from 'vitest'
import {
  costRateFromPurchase,
  fromDecimal,
  type Ingredient,
  type InventoryMovement,
  type OperatingExpense,
  type Payment,
  type Sale,
  type SaleItem,
} from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { buildEndOfDay } from './endOfDay.ts'
import { commit, created, stamp } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * The end-of-day summary.
 *
 * Its whole purpose is that the breakdowns add up to the headlines, so that is
 * what these check. A summary whose parts do not reconcile with its totals is
 * worse than no summary: it looks authoritative and is not.
 */

function today(hour: number): number {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()
}

beforeEach(reset)

interface Line {
  product: string
  variant: string
  category: string
  qty: number
  revenue: number
  cogs: number
}

async function addSale(spec: {
  total: number
  tax?: number
  cogs?: number
  at: number
  lines?: Line[]
  cupCount?: number
  snackCount?: number
  entryMode?: Sale['entryMode']
  status?: Sale['status']
  payment?: Payment['method']
}): Promise<Sale> {
  const sale = stamp<Sale>({
    receiptNo: `OR-${Math.random().toString(36).slice(2, 8)}`,
    queueNo: '001',
    shiftId: 'SHIFT-1',
    userId: 'USER-1',
    status: spec.status ?? 'COMPLETED',
    entryMode: spec.entryMode ?? 'ITEMISED',
    orderType: 'TAKE_OUT',
    subtotal: spec.total,
    discountTotal: 0,
    taxTotal: spec.tax ?? 0,
    taxExemptTotal: 0,
    total: spec.total,
    cogsTotal: spec.cogs ?? 0,
    itemCount: (spec.lines ?? []).reduce((sum, line) => sum + line.qty, 0) || 1,
    customerName: '',
    note: '',
    occurredAt: spec.at,
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
    refundOfSaleId: null,
    refundedTotal: 0,
    ...(spec.cupCount === undefined ? {} : { cupCount: spec.cupCount }),
    ...(spec.snackCount === undefined ? {} : { snackCount: spec.snackCount }),
  })

  const writes: PendingWrite[] = [created('sales', sale)]

  for (const [index, line] of (spec.lines ?? []).entries()) {
    writes.push(
      created(
        'saleItems',
        stamp<SaleItem>({
          saleId: sale.id,
          productId: line.product,
          variantId: `${line.product}-${line.variant}`,
          productName: line.product,
          variantName: line.variant,
          categoryName: line.category,
          quantity: line.qty,
          unitPrice: Math.round(line.revenue / line.qty),
          modifiers: [],
          modifiersTotal: 0,
          lineSubtotal: line.revenue,
          lineDiscount: 0,
          lineTotal: line.revenue,
          lineCogs: line.cogs,
          note: '',
          sortOrder: index,
        }),
      ),
    )
  }

  if (spec.payment) {
    writes.push(
      created(
        'payments',
        stamp<Payment>({
          saleId: sale.id,
          method: spec.payment,
          amount: spec.total,
          tendered: spec.total,
          change: 0,
          reference: '',
          verification: 'NOT_REQUIRED',
          verifiedAt: null,
        }),
      ),
    )
  }

  await commit(writes)
  return sale
}

/** An ingredient plus the movement that took it off the shelf for a sale. */
async function consume(input: {
  name: string
  boughtFor: number
  boughtQty: number
  usedBase: number
  at: number
  referenceType?: InventoryMovement['referenceType']
}): Promise<void> {
  const costRate = costRateFromPurchase(input.boughtFor, input.boughtQty, 'g')
  const ingredient = stamp<Ingredient>({
    name: input.name,
    sku: '',
    stockClass: 'INGREDIENT',
    dimension: 'MASS',
    displayUnit: 'g',
    costRate,
    supplierId: null,
    lowStockThresholdBase: 0,
    trackStock: true,
    active: true,
  })

  await commit([
    created('ingredients', ingredient),
    created(
      'inventoryMovements',
      stamp<InventoryMovement>({
        ingredientId: ingredient.id,
        type: 'SALE',
        baseQuantity: -input.usedBase,
        costRate,
        reason: 'Sold',
        referenceType: input.referenceType ?? 'SALE',
        referenceId: 'SALE-1',
        shiftId: 'SHIFT-1',
        userId: 'USER-1',
        occurredAt: input.at,
      }),
    ),
  ])
}

describe('closing the day', () => {
  test('reports nothing rung up as a quiet day rather than a bad one', async () => {
    const summary = await buildEndOfDay(new Date())
    expect(summary.quiet).toBe(true)
    expect(summary.orders).toBe(0)
    expect(summary.analytics.grossRevenue).toBe(0)
  })

  test('the sales breakdown adds up to the total sales', async () => {
    await addSale({
      total: fromDecimal(300),
      cogs: fromDecimal(90),
      at: today(9),
      lines: [
        { product: 'Latte', variant: '16oz', category: 'Coffee', qty: 1, revenue: fromDecimal(140), cogs: fromDecimal(40) },
        { product: 'Mocha', variant: '16oz', category: 'Coffee', qty: 1, revenue: fromDecimal(160), cogs: fromDecimal(50) },
      ],
    })
    await addSale({
      total: fromDecimal(95),
      cogs: fromDecimal(35),
      at: today(11),
      lines: [
        { product: 'Croissant', variant: 'Regular', category: 'Pastries', qty: 1, revenue: fromDecimal(95), cogs: fromDecimal(35) },
      ],
    })

    const summary = await buildEndOfDay(new Date())
    const fromCategories = summary.byCategory.reduce((sum, row) => sum + row.revenue, 0)
    const fromProducts = summary.byProduct.reduce((sum, row) => sum + row.revenue, 0)

    expect(fromCategories).toBe(summary.analytics.grossRevenue)
    expect(fromProducts).toBe(summary.analytics.grossRevenue)
  })

  test('the cost breakdown adds up to the total cost of goods', async () => {
    await addSale({
      total: fromDecimal(300),
      cogs: fromDecimal(90),
      at: today(9),
      lines: [
        { product: 'Latte', variant: '16oz', category: 'Coffee', qty: 2, revenue: fromDecimal(300), cogs: fromDecimal(90) },
      ],
    })

    const fromCategories = (await buildEndOfDay(new Date())).byCategory.reduce((sum, row) => sum + row.cogs, 0)
    expect(fromCategories).toBe(fromDecimal(90))
  })

  test('shares are of the whole, so they come to a hundred', async () => {
    await addSale({
      total: fromDecimal(400),
      at: today(9),
      lines: [
        { product: 'Latte', variant: '16oz', category: 'Coffee', qty: 1, revenue: fromDecimal(300), cogs: 0 },
        { product: 'Croissant', variant: 'Regular', category: 'Pastries', qty: 1, revenue: fromDecimal(100), cogs: 0 },
      ],
    })

    const summary = await buildEndOfDay(new Date())
    expect(Math.round(summary.byCategory.reduce((sum, row) => sum + row.share, 0))).toBe(100)
    expect(summary.byCategory[0]?.name).toBe('Coffee')
    expect(Math.round(summary.byCategory[0]?.share ?? 0)).toBe(75)
  })

  test('names the stock that left the shelf, dearest first', async () => {
    await addSale({ total: fromDecimal(300), cogs: fromDecimal(100), at: today(9) })
    // 1 kg of beans for 850.00 -> 30 g used is 25.50.
    await consume({ name: 'Beans', boughtFor: fromDecimal(850), boughtQty: 1000, usedBase: 30, at: today(9) })
    // 1 kg of sugar for 60.00 -> 20 g used is 1.20.
    await consume({ name: 'Sugar', boughtFor: fromDecimal(60), boughtQty: 1000, usedBase: 20, at: today(9) })

    const summary = await buildEndOfDay(new Date())
    expect(summary.byIngredient.map((row) => row.name)).toEqual(['Beans', 'Sugar'])
    expect(summary.byIngredient[0]?.cost).toBe(fromDecimal(25.5))
    expect(summary.byIngredient[0]?.used).toContain('30')
  })

  test('leaves deliveries and stocktakes out of what the day cost', async () => {
    await addSale({ total: fromDecimal(300), cogs: fromDecimal(100), at: today(9) })
    await consume({ name: 'Beans', boughtFor: fromDecimal(850), boughtQty: 1000, usedBase: 30, at: today(9) })
    await consume({
      name: 'Milk',
      boughtFor: fromDecimal(100),
      boughtQty: 1000,
      usedBase: 500,
      at: today(10),
      referenceType: 'ADJUSTMENT',
    })

    const summary = await buildEndOfDay(new Date())
    expect(summary.byIngredient.map((row) => row.name)).toEqual(['Beans'])
  })

  test('says how much cost the ledger cannot explain rather than inventing it', async () => {
    // A sale that recorded 100.00 of cost, with only 25.50 of stock behind it.
    await addSale({ total: fromDecimal(300), cogs: fromDecimal(100), at: today(9) })
    await consume({ name: 'Beans', boughtFor: fromDecimal(850), boughtQty: 1000, usedBase: 30, at: today(9) })

    const summary = await buildEndOfDay(new Date())
    expect(summary.unexplainedCogs).toBe(fromDecimal(100) - fromDecimal(25.5))
  })

  test('never reports a negative unexplained cost', async () => {
    await addSale({ total: fromDecimal(300), cogs: fromDecimal(10), at: today(9) })
    await consume({ name: 'Beans', boughtFor: fromDecimal(850), boughtQty: 1000, usedBase: 30, at: today(9) })

    expect((await buildEndOfDay(new Date())).unexplainedCogs).toBe(0)
  })

  test('flags takings entered as a lump sum, which have no cost behind them', async () => {
    await addSale({ total: fromDecimal(4500), at: today(9), entryMode: 'LUMP_SUM', cupCount: 32 })

    const summary = await buildEndOfDay(new Date())
    expect(summary.uncostedSales).toBe(fromDecimal(4500))
    expect(summary.cups).toBe(32)
  })

  test('leaves a voided sale out of every figure', async () => {
    await addSale({
      total: fromDecimal(300),
      cogs: fromDecimal(90),
      at: today(9),
      status: 'VOIDED',
      lines: [
        { product: 'Latte', variant: '16oz', category: 'Coffee', qty: 1, revenue: fromDecimal(300), cogs: fromDecimal(90) },
      ],
    })

    const summary = await buildEndOfDay(new Date())
    expect(summary.quiet).toBe(true)
    expect(summary.byCategory).toEqual([])
  })

  test('splits the takings by how they were paid', async () => {
    await addSale({ total: fromDecimal(140), at: today(9), payment: 'CASH' })
    await addSale({ total: fromDecimal(160), at: today(10), payment: 'GCASH' })

    const summary = await buildEndOfDay(new Date())
    const paid = summary.payments.reduce((sum, slice) => sum + slice.amount, 0)
    expect(paid).toBe(summary.analytics.grossRevenue)
  })

  test('does not pick up another day', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await addSale({ total: fromDecimal(999), at: yesterday.getTime() })
    await addSale({ total: fromDecimal(140), at: today(9) })

    expect((await buildEndOfDay(new Date())).analytics.grossRevenue).toBe(fromDecimal(140))
  })

  test('a voided order leaves no stock behind in the cost of the day', async () => {
    await addSale({ total: fromDecimal(300), cogs: fromDecimal(100), at: today(9) })
    await consume({ name: 'Beans', boughtFor: fromDecimal(850), boughtQty: 1000, usedBase: 30, at: today(9) })

    // What a void writes: the exact inverse, against the same sale.
    const beans = (await db.ingredients.toArray())[0]!
    await commit([
      created(
        'inventoryMovements',
        stamp<InventoryMovement>({
          ingredientId: beans.id,
          type: 'VOID_RETURN',
          baseQuantity: 30,
          costRate: beans.costRate,
          reason: 'Void',
          referenceType: 'SALE',
          referenceId: 'SALE-1',
          shiftId: 'SHIFT-1',
          userId: 'USER-1',
          occurredAt: today(10),
        }),
      ),
    ])

    const summary = await buildEndOfDay(new Date())
    expect(summary.byIngredient).toEqual([])
  })

  test('no share of the cost can exceed the whole', async () => {
    await addSale({ total: fromDecimal(300), cogs: fromDecimal(100), at: today(9) })
    await consume({ name: 'Beans', boughtFor: fromDecimal(850), boughtQty: 1000, usedBase: 30, at: today(9) })
    await consume({ name: 'Milk', boughtFor: fromDecimal(100), boughtQty: 1000, usedBase: 180, at: today(9) })

    const summary = await buildEndOfDay(new Date())
    const total = summary.byIngredient.reduce((sum, row) => sum + row.share, 0)
    expect(total).toBeLessThanOrEqual(100)
  })

  test('carries the costs as recorded, not just their totals', async () => {
    await addSale({ total: fromDecimal(300), at: today(9) })
    await commit([
      created(
        'operatingExpenses',
        stamp<OperatingExpense>({
          category: 'UTILITIES',
          label: 'Electricity',
          amount: fromDecimal(120),
          kind: 'FIXED',
          staffId: null,
          note: '',
          occurredAt: today(10),
          userId: 'USER-1',
        }),
      ),
    ])

    const summary = await buildEndOfDay(new Date())
    expect(summary.expenses).toHaveLength(1)
    expect(summary.expenses[0]?.label).toBe('Electricity')
    expect(summary.pnl.totalExpenses).toBe(fromDecimal(120))
    expect(summary.pnl.netProfit).toBe(summary.pnl.grossProfit - fromDecimal(120))
  })

  test('the bottom line reconciles sales, cost and running costs', async () => {
    await addSale({ total: fromDecimal(300), tax: fromDecimal(32.14), cogs: fromDecimal(90), at: today(9) })

    const summary = await buildEndOfDay(new Date())
    expect(summary.pnl.netSales).toBe(summary.analytics.grossRevenue - summary.analytics.taxTotal)
    expect(summary.pnl.grossProfit).toBe(summary.pnl.netSales - summary.analytics.cogsTotal)
    expect(summary.pnl.netProfit).toBe(summary.pnl.grossProfit - summary.pnl.totalExpenses)
  })
})
