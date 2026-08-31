import { beforeEach, describe, expect, test } from 'vitest'
import { fromDecimal, type BrandingSettings, type Payment, type Sale, type Shift, type User } from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import {
  buildReading,
  cashMovementSign,
  listReadings,
  readingLines,
  recordCashMovement,
  runXReading,
  runZReading,
} from './readings.ts'

/**
 * X and Z readings.
 *
 * A reading is the document the day is signed off on, so these tests are less
 * about arithmetic than about the promises around it: an X reading leaves the
 * shift running, a Z reading closes it exactly once, a drawer that does not
 * balance has to be explained, and voided sales never reach either.
 */

const USER: User = {
  id: 'U-OWNER',
  name: 'Ana',
  role: 'OWNER',
  pinHash: '',
  active: true,
  employeeCode: '001',
  failedAttempts: 0,
  lockedUntil: null,
  permissionOverrides: {},
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  version: 1,
  deviceId: 'POS-TEST-01',
}

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()
  await db.users.put(USER)
}

beforeEach(reset)

async function openShift(openingFloat = fromDecimal(1000)): Promise<Shift> {
  const shift = stamp<Shift>({
    code: 'S-TEST',
    status: 'OPEN',
    openedBy: USER.id,
    openedAt: Date.now(),
    closedBy: null,
    closedAt: null,
    openingFloat,
    countedCash: null,
    expectedCash: null,
    variance: null,
    varianceReason: '',
    note: '',
  })
  await commit([created('shifts', shift)])
  return shift
}

/** A completed sale settled by one method, so the drawer maths has something to read. */
async function sell(
  shift: Shift,
  options: {
    total: number
    method?: Payment['method']
    tax?: number
    items?: number
    status?: Sale['status']
    refundOf?: string | null
  },
): Promise<Sale> {
  const sale = stamp<Sale>({
    receiptNo: `OR-${Math.random().toString(36).slice(2, 8)}`,
    queueNo: '',
    shiftId: shift.id,
    userId: USER.id,
    status: options.status ?? 'COMPLETED',
    entryMode: 'ITEMISED',
    orderType: 'DINE_IN',
    subtotal: options.total,
    discountTotal: 0,
    taxTotal: options.tax ?? 0,
    taxExemptTotal: 0,
    total: options.total,
    cogsTotal: 0,
    itemCount: options.items ?? 1,
    customerName: '',
    note: '',
    occurredAt: Date.now(),
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
    refundOfSaleId: options.refundOf ?? null,
    refundedTotal: 0,
  })

  const payment = stamp<Payment>({
    saleId: sale.id,
    method: options.method ?? 'CASH',
    amount: options.total,
    tendered: options.total,
    change: 0,
    reference: '',
    verification: 'NOT_REQUIRED',
    verifiedAt: null,
  })

  await commit([created('sales', sale), created('payments', payment)])
  return sale
}

