import type {
  AuditLog,
  CashMovement,
  CashMovementType,
  DiscountType,
  Money,
  PaymentMethod,
  RegisterReading,
  Sale,
  Shift,
  User,
} from '@pos/shared'
import { renderPlain, row, type BrandingSettings, type PaperWidth, type ReceiptRow } from '@pos/shared'
import { db } from './database.ts'
import { commit, created, stamp, updated } from './write.ts'
import { isRefund } from './ledger.ts'
import { addCounts, countsOfSale, NO_COUNTS } from './till.ts'

/**
 * X and Z readings.
 *
 * Both answer the same question - what went through this register - and differ
 * only in what they do afterwards. An X reading is a look at the drawer
 * mid-shift and changes nothing, so it can be run as often as anyone likes. A
 * Z reading is the closing one: it counts the cash, records the variance and
 * shuts the shift, and there is exactly one per shift.
 *
 * The numbers are always recomputed from the sales themselves rather than kept
 * in a running counter. A counter can drift when a sale arrives late from
 * another till; a recomputation cannot. What is stored is the finished
 * snapshot, so the reading still reads the same in a year even if a sale is
 * corrected afterwards.
 */

export interface ReadingLine {
  key: string
  label: string
  count: number
  amount: Money
}

export interface ReadingCash {
  openingFloat: Money
  cashSales: Money
  payIn: Money
  payOut: Money
  pettyCash: Money
  cashDrops: Money
  /** What should be in the drawer if nothing has gone astray. */
  expectedCash: Money
  countedCash: Money | null
  variance: Money | null
  varianceReason: string
}

export interface ReadingSnapshot {
  type: 'X' | 'Z'
  sequence: number
  shiftId: string
  shiftCode: string
  openedAt: number
  takenAt: number
  openedByName: string
  takenByName: string
  /** Takings before any discount, which is what the discount lines are read against. */
  grossSales: Money
  discounts: Money
  /** What customers actually paid, refunds already netted out. */
  totalSales: Money
  netOfTax: Money
  tax: Money
  taxExempt: Money
  transactions: number
  itemsSold: number
  /** Drinks, counted in cups. */
  cupsSold: number
  /** Everything counted by the piece. */
  snacksSold: number
  averageSale: Money
  voidCount: number
  voidAmount: Money
  refundCount: number
  refundAmount: Money
  payments: ReadingLine[]
  discountLines: ReadingLine[]
  cash: ReadingCash
  /**
   * The register total across every Z reading ever taken, which by convention
   * never resets. It is what an audit reconciles against.
   */
  grandTotal: Money | null
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
  MAYA: 'Maya',
  CARD: 'Card',
  LOYALTY: 'Loyalty card',
}

const DISCOUNT_LABELS: Record<DiscountType, string> = {
  SENIOR: 'Senior citizen',
  PWD: 'PWD',
  PERCENT: 'Percentage off',
  FIXED: 'Amount off',
  PROMO: 'Promotion',
  EMPLOYEE: 'Staff',
  LOYALTY: 'Loyalty card',
}

export const CASH_MOVEMENT_LABELS: Record<CashMovementType, string> = {
  PAY_IN: 'Money put in',
  PAY_OUT: 'Money taken out',
  PETTY_CASH: 'Petty cash',
  CASH_DROP: 'Dropped to the safe',
}

/** Only money put in adds to the drawer; everything else takes from it. */
export function cashMovementSign(type: CashMovementType): 1 | -1 {
  return type === 'PAY_IN' ? 1 : -1
}

const alive = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null)

/**
 * Works out a reading without saving anything.
 *
 * Used both to preview a Z reading before committing to it and to build the
 * snapshot that is then stored, so what was previewed is exactly what is kept.
 */
