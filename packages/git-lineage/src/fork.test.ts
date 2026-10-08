import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORK_REASONS,
  MAX_FORK_NOTE_LENGTH,
  forkEdgeOf,
  isForkRecord,
  isForkReason,
  validateForkRecord,
} from './fork.ts'
import type { ForkRecord } from './fork.ts'
import type { PackageCoordinate } from '@playliquid/package-system'
import { coordinateOf, makeRecord } from './fixtures.ts'

const BASE_COMMIT = '0123456789abcdef0123456789abcdef01234567'
const baseWorld = makeRecord('world', '@demo/arena-world', '2.1.0')
const forkWorld = makeRecord('world', '@fork/hardened-arena', '1.0.0')
const overlayPkg = makeRecord('overlay', '@demo/arena-tuning', '0.1.0')
const assetsPkg = makeRecord('assets', '@demo/base-assets', '1.4.2')

function validFork(): ForkRecord {
  return {
    fork: coordinateOf(forkWorld),
    base: { package: coordinateOf(baseWorld), commit: BASE_COMMIT },
    reason: 'security',
    note: 'harden spawn rules',
  }
}

test('FORK_REASONS is the frozen vocabulary', () => {
  assert.deepEqual([...FORK_REASONS], [
    'divergence',
    'maintenance',
    'experiment',
    'port',
    'localization',
    'policy',
    'security',
  ])
  for (const reason of FORK_REASONS) {
    assert.equal(isForkReason(reason), true)
  }
  assert.equal(isForkReason('because'), false)
  assert.equal(isForkReason(undefined), false)
})

test('a well-formed whole-package fork validates clean', () => {
  const violations = validateForkRecord(validFork())
  assert.deepEqual(violations, [])
  assert.equal(isForkRecord(validFork()), true)
  // every frozen reason is accepted
  for (const reason of FORK_REASONS) {
    assert.deepEqual(validateForkRecord({ ...validFork(), reason }), [])
  }
})

test('fork kind must equal base kind (forks are whole-package)', () => {
  const mismatch: ForkRecord = {
    ...validFork(),
    fork: coordinateOf(makeRecord('system', '@fork/renamed', '0.1.0')),
  }
  const violations = validateForkRecord(mismatch)
  assert.equal(violations.length, 1)
  assert.equal(violations[0]?.code, 'fork-kind-mismatch')
  // renaming is allowed: same kind, different id (an assets fork of an assets base)
  const renamed: ForkRecord = {
    fork: coordinateOf(makeRecord('assets', '@fork/assets-copy', '0.1.0')),
    base: { package: coordinateOf(assetsPkg), commit: BASE_COMMIT },
    reason: 'divergence',
  }
  assert.deepEqual(validateForkRecord(renamed), [])
})

test('an overlay package cannot be forked wholesale (negative)', () => {
  const forkOfOverlay: ForkRecord = {
    fork: coordinateOf(makeRecord('overlay', '@fork/overlay-copy', '0.1.0')),
    base: { package: coordinateOf(overlayPkg), commit: BASE_COMMIT },
    reason: 'divergence',
  }
  const violations = validateForkRecord(forkOfOverlay)
  const codes = violations.map((violation) => violation.code)
  assert.ok(codes.includes('fork-base-forbidden'))
  assert.equal(isForkRecord(forkOfOverlay), false)
})

test('malformed coordinates, commit and reason fail closed', () => {
  const badFork = validateForkRecord({ ...validFork(), fork: { kind: 'world', id: 'Bad Id', version: coordinateOf(baseWorld).version, contentDigest: coordinateOf(baseWorld).contentDigest } })
  assert.ok(badFork.some((violation) => violation.code === 'invalid-fork-coordinate'))

  const badBase = validateForkRecord({
    ...validFork(),
    base: { package: coordinateOf(baseWorld), commit: 'nothex' },
  })
  assert.ok(badBase.some((violation) => violation.code === 'invalid-base-commit'))
  const shortCommit = validateForkRecord({
    ...validFork(),
    base: { package: coordinateOf(baseWorld), commit: 'abcdef' },
  })
  assert.ok(shortCommit.some((violation) => violation.code === 'invalid-base-commit'))

  const unknownReason = validateForkRecord({ ...validFork(), reason: 'whimsy' as ForkRecord['reason'] })
  assert.ok(unknownReason.some((violation) => violation.code === 'unknown-reason'))

  const malformedBase = validateForkRecord({
    ...validFork(),
    base: { package: null as unknown as PackageCoordinate, commit: BASE_COMMIT },
  })
  assert.ok(malformedBase.some((violation) => violation.code === 'invalid-base-coordinate'))
  assert.equal(isForkRecord(null), false)
})

test('fork notes are bounded', () => {
  const tooLong = validateForkRecord({
    ...validFork(),
    note: 'x'.repeat(MAX_FORK_NOTE_LENGTH + 1),
  })
  assert.ok(tooLong.some((violation) => violation.code === 'note-too-long'))
  assert.deepEqual(
    validateForkRecord({ ...validFork(), note: 'x'.repeat(MAX_FORK_NOTE_LENGTH) }),
    [],
  )
})

test('forkEdgeOf derives the fork-of lineage edge with content-addressed ends', () => {
  const edge = forkEdgeOf(validFork())
  assert.equal(edge.kind, 'fork-of')
  assert.match(edge.from, /^sha256:[0-9a-f]{64}$/)
  assert.match(edge.to, /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(edge.from, edge.to)
})
