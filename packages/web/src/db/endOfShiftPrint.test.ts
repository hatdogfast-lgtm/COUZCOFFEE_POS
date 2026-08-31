import { describe, expect, test } from 'vitest'
import { formatMoney, type BrandingSettings, type Money } from '@pos/shared'
import { endOfShiftLines, type EndOfDaySummary } from './endOfDay.ts'

/**
 * The printed end-of-shift sheet.
 *
 * This is the copy that gets pinned up or handed over, so what matters is that
 * it says whose shop it came from and that the figures on it are the figures
 * that were on the screen. Nothing here is recomputed for the print.
 */

const money = (amount: Money): string => formatMoney(amount, { code: 'PHP', symbol: 'P', minorPerMajor: 100, locale: 'en-PH' })

const branding = (over: Partial<BrandingSettings> = {}): BrandingSettings => ({
  businessName: 'BNC Coffee',
  legalName: '',
  tagline: 'Brewed next door',
  logoDataUrl: null,
  address: '12 Ortigas Ave',
  contactNumber: '0917 000 0000',
  email: '',
  socialLinks: '',
  taxId: '',
  receiptFooter: '',
  primaryColor: '',
  secondaryColor: '',
  accentColor: '',
  theme: 'dark',
  ...over,
})

const summary = (over: Partial<EndOfDaySummary> = {}): EndOfDaySummary =>
  ({
    date: new Date(2026, 7, 31).getTime(),
    orders: 4,
    cups: 5,
    snacks: 2,
    analytics: {
      grossRevenue: 76500,
      taxTotal: 8196,
      cogsTotal: 26120,
      cupsBySize: [{ size: '12oz', quantity: 3 }],
      snacksByItem: [{ name: 'Butter Croissant', quantity: 2 }],
    },
    pnl: { grossProfit: 48880, netProfit: 48880, totalExpenses: 0, netSales: 68304 },
    expenses: [],
    byCategory: [{ name: 'Hot Espresso', quantity: 3, revenue: 42000, cogs: 11130, profit: 30870, share: 55 }],
    byProduct: [],
    payments: [{ method: 'GCASH', label: 'GCash', count: 2, amount: 62500 }],
    byIngredient: [],
    unexplainedCogs: 0,
    uncostedSales: 0,
    quiet: false,
    ...over,
  }) as unknown as EndOfDaySummary

const printed = (over?: Partial<EndOfDaySummary>, brand?: Partial<BrandingSettings>): string =>
  endOfShiftLines({ summary: summary(over), branding: branding(brand), money, paperWidth: 58 }).join('\n')

describe('the printed summary', () => {
  test('heads the sheet with the shop, so it says where it came from', () => {
    const sheet = printed()
    expect(sheet).toContain('BNC Coffee')
    expect(sheet).toContain('Brewed next door')
    expect(sheet).toContain('12 Ortigas Ave')
    expect(sheet).toContain('0917 000 0000')
  })

  test('still identifies itself when the shop has set no name', () => {
    expect(printed(undefined, { businessName: '' })).toContain('END OF SHIFT')
  })

  test('leaves out branding lines the shop has not filled in', () => {
    const sheet = printed(undefined, { tagline: '', address: '', contactNumber: '' })
    expect(sheet).not.toContain('Brewed next door')
    expect(sheet).not.toContain('Ortigas')
  })

  test('carries the counts and what they were made of', () => {
    const sheet = printed()
    expect(sheet).toMatch(/Cups sold\s+5/)
    expect(sheet).toMatch(/12oz\s+3/)
    expect(sheet).toMatch(/Snacks sold\s+2/)
    expect(sheet).toContain('Butter Croissant')
  })

  test('says how many cups it could not break down rather than hiding them', () => {
    // Five cups sold, three of them itemised by size.
    expect(printed()).toMatch(/Not itemised\s+2/)
  })

  test('lists the expenses and their total', () => {
    const sheet = printed({
      expenses: [
        { id: '1', label: 'Electricity', amount: 12000 },
        { id: '2', label: 'Barista shift', amount: 45000 },
      ],
      pnl: { grossProfit: 48880, netProfit: -8120, totalExpenses: 57000, netSales: 68304 },
    } as unknown as Partial<EndOfDaySummary>)

    expect(sheet).toContain('Electricity')
    expect(sheet).toContain('Barista shift')
    expect(sheet).toContain('TOTAL EXPENSES')
  })

  test('says so plainly when no expense was recorded', () => {
    expect(printed()).toContain('None recorded')
  })

  test('prints the same figures the screen shows', () => {
    const sheet = printed()
    expect(sheet).toContain(money(76500))
    expect(sheet).toContain(money(26120))
    expect(sheet).toContain(money(48880))
  })

  test('fits the paper it is printed on', () => {
    for (const width of [58, 80] as const) {
      const lines = endOfShiftLines({ summary: summary(), branding: branding(), money, paperWidth: width })
      const columns = width === 58 ? 32 : 48
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns)
    }
  })

  test('leaves room to sign it off', () => {
    const sheet = printed()
    expect(sheet).toContain('Counted by')
    expect(sheet).toContain('Checked by')
  })

  test('warns when part of the takings has no cost behind it', () => {
    // Unwrapped first: the notice is a sentence, and at 32 columns it is
    // split across lines wherever it happens to fall.
    const flowed = printed({ uncostedSales: 450000 } as Partial<EndOfDaySummary>).replace(/\s+/g, ' ')
    expect(flowed).toContain('entered as a day total, so it has no cost behind it')
  })
})
