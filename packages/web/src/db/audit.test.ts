import { beforeEach, describe, expect, test } from 'vitest'
import type { AuditLog, User } from '@pos/shared'
import { db } from './database.ts'
import { __setIdentityForTests } from './identity.ts'
import { commit, created, stamp } from './write.ts'
import {
  auditFacets,
  auditToCsv,
  diff,
  groupOf,
  humanise,
  searchAuditLog,
  type AuditQuery,
} from './audit.ts'

/**
 * Reading the audit trail.
 *
 * The trail is only worth having if it can be interrogated, so these tests are
 * about the questions an owner actually asks - who changed the price, what did
 * it change from, show me everything this barista did on Tuesday - and about
 * an action nobody has taught the viewer about still being readable.
 */

const USER: User = {
  id: 'U-ANA',
  name: 'Ana',
  role: 'OWNER',
  pinHash: '',
  active: true,
  employeeCode: '001',
  failedAttempts: 0,
  lockedUntil: null,
  permissionOverrides: {},
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  version: 1,
  deviceId: 'POS-TEST-01',
}

const BEN: User = { ...USER, id: 'U-BEN', name: 'Ben', role: 'BARISTA' }

async function reset(): Promise<void> {
  __setIdentityForTests({ deviceId: 'POS-TEST-01', label: 'Test Till', type: 'TABLET' })
  await db.delete()
  await db.open()
  await db.users.bulkPut([USER, BEN])
}

beforeEach(reset)

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 30, 10, 0, 0)

async function log(input: {
  action: string
  userId?: string
  at?: number
  before?: string | null
  after?: string | null
  reason?: string
  entityType?: string
}): Promise<AuditLog> {
  const row = stamp<AuditLog>({
    entityType: input.entityType ?? 'products',
    entityId: 'P-1',
    action: input.action,
    userId: input.userId ?? USER.id,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? '',
    occurredAt: input.at ?? NOW,
  })
  await commit([created('auditLogs', row)])
  return row
}

function query(changes: Partial<AuditQuery> = {}): AuditQuery {
  return {
    from: NOW - 30 * DAY,
    to: NOW + DAY,
    text: '',
    actions: [],
    entityTypes: [],
    userId: null,
    limit: 100,
    ...changes,
  }
}

describe('wording', () => {
  test('gives a known action plain words', () => {
    expect(humanise('SALE_VOIDED')).toBe('Sale voided')
    expect(humanise('STOCK_WASTAGE')).toBe('Wastage')
  })

  test('still reads an action nobody has taught it about', () => {
    // Actions are added by whoever writes the mutation; the viewer must not
    // need updating in lockstep or new entries would show up as raw shouting.
    expect(humanise('SOMETHING_NEW_HAPPENED')).toBe('Something new happened')
  })

  test('files an unknown action under a group rather than losing it', () => {
    expect(groupOf('SALE_VOIDED')).toBe('SALES')
    expect(groupOf('STOCK_WASTAGE')).toBe('STOCK')
    expect(groupOf('WHO_KNOWS')).toBe('OTHER')
  })
})

describe('what changed', () => {
  test('lists only the fields that actually moved', () => {
    const changes = diff(
      JSON.stringify({ name: 'Latte', price: 12000, active: true }),
      JSON.stringify({ name: 'Latte', price: 13500, active: true }),
    )
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({ field: 'price', before: '12000', after: '13500', money: true })
  })

  test('handles a record being created, with nothing before it', () => {
    const changes = diff(null, JSON.stringify({ name: 'Cortado' }))
    expect(changes).toEqual([{ field: 'name', before: null, after: 'Cortado', money: false }])
  })

  test('handles a record being removed, with nothing after it', () => {
    const changes = diff(JSON.stringify({ name: 'Cortado' }), null)
    expect(changes).toEqual([{ field: 'name', before: 'Cortado', after: null, money: false }])
  })

  test('notices a field appearing and a field disappearing', () => {
    const changes = diff(JSON.stringify({ a: 1, b: 2 }), JSON.stringify({ a: 1, c: 3 }))
    expect(changes.map((change) => change.field)).toEqual(['b', 'c'])
  })

  test('survives a payload that is not JSON at all', () => {
    expect(() => diff('not json', 'still not json')).not.toThrow()
    expect(diff(null, null)).toEqual([])
  })

  test('marks amounts as money, and leaves anything else alone', () => {
    const [total] = diff(null, JSON.stringify({ total: 539214 }))
    expect(total?.money).toBe(true)

    // costRate is micro-minor units, so treating it as money would be wrong
    // by a factor of a million.
    const [rate] = diff(null, JSON.stringify({ costRate: 427000 }))
    expect(rate?.money).toBe(false)

    // A money-named field holding something that is not a number is left raw.
    const [odd] = diff(null, JSON.stringify({ total: 'unknown' }))
    expect(odd?.money).toBe(false)
  })

  test('compares nested values without claiming a change that did not happen', () => {
    const same = JSON.stringify({ tax: { rate: 12, enabled: true } })
    expect(diff(same, same)).toEqual([])
  })
})

