/**
 * Role-based access control.
 *
 * Permissions are checked in the UI to decide what to show, and again in the
 * data layer before a mutation is written. The server re-checks on sync, so a
 * tampered client cannot push a change it was not entitled to make.
 */

export const PERMISSIONS = [
  'pos.sell',
  'sales.view',
  'pos.void',
  'pos.refund',
  'pos.discount.standard',
  'pos.discount.override',
  'pos.availability.override',
  'pos.reprint',
  'pos.backdate',
  'shift.open',
  'shift.close',
  'shift.xreading',
  'shift.zreading',
  'cash.count',
  'cash.pettycash',
  'inventory.view',
  'inventory.adjust',
  'inventory.receive',
  'inventory.wastage',
  'recipe.view',
  'recipe.edit',
  'recipe.import',
  'product.view',
  'product.edit',
  'product.price',
  'report.view',
  'report.export',
  'planner.manage',
  'staff.view',
  'staff.edit',
  'settings.view',
  'settings.edit',
  'audit.view',
  'sync.view',
  'sync.manage',
  'device.manage',
  'backup.run',
  'backup.restore',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const ROLES = ['CASHIER', 'BARISTA', 'SUPERVISOR', 'MANAGER', 'OWNER'] as const
/**
 * A role code.
 *
 * The five below are what a shop starts with, not the only ones there can be:
 * a role is a row in the shop's own list, and a user stores its code. The
 * built-in permission sets here are the fallback for a till that has not yet
 * pulled that list, so nobody is locked out while it arrives.
 */
export type Role = string

export type BuiltInRole = (typeof ROLES)[number]

const CASHIER_PERMISSIONS: Permission[] = [
  'pos.sell',
  'sales.view',
  'pos.discount.standard',
  'pos.reprint',
  'shift.open',
  'shift.xreading',
  'inventory.view',
  'product.view',
]

const BARISTA_PERMISSIONS: Permission[] = [...CASHIER_PERMISSIONS, 'inventory.wastage']

const SUPERVISOR_PERMISSIONS: Permission[] = [
  ...BARISTA_PERMISSIONS,
  'pos.void',
  'pos.availability.override',
  'shift.close',
  'cash.count',
  'cash.pettycash',
  'inventory.adjust',
  'inventory.receive',
  'recipe.view',
  'report.view',
  'sync.view',
]

const MANAGER_PERMISSIONS: Permission[] = [
  ...SUPERVISOR_PERMISSIONS,
  'pos.refund',
  'pos.backdate',
  'pos.discount.override',
  'shift.zreading',
  'recipe.edit',
  'recipe.import',
  'product.edit',
  'product.price',
  'report.export',
  'planner.manage',
  'staff.view',
  'staff.edit',
  'settings.view',
  'audit.view',
  'sync.manage',
  'device.manage',
  'backup.run',
]

const ROLE_PERMISSIONS: Record<BuiltInRole, readonly Permission[]> = {
  CASHIER: CASHIER_PERMISSIONS,
  BARISTA: BARISTA_PERMISSIONS,
  SUPERVISOR: SUPERVISOR_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  OWNER: PERMISSIONS,
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role as BuiltInRole] ?? []
}

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false
  return permissionsForRole(role).includes(permission)
}

export function canAny(role: Role | undefined, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission))
}

/**
 * Per-person adjustments on top of a role.
 *
 * A role is the sensible starting point, not a straitjacket: one barista may be
 * trusted to take a refund, another on the same role may not. Only the
 * differences are stored, so changing what a role means still moves everyone
 * who has not been given an explicit answer of their own.
 */
export type PermissionOverrides = Partial<Record<Permission, boolean>>

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value)
}

/** What one person may actually do: their role, adjusted by their overrides. */
export function effectivePermissions(
  role: Role | undefined,
  overrides: PermissionOverrides | undefined,
  /** What the shop says this role may do. Omitted falls back to the built-in set. */
  rolePermissions?: readonly Permission[],
): Set<Permission> {
  const allowed = new Set<Permission>(role ? (rolePermissions ?? permissionsForRole(role)) : [])
  for (const [permission, granted] of Object.entries(overrides ?? {})) {
    if (!isPermission(permission)) continue
    if (granted) allowed.add(permission)
    else allowed.delete(permission)
  }
  return allowed
}

