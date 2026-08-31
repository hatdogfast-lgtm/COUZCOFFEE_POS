import {
  type AuditLog,
  type InventoryMovement,
  type Money,
  type Payment,
  type PaymentMethod,
  type Sale,
  type SaleItem,
  type SaleStatus,
  type User,
} from '@pos/shared'
import { db } from './database.ts'
import { commit, created, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * The transaction ledger, and the two ways a sale can be undone.
 *
 * Neither one edits history. A void marks the original as cancelled; a refund
 * is written as its own sale carrying negative amounts. In both cases the
 * original stays exactly as it was rung up, which is what an audit needs and
 * what makes the two operations safe to sync from a device that was offline
 * when it performed them.
 */

// ------------------------------------------------------------------ search --

export interface LedgerFilters {
  /** Matches a receipt number, a queue number, or a customer name. */
  query: string
  from: number | null
  to: number | null
  userId: string | null
  status: SaleStatus | 'ALL'
  method: PaymentMethod | 'ALL'
}

export const EMPTY_FILTERS: LedgerFilters = {
  query: '',
  from: null,
  to: null,
  userId: null,
  status: 'ALL',
  method: 'ALL',
}

export interface LedgerRow {
  sale: Sale
  cashierName: string
  methods: PaymentMethod[]
  itemSummary: string
  /** A refund's link back to what it refunded, for display. */
  refundOf: string | null
}

export async function searchLedger(filters: LedgerFilters, limit = 200): Promise<LedgerRow[]> {
  const [sales, payments, items, users] = await Promise.all([
    db.sales.orderBy('occurredAt').reverse().toArray(),
    db.payments.toArray(),
    db.saleItems.toArray(),
    db.users.toArray(),
  ])

  const names = new Map(users.map((user) => [user.id, user.name]))
  const receipts = new Map(sales.map((sale) => [sale.id, sale.receiptNo]))

  const methodsBySale = new Map<string, PaymentMethod[]>()
  for (const payment of payments) {
    if (payment.deletedAt !== null) continue
    const list = methodsBySale.get(payment.saleId) ?? []
    if (!list.includes(payment.method)) list.push(payment.method)
    methodsBySale.set(payment.saleId, list)
  }

  const itemsBySale = new Map<string, SaleItem[]>()
  for (const item of items) {
    if (item.deletedAt !== null) continue
    const list = itemsBySale.get(item.saleId) ?? []
    list.push(item)
    itemsBySale.set(item.saleId, list)
  }

  const term = filters.query.trim().toLowerCase()

  return sales
    .filter((sale) => {
      if (sale.deletedAt !== null) return false
      if (filters.from !== null && sale.occurredAt < filters.from) return false
      if (filters.to !== null && sale.occurredAt > filters.to) return false
      if (filters.userId && sale.userId !== filters.userId) return false
      if (filters.status !== 'ALL' && sale.status !== filters.status) return false
      if (filters.method !== 'ALL' && !(methodsBySale.get(sale.id) ?? []).includes(filters.method)) return false

      if (!term) return true
      if (sale.receiptNo.toLowerCase().includes(term)) return true
      if (sale.queueNo.toLowerCase().includes(term)) return true
      if (sale.customerName.toLowerCase().includes(term)) return true
      // Searching by what was in the order is how anyone actually remembers it.
      return (itemsBySale.get(sale.id) ?? []).some((item) =>
        item.productName.toLowerCase().includes(term),
      )
    })
    .slice(0, limit)
    .map((sale) => {
      const saleItems = (itemsBySale.get(sale.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)
      const summary =
        sale.entryMode === 'LUMP_SUM'
          ? `Day's takings · ${sale.itemCount} cups`
          : saleItems.length === 0
            ? '—'
            : saleItems
                .map((item) => `${item.quantity}× ${item.productName}`)
                .slice(0, 3)
                .join(', ') + (saleItems.length > 3 ? `, +${saleItems.length - 3} more` : '')

      return {
        sale,
        cashierName: names.get(sale.userId) ?? 'Unknown',
        methods: methodsBySale.get(sale.id) ?? [],
        itemSummary: summary,
        refundOf: sale.refundOfSaleId ? (receipts.get(sale.refundOfSaleId) ?? null) : null,
      }
    })
}

export async function loadSaleDetail(saleId: string) {
  const [items, discounts, payments, movements] = await Promise.all([
    db.saleItems.where('saleId').equals(saleId).toArray(),
    db.saleDiscounts.where('saleId').equals(saleId).toArray(),
    db.payments.where('saleId').equals(saleId).toArray(),
    db.inventoryMovements.where('referenceId').equals(saleId).toArray(),
  ])
  const refunds = await db.sales.filter((sale) => sale.refundOfSaleId === saleId).toArray()

  return {
    items: items.filter((row) => row.deletedAt === null).sort((a, b) => a.sortOrder - b.sortOrder),
    discounts: discounts.filter((row) => row.deletedAt === null),
    payments: payments.filter((row) => row.deletedAt === null),
    movements: movements.filter((row) => row.deletedAt === null),
    refunds: refunds.filter((row) => row.deletedAt === null),
  }
}

// -------------------------------------------------------------------- void --

/** A sale can only be undone once, and a refund is not itself refundable. */
export function canVoid(sale: Sale): { allowed: boolean; reason: string } {
  if (sale.status === 'VOIDED') return { allowed: false, reason: 'This sale has already been voided.' }
  if (isRefund(sale)) return { allowed: false, reason: 'A refund cannot be voided.' }
  if (refundedSoFar(sale) > 0) {
    return { allowed: false, reason: 'This sale has already been refunded in part. Refund the rest instead.' }
  }
  return { allowed: true, reason: '' }
}

/**
 * Void a sale.
 *
 * For an order rung up in error, where nothing left the counter. The stock it
 * consumed goes back by default, because the drink was never made - but that
 * is a choice the person voiding makes, not an assumption, since a void after
 * the fact may well have had a drink poured against it.
 */
export async function voidSale(input: {
  sale: Sale
  reason: string
  user: User
  returnStock: boolean
}): Promise<Sale> {
  const check = canVoid(input.sale)
  if (!check.allowed) throw new Error(check.reason)
  if (input.reason.trim().length === 0) throw new Error('A void needs a reason.')

  const now = Date.now()
  const writes: PendingWrite[] = []

  const voided = revise(
    input.sale,
    { status: 'VOIDED' as SaleStatus, voidedAt: now, voidedBy: input.user.id, voidReason: input.reason.trim() },
    now,
  )
  writes.push(updated('sales', voided))

  if (input.returnStock) {
    const movements = await db.inventoryMovements.where('referenceId').equals(input.sale.id).toArray()
    for (const movement of movements) {
      if (movement.deletedAt !== null || movement.type !== 'SALE') continue
      writes.push(
        created(
          'inventoryMovements',
          stamp<InventoryMovement>({
            ingredientId: movement.ingredientId,
            type: 'VOID_RETURN',
            // The exact inverse of what the sale took, not a recomputation:
            // the recipe may have changed since the order was rung up.
            baseQuantity: -movement.baseQuantity,
            costRate: movement.costRate,
            reason: `Void of ${input.sale.receiptNo}`,
            referenceType: 'SALE',
            referenceId: input.sale.id,
            shiftId: movement.shiftId,
            userId: input.user.id,
            occurredAt: now,
          }),
        ),
      )
    }
  }

  writes.push(
    created(
      'auditLogs',
      stamp<AuditLog>({
        entityType: 'sales',
        entityId: input.sale.id,
        action: 'SALE_VOIDED',
        userId: input.user.id,
        before: JSON.stringify({ status: input.sale.status, total: input.sale.total }),
        after: JSON.stringify({ status: 'VOIDED', stockReturned: input.returnStock }),
        reason: input.reason.trim(),
        occurredAt: now,
      }),
    ),
  )

  await commit(writes, now)
  return voided
}

// ------------------------------------------------------------------ refund --

export interface RefundLine {
  item: SaleItem
  /** How many of this line to refund. */
  quantity: number
}

/**
 * Fields added after a record was written come back undefined, not null, on
 * rows that predate them. Coalescing here keeps that from turning into a NaN
 * that quietly poisons every figure downstream.
 */
export function refundedSoFar(sale: Sale): Money {
  return sale.refundedTotal ?? 0
}

export function isRefund(sale: Sale): boolean {
  return Boolean(sale.refundOfSaleId)
}

export function refundableRemaining(sale: Sale): Money {
  return Math.max(0, sale.total - refundedSoFar(sale))
}

export function canRefund(sale: Sale): { allowed: boolean; reason: string } {
  if (sale.status === 'VOIDED') return { allowed: false, reason: 'A voided sale has nothing to refund.' }
  if (isRefund(sale)) return { allowed: false, reason: 'A refund cannot itself be refunded.' }
  if (refundableRemaining(sale) <= 0) {
    return { allowed: false, reason: 'This sale has already been refunded in full.' }
  }
  return { allowed: true, reason: '' }
}

/** What a set of refund lines comes to, at the price they were sold for. */
export function refundTotals(lines: RefundLine[]): { amount: Money; cogs: Money; items: number } {
  let amount = 0
  let cogs = 0
  let items = 0

  for (const line of lines) {
    if (line.quantity <= 0) continue
    const share = line.quantity / line.item.quantity
    amount += Math.round(line.item.lineTotal * share)
    cogs += Math.round(line.item.lineCogs * share)
    items += line.quantity
  }
  return { amount, cogs, items }
}

/**
 * Refund some or all of a sale.
 *
 * Written as its own sale with negative amounts and a link back to the
 * original, rather than by amending it. Every report that sums sales then nets
 * the two out with no special handling, and the original receipt still says
 * exactly what the customer was charged on the day.
 *
 * Stock is only returned if someone says it should be. A drink that was made
 * and handed over is not back on the shelf because the money went back.
 */
export async function refundSale(input: {
  sale: Sale
  lines: RefundLine[]
  reason: string
  user: User
  method: PaymentMethod
  returnStock: boolean
}): Promise<{ refund: Sale; amount: Money }> {
  const check = canRefund(input.sale)
  if (!check.allowed) throw new Error(check.reason)
  if (input.reason.trim().length === 0) throw new Error('A refund needs a reason.')

  const { amount, cogs, items } = refundTotals(input.lines)
  if (amount <= 0) throw new Error('Choose what to refund.')

  const remaining = refundableRemaining(input.sale)
  if (amount > remaining) {
    throw new Error('That is more than is left to refund on this sale.')
  }

  const now = Date.now()
  const writes: PendingWrite[] = []

  const refund = stamp<Sale>({
    receiptNo: `${input.sale.receiptNo}-R`,
    queueNo: '',
    shiftId: input.sale.shiftId,
    userId: input.user.id,
    status: 'COMPLETED',
    entryMode: 'ITEMISED',
    orderType: input.sale.orderType,
    subtotal: -amount,
    discountTotal: 0,
    taxTotal: 0,
    taxExemptTotal: 0,
    total: -amount,
    cogsTotal: -cogs,
    itemCount: -items,
    customerName: input.sale.customerName,
    note: input.reason.trim(),
    occurredAt: now,
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
    refundOfSaleId: input.sale.id,
    refundedTotal: 0,
  })
  writes.push(created('sales', refund))

  input.lines.forEach((line, index) => {
    if (line.quantity <= 0) return
    const share = line.quantity / line.item.quantity
    writes.push(
      created(
        'saleItems',
        stamp<SaleItem>({
          saleId: refund.id,
          productId: line.item.productId,
          variantId: line.item.variantId,
          productName: line.item.productName,
          variantName: line.item.variantName,
          categoryName: line.item.categoryName,
          quantity: -line.quantity,
          unitPrice: line.item.unitPrice,
          modifiers: line.item.modifiers,
          modifiersTotal: line.item.modifiersTotal,
          lineSubtotal: -Math.round(line.item.lineSubtotal * share),
          lineDiscount: -Math.round(line.item.lineDiscount * share),
          lineTotal: -Math.round(line.item.lineTotal * share),
          lineCogs: -Math.round(line.item.lineCogs * share),
          note: '',
          sortOrder: index,
        }),
      ),
    )
  })

  // Money going back out is a negative payment by the same method.
  writes.push(
    created(
      'payments',
      stamp<Payment>({
        saleId: refund.id,
        method: input.method,
        amount: -amount,
        tendered: -amount,
        change: 0,
        reference: '',
        verification: input.method === 'CASH' || input.method === 'LOYALTY' ? 'NOT_REQUIRED' : 'RECORDED_LOCALLY',
        verifiedAt: input.method === 'CASH' ? now : null,
      }),
    ),
  )

  if (input.returnStock) {
    const movements = await db.inventoryMovements.where('referenceId').equals(input.sale.id).toArray()
    const valueShare = input.sale.total > 0 ? amount / input.sale.total : 1
    for (const movement of movements) {
      if (movement.deletedAt !== null || movement.type !== 'SALE') continue
      const quantity = -movement.baseQuantity * valueShare
      if (quantity === 0) continue
      writes.push(
        created(
          'inventoryMovements',
          stamp<InventoryMovement>({
            ingredientId: movement.ingredientId,
            type: 'REFUND_RETURN',
            baseQuantity: quantity,
            costRate: movement.costRate,
            reason: `Refund of ${input.sale.receiptNo}`,
            referenceType: 'SALE',
            referenceId: refund.id,
            shiftId: movement.shiftId,
            userId: input.user.id,
            occurredAt: now,
          }),
        ),
      )
    }
  }

  const refundedTotal = refundedSoFar(input.sale) + amount
  const original = revise(
    input.sale,
    {
      refundedTotal,
      status: (refundedTotal >= input.sale.total ? 'REFUNDED' : 'PARTIALLY_REFUNDED') as SaleStatus,
    },
    now,
  )
  writes.push(updated('sales', original))

  writes.push(
    created(
      'auditLogs',
      stamp<AuditLog>({
        entityType: 'sales',
        entityId: input.sale.id,
        action: 'SALE_REFUNDED',
        userId: input.user.id,
        before: JSON.stringify({ refundedTotal: refundedSoFar(input.sale), status: input.sale.status }),
        after: JSON.stringify({
          refundedTotal,
          status: original.status,
          refundId: refund.id,
          amount,
          stockReturned: input.returnStock,
        }),
        reason: input.reason.trim(),
        occurredAt: now,
      }),
    ),
  )

  await commit(writes, now)
  return { refund, amount }
}

export const STATUS_LABELS: Record<SaleStatus, string> = {
  COMPLETED: 'Completed',
  VOIDED: 'Voided',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Part refunded',
}
