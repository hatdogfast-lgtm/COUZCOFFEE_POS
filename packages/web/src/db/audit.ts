import type { AuditLog } from '@pos/shared'
import { db } from './database.ts'

/**
 * Reading the audit trail.
 *
 * Every consequential change already writes a row here as part of the same
 * transaction as the change itself, so the trail cannot disagree with what
 * happened. This module only reads: nothing in the application edits or
 * deletes an audit row, which is the entire point of having one.
 */

export interface AuditQuery {
  from: number
  to: number
  /** Free text across the reason, the action and the payloads. */
  text: string
  actions: string[]
  entityTypes: string[]
  userId: string | null
  limit: number
}

export interface AuditEntry {
  log: AuditLog
  userName: string
  actionLabel: string
  /** Fields that changed, worked out by comparing before with after. */
  changes: FieldChange[]
}

export interface FieldChange {
  field: string
  before: string | null
  after: string | null
  /** The value is an amount in minor units and should be shown as money. */
  money: boolean
}

/**
 * Fields whose stored value is money in minor units.
 *
 * Curated by hand rather than guessed from the name, because getting it wrong
 * is worse than leaving a number raw. `costRate` is deliberately absent: it is
 * held in micro-minor units, so showing it as money would be out by a factor
 * of a million - a wrong number that looks perfectly plausible.
 */
const MONEY_FIELDS = new Set([
  'amount',
  'cashSales',
  'change',
  'cogsTotal',
  'counted',
  'countedCash',
  'discountTotal',
  'expected',
  'expectedCash',
  'lineTotal',
  'openingFloat',
  'price',
  'refundedTotal',
  'subtotal',
  'targetSales',
  'tendered',
  'taxExemptTotal',
  'taxTotal',
  'total',
  'variance',
])

export interface AuditPage {
  entries: AuditEntry[]
  total: number
  hasMore: boolean
}

export const DEFAULT_AUDIT_LIMIT = 100

/**
 * Wording for the actions this app writes today.
 *
 * Anything not listed still displays - humanise() turns an unknown action into
 * readable words - so a new action added later shows up in the trail without
 * anyone having to remember to come back here.
 */
const ACTION_LABELS: Record<string, string> = {
  SALE_COMPLETED: 'Sale completed',
  SALE_VOIDED: 'Sale voided',
  SALE_REFUNDED: 'Refund given',
  LUMP_SUM_RECORDED: "Day's takings entered",
  X_READING: 'X reading taken',
  Z_READING: 'Z reading — shift closed',
  CASH_MOVEMENT: 'Cash in or out of the drawer',
  STOCK_OPENING: 'Opening stock',
  STOCK_PURCHASE: 'Delivery received',
  STOCK_SALE: 'Stock used by a sale',
  STOCK_VOID_RETURN: 'Stock returned by a void',
  STOCK_REFUND_RETURN: 'Stock returned by a refund',
  STOCK_WASTAGE: 'Wastage',
  STOCK_SPOILAGE: 'Spoilage',
  STOCK_DAMAGE: 'Damage',
  STOCK_MANUAL_ADJUSTMENT: 'Stock adjusted by hand',
  STOCK_STOCK_COUNT: 'Stock count',
  STOCK_TRANSFER: 'Stock transferred',
  STOCK_CORRECTION: 'Stock correction',
  COST_CHANGED: 'Ingredient cost changed',
  INGREDIENT_CREATED: 'Ingredient added',
  PRICE_CHANGED: 'Price changed',
  PRODUCT_CREATED: 'Menu item added',
  PRODUCT_UPDATED: 'Menu item changed',
  PRODUCT_ARCHIVED: 'Menu item removed',
  RECIPE_CREATED: 'Recipe added',
  RECIPE_UPDATED: 'Recipe changed',
  EXPENSE_RECORDED: 'Running cost recorded',
  EXPENSE_REMOVED: 'Running cost removed',
  TARGET_SET: 'Sales target set',
  TARGET_UPDATED: 'Sales target changed',
  PLANNER_LOCKED: 'Planner passcode set',
  PLANNER_UNLOCKED: 'Planner passcode removed',
  STAFF_CREATED: 'Staff member added',
  STAFF_UPDATED: 'Staff member changed',
  STAFF_DEACTIVATED: 'Staff member deactivated',
  STAFF_PERMISSION_CHANGED: 'Permission changed',
  STAFF_PERMISSIONS_RESET: 'Permissions reset to the role',
  STAFF_PIN_RESET: 'PIN reset',
  STAFF_UNLOCKED: 'Account unlocked',
  SETTINGS_UPDATED: 'Settings changed',
  BRANDING_UPDATED: 'Business details changed',
  BACKUP_RESTORED: 'Backup restored (replaced everything)',
  BACKUP_MERGED: 'Backup merged in',
}

