import type { PaperWidth } from './escpos.ts'
import type { Money } from './money.ts'

/** How a till reaches its receipt printer. */
export type PrintRoute = 'BLUETOOTH' | 'USB' | 'BROWSER'
import type { Dimension, Unit } from './units.ts'
import type { PermissionOverrides, Role } from './rbac.ts'

/**
 * Sync metadata carried by every synchronised record.
 *
 * `version` increments on each local edit and is what the server compares to
 * detect a genuine concurrent change. `deletedAt` gives us tombstones - a
 * record deleted on one device must be able to travel to another, which a
 * hard delete cannot do.
 */
export interface SyncMeta {
  id: string
  deviceId: string
  createdAt: number
  updatedAt: number
  version: number
  deletedAt: number | null
}

export type Entity<T> = SyncMeta & T

// ---------------------------------------------------------------- business --

export interface TaxSettings {
  enabled: boolean
  label: string
  /** Percentage, e.g. 12 for 12% VAT. */
  rate: number
  /** True when displayed menu prices already include the tax. */
  inclusive: boolean
}

export interface BrandingSettings {
  businessName: string
  legalName: string
  tagline: string
  logoDataUrl: string | null
  address: string
  contactNumber: string
  email: string
  socialLinks: string
  taxId: string
  receiptFooter: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  theme: 'light' | 'dark' | 'system'
}

export interface ReceiptSettings {
  prefix: string
  nextNumber: number
  padding: number
  /** Roll width in millimetres. Decides how many characters fit on a line. */
  paperWidth: PaperWidth
  /** How this till reaches a printer. */
  printRoute: PrintRoute
  /** Print as soon as a sale completes, rather than waiting to be asked. */
  autoPrint: boolean
  /** Kick the cash drawer open when a sale is settled in cash. */
  openDrawerOnCash: boolean
}

/**
 * A statutory concession, as the law where the shop trades defines it.
 *
 * The Philippine senior-citizen rule lifts VAT and then takes 20% off the
 * exempt base; another country may do neither. Holding the shape of the rule
 * rather than hard-coding one country's version means the shop sets it once,
 * and a change in the law is a change in a setting.
 */
export interface StatutoryRule {
  /** Stable key: SENIOR, PWD, or one the shop invented. */
  code: string
  label: string
  enabled: boolean
  /** Percentage off, applied to the base after any tax has been lifted. */
  rate: number
  /** Whether the concession also exempts the sale from tax. */
  liftsTax: boolean
  /** Whether an ID number has to be recorded against it. */
  requiresId: boolean
}

/**
 * Which parts of a receipt are printed, and in what order.
 *
 * Sections are named rather than numbered so a receipt saved by an older
 * version still means something, and anything this list has not heard of is
 * simply not printed.
 */
export type ReceiptSection =
  | 'LOGO'
  | 'BUSINESS'
  | 'ORDER_META'
  | 'QUEUE'
  | 'ITEMS'
  | 'TOTALS'
  | 'TAX_BREAKDOWN'
  | 'PAYMENTS'
  | 'SIGNATURE'
  | 'LOYALTY'
  | 'FOOTER'

/** The order they print in unless the shop rearranges them. */
export const RECEIPT_SECTIONS: ReceiptSection[] = [
  'LOGO',
  'BUSINESS',
  'ORDER_META',
  'QUEUE',
  'ITEMS',
  'TOTALS',
  'TAX_BREAKDOWN',
  'PAYMENTS',
  'SIGNATURE',
  'LOYALTY',
  'FOOTER',
]

/**
 * Sections that cannot be switched off.
 *
 * A receipt without the shop's name, what was bought, or what it came to is not
 * a receipt, and in the Philippines it is not a valid one either. The shop can
 * reorder these; it cannot remove them.
 */
export const REQUIRED_RECEIPT_SECTIONS: ReceiptSection[] = ['BUSINESS', 'ITEMS', 'TOTALS']

/**
 * The tax breakdown prints inside the totals block, where the arithmetic reads
 * in order; listing it here says whether it prints at all, not where.
 */
