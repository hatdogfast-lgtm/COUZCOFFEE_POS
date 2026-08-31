import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeTotals, quickTenderOptions, changeDue, type PricedLine } from './pricing.ts'
import { allocate, percentOf } from './money.ts'
import type { StatutoryRule, TaxSettings } from './types.ts'

const VAT_INCLUSIVE: TaxSettings = { enabled: true, label: 'VAT', rate: 12, inclusive: true }
const VAT_EXCLUSIVE: TaxSettings = { enabled: true, label: 'VAT', rate: 12, inclusive: false }
const NO_TAX: TaxSettings = { enabled: false, label: 'VAT', rate: 0, inclusive: true }

function line(overrides: Partial<PricedLine> = {}): PricedLine {
  return {
    id: 'L1',
    quantity: 1,
    unitPrice: 15000, // PHP 150.00
    modifiers: [],
    taxable: true,
    unitCogs: 4000, // PHP 40.00
    ...overrides,
  }
}

describe('line arithmetic', () => {
  test('modifiers add to the unit price before quantity is applied', () => {
    const totals = computeTotals(
      [
        line({
          quantity: 2,
          unitPrice: 15000,
          modifiers: [
            { groupId: 'g1', groupName: 'Milk', optionId: 'o1', optionName: 'Oat', priceDelta: 2000 },
            { groupId: 'g2', groupName: 'Add-ons', optionId: 'o2', optionName: 'Extra shot', priceDelta: 3000 },
          ],
        }),
      ],
      [],
      NO_TAX,
      20,
    )
    // (150 + 20 + 30) * 2 = 400.00
    assert.equal(totals.subtotal, 40000)
    assert.equal(totals.total, 40000)
    assert.equal(totals.lines[0]?.modifiersTotal, 5000)
    assert.equal(totals.itemCount, 2)
  })

  test('cost of goods scales with quantity and drives margin', () => {
    const totals = computeTotals([line({ quantity: 3, unitPrice: 10000, unitCogs: 2500 })], [], NO_TAX, 20)
    assert.equal(totals.cogsTotal, 7500)
    assert.equal(totals.grossProfit, 22500)
    assert.equal(Math.round(totals.marginPercent), 75)
  })
})

describe('VAT-inclusive pricing', () => {
  test('extracts the tax already contained in the menu price', () => {
    const totals = computeTotals([line({ unitPrice: 11200 })], [], VAT_INCLUSIVE, 20)
    // 112.00 inclusive of 12% VAT -> 100.00 net + 12.00 VAT
    assert.equal(totals.total, 11200)
    assert.equal(totals.taxableSales, 10000)
    assert.equal(totals.taxTotal, 1200)
  })

  test('an ordinary percentage discount reduces both the total and the tax', () => {
    const totals = computeTotals(
      [line({ unitPrice: 11200 })],
      [{ id: 'd1', type: 'PERCENT', label: '10% off', value: 10 }],
      VAT_INCLUSIVE,
      20,
    )
    assert.equal(totals.discountTotal, 1120)
    assert.equal(totals.total, 10080)
    assert.equal(totals.taxableSales, 9000)
    assert.equal(totals.taxTotal, 1080)
  })
})

describe('VAT-exclusive pricing', () => {
  test('adds tax on top of the discounted price', () => {
    const totals = computeTotals([line({ unitPrice: 10000 })], [], VAT_EXCLUSIVE, 20)
    assert.equal(totals.taxableSales, 10000)
    assert.equal(totals.taxTotal, 1200)
    assert.equal(totals.total, 11200)
  })
})

describe('statutory senior citizen and PWD concessions', () => {
  test('lifts the VAT, then applies 20% to the VAT-exempt amount', () => {
    // A PHP 112.00 VAT-inclusive drink sold to a senior citizen.
    const totals = computeTotals(
      [line({ unitPrice: 11200 })],
      [{ id: 'd1', type: 'SENIOR', label: 'Senior Citizen', value: 20 }],
      VAT_INCLUSIVE,
      20,
    )
    // VAT-exempt sale: 112.00 / 1.12 = 100.00, of which 12.00 VAT is waived.
    assert.equal(totals.taxExemptTotal, 1200)
    assert.equal(totals.taxExemptSales, 10000)
    // Statutory discount is 20% of 100.00, not 20% of 112.00.
    assert.equal(totals.discountTotal, 2000)
    // No VAT is charged on an exempt sale.
    assert.equal(totals.taxTotal, 0)
    assert.equal(totals.total, 8000)
  })

  test('reports the waived tax separately from the discount', () => {
    const totals = computeTotals(
      [line({ unitPrice: 11200 })],
      [{ id: 'd1', type: 'PWD', label: 'PWD', value: 20 }],
      VAT_INCLUSIVE,
      20,
    )
    // The two concessions must never be conflated on the receipt.
    assert.notEqual(totals.discountTotal, totals.taxExemptTotal)
    assert.equal(totals.subtotal - totals.discountTotal - totals.taxExemptTotal, totals.total)
  })

  test('the statutory rate comes from settings, not a hard-coded 20', () => {
    const totals = computeTotals(
      [line({ unitPrice: 11200 })],
      [{ id: 'd1', type: 'SENIOR', label: 'Senior Citizen', value: 20 }],
      VAT_INCLUSIVE,
      25,
    )
    assert.equal(totals.discountTotal, 2500)
  })
})

