import { row, type PaperWidth, type RasterImage, type ReceiptRow } from './escpos.ts'
import { formatMoney, type CurrencyFormat, type Money } from './money.ts'
import { receiptSectionsOf, FIXED_POSITION_SECTIONS, type ReceiptSection } from './types.ts'

/**
 * What goes on a receipt.
 *
 * There is exactly one composer, and both the paper and the screen preview are
 * rendered from it. Two separate layouts drift, and the day they drift is the
 * day the printed copy and the copy the customer was shown stop agreeing about
 * what was charged.
 *
 * The tax block follows Philippine practice: the sale is broken into VATable,
 * VAT-exempt and zero-rated, the VAT itself is shown separately, and a senior
 * citizen or PWD concession prints the identification and leaves a line to
 * sign - those details are what makes the concession auditable rather than a
 * discount somebody typed in.
 */

export interface ReceiptLineItem {
  quantity: number
  name: string
  /** Size, modifiers, or a note - printed under the name when present. */
  detail?: string
  amount: Money
}

export interface ReceiptDiscount {
  label: string
  amount: Money
  /** Senior citizen or PWD identification, where the law requires it. */
  referenceNo?: string
  beneficiaryName?: string
}

export interface ReceiptPayment {
  label: string
  amount: Money
  reference?: string
}

export interface ReceiptInput {
  paperWidth: PaperWidth
  currency: CurrencyFormat
  /** The shop logo, already reduced to dots for the print head. */
  logo?: RasterImage | null
  business: {
    name: string
    legalName?: string
    address?: string
    contact?: string
    taxId?: string
  }
  meta: {
    receiptNo: string
    queueNo?: string
    occurredAt: number
    /** When the sale was keyed, if that differs from when it happened. */
    recordedAt?: number
    cashierName: string
    terminal?: string
    orderType?: string
    customerName?: string
  }
  items: ReceiptLineItem[]
  discounts: ReceiptDiscount[]
  totals: {
    subtotal: Money
    discountTotal: Money
    taxableSales: Money
    taxExemptSales: Money
    zeroRatedSales: Money
    taxTotal: Money
    /** Tax lifted by a statutory concession, reported rather than collected. */
    taxExemptTotal: Money
    total: Money
    taxLabel: string
    taxEnabled: boolean
  }
  payments: ReceiptPayment[]
  change: Money
  footer?: string
  /** Which parts print, and in what order. Omitted means the usual order. */
  sections?: ReceiptSection[]
  /** A line about the shop's loyalty offer, when it has one. */
  loyaltyNote?: string
  /** A second copy of something already issued. */
  reprint?: boolean
  voided?: boolean
  /** The receipt this one reverses, if it is a refund. */
  refundOf?: string | null
}

