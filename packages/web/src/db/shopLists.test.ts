import { beforeEach, describe, expect, test } from 'vitest'
import type { OrderTypeEntry, PaymentMethodEntry, RoleEntry } from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import {
  addListEntry,
  codeFrom,
  listExpenseCategories,
  listOrderTypes,
  listPaymentMethods,
  listRoles,
  nameOf,
  permissionsOf,
  removeListEntry,
  seedShopLists,
  updateListEntry,
} from './shopLists.ts'

/**
 * The lists a shop defines for itself.
 *
 * The point of these tests is what happens over time rather than on day one: a
 * shop renames something, switches something off, adds something of its own,
 * and every sale ever taken has to keep meaning what it meant. A list that
 * loses that is worse than a hard-coded one.
 */

const ACTOR = 'USER-1'

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()
}

beforeEach(reset)

describe('setting the lists up', () => {
  test('puts the built-in rows in', async () => {
    await seedShopLists()

    expect((await listPaymentMethods()).map((row) => row.code)).toContain('GCASH')
    expect((await listExpenseCategories()).map((row) => row.code)).toContain('PAYROLL')
    expect((await listOrderTypes()).map((row) => row.code)).toContain('TAKE_OUT')
    expect((await listRoles()).map((row) => row.code)).toContain('OWNER')
  })

  test('running again adds nothing, so a till can call it every start', async () => {
    await seedShopLists()
    const first = await listPaymentMethods()
    await seedShopLists()
    await seedShopLists()

    expect((await listPaymentMethods()).length).toBe(first.length)
  })

  test('never undoes a rename', async () => {
    await seedShopLists()
    const takeOut = (await listOrderTypes()).find((row) => row.code === 'TAKE_OUT')!
    await updateListEntry({ table: 'orderTypes', entry: takeOut, changes: { name: 'Takeaway' }, userId: ACTOR })

    await seedShopLists()

    expect((await listOrderTypes()).find((row) => row.code === 'TAKE_OUT')?.name).toBe('Takeaway')
  })

  test('a payment method knows how it behaves', async () => {
    await seedShopLists()
    const methods = await listPaymentMethods()

    expect(methods.find((row) => row.code === 'CASH')?.kind).toBe('CASH')
    expect(methods.find((row) => row.code === 'CASH')?.opensDrawer).toBe(true)
    expect(methods.find((row) => row.code === 'GCASH')?.kind).toBe('EWALLET')
    // A loyalty claim is not money coming in.
    expect(methods.find((row) => row.code === 'LOYALTY')?.kind).toBe('NON_CASH')
  })

  test('the built-in roles arrive with the permissions they always had', async () => {
    await seedShopLists()
    const roles = await listRoles()

    const owner = roles.find((row) => row.code === 'OWNER')!
    const cashier = roles.find((row) => row.code === 'CASHIER')!
    expect(owner.permissions).toContain('settings.edit')
    expect(cashier.permissions).toContain('pos.sell')
    expect(cashier.permissions).not.toContain('settings.edit')
  })
})

describe('a shop adding its own', () => {
  test('adds one and gives it a code of its own', async () => {
    await seedShopLists()
    await addListEntry<PaymentMethodEntry>({
      table: 'paymentMethods',
      entry: { name: 'BPI QR', kind: 'EWALLET', requiresReference: true, opensDrawer: false },
      userId: ACTOR,
    })

    const added = (await listPaymentMethods()).find((row) => row.name === 'BPI QR')
    expect(added?.code).toBe('BPI_QR')
    expect(added?.builtIn).toBe(false)
    expect(added?.requiresReference).toBe(true)
  })

  test('refuses a second one by the same name', async () => {
    await seedShopLists()
    const entry = { name: 'Voucher', kind: 'NON_CASH' as const, requiresReference: false, opensDrawer: false }
    await addListEntry<PaymentMethodEntry>({ table: 'paymentMethods', entry, userId: ACTOR })

    await expect(
      addListEntry<PaymentMethodEntry>({ table: 'paymentMethods', entry, userId: ACTOR }),
    ).rejects.toThrow(/already one/i)
  })

  test('refuses a name with nothing in it to make a code from', async () => {
    await expect(
      addListEntry<OrderTypeEntry>({ table: 'orderTypes', entry: { name: '   ' }, userId: ACTOR }),
    ).rejects.toThrow(/name/i)
    await expect(
      addListEntry<OrderTypeEntry>({ table: 'orderTypes', entry: { name: '!!!' }, userId: ACTOR }),
    ).rejects.toThrow(/letters or numbers/i)
  })

  test('removes one of its own while nothing points at it', async () => {
    await addListEntry<OrderTypeEntry>({ table: 'orderTypes', entry: { name: 'Catering' }, userId: ACTOR })
    const added = (await listOrderTypes()).find((row) => row.name === 'Catering')!

    await removeListEntry({ table: 'orderTypes', entry: added, usedBy: 0, userId: ACTOR })
    expect((await listOrderTypes()).some((row) => row.name === 'Catering')).toBe(false)
  })

  test('will not remove one the records still point at', async () => {
    await addListEntry<OrderTypeEntry>({ table: 'orderTypes', entry: { name: 'Catering' }, userId: ACTOR })
    const added = (await listOrderTypes()).find((row) => row.name === 'Catering')!

    await expect(
      removeListEntry({ table: 'orderTypes', entry: added, usedBy: 3, userId: ACTOR }),
    ).rejects.toThrow(/used by 3/i)
  })

  test('will not remove a built-in, because the books still name it', async () => {
    await seedShopLists()
    const dineIn = (await listOrderTypes()).find((row) => row.code === 'DINE_IN')!

    await expect(
      removeListEntry({ table: 'orderTypes', entry: dineIn, usedBy: 0, userId: ACTOR }),
    ).rejects.toThrow(/came with the system/i)
  })
})