export const FIXED_POSITION_SECTIONS: ReceiptSection[] = ['TAX_BREAKDOWN', 'SIGNATURE']

/**
 * When to say an ingredient is running low.
 *
 * FIXED uses the number set on the ingredient itself. USAGE works it out from
 * what the shop has actually been getting through, so a threshold does not go
 * stale the moment trade picks up - which is the whole point of a shop that
 * does not need maintaining.
 */
export type LowStockBasis = 'FIXED' | 'USAGE' | 'EITHER'

export interface LowStockSettings {
  enabled: boolean
  basis: LowStockBasis
  /** Warn when less than this many days of stock remain, for USAGE. */
  daysOfCover: number
  /** How many days back to measure the usual rate of use over. */
  lookbackDays: number
}

/**
 * The shop's loyalty offer.
 *
 * This is the policy, not a ledger: the till does not know who a customer is,
 * so it cannot count their cups for them. What it does is state the offer, and
 * show the barista what to give away when a card is presented.
 */
export interface LoyaltySettings {
  enabled: boolean
  /** e.g. 9 - buy nine, the tenth is free. */
  cupsPerReward: number
  rewardLabel: string
  /** Printed at the foot of a receipt so the customer knows where they stand. */
  printOnReceipt: boolean
}

export interface QueueSettings {
  prefix: string
  padding: number
  resetDaily: boolean
  start: number
}

export interface BusinessSettings extends SyncMeta {
  branding: BrandingSettings
  tax: TaxSettings
  receipt: ReceiptSettings
  queue: QueueSettings
  currencyCode: string
  currencySymbol: string
  locale: string
  /** Senior-citizen / PWD statutory discount rate, as a percentage. */
  statutoryDiscountRate: number
  /** The concessions the law requires, as this shop's law defines them. */
  statutoryRules: StatutoryRule[]
  /** Which parts of a receipt print, in the order they print. */
  receiptSections: ReceiptSection[]
  lowStock: LowStockSettings
  loyalty: LoyaltySettings
  lowStockWarningEnabled: boolean
  blockSaleWhenOutOfStock: boolean
  /**
   * Whether the till may record orders for a day other than today.
   *
   * Off by default on a shop that does not need it: backdating rewrites the
   * books, and a control nobody uses is a control nobody is watching.
   */
  /**
   * Whether labour lines count toward what a drink costs.
   *
   * Off by default: most shops price against ingredients and packaging, and a
   * cost that appears without being asked for makes every margin look wrong.
   */
  includeLabourInCost: boolean
  backdatingEnabled: boolean
  /**
   * Payment methods that will not be accepted without a reference number.
   *
   * A GCash payment with no reference cannot be matched against the wallet
   * statement at the end of the day, which is exactly when it matters.
   */
  requireReferenceFor: PaymentMethod[]
  /**
   * Optional second lock on the sales planner, over and above the role that
   * gets someone to the screen. Hashed like a PIN, so it is never stored or
   * transmitted in readable form.
   */
  plannerPasscodeHash: string | null
  /**
   * Which figures the reports dashboard shows, keyed by tile.
   *
   * Only what the shop has actually decided is stored here; a tile with no
   * entry falls back to its own default. That way a tile added in a later
   * version appears on its merits rather than being invisible because an old
   * settings row had never heard of it.
   */
  dashboardTiles: Record<string, boolean>
}

// -------------------------------------------------------------------- staff --

export interface User extends SyncMeta {
  name: string
  role: Role
  pinHash: string
  active: boolean
  employeeCode: string
  failedAttempts: number
  lockedUntil: number | null
  /**
   * Per-person adjustments to what the role allows.
   *
   * Only the differences are stored, so a permission nobody has decided on
   * still follows the role - and changing what a role means still moves
   * everyone who has not been given an explicit answer of their own.
   */
  permissionOverrides: PermissionOverrides
}

export type DeviceType = 'TABLET' | 'PHONE' | 'DESKTOP' | 'WEB'