/**
 * Whether this person may do this.
 *
 * `rolePermissions` is what the shop's own role list says. It is optional so
 * that a till which has not yet read that list still lets people work off the
 * built-in sets rather than locking the shop out mid-shift - but a caller with
 * the list to hand should always pass it, because a permission the shop has
 * taken away should stop working the moment it does.
 */
export function userCan(
  role: Role | undefined,
  overrides: PermissionOverrides | undefined,
  permission: Permission,
  rolePermissions?: readonly Permission[],
): boolean {
  if (!role) return false
  const override = overrides?.[permission]
  if (override !== undefined) return override
  return (rolePermissions ?? permissionsForRole(role)).includes(permission)
}

/** How permissions are grouped when someone is choosing them. */
export const PERMISSION_GROUPS: Array<{ title: string; permissions: Permission[] }> = [
  {
    title: 'Till',
    permissions: [
      'pos.sell',
      'pos.discount.standard',
      'pos.discount.override',
      'pos.availability.override',
      'pos.reprint',
      'pos.void',
      'pos.refund',
      'pos.backdate',
    ],
  },
  { title: 'Sales history', permissions: ['sales.view'] },
  {
    title: 'Shifts and cash',
    permissions: [
      'shift.open',
      'shift.close',
      'shift.xreading',
      'shift.zreading',
      'cash.count',
      'cash.pettycash',
    ],
  },
  {
    title: 'Stock',
    permissions: ['inventory.view', 'inventory.receive', 'inventory.wastage', 'inventory.adjust'],
  },
  {
    title: 'Menu and recipes',
    permissions: ['product.view', 'product.edit', 'product.price', 'recipe.view', 'recipe.edit', 'recipe.import'],
  },
  { title: 'Reports', permissions: ['report.view', 'report.export'] },
  {
    title: 'People and setup',
    permissions: [
      'staff.view',
      'staff.edit',
      'settings.view',
      'settings.edit',
      'audit.view',
      'sync.view',
      'sync.manage',
      'device.manage',
      'backup.run',
      'backup.restore',
    ],
  },
]

/** Plain wording, so nobody has to decode a dotted key to grant something. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'pos.sell': 'Take orders and payment',
  'pos.void': 'Void a sale',
  'pos.refund': 'Give a refund',
  'pos.discount.standard': 'Apply senior and PWD discounts',
  'pos.discount.override': 'Apply any other discount',
  'pos.availability.override': 'Sell something that is out of stock',
  'pos.reprint': 'Reprint a receipt',
  'pos.backdate': "Record past days and backdated orders",
  'sales.view': 'Look up past sales',
  'shift.open': 'Open a shift',
  'shift.close': 'Close a shift',
  'shift.xreading': 'Run an X reading',
  'shift.zreading': 'Run a Z reading',
  'cash.count': 'Count the drawer',
  'cash.pettycash': 'Take petty cash out',
  'inventory.view': 'See stock levels',
  'inventory.adjust': 'Adjust stock and edit items',
  'inventory.receive': 'Record a delivery',
  'inventory.wastage': 'Record wastage',
  'recipe.view': 'See recipes and costs',
  'recipe.edit': 'Change recipes',
  'recipe.import': 'Import recipes from a file',
  'product.view': 'See the menu',
  'product.edit': 'Change the menu',
  'product.price': 'Change prices',
  'report.view': 'See reports',
  'report.export': 'Export reports and backfill takings',
  'planner.manage': 'See and change the sales target planner',
  'staff.view': 'See the staff list',
  'staff.edit': 'Add and edit staff',
  'settings.view': 'See settings',
  'settings.edit': 'Change settings',
  'audit.view': 'See the audit trail',
  'sync.view': 'See sync status',
  'sync.manage': 'Connect and manage sync',
  'device.manage': 'Manage devices',
  'backup.run': 'Make a backup',
  'backup.restore': 'Restore a backup',
}

export function roleLabel(role: Role | undefined): string {
  if (!role) return ''
  return ROLE_LABELS[role as BuiltInRole] ?? role
}

export const ROLE_LABELS: Record<BuiltInRole, string> = {
  CASHIER: 'Cashier',
  BARISTA: 'Barista',
  SUPERVISOR: 'Supervisor',
  MANAGER: 'Manager',
  OWNER: 'Owner',
}
