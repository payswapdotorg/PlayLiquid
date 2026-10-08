import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDigest } from '@playliquid/package-system'
import {
  FORBIDDEN_OVERLAY_SURFACES,
  OVERLAY_LEGAL_BASE_KINDS,
  OVERLAY_SURFACE_RULES,
  OVERLAY_SURFACES,
  isOverlayRecord,
  isOverlaySurface,
  overlayEdgeOf,
  semanticPathRoot,
  validateOverlayRecord,
} from './overlay.ts'
import type { OverlayOperation, OverlayRecord } from './overlay.ts'
import { checkOverlayApplicability } from './overlay-applicability.ts'
import { coordinateOf, dependencyOn, makeRecord, tamperMetadata } from './fixtures.ts'

const baseWorld = makeRecord('world', '@demo/arena-world', '2.1.0', {
  dependencies: [dependencyOn('@demo/combat-system', '^0.3.0')],
  resources: { minMemoryBytes: 64 },
  providedCapabilities: [
    { id: 'world.spawn-rules', version: { major: 1, minor: 0, patch: 0, prerelease: [], build: [] } },
  ],
})
const overlayPkg = makeRecord('overlay', '@demo/arena-tuning', '0.1.0')

const VALUE = computeDigest({ any: 'typed value' })

function overlayOf(operations: readonly OverlayOperation[]): OverlayRecord {
  return { base: coordinateOf(baseWorld), operations }
}

test('OVERLAY_SURFACES is frozen and excludes R19/immutability surfaces', () => {
  assert.deepEqual([...OVERLAY_SURFACES], [
    'dependencies',
    'providedCapabilities',
    'requiredCapabilities',
    'permissions',
    'artifacts',
    'extensionPoints',
    'evaluationSuites',
    'resources',
    'compatibility',
  ])
  for (const surface of FORBIDDEN_OVERLAY_SURFACES) {
    assert.equal(isOverlaySurface(surface), false, `${surface} must not be overlayable`)
  }
  for (const surface of OVERLAY_SURFACES) {
    assert.equal(isOverlaySurface(surface), true)
    assert.ok(OVERLAY_SURFACE_RULES[surface] !== undefined)
  }
  assert.deepEqual([...OVERLAY_LEGAL_BASE_KINDS], [
    'game',
    'world',
    'assets',
    'avatar',
    'system',
    'evaluation-suite',
  ])
})

test('a well-formed overlay validates clean', () => {
  const overlay = overlayOf([
    { op: 'add', surface: 'permissions', key: 'world.spawn-rules', valueDigest: VALUE },
    { op: 'remove', surface: 'dependencies', key: '@demo/combat-system' },
    { op: 'replace', surface: 'resources', key: 'minMemoryBytes', valueDigest: VALUE },
    { op: 'patch', surface: 'compatibility', path: 'targets[0].profileId', valueDigest: VALUE },
  ])
  assert.deepEqual(validateOverlayRecord(overlay), [])
  assert.equal(isOverlayRecord(overlay), true)
})

test('empty overlays and unknown surfaces fail closed (negative)', () => {
  assert.ok(
    validateOverlayRecord(overlayOf([])).some((v) => v.code === 'empty-overlay'),
  )
  const forbidden = overlayOf([
    { op: 'replace', surface: 'license', key: 'spdxExpression', valueDigest: VALUE } as unknown as OverlayOperation,
  ])
  const codes = validateOverlayRecord(forbidden).map((v) => v.code)
  assert.ok(codes.includes('unknown-surface'))

  const overlayBase = validateOverlayRecord({
    base: coordinateOf(overlayPkg),
    operations: [
      { op: 'add', surface: 'permissions', key: 'x', valueDigest: VALUE },
    ],
  })
  assert.ok(overlayBase.some((v) => v.code === 'base-kind-forbidden'))
})

test('ops outside the closed set for a surface fail (negative)', () => {
  const patchOnList = overlayOf([
    { op: 'patch', surface: 'dependencies', path: 'dependencies[0].constraint', valueDigest: VALUE },
  ])
  assert.ok(
    validateOverlayRecord(patchOnList).some((v) => v.code === 'unknown-op'),
  )
  const addOnRecord = overlayOf([
    { op: 'add', surface: 'resources', key: 'minMemoryBytes', valueDigest: VALUE },
  ])
  assert.ok(
    validateOverlayRecord(addOnRecord).some((v) => v.code === 'unknown-op'),
  )
  const removeOnArtifacts = overlayOf([
    { op: 'remove', surface: 'artifacts', key: VALUE },
  ])
  assert.deepEqual(validateOverlayRecord(removeOnArtifacts), [])
})