function when(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Compose the receipt.
 *
 * Ordering is the order a person checks a receipt in: who it is from, which
 * receipt it is, what was bought, what came off, what the tax was, what was
 * paid. Nothing is printed that is always zero.
 */
export function composeReceipt(input: ReceiptInput): ReceiptRow[] {
  const money = (amount: Money): string => formatMoney(amount, input.currency)

  // Which parts print, and in what order. A shop that has said nothing gets the
  // order below; the required ones are put back by `receiptSectionsOf` whatever
  // the stored setting says, so no configuration can produce an invalid receipt.
  const sections = receiptSectionsOf({ receiptSections: input.sections })
  const showing = (section: ReceiptSection): boolean => sections.includes(section)

  const parts: Record<ReceiptSection, () => ReceiptRow[]> = {
    // The logo goes above the name rather than instead of it: a receipt has to
    // stay readable when the paper is faint or the logo did not convert.
    LOGO: () => (input.logo ? [row.image(input.logo)] : []),

    BUSINESS: () => {
      const out: ReceiptRow[] = [row.text(input.business.name, { align: 'center', bold: true, large: true })]
      if (input.business.legalName && input.business.legalName !== input.business.name) {
        out.push(row.text(input.business.legalName, { align: 'center' }))
      }
      if (input.business.address) out.push(row.text(input.business.address, { align: 'center' }))
      if (input.business.contact) out.push(row.text(input.business.contact, { align: 'center' }))
      if (input.business.taxId) out.push(row.text(`VAT REG TIN ${input.business.taxId}`, { align: 'center' }))
      out.push(row.feed())

      if (input.voided) {
        out.push(row.text('*** VOIDED ***', { align: 'center', bold: true }), row.feed())
      } else if (input.refundOf) {
        out.push(row.text('*** REFUND ***', { align: 'center', bold: true }))
        out.push(row.text(`against ${input.refundOf}`, { align: 'center' }), row.feed())
      } else if (input.reprint) {
        // A duplicate has to say so on its face, or it can be presented as a
        // second sale that never happened.
        out.push(row.text('*** REPRINT ***', { align: 'center', bold: true }), row.feed())
      } else {
        out.push(row.text('OFFICIAL RECEIPT', { align: 'center', bold: true }), row.feed())
      }
      return out
    },

    ORDER_META: () => {
      const out: ReceiptRow[] = [
        row.columns('Receipt', input.meta.receiptNo),
        row.columns('Date', when(input.meta.occurredAt)),
      ]
      if (input.meta.recordedAt && Math.abs(input.meta.recordedAt - input.meta.occurredAt) > 60_000) {
        // A backdated sale says when it was actually keyed, so the two dates on
        // the books can always be reconciled.
        out.push(row.columns('Entered', when(input.meta.recordedAt)))
      }
      out.push(row.columns('Served by', input.meta.cashierName))
      if (input.meta.terminal) out.push(row.columns('Terminal', input.meta.terminal))
      if (input.meta.orderType) out.push(row.columns('Order', input.meta.orderType))
      if (input.meta.customerName) out.push(row.columns('Customer', input.meta.customerName))
      return out
    },

    QUEUE: () =>
      input.meta.queueNo
        ? [row.feed(), row.text(input.meta.queueNo, { align: 'center', bold: true, large: true })]
        : [],

    ITEMS: () => {
      const out: ReceiptRow[] = [row.divider()]
      if (input.items.length === 0) out.push(row.text('No itemised lines'))
      for (const item of input.items) {
        out.push(row.columns(`${item.quantity} x ${item.name}`, money(item.amount)))
        if (item.detail) out.push(row.text(`    ${item.detail}`))
      }
      out.push(row.divider())
      return out
    },

    TOTALS: () => {
      const out: ReceiptRow[] = [row.columns('Subtotal', money(input.totals.subtotal))]

      for (const discount of input.discounts) {
        out.push(row.columns(discount.label, `-${money(discount.amount)}`))
        if (discount.beneficiaryName) out.push(row.text(`    ${discount.beneficiaryName}`))
        if (discount.referenceNo) out.push(row.text(`    ID ${discount.referenceNo}`))
      }

      // The tax lines belong between the discounts and the total, where the
      // arithmetic reads in order, so this section says whether they print
      // rather than where.
      if (showing('TAX_BREAKDOWN')) out.push(...taxRows())

      out.push(row.divider())
      out.push(row.columns('TOTAL', money(input.totals.total), { bold: true }))
      out.push(row.divider())
      return out
    },

    TAX_BREAKDOWN: () => [],

    PAYMENTS: () => {
      const out: ReceiptRow[] = []
      for (const payment of input.payments) {
        out.push(row.columns(payment.label, money(payment.amount)))
        if (payment.reference) out.push(row.text(`    Ref ${payment.reference}`))
      }
      if (input.change > 0) out.push(row.columns('Change', money(input.change)))
      return out
    },

    SIGNATURE: () => {
      const statutory = input.discounts.find((discount) => discount.referenceNo)
      if (!statutory) return []
      return [
        row.feed(),
        row.text('Signature over printed name'),
        row.feed(2),
        row.text('..............................'),
        row.text(statutory.beneficiaryName ?? ''),
      ]
    },

    LOYALTY: () => (input.loyaltyNote ? [row.feed(), row.text(input.loyaltyNote, { align: 'center' })] : []),

    FOOTER: () => {
      const out: ReceiptRow[] = [row.feed()]
      if (input.footer) out.push(row.text(input.footer, { align: 'center' }))
      out.push(row.text('This serves as your official receipt.', { align: 'center' }))
      out.push(row.text('Thank you!', { align: 'center' }))
      return out
    },
  }

  function taxRows(): ReceiptRow[] {
    if (!input.totals.taxEnabled) return []
    const out: ReceiptRow[] = []
    if (input.totals.taxableSales > 0) {
      out.push(row.columns(`${input.totals.taxLabel}able sales`, money(input.totals.taxableSales)))
    }
    if (input.totals.taxExemptSales > 0) {
      out.push(row.columns(`${input.totals.taxLabel}-exempt sales`, money(input.totals.taxExemptSales)))
    }
    if (input.totals.zeroRatedSales > 0) {
      out.push(row.columns('Zero-rated sales', money(input.totals.zeroRatedSales)))
    }
    out.push(row.columns(input.totals.taxLabel, money(input.totals.taxTotal)))
    if (input.totals.taxExemptTotal > 0) {
      out.push(row.columns(`${input.totals.taxLabel} lifted`, money(input.totals.taxExemptTotal)))
    }
    return out
  }

  const rows: ReceiptRow[] = []
  for (const section of sections) {
    // TAX_BREAKDOWN is consumed by TOTALS, where it has to sit.
    if (FIXED_POSITION_SECTIONS.includes(section) && section === 'TAX_BREAKDOWN') continue
    rows.push(...parts[section]())
  }

  // The cut is not a section: paper has to be cut whatever was printed on it.
  rows.push(row.cut())

  return rows
}
