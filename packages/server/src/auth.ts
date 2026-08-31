import crypto from 'node:crypto'
import process from 'node:process'
import { db } from './db.ts'
import { config } from './config.ts'
import { HttpError } from './http.ts'

/**
 * Device enrolment and authentication.
 *
 * A terminal enrols once with a shared enrolment code and receives a
 * long-lived bearer token. Only the SHA-256 of that token is stored, so a copy
 * of the database does not hand an attacker working credentials. Every sync
 * request and every realtime socket is authenticated against it, and an owner
 * can revoke a lost terminal by deactivating it here.
 */

const enrolmentCode = process.env.POS_ENROLMENT_CODE ?? (config.isProduction ? '' : 'letmein')

if (config.isProduction && !enrolmentCode) {
  throw new Error('POS_ENROLMENT_CODE must be set in production so unknown devices cannot enrol.')
}

export interface DeviceRecord {
  deviceId: string
  label: string
  type: string
  active: boolean
  cursor: number
  createdAt: number
  lastSeenAt: number | null
  lastSyncAt: number | null
  appVersion: string
}

const insertDevice = db.prepare(
  `INSERT INTO "device_registry" ("device_id","label","type","token_hash","active","cursor","created_at","app_version")
   VALUES (?, ?, ?, ?, 1, 0, ?, ?)
   ON CONFLICT("device_id") DO UPDATE SET
     "label" = excluded."label",
     "type" = excluded."type",
     "token_hash" = excluded."token_hash",
     "app_version" = excluded."app_version",
     "active" = 1`,
)
const selectDevice = db.prepare(`SELECT * FROM "device_registry" WHERE "device_id" = ?`)
const selectAllDevices = db.prepare(`SELECT * FROM "device_registry" ORDER BY "created_at" ASC`)
const touchDevice = db.prepare(`UPDATE "device_registry" SET "last_seen_at" = ? WHERE "device_id" = ?`)
const advanceCursor = db.prepare(
  `UPDATE "device_registry" SET "cursor" = ?, "last_sync_at" = ? WHERE "device_id" = ?`,
)
const setActive = db.prepare(`UPDATE "device_registry" SET "active" = ? WHERE "device_id" = ?`)

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return crypto.timingSafeEqual(bufferA, bufferB)
}

function toRecord(row: Record<string, unknown>): DeviceRecord {
  return {
    deviceId: String(row['device_id']),
    label: String(row['label']),
    type: String(row['type']),
    active: row['active'] === 1,
    cursor: Number(row['cursor'] ?? 0),
    createdAt: Number(row['created_at'] ?? 0),
    lastSeenAt: row['last_seen_at'] === null ? null : Number(row['last_seen_at']),
    lastSyncAt: row['last_sync_at'] === null ? null : Number(row['last_sync_at']),
    appVersion: String(row['app_version'] ?? ''),
  }
}

export interface EnrolmentResult {
  deviceId: string
  token: string
  label: string
}

export function enrolDevice(input: {
  deviceId: string
  label: string
  type: string
  code: string
  appVersion?: string
}): EnrolmentResult {
  if (!constantTimeEquals(input.code ?? '', enrolmentCode)) {
    throw new HttpError(403, 'That enrolment code was not accepted. Check it in Settings on an authorised device.', 'BAD_ENROLMENT_CODE')
  }
  if (!input.deviceId || !input.label) {
    throw new HttpError(400, 'A device needs both an identifier and a name to enrol.', 'INVALID_DEVICE')
  }

  const token = crypto.randomBytes(32).toString('base64url')
  insertDevice.run(
    input.deviceId,
    input.label,
    input.type || 'WEB',
    hashToken(token),
    Date.now(),
    input.appVersion ?? '',
  )
  return { deviceId: input.deviceId, token, label: input.label }
}

/** Resolve a bearer token to a device, or refuse the request. */
export function authenticate(token: string | null): DeviceRecord {
  if (!token) {
    throw new HttpError(401, 'This device is not signed in to the server.', 'NO_TOKEN')
  }
  const hash = hashToken(token)
  const rows = selectAllDevices.all() as Array<Record<string, unknown>>
  const match = rows.find((row) => constantTimeEquals(String(row['token_hash']), hash))
  if (!match) {
    throw new HttpError(401, 'This device is no longer recognised by the server. Enrol it again.', 'BAD_TOKEN')
  }
  const device = toRecord(match)
  if (!device.active) {
    throw new HttpError(403, 'This device has been deactivated by a manager.', 'DEVICE_DEACTIVATED')
  }
  touchDevice.run(Date.now(), device.deviceId)
  return device
}

export function getDevice(deviceId: string): DeviceRecord | null {
  const row = selectDevice.get(deviceId) as Record<string, unknown> | undefined
  return row ? toRecord(row) : null
}

export function listDevices(): DeviceRecord[] {
  return (selectAllDevices.all() as Array<Record<string, unknown>>).map(toRecord)
}

export function setDeviceCursor(deviceId: string, cursor: number): void {
  advanceCursor.run(cursor, Date.now(), deviceId)
}

export function setDeviceActive(deviceId: string, active: boolean): void {
  setActive.run(active ? 1 : 0, deviceId)
}

/** Exposed so an operator can read the code out of Settings when enrolling a new terminal. */
export function enrolmentCodeHint(): string {
  return config.isProduction ? '(set on the server)' : enrolmentCode
}
