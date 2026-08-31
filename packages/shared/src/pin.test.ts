import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { assertPinShape, hashPin, isWeakPin, PIN_LENGTH, verifyPin } from './pin.ts'

describe('PIN shape', () => {
  test('accepts exactly four digits', () => {
    assert.doesNotThrow(() => assertPinShape('8317'))
    assert.doesNotThrow(() => assertPinShape('0451'))
  })

  test('rejects letters', () => {
    // Regression: the check was once built from a template literal, where the
    // backslash in \d silently collapsed and the pattern became ^d{4}$ - which
    // accepted "dddd" as a valid PIN and rejected nothing else useful.
    assert.throws(() => assertPinShape('dddd'))
    assert.throws(() => assertPinShape('abcd'))
    assert.throws(() => assertPinShape('12d4'))
  })

  test('rejects the wrong length', () => {
    assert.throws(() => assertPinShape('831'))
    assert.throws(() => assertPinShape('83177'))
    assert.throws(() => assertPinShape(''))
  })

  test('rejects whitespace and signs that Number would tolerate', () => {
    assert.throws(() => assertPinShape(' 831'))
    assert.throws(() => assertPinShape('+831'))
    assert.throws(() => assertPinShape('83.1'))
  })
})

describe('weak PINs', () => {
  test('flags repeated digits', () => {
    assert.equal(isWeakPin('0000'), true)
    assert.equal(isWeakPin('7777'), true)
  })

  test('flags runs in either direction', () => {
    assert.equal(isWeakPin('1234'), true)
    assert.equal(isWeakPin('4321'), true)
  })

  test('allows an ordinary PIN', () => {
    assert.equal(isWeakPin('8317'), false)
    assert.equal(isWeakPin('2059'), false)
  })
})

describe('hashing', () => {
  test('a correct PIN verifies and an incorrect one does not', async () => {
    const stored = await hashPin('8317')
    assert.equal(await verifyPin('8317', stored), true)
    assert.equal(await verifyPin('8318', stored), false)
  })

  test('the PIN never appears in the stored value', async () => {
    const stored = await hashPin('8317')
    assert.ok(!stored.includes('8317'))
    assert.match(stored, /^pbkdf2\$sha256\$\d+\$/)
  })

  test('the same PIN hashes differently each time, because of the salt', async () => {
    const first = await hashPin('8317')
    const second = await hashPin('8317')
    assert.notEqual(first, second)
    assert.equal(await verifyPin('8317', second), true)
  })

  test('a malformed stored value is refused rather than throwing', async () => {
    assert.equal(await verifyPin('8317', 'not-a-hash'), false)
    assert.equal(await verifyPin('8317', ''), false)
  })

  test('hashing refuses a PIN of the wrong shape', async () => {
    await assert.rejects(() => hashPin('abcd'))
    await assert.rejects(() => hashPin('12345'))
  })

  test('PIN length is four', () => {
    assert.equal(PIN_LENGTH, 4)
  })
})