describe('what a reading counts', () => {
  test('adds up sales, transactions and cups', async () => {
    const shift = await openShift()
    await sell(shift, { total: fromDecimal(150), items: 2 })
    await sell(shift, { total: fromDecimal(90), items: 1 })

    const reading = await buildReading({ shift, type: 'X', user: USER })

    expect(reading.totalSales).toBe(fromDecimal(240))
    expect(reading.transactions).toBe(2)
    expect(reading.itemsSold).toBe(3)
    expect(reading.averageSale).toBe(fromDecimal(120))
  })

  test('leaves voided sales out of the takings but still reports them', async () => {
    const shift = await openShift()
    await sell(shift, { total: fromDecimal(100) })
    await sell(shift, { total: fromDecimal(60), status: 'VOIDED' })

    const reading = await buildReading({ shift, type: 'X', user: USER })

    expect(reading.totalSales).toBe(fromDecimal(100))
    expect(reading.transactions).toBe(1)
    expect(reading.voidCount).toBe(1)
    expect(reading.voidAmount).toBe(fromDecimal(60))
  })

  test('nets a refund out of the total without counting it as a sale', async () => {
    const shift = await openShift()
    const original = await sell(shift, { total: fromDecimal(200) })
    await sell(shift, { total: -fromDecimal(50), refundOf: original.id, items: -1 })

    const reading = await buildReading({ shift, type: 'X', user: USER })

    expect(reading.totalSales).toBe(fromDecimal(150))
    // The refund is money out, not a second order.
    expect(reading.transactions).toBe(1)
    expect(reading.refundCount).toBe(1)
    expect(reading.refundAmount).toBe(fromDecimal(50))
  })

  test('splits the takings by how they were paid', async () => {
    const shift = await openShift()
    await sell(shift, { total: fromDecimal(100), method: 'CASH' })
    await sell(shift, { total: fromDecimal(250), method: 'GCASH' })
    await sell(shift, { total: fromDecimal(80), method: 'CASH' })

    const reading = await buildReading({ shift, type: 'X', user: USER })

    expect(reading.payments.find((line) => line.key === 'GCASH')?.amount).toBe(fromDecimal(250))
    const cash = reading.payments.find((line) => line.key === 'CASH')
    expect(cash?.amount).toBe(fromDecimal(180))
    expect(cash?.count).toBe(2)
  })

  test('counts only this shift', async () => {
    const mine = await openShift()
    const theirs = { ...mine, id: 'OTHER-SHIFT' }
    await sell(mine, { total: fromDecimal(100) })
    await sell(theirs as Shift, { total: fromDecimal(999) })

    const reading = await buildReading({ shift: mine, type: 'X', user: USER })
    expect(reading.totalSales).toBe(fromDecimal(100))
  })
})

describe('the drawer', () => {
  test('expects the float plus the cash taken', async () => {
    const shift = await openShift(fromDecimal(1000))
    await sell(shift, { total: fromDecimal(500), method: 'CASH' })
    await sell(shift, { total: fromDecimal(300), method: 'CARD' })

    const reading = await buildReading({ shift, type: 'X', user: USER })

    // The card sale is real money but it is not in the drawer.
    expect(reading.cash.expectedCash).toBe(fromDecimal(1500))
  })

  test('takes petty cash and drops back out again', async () => {
    const shift = await openShift(fromDecimal(1000))
    await sell(shift, { total: fromDecimal(500), method: 'CASH' })
    await recordCashMovement({ shift, type: 'PETTY_CASH', amount: fromDecimal(200), reason: 'Milk', user: USER })
    await recordCashMovement({ shift, type: 'CASH_DROP', amount: fromDecimal(800), reason: 'Safe', user: USER })
    await recordCashMovement({ shift, type: 'PAY_IN', amount: fromDecimal(100), reason: 'Change', user: USER })

    const reading = await buildReading({ shift, type: 'X', user: USER })

    expect(reading.cash.expectedCash).toBe(fromDecimal(1000 + 500 - 200 - 800 + 100))
  })

  test('only money put in adds to the drawer', () => {
    expect(cashMovementSign('PAY_IN')).toBe(1)
    expect(cashMovementSign('PAY_OUT')).toBe(-1)
    expect(cashMovementSign('PETTY_CASH')).toBe(-1)
    expect(cashMovementSign('CASH_DROP')).toBe(-1)
  })

  test('refuses a movement with no reason or no amount', async () => {
    const shift = await openShift()
    await expect(
      recordCashMovement({ shift, type: 'PETTY_CASH', amount: fromDecimal(100), reason: '  ', user: USER }),
    ).rejects.toThrow(/what this is for/i)
    await expect(
      recordCashMovement({ shift, type: 'PETTY_CASH', amount: 0, reason: 'Milk', user: USER }),
    ).rejects.toThrow(/amount/i)
  })
})

