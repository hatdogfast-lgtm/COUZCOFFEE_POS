import {
  computeTotals,
  newId,
  costOf,
  isStatutoryDiscount,
  statutoryRulesOf,
  type AuditLog,
  type BusinessSettings,
  type DiscountInput,
  type InventoryMovement,
  type Money,
  type OrderTotals,
  type OrderType,
  type Payment,
  type PaymentMethod,
  type PaymentVerification,
  type PricedLine,
  type Sale,
  type SaleDiscount,
  type SaleItem,
  type SaleItemModifier,
  type ServingUnit,
  type User,
} from '@pos/shared'
import { db, META_KEYS, readMeta, writeMeta } from '../db/database.ts'
import { identity } from '../db/identity.ts'
import { commit, created, stamp } from '../db/write.ts'
import type { PendingWrite } from '../db/write.ts'
import { consumptionFor, type MenuData } from '../db/repo.ts'
import { countLines, referenceRequired as requiresReference } from '../db/till.ts'

/**
 * Completing a sale.
 *
 * The whole point of this file is the single `commit` at the end. A sale, its
 * lines, its discounts, its payments, the stock it consumed and the audit
 * entry all land in one IndexedDB transaction, together with the outbox rows
 * that will carry them to the server. There is no intermediate state in which
 * the books describe half a transaction, and no path where a sale is recorded
 * but never queued for sync.
 *
 * Nothing here touches the network. The sale is finished the moment this
 * resolves, whether or not a server exists.
 */

export interface CartLine {
  id: string
  productId: string
  variantId: string
  productName: string
  variantName: string
  categoryName: string
  /**
   * Counted as a cup or by the piece, taken from the category.
   *
   * Optional because a line whose category says nothing is a cup, which is
   * the same answer servingUnitOf gives and what a coffee shop assumes.
   */
  servingUnit?: ServingUnit
  quantity: number
  unitPrice: Money
  modifiers: SaleItemModifier[]
  note: string
  unitCogs: Money
  taxable: boolean
  /**
   * How many of this line are being given away against a loyalty card.
   *
   * Counted rather than flagged, so one drink out of three can be claimed
   * without splitting the line. The line stays in the order at menu price so
   * the receipt shows what it was worth; a matching loyalty discount takes the
   * claimed portion back off the total. Stock and cost are untouched, because
   * every one of those drinks is still made.
   */
  loyaltyFreeQty?: number
}

/** The value of the claimed portion of a line, at menu price. */
export function claimedValue(line: CartLine): Money {
  const claimed = Math.min(line.loyaltyFreeQty ?? 0, line.quantity)
  if (claimed <= 0) return 0
  const unit = line.unitPrice + line.modifiers.reduce((sum, modifier) => sum + modifier.priceDelta, 0)
  return unit * claimed
}

export interface CartDiscount extends DiscountInput {
  referenceNo: string
  beneficiaryName: string
  authorizedBy: string | null
  reason: string
}

export interface TenderInput {
  method: PaymentMethod
  amount: Money
  tendered: Money
  reference: string
}

export interface CheckoutInput {
  lines: CartLine[]
  discounts: CartDiscount[]
  payments: TenderInput[]
  settings: BusinessSettings
  cashier: User
  shiftId: string
  orderType: OrderType
  customerName: string
  note: string
  menu: MenuData
  /** True only when the device has a live, verified server connection. */
  online: boolean
  /**
   * When the sale actually happened, if that is not now.
   *
   * Used to enter an order that was taken while the till was unavailable. The
   * record still carries `createdAt` for when it was keyed in, so the gap
   * between the two is always visible in the audit trail.
   */
  occurredAt?: number
}

/**
 * A loyalty redemption, expressed the way it actually works.
 *
 * The drink is free, so it is recorded as a full-value discount rather than as
 * money received: nothing was taken, and revenue must not say otherwise. The
 * stock is still consumed and the cost of goods is still real, because a free
 * cup of coffee costs exactly as much to make as a paid one. That is what
 * makes the loyalty scheme's true cost visible instead of invisible.
 */
export function loyaltyDiscount(amount: Money, reference = '', beneficiaryName = ''): CartDiscount {
  return {
    id: newId(),
    type: 'LOYALTY',
    label: 'Loyalty claim',
    // An amount, not a rate: exactly what the claimed drinks are worth.
    value: amount,
    referenceNo: reference.trim(),
    beneficiaryName: beneficiaryName.trim(),
    authorizedBy: null,
    reason: 'Loyalty card redemption',
  }
}