export async function buildReading(input: {
  shift: Shift
  type: 'X' | 'Z'
  user: User
  countedCash?: Money | null
  varianceReason?: string
}): Promise<ReadingSnapshot> {
  const { shift, type } = input

  const [allSales, movements, readings, users, allPayments, allDiscounts] = await Promise.all([
    db.sales.where('shiftId').equals(shift.id).toArray(),
    db.cashMovements.where('shiftId').equals(shift.id).toArray(),
    db.registerReadings.toArray(),
    db.users.toArray(),
    db.payments.toArray(),
    db.saleDiscounts.toArray(),
  ])

  const sales = alive(allSales)
  const live = sales.filter((sale) => sale.status !== 'VOIDED')
  const voided = sales.filter((sale) => sale.status === 'VOIDED')
  const refunds = live.filter(isRefund)
  const orders = live.filter((sale) => !isRefund(sale))

  const saleIds = new Set(live.map((sale) => sale.id))
  const payments = alive(allPayments).filter((row) => saleIds.has(row.saleId))
  const discounts = alive(allDiscounts).filter((row) => saleIds.has(row.saleId))

  const sum = (rows: Sale[], pick: (sale: Sale) => number): number =>
    rows.reduce((total, sale) => total + pick(sale), 0)

  const totalSales = sum(live, (sale) => sale.total)
  const grossSales = sum(live, (sale) => sale.subtotal)
  const discountTotal = sum(live, (sale) => sale.discountTotal)
  const tax = sum(live, (sale) => sale.taxTotal)
  const taxExempt = sum(live, (sale) => sale.taxExemptTotal)
  const itemsSold = sum(live, (sale) => sale.itemCount)
  // Split the same way the cart split it, from what each sale recorded.
  const counts = live.map(countsOfSale).reduce(addCounts, NO_COUNTS)
  const transactions = orders.length

  const paymentLines = groupPayments(payments)
  const discountLines = groupDiscounts(discounts)

  const cashSales = paymentLines.find((line) => line.key === 'CASH')?.amount ?? 0
  const drawer = alive(movements)
  const movementTotal = (kind: CashMovementType): Money =>
    drawer.filter((row) => row.type === kind).reduce((total, row) => total + Math.abs(row.amount), 0)

  const payIn = movementTotal('PAY_IN')
  const payOut = movementTotal('PAY_OUT')
  const pettyCash = movementTotal('PETTY_CASH')
  const cashDrops = movementTotal('CASH_DROP')
  const expectedCash = shift.openingFloat + cashSales + payIn - payOut - pettyCash - cashDrops

  const countedCash = input.countedCash ?? null
  const variance = countedCash === null ? null : countedCash - expectedCash

  const priorReadings = alive(readings)
  const sequence =
    type === 'X'
      ? priorReadings.filter((row) => row.shiftId === shift.id && row.type === 'X').length + 1
      : priorReadings.filter((row) => row.type === 'Z').length + 1

  const nameOf = (id: string | null): string => {
    if (!id) return 'Unknown'
    return users.find((user) => user.id === id)?.name ?? 'Unknown'
  }

  return {
    type,
    sequence,
    shiftId: shift.id,
    shiftCode: shift.code,
    openedAt: shift.openedAt,
    takenAt: Date.now(),
    openedByName: nameOf(shift.openedBy),
    takenByName: input.user.name,
    grossSales,
    discounts: discountTotal,
    totalSales,
    netOfTax: totalSales - tax,
    tax,
    taxExempt,
    transactions,
    itemsSold,
    cupsSold: counts.cups,
    snacksSold: counts.snacks,
    averageSale: transactions === 0 ? 0 : Math.round(sum(orders, (sale) => sale.total) / transactions),
    voidCount: voided.length,
    voidAmount: sum(voided, (sale) => sale.total),
    refundCount: refunds.length,
    refundAmount: Math.abs(sum(refunds, (sale) => sale.total)),
    payments: paymentLines,
    discountLines,
    cash: {
      openingFloat: shift.openingFloat,
      cashSales,
      payIn,
      payOut,
      pettyCash,
      cashDrops,
      expectedCash,
      countedCash,
      variance,
      varianceReason: input.varianceReason?.trim() ?? '',
    },
    grandTotal: type === 'Z' ? previousGrandTotal(priorReadings) + totalSales : null,
  }
}

function groupPayments(rows: Array<{ method: PaymentMethod; amount: Money }>): ReadingLine[] {
  const byMethod = new Map<PaymentMethod, ReadingLine>()
  for (const row of rows) {
    const line = byMethod.get(row.method) ?? {
      key: row.method,
      label: PAYMENT_LABELS[row.method] ?? row.method,
      count: 0,
      amount: 0,
    }
    line.count += 1
    line.amount += row.amount
    byMethod.set(row.method, line)
  }
  return [...byMethod.values()].sort((a, b) => b.amount - a.amount)
}