describe('the X reading', () => {
  test('is kept, and leaves the shift open', async () => {
    const shift = await openShift()
    await sell(shift, { total: fromDecimal(120) })

    const snapshot = await runXReading(shift, USER)

    expect(snapshot.sequence).toBe(1)
    expect(snapshot.totalSales).toBe(fromDecimal(120))
    expect((await db.shifts.get(shift.id))?.status).toBe('OPEN')
    expect(await db.registerReadings.count()).toBe(1)
  })

  test('numbers itself within the shift, and can be taken again', async () => {
    const shift = await openShift()
    await runXReading(shift, USER)
    const second = await runXReading(shift, USER)
    expect(second.sequence).toBe(2)
  })

  test('carries no grand total, because it closes nothing', async () => {
    const shift = await openShift()
    expect((await runXReading(shift, USER)).grandTotal).toBeNull()
  })
})

describe('the Z reading', () => {
  test('closes the shift and records the count', async () => {
    const shift = await openShift(fromDecimal(1000))
    await sell(shift, { total: fromDecimal(500), method: 'CASH' })

    const snapshot = await runZReading({
      shift,
      user: USER,
      countedCash: fromDecimal(1500),
      varianceReason: '',
    })

    expect(snapshot.cash.variance).toBe(0)

    const closed = await db.shifts.get(shift.id)
    expect(closed?.status).toBe('CLOSED')
    expect(closed?.closedBy).toBe(USER.id)
    expect(closed?.expectedCash).toBe(fromDecimal(1500))
    expect(closed?.countedCash).toBe(fromDecimal(1500))
    expect(closed?.variance).toBe(0)
  })

  test('will not close a drawer that is short without an explanation', async () => {
    const shift = await openShift(fromDecimal(1000))
    await sell(shift, { total: fromDecimal(500), method: 'CASH' })

    await expect(
      runZReading({ shift, user: USER, countedCash: fromDecimal(1450), varianceReason: '   ' }),
    ).rejects.toThrow(/does not balance/i)

    // Nothing was written, so the shift is still usable.
    expect((await db.shifts.get(shift.id))?.status).toBe('OPEN')
    expect(await db.registerReadings.count()).toBe(0)
  })

  test('closes short once the reason is given, and keeps the reason', async () => {
    const shift = await openShift(fromDecimal(1000))
    await sell(shift, { total: fromDecimal(500), method: 'CASH' })

    const snapshot = await runZReading({
      shift,
      user: USER,
      countedCash: fromDecimal(1450),
      varianceReason: 'Wrong change given at handover',
    })

    expect(snapshot.cash.variance).toBe(-fromDecimal(50))
    expect((await db.shifts.get(shift.id))?.varianceReason).toBe('Wrong change given at handover')
  })

  test('cannot be taken twice on the same shift', async () => {
    const shift = await openShift(0)
    await runZReading({ shift, user: USER, countedCash: 0, varianceReason: '' })

    const closed = (await db.shifts.get(shift.id)) as Shift
    await expect(
      runZReading({ shift: closed, user: USER, countedCash: 0, varianceReason: '' }),
    ).rejects.toThrow(/already closed/i)
  })

  test('runs a register total forward across shifts', async () => {
    const first = await openShift(0)
    await sell(first, { total: fromDecimal(300), method: 'CASH' })
    const one = await runZReading({ shift: first, user: USER, countedCash: fromDecimal(300), varianceReason: '' })
    expect(one.sequence).toBe(1)
    expect(one.grandTotal).toBe(fromDecimal(300))

    const second = await openShift(0)
    await sell(second, { total: fromDecimal(200), method: 'CASH' })
    const two = await runZReading({ shift: second, user: USER, countedCash: fromDecimal(200), varianceReason: '' })

    expect(two.sequence).toBe(2)
    // The register total never resets, so it is the sum of both days.
    expect(two.grandTotal).toBe(fromDecimal(500))
  })

  test('refuses a count that was never taken', async () => {
    const shift = await openShift()
    await expect(
      runZReading({ shift, user: USER, countedCash: -1, varianceReason: '' }),
    ).rejects.toThrow(/count the drawer/i)
  })
})