export interface CheckoutResult {
  sale: Sale
  totals: OrderTotals
  receiptNo: string
  queueNo: string
  changeDue: Money
}

// --------------------------------------------------------------- numbering --

/**
 * A short, stable discriminator for this terminal.
 *
 * Receipt numbers must stay unique when several devices are numbering
 * independently offline, and a human still has to be able to read one out over
 * the phone. Embedding two characters of the device id does both.
 */
function deviceCode(): string {
  const id = identity().deviceId
  return id.slice(-2).toUpperCase()
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`
}

/** Reserve the next receipt and queue number. Runs inside its own transaction. */
async function reserveNumbers(settings: BusinessSettings): Promise<{ receiptNo: string; queueNo: string }> {
  return db.transaction('rw', db.meta, async () => {
    const receiptCounter = (await readMeta<number>(META_KEYS.receiptCounter, settings.receipt.nextNumber)) || 1
    await writeMeta(META_KEYS.receiptCounter, receiptCounter + 1)

    const storedDate = await readMeta<string>(META_KEYS.queueDate, '')
    const currentDate = today()
    const resetting = settings.queue.resetDaily && storedDate !== currentDate
    const queueCounter = resetting ? settings.queue.start : await readMeta<number>(META_KEYS.queueCounter, settings.queue.start)

    await writeMeta(META_KEYS.queueCounter, queueCounter + 1)
    await writeMeta(META_KEYS.queueDate, currentDate)

    return {
      receiptNo: `${settings.receipt.prefix}-${deviceCode()}-${pad(receiptCounter, settings.receipt.padding)}`,
      queueNo: `${settings.queue.prefix}${pad(queueCounter, settings.queue.padding)}`,
    }
  })
}

// ---------------------------------------------------------------- payments --

/**
 * We never claim an external payment was verified when it could not have been.
 *
 * Cash needs nobody's confirmation. A wallet or card payment taken while the
 * device is offline is recorded on the operator's word, and is labelled that
 * way on the receipt and in the reports until something actually verifies it.
 */
export function verificationFor(method: PaymentMethod, online: boolean): PaymentVerification {
  // Cash needs nobody's confirmation, and neither does a loyalty redemption -
  // no third party is involved and no money moved.
  if (method === 'CASH' || method === 'LOYALTY') return 'NOT_REQUIRED'
  return online ? 'EXTERNALLY_VERIFIED' : 'RECORDED_LOCALLY'
}

export function toPricedLines(lines: CartLine[]): PricedLine[] {
  return lines.map((line) => ({
    id: line.id,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    modifiers: line.modifiers,
    taxable: line.taxable,
    unitCogs: line.unitCogs,
  }))
}

export function totalsFor(
  lines: CartLine[],
  discounts: CartDiscount[],
  settings: BusinessSettings,
): OrderTotals {
  // The shop's own concessions, so what a senior discount does is a setting
  // rather than something baked into the till.
  return computeTotals(toPricedLines(lines), discounts, settings.tax, statutoryRulesOf(settings))
}

// ---------------------------------------------------------------- checkout --

export async function completeSale(input: CheckoutInput): Promise<CheckoutResult> {
  if (input.lines.length === 0) {
    throw new Error('There is nothing in the order yet.')
  }

  const totals = totalsFor(input.lines, input.discounts, input.settings)

  // Cups and pieces are counted at the moment of sale rather than worked out
  // later from the category, because a category can be recategorised and the
  // count on a closed day must not move when it is.
  const counts = countLines(input.lines)

  // A payment method the shop has marked as needing a reference is refused
  // without one. Checked here and not only in the sheet, because this is the
  // path every sale takes.
  for (const payment of input.payments) {
    if (requiresReference(input.settings, payment.method) && payment.reference.trim().length === 0) {
      throw new Error(`A ${payment.method} payment needs its reference number.`)
    }
  }

  // `amount` is what a tender settles; `tendered` is what the customer
  // actually handed over. Only cash can produce change, and only from the
  // gap between those two - a card is never over-tendered.
  const settled = input.payments.reduce((sum, payment) => sum + payment.amount, 0)
  if (settled < totals.total) {
    throw new Error('The amount paid does not cover the order total.')
  }

  const changeForTender = (tender: TenderInput): Money =>
    tender.method === 'CASH' ? Math.max(0, tender.tendered - tender.amount) : 0

  const totalChange = input.payments.reduce((sum, tender) => sum + changeForTender(tender), 0)

  const now = Date.now()
  const occurredAt = input.occurredAt ?? now
  const { receiptNo, queueNo } = await reserveNumbers(input.settings)
  const writes: PendingWrite[] = []

  const sale = stamp<Sale>({
    receiptNo,
    queueNo,
    shiftId: input.shiftId,
    userId: input.cashier.id,
    status: 'COMPLETED',
    entryMode: 'ITEMISED',
    orderType: input.orderType,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    taxExemptTotal: totals.taxExemptTotal,
    total: totals.total,
    cogsTotal: totals.cogsTotal,
    itemCount: totals.itemCount,
    cupCount: counts.cups,
    snackCount: counts.snacks,
    customerName: input.customerName,
    note: input.note,
    occurredAt,
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
    refundOfSaleId: null,
    refundedTotal: 0,
  })
  writes.push(created('sales', sale))

  // Lines, with names frozen so an old receipt never silently changes.
  input.lines.forEach((line, index) => {
    const lineTotals = totals.lines[index]
    writes.push(
      created(
        'saleItems',
        stamp<SaleItem>({
          saleId: sale.id,
          productId: line.productId,
          variantId: line.variantId,
          productName: line.productName,
          variantName: line.variantName,
          categoryName: line.categoryName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          modifiers: line.modifiers,
          modifiersTotal: lineTotals?.modifiersTotal ?? 0,
          lineSubtotal: lineTotals?.lineSubtotal ?? 0,
          lineDiscount: lineTotals?.lineDiscount ?? 0,
          lineTotal: lineTotals?.lineTotal ?? 0,
          lineCogs: lineTotals?.lineCogs ?? 0,
          note: line.note,
          sortOrder: index,
        }),
      ),
    )
  })

  // Discounts, with the statutory ones flagged for the receipt and the books.
  totals.discounts.forEach((breakdown) => {
    const source = input.discounts.find((entry) => entry.id === breakdown.id)
    writes.push(
      created(
        'saleDiscounts',
        stamp<SaleDiscount>({
          saleId: sale.id,
          type: breakdown.type,
          label: breakdown.label,
          value: breakdown.value,
          amount: breakdown.amount,
          taxExempt: isStatutoryDiscount(breakdown.type),
          referenceNo: source?.referenceNo ?? '',
          beneficiaryName: source?.beneficiaryName ?? '',
          authorizedBy: source?.authorizedBy ?? null,
          reason: source?.reason ?? '',
        }),
      ),
    )
  })

  // Payments. Change is only ever attributed to cash.
  for (const tender of input.payments) {
    const change = changeForTender(tender)
    writes.push(
      created(
        'payments',
        stamp<Payment>({
          saleId: sale.id,
          method: tender.method,
          amount: tender.amount,
          tendered: tender.tendered,
          change,
          reference: tender.reference,
          verification: verificationFor(tender.method, input.online),
          verifiedAt: tender.method === 'CASH' || input.online ? now : null,
        }),
      ),
    )
  }

  // Stock consumed, as ledger entries rather than a decrement of a stored total.
  const consumed = new Map<string, number>()
  for (const line of input.lines) {
    const optionIds = line.modifiers.map((modifier) => modifier.optionId)
    for (const usage of consumptionFor(line.variantId, optionIds, input.menu)) {
      consumed.set(usage.ingredientId, (consumed.get(usage.ingredientId) ?? 0) + usage.baseQuantity * line.quantity)
    }
  }
  for (const [ingredientId, baseQuantity] of consumed) {
    if (baseQuantity === 0) continue
    const ingredient = input.menu.ingredientsById.get(ingredientId)
    if (!ingredient || !ingredient.trackStock) continue
    writes.push(
      created(
        'inventoryMovements',
        stamp<InventoryMovement>({
          ingredientId,
          type: 'SALE',
          baseQuantity: -baseQuantity,
          costRate: ingredient.costRate,
          reason: '',
          referenceType: 'SALE',
          referenceId: sale.id,
          shiftId: input.shiftId,
          userId: input.cashier.id,
          occurredAt,
        }),
      ),
    )
  }

  writes.push(
    created(
      'auditLogs',
      stamp<AuditLog>({
        entityType: 'sales',
        entityId: sale.id,
        action: 'SALE_COMPLETED',
        userId: input.cashier.id,
        before: null,
        after: JSON.stringify({
          receiptNo,
          total: totals.total,
          itemCount: totals.itemCount,
          backdated: occurredAt !== now ? new Date(occurredAt).toISOString() : undefined,
        }),
        reason: occurredAt !== now ? 'Entered after the fact' : '',
        occurredAt: now,
      }),
    ),
  )

  // One transaction. Everything above, or nothing at all.
  await commit(writes, now)

  return { sale, totals, receiptNo, queueNo, changeDue: totalChange }
}

/** Cost of one unit as configured right now, used when a line enters the cart. */
export function currentUnitCost(variantId: string, optionIds: string[], menu: MenuData): Money {
  let total = 0
  for (const usage of consumptionFor(variantId, optionIds, menu)) {
    const ingredient = menu.ingredientsById.get(usage.ingredientId)
    if (!ingredient) continue
    total += costOf(usage.baseQuantity, ingredient.costRate)
  }
  return total
}

// -------------------------------------------------------- lump-sum backfill --

export interface LumpSumInput {
  /** Total takings for the day being recorded. */
  amount: Money
  /** How many cups that represented, for a rough volume comparison. */
  cups: number
  /** Counted by the piece: pastries, snacks, anything not in a cup. */
  snacks?: number
  occurredAt: number
  method: PaymentMethod
  settings: BusinessSettings
  cashier: User
  shiftId: string
  note: string
  /** Required when the settings say this method needs one. */
  reference?: string
}

/**
 * Record a past day's takings as a single figure.
 *
 * This exists for the days before the system was in use, where the only
 * surviving record is a total in a notebook. It deliberately does **not**
 * invent detail it does not have: no line items, no stock movements, and no
 * cost of goods - because the cost is unknown, not zero.
 *
 * Marking it LUMP_SUM is what lets the reports include its revenue while
 * keeping it out of margin, so a backfilled day cannot flatter the figures
 * with a 100% margin it never earned.
 */
export async function recordLumpSum(input: LumpSumInput): Promise<Sale> {
  if (input.amount <= 0) throw new Error('Enter the takings for that day.')
  if (!Number.isFinite(input.cups) || input.cups < 0) throw new Error('Enter how many cups were sold.')
  const snacks = Math.max(0, Math.round(input.snacks ?? 0))
  if (input.reference !== undefined && requiresReference(input.settings, input.method) && input.reference.trim().length === 0) {
    throw new Error(`A ${input.method} payment needs its reference number.`)
  }

  const now = Date.now()
  const { receiptNo } = await reserveNumbers(input.settings)

  // Tax is still extracted from the total where prices include it, so the day
  // sits alongside the others on the same basis.
  const tax = input.settings.tax.enabled && input.settings.tax.inclusive
    ? input.amount - Math.round(input.amount / (1 + input.settings.tax.rate / 100))
    : 0

  const sale = stamp<Sale>({
    receiptNo,
    queueNo: '',
    shiftId: input.shiftId,
    userId: input.cashier.id,
    status: 'COMPLETED',
    entryMode: 'LUMP_SUM',
    orderType: 'TAKE_OUT',
    subtotal: input.amount,
    discountTotal: 0,
    taxTotal: tax,
    taxExemptTotal: 0,
    total: input.amount,
    cogsTotal: 0,
    itemCount: Math.round(input.cups) + snacks,
    cupCount: Math.round(input.cups),
    snackCount: snacks,
    customerName: '',
    note: input.note,
    occurredAt: input.occurredAt,
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
    refundOfSaleId: null,
    refundedTotal: 0,
  })

  await commit(
    [
      created('sales', sale),
      created(
        'payments',
        stamp<Payment>({
          saleId: sale.id,
          method: input.method,
          amount: input.amount,
          tendered: input.amount,
          change: 0,
          reference: '',
          verification: 'NOT_REQUIRED',
          verifiedAt: input.occurredAt,
        }),
      ),
      created(
        'auditLogs',
        stamp<AuditLog>({
          entityType: 'sales',
          entityId: sale.id,
          action: 'LUMP_SUM_RECORDED',
          userId: input.cashier.id,
          before: null,
          after: JSON.stringify({
            receiptNo,
            amount: input.amount,
            cups: input.cups,
            forDate: new Date(input.occurredAt).toISOString(),
          }),
          reason: input.note || 'Takings from before the system was in use',
          occurredAt: now,
        }),
      ),
    ],
    now,
  )

  return sale
}
