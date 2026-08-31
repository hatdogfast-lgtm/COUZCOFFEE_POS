import { beforeEach, describe, expect, test } from 'vitest'
import type { BusinessSettings, Ingredient, InventoryMovement, LowStockBasis } from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { daysOfCover, isLow, usageRates } from './lowStock.ts'
import { commit, created, stamp } from './write.ts'

/**
 * Running low.
 *
 * The point of the usage rule is that nobody has to keep the numbers up to
 * date, so what these check is that it follows real consumption and stays
 * quiet when it has nothing to go on. A warning that fires on a guess is worse
 * than no warning: it gets switched off, and then the real one is missed too.
 */

const DAY = 24 * 60 * 60 * 1000

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()
}

beforeEach(reset)

const ingredient = (over: Partial<Ingredient> = {}): Ingredient =>
  ({ name: 'Beans', lowStockThresholdBase: 0, trackStock: true, ...over }) as Ingredient

const settings = (basis: LowStockBasis, over: Partial<BusinessSettings['lowStock']> = {}): BusinessSettings =>
  ({ lowStock: { enabled: true, basis, daysOfCover: 3, lookbackDays: 14, ...over } }) as BusinessSettings

async function used(ingredientId: string, base: number, at: number, referenceType: 'SALE' | 'PURCHASE' = 'SALE') {
  await commit([
    created(
      'inventoryMovements',
      stamp<InventoryMovement>({
        ingredientId,
        type: referenceType === 'SALE' ? 'SALE' : 'PURCHASE',
        baseQuantity: referenceType === 'SALE' ? -base : base,
        costRate: 1000,
        reason: '',
        referenceType,
        referenceId: 'X',
        shiftId: null,
        userId: 'USER-1',
        occurredAt: at,
      }),
    ),
  ])
}

describe('how fast stock is going', () => {
  test('averages what was used over the days it looks back', async () => {
    const now = Date.now()
    // 700 g over seven days is 100 g a day.
    for (let day = 0; day < 7; day += 1) await used('beans', 100, now - day * DAY)

    const rates = await usageRates(7, now)
    expect(rates.get('beans')).toBeCloseTo(100, 5)
  })

  test('counts only what left because something was sold', async () => {
    const now = Date.now()
    await used('beans', 100, now - DAY)
    await used('beans', 5000, now - DAY, 'PURCHASE')

    expect((await usageRates(7, now)).get('beans')).toBeCloseTo(100 / 7, 5)
  })

  test('a returned void cancels the usage it recorded', async () => {
    const now = Date.now()
    await used('beans', 100, now - DAY)
    await commit([
      created(
        'inventoryMovements',
        stamp<InventoryMovement>({
          ingredientId: 'beans',
          type: 'VOID_RETURN',
          baseQuantity: 100,
          costRate: 1000,
          reason: 'Void',
          referenceType: 'SALE',
          referenceId: 'X',
          shiftId: null,
          userId: 'USER-1',
          occurredAt: now - DAY,
        }),
      ),
    ])

    expect((await usageRates(7, now)).has('beans')).toBe(false)
  })

  test('ignores what happened before the window', async () => {
    const now = Date.now()
    await used('beans', 700, now - 30 * DAY)
    expect((await usageRates(7, now)).has('beans')).toBe(false)
  })
})

describe('deciding what counts as low', () => {
  const beans = ingredient({ lowStockThresholdBase: 500 })

  test('the fixed rule uses the number set on the ingredient', () => {
    expect(isLow({ ingredient: beans, onHandBase: 400, settings: settings('FIXED') })).toBe(true)
    expect(isLow({ ingredient: beans, onHandBase: 600, settings: settings('FIXED') })).toBe(false)
  })

  test('the usage rule follows what is actually being got through', () => {
    // 100 g a day, three days of cover wanted: 250 g is under, 400 g is over.
    const rule = settings('USAGE')
    expect(isLow({ ingredient: beans, onHandBase: 250, settings: rule, perDay: 100 })).toBe(true)
    expect(isLow({ ingredient: beans, onHandBase: 400, settings: rule, perDay: 100 })).toBe(false)
  })

  test('the usage rule keeps up when trade picks up, with nothing re-typed', () => {
    const rule = settings('USAGE')
    const onHandBase = 400
    // Quiet week: four days of cover, so no warning.
    expect(isLow({ ingredient: beans, onHandBase, settings: rule, perDay: 100 })).toBe(false)
    // Trade doubles and the same 400 g is now two days: the warning follows.
    expect(isLow({ ingredient: beans, onHandBase, settings: rule, perDay: 200 })).toBe(true)
  })

  test('says nothing about an ingredient it has never seen used', () => {
    expect(isLow({ ingredient: beans, onHandBase: 1, settings: settings('USAGE') })).toBe(false)
  })

  test('either rule can raise it when the shop asks for both', () => {
    const rule = settings('EITHER')
    // Under the fixed floor but plenty of days of cover.
    expect(isLow({ ingredient: beans, onHandBase: 400, settings: rule, perDay: 1 })).toBe(true)
    // Over the fixed floor but only a day of cover left.
    expect(isLow({ ingredient: beans, onHandBase: 600, settings: rule, perDay: 600 })).toBe(true)
    expect(isLow({ ingredient: beans, onHandBase: 600, settings: rule, perDay: 1 })).toBe(false)
  })

  test('a threshold of zero is no threshold, not a threshold of nothing', () => {
    const none = ingredient({ lowStockThresholdBase: 0 })
    expect(isLow({ ingredient: none, onHandBase: 0, settings: settings('FIXED') })).toBe(false)
  })

  test('stays quiet when the warning is off, or the ingredient is not tracked', () => {
    expect(
      isLow({ ingredient: beans, onHandBase: 0, settings: settings('EITHER', { enabled: false }), perDay: 10 }),
    ).toBe(false)
    expect(
      isLow({
        ingredient: ingredient({ trackStock: false, lowStockThresholdBase: 500 }),
        onHandBase: 0,
        settings: settings('EITHER'),
        perDay: 10,
      }),
    ).toBe(false)
  })

  test('falls back to the fixed rule for a shop that has never chosen', () => {
    expect(isLow({ ingredient: beans, onHandBase: 400, settings: null })).toBe(true)
  })
})

describe('how long the stock will last', () => {
  test('is what is left divided by the daily rate', () => {
    expect(daysOfCover(600, 200)).toBe(3)
  })

  test('is unknown rather than infinite when nothing is being used', () => {
    expect(daysOfCover(600, 0)).toBeNull()
    expect(daysOfCover(600, undefined)).toBeNull()
  })
})