describe('switching one off', () => {
  test('takes it off the list the till offers but leaves it readable', async () => {
    await seedShopLists()
    const maya = (await listPaymentMethods()).find((row) => row.code === 'MAYA')!
    await updateListEntry({ table: 'paymentMethods', entry: maya, changes: { active: false }, userId: ACTOR })

    expect((await listPaymentMethods()).some((row) => row.code === 'MAYA')).toBe(false)
    // Still there for anything already recorded against it.
    const all = await listPaymentMethods(true)
    expect(nameOf(all, 'MAYA')).toBe('Maya')
  })
})

describe('reading a code back', () => {
  test('gives the name the shop chose', async () => {
    await seedShopLists()
    expect(nameOf(await listOrderTypes(), 'DINE_IN')).toBe('Dine in')
  })

  test('a code with no row left reads as itself, never as blank', () => {
    expect(nameOf([], 'SOMETHING_OLD')).toBe('SOMETHING_OLD')
    expect(nameOf([], undefined)).toBe('')
  })

  test('the code never moves when the name does', async () => {
    await seedShopLists()
    const dineIn = (await listOrderTypes()).find((row) => row.code === 'DINE_IN')!
    await updateListEntry({
      table: 'orderTypes',
      entry: dineIn,
      changes: { name: 'Eat in', code: 'EAT_IN' } as never,
      userId: ACTOR,
    })

    const after = (await listOrderTypes()).find((row) => row.name === 'Eat in')
    // Renamed, but every sale ever taken still points at a code that exists.
    expect(after?.code).toBe('DINE_IN')
  })
})

describe('what a role may do', () => {
  test('comes from the shop list when there is one', async () => {
    await seedShopLists()
    const roles = await listRoles()
    const barista = roles.find((row) => row.code === 'BARISTA')!
    await updateListEntry<RoleEntry>({
      table: 'roles',
      entry: barista,
      changes: { permissions: [...barista.permissions, 'report.view'] },
      userId: ACTOR,
    })

    expect(permissionsOf(await listRoles(), 'BARISTA')).toContain('report.view')
  })

  test('falls back to the built-in set when the list has not arrived', () => {
    expect(permissionsOf([], 'OWNER')).toContain('settings.edit')
    expect(permissionsOf([], 'CASHIER')).toContain('pos.sell')
  })

  test('a role nobody has heard of may do nothing', () => {
    expect(permissionsOf([], 'WIZARD')).toEqual([])
    expect(permissionsOf([], undefined)).toEqual([])
  })

  test('a role the shop invented carries exactly what it was given', async () => {
    await addListEntry<RoleEntry>({
      table: 'roles',
      entry: { name: 'Weekend cover', permissions: ['pos.sell', 'sales.view'] },
      userId: ACTOR,
    })

    expect(permissionsOf(await listRoles(), 'WEEKEND_COVER')).toEqual(['pos.sell', 'sales.view'])
  })
})

describe('making a code from a name', () => {
  test('is upper case with the gaps filled in', () => {
    expect(codeFrom('Bank transfer')).toBe('BANK_TRANSFER')
    expect(codeFrom('  GCash  ')).toBe('GCASH')
    expect(codeFrom('Buy 1 get 1')).toBe('BUY_1_GET_1')
  })

  test('drops punctuation rather than smuggling it into a key', () => {
    expect(codeFrom('Fees & charges')).toBe('FEES_CHARGES')
    expect(codeFrom('---')).toBe('')
  })
})