function groupDiscounts(rows: Array<{ type: DiscountType; amount: Money }>): ReadingLine[] {
  const byType = new Map<DiscountType, ReadingLine>()
  for (const row of rows) {
    const line = byType.get(row.type) ?? {
      key: row.type,
      label: DISCOUNT_LABELS[row.type] ?? row.type,
      count: 0,
      amount: 0,
    }
    line.count += 1
    line.amount += row.amount
    byType.set(row.type, line)
  }
  return [...byType.values()].sort((a, b) => b.amount - a.amount)
}

/** The total carried forward from the last Z reading, or zero if this is the first. */
function previousGrandTotal(readings: RegisterReading[]): Money {
  const zeds = readings
    .filter((row) => row.type === 'Z')
    .map((row) => parseReading(row))
    .filter((snapshot): snapshot is ReadingSnapshot => snapshot !== null)
    .sort((a, b) => a.sequence - b.sequence)
  return zeds[zeds.length - 1]?.grandTotal ?? 0
}

export function parseReading(row: RegisterReading): ReadingSnapshot | null {
  try {
    const parsed = JSON.parse(row.payload) as ReadingSnapshot
    return typeof parsed?.totalSales === 'number' ? parsed : null
  } catch {
    return null
  }
}

/** Takes an X reading: a snapshot, kept, that leaves the shift running. */
export async function runXReading(shift: Shift, user: User): Promise<ReadingSnapshot> {
  if (shift.status !== 'OPEN') throw new Error('That shift is already closed.')
  const snapshot = await buildReading({ shift, type: 'X', user })
  const now = Date.now()

  const reading = stamp<RegisterReading>(
    {
      shiftId: shift.id,
      type: 'X',
      sequence: snapshot.sequence,
      createdBy: user.id,
      payload: JSON.stringify(snapshot),
    },
    now,
  )

  await commit(
    [
      created('registerReadings', reading),
      created(
        'auditLogs',
        stamp<AuditLog>(
          {
            entityType: 'registerReadings',
            entityId: reading.id,
            action: 'X_READING',
            userId: user.id,
            before: null,
            after: JSON.stringify({ shift: shift.code, total: snapshot.totalSales }),
            reason: `X reading ${snapshot.sequence} on ${shift.code}`,
            occurredAt: now,
          },
          now,
        ),
      ),
    ],
    now,
  )

  return snapshot
}

/**
 * Takes the Z reading and closes the shift, in one transaction.
 *
 * The two belong together: a Z reading that saved but left the shift open
 * would let the next sale land in a shift that has already been reported on.
 */
export async function runZReading(input: {
  shift: Shift
  user: User
  countedCash: Money
  varianceReason: string
  note?: string
}): Promise<ReadingSnapshot> {
  const { shift, user } = input
  if (shift.status !== 'OPEN') throw new Error('That shift is already closed.')
  if (!Number.isFinite(input.countedCash) || input.countedCash < 0) {
    throw new Error('Count the drawer before closing.')
  }

  const snapshot = await buildReading({
    shift,
    type: 'Z',
    user,
    countedCash: Math.round(input.countedCash),
    varianceReason: input.varianceReason,
  })

  // A drawer that does not balance has to be explained, not waved through.
  if ((snapshot.cash.variance ?? 0) !== 0 && snapshot.cash.varianceReason.length === 0) {
    throw new Error('The drawer does not balance. Say why before closing.')
  }

  const now = Date.now()

  const reading = stamp<RegisterReading>(
    {
      shiftId: shift.id,
      type: 'Z',
      sequence: snapshot.sequence,
      createdBy: user.id,
      payload: JSON.stringify(snapshot),
    },
    now,
  )

  const closed: Shift = {
    ...shift,
    status: 'CLOSED',
    closedBy: user.id,
    closedAt: now,
    countedCash: snapshot.cash.countedCash,
    expectedCash: snapshot.cash.expectedCash,
    variance: snapshot.cash.variance,
    varianceReason: snapshot.cash.varianceReason,
    note: input.note?.trim() || shift.note,
    updatedAt: now,
    version: shift.version + 1,
  }

  await commit(
    [
      created('registerReadings', reading),
      updated('shifts', closed),
      created(
        'auditLogs',
        stamp<AuditLog>(
          {
            entityType: 'shifts',
            entityId: shift.id,
            action: 'Z_READING',
            userId: user.id,
            before: JSON.stringify({ status: shift.status }),
            after: JSON.stringify({
              status: 'CLOSED',
              expected: snapshot.cash.expectedCash,
              counted: snapshot.cash.countedCash,
              variance: snapshot.cash.variance,
            }),
            reason: snapshot.cash.varianceReason || `Z reading ${snapshot.sequence}`,
            occurredAt: now,
          },
          now,
        ),
      ),
    ],
    now,
  )

  return snapshot
}

