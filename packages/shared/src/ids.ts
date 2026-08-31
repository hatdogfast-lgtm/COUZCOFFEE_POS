/**
 * Globally unique, time-sortable identifiers (ULID).
 *
 * Every record created anywhere in the system - on any device, online or
 * offline - gets one of these. They never collide across devices, and because
 * the leading 48 bits are a millisecond timestamp they sort chronologically,
 * which keeps the sync log and the inventory ledger naturally ordered.
 *
 * Human-facing numbers (receipt no., queue no.) are deliberately NOT used as
 * database identity. See `queue.ts` semantics in the POS layer.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TIME_LEN = 10
const RANDOM_LEN = 16

let lastTime = -1
let lastRandom: number[] = []

function randomBytes(length: number): number[] {
  const out = new Uint8Array(length)
  globalThis.crypto.getRandomValues(out)
  return Array.from(out, (byte) => byte % 32)
}

function encodeTime(now: number): string {
  let time = now
  let out = ''
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % 32
    out = CROCKFORD[mod] + out
    time = (time - mod) / 32
  }
  return out
}

/** Increment the random component so IDs stay monotonic within one millisecond. */
function bumpRandom(previous: number[]): number[] {
  const next = previous.slice()
  for (let i = next.length - 1; i >= 0; i--) {
    const value = next[i] ?? 0
    if (value < 31) {
      next[i] = value + 1
      return next
    }
    next[i] = 0
  }
  // Overflowed a full 80-bit space inside one millisecond: start fresh.
  return randomBytes(RANDOM_LEN)
}

/** Create a new ULID. Monotonic and collision-free per device. */
export function newId(now: number = Date.now()): string {
  if (now === lastTime) {
    lastRandom = bumpRandom(lastRandom)
  } else {
    lastTime = now
    lastRandom = randomBytes(RANDOM_LEN)
  }
  return encodeTime(now) + lastRandom.map((value) => CROCKFORD[value]).join('')
}

/** Recover the creation timestamp encoded in a ULID. */
export function idTimestamp(id: string): number {
  let time = 0
  for (const char of id.slice(0, TIME_LEN)) {
    const index = CROCKFORD.indexOf(char)
    if (index === -1) throw new Error(`Not a valid identifier: ${id}`)
    time = time * 32 + index
  }
  return time
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length === TIME_LEN + RANDOM_LEN && /^[0-9A-HJKMNP-TV-Z]+$/.test(value)
}

/**
 * A stable, human-readable identity for this physical device, e.g. POS-TABLET-01.
 * Persisted by the caller; generated once on first run.
 */
export function newDeviceId(label: string, seed: string = newId()): string {
  const slug = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'POS'
  return `${slug}-${seed.slice(-6)}`
}
