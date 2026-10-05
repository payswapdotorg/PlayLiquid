import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCK_SCHEMA_VERSION,
  canonicalPins,
  computeLockFingerprint,
  validateLock,
} from './lockfile.ts'
import type { PackageLock } from './lockfile.ts'
import { makeLock, makePin, makeRecord } from './test-fixtures.ts'

test('lock records exact versions and content digests (lockfile pinning)', () => {
  const record = makeRecord('world', '@demo/world', '1.2.3')
  const lock = makeLock([record])
  assert.equal(lock.lockVersion, LOCK_SCHEMA_VERSION)
  const pin = lock.packages[0]
  assert.notEqual(pin, undefined)
  assert.equal(pin?.version, record.identity.version)
  assert.equal(pin?.contentDigest, record.identity.contentDigest)
  assert.equal(pin?.kind, record.identity.kind)
  assert.equal(pin?.id, record.identity.id)
})

test('lock fingerprint is pin-order invariant (E9)', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const b = makeRecord('assets', '@demo/b', '2.0.0')
  const c = makeRecord('system', '@demo/c', '0.3.1')
  const lockOne = makeLock([a, b, c])
  const lockTwo = makeLock([c, a, b])
  const lockThree = makeLock([b, c, a])
  assert.equal(computeLockFingerprint(lockOne), computeLockFingerprint(lockTwo))
  assert.equal(computeLockFingerprint(lockTwo), computeLockFingerprint(lockThree))
})

test('lock fingerprint distinguishes different pin sets', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const aNext = makeRecord('assets', '@demo/a', '1.0.1')
  assert.notEqual(
    computeLockFingerprint(makeLock([a])),
    computeLockFingerprint(makeLock([aNext])),
  )
  assert.notEqual(
    computeLockFingerprint(makeLock([a])),
    computeLockFingerprint(makeLock([a, makeRecord('assets', '@demo/b', '1.0.0')])),
  )
})

test('canonicalPins sorts pins by id', () => {
  const b = makeRecord('assets', '@demo/b', '1.0.0')
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const lock = makeLock([b, a])
  assert.deepEqual(
    canonicalPins(lock).map((pin) => pin.id),
    ['@demo/a', '@demo/b'],
  )
})

test('validateLock rejects duplicate pins for the same id', () => {
  const record = makeRecord('assets', '@demo/a', '1.0.0')
  const lock: PackageLock = {
    ...makeLock([record]),
    packages: [makePin(record), makePin(record)],
  }
  const result = validateLock(lock)
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.error.code, 'duplicate-pin')
  assert.equal(!result.ok && result.error.packageId, '@demo/a')
})

test('validateLock rejects wrong schema versions and malformed pins', () => {
  const record = makeRecord('assets', '@demo/a', '1.0.0')
  const badVersion = { ...makeLock([record]), lockVersion: 2 } as unknown as PackageLock
  assert.equal(!validateLock(badVersion).ok, true)

  const badPin = makeLock([record])
  ;(badPin.packages[0] as { contentDigest: string }).contentDigest = 'bogus'
  assert.equal(!validateLock(badPin).ok, true)

  const badHost = makeLock([record], [
    { id: '', version: record.identity.version },
  ])
  assert.equal(!validateLock(badHost).ok, true)

  assert.equal(validateLock(makeLock([record])).ok, true)
})
