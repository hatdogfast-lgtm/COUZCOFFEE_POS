import { beforeEach, describe, expect, test } from 'vitest'
import { effectivePermissions, permissionsForRole, userCan, verifyPin, type User } from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import {
  createStaffMember,
  isLockedOut,
  listStaff,
  resetPermissions,
  resetPin,
  setPermission,
  unlockStaffMember,
  updateStaffMember,
} from './staff.ts'

/**
 * Staff accounts and what each person may do.
 *
 * The rules worth protecting are the ones that bite later: an owner who locks
 * themselves out of their own shop, a permission that silently stops following
 * its role, and a PIN that can be read back out of the record.
 */

let owner: User
const ACTOR = 'OWNER-1'

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()

  owner = stamp<User>({
    name: 'Alex Santos', role: 'OWNER', pinHash: 'pbkdf2$sha256$1$x$y', active: true,
    employeeCode: 'OWNER', failedAttempts: 0, lockedUntil: null, permissionOverrides: {},
  })
  await commit([created('users', owner)])
}

beforeEach(reset)

describe('what a role allows', () => {
  test('a barista can sell but cannot refund', () => {
    expect(userCan('BARISTA', {}, 'pos.sell')).toBe(true)
    expect(userCan('BARISTA', {}, 'pos.refund')).toBe(false)
    expect(userCan('BARISTA', {}, 'settings.edit')).toBe(false)
  })

  test('an owner can do everything', () => {
    for (const permission of permissionsForRole('OWNER')) {
      expect(userCan('OWNER', {}, permission)).toBe(true)
    }
  })

  test('nobody signed in can do anything', () => {
    expect(userCan(undefined, {}, 'pos.sell')).toBe(false)
  })
})

describe('per-person overrides', () => {
  test('grant something the role does not allow', () => {
    expect(userCan('BARISTA', { 'pos.refund': true }, 'pos.refund')).toBe(true)
  })

  test('take away something the role does allow', () => {
    expect(userCan('BARISTA', { 'pos.sell': false }, 'pos.sell')).toBe(false)
  })

  test('anything not mentioned still follows the role', () => {
    const allowed = effectivePermissions('BARISTA', { 'pos.refund': true })
    expect(allowed.has('pos.refund')).toBe(true)
    expect(allowed.has('pos.sell')).toBe(true)
    expect(allowed.has('settings.edit')).toBe(false)
  })

  test('an unrecognised key is ignored rather than trusted', () => {
    const allowed = effectivePermissions('BARISTA', { 'not.a.permission': true } as never)
    expect(allowed.has('pos.sell')).toBe(true)
    expect(allowed.size).toBe(permissionsForRole('BARISTA').length)
  })
})

describe('adding someone', () => {
  test('creates an account they can sign in with', async () => {
    const person = await createStaffMember({
      name: 'Mia Cruz', role: 'BARISTA', pin: '8317', employeeCode: 'B-04', actorId: ACTOR,
    })

    expect(person.name).toBe('Mia Cruz')
    expect(person.role).toBe('BARISTA')
    expect(person.active).toBe(true)
    expect(await verifyPin('8317', person.pinHash)).toBe(true)
  })

  test('never stores the PIN in readable form', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    expect(person.pinHash).not.toContain('8317')
  })

  test('will not set a guessable PIN unless it is asked for outright', async () => {
    await expect(
      createStaffMember({ name: 'Mia', role: 'BARISTA', pin: '1234', employeeCode: '', actorId: ACTOR }),
    ).rejects.toThrow(/easy to guess/i)
  })

  test('sets a guessable PIN when the shop insists', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '1234', employeeCode: '', actorId: ACTOR, allowWeak: true,
    })
    expect(await verifyPin('1234', person.pinHash)).toBe(true)
  })

  test('the shape rule still holds even when a weak PIN is allowed', async () => {
    await expect(
      createStaffMember({
        name: 'Mia', role: 'BARISTA', pin: '12', employeeCode: '', actorId: ACTOR, allowWeak: true,
      }),
    ).rejects.toThrow(/four digits|exactly 4/i)
  })

  test('refuses a PIN that is not four digits', async () => {
    await expect(
      createStaffMember({ name: 'Mia', role: 'BARISTA', pin: '831', employeeCode: '', actorId: ACTOR }),
    ).rejects.toThrow()
  })

  test('refuses a blank name', async () => {
    await expect(
      createStaffMember({ name: '   ', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR }),
    ).rejects.toThrow(/name/i)
  })

  test('is recorded in the audit trail', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    const audit = await db.auditLogs.where('entityId').equals(person.id).toArray()
    expect(audit.some((entry) => entry.action === 'STAFF_CREATED')).toBe(true)
  })
})