export interface Device extends SyncMeta {
  label: string
  type: DeviceType
  active: boolean
  lastSeenAt: number | null
  lastSyncAt: number | null
  activeUserId: string | null
  appVersion: string
}

// ----------------------------------------------------------------- catalogue --

/**
 * What a category is counted in.
 *
 * A coffee shop counts its day in cups, but a pastry is not a cup. Keeping
 * this on the category rather than the product means a new drink is counted
 * correctly the moment it is filed, with nobody having to remember.
 */
export type ServingUnit = 'CUP' | 'PIECE'

export interface Category extends SyncMeta {
  name: string
  /** Counted as a cup, or as a piece. Older rows have none and count as cups. */
  servingUnit?: ServingUnit
  colour: string
  icon: string
  sortOrder: number
  active: boolean
}

export interface Product extends SyncMeta {
  categoryId: string
  name: string
  description: string
  sku: string
  imageDataUrl: string | null
  active: boolean
  /** Manually marked unavailable, independent of stock. */
  available: boolean
  sortOrder: number
  taxable: boolean
  modifierGroupIds: string[]
}

/**
 * A sellable size of a product. Price and recipe both hang off the variant,
 * because a 16oz latte is a different drink to a 12oz one in both respects.
 */
export interface ProductVariant extends SyncMeta {
  productId: string
  name: string
  price: Money
  sortOrder: number
  active: boolean
  isDefault: boolean
}

export type ModifierSelection = 'SINGLE' | 'MULTI'

export interface ModifierGroup extends SyncMeta {
  name: string
  selection: ModifierSelection
  required: boolean
  minSelections: number
  maxSelections: number
  sortOrder: number
  active: boolean
}

export interface IngredientUsage {
  ingredientId: string
  baseQuantity: number
}

export interface ModifierOption extends SyncMeta {
  groupId: string
  name: string
  priceDelta: Money
  sortOrder: number
  active: boolean
  isDefault: boolean
  /** Ingredients consumed when this option is chosen, in base units. */
  consumption: IngredientUsage[]
}

// ----------------------------------------------------------------- inventory --

/**
 * What kind of cost a line on a recipe is.
 *
 * LABOUR is not a thing on a shelf: it costs money per drink but there is
 * nothing to count, so it is never stocked and can be left out of the cost
 * entirely from Settings. Keeping it in the same list as the rest means a
 * recipe can carry it without a second mechanism.
 */
export type StockClass = 'INGREDIENT' | 'PACKAGING' | 'RETAIL' | 'LABOUR'

export interface Ingredient extends SyncMeta {
  name: string
  sku: string
  stockClass: StockClass
  dimension: Dimension
  /** Unit the operator prefers to see and count in. */
  displayUnit: Unit
  /** Micro-minor units per base unit. See units.costRateFromPurchase. */
  costRate: number
  supplierId: string | null
  lowStockThresholdBase: number
  trackStock: boolean
  active: boolean
}

export interface Supplier extends SyncMeta {
  name: string
  contactName: string
  contactNumber: string
  email: string
  notes: string
  active: boolean
}

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE',
  'SALE',
  'VOID_RETURN',
  'REFUND_RETURN',
  'WASTAGE',
  'SPOILAGE',
  'DAMAGE',
  'MANUAL_ADJUSTMENT',
  'STOCK_COUNT',
  'TRANSFER',
  'CORRECTION',
] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

/**
 * The inventory ledger. Stock on hand is the sum of these rows, never a
 * mutable number - which is exactly what makes two devices selling offline
 * from the same stock reconcile correctly when they reconnect.
 */
export interface InventoryMovement extends SyncMeta {
  ingredientId: string
  type: MovementType
  /** Signed, in base units: negative consumes, positive replenishes. */
  baseQuantity: number
  costRate: number
  reason: string
  referenceType: 'SALE' | 'PURCHASE' | 'ADJUSTMENT' | 'COUNT' | 'SHIFT' | null
  referenceId: string | null
  shiftId: string | null
  userId: string
  occurredAt: number
}