/** Records cash going in or out of the drawer for a reason other than a sale. */
export async function recordCashMovement(input: {
  shift: Shift
  type: CashMovementType
  amount: Money
  reason: string
  user: User
}): Promise<CashMovement> {
  if (input.shift.status !== 'OPEN') throw new Error('That shift is closed.')
  const amount = Math.round(Math.abs(input.amount))
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount.')
  if (input.reason.trim().length === 0) throw new Error('Say what this is for.')

  const now = Date.now()
  const movement = stamp<CashMovement>(
    {
      shiftId: input.shift.id,
      type: input.type,
      amount,
      reason: input.reason.trim(),
      userId: input.user.id,
      occurredAt: now,
    },
    now,
  )

  await commit(
    [
      created('cashMovements', movement),
      created(
        'auditLogs',
        stamp<AuditLog>(
          {
            entityType: 'cashMovements',
            entityId: movement.id,
            action: 'CASH_MOVEMENT',
            userId: input.user.id,
            before: null,
            after: JSON.stringify({ type: input.type, amount }),
            reason: movement.reason,
            occurredAt: now,
          },
          now,
        ),
      ),
    ],
    now,
  )

  return movement
}

export async function listCashMovements(shiftId: string): Promise<CashMovement[]> {
  const rows = await db.cashMovements.where('shiftId').equals(shiftId).toArray()
  return alive(rows).sort((a, b) => b.occurredAt - a.occurredAt)
}

/** Past readings, newest first, for looking one up after the fact. */
export async function listReadings(
  limit = 60,
): Promise<Array<{ row: RegisterReading; snapshot: ReadingSnapshot }>> {
  const rows = alive(await db.registerReadings.toArray())
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((row) => ({ row, snapshot: parseReading(row) }))
    .filter((entry): entry is { row: RegisterReading; snapshot: ReadingSnapshot } => entry.snapshot !== null)
}

/**
 * A reading, laid out for the receipt roll.
 *
 * Uses the same row primitives and the same renderer as a receipt, so an X or
 * Z reading comes off the same printer looking like it belongs to the same
 * shop - and so there is only one piece of code deciding how wide a line is.
 */
/**
 * A reading, laid out for the till roll.
 *
 * Takes its arguments as one object rather than in a row, because the last two
 * used to be easy to leave off - and a reading composed for 32 columns while
 * the paper is 48 wide prints as a narrow strip up one side of the page.
 *
 * The shop's own name heads it: a Z reading is the document an auditor asks
 * for, and one that does not say which till it came from is worth little.
 */