describe('changing what one person can do', () => {
  test('switching a permission on records only that difference', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    const revised = await setPermission({
      user: person, permission: 'pos.refund', granted: true, actorId: ACTOR,
    })

    expect(revised.permissionOverrides).toEqual({ 'pos.refund': true })
    expect(userCan(revised.role, revised.permissionOverrides, 'pos.refund')).toBe(true)
    // Everything else is untouched and still follows the role.
    expect(userCan(revised.role, revised.permissionOverrides, 'pos.sell')).toBe(true)
  })

  test('clearing an override puts them back on the role', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    const granted = await setPermission({
      user: person, permission: 'pos.refund', granted: true, actorId: ACTOR,
    })
    const cleared = await setPermission({
      user: granted, permission: 'pos.refund', granted: undefined, actorId: ACTOR,
    })

    expect(cleared.permissionOverrides).toEqual({})
    expect(userCan(cleared.role, cleared.permissionOverrides, 'pos.refund')).toBe(false)
  })

  test('resetting clears every override at once', async () => {
    let person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    person = await setPermission({ user: person, permission: 'pos.refund', granted: true, actorId: ACTOR })
    person = await setPermission({ user: person, permission: 'pos.sell', granted: false, actorId: ACTOR })
    expect(Object.keys(person.permissionOverrides)).toHaveLength(2)

    const cleared = await resetPermissions({ user: person, actorId: ACTOR })
    expect(cleared.permissionOverrides).toEqual({})
  })

  test('every change is auditable, naming who made it', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    await setPermission({ user: person, permission: 'pos.refund', granted: true, actorId: ACTOR })

    const audit = await db.auditLogs.where('entityId').equals(person.id).toArray()
    const change = audit.find((entry) => entry.action === 'STAFF_PERMISSION_CHANGED')
    expect(change?.userId).toBe(ACTOR)
    expect(change?.after).toContain('pos.refund')
  })
})

describe('not locking yourself out', () => {
  test('the last active owner cannot be switched off', async () => {
    await expect(
      updateStaffMember({ user: owner, changes: { active: false }, actorId: ACTOR }),
    ).rejects.toThrow(/last active owner/i)
  })

  test('the last active owner cannot be demoted', async () => {
    await expect(
      updateStaffMember({ user: owner, changes: { role: 'BARISTA' }, actorId: ACTOR }),
    ).rejects.toThrow(/last active owner/i)
  })

  test('but either is fine once somebody else is an owner', async () => {
    await createStaffMember({ name: 'Jo', role: 'OWNER', pin: '4907', employeeCode: '', actorId: ACTOR })
    const demoted = await updateStaffMember({ user: owner, changes: { role: 'MANAGER' }, actorId: ACTOR })
    expect(demoted.role).toBe('MANAGER')
  })

  test('an ordinary staff member can be switched off freely', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    const off = await updateStaffMember({ user: person, changes: { active: false }, actorId: ACTOR })
    expect(off.active).toBe(false)

    // Switched off, not deleted - past sales still point at a real person.
    expect(await db.users.get(person.id)).toBeDefined()
    expect((await listStaff()).some((entry) => entry.id === person.id)).toBe(true)
  })
})

describe('PINs and lockouts', () => {
  test('resetting replaces the PIN and clears any lockout', async () => {
    let person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    person = { ...person, failedAttempts: 5, lockedUntil: Date.now() + 60_000 }
    await db.users.put(person)
    expect(isLockedOut(person)).toBe(true)

    const reset = await resetPin({ user: person, pin: '2059', actorId: ACTOR })

    expect(await verifyPin('2059', reset.pinHash)).toBe(true)
    expect(await verifyPin('8317', reset.pinHash)).toBe(false)
    expect(reset.lockedUntil).toBeNull()
    expect(isLockedOut(reset)).toBe(false)
  })

  test('the audit records that a PIN changed, never what it changed to', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    await resetPin({ user: person, pin: '2059', actorId: ACTOR })

    const audit = await db.auditLogs.where('entityId').equals(person.id).toArray()
    const entry = audit.find((row) => row.action === 'STAFF_PIN_RESET')
    expect(entry).toBeDefined()
    expect(JSON.stringify(entry)).not.toContain('2059')
  })

  test('unlocking early leaves the PIN alone', async () => {
    let person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    person = { ...person, lockedUntil: Date.now() + 60_000 }
    await db.users.put(person)

    const unlocked = await unlockStaffMember({ user: person, actorId: ACTOR })
    expect(unlocked.lockedUntil).toBeNull()
    expect(await verifyPin('8317', unlocked.pinHash)).toBe(true)
  })

  test('a reset to a guessable PIN is refused unless it is asked for outright', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    await expect(resetPin({ user: person, pin: '0000', actorId: ACTOR })).rejects.toThrow(/easy to guess/i)
  })

  test('resets to a guessable PIN when the shop insists, and the old one stops working', async () => {
    const person = await createStaffMember({
      name: 'Mia', role: 'BARISTA', pin: '8317', employeeCode: '', actorId: ACTOR,
    })
    const changed = await resetPin({ user: person, pin: '0000', actorId: ACTOR, allowWeak: true })

    expect(await verifyPin('0000', changed.pinHash)).toBe(true)
    expect(await verifyPin('8317', changed.pinHash)).toBe(false)
  })
})
