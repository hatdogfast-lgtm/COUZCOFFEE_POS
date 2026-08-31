import {
  costOf,
  toBase,
  type AuditLog,
  type Ingredient,
  type InventoryMovement,
  type Money,
  type MovementType,
  type Unit,
} from '@pos/shared'
import { commit, created, revise, stamp, updated } from './write.ts'
import type { PendingWrite } from './write.ts'
import { stockOnHand } from './repo.ts'

/**
 * Stock operations.
 *
 * Every one of these appends to the movement ledger. Nothing here ever
 * overwrites a stock figure, because there is no stock figure to overwrite -
 * on hand is the sum of what this file has written.
 *
 * The types that represent a loss or a correction insist on a reason. An
 * adjustment nobody can explain is exactly the kind of thing an owner needs to
 * find later, and a blank reason makes that impossible.
 */

/** Movement types where an unexplained entry would be a hole in the books. */
const REASON_REQUIRED: ReadonlySet<MovementType> = new Set<MovementType>([
  'WASTAGE',
  'SPOILAGE',
  'DAMAGE',
  'MANUAL_ADJUSTMENT',
  'CORRECTION',
  'TRANSFER',
])

export function reasonRequiredFor(type: MovementType): boolean {
  return REASON_REQUIRED.has(type)
}

export interface MovementInput {
  ingredient: Ingredient
  type: MovementType
  /** Signed, in the supplied unit. Negative removes stock. */
  quantity: number
  unit: Unit
  reason: string
  userId: string
  shiftId?: string | null
  /** Overrides the ingredient's current rate, for a delivery at a new price. */
  costRate?: number
  occurredAt?: number
}

function auditFor(
  movement: InventoryMovement,
  ingredient: Ingredient,
  userId: string,
  now: number,
): PendingWrite {
  return created(
    'auditLogs',
    stamp<AuditLog>({
      entityType: 'inventoryMovements',
      entityId: movement.id,
      action: `STOCK_${movement.type}`,
      userId,
      before: null,
      after: JSON.stringify({
        ingredient: ingredient.name,
        baseQuantity: movement.baseQuantity,
        type: movement.type,
      }),
      reason: movement.reason,
      occurredAt: now,
    }),
  )
}

/**
 * Record one stock movement.
 *
 * The movement and its audit entry commit together, so the ledger can never
 * hold a change nobody can account for.
 */
export async function recordMovement(input: MovementInput): Promise<InventoryMovement> {
  if (reasonRequiredFor(input.type) && input.reason.trim().length === 0) {
    throw new Error('This kind of stock change needs a reason.')
  }
  if (!Number.isFinite(input.quantity) || input.quantity === 0) {
    throw new Error('Enter a quantity other than zero.')
  }

  const now = input.occurredAt ?? Date.now()
  const movement = stamp<InventoryMovement>({
    ingredientId: input.ingredient.id,
    type: input.type,
    baseQuantity: toBase(input.quantity, input.unit),
    costRate: input.costRate ?? input.ingredient.costRate,
    reason: input.reason.trim(),
    referenceType: input.type === 'PURCHASE' ? 'PURCHASE' : 'ADJUSTMENT',
    referenceId: null,
    shiftId: input.shiftId ?? null,
    userId: input.userId,
    occurredAt: now,
  })

  await commit(
    [created('inventoryMovements', movement), auditFor(movement, input.ingredient, input.userId, now)],
    now,
  )
  return movement
}

/**
 * Take in a delivery, and re-price the ingredient if it cost something
 * different this time.
 *
 * The new rate is a weighted average across what was already on the shelf and
 * what just arrived, rather than simply the latest price. Replacing the rate
 * outright would misstate the cost of the stock bought at the old price that
 * is still sitting there.
 */
