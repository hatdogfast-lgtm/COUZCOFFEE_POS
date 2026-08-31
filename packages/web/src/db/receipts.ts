import type {
  BusinessSettings,
  CurrencyFormat,
  PaperWidth,
  PrintRoute,
  ReceiptInput,
  Sale,
} from '@pos/shared'
import { DOT_WIDTH, loyaltyOf, receiptSectionsOf } from '@pos/shared'
import { db } from './database.ts'
import { toRaster } from '../lib/image.ts'

/**
 * Rebuilding a receipt from what was stored.
 *
 * A reprint is assembled from the sale's own rows rather than from anything
 * held in memory, so a receipt printed a month later says exactly what the
 * original said - including the prices and names as they were at the time,
 * which is why those were snapshotted onto the sale in the first place.
 */

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
  MAYA: 'Maya',
  CARD: 'Card',
  LOYALTY: 'Loyalty card',
}

/**
 * The printer settings, with sensible answers for a shop set up before this
 * existed. A missing field must never leave the till unable to print.
 */
export function printerConfig(settings: BusinessSettings | null | undefined): {
  paperWidth: PaperWidth
  printRoute: PrintRoute
  autoPrint: boolean
  openDrawerOnCash: boolean
} {
  const receipt = settings?.receipt
  return {
    paperWidth: receipt?.paperWidth === 80 ? 80 : 58,
    printRoute: receipt?.printRoute ?? 'BROWSER',
    autoPrint: receipt?.autoPrint ?? false,
    openDrawerOnCash: receipt?.openDrawerOnCash ?? false,
  }
}

export function currencyOf(settings: BusinessSettings | null | undefined): CurrencyFormat {
  return {
    symbol: settings?.currencySymbol ?? '₱',
    code: settings?.currencyCode ?? 'PHP',
    locale: settings?.locale ?? 'en-PH',
    minorPerMajor: 100,
  }
}

const alive = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null)

/**
 * Assemble a receipt for a sale that is already on the books.
 *
 * Returns null when the sale is gone, so a caller cannot print a receipt for
 * something that no longer exists.
 */
export async function receiptForSale(input: {
  saleId: string
  settings: BusinessSettings
  paperWidth?: PaperWidth
  reprint?: boolean
  /** Convert the logo to dots. Only worth doing for a thermal printer. */
  withLogo?: boolean
}): Promise<ReceiptInput | null> {
  const sale = await db.sales.get(input.saleId)
  if (!sale || sale.deletedAt !== null) return null

  const [items, discounts, payments, users, original] = await Promise.all([
    db.saleItems.where('saleId').equals(sale.id).toArray(),
    db.saleDiscounts.where('saleId').equals(sale.id).toArray(),
    db.payments.where('saleId').equals(sale.id).toArray(),
    db.users.toArray(),
    sale.refundOfSaleId ? db.sales.get(sale.refundOfSaleId) : Promise.resolve(undefined),
  ])

  const config = printerConfig(input.settings)
  const paperWidth = input.paperWidth ?? config.paperWidth
  const cashier = users.find((user) => user.id === sale.userId)

  // Converting costs a canvas pass, so it only happens for the route that
  // needs dots. The browser route prints the picture itself.
  const logo =
    input.withLogo && input.settings.branding.logoDataUrl
      ? await toRaster(input.settings.branding.logoDataUrl, DOT_WIDTH[paperWidth])
      : null

  const cashTendered = alive(payments)
    .filter((payment) => payment.method === 'CASH')
    .reduce((total, payment) => total + payment.tendered, 0)
  const cashSettled = alive(payments)
    .filter((payment) => payment.method === 'CASH')
    .reduce((total, payment) => total + payment.amount, 0)

  return {
    paperWidth,
    currency: currencyOf(input.settings),
    logo,
    business: {
      name: input.settings.branding.businessName,
      legalName: input.settings.branding.legalName,
      address: input.settings.branding.address,
      contact: input.settings.branding.contactNumber,
      taxId: input.settings.branding.taxId,
    },
    meta: {
      receiptNo: sale.receiptNo,
      queueNo: sale.queueNo || undefined,
      occurredAt: sale.occurredAt,
      recordedAt: sale.createdAt,
      cashierName: cashier?.name ?? 'Unknown',
      terminal: sale.deviceId,
      orderType: sale.orderType,
      customerName: sale.customerName || undefined,
    },
    items: alive(items)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        quantity: item.quantity,
        name: item.productName,
        // Modifiers are stored as objects, so they are named explicitly. An
        // empty list must contribute nothing rather than an empty segment -
        // an array is truthy, and filter(Boolean) would keep it.
        detail:
          [item.variantName, (item.modifiers ?? []).map((modifier) => modifier.optionName).join(', ')]
            .filter((part) => part && part.length > 0)
            .join(' · ') || undefined,
        amount: item.lineTotal,
      })),
    discounts: alive(discounts).map((discount) => ({
      label: discount.label,
      amount: discount.amount,
      referenceNo: discount.referenceNo || undefined,
      beneficiaryName: discount.beneficiaryName || undefined,
    })),
    totals: {
      subtotal: sale.subtotal,
      discountTotal: sale.discountTotal,
      // A stored sale keeps its totals but not the split, so the VATable
      // portion is what is left once the exempt part is taken out.
      taxableSales: Math.max(0, sale.total - sale.taxTotal),
      taxExemptSales: 0,
      zeroRatedSales: 0,
      taxTotal: sale.taxTotal,
      taxExemptTotal: sale.taxExemptTotal,
      total: sale.total,
      taxLabel: input.settings.tax.label,
      taxEnabled: input.settings.tax.enabled && sale.taxTotal > 0,
    },
    payments: alive(payments).map((payment) => ({
      label: PAYMENT_LABELS[payment.method] ?? payment.method,
      amount: payment.amount,
      reference: payment.reference || undefined,
    })),
    change: Math.max(0, cashTendered - cashSettled),
    footer: input.settings.branding.receiptFooter,
    sections: receiptSectionsOf(input.settings),
    loyaltyNote: loyaltyNoteFor(input.settings),
    reprint: input.reprint ?? true,
    voided: sale.status === 'VOIDED',
    refundOf: original?.receiptNo ?? null,
  }
}

