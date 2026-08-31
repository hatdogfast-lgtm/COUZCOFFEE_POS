import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  PERMISSIONS,
  ROLES,
  permissionsForRole,
  type ExpenseCategoryEntry,
  type OrderTypeEntry,
  type PaymentKind,
  type PaymentMethodEntry,
  type RoleEntry,
  type ShopListEntry,
} from '@pos/shared'
import { db } from './database.ts'
import { commit, created, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * The lists a shop defines for itself.
 *
 * Payment methods, expense categories, order types and roles all have the same
 * shape: a stable code that records point at, a name people read, and an order
 * they appear in. Keeping them as data rather than as unions in the source is
 * the difference between a shop that can add "BPI QR" itself and one that has
 * to wait for a release.
 *
 * The built-in rows are seeded once and can then be renamed, reordered or
 * switched off — but never deleted, because sales taken years ago still name
 * them and a report that cannot say what something was is worse than a tidy
 * list. Rows the shop adds are its own, and may be removed while nothing
 * refers to them.
 */

const alive = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null)

const byOrder = <T extends { sortOrder: number; name: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

// ------------------------------------------------------------- the built-ins --

/** How each payment behaves, which is the part the till cannot guess. */
const PAYMENT_DEFAULTS: Record<string, { name: string; kind: PaymentKind; opensDrawer: boolean }> = {
  CASH: { name: 'Cash', kind: 'CASH', opensDrawer: true },
  GCASH: { name: 'GCash', kind: 'EWALLET', opensDrawer: false },
  MAYA: { name: 'Maya', kind: 'EWALLET', opensDrawer: false },
  CARD: { name: 'Card', kind: 'CARD', opensDrawer: false },
  LOYALTY: { name: 'Loyalty claim', kind: 'NON_CASH', opensDrawer: false },
}

const EXPENSE_DEFAULTS: Record<string, { name: string; kind: 'FIXED' | 'VARIABLE' }> = {
  PAYROLL: { name: 'Staff pay', kind: 'VARIABLE' },
  RENT: { name: 'Rent', kind: 'FIXED' },
  UTILITIES: { name: 'Utilities', kind: 'FIXED' },
  SUPPLIES: { name: 'Supplies', kind: 'VARIABLE' },
  MAINTENANCE: { name: 'Maintenance', kind: 'VARIABLE' },
  TRANSPORT: { name: 'Transport', kind: 'VARIABLE' },
  MARKETING: { name: 'Marketing', kind: 'VARIABLE' },
  FEES: { name: 'Fees and charges', kind: 'FIXED' },
  OTHER: { name: 'Other', kind: 'VARIABLE' },
}

const ORDER_TYPE_DEFAULTS: Record<string, string> = {
  DINE_IN: 'Dine in',
  TAKE_OUT: 'Take out',
  DELIVERY: 'Delivery',
}

const ROLE_DEFAULTS: Record<string, string> = {
  CASHIER: 'Cashier',
  BARISTA: 'Barista',
  SUPERVISOR: 'Supervisor',
  MANAGER: 'Manager',
  OWNER: 'Owner',
}

// ---------------------------------------------------------------- seeding --

/**
 * Put the built-in rows in, once.
 *
 * Safe to call on every start: a code that is already there is left exactly as
 * it is, so a shop that renamed "Take out" does not find it renamed back on the
 * next launch. Only genuinely missing rows are written, and only in one commit,
 * so a till that is interrupted does not end up with half a list.
 */
export async function seedShopLists(): Promise<void> {
  const [payments, expenses, orderTypes, roles] = await Promise.all([
    db.paymentMethods.toArray(),
    db.expenseCategories.toArray(),
    db.orderTypes.toArray(),
    db.roles.toArray(),
  ])

  const writes: PendingWrite[] = []
  const now = Date.now()

  const has = (rows: Array<{ code: string }>, code: string): boolean => rows.some((row) => row.code === code)

  PAYMENT_METHODS.forEach((code, index) => {
    if (has(payments, code)) return
    const spec = PAYMENT_DEFAULTS[code]
    if (!spec) return
    writes.push(
      created(
        'paymentMethods',
        stamp<PaymentMethodEntry>(
          {
            code,
            name: spec.name,
            kind: spec.kind,
            requiresReference: false,
            opensDrawer: spec.opensDrawer,
            sortOrder: index,
            active: true,
            builtIn: true,
          },
          now,
        ),
      ),
    )
  })

  EXPENSE_CATEGORIES.forEach((code, index) => {
    if (has(expenses, code)) return
    const spec = EXPENSE_DEFAULTS[code]
    if (!spec) return
    writes.push(
      created(
        'expenseCategories',
        stamp<ExpenseCategoryEntry>(
          { code, name: spec.name, kind: spec.kind, sortOrder: index, active: true, builtIn: true },
          now,
        ),
      ),
    )
  })

  Object.entries(ORDER_TYPE_DEFAULTS).forEach(([code, name], index) => {
    if (has(orderTypes, code)) return
    writes.push(
      created('orderTypes', stamp<OrderTypeEntry>({ code, name, sortOrder: index, active: true, builtIn: true }, now)),
    )
  })

  ROLES.forEach((code, index) => {
    if (has(roles, code)) return
    writes.push(
      created(
        'roles',
        stamp<RoleEntry>(
          {
            code,
            name: ROLE_DEFAULTS[code] ?? code,
            permissions: [...permissionsForRole(code)],
            sortOrder: index,
            active: true,
            builtIn: true,
          },
          now,
        ),
      ),
    )
  })

  if (writes.length > 0) await commit(writes, now)
}

// ---------------------------------------------------------------- reading --

export async function listPaymentMethods(includeInactive = false): Promise<PaymentMethodEntry[]> {
  const rows = alive(await db.paymentMethods.toArray())
  return byOrder(includeInactive ? rows : rows.filter((row) => row.active))
}

export async function listExpenseCategories(includeInactive = false): Promise<ExpenseCategoryEntry[]> {
  const rows = alive(await db.expenseCategories.toArray())
  return byOrder(includeInactive ? rows : rows.filter((row) => row.active))
}

export async function listOrderTypes(includeInactive = false): Promise<OrderTypeEntry[]> {
  const rows = alive(await db.orderTypes.toArray())
  return byOrder(includeInactive ? rows : rows.filter((row) => row.active))
}

export async function listRoles(includeInactive = false): Promise<RoleEntry[]> {
  const rows = alive(await db.roles.toArray())
  return byOrder(includeInactive ? rows : rows.filter((row) => row.active))
}

/**
 * What a stored code is called.
 *
 * A code with no row left - switched off, or from a till running a newer list -
 * reads as itself rather than as blank, so an old sale never shows an empty
 * column where its order type used to be.
 */
export function nameOf(rows: Array<{ code: string; name: string }>, code: string | undefined): string {
  if (!code) return ''
  return rows.find((row) => row.code === code)?.name ?? code
}

// ---------------------------------------------------------------- writing --

function audit(input: {
  entity: string
  entityId: string
  action: string
  userId: string
  before: unknown
  after: unknown
  reason: string
  now: number
}): PendingWrite {
  return created(
    'auditLogs',
    stamp(
      {
        entityType: input.entity,
        entityId: input.entityId,
        action: input.action,
        userId: input.userId,
        before: input.before === null ? null : JSON.stringify(input.before),
        after: input.after === null ? null : JSON.stringify(input.after),
        reason: input.reason,
        occurredAt: input.now,
      } as never,
      input.now,
    ),
  )
}

type ListTable = 'paymentMethods' | 'expenseCategories' | 'orderTypes' | 'roles'

/** A code the shop typed, made safe to store and compare. */
export function codeFrom(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
}

export async function addListEntry<T extends ShopListEntry>(input: {
  table: ListTable
  entry: Omit<T, keyof ShopListEntry | 'id'> & { name: string }
  userId: string
}): Promise<void> {
  const name = input.entry.name.trim()
  if (name.length === 0) throw new Error('Give it a name.')

  const code = codeFrom(name)
  if (code.length === 0) throw new Error('That name has no letters or numbers in it.')

  const existing = alive(await db.table(input.table).toArray() as ShopListEntry[])
  if (existing.some((row) => row.code === code)) {
    throw new Error(`There is already one called "${name}".`)
  }

  const now = Date.now()
  const row = stamp(
    {
      ...(input.entry as object),
      code,
      name,
      sortOrder: existing.length,
      active: true,
      builtIn: false,
    } as never,
    now,
  ) as ShopListEntry

  await commit(
    [
      created(input.table as never, row as never),
      audit({
        entity: input.table,
        entityId: row.id,
        action: 'LIST_ENTRY_ADDED',
        userId: input.userId,
        before: null,
        after: { code, name },
        reason: `Added "${name}"`,
        now,
      }),
    ],
    now,
  )
}

export async function updateListEntry<T extends ShopListEntry>(input: {
  table: ListTable
  entry: T
  changes: Partial<T>
  userId: string
}): Promise<void> {
  const changes = { ...input.changes }
  if (changes.name !== undefined) {
    changes.name = changes.name.trim() as T['name']
    if ((changes.name as string).length === 0) throw new Error('Give it a name.')
  }
  // The code is what every record points at, so it never moves once written.
  delete (changes as { code?: string }).code

  const now = Date.now()
  const revised = revise(input.entry, changes, now)

  await commit(
    [
      updated(input.table as never, revised as never),
      audit({
        entity: input.table,
        entityId: input.entry.id,
        action: 'LIST_ENTRY_UPDATED',
        userId: input.userId,
        before: { name: input.entry.name, active: input.entry.active },
        after: changes,
        reason: `Changed "${revised.name}"`,
        now,
      }),
    ],
    now,
  )
}

/**
 * Remove one the shop added.
 *
 * A built-in is switched off instead, and so is anything still referred to by
 * the records - the caller says how many point at it, because only it knows
 * where to look.
 */
export async function removeListEntry<T extends ShopListEntry>(input: {
  table: ListTable
  entry: T
  usedBy: number
  userId: string
}): Promise<void> {
  if (input.entry.builtIn) {
    throw new Error(`"${input.entry.name}" came with the system. Switch it off instead of removing it.`)
  }
  if (input.usedBy > 0) {
    throw new Error(
      `"${input.entry.name}" is used by ${input.usedBy} record${input.usedBy === 1 ? '' : 's'}. Switch it off instead.`,
    )
  }

  const now = Date.now()
  await commit(
    [
      updated(input.table as never, revise(input.entry, { deletedAt: now } as never, now) as never),
      audit({
        entity: input.table,
        entityId: input.entry.id,
        action: 'LIST_ENTRY_REMOVED',
        userId: input.userId,
        before: { code: input.entry.code, name: input.entry.name },
        after: null,
        reason: `Removed "${input.entry.name}"`,
        now,
      }),
    ],
    now,
  )
}

/**
 * What a role may do.
 *
 * Read from the shop's own roles where one exists, falling back to the built-in
 * set so a till that has not yet pulled the list still lets people work.
 */
export function permissionsOf(roles: RoleEntry[], code: string | undefined): string[] {
  if (!code) return []
  const role = roles.find((entry) => entry.code === code)
  if (role) return role.permissions
  return [...permissionsForRole(code as never)]
}

/** Every permission there is, for building a role. */
export const ALL_PERMISSIONS: readonly string[] = PERMISSIONS
