import Dexie, { type Table } from 'dexie'
import type {
  AuditLog,
  BusinessSettings,
  CashMovement,
  Category,
  Device,
  Ingredient,
  InventoryMovement,
  ModifierGroup,
  ModifierOption,
  OperatingExpense,
  OutboxEntry,
  Payment,
  Product,
  ProductVariant,
  Recipe,
  RecipeIngredient,
  RegisterReading,
  Sale,
  SalesTarget,
  SaleDiscount,
  SaleItem,
  Shift,
  Supplier,
  SyncConflictRecord,
  SyncEntity,
  User,
} from '@pos/shared'
import { SYNC_ENTITIES } from '@pos/shared'
import type {
  ExpenseCategoryEntry,
  OrderTypeEntry,
  PaymentMethodEntry,
  RoleEntry,
} from '@pos/shared'

/**
 * The device's own database.
 *
 * This is not a cache of the server - it is the working database. A sale is
 * complete the moment it is committed here, and synchronisation is a separate
 * concern that happens afterwards. That ordering is the whole reason the till
 * keeps serving customers when the internet does not.
 *
 * Table names match the sync entity names exactly, so a change arriving from
 * the server can be applied without a translation layer that could drift.
 */

/** Rows that stay on this device and are never synchronised. */
export interface LocalMeta {
  key: string
  value: unknown
}

export class PosDatabase extends Dexie {
  settings!: Table<BusinessSettings, string>
  users!: Table<User, string>
  devices!: Table<Device, string>
  categories!: Table<Category, string>
  products!: Table<Product, string>
  productVariants!: Table<ProductVariant, string>
  modifierGroups!: Table<ModifierGroup, string>
  modifierOptions!: Table<ModifierOption, string>
  ingredients!: Table<Ingredient, string>
  suppliers!: Table<Supplier, string>
  inventoryMovements!: Table<InventoryMovement, string>
  recipes!: Table<Recipe, string>
  recipeIngredients!: Table<RecipeIngredient, string>
  sales!: Table<Sale, string>
  saleItems!: Table<SaleItem, string>
  saleDiscounts!: Table<SaleDiscount, string>
  payments!: Table<Payment, string>
  shifts!: Table<Shift, string>
  cashMovements!: Table<CashMovement, string>
  registerReadings!: Table<RegisterReading, string>
  operatingExpenses!: Table<OperatingExpense, string>
  salesTargets!: Table<SalesTarget, string>
  paymentMethods!: Table<PaymentMethodEntry, string>
  expenseCategories!: Table<ExpenseCategoryEntry, string>
  orderTypes!: Table<OrderTypeEntry, string>
  roles!: Table<RoleEntry, string>
  auditLogs!: Table<AuditLog, string>

  // Infrastructure, local to this device.
  outbox!: Table<OutboxEntry, string>
  conflicts!: Table<SyncConflictRecord, string>
  meta!: Table<LocalMeta, string>

  constructor() {
    super('pos')

    this.version(1).stores({
      settings: 'id, updatedAt',
      users: 'id, role, active, employeeCode, updatedAt',
      devices: 'id, active, updatedAt',
      categories: 'id, sortOrder, active, updatedAt',
      products: 'id, categoryId, active, available, sortOrder, updatedAt',
      productVariants: 'id, productId, active, updatedAt',
      modifierGroups: 'id, active, sortOrder, updatedAt',
      modifierOptions: 'id, groupId, active, updatedAt',
      ingredients: 'id, stockClass, active, name, updatedAt',
      suppliers: 'id, active, updatedAt',
      // Compound index: stock on hand is read per ingredient in date order.
      inventoryMovements: 'id, ingredientId, [ingredientId+occurredAt], referenceId, type, shiftId, occurredAt, updatedAt',
      recipes: 'id, variantId, productId, active, updatedAt',
      recipeIngredients: 'id, recipeId, ingredientId, updatedAt',
      sales: 'id, receiptNo, queueNo, shiftId, userId, status, occurredAt, updatedAt',
      saleItems: 'id, saleId, productId, variantId, updatedAt',
      saleDiscounts: 'id, saleId, type, updatedAt',
      payments: 'id, saleId, method, updatedAt',
      shifts: 'id, status, openedAt, updatedAt',
      cashMovements: 'id, shiftId, occurredAt, updatedAt',
      registerReadings: 'id, shiftId, type, updatedAt',
      auditLogs: 'id, entityType, entityId, userId, occurredAt, updatedAt',

      outbox: 'id, entity, entityId, status, createdAt, nextAttemptAt, [status+nextAttemptAt]',
      conflicts: 'id, entity, entityId, resolvedAt, detectedAt',
      meta: 'key',
    })

    /**
     * A new table needs its own version.
     *
     * Adding a store to an existing version does nothing on a database that was
     * already created at that version - the table would simply never exist on
     * any device that had run the app before. Declaring it as version 2 lets
     * Dexie upgrade those devices in place, leaving every other table alone.
     */
    this.version(2).stores({
      operatingExpenses: 'id, category, staffId, occurredAt, updatedAt',
    })

    this.version(3).stores({
      salesTargets: 'id, periodKey, updatedAt',
    })

    // The lists a shop defines for itself. Indexed by code because every
    // lookup is "what does this stored code mean".
    this.version(4).stores({
      paymentMethods: 'id, code, sortOrder, updatedAt',
      expenseCategories: 'id, code, sortOrder, updatedAt',
      orderTypes: 'id, code, sortOrder, updatedAt',
      roles: 'id, code, sortOrder, updatedAt',
    })
  }
}

export const db = new PosDatabase()

/** Every synchronised table, addressable by its entity name. */
export function tableFor(entity: SyncEntity): Table<{ id: string }, string> {
  return db.table(entity) as unknown as Table<{ id: string }, string>
}

// --------------------------------------------------------------- local meta --

export async function readMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export const META_KEYS = {
  deviceId: 'device.id',
  deviceLabel: 'device.label',
  deviceType: 'device.type',
  serverUrl: 'sync.serverUrl',
  serverToken: 'sync.token',
  cursor: 'sync.cursor',
  lastSyncAt: 'sync.lastSyncAt',
  seeded: 'app.seeded',
  activeShiftId: 'shift.activeId',
  queueCounter: 'queue.counter',
  queueDate: 'queue.date',
  receiptCounter: 'receipt.counter',
  migrationsApplied: 'migrations.applied',
} as const

/**
 * Wipe every synchronised table without touching this device's identity or
 * its server credentials. Used by Restore, which must never silently blend a
 * backup into whatever was already here.
 */
export async function clearBusinessData(): Promise<void> {
  // Derived from SYNC_ENTITIES rather than listed by hand: a hand-written list
  // silently goes stale the moment a table is added, and the table it forgets
  // is the one that survives a wipe it should not have survived.
  const tables = [...SYNC_ENTITIES.map((entity) => tableFor(entity)), db.outbox, db.conflicts]
  await db.transaction('rw', tables, async () => {
    for (const table of tables) await table.clear()
  })
}