/** Cached projection of the ledger, rebuildable at any time from movements. */
export interface StockLevel {
  ingredientId: string
  onHandBase: number
  movementCount: number
  updatedAt: number
}

// ------------------------------------------------------------------ recipes --

export interface Recipe extends SyncMeta {
  variantId: string
  productId: string
  yieldQuantity: number
  notes: string
  active: boolean
}

export interface RecipeIngredient extends SyncMeta {
  recipeId: string
  ingredientId: string
  baseQuantity: number
  optional: boolean
  sortOrder: number
}

// -------------------------------------------------------------------- sales --

export type SaleEntryMode = 'ITEMISED' | 'LUMP_SUM'

export type SaleStatus = 'COMPLETED' | 'VOIDED' | 'REFUNDED' | 'PARTIALLY_REFUNDED'
/**
 * How the order is being taken.
 *
 * A code from the shop's own list rather than a fixed union: a sale stores the
 * code, and what it is called is looked up. The three below are what a new shop
 * starts with, not the only ones there can be.
 */
export type OrderType = string

export const BUILT_IN_ORDER_TYPES = ['DINE_IN', 'TAKE_OUT', 'DELIVERY'] as const

export interface Sale extends SyncMeta {
  receiptNo: string
  queueNo: string
  shiftId: string
  userId: string
  status: SaleStatus
  /**
   * ITEMISED is an ordinary order rung up line by line. LUMP_SUM is a day's
   * takings entered after the fact, from before this system was in use: it has
   * no lines, consumes no stock, and its cost of goods is unknown rather than
   * zero - so it is kept out of margin entirely instead of flattering it.
   */
  entryMode: SaleEntryMode
  orderType: OrderType
  subtotal: Money
  discountTotal: Money
  taxTotal: Money
  /** Amount of tax waived under a statutory exemption. */
  taxExemptTotal: Money
  total: Money
  cogsTotal: Money
  /** Everything sold on this sale, cups and pieces together. */
  itemCount: number
  /** Drinks, counted in cups. */
  cupCount?: number
  /** Everything counted by the piece - pastries, snacks, retail bags. */
  snackCount?: number
  customerName: string
  note: string
  occurredAt: number
  voidedAt: number | null
  voidedBy: string | null
  voidReason: string
  /**
   * Set on a refund, pointing at the sale being refunded.
   *
   * A refund is recorded as its own sale with negative amounts rather than by
   * editing the original. The original stays exactly as it was rung up, and
   * every report that sums sales nets the two out without special handling.
   */
  refundOfSaleId: string | null
  /** How much of this sale has been refunded so far. */
  refundedTotal: Money
}

export interface SaleItemModifier {
  groupId: string
  groupName: string
  optionId: string
  optionName: string
  priceDelta: Money
}

export interface SaleItem extends SyncMeta {
  saleId: string
  productId: string
  variantId: string
  /** Names are snapshotted so a historical receipt never changes. */
  productName: string
  variantName: string
  categoryName: string
  quantity: number
  unitPrice: Money
  modifiers: SaleItemModifier[]
  modifiersTotal: Money
  lineSubtotal: Money
  lineDiscount: Money
  lineTotal: Money
  /** Cost of goods at the moment of sale, frozen for historical accuracy. */
  lineCogs: Money
  note: string
  sortOrder: number
}

export const DISCOUNT_TYPES = ['SENIOR', 'PWD', 'PERCENT', 'FIXED', 'PROMO', 'EMPLOYEE', 'LOYALTY'] as const
export type DiscountType = (typeof DISCOUNT_TYPES)[number]

export interface SaleDiscount extends SyncMeta {
  saleId: string
  type: DiscountType
  label: string
  /** Percentage for rate-based types, minor units for fixed. */
  value: number
  amount: Money
  /** Statutory discounts also lift the tax on the discounted portion. */
  taxExempt: boolean
  /** Senior citizen or PWD identification number, when required by law. */
  referenceNo: string
  beneficiaryName: string
  authorizedBy: string | null
  reason: string
}

