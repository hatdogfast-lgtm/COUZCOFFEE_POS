/**
 * The synchronisation contract shared by device and server.
 *
 * The model is an append-only change log. Devices push locally-created changes
 * as envelopes; the server assigns each accepted envelope a monotonic sequence
 * number and returns it. Devices pull everything after the last sequence they
 * have seen. That single cursor is all a device needs to catch up, whether it
 * was offline for ten seconds or ten days.
 */

/** Lifecycle of a local record with respect to the server. */
export const SYNC_STATUSES = [
  'LOCAL_ONLY',
  'SYNC_PENDING',
  'SYNCING',
  'SYNCED',
  'SYNC_FAILED',
  'CONFLICT',
] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

export type SyncOp = 'CREATE' | 'UPDATE' | 'DELETE'

/** Every table that participates in synchronisation. */
export const SYNC_ENTITIES = [
  'settings',
  'users',
  'devices',
  'categories',
  'products',
  'productVariants',
  'modifierGroups',
  'modifierOptions',
  'ingredients',
  'suppliers',
  'inventoryMovements',
  'recipes',
  'recipeIngredients',
  'sales',
  'saleItems',
  'saleDiscounts',
  'payments',
  'shifts',
  'cashMovements',
  'registerReadings',
  'operatingExpenses',
  'salesTargets',
  'paymentMethods',
  'expenseCategories',
  'orderTypes',
  'roles',
  'auditLogs',
] as const
export type SyncEntity = (typeof SYNC_ENTITIES)[number]

/**
 * How a concurrent edit to the same record is settled.
 *
 * APPEND_ONLY covers immutable facts - a completed sale, a stock movement, an
 * audit line. Two devices can never disagree about them, because neither one
 * edits what the other wrote; they simply both exist. This is what makes
 * offline multi-device inventory correct rather than merely hopeful.
 */
export type ConflictPolicy = 'APPEND_ONLY' | 'LAST_WRITE_WINS' | 'MANUAL_REVIEW'

export const CONFLICT_POLICIES: Record<SyncEntity, ConflictPolicy> = {
  settings: 'MANUAL_REVIEW',
  users: 'LAST_WRITE_WINS',
  devices: 'LAST_WRITE_WINS',
  categories: 'LAST_WRITE_WINS',
  products: 'LAST_WRITE_WINS',
  productVariants: 'MANUAL_REVIEW',
  modifierGroups: 'LAST_WRITE_WINS',
  modifierOptions: 'LAST_WRITE_WINS',
  ingredients: 'MANUAL_REVIEW',
  suppliers: 'LAST_WRITE_WINS',
  inventoryMovements: 'APPEND_ONLY',
  recipes: 'LAST_WRITE_WINS',
  recipeIngredients: 'LAST_WRITE_WINS',
  sales: 'APPEND_ONLY',
  saleItems: 'APPEND_ONLY',
  saleDiscounts: 'APPEND_ONLY',
  payments: 'APPEND_ONLY',
  shifts: 'LAST_WRITE_WINS',
  cashMovements: 'APPEND_ONLY',
  registerReadings: 'APPEND_ONLY',
  operatingExpenses: 'APPEND_ONLY',
  salesTargets: 'LAST_WRITE_WINS',
  // Configuration lists: the last person to change one meant it, the same
  // way settings and the menu behave.
  paymentMethods: 'LAST_WRITE_WINS',
  expenseCategories: 'LAST_WRITE_WINS',
  orderTypes: 'LAST_WRITE_WINS',
  roles: 'LAST_WRITE_WINS',
  auditLogs: 'APPEND_ONLY',
}

/** A single change, as it travels between device and server. */
export interface SyncEnvelope {
  entity: SyncEntity
  entityId: string
  op: SyncOp
  version: number
  deviceId: string
  updatedAt: number
  payload: unknown
}

/** A queued change awaiting upload. Never deleted on failure, only retried. */
export interface OutboxEntry {
  id: string
  entity: SyncEntity
  entityId: string
  op: SyncOp
  version: number
  payload: unknown
  status: SyncStatus
  attempts: number
  lastError: string | null
  createdAt: number
  lastAttemptAt: number | null
  /** Earliest time a retry may be made, for exponential backoff. */
  nextAttemptAt: number
}

