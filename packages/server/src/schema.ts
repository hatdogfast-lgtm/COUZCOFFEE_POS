import type { SyncEntity } from '@pos/shared'

/**
 * The central database schema, declared once.
 *
 * Every synchronised entity gets a real relational table with typed columns,
 * so the server can answer reporting questions in SQL rather than by scanning
 * blobs. Declaring the tables as data instead of hand-writing twenty-one
 * CREATE statements is what keeps the server's shape and the client's shape
 * from drifting apart as the model grows.
 *
 * Genuinely nested values - a modifier list on a sale line, the branding
 * object in settings - are stored as JSON columns. That is a deliberate
 * choice: they are always read and written whole, and never queried by their
 * interior, so normalising them would buy nothing.
 */

export type ColumnType = 'TEXT' | 'INTEGER' | 'REAL' | 'BOOL' | 'JSON'

export interface TableSpec {
  entity: SyncEntity
  table: string
  columns: Record<string, ColumnType>
  indexes?: string[][]
}

/** Present on every synchronised record. */
export const BASE_COLUMNS: Record<string, ColumnType> = {
  id: 'TEXT',
  deviceId: 'TEXT',
  createdAt: 'INTEGER',
  updatedAt: 'INTEGER',
  version: 'INTEGER',
  deletedAt: 'INTEGER',
}

