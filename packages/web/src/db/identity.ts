import { newDeviceId, newId, type DeviceType } from '@pos/shared'
import { db, META_KEYS, readMeta, writeMeta } from './database.ts'

/**
 * This terminal's identity.
 *
 * A device names itself once, on first run, and keeps that name for life. It
 * is what stamps every record the device creates, what the server enrols, and
 * what lets an owner recognise - and if necessary deactivate - a terminal from
 * the sync dashboard.
 */

export interface DeviceIdentity {
  deviceId: string
  label: string
  type: DeviceType
}

let cached: DeviceIdentity | null = null

function guessDeviceType(): DeviceType {
  if (typeof navigator === 'undefined') return 'WEB'
  const ua = navigator.userAgent
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const wide = typeof window !== 'undefined' && Math.min(window.screen.width, window.screen.height) >= 600

  if (/iPad/i.test(ua) || (coarse && wide)) return 'TABLET'
  if (/iPhone|Android.*Mobile|Mobile/i.test(ua)) return 'PHONE'
  if (coarse) return 'TABLET'
  return 'DESKTOP'
}

function defaultLabel(type: DeviceType): string {
  switch (type) {
    case 'TABLET':
      return 'POS Tablet'
    case 'PHONE':
      return 'POS Phone'
    case 'DESKTOP':
      return 'POS Desktop'
    default:
      return 'POS Web'
  }
}

export async function loadIdentity(): Promise<DeviceIdentity> {
  if (cached) return cached

  const existing = await readMeta<string | null>(META_KEYS.deviceId, null)
  if (existing) {
    cached = {
      deviceId: existing,
      label: await readMeta<string>(META_KEYS.deviceLabel, 'POS'),
      type: await readMeta<DeviceType>(META_KEYS.deviceType, 'WEB'),
    }
    return cached
  }

  const type = guessDeviceType()
  const label = defaultLabel(type)
  const identity: DeviceIdentity = { deviceId: newDeviceId(label, newId()), label, type }

  await db.transaction('rw', db.meta, async () => {
    await writeMeta(META_KEYS.deviceId, identity.deviceId)
    await writeMeta(META_KEYS.deviceLabel, identity.label)
    await writeMeta(META_KEYS.deviceType, identity.type)
  })

  cached = identity
  return identity
}

/** Synchronous access for code paths already running after startup. */
export function deviceId(): string {
  if (!cached) throw new Error('Device identity was read before the application finished starting.')
  return cached.deviceId
}

export function identity(): DeviceIdentity {
  if (!cached) throw new Error('Device identity was read before the application finished starting.')
  return cached
}

export async function renameDevice(label: string): Promise<void> {
  const current = await loadIdentity()
  cached = { ...current, label }
  await writeMeta(META_KEYS.deviceLabel, label)
}

/** Test seam: lets a test install a known identity without touching storage. */
export function __setIdentityForTests(next: DeviceIdentity | null): void {
  cached = next
}
