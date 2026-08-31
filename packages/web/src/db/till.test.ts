import { describe, expect, test } from 'vitest'
import type { BusinessSettings, Category } from '@pos/shared'
import {
  countLines,
  countsOfSale,
  describeCounts,
  referenceRequired,
  servingUnitOf,
  tillPolicy,
} from './till.ts'

/**
 * What the till is allowed to do, and how it counts.
 *
 * Both of these have to behave for a shop that was set up before they existed,
 * and the two failure modes are opposite: a missing switch must never turn a
 * feature on by itself, and a missing count must never report a day as having
 * sold nothing.
 */

const settings = (overrides: Partial<BusinessSettings> = {}): BusinessSettings =>
  ({ ...overrides }) as BusinessSettings

describe('what the shop has switched on', () => {
  test('backdating is off unless it was deliberately turned on', () => {
    // The dangerous default. Absent means off, and so does anything that is
    // not exactly true - a half-migrated record must not rewrite the books.
    expect(tillPolicy(settings()).backdatingEnabled).toBe(false)
    expect(tillPolicy(null).backdatingEnabled).toBe(false)
    expect(tillPolicy(settings({ backdatingEnabled: undefined as never })).backdatingEnabled).toBe(false)
    expect(tillPolicy(settings({ backdatingEnabled: true })).backdatingEnabled).toBe(true)
  })

  test('survives a settings record that predates these fields', () => {
    const legacy = { currencyCode: 'PHP' } as unknown as BusinessSettings
    expect(tillPolicy(legacy)).toEqual({ backdatingEnabled: false, requireReferenceFor: [] })
  })

  test('survives requireReferenceFor being something other than a list', () => {
    const broken = settings({ requireReferenceFor: 'GCASH' as never })
    expect(tillPolicy(broken).requireReferenceFor).toEqual([])
  })
})

describe('payments that need a reference', () => {
  const shop = settings({ requireReferenceFor: ['GCASH'] })

  test('asks for one only where the shop said to', () => {
    expect(referenceRequired(shop, 'GCASH')).toBe(true)
    expect(referenceRequired(shop, 'MAYA')).toBe(false)
    expect(referenceRequired(shop, 'CASH')).toBe(false)
  })

  test('asks for nothing when the shop has not said', () => {
    expect(referenceRequired(settings(), 'GCASH')).toBe(false)
  })

  test('can require several at once', () => {
    const strict = settings({ requireReferenceFor: ['GCASH', 'MAYA', 'CARD'] })
    for (const method of ['GCASH', 'MAYA', 'CARD'] as const) {
      expect(referenceRequired(strict, method)).toBe(true)
    }
    // Cash has no reference to give.
    expect(referenceRequired(strict, 'CASH')).toBe(false)
  })
})

describe('cups and pieces', () => {
  const category = (servingUnit?: 'CUP' | 'PIECE'): Category => ({ servingUnit }) as Category

  test('a category with nothing said is counted in cups', () => {
    // A coffee shop is mostly drinks, so the common case is the default.
    expect(servingUnitOf(category())).toBe('CUP')
    expect(servingUnitOf(undefined)).toBe('CUP')
    expect(servingUnitOf(null)).toBe('CUP')
  })

  test('only PIECE opts out', () => {
    expect(servingUnitOf(category('PIECE'))).toBe('PIECE')
    expect(servingUnitOf(category('CUP'))).toBe('CUP')
  })

  test('splits a cart into the two figures', () => {
    const counts = countLines([
      { quantity: 2, servingUnit: 'CUP' },
      { quantity: 1, servingUnit: 'PIECE' },
      { quantity: 3, servingUnit: 'CUP' },
    ])
    expect(counts).toEqual({ cups: 5, snacks: 1, total: 6 })
  })

  test('counts a line with no serving unit as a cup', () => {
    expect(countLines([{ quantity: 4 }])).toEqual({ cups: 4, snacks: 0, total: 4 })
  })

  test('an empty cart is zero of both', () => {
    expect(countLines([])).toEqual({ cups: 0, snacks: 0, total: 0 })
  })
})

describe('reading the counts back off a sale', () => {
  test('uses what the sale recorded', () => {
    expect(countsOfSale({ itemCount: 7, cupCount: 5, snackCount: 2 })).toEqual({
      cups: 5,
      snacks: 2,
      total: 7,
    })
  })

  test('a sale from before the split is reported as cups, not as nothing', () => {
    // Reporting it as zero cups would understate every day on the books that
    // was rung up before this existed.
    expect(countsOfSale({ itemCount: 9 })).toEqual({ cups: 9, snacks: 0, total: 9 })
  })

  test('a sale with only one of the two still adds up', () => {
    expect(countsOfSale({ itemCount: 3, snackCount: 3 })).toEqual({ cups: 0, snacks: 3, total: 3 })
  })

  test('a refund carries negative counts through', () => {
    expect(countsOfSale({ itemCount: -2, cupCount: -2, snackCount: 0 })).toEqual({
      cups: -2,
      snacks: 0,
      total: -2,
    })
  })
})

describe('saying it in words', () => {
  test('names only what there is', () => {
    expect(describeCounts({ cups: 3, snacks: 0, total: 3 })).toBe('3 cups')
    expect(describeCounts({ cups: 0, snacks: 1, total: 1 })).toBe('1 snack')
    expect(describeCounts({ cups: 1, snacks: 2, total: 3 })).toBe('1 cup · 2 snacks')
  })

  test('says so plainly when there is nothing', () => {
    expect(describeCounts({ cups: 0, snacks: 0, total: 0 })).toBe('Nothing yet')
  })
})