describe('looking one up afterwards', () => {
  test('keeps the figures as they read at the time', async () => {
    const shift = await openShift()
    await sell(shift, { total: fromDecimal(100) })
    await runXReading(shift, USER)

    // A later sale must not rewrite a reading that has already been taken.
    await sell(shift, { total: fromDecimal(900) })

    const [latest] = await listReadings()
    expect(latest?.snapshot.totalSales).toBe(fromDecimal(100))
  })

  test('lists the newest first', async () => {
    const shift = await openShift()
    await runXReading(shift, USER)
    await runXReading(shift, USER)

    const rows = await listReadings()
    expect(rows).toHaveLength(2)
    expect(rows[0]?.snapshot.sequence).toBe(2)
  })
})

describe('the printed reading', () => {
  const brand = (over: Partial<BrandingSettings> = {}): BrandingSettings =>
    ({
      businessName: 'BNC Coffee',
      legalName: '',
      tagline: '',
      logoDataUrl: null,
      address: '12 Ortigas Ave',
      contactNumber: '0917 000 0000',
      email: '',
      socialLinks: '',
      taxId: '008-123-456-000',
      receiptFooter: '',
      primaryColor: '',
      secondaryColor: '',
      accentColor: '',
      theme: 'dark',
      ...over,
    }) as BrandingSettings

  const peso = (amount: number): string => `P${(amount / 100).toFixed(2)}`

  test('heads the sheet with the shop, so a reading says which till it came from', async () => {
    const shift = await openShift()
    await sell(shift, { total: fromDecimal(120) })
    const snapshot = await runXReading(shift, USER)

    const sheet = readingLines({ snapshot, money: peso, branding: brand() }).join('\n')
    expect(sheet).toContain('BNC Coffee')
    expect(sheet).toContain('12 Ortigas Ave')
    expect(sheet).toContain('0917 000 0000')
    // The register number an inspection reconciles against.
    expect(sheet).toContain('VAT REG TIN 008-123-456-000')
  })

  test('still prints when the shop has set no branding at all', async () => {
    const shift = await openShift()
    const snapshot = await runXReading(shift, USER)

    const sheet = readingLines({ snapshot, money: peso }).join('\n')
    expect(sheet).toContain('X READING')
    expect(sheet).not.toContain('undefined')
  })

  test('names itself as X or Z, which is the difference that matters', async () => {
    const shift = await openShift()
    await sell(shift, { total: fromDecimal(120) })

    const taken = await runXReading(shift, USER)
    expect(readingLines({ snapshot: taken, money: peso, branding: brand() }).join('\n')).toContain('X READING')

    // Counted to what the drawer should hold, so the close is not rejected for
    // a variance this test is not about.
    const z = await runZReading({
      shift,
      user: USER,
      countedCash: taken.cash.expectedCash,
      varianceReason: '',
    })
    expect(readingLines({ snapshot: z, money: peso, branding: brand() }).join('\n')).toContain('Z READING')
  })

  test('fits the paper it is told about, header and all', async () => {
    const shift = await openShift()
    await sell(shift, { total: fromDecimal(120) })
    const snapshot = await runXReading(shift, USER)

    for (const paperWidth of [58, 80] as const) {
      const columns = paperWidth === 58 ? 32 : 48
      const lines = readingLines({ snapshot, money: peso, branding: brand(), paperWidth })
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns)
    }
  })

  test('lays out for 58mm when nothing says otherwise', async () => {
    const shift = await openShift()
    const lines = readingLines({ snapshot: await runXReading(shift, USER), money: peso })
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32)
  })

  test('carries the figures the reading recorded', async () => {
    const shift = await openShift()
    await sell(shift, { total: fromDecimal(120) })
    const snapshot = await runXReading(shift, USER)

    const sheet = readingLines({ snapshot, money: peso, branding: brand() }).join('\n')
    expect(sheet).toContain(peso(snapshot.totalSales))
    expect(sheet).toMatch(/Cups sold\s+\d/)
  })
})