/** A receipt built straight from a sale record, for the moment it completes. */
export function receiptForFreshSale(input: {
  sale: Sale
  settings: BusinessSettings
  items: Array<{ quantity: number; name: string; detail?: string; amount: number }>
  discounts: Array<{ label: string; amount: number; referenceNo?: string; beneficiaryName?: string }>
  payments: Array<{ label: string; amount: number; reference?: string }>
  change: number
  cashierName: string
  taxableSales: number
  taxExemptSales: number
  zeroRatedSales: number
}): ReceiptInput {
  const config = printerConfig(input.settings)

  return {
    paperWidth: config.paperWidth,
    currency: currencyOf(input.settings),
    business: {
      name: input.settings.branding.businessName,
      legalName: input.settings.branding.legalName,
      address: input.settings.branding.address,
      contact: input.settings.branding.contactNumber,
      taxId: input.settings.branding.taxId,
    },
    meta: {
      receiptNo: input.sale.receiptNo,
      queueNo: input.sale.queueNo || undefined,
      occurredAt: input.sale.occurredAt,
      recordedAt: input.sale.createdAt,
      cashierName: input.cashierName,
      terminal: input.sale.deviceId,
      orderType: input.sale.orderType,
      customerName: input.sale.customerName || undefined,
    },
    items: input.items,
    discounts: input.discounts,
    totals: {
      subtotal: input.sale.subtotal,
      discountTotal: input.sale.discountTotal,
      taxableSales: input.taxableSales,
      taxExemptSales: input.taxExemptSales,
      zeroRatedSales: input.zeroRatedSales,
      taxTotal: input.sale.taxTotal,
      taxExemptTotal: input.sale.taxExemptTotal,
      total: input.sale.total,
      taxLabel: input.settings.tax.label,
      taxEnabled: input.settings.tax.enabled,
    },
    payments: input.payments,
    change: input.change,
    footer: input.settings.branding.receiptFooter,
    sections: receiptSectionsOf(input.settings),
    loyaltyNote: loyaltyNoteFor(input.settings),
    reprint: false,
    voided: false,
    refundOf: null,
  }
}

/**
 * The loyalty line, when the shop has an offer to state.
 *
 * The till has no idea who the customer is, so this is the offer rather than
 * their balance - it tells them what the deal is, and nothing it cannot know.
 */
function loyaltyNoteFor(settings: BusinessSettings): string | undefined {
  const loyalty = loyaltyOf(settings)
  if (!loyalty.enabled || !loyalty.printOnReceipt) return undefined
  return `Buy ${loyalty.cupsPerReward} and get ${loyalty.rewardLabel}.`
}
