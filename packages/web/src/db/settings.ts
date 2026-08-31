import type { AuditLog, BrandingSettings, BusinessSettings, ReceiptSettings, TaxSettings } from '@pos/shared'
import { db } from './database.ts'
import { commit, created, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * Changing how the business is configured.
 *
 * Settings decide what appears on a receipt and how every future total is
 * worked out, so each change is audited with its before and after. Turning tax
 * off is deliberately one of those: sales already recorded keep the tax they
 * were rung up with, and only what comes next is affected.
 */

export async function updateSettings(input: {
  settings: BusinessSettings
  changes: Partial<Pick<BusinessSettings, 'tax' | 'currencySymbol' | 'currencyCode' | 'locale' | 'statutoryDiscountRate' | 'lowStockWarningEnabled' | 'blockSaleWhenOutOfStock' | 'backdatingEnabled' | 'requireReferenceFor' | 'includeLabourInCost' | 'dashboardTiles' | 'statutoryRules' | 'receiptSections' | 'lowStock' | 'loyalty'>>
  actorId: string
  what: string
}): Promise<BusinessSettings> {
  const now = Date.now()
  const revised = revise<BusinessSettings>(input.settings, input.changes, now)

  const writes: PendingWrite[] = [
    updated('settings', revised),
    created(
      'auditLogs',
      stamp<AuditLog>({
        entityType: 'settings',
        entityId: input.settings.id,
        action: 'SETTINGS_UPDATED',
        userId: input.actorId,
        before: JSON.stringify(pick(input.settings, Object.keys(input.changes))),
        after: JSON.stringify(input.changes),
        reason: input.what,
        occurredAt: now,
      }),
    ),
  ]

  await commit(writes, now)
  return revised
}

/**
 * Show or hide one figure on the reports dashboard.
 *
 * The stored map is re-read here rather than taken from what the screen last
 * rendered. Someone turning three tiles off in a row can outrun the screen's
 * own refresh, and merging into a stale map would quietly undo the earlier
 * two - which looks like a toggle that does not work.
 */
export async function setDashboardTile(input: {
  tileId: string
  on: boolean
  label: string
  actorId: string
}): Promise<void> {
  const settings = (await db.settings.toArray()).find((row) => row.deletedAt === null)
  if (!settings) throw new Error('There are no settings to change.')

  const dashboardTiles = { ...(settings.dashboardTiles ?? {}), [input.tileId]: input.on }
  await updateSettings({
    settings,
    changes: { dashboardTiles },
    actorId: input.actorId,
    what: `${input.label} ${input.on ? 'shown on' : 'hidden on'} the dashboard`,
  })
}

export async function updateBranding(input: {
  settings: BusinessSettings
  changes: Partial<BrandingSettings>
  actorId: string
}): Promise<BusinessSettings> {
  const now = Date.now()
  const branding = { ...input.settings.branding, ...input.changes }
  const revised = revise<BusinessSettings>(input.settings, { branding }, now)

  await commit(
    [
      updated('settings', revised),
      created(
        'auditLogs',
        stamp<AuditLog>({
          entityType: 'settings',
          entityId: input.settings.id,
          action: 'BRANDING_UPDATED',
          userId: input.actorId,
          before: JSON.stringify(pick(input.settings.branding, Object.keys(input.changes))),
          after: JSON.stringify(input.changes),
          reason: '',
          occurredAt: now,
        }),
      ),
    ],
    now,
  )
  return revised
}

/**
 * Turn tax on or off.
 *
 * Kept as its own call because it changes every total from here on, and the
 * audit entry should say plainly which way it went rather than leaving someone
 * to read it out of a JSON blob.
 */
export async function setTaxEnabled(input: {
  settings: BusinessSettings
  enabled: boolean
  actorId: string
}): Promise<BusinessSettings> {
  const tax: TaxSettings = { ...input.settings.tax, enabled: input.enabled }
  return updateSettings({
    settings: input.settings,
    changes: { tax },
    actorId: input.actorId,
    what: input.enabled ? `${tax.label} switched on` : `${tax.label} switched off`,
  })
}

function pick<T extends object>(source: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key] = (source as Record<string, unknown>)[key]
  return out as Partial<T>
}

/**
 * Changing how this till prints.
 *
 * These belong to the terminal as much as to the business - a shop can have a
 * Bluetooth printer on the counter and a tablet that goes through the print
 * dialogue - but they are stored with the settings so a second till inherits
 * something sensible instead of nothing.
 */
export async function updateReceiptSettings(input: {
  settings: BusinessSettings
  changes: Partial<ReceiptSettings>
  actorId?: string
}): Promise<BusinessSettings> {
  const now = Date.now()
  const receipt: ReceiptSettings = { ...input.settings.receipt, ...input.changes }
  const revised = revise<BusinessSettings>(input.settings, { receipt }, now)

  await commit(
    [
      updated('settings', revised),
      created(
        'auditLogs',
        stamp<AuditLog>({
          entityType: 'settings',
          entityId: input.settings.id,
          action: 'RECEIPT_SETTINGS_UPDATED',
          userId: input.actorId ?? '',
          before: JSON.stringify(input.settings.receipt),
          after: JSON.stringify(receipt),
          reason: 'Receipt printing changed',
          occurredAt: now,
        }),
      ),
    ],
    now,
  )
  return revised
}