test('malformed keys, paths and value digests fail (negative)', () => {
  const badKey = overlayOf([
    { op: 'add', surface: 'permissions', key: '', valueDigest: VALUE },
  ])
  assert.ok(validateOverlayRecord(badKey).some((v) => v.code === 'invalid-key'))

  const badField = overlayOf([
    { op: 'replace', surface: 'resources', key: 'warpDrive', valueDigest: VALUE },
  ])
  assert.ok(validateOverlayRecord(badField).some((v) => v.code === 'invalid-key'))

  const badPath = overlayOf([
    { op: 'patch', surface: 'compatibility', path: 'not a path!!', valueDigest: VALUE },
  ])
  assert.ok(validateOverlayRecord(badPath).some((v) => v.code === 'invalid-path'))

  const badRoot = overlayOf([
    { op: 'patch', surface: 'compatibility', path: 'warpDrive[0].coil', valueDigest: VALUE },
  ])
  assert.ok(
    validateOverlayRecord(badRoot).some((v) => v.code === 'invalid-path'),
    'a path rooted outside the surface fields must fail',
  )

  const goodRoot = overlayOf([
    { op: 'patch', surface: 'compatibility', path: 'engines[0]', valueDigest: VALUE },
  ])
  assert.deepEqual(validateOverlayRecord(goodRoot), [])

  const badDigest = overlayOf([
    { op: 'add', surface: 'permissions', key: 'x', valueDigest: 'sha256:zz' },
  ])
  assert.ok(
    validateOverlayRecord(badDigest).some((v) => v.code === 'invalid-value-digest'),
  )
})

test('two operations on the same target conflict (negative)', () => {
  const conflicting = overlayOf([
    { op: 'add', surface: 'permissions', key: 'world.spawn-rules', valueDigest: VALUE },
    { op: 'remove', surface: 'permissions', key: 'world.spawn-rules' },
  ])
  assert.ok(
    validateOverlayRecord(conflicting).some((v) => v.code === 'conflicting-operations'),
  )
  // distinct targets are fine
  assert.deepEqual(
    validateOverlayRecord(
      overlayOf([
        { op: 'add', surface: 'permissions', key: 'a', valueDigest: VALUE },
        { op: 'remove', surface: 'permissions', key: 'b' },
      ]),
    ),
    [],
  )
})

test('semanticPathRoot extracts the root segment', () => {
  assert.equal(semanticPathRoot('targets[0].profileId'), 'targets')
  assert.equal(semanticPathRoot('runtimes'), 'runtimes')
  assert.equal(semanticPathRoot('world.rules.combat'), 'world')
  assert.equal(semanticPathRoot('nope nope'), null)
})

test('checkOverlayApplicability: legal targets against the base pass', () => {
  const overlay = overlayOf([
    { op: 'remove', surface: 'dependencies', key: '@demo/combat-system' },
    { op: 'replace', surface: 'providedCapabilities', key: 'world.spawn-rules', valueDigest: VALUE },
    { op: 'replace', surface: 'resources', key: 'minMemoryBytes', valueDigest: VALUE },
    { op: 'add', surface: 'permissions', key: 'world.spawn-rules', valueDigest: VALUE },
    { op: 'patch', surface: 'compatibility', path: 'runtimes[1]', valueDigest: VALUE },
  ])
  const result = checkOverlayApplicability(overlay, baseWorld)
  assert.deepEqual(result.violations, [])
  assert.equal(result.ok, true)
})

test('checkOverlayApplicability: add onto an existing target fails (negative)', () => {
  const overlay = overlayOf([
    { op: 'add', surface: 'dependencies', key: '@demo/combat-system', valueDigest: VALUE },
  ])
  const result = checkOverlayApplicability(overlay, baseWorld)
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((v) => v.code === 'target-exists'))
})

test('checkOverlayApplicability: remove/replace/patch of absent targets fail (negative)', () => {
  const missing = checkOverlayApplicability(
    overlayOf([
      { op: 'remove', surface: 'dependencies', key: '@demo/absent-package' },
    ]),
    baseWorld,
  )
  assert.ok(missing.violations.some((v) => v.code === 'target-missing'))

  const missingField = checkOverlayApplicability(
    overlayOf([
      { op: 'replace', surface: 'resources', key: 'gpuRequired', valueDigest: VALUE },
    ]),
    baseWorld,
  )
  assert.ok(missingField.violations.some((v) => v.code === 'target-missing'))

  const badRoot = checkOverlayApplicability(
    overlayOf([
      { op: 'patch', surface: 'resources', path: 'networkRequired.enabled', valueDigest: VALUE },
    ]),
    baseWorld,
  )
  assert.ok(
    badRoot.violations.some((v) => v.code === 'target-missing'),
    'the base does not carry networkRequired, so the patch has no target',
  )
})

test('checkOverlayApplicability fails closed on invalid bases (negative)', () => {
  // Tampered base: declared digest kept, content mutated — fails package-system
  // validatePackageRecord (the seam), so applicability fails closed.
  const tampered = tamperMetadata(baseWorld, {
    license: { spdxExpression: '', status: 'declared' },
  })
  const result = checkOverlayApplicability(
    overlayOf([
      { op: 'add', surface: 'permissions', key: 'x', valueDigest: VALUE },
    ]),
    tampered,
  )
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((v) => v.code === 'invalid-base-record'))

  const mismatch = checkOverlayApplicability(
    {
      base: coordinateOf(overlayPkg),
      operations: [
        { op: 'add', surface: 'permissions', key: 'x', valueDigest: VALUE },
      ],
    },
    baseWorld,
  )
  assert.ok(mismatch.violations.some((v) => v.code === 'base-coordinate-mismatch'))
  assert.ok(mismatch.violations.some((v) => v.code === 'base-kind-forbidden'))
})

test('overlayEdgeOf derives the overlay-of edge between exact coordinates', () => {
  const edge = overlayEdgeOf(coordinateOf(overlayPkg), coordinateOf(baseWorld))
  assert.equal(edge.kind, 'overlay-of')
  assert.match(edge.from, /^sha256:[0-9a-f]{64}$/)
  assert.match(edge.to, /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(edge.from, edge.to)
})