export const PAYMENT_METHODS = ['CASH', 'GCASH', 'MAYA', 'CARD', 'LOYALTY'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * We are explicit about what we actually know. A GCash payment taken while
 * offline is recorded, not verified, and the receipt and reports say so.
 */
export type PaymentVerification = 'NOT_REQUIRED' | 'RECORDED_LOCALLY' | 'EXTERNALLY_VERIFIED'

export interface Payment extends SyncMeta {
  saleId: string
  method: PaymentMethod
  amount: Money
  tendered: Money
  change: Money
  reference: string
  verification: PaymentVerification
  verifiedAt: number | null
}

// ------------------------------------------------------------------- shifts --

export type ShiftStatus = 'OPEN' | 'CLOSED'

export interface Shift extends SyncMeta {
  code: string
  status: ShiftStatus
  openedBy: string
  openedAt: number
  closedBy: string | null
  closedAt: number | null
  openingFloat: Money
  countedCash: Money | null
  expectedCash: Money | null
  variance: Money | null
  varianceReason: string
  note: string
}

export type CashMovementType = 'PETTY_CASH' | 'CASH_DROP' | 'PAY_IN' | 'PAY_OUT'

export interface CashMovement extends SyncMeta {
  shiftId: string
  type: CashMovementType
  amount: Money
  reason: string
  userId: string
  occurredAt: number
}

export interface RegisterReading extends SyncMeta {
  shiftId: string
  type: 'X' | 'Z'
  sequence: number
  createdBy: string
  payload: string
}

// ---------------------------------------------------------------- planning --

/**
 * A share of the target set aside for one purpose.
 *
 * Held as a percentage rather than an amount so the plan still means something
 * when the target changes - moving the target moves every set-aside with it.
 */
export interface FundAllocation {
  id: string
  label: string
  percent: number
}

/**
 * A sales target and what the money is earmarked for.
 *
 * One per period, so last month's plan is still there to be compared against
 * rather than overwritten by this month's.
 */
export interface SalesTarget extends SyncMeta {
  /** The month this plans for, as YYYY-MM. */
  periodKey: string
  targetSales: Money
  allocations: FundAllocation[]
  note: string
}

// ----------------------------------------------------------- running costs --

export const EXPENSE_CATEGORIES = [
  'PAYROLL',
  'RENT',
  'UTILITIES',
  'SUPPLIES',
  'MAINTENANCE',
  'TRANSPORT',
  'MARKETING',
  'FEES',
  'OTHER',
] as const
/**
 * A code from the shop own list of expense categories.
 *
 * The nine below are what a new shop starts with. An expense stores the code,
 * and what it is called is looked up, so renaming one renames it on the books
 * as well as on the screen.
 */
export type ExpenseCategory = string

export type BuiltInExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/**
 * What it costs to keep the doors open, beyond the cost of the drinks.
 *
 * Kept separate from inventory because these never touch stock: rent is not an
 * ingredient. Recording them is what turns gross profit - which flatters every
 * coffee shop - into the number the owner actually takes home.
 */
export interface OperatingExpense extends SyncMeta {
  category: ExpenseCategory
  label: string
  amount: Money
  /**
   * FIXED is overhead that arrives whether or not anyone buys a coffee.
   * VARIABLE moves with how busy the shop is.
   */
  kind: 'FIXED' | 'VARIABLE'
  /** Set when this is pay for one particular person. */
  staffId: string | null
  note: string
  occurredAt: number
  userId: string
}

// -------------------------------------------------------------------- audit --

export interface AuditLog extends SyncMeta {
  entityType: string
  entityId: string
  action: string
  userId: string
  before: string | null
  after: string | null
  reason: string
  occurredAt: number
}

/**
 * What a shop gets before it has said otherwise.
 *
 * Read through these rather than off the settings row directly, so a row
 * written by an older version - which has never heard of the field - behaves
 * like a new one rather than like a shop that turned everything off.
 */
export const DEFAULT_STATUTORY_RULES: StatutoryRule[] = [
  { code: 'SENIOR', label: 'Senior citizen', enabled: true, rate: 20, liftsTax: true, requiresId: true },
  { code: 'PWD', label: 'PWD', enabled: true, rate: 20, liftsTax: true, requiresId: true },
]

export const DEFAULT_LOW_STOCK: LowStockSettings = {
  enabled: true,
  basis: 'FIXED',
  daysOfCover: 3,
  lookbackDays: 14,
}

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  cupsPerReward: 10,
  rewardLabel: 'a free drink',
  printOnReceipt: false,
}

