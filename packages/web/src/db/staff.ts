import {
  assertPinShape,
  hashPin,
  isWeakPin,
  type AuditLog,
  type Permission,
  type PermissionOverrides,
  type Role,
  type User,
} from '@pos/shared'
import { db } from './database.ts'
import { commit, created, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * An easily guessed PIN is refused unless the caller has explicitly asked for
 * it, so nothing sets one by accident - but the person in charge of the shop is
 * allowed to decide, having been told.
 */
export const WEAK_PIN_MESSAGE = 'That PIN is easy to guess, like 1234 or 0000.'

/**
 * Staff accounts.
 *
 * Every change here is audited, because who may do what is exactly the sort of
 * thing that needs explaining after the fact. PINs are hashed on the way in and
 * never read back out - resetting one replaces it rather than revealing it.
 */

export async function listStaff(includeInactive = true): Promise<User[]> {
  const rows = await db.users.toArray()
  return rows
    .filter((user) => user.deletedAt === null && (includeInactive || user.active))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
}

/**
 * The last active owner cannot be removed or demoted.
 *
 * Without this, one wrong tap locks everybody out of their own system with no
 * way back in - there is no support line to call.
 */
async function wouldStrandTheShop(user: User, change: { role?: Role; active?: boolean }): Promise<boolean> {
  const stillOwner = (change.role ?? user.role) === 'OWNER'
  const stillActive = change.active ?? user.active
  if (stillOwner && stillActive) return false

  const owners = (await listStaff()).filter(
    (entry) => entry.role === 'OWNER' && entry.active && entry.id !== user.id,
  )
  return owners.length === 0
}

function auditEntry(input: {
  userId: string
  actorId: string
  action: string
  before: unknown
  after: unknown
  reason?: string
  at: number
}): PendingWrite {
  return created(
    'auditLogs',
    stamp<AuditLog>({
      entityType: 'users',
      entityId: input.userId,
      action: input.action,
      userId: input.actorId,
      before: input.before === null ? null : JSON.stringify(input.before),
      after: input.after === null ? null : JSON.stringify(input.after),
      reason: input.reason ?? '',
      occurredAt: input.at,
    }),
  )
}

export async function createStaffMember(input: {
  name: string
  role: Role
  pin: string
  employeeCode: string
  actorId: string
  /** Set only when someone has been shown the warning and chosen to go ahead. */
  allowWeak?: boolean
}): Promise<User> {
  const name = input.name.trim()
  if (name.length === 0) throw new Error('Give this person a name.')

  assertPinShape(input.pin)
  if (isWeakPin(input.pin) && input.allowWeak !== true) throw new Error(WEAK_PIN_MESSAGE)

  const now = Date.now()
  const user = stamp<User>({
    name,
    role: input.role,
    pinHash: await hashPin(input.pin),
    active: true,
    employeeCode: input.employeeCode.trim(),
    failedAttempts: 0,
    lockedUntil: null,
    permissionOverrides: {},
  })

  await commit(
    [
      created('users', user),
      auditEntry({
        userId: user.id,
        actorId: input.actorId,
        action: 'STAFF_CREATED',
        before: null,
        after: { name: user.name, role: user.role },
        at: now,
      }),
    ],
    now,
  )
  return user
}

export async function updateStaffMember(input: {
  user: User
  changes: { name?: string; role?: Role; employeeCode?: string; active?: boolean }
  actorId: string
}): Promise<User> {
  const { user, changes } = input

  if (changes.name !== undefined && changes.name.trim().length === 0) {
    throw new Error('A name cannot be blank.')
  }
  if (await wouldStrandTheShop(user, changes)) {
    throw new Error('This is the last active owner. Give someone else owner access first.')
  }

  const now = Date.now()
  const revised = revise(
    user,
    {
      ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
      ...(changes.role !== undefined ? { role: changes.role } : {}),
      ...(changes.employeeCode !== undefined ? { employeeCode: changes.employeeCode.trim() } : {}),
      ...(changes.active !== undefined ? { active: changes.active } : {}),
    },
    now,
  )

  await commit(
    [
      updated('users', revised),
      auditEntry({
        userId: user.id,
        actorId: input.actorId,
        action: changes.active === false ? 'STAFF_DEACTIVATED' : 'STAFF_UPDATED',
        before: { name: user.name, role: user.role, active: user.active },
        after: { name: revised.name, role: revised.role, active: revised.active },
        at: now,
      }),
    ],
    now,
  )
  return revised
}

/**
 * Turn one permission on or off for one person.
 *
 * Passing `undefined` clears the override so the permission follows their role
 * again - which is different from switching it off, and worth being able to
 * say.
 */
export async function setPermission(input: {
  user: User
  permission: Permission
  granted: boolean | undefined
  actorId: string
}): Promise<User> {
  const now = Date.now()
  const overrides: PermissionOverrides = { ...(input.user.permissionOverrides ?? {}) }

  if (input.granted === undefined) delete overrides[input.permission]
  else overrides[input.permission] = input.granted

  const revised = revise(input.user, { permissionOverrides: overrides }, now)

  await commit(
    [
      updated('users', revised),
      auditEntry({
        userId: input.user.id,
        actorId: input.actorId,
        action: 'STAFF_PERMISSION_CHANGED',
        before: { [input.permission]: input.user.permissionOverrides?.[input.permission] ?? 'role default' },
        after: { [input.permission]: input.granted ?? 'role default' },
        at: now,
      }),
    ],
    now,
  )
  return revised
}

/** Clear every override, putting this person back on their role exactly. */
export async function resetPermissions(input: { user: User; actorId: string }): Promise<User> {
  const now = Date.now()
  const revised = revise(input.user, { permissionOverrides: {} }, now)

  await commit(
    [
      updated('users', revised),
      auditEntry({
        userId: input.user.id,
        actorId: input.actorId,
        action: 'STAFF_PERMISSIONS_RESET',
        before: input.user.permissionOverrides ?? {},
        after: {},
        at: now,
      }),
    ],
    now,
  )
  return revised
}

/** Replace someone's PIN. The old one is never recoverable, only replaced. */
export async function resetPin(input: {
  user: User
  pin: string
  actorId: string
  /** Set only when someone has been shown the warning and chosen to go ahead. */
  allowWeak?: boolean
}): Promise<User> {
  assertPinShape(input.pin)
  if (isWeakPin(input.pin) && input.allowWeak !== true) throw new Error(WEAK_PIN_MESSAGE)

  const now = Date.now()
  const revised = revise(
    input.user,
    { pinHash: await hashPin(input.pin), failedAttempts: 0, lockedUntil: null },
    now,
  )

  await commit(
    [
      updated('users', revised),
      auditEntry({
        userId: input.user.id,
        actorId: input.actorId,
        // Deliberately records that it changed, never what it changed to.
        action: 'STAFF_PIN_RESET',
        before: null,
        after: null,
        at: now,
      }),
    ],
    now,
  )
  return revised
}

/** Lift a lockout early, without changing the PIN. */
export async function unlockStaffMember(input: { user: User; actorId: string }): Promise<User> {
  const now = Date.now()
  const revised = revise(input.user, { failedAttempts: 0, lockedUntil: null }, now)
  await commit(
    [
      updated('users', revised),
      auditEntry({
        userId: input.user.id,
        actorId: input.actorId,
        action: 'STAFF_UNLOCKED',
        before: { lockedUntil: input.user.lockedUntil },
        after: { lockedUntil: null },
        at: now,
      }),
    ],
    now,
  )
  return revised
}

export function isLockedOut(user: User): boolean {
  return Boolean(user.lockedUntil && user.lockedUntil > Date.now())
}