export const TABLES: TableSpec[] = [
  {
    entity: 'settings',
    table: 'settings',
    columns: {
      branding: 'JSON',
      tax: 'JSON',
      receipt: 'JSON',
      queue: 'JSON',
      currencyCode: 'TEXT',
      currencySymbol: 'TEXT',
      locale: 'TEXT',
      statutoryDiscountRate: 'REAL',
      lowStockWarningEnabled: 'BOOL',
      blockSaleWhenOutOfStock: 'BOOL',
      backdatingEnabled: 'BOOL',
      includeLabourInCost: 'BOOL',
      requireReferenceFor: 'JSON',
      plannerPasscodeHash: 'TEXT',
      dashboardTiles: 'JSON',
      statutoryRules: 'JSON',
      receiptSections: 'JSON',
      lowStock: 'JSON',
      loyalty: 'JSON',
    },
  },
  {
    entity: 'users',
    table: 'users',
    columns: {
      name: 'TEXT',
      role: 'TEXT',
      pinHash: 'TEXT',
      active: 'BOOL',
      employeeCode: 'TEXT',
      failedAttempts: 'INTEGER',
      lockedUntil: 'INTEGER',
      permissionOverrides: 'JSON',
    },
    indexes: [['role'], ['active']],
  },
  {
    entity: 'devices',
    table: 'devices',
    columns: {
      label: 'TEXT',
      type: 'TEXT',
      active: 'BOOL',
      lastSeenAt: 'INTEGER',
      lastSyncAt: 'INTEGER',
      activeUserId: 'TEXT',
      appVersion: 'TEXT',
    },
  },
  {
    entity: 'categories',
    table: 'categories',
    columns: {
      name: 'TEXT',
      colour: 'TEXT',
      icon: 'TEXT',
      servingUnit: 'TEXT',
      sortOrder: 'INTEGER',
      active: 'BOOL',
    },
    indexes: [['sortOrder']],
  },
  {
    entity: 'products',
    table: 'products',
    columns: {
      categoryId: 'TEXT',
      name: 'TEXT',
      description: 'TEXT',
      sku: 'TEXT',
      imageDataUrl: 'TEXT',
      active: 'BOOL',
      available: 'BOOL',
      sortOrder: 'INTEGER',
      taxable: 'BOOL',
      modifierGroupIds: 'JSON',
    },
    indexes: [['categoryId'], ['active']],
  },
  {
    entity: 'productVariants',
    table: 'product_variants',
    columns: {
      productId: 'TEXT',
      name: 'TEXT',
      price: 'INTEGER',
      sortOrder: 'INTEGER',
      active: 'BOOL',
      isDefault: 'BOOL',
    },
    indexes: [['productId']],
  },
  {
    entity: 'modifierGroups',
    table: 'modifier_groups',
    columns: {
      name: 'TEXT',
      selection: 'TEXT',
      required: 'BOOL',
      minSelections: 'INTEGER',
      maxSelections: 'INTEGER',
      sortOrder: 'INTEGER',
      active: 'BOOL',
    },
  },
  {
    entity: 'modifierOptions',
    table: 'modifier_options',
    columns: {
      groupId: 'TEXT',
      name: 'TEXT',
      priceDelta: 'INTEGER',
      sortOrder: 'INTEGER',
      active: 'BOOL',
      isDefault: 'BOOL',
      consumption: 'JSON',
    },
    indexes: [['groupId']],
  },
  {
    entity: 'ingredients',
    table: 'ingredients',
    columns: {
      name: 'TEXT',
      sku: 'TEXT',
      stockClass: 'TEXT',
      dimension: 'TEXT',
      displayUnit: 'TEXT',
      costRate: 'INTEGER',
      supplierId: 'TEXT',
      lowStockThresholdBase: 'REAL',
      trackStock: 'BOOL',
      active: 'BOOL',
    },
    indexes: [['stockClass'], ['active']],
  },
  {
    entity: 'suppliers',
    table: 'suppliers',
    columns: {
      name: 'TEXT',
      contactName: 'TEXT',
      contactNumber: 'TEXT',
      email: 'TEXT',
      notes: 'TEXT',
      active: 'BOOL',
    },
  },
  {
    entity: 'inventoryMovements',
    table: 'inventory_movements',
    columns: {
      ingredientId: 'TEXT',
      type: 'TEXT',
      baseQuantity: 'REAL',
      costRate: 'INTEGER',
      reason: 'TEXT',
      referenceType: 'TEXT',
      referenceId: 'TEXT',
      shiftId: 'TEXT',
      userId: 'TEXT',
      occurredAt: 'INTEGER',
    },
    indexes: [['ingredientId', 'occurredAt'], ['referenceId'], ['type'], ['shiftId']],
  },
  {
    entity: 'recipes',
    table: 'recipes',
    columns: {
      variantId: 'TEXT',
      productId: 'TEXT',
      yieldQuantity: 'REAL',
      notes: 'TEXT',
      active: 'BOOL',
    },
    indexes: [['variantId'], ['productId']],
  },
  {
    entity: 'recipeIngredients',
    table: 'recipe_ingredients',
    columns: {
      recipeId: 'TEXT',
      ingredientId: 'TEXT',
      baseQuantity: 'REAL',
      optional: 'BOOL',
      sortOrder: 'INTEGER',
    },
    indexes: [['recipeId'], ['ingredientId']],
  },
  {
    entity: 'sales',
    table: 'sales',
    columns: {
      receiptNo: 'TEXT',
      queueNo: 'TEXT',
      shiftId: 'TEXT',
      userId: 'TEXT',
      status: 'TEXT',
      entryMode: 'TEXT',
      orderType: 'TEXT',
      subtotal: 'INTEGER',
      discountTotal: 'INTEGER',
      taxTotal: 'INTEGER',
      taxExemptTotal: 'INTEGER',
      total: 'INTEGER',
      cogsTotal: 'INTEGER',
      itemCount: 'INTEGER',
      cupCount: 'INTEGER',
      snackCount: 'INTEGER',
      customerName: 'TEXT',
      note: 'TEXT',
      occurredAt: 'INTEGER',
      voidedAt: 'INTEGER',
      voidedBy: 'TEXT',
      voidReason: 'TEXT',
      refundOfSaleId: 'TEXT',
      refundedTotal: 'INTEGER',
    },
    indexes: [['occurredAt'], ['shiftId'], ['userId'], ['status'], ['receiptNo'], ['refundOfSaleId']],
  },
  {
    entity: 'saleItems',
    table: 'sale_items',
    columns: {
      saleId: 'TEXT',
      productId: 'TEXT',
      variantId: 'TEXT',
      productName: 'TEXT',
      variantName: 'TEXT',
      categoryName: 'TEXT',
      quantity: 'REAL',
      unitPrice: 'INTEGER',
      modifiers: 'JSON',
      modifiersTotal: 'INTEGER',
      lineSubtotal: 'INTEGER',
      lineDiscount: 'INTEGER',
      lineTotal: 'INTEGER',
      lineCogs: 'INTEGER',
      note: 'TEXT',
      sortOrder: 'INTEGER',
    },
    indexes: [['saleId'], ['productId'], ['variantId']],
  },
  {
    entity: 'saleDiscounts',
    table: 'sale_discounts',
    columns: {
      saleId: 'TEXT',
      type: 'TEXT',
      label: 'TEXT',
      value: 'REAL',
      amount: 'INTEGER',
      taxExempt: 'BOOL',
      referenceNo: 'TEXT',
      beneficiaryName: 'TEXT',
      authorizedBy: 'TEXT',
      reason: 'TEXT',
    },
    indexes: [['saleId'], ['type']],
  },
  {
    entity: 'payments',
    table: 'payments',
    columns: {
      saleId: 'TEXT',
      method: 'TEXT',
      amount: 'INTEGER',
      tendered: 'INTEGER',
      change: 'INTEGER',
      reference: 'TEXT',
      verification: 'TEXT',
      verifiedAt: 'INTEGER',
    },
    indexes: [['saleId'], ['method']],
  },
  {
    entity: 'shifts',
    table: 'shifts',
    columns: {
      code: 'TEXT',
      status: 'TEXT',
      openedBy: 'TEXT',
      openedAt: 'INTEGER',
      closedBy: 'TEXT',
      closedAt: 'INTEGER',
      openingFloat: 'INTEGER',
      countedCash: 'INTEGER',
      expectedCash: 'INTEGER',
      variance: 'INTEGER',
      varianceReason: 'TEXT',
      note: 'TEXT',
    },
    indexes: [['status'], ['openedAt']],
  },
  {
    entity: 'cashMovements',
    table: 'cash_movements',
    columns: {
      shiftId: 'TEXT',
      type: 'TEXT',
      amount: 'INTEGER',
      reason: 'TEXT',
      userId: 'TEXT',
      occurredAt: 'INTEGER',
    },
    indexes: [['shiftId']],
  },
  {
    entity: 'registerReadings',
    table: 'register_readings',
    columns: {
      shiftId: 'TEXT',
      type: 'TEXT',
      sequence: 'INTEGER',
      createdBy: 'TEXT',
      payload: 'TEXT',
    },
    indexes: [['shiftId'], ['type']],
  },
  {
    entity: 'operatingExpenses',
    table: 'operating_expenses',
    columns: {
      category: 'TEXT',
      label: 'TEXT',
      amount: 'INTEGER',
      kind: 'TEXT',
      staffId: 'TEXT',
      note: 'TEXT',
      occurredAt: 'INTEGER',
      userId: 'TEXT',
    },
    indexes: [['occurredAt'], ['category'], ['staffId']],
  },
  {
    entity: 'salesTargets',
    table: 'sales_targets',
    columns: {
      periodKey: 'TEXT',
      targetSales: 'INTEGER',
      allocations: 'JSON',
      note: 'TEXT',
    },
    indexes: [['periodKey']],
  },
  // The lists a shop defines for itself. Every one is addressed by a stable
  // code, which is what the records that refer to them actually store.
  {
    entity: 'paymentMethods',
    table: 'payment_methods',
    columns: {
      code: 'TEXT',
      name: 'TEXT',
      kind: 'TEXT',
      requiresReference: 'BOOL',
      opensDrawer: 'BOOL',
      sortOrder: 'INTEGER',
      active: 'BOOL',
      builtIn: 'BOOL',
    },
    indexes: [['code']],
  },
  {
    entity: 'expenseCategories',
    table: 'expense_categories',
    columns: {
      code: 'TEXT',
      name: 'TEXT',
      kind: 'TEXT',
      sortOrder: 'INTEGER',
      active: 'BOOL',
      builtIn: 'BOOL',
    },
    indexes: [['code']],
  },
  {
    entity: 'orderTypes',
    table: 'order_types',
    columns: {
      code: 'TEXT',
      name: 'TEXT',
      sortOrder: 'INTEGER',
      active: 'BOOL',
      builtIn: 'BOOL',
    },
    indexes: [['code']],
  },
  {
    entity: 'roles',
    table: 'roles',
    columns: {
      code: 'TEXT',
      name: 'TEXT',
      permissions: 'JSON',
      sortOrder: 'INTEGER',
      active: 'BOOL',
      builtIn: 'BOOL',
    },
    indexes: [['code']],
  },
  {
    entity: 'auditLogs',
    table: 'audit_logs',
    columns: {
      entityType: 'TEXT',
      entityId: 'TEXT',
      action: 'TEXT',
      userId: 'TEXT',
      before: 'TEXT',
      after: 'TEXT',
      reason: 'TEXT',
      occurredAt: 'INTEGER',
    },
    indexes: [['entityType', 'entityId'], ['occurredAt'], ['userId']],
  },
]

