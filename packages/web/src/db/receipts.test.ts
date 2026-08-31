import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_LOW_STOCK, DEFAULT_LOYALTY, DEFAULT_STATUTORY_RULES, RECEIPT_SECTIONS, fromDecimal, renderPlain, composeReceipt, type BusinessSettings, type Sale } from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import { currencyOf, printerConfig, receiptForSale } from './receipts.ts'

/**
 * Rebuilding a receipt from the books.
 *
 * A reprint is read back from the stored sale, so these tests care that it
 * says what the original said - the prices and names as they were, the
 * concession with its identification, and an unmistakable mark that it is a
 * duplicate.
 */

const DEVICE = { deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' as const }

async function reset(): Promise<void> {
  __setIdentityForTests(DEVICE)
  await db.delete()
  await db.open()
}

beforeEach(reset)

function settingsRow(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return stamp<BusinessSettings>({
    branding: {
      businessName: 'Corner Roasters',
      legalName: 'Corner Roasters Inc.',
      address: '12 Ortigas Ave',
      contactNumber: '0917 000 0000',
      taxId: '123-456-789-000',
      receiptFooter: 'Please come again.',
    } as never,
    tax: { enabled: true, rate: 12, label: 'VAT', inclusive: true } as never,
    receipt: { prefix: 'OR', nextNumber: 1, padding: 6, paperWidth: 58, printRoute: 'BROWSER', autoPrint: false, openDrawerOnCash: false } as never,
    queue: { prefix: 'Q', padding: 3, start: 1, resetDaily: true } as never,
    currencyCode: 'PHP',
    currencySymbol: '₱',
    locale: 'en-PH',
    statutoryDiscountRate: 20,
    lowStockWarningEnabled: true,
    blockSaleWhenOutOfStock: true,
    includeLabourInCost: false,
    backdatingEnabled: false,
    requireReferenceFor: [],
    plannerPasscodeHash: null,
    dashboardTiles: {},
    statutoryRules: DEFAULT_STATUTORY_RULES,
    receiptSections: RECEIPT_SECTIONS,
    lowStock: DEFAULT_LOW_STOCK,
    loyalty: DEFAULT_LOYALTY,
    ...overrides,
  })
}

async function seedSale(): Promise<{ sale: Sale; settings: BusinessSettings }> {
  const settings = settingsRow()
  const sale = stamp<Sale>({
    receiptNo: 'OR-01-000042',
    queueNo: 'Q014',
    shiftId: 'S-1',
    userId: 'U-ANA',
    status: 'COMPLETED',
    entryMode: 'ITEMISED',
    orderType: 'DINE_IN',
    subtotal: fromDecimal(280),
    discountTotal: 0,
    taxTotal: fromDecimal(30),
    taxExemptTotal: 0,
    total: fromDecimal(280),
    cogsTotal: 0,
    itemCount: 2,
    customerName: '',
    note: '',
    occurredAt: Date.UTC(2026, 7, 30, 4, 0, 0),
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
    refundOfSaleId: null,
    refundedTotal: 0,
  })

  await commit([
    created('settings', settings),
    created(
      'users',
      stamp({
        name: 'Ana',
        role: 'OWNER',
        pinHash: '',
        active: true,
        employeeCode: '001',
        failedAttempts: 0,
        lockedUntil: null,
        permissionOverrides: {},
        id: 'U-ANA',
      } as never),
    ),
    created('sales', sale),
    created(
      'saleItems',
      stamp({
        saleId: sale.id,
        productId: 'P-1',
        variantId: 'V-1',
        productName: 'Cafe Latte',
        variantName: '16oz',
        categoryName: 'Espresso',
        quantity: 2,
        unitPrice: fromDecimal(140),
        modifiers: [],
        modifiersTotal: 0,
        lineSubtotal: fromDecimal(280),
        lineDiscount: 0,
        lineTotal: fromDecimal(280),
        lineCogs: 0,
        note: '',
        sortOrder: 0,
      } as never),
    ),
    created(
      'payments',
      stamp({
        saleId: sale.id,
        method: 'CASH',
        amount: fromDecimal(280),
        tendered: fromDecimal(300),
        change: fromDecimal(20),
        reference: '',
        verification: 'NOT_REQUIRED',
        verifiedAt: null,
      } as never),
    ),
  ])

  return { sale, settings }
}

const asText = async (saleId: string, settings: BusinessSettings): Promise<string> => {
  const receipt = await receiptForSale({ saleId, settings })
  if (!receipt) throw new Error('no receipt')
  return renderPlain(composeReceipt(receipt), receipt.paperWidth).join('\n')
}

describe('settings that predate the printer', () => {
  test('fall back to something that always works rather than nothing', () => {
    // A shop set up before these fields existed must still be able to print.
    const legacy = { receipt: { prefix: 'OR', nextNumber: 1, padding: 6 } } as unknown as BusinessSettings
    expect(printerConfig(legacy)).toEqual({
      paperWidth: 58,
      printRoute: 'BROWSER',
      autoPrint: false,
      openDrawerOnCash: false,
    })
  })

  test('survive having no settings at all', () => {
    expect(printerConfig(null).printRoute).toBe('BROWSER')
    expect(currencyOf(null).symbol).toBe('₱')
  })

  test('honour the width once it is chosen', () => {
    const wide = settingsRow()
    wide.receipt.paperWidth = 80
    expect(printerConfig(wide).paperWidth).toBe(80)
  })
})

describe('a reprint from the books', () => {
  test('says what the original said', async () => {
    const { sale, settings } = await seedSale()
    const out = await asText(sale.id, settings)

    expect(out).toContain('Corner Roasters')
    expect(out).toContain('OR-01-000042')
    expect(out).toContain('VAT REG TIN 123-456-789-000')
    expect(out).toContain('Cafe Latte')
    expect(out).toMatch(/TOTAL\s+P280\.00/)
  })

  test('is marked as a duplicate on its face', async () => {
    const { sale, settings } = await seedSale()
    expect(await asText(sale.id, settings)).toContain('*** REPRINT ***')
  })

  test('works out the change from what was actually tendered', async () => {
    const { sale, settings } = await seedSale()
    // 300 handed over against 280 owed.
    expect(await asText(sale.id, settings)).toMatch(/Change\s+P20\.00/)
  })

  test('names the cashier from the stored record', async () => {
    const { sale, settings } = await seedSale()
    expect(await asText(sale.id, settings)).toContain('Ana')
  })

  test('marks a voided sale so it cannot pass as a live one', async () => {
    const { sale, settings } = await seedSale()
    await db.sales.update(sale.id, { status: 'VOIDED' })
    expect(await asText(sale.id, settings)).toContain('*** VOIDED ***')
  })

  test('refuses to print a sale that is not there', async () => {
    const { settings } = await seedSale()
    expect(await receiptForSale({ saleId: 'GONE', settings })).toBeNull()
  })

  test('leaves out a deleted line rather than printing it', async () => {
    const { sale, settings } = await seedSale()
    const item = (await db.saleItems.toArray())[0]!
    await db.saleItems.update(item.id, { deletedAt: Date.now() })

    const out = await asText(sale.id, settings)
    expect(out).not.toContain('Cafe Latte')
  })

  test('fits the paper at both widths', async () => {
    const { sale, settings } = await seedSale()
    for (const width of [58, 80] as const) {
      const receipt = await receiptForSale({ saleId: sale.id, settings, paperWidth: width })
      const columns = width === 58 ? 32 : 48
      for (const line of renderPlain(composeReceipt(receipt!), width)) {
        expect(line.length).toBeLessThanOrEqual(columns)
      }
    }
  })

  test('names the modifiers instead of printing [object Object]', async () => {
    const { sale, settings } = await seedSale()
    const item = (await db.saleItems.toArray())[0]!
    await db.saleItems.update(item.id, {
      modifiers: [
        { groupId: 'G1', groupName: 'Milk', optionId: 'O1', optionName: 'Oat milk', priceDelta: 2000 },
        { groupId: 'G2', groupName: 'Shots', optionId: 'O2', optionName: 'Extra shot', priceDelta: 3000 },
      ],
    })

    const out = await asText(sale.id, settings)
    expect(out).toContain('Oat milk')
    expect(out).toContain('Extra shot')
    expect(out).not.toContain('object Object')
  })

  test('leaves no dangling separator when a line has no modifiers', async () => {
    const { sale, settings } = await seedSale()
    const receipt = await receiptForSale({ saleId: sale.id, settings })

    // An empty array is truthy, so a naive filter would leave "16oz - ".
    expect(receipt!.items[0]!.detail).toBe('16oz')
  })

  test('drops the tax block when the sale carried no tax', async () => {
    const { sale, settings } = await seedSale()
    await db.sales.update(sale.id, { taxTotal: 0 })
    const out = await asText(sale.id, settings)
    expect(out).not.toContain('VATable sales')
  })
})