/** Which broad part of the shop an action belongs to, for filtering. */
export const AUDIT_GROUPS: Array<{ id: string; label: string; match: (action: string) => boolean }> = [
  { id: 'SALES', label: 'Sales', match: (a) => a.startsWith('SALE_') || a === 'LUMP_SUM_RECORDED' },
  { id: 'CASH', label: 'Shifts and cash', match: (a) => a.endsWith('_READING') || a === 'CASH_MOVEMENT' },
  { id: 'STOCK', label: 'Stock', match: (a) => a.startsWith('STOCK_') || a === 'COST_CHANGED' || a === 'INGREDIENT_CREATED' },
  {
    id: 'MENU',
    label: 'Menu and recipes',
    match: (a) => a.startsWith('PRODUCT_') || a.startsWith('RECIPE_') || a === 'PRICE_CHANGED',
  },
  { id: 'MONEY', label: 'Costs and targets', match: (a) => a.startsWith('EXPENSE_') || a.startsWith('TARGET_') || a.startsWith('PLANNER_') },
  { id: 'PEOPLE', label: 'Staff', match: (a) => a.startsWith('STAFF_') },
  { id: 'SETUP', label: 'Settings and backups', match: (a) => a.startsWith('SETTINGS_') || a.startsWith('BRANDING_') || a.startsWith('BACKUP_') },
]

export function humanise(action: string): string {
  const known = ACTION_LABELS[action]
  if (known) return known
  const words = action.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function groupOf(action: string): string {
  return AUDIT_GROUPS.find((group) => group.match(action))?.id ?? 'OTHER'
}

function parse(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed }
  } catch {
    return { value }
  }
}

function show(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * What actually changed, rather than two blobs of JSON side by side.
 *
 * Fields that are identical on both sides are dropped, because a diff that
 * lists everything is a diff nobody reads.
 */
export function diff(before: string | null, after: string | null): FieldChange[] {
  const a = parse(before)
  const b = parse(after)
  if (!a && !b) return []

  const fields = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()
  const changes: FieldChange[] = []

  for (const field of fields) {
    const from = a ? a[field] : undefined
    const to = b ? b[field] : undefined
    if (a && b && show(from) === show(to)) continue

    // Only an actual number is treated as an amount; a money-named field
    // holding something else is left exactly as it was written.
    const numeric = [from, to].every((value) => value === undefined || typeof value === 'number')

    changes.push({
      field,
      before: a && field in a ? show(from) : null,
      after: b && field in b ? show(to) : null,
      money: MONEY_FIELDS.has(field) && numeric,
    })
  }
  return changes
}

/** Every action and entity type that actually appears, for building the filters. */
export async function auditFacets(): Promise<{ actions: string[]; entityTypes: string[] }> {
  const rows = await db.auditLogs.toArray()
  return {
    actions: [...new Set(rows.map((row) => row.action))].sort(),
    entityTypes: [...new Set(rows.map((row) => row.entityType))].sort(),
  }
}

export async function searchAuditLog(query: AuditQuery): Promise<AuditPage> {
  const [rows, users] = await Promise.all([
    db.auditLogs.where('occurredAt').between(query.from, query.to, true, true).toArray(),
    db.users.toArray(),
  ])

  const names = new Map(users.map((user) => [user.id, user.name]))
  const term = query.text.trim().toLowerCase()
  const actions = new Set(query.actions)
  const entityTypes = new Set(query.entityTypes)

  const matched = rows
    .filter((row) => {
      if (actions.size > 0 && !actions.has(row.action)) return false
      if (entityTypes.size > 0 && !entityTypes.has(row.entityType)) return false
      if (query.userId && row.userId !== query.userId) return false
      if (!term) return true
      const haystack = [
        row.action,
        humanise(row.action),
        row.reason,
        row.entityType,
        row.entityId,
        names.get(row.userId) ?? '',
        row.before ?? '',
        row.after ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
    .sort((a, b) => b.occurredAt - a.occurredAt)

  const page = matched.slice(0, query.limit)

  return {
    entries: page.map((log) => ({
      log,
      userName: names.get(log.userId) ?? 'Unknown',
      actionLabel: humanise(log.action),
      changes: diff(log.before, log.after),
    })),
    total: matched.length,
    hasMore: matched.length > page.length,
  }
}

/** A plain-text export of what is currently being looked at. */
export function auditToCsv(entries: AuditEntry[]): string {
  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`
  const header = ['When', 'Who', 'What', 'Record', 'Reference', 'Reason']
  const lines = [header.join(',')]
  for (const entry of entries) {
    lines.push(
      [
        new Date(entry.log.occurredAt).toISOString(),
        entry.userName,
        entry.actionLabel,
        entry.log.entityType,
        entry.log.entityId,
        entry.log.reason,
      ]
        .map(escape)
        .join(','),
    )
  }
  return lines.join('\n')
}
