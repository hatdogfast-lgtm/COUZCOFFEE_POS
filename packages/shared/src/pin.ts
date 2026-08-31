/**
 * Staff PIN hashing.
 *
 * PINs are never stored, transmitted or logged in plaintext - not in the local
 * database, not in the sync payload, not on the server. Hashing uses PBKDF2
 * over the Web Crypto API, which is present unchanged in the browser, in the
 * service worker and in Node, so one implementation covers every runtime.
 *
 * A 4-digit PIN has a small keyspace by nature, so this is paired with
 * per-user lockout on repeated failures rather than relying on the hash alone.
 */

const ALGORITHM = 'PBKDF2'
const DIGEST = 'SHA-256'
const ITERATIONS = 210_000
const SALT_BYTES = 16
const KEY_BITS = 256

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * A minimal view of the Web Crypto surface this module uses.
 *
 * Spelling it out locally keeps the file free of DOM-only type names, so the
 * identical source compiles for the browser, the service worker and the
 * server without any of them needing the others' type library.
 */
interface SubtleLike {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: string,
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>
  deriveBits(
    algorithm: { name: string; salt: Uint8Array; iterations: number; hash: string },
    key: unknown,
    length: number,
  ): Promise<ArrayBuffer>
}

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle as unknown as SubtleLike
  const key = await subtle.importKey('raw', new TextEncoder().encode(secret), ALGORITHM, false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: ALGORITHM, salt, iterations, hash: DIGEST }, key, KEY_BITS)
  return new Uint8Array(bits)
}

/**
 * Produce a self-describing hash string: pbkdf2$sha256$iterations$salt$hash
 *
 * Used for anything that has to be checked but never read back - PINs and the
 * planner passcode alike. Nothing here knows or cares what the secret means.
 */
export async function hashSecret(secret: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(secret, salt, ITERATIONS)
  return `pbkdf2$sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

/** A PIN is a secret with a shape, so the shape is checked before hashing. */
export async function hashPin(pin: string): Promise<string> {
  assertPinShape(pin)
  return hashSecret(pin)
}

/** Compare in constant time so timing never leaks how much of a PIN matched. */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[2])
  const saltPart = parts[3]
  const hashPart = parts[4]
  if (!Number.isFinite(iterations) || !saltPart || !hashPart) return false

  const expected = fromBase64(hashPart)
  const actual = await derive(secret, fromBase64(saltPart), iterations)
  if (expected.length !== actual.length) return false

  let difference = 0
  for (let i = 0; i < expected.length; i++) {
    difference |= (expected[i] ?? 0) ^ (actual[i] ?? 0)
  }
  return difference === 0
}

export const verifyPin = verifySecret

export const PIN_LENGTH = 4

/**
 * Checked with a length test and a plain digit pattern rather than a regex
 * built from a template literal, where a lone backslash silently becomes an
 * ordinary character and the check quietly stops checking anything.
 */
export function assertPinShape(pin: string): void {
  if (pin.length !== PIN_LENGTH || !/^\d+$/.test(pin)) {
    throw new Error(`A PIN must be exactly ${PIN_LENGTH} digits`)
  }
}

/** Reject the handful of PINs that offer no protection at all. */
export function isWeakPin(pin: string): boolean {
  if (!/^\d+$/.test(pin)) return true
  if (new Set(pin).size === 1) return true
  const digits = pin.split('').map(Number)
  const ascending = digits.every((digit, index) => index === 0 || digit === (digits[index - 1] ?? 0) + 1)
  const descending = digits.every((digit, index) => index === 0 || digit === (digits[index - 1] ?? 0) - 1)
  return ascending || descending
}