describe('discount allocation', () => {
  test('spreads a discount across lines without losing a centavo', () => {
    const totals = computeTotals(
      [
        line({ id: 'A', unitPrice: 10000 }),
        line({ id: 'B', unitPrice: 5000 }),
        line({ id: 'C', unitPrice: 3333 }),
      ],
      [{ id: 'd1', type: 'PERCENT', label: '10% off', value: 10 }],
      NO_TAX,
      20,
    )
    const allocated = totals.lines.reduce((sum, entry) => sum + entry.lineDiscount, 0)
    assert.equal(allocated, totals.discountTotal)
    const lineSum = totals.lines.reduce((sum, entry) => sum + entry.lineTotal, 0)
    assert.equal(lineSum, totals.subtotal - totals.discountTotal)
  })

  test('allocate never invents or drops minor units on awkward splits', () => {
    const shares = allocate(100, [1, 1, 1])
    assert.equal(shares.reduce((sum, share) => sum + share, 0), 100)
  })

  test('a fixed discount can never exceed the balance', () => {
    const totals = computeTotals(
      [line({ unitPrice: 5000 })],
      [{ id: 'd1', type: 'FIXED', label: 'Voucher', value: 999900 }],
      NO_TAX,
      20,
    )
    assert.equal(totals.discountTotal, 5000)
    assert.equal(totals.total, 0)
  })

  test('stacked discounts apply in sequence to the running balance', () => {
    const totals = computeTotals(
      [line({ unitPrice: 10000 })],
      [
        { id: 'd1', type: 'PERCENT', label: '10%', value: 10 },
        { id: 'd2', type: 'PERCENT', label: '10%', value: 10 },
      ],
      NO_TAX,
      20,
    )
    // 100.00 -> 10.00 off -> 9.00 off = 19.00 total, not 20.00.
    assert.equal(totals.discountTotal, 1900)
    assert.equal(totals.total, 8100)
  })
})

describe('rounding discipline', () => {
  test('percentages round half-up at the centavo', () => {
    assert.equal(percentOf(10005, 50), 5003)
  })

  test('an empty cart produces zeroes, not NaN', () => {
    const totals = computeTotals([], [], VAT_INCLUSIVE, 20)
    assert.equal(totals.total, 0)
    assert.equal(totals.taxTotal, 0)
    assert.equal(totals.marginPercent, 0)
  })
})

describe('cash tendering', () => {
  test('change is never negative on a short payment', () => {
    assert.equal(changeDue(5000, 12000), 0)
  })

  test('quick tender offers rounded notes at or above the amount owed', () => {
    const options = quickTenderOptions(17500)
    assert.ok(options.every((option) => option >= 17500))
    assert.ok(options.includes(18000))
    assert.deepEqual([...options].sort((a, b) => a - b), options)
  })
})

describe('statutory concessions the shop defines itself', () => {
  const rule = (over: Partial<StatutoryRule> = {}): StatutoryRule => ({
    code: 'SENIOR',
    label: 'Senior citizen',
    enabled: true,
    rate: 20,
    liftsTax: true,
    requiresId: true,
    ...over,
  })

  const senior = { id: 'd1', type: 'SENIOR' as const, label: 'Senior citizen', value: 0 }

  test('a concession that does not lift tax is only a discount', () => {
    const lifted = computeTotals([line({ unitPrice: 11200 })], [senior], VAT_INCLUSIVE, [rule()])
    const plain = computeTotals([line({ unitPrice: 11200 })], [senior], VAT_INCLUSIVE, [
      rule({ liftsTax: false }),
    ])

    // Lifting the VAT gives away more than a bare 20% does.
    assert.ok(lifted.discountTotal > 0)
    assert.equal(lifted.taxExemptTotal > 0, true)
    assert.equal(plain.taxExemptTotal, 0)
    assert.ok(plain.taxTotal > 0)
    assert.ok(plain.total > lifted.total)
  })

  test('the rate is the shop own rate, not a fixed twenty', () => {
    const ten = computeTotals([line({ unitPrice: 11200 })], [senior], VAT_INCLUSIVE, [rule({ rate: 10 })])
    const twenty = computeTotals([line({ unitPrice: 11200 })], [senior], VAT_INCLUSIVE, [rule({ rate: 20 })])
    assert.ok(ten.discountTotal < twenty.discountTotal)
  })

  test('a disabled concession falls back to an ordinary discount, never a silent exemption', () => {
    const totals = computeTotals([line({ unitPrice: 11200 })], [senior], VAT_INCLUSIVE, [
      rule({ enabled: false }),
    ])
    assert.equal(totals.taxExemptTotal, 0)
    assert.ok(totals.taxTotal > 0)
  })

  test('a concession the shop invented works like any other', () => {
    const student = { id: 'd2', type: 'PROMO' as const, label: 'Student', value: 0 }
    const totals = computeTotals([line({ unitPrice: 11200 })], [student], VAT_INCLUSIVE, [
      rule({ code: 'PROMO', label: 'Student', rate: 15, liftsTax: true }),
    ])
    assert.ok(totals.taxExemptTotal > 0)
    assert.equal(totals.discounts[0]?.value, 15)
  })

  test('a bare rate still means the concessions everyone already had', () => {
    const byNumber = computeTotals([line({ unitPrice: 11200 })], [senior], VAT_INCLUSIVE, 20)
    const byRule = computeTotals([line({ unitPrice: 11200 })], [senior], VAT_INCLUSIVE, [rule()])
    assert.equal(byNumber.total, byRule.total)
    assert.equal(byNumber.taxExemptTotal, byRule.taxExemptTotal)
  })
})