export interface SyncConflictRecord {
  id: string
  entity: SyncEntity
  entityId: string
  localPayload: unknown
  serverPayload: unknown
  localVersion: number
  serverVersion: number
  detectedAt: number
  resolvedAt: number | null
  resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGED' | null
  resolvedBy: string | null
}

// ------------------------------------------------------------- wire format --

export interface PushRequest {
  deviceId: string
  entries: SyncEnvelope[]
}

export interface PushAccepted {
  entityId: string
  entity: SyncEntity
  seq: number
  serverUpdatedAt: number
}

export interface PushRejected {
  entityId: string
  entity: SyncEntity
  reason: 'CONFLICT' | 'FORBIDDEN' | 'INVALID' | 'UNKNOWN_ENTITY'
  message: string
  serverRecord: unknown | null
  serverVersion: number | null
}

export interface PushResponse {
  accepted: PushAccepted[]
  rejected: PushRejected[]
  serverSeq: number
  serverTime: number
}

export interface PullRequest {
  deviceId: string
  since: number
  limit: number
}

export interface PullChange {
  seq: number
  entity: SyncEntity
  entityId: string
  op: SyncOp
  version: number
  originDeviceId: string
  serverUpdatedAt: number
  payload: unknown
}

export interface PullResponse {
  changes: PullChange[]
  cursor: number
  hasMore: boolean
  serverTime: number
}

// ------------------------------------------------------------ realtime bus --

export const REALTIME_EVENTS = [
  'SALE_CREATED',
  'SALE_VOIDED',
  'REFUND_CREATED',
  'INVENTORY_CHANGED',
  'PRODUCT_UPDATED',
  'RECIPE_UPDATED',
  'PRICE_UPDATED',
  'STAFF_UPDATED',
  'SHIFT_STARTED',
  'SHIFT_ENDED',
  'X_READING_CREATED',
  'Z_READING_CREATED',
  'SETTINGS_UPDATED',
  'DEVICE_UPDATED',
  'SYNC_CURSOR_ADVANCED',
] as const
export type RealtimeEvent = (typeof REALTIME_EVENTS)[number]

export interface RealtimeMessage {
  type: RealtimeEvent
  /** Sequence the receiving device should pull up to. */
  seq: number
  /** Device that caused the change, so it can ignore its own echo. */
  originDeviceId: string
  entity: SyncEntity | null
  entityId: string | null
  at: number
}

export interface RealtimeHello {
  type: 'HELLO'
  deviceId: string
  token: string
  since: number
}

export type RealtimeInbound = RealtimeHello | { type: 'PING' }
export type RealtimeOutbound = RealtimeMessage | { type: 'PONG'; at: number } | { type: 'READY'; serverSeq: number }

// ------------------------------------------------------- connection status --

export const CONNECTION_STATES = ['OFFLINE', 'CONNECTING', 'ONLINE', 'SYNCING', 'SYNC_ERROR', 'CONFLICT'] as const
export type ConnectionState = (typeof CONNECTION_STATES)[number]

export interface SyncSnapshot {
  state: ConnectionState
  online: boolean
  realtimeConnected: boolean
  pendingCount: number
  failedCount: number
  conflictCount: number
  lastSyncAt: number | null
  lastError: string | null
  cursor: number
  serverSeq: number
}

/**
 * Plain-language wording for the status bar. The system never hides a
 * synchronisation problem behind a generic error code.
 */
export const CONNECTION_COPY: Record<ConnectionState, { label: string; detail: string; tone: string }> = {
  OFFLINE: {
    label: 'Offline',
    detail: 'Sales are being saved on this device and will sync automatically.',
    tone: 'offline',
  },
  CONNECTING: { label: 'Connecting', detail: 'Looking for the server.', tone: 'pending' },
  ONLINE: { label: 'Online', detail: 'Everything on this device is synced.', tone: 'online' },
  SYNCING: { label: 'Synchronising', detail: 'Sending saved records to the server.', tone: 'pending' },
  SYNC_ERROR: {
    label: 'Sync pending',
    detail: 'Records are safe on this device. Retrying automatically.',
    tone: 'warning',
  },
  CONFLICT: {
    label: 'Sync conflict',
    detail: 'A change needs review before it can be applied.',
    tone: 'danger',
  },
}

/** Exponential backoff with a ceiling, so a long outage never hammers the server. */
export function retryDelayMs(attempts: number): number {
  const base = 2_000
  const ceiling = 5 * 60_000
  return Math.min(ceiling, base * 2 ** Math.min(attempts, 10))
}