export function statutoryRulesOf(settings: {
  statutoryRules?: StatutoryRule[]
  statutoryDiscountRate?: number
}): StatutoryRule[] {
  if (settings.statutoryRules && settings.statutoryRules.length > 0) return settings.statutoryRules
  // A shop that predates the rules list keeps the rate it was already using.
  const rate = settings.statutoryDiscountRate ?? 20
  return DEFAULT_STATUTORY_RULES.map((rule) => ({ ...rule, rate }))
}

export function receiptSectionsOf(settings: { receiptSections?: ReceiptSection[] }): ReceiptSection[] {
  const chosen = settings.receiptSections
  if (!chosen || chosen.length === 0) return RECEIPT_SECTIONS
  // Anything the running version does not recognise is dropped rather than
  // trusted, so a section removed in a later release cannot resurrect itself.
  const known = chosen.filter((section) => RECEIPT_SECTIONS.includes(section))
  // A required section that somehow went missing is put back rather than
  // silently dropped, so no stored setting can produce an invalid receipt.
  const missing = REQUIRED_RECEIPT_SECTIONS.filter((section) => !known.includes(section))
  return missing.length === 0 ? known : [...known, ...missing]
}

export function lowStockOf(settings: {
  lowStock?: LowStockSettings
  lowStockWarningEnabled?: boolean
}): LowStockSettings {
  if (settings.lowStock) return settings.lowStock
  return { ...DEFAULT_LOW_STOCK, enabled: settings.lowStockWarningEnabled !== false }
}

export function loyaltyOf(settings: { loyalty?: LoyaltySettings }): LoyaltySettings {
  return settings.loyalty ?? DEFAULT_LOYALTY
}

// ------------------------------------------------------------ what a shop --
// ------------------------------------------------------------ defines itself

/**
 * Lists the shop keeps rather than the code.
 *
 * Each row is addressed by a stable `code` and everything recorded against it -
 * a sale's order type, an expense's category, a payment's method - stores that
 * code and not the name. So renaming "Take out" to "Takeaway" renames it
 * everywhere including on the books, while deleting a row cannot orphan the
 * history that referred to it.
 *
 * Rows marked `builtIn` came with the system. They can be renamed, reordered
 * and switched off, but not deleted: sales taken years ago still point at them,
 * and a report that cannot name what something was is worse than a tidy list.
 */
export interface ShopListEntry extends SyncMeta {
  code: string
  name: string
  sortOrder: number
  active: boolean
  builtIn: boolean
}

/** What a payment behaves like, which is what the till needs to know. */
export type PaymentKind = 'CASH' | 'EWALLET' | 'CARD' | 'NON_CASH'

export interface PaymentMethodEntry extends ShopListEntry {
  /**
   * CASH takes tender and gives change and can kick the drawer. EWALLET and
   * CARD are settled elsewhere and carry a reference. NON_CASH is not money
   * coming in at all - a loyalty claim is the example.
   */
  kind: PaymentKind
  /** The sale will not go through without a reference number. */
  requiresReference: boolean
  /** Kick the cash drawer when a sale is settled this way. */
  opensDrawer: boolean
}

export interface ExpenseCategoryEntry extends ShopListEntry {
  /** FIXED arrives whether or not anyone buys a coffee; VARIABLE moves with trade. */
  kind: 'FIXED' | 'VARIABLE'
}

export type OrderTypeEntry = ShopListEntry

export interface RoleEntry extends ShopListEntry {
  permissions: string[]
}