export const TABLE_BY_ENTITY = new Map<SyncEntity, TableSpec>(TABLES.map((spec) => [spec.entity, spec]))

/** camelCase field -> snake_case column, so SQL reads naturally. */
export function columnName(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function sqlType(type: ColumnType): string {
  switch (type) {
    case 'INTEGER':
    case 'BOOL':
      return 'INTEGER'
    case 'REAL':
      return 'REAL'
    default:
      return 'TEXT'
  }
}

export function allColumns(spec: TableSpec): Record<string, ColumnType> {
  return { ...BASE_COLUMNS, ...spec.columns }
}

export function createTableSql(spec: TableSpec): string {
  const columns = allColumns(spec)
  const definitions = Object.entries(columns).map(([field, type]) => {
    const name = columnName(field)
    if (field === 'id') return `"${name}" TEXT PRIMARY KEY`
    return `"${name}" ${sqlType(type)}`
  })
  return `CREATE TABLE IF NOT EXISTS "${spec.table}" (\n  ${definitions.join(',\n  ')}\n)`
}

/**
 * Indexes are created separately from the table.
 *
 * An index on a column added in a later version cannot be built until the
 * migration has added that column, so these run after it rather than as part
 * of the same statement list.
 */
export function createIndexSql(spec: TableSpec): string[] {
  const statements = (spec.indexes ?? []).map((index) => {
    const name = `idx_${spec.table}_${index.join('_')}`
    const cols = index.map((field) => `"${columnName(field)}"`).join(', ')
    return `CREATE INDEX IF NOT EXISTS "${name}" ON "${spec.table}" (${cols})`
  })
  // Every table is swept by updated_at during a pull.
  statements.push(
    `CREATE INDEX IF NOT EXISTS "idx_${spec.table}_updated_at" ON "${spec.table}" ("updated_at")`,
  )
  return statements
}

/** Infrastructure tables that are not themselves synchronised entities. */
export const INFRASTRUCTURE_SQL = [
  `CREATE TABLE IF NOT EXISTS "sync_log" (
     "seq" INTEGER PRIMARY KEY AUTOINCREMENT,
     "entity" TEXT NOT NULL,
     "entity_id" TEXT NOT NULL,
     "op" TEXT NOT NULL,
     "version" INTEGER NOT NULL,
     "origin_device_id" TEXT NOT NULL,
     "server_updated_at" INTEGER NOT NULL,
     "payload" TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "idx_sync_log_entity" ON "sync_log" ("entity", "entity_id")`,
  `CREATE TABLE IF NOT EXISTS "device_registry" (
     "device_id" TEXT PRIMARY KEY,
     "label" TEXT NOT NULL,
     "type" TEXT NOT NULL,
     "token_hash" TEXT NOT NULL,
     "active" INTEGER NOT NULL DEFAULT 1,
     "cursor" INTEGER NOT NULL DEFAULT 0,
     "created_at" INTEGER NOT NULL,
     "last_seen_at" INTEGER,
     "last_sync_at" INTEGER,
     "app_version" TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS "meta" (
     "key" TEXT PRIMARY KEY,
     "value" TEXT NOT NULL
   )`,
]