export async function receiveStock(input: {
  ingredient: Ingredient
  quantity: number
  unit: Unit
  /** What this whole delivery cost. Omit to keep the existing rate. */
  totalCost?: Money
  reason: string
  userId: string
  shiftId?: string | null
}): Promise<{ movement: InventoryMovement; newCostRate: number }> {
  if (input.quantity <= 0) throw new Error('A delivery has to be more than zero.')

  const receivedBase = toBase(input.quantity, input.unit)
  let costRate = input.ingredient.costRate

  if (input.totalCost !== undefined && input.totalCost >= 0) {
    const deliveryRate = Math.round((input.totalCost * 1_000_000) / receivedBase)
    const onHandBefore = Math.max(0, await stockOnHand(input.ingredient.id))
    const totalAfter = onHandBefore + receivedBase
    costRate =
      totalAfter > 0
        ? Math.round((onHandBefore * input.ingredient.costRate + receivedBase * deliveryRate) / totalAfter)
        : deliveryRate
  }

  const now = Date.now()
  const movement = stamp<InventoryMovement>({
    ingredientId: input.ingredient.id,
    type: 'PURCHASE',
    baseQuantity: receivedBase,
    costRate,
    reason: input.reason.trim(),
    referenceType: 'PURCHASE',
    referenceId: null,
    shiftId: input.shiftId ?? null,
    userId: input.userId,
    occurredAt: now,
  })

  const writes: PendingWrite[] = [
    created('inventoryMovements', movement),
    auditFor(movement, input.ingredient, input.userId, now),
  ]

  if (costRate !== input.ingredient.costRate) {
    const repriced = revise(input.ingredient, { costRate }, now)
    writes.push(updated('ingredients', repriced))
    writes.push(
      created(
        'auditLogs',
        stamp<AuditLog>({
          entityType: 'ingredients',
          entityId: input.ingredient.id,
          action: 'COST_CHANGED',
          userId: input.userId,
          before: JSON.stringify({ costRate: input.ingredient.costRate }),
          after: JSON.stringify({ costRate }),
          reason: 'Re-priced by a delivery',
          occurredAt: now,
        }),
      ),
    )
  }

  await commit(writes, now)
  return { movement, newCostRate: costRate }
}

/**
 * Reconcile the ledger against a physical count.
 *
 * The difference is written as its own movement rather than by editing
 * history, so the discrepancy stays visible and the original entries remain
 * exactly as they were recorded.
 */
export async function recordStockCount(input: {
  ingredient: Ingredient
  countedQuantity: number
  unit: Unit
  reason: string
  userId: string
  shiftId?: string | null
}): Promise<{ movement: InventoryMovement | null; difference: number }> {
  const countedBase = toBase(input.countedQuantity, input.unit)
  const onHand = await stockOnHand(input.ingredient.id)
  const difference = countedBase - onHand

  if (difference === 0) return { movement: null, difference: 0 }

  const now = Date.now()
  const movement = stamp<InventoryMovement>({
    ingredientId: input.ingredient.id,
    type: 'STOCK_COUNT',
    baseQuantity: difference,
    costRate: input.ingredient.costRate,
    reason: input.reason.trim() || 'Physical count',
    referenceType: 'COUNT',
    referenceId: null,
    shiftId: input.shiftId ?? null,
    userId: input.userId,
    occurredAt: now,
  })

  await commit(
    [created('inventoryMovements', movement), auditFor(movement, input.ingredient, input.userId, now)],
    now,
  )
  return { movement, difference }
}

/** The money tied up in a movement, for wastage reporting. */
export function movementValue(movement: InventoryMovement): Money {
  return costOf(Math.abs(movement.baseQuantity), movement.costRate)
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  OPENING: 'Opening stock',
  PURCHASE: 'Delivery',
  SALE: 'Sold',
  VOID_RETURN: 'Returned from void',
  REFUND_RETURN: 'Returned from refund',
  WASTAGE: 'Wastage',
  SPOILAGE: 'Spoilage',
  DAMAGE: 'Damage',
  MANUAL_ADJUSTMENT: 'Adjustment',
  STOCK_COUNT: 'Stock count',
  TRANSFER: 'Transfer',
  CORRECTION: 'Correction',
}

/** The movement types a person can choose from the inventory screen. */
export const MANUAL_MOVEMENT_TYPES: MovementType[] = [
  'PURCHASE',
  'WASTAGE',
  'SPOILAGE',
  'DAMAGE',
  'MANUAL_ADJUSTMENT',
  'TRANSFER',
]
