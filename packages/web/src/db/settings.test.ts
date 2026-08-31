import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_LOW_STOCK, DEFAULT_LOYALTY, DEFAULT_STATUTORY_RULES, RECEIPT_SECTIONS, type BusinessSettings } from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { setDashboardTile } from './settings.ts'
import { commit, created, stamp } from './write.ts'

/**
 * Changing how the business is configured.
 *
 * The dashboard tiles are a map rather than a single field, which is what makes
 * them worth testing: a change has to merge into what is stored, not into
 * whatever the screen happened to be showing when the switch was pressed.
 */

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()

  await commit([
    created(
      'settings',
      stamp<BusinessSettings>({
        branding: { businessName: 'BNC', logoDataUrl: '', addressLine: '', contactLine: '' } as never,
        tax: { enabled: true, rate: 12, label: 'VAT', inclusive: true } as never,
        receipt: { prefix: 'OR', padding: 6, nextNumber: 1 } as never,
        queue: { prefix: 'Q', padding: 3, start: 1, resetDaily: true } as never,
        currencyCode: 'PHP',
        currencySymbol: '₱',
        locale: 'en-PH',
        statutoryDiscountRate: 20,
        lowStockWarningEnabled: true,
        blockSaleWhenOutOfStock: true,
        includeLabourInCost: false,
        backdatingEnabled: false,
        requireReferenceFor: [],
        plannerPasscodeHash: null,
        dashboardTiles: {},
    statutoryRules: DEFAULT_STATUTORY_RULES,
    receiptSections: RECEIPT_SECTIONS,
    lowStock: DEFAULT_LOW_STOCK,
    loyalty: DEFAULT_LOYALTY,
      }),
    ),
  ])
}

const stored = async (): Promise<Record<string, boolean>> => {
  const row = (await db.settings.toArray()).find((entry) => entry.deletedAt === null)
  return row?.dashboardTiles ?? {}
}

beforeEach(reset)

describe('dashboard tiles', () => {
  test('records the tile that was switched', async () => {
    await setDashboardTile({ tileId: 'netOfTax', on: true, label: 'Net of tax', actorId: 'USER-1' })
    expect(await stored()).toEqual({ netOfTax: true })
  })

  test('keeps earlier choices when another tile is switched', async () => {
    await setDashboardTile({ tileId: 'netOfTax', on: true, label: 'Net of tax', actorId: 'USER-1' })
    await setDashboardTile({ tileId: 'cogs', on: false, label: 'Cost of goods', actorId: 'USER-1' })
    await setDashboardTile({ tileId: 'margin', on: false, label: 'Margin', actorId: 'USER-1' })

    expect(await stored()).toEqual({ netOfTax: true, cogs: false, margin: false })
  })

  test('switching the same tile back leaves it off rather than absent', async () => {
    await setDashboardTile({ tileId: 'cups', on: false, label: 'Cups sold', actorId: 'USER-1' })
    await setDashboardTile({ tileId: 'cups', on: true, label: 'Cups sold', actorId: 'USER-1' })
    expect(await stored()).toEqual({ cups: true })
  })

  test('audits the change so a hidden figure can be accounted for', async () => {
    await setDashboardTile({ tileId: 'margin', on: false, label: 'Margin', actorId: 'USER-1' })

    const logs = await db.auditLogs.toArray()
    const entry = logs.find((row) => row.entityType === 'settings')
    expect(entry?.reason).toBe('Margin hidden on the dashboard')
    expect(entry?.userId).toBe('USER-1')
  })

  test('refuses when there are no settings to change', async () => {
    await db.settings.clear()
    await expect(
      setDashboardTile({ tileId: 'cups', on: false, label: 'Cups sold', actorId: 'USER-1' }),
    ).rejects.toThrow(/no settings/i)
  })
})