describe('searching', () => {
  test('returns newest first', async () => {
    await log({ action: 'PRICE_CHANGED', at: NOW - 2 * DAY })
    await log({ action: 'SALE_VOIDED', at: NOW })
    const page = await searchAuditLog(query())
    expect(page.entries[0]?.log.action).toBe('SALE_VOIDED')
  })

  test('keeps to the period asked for', async () => {
    await log({ action: 'PRICE_CHANGED', at: NOW - 10 * DAY })
    await log({ action: 'SALE_VOIDED', at: NOW })

    const page = await searchAuditLog(query({ from: NOW - DAY, to: NOW + DAY }))
    expect(page.total).toBe(1)
    expect(page.entries[0]?.log.action).toBe('SALE_VOIDED')
  })

  test('filters to one person', async () => {
    await log({ action: 'SALE_VOIDED', userId: USER.id })
    await log({ action: 'SALE_VOIDED', userId: BEN.id })

    const page = await searchAuditLog(query({ userId: BEN.id }))
    expect(page.total).toBe(1)
    expect(page.entries[0]?.userName).toBe('Ben')
  })

  test('filters to a set of actions', async () => {
    await log({ action: 'SALE_VOIDED' })
    await log({ action: 'PRICE_CHANGED' })
    await log({ action: 'STOCK_WASTAGE' })

    const page = await searchAuditLog(query({ actions: ['SALE_VOIDED', 'STOCK_WASTAGE'] }))
    expect(page.total).toBe(2)
  })

  test('searches the reason, the wording and the payloads', async () => {
    await log({ action: 'SALE_VOIDED', reason: 'Wrong milk poured' })
    await log({ action: 'PRICE_CHANGED', after: JSON.stringify({ price: 15000 }) })

    expect((await searchAuditLog(query({ text: 'wrong milk' }))).total).toBe(1)
    expect((await searchAuditLog(query({ text: '15000' }))).total).toBe(1)
    // The plain wording is searchable too, not just the raw action.
    expect((await searchAuditLog(query({ text: 'voided' }))).total).toBe(1)
  })

  test('names the person, and says so plainly when it cannot', async () => {
    await log({ action: 'SALE_VOIDED', userId: 'U-GONE' })
    const page = await searchAuditLog(query())
    expect(page.entries[0]?.userName).toBe('Unknown')
  })

  test('caps the page but reports the true total', async () => {
    for (let index = 0; index < 12; index++) {
      await log({ action: 'SALE_COMPLETED', at: NOW - index })
    }
    const page = await searchAuditLog(query({ limit: 5 }))
    expect(page.entries).toHaveLength(5)
    expect(page.total).toBe(12)
    expect(page.hasMore).toBe(true)
  })

  test('works out the changes for each entry it returns', async () => {
    await log({
      action: 'PRICE_CHANGED',
      before: JSON.stringify({ price: 10000 }),
      after: JSON.stringify({ price: 12000 }),
    })
    const page = await searchAuditLog(query())
    expect(page.entries[0]?.changes).toEqual([{ field: 'price', before: '10000', after: '12000', money: true }])
  })
})

describe('building the filters from the data', () => {
  test('lists the actions and record types that actually occur', async () => {
    await log({ action: 'SALE_VOIDED', entityType: 'sales' })
    await log({ action: 'PRICE_CHANGED', entityType: 'productVariants' })
    await log({ action: 'SALE_VOIDED', entityType: 'sales' })

    const facets = await auditFacets()
    expect(facets.actions).toEqual(['PRICE_CHANGED', 'SALE_VOIDED'])
    expect(facets.entityTypes).toEqual(['productVariants', 'sales'])
  })
})

describe('exporting', () => {
  test('quotes a reason containing a comma so the columns do not shift', async () => {
    await log({ action: 'SALE_VOIDED', reason: 'Wrong size, wrong milk' })
    const page = await searchAuditLog(query())
    const csv = auditToCsv(page.entries)

    expect(csv.split('\n')[0]).toBe('When,Who,What,Record,Reference,Reason')
    expect(csv).toContain('"Wrong size, wrong milk"')
  })

  test('escapes a quote inside a reason', async () => {
    await log({ action: 'SALE_VOIDED', reason: 'Customer said "too hot"' })
    const csv = auditToCsv((await searchAuditLog(query())).entries)
    expect(csv).toContain('""too hot""')
  })
})