export function readingLines(input: {
  snapshot: ReadingSnapshot
  money: (amount: Money) => string
  branding?: BrandingSettings
  paperWidth?: PaperWidth
}): string[] {
  const { snapshot, money, branding } = input
  const paperWidth = input.paperWidth ?? 58

  const rows: ReceiptRow[] = []

  if (branding) {
    rows.push(row.text(branding.businessName || 'REGISTER', { align: 'center', bold: true, large: true }))
    if (branding.legalName && branding.legalName !== branding.businessName) {
      rows.push(row.text(branding.legalName, { align: 'center' }))
    }
    if (branding.address) rows.push(row.text(branding.address, { align: 'center' }))
    if (branding.contactNumber) rows.push(row.text(branding.contactNumber, { align: 'center' }))
    // The tax number belongs on a Z reading in particular - it is the figure a
    // BIR inspection reconciles the register against.
    if (branding.taxId) rows.push(row.text(`VAT REG TIN ${branding.taxId}`, { align: 'center' }))
    rows.push(row.feed())
  }

  rows.push(
    row.text(snapshot.type === 'Z' ? 'Z READING' : 'X READING', { align: 'center', bold: true, large: true }),
    row.text(`#${snapshot.sequence}`, { align: 'center' }),
    row.feed(),
    row.columns('Shift', snapshot.shiftCode),
    row.columns('Opened', new Date(snapshot.openedAt).toLocaleString()),
    row.columns('Opened by', snapshot.openedByName),
    row.columns('Taken', new Date(snapshot.takenAt).toLocaleString()),
    row.columns('Taken by', snapshot.takenByName),
  )

  rows.push(
    row.divider(),
    row.text('TAKINGS', { bold: true }),
    row.columns('Gross sales', money(snapshot.grossSales)),
    row.columns('Less discounts', `-${money(snapshot.discounts)}`),
    row.columns('Net of tax', money(snapshot.netOfTax)),
    row.columns('Tax', money(snapshot.tax)),
  )

  if (snapshot.taxExempt !== 0) {
    rows.push(row.columns('Tax lifted', money(snapshot.taxExempt)))
  }
  rows.push(row.columns('TOTAL SALES', money(snapshot.totalSales), { bold: true }))

  rows.push(row.divider(), row.text('COUNTS', { bold: true }))
  rows.push(row.columns('Transactions', String(snapshot.transactions)))
  rows.push(row.columns('Cups sold', String(snapshot.cupsSold ?? snapshot.itemsSold)))
  if ((snapshot.snacksSold ?? 0) > 0) {
    rows.push(row.columns('Snacks sold', String(snapshot.snacksSold)))
  }
  rows.push(row.columns('Average sale', money(snapshot.averageSale)))

  rows.push(row.divider(), row.text('CORRECTIONS', { bold: true }))
  rows.push(row.columns(`Voids (${snapshot.voidCount})`, money(snapshot.voidAmount)))
  rows.push(row.columns(`Refunds (${snapshot.refundCount})`, `-${money(snapshot.refundAmount)}`))

  if (snapshot.payments.length > 0) {
    rows.push(row.divider(), row.text('HOW IT WAS PAID', { bold: true }))
    for (const line of snapshot.payments) {
      rows.push(row.columns(`${line.label} (${line.count})`, money(line.amount)))
    }
  }

  if (snapshot.discountLines.length > 0) {
    rows.push(row.divider(), row.text('DISCOUNTS GIVEN', { bold: true }))
    for (const line of snapshot.discountLines) {
      rows.push(row.columns(`${line.label} (${line.count})`, money(line.amount)))
    }
  }

  rows.push(row.divider(), row.text('THE DRAWER', { bold: true }))
  rows.push(row.columns('Opening float', money(snapshot.cash.openingFloat)))
  rows.push(row.columns('Cash sales', money(snapshot.cash.cashSales)))
  if (snapshot.cash.payIn > 0) rows.push(row.columns('Money put in', money(snapshot.cash.payIn)))
  if (snapshot.cash.payOut > 0) rows.push(row.columns('Money taken out', `-${money(snapshot.cash.payOut)}`))
  if (snapshot.cash.pettyCash > 0) rows.push(row.columns('Petty cash', `-${money(snapshot.cash.pettyCash)}`))
  if (snapshot.cash.cashDrops > 0) rows.push(row.columns('Dropped to safe', `-${money(snapshot.cash.cashDrops)}`))
  rows.push(row.columns('EXPECTED', money(snapshot.cash.expectedCash), { bold: true }))

  if (snapshot.cash.countedCash !== null) {
    const variance = snapshot.cash.variance ?? 0
    rows.push(row.columns('COUNTED', money(snapshot.cash.countedCash), { bold: true }))
    rows.push(
      row.columns(
        variance === 0 ? 'BALANCED' : variance > 0 ? 'OVER' : 'SHORT',
        money(Math.abs(variance)),
        { bold: true },
      ),
    )
    if (snapshot.cash.varianceReason) rows.push(row.text(snapshot.cash.varianceReason))
  }

  if (snapshot.type === 'Z' && snapshot.grandTotal !== null) {
    rows.push(row.divider(), row.text('REGISTER', { bold: true }))
    rows.push(row.columns('Total, all Z readings', money(snapshot.grandTotal)))
  }

  rows.push(row.feed())
  rows.push(row.text('Counted by ..........................'))
  rows.push(row.feed())
  rows.push(row.text('Checked by ..........................'))

  return renderPlain(rows, paperWidth)
}
