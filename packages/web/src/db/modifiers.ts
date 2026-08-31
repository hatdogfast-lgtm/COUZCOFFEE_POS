import type { AuditLog, ModifierGroup, ModifierOption, ModifierSelection, Money } from '@pos/shared'
import { db } from './database.ts'
import { commit, created, deleted, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'

/**
 * The choices offered on a drink.
 *
 * A group is the question - "Milk", "Flavour", "Add-ons" - and its options are
 * the answers, each of which may cost extra and may consume stock of its own.
 *
 * Nothing here is built in: a shop invents the questions it wants to ask. What
 * the code fixes is only the shape of a question, not its content.
 */

const alive = <T extends { deletedAt: number | null }>(rows: T[]): T[] =>
  rows.filter((row) => row.deletedAt === null)

export interface GroupWithOptions {
  group: ModifierGroup
  options: ModifierOption[]
  /** How many products currently offer this group. */
  usedBy: number
}

export async function listModifierGroups(): Promise<GroupWithOptions[]> {
  const [groups, options, products] = await Promise.all([
    db.modifierGroups.toArray(),
    db.modifierOptions.toArray(),
    db.products.toArray(),
  ])

  const liveOptions = alive(options)
  const liveProducts = alive(products)

  return alive(groups)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => ({
      group,
      options: liveOptions
        .filter((option) => option.groupId === group.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
      usedBy: liveProducts.filter((product) => product.modifierGroupIds.includes(group.id)).length,
    }))
}

function audit(input: {
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
    stamp<AuditLog>(
      {
        entityType: 'modifierGroups',
        entityId: input.entityId,
        action: input.action,
        userId: input.userId,
        before: input.before === null ? null : JSON.stringify(input.before),
        after: input.after === null ? null : JSON.stringify(input.after),
        reason: input.reason,
        occurredAt: input.now,
      },
      input.now,
    ),
  )
}

export async function createModifierGroup(input: {
  name: string
  selection: ModifierSelection
  userId: string
}): Promise<ModifierGroup> {
  const name = input.name.trim()
  if (name.length === 0) throw new Error('Give the group a name.')

  const existing = await listModifierGroups()
  if (existing.some((entry) => entry.group.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error(`There is already a group called "${name}".`)
  }

  const now = Date.now()
  const group = stamp<ModifierGroup>(
    {
      name,
      selection: input.selection,
      required: false,
      minSelections: 0,
      // A single-choice question allows one answer; a multi-choice one starts
      // generous, because a shop that wants a limit will say so.
      maxSelections: input.selection === 'SINGLE' ? 1 : 5,
      sortOrder: existing.length,
      active: true,
    },
    now,
  )

  await commit(
    [
      created('modifierGroups', group),
      audit({
        entityId: group.id,
        action: 'MODIFIER_GROUP_CREATED',
        userId: input.userId,
        before: null,
        after: { name, selection: input.selection },
        reason: `Added the "${name}" group`,
        now,
      }),
    ],
    now,
  )
  return group
}

export async function updateModifierGroup(input: {
  group: ModifierGroup
  changes: Partial<Pick<ModifierGroup, 'name' | 'selection' | 'required' | 'minSelections' | 'maxSelections' | 'active'>>
  userId: string
}): Promise<ModifierGroup> {
  const now = Date.now()
  const changes = { ...input.changes }
  if (changes.name !== undefined) {
    changes.name = changes.name.trim()
    if (changes.name.length === 0) throw new Error('Give the group a name.')
  }
  // A single-choice question cannot accept two answers, whatever the number
  // says - the till would offer something the group forbids.
  if (changes.selection === 'SINGLE') changes.maxSelections = 1

  const revised = revise<ModifierGroup>(input.group, changes, now)

  await commit(
    [
      updated('modifierGroups', revised),
      audit({
        entityId: input.group.id,
        action: 'MODIFIER_GROUP_UPDATED',
        userId: input.userId,
        before: {
          name: input.group.name,
          selection: input.group.selection,
          required: input.group.required,
          active: input.group.active,
        },
        after: changes,
        reason: `Changed the "${revised.name}" group`,
        now,
      }),
    ],
    now,
  )
  return revised
}

/**
 * Remove a group.
 *
 * Tombstoned rather than erased, and its options with it, so the removal
 * travels to the other tills. Sales already taken keep their own snapshot of
 * what was chosen, so nothing on the books changes.
 */
export async function removeModifierGroup(input: {
  group: ModifierGroup
  userId: string
}): Promise<void> {
  const now = Date.now()
  const options = alive(await db.modifierOptions.where('groupId').equals(input.group.id).toArray())
  const products = alive(await db.products.toArray()).filter((product) =>
    product.modifierGroupIds.includes(input.group.id),
  )

  const writes: PendingWrite[] = [
    deleted('modifierGroups', revise<ModifierGroup>(input.group, { deletedAt: now } as never, now)),
    ...options.map((option) =>
      deleted('modifierOptions', revise<ModifierOption>(option, { deletedAt: now } as never, now)),
    ),
    // Detach it from anything offering it, or the till would look for a group
    // that is no longer there.
    ...products.map((product) =>
      updated(
        'products',
        revise(product, {
          modifierGroupIds: product.modifierGroupIds.filter((id) => id !== input.group.id),
        }, now),
      ),
    ),
    audit({
      entityId: input.group.id,
      action: 'MODIFIER_GROUP_REMOVED',
      userId: input.userId,
      before: { name: input.group.name, options: options.length, usedBy: products.length },
      after: null,
      reason: `Removed the "${input.group.name}" group`,
      now,
    }),
  ]

  await commit(writes, now)
}

export async function addModifierOption(input: {
  group: ModifierGroup
  name: string
  priceDelta: Money
  userId: string
}): Promise<ModifierOption> {
  const name = input.name.trim()
  if (name.length === 0) throw new Error('Give the option a name.')

  const siblings = alive(await db.modifierOptions.where('groupId').equals(input.group.id).toArray())
  if (siblings.some((entry) => entry.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error(`"${input.group.name}" already offers "${name}".`)
  }

  const now = Date.now()
  const option = stamp<ModifierOption>(
    {
      groupId: input.group.id,
      name,
      priceDelta: Math.round(input.priceDelta),
      sortOrder: siblings.length,
      active: true,
      // The first answer to a required question is the sensible default, so a
      // barista is not forced to choose on every single order.
      isDefault: siblings.length === 0 && input.group.required,
      consumption: [],
    },
    now,
  )

  await commit(
    [
      created('modifierOptions', option),
      audit({
        entityId: input.group.id,
        action: 'MODIFIER_OPTION_ADDED',
        userId: input.userId,
        before: null,
        after: { group: input.group.name, option: name, priceDelta: option.priceDelta },
        reason: `Added "${name}" to "${input.group.name}"`,
        now,
      }),
    ],
    now,
  )
  return option
}

export async function updateModifierOption(input: {
  option: ModifierOption
  changes: Partial<Pick<ModifierOption, 'name' | 'priceDelta' | 'active' | 'isDefault'>>
  userId: string
}): Promise<ModifierOption> {
  const now = Date.now()
  const changes = { ...input.changes }
  if (changes.name !== undefined) {
    changes.name = changes.name.trim()
    if (changes.name.length === 0) throw new Error('Give the option a name.')
  }
  if (changes.priceDelta !== undefined) changes.priceDelta = Math.round(changes.priceDelta)

  const writes: PendingWrite[] = []

  // Only one answer can be the default, so choosing a new one releases the old.
  if (changes.isDefault === true) {
    const siblings = alive(await db.modifierOptions.where('groupId').equals(input.option.groupId).toArray())
    for (const sibling of siblings) {
      if (sibling.id !== input.option.id && sibling.isDefault) {
        writes.push(updated('modifierOptions', revise(sibling, { isDefault: false }, now)))
      }
    }
  }

  const revised = revise<ModifierOption>(input.option, changes, now)
  writes.push(updated('modifierOptions', revised))
  writes.push(
    audit({
      entityId: input.option.groupId,
      action: 'MODIFIER_OPTION_UPDATED',
      userId: input.userId,
      before: { name: input.option.name, priceDelta: input.option.priceDelta, active: input.option.active },
      after: changes,
      reason: `Changed "${revised.name}"`,
      now,
    }),
  )

  await commit(writes, now)
  return revised
}

export async function removeModifierOption(input: {
  option: ModifierOption
  userId: string
}): Promise<void> {
  const now = Date.now()
  await commit(
    [
      deleted('modifierOptions', revise<ModifierOption>(input.option, { deletedAt: now } as never, now)),
      audit({
        entityId: input.option.groupId,
        action: 'MODIFIER_OPTION_REMOVED',
        userId: input.userId,
        before: { name: input.option.name, priceDelta: input.option.priceDelta },
        after: null,
        reason: `Removed "${input.option.name}"`,
        now,
      }),
    ],
    now,
  )
}
