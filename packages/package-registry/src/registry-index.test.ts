import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRegistryIndex } from './registry-index.ts'
import type { RegistryPublishFailure, RegistryPublishResult } from './registry-index.ts'
import {
  capability,
  makeLock,
  makeMetadata,
  makeRecord,
  makeUnsealedRecord,
  permission,
  requires,
  seal,
  semver,
} from './test-fixtures.ts'
import { computeDigest } from '@playliquid/package-system'

const failure = (result: RegistryPublishResult): RegistryPublishFailure => {
  assert.equal(result.ok, false, `expected failure, got ${JSON.stringify(result)}`)
  return result as RegistryPublishFailure
}

const threePackageGraph = () => {
  const base = makeRecord('assets', '@demo/base', '1.0.0', {
    providedCapabilities: [capability('asset.mesh-format', '1.2.0')],
  })
  const middle = makeRecord('system', '@demo/middle', '1.1.0', {
    dependencies: [{ id: '@demo/base', constraint: '^1.0.0', kind: 'assets', optional: false }],
    requiredCapabilities: [requires('asset.mesh-format', '^1.0.0')],
    permissions: [permission('asset.mesh-format', 'read')],
  })
  const top = makeRecord('world', '@demo/top', '2.0.0', {
    dependencies: [
      { id: '@demo/base', constraint: '*', kind: null, optional: false },
      { id: '@demo/middle', constraint: '^1.0.0', kind: 'system', optional: false },
    ],
    requiredCapabilities: [requires('asset.mesh-format', '*')],
  })
  return { base, middle, top }
}

test('publish admits a gate-passing record and lookups find it', () => {
  const index = createRegistryIndex()
  const record = makeRecord('assets', '@demo/base', '1.4.2')
  const result = index.publish(record)
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.equal(result.status, 'published')
  assert.equal(index.size(), 1)
  assert.deepEqual(
    index.get({ kind: 'assets', id: '@demo/base', version: semver('1.4.2') }),
    result.record,
  )
  assert.equal(index.getByDigest(record.identity.contentDigest)?.identity.id, '@demo/base')
})

test('exact lookups are exact: build metadata and kind are significant', () => {
  const index = createRegistryIndex()
  const plain = makeRecord('assets', '@demo/a', '1.0.0')
  const build = makeRecord('assets', '@demo/a', '1.0.0+local')
  assert.equal(index.publish(plain).ok, true)
  assert.equal(index.publish(build).ok, true)
  assert.notEqual(plain.identity.contentDigest, build.identity.contentDigest)

  const foundPlain = index.get({ kind: 'assets', id: '@demo/a', version: semver('1.0.0') })
  const foundBuild = index.get({ kind: 'assets', id: '@demo/a', version: semver('1.0.0+local') })
  assert.ok(foundPlain !== null)
  assert.ok(foundBuild !== null)
  assert.equal(foundPlain.identity.contentDigest, plain.identity.contentDigest)
  assert.equal(foundBuild.identity.contentDigest, build.identity.contentDigest)

  assert.equal(index.get({ kind: 'system', id: '@demo/a', version: semver('1.0.0') }), null)
  assert.equal(index.get({ kind: 'assets', id: '@demo/a', version: semver('9.9.9') }), null)
})

test('republish of the identical record is idempotent (lock rule 8)', () => {
  const index = createRegistryIndex()
  const record = makeRecord('assets', '@demo/base', '1.0.0')
  const first = index.publish(record)
  const second = index.publish(record)
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) {
    return
  }
  assert.equal(second.status, 'already-published')
  assert.deepEqual(second.record, first.record)
  assert.equal(index.size(), 1)
})

test('republish with ANY mutation of the coordinate is rejected (E8)', () => {
  const index = createRegistryIndex()
  const original = makeRecord('assets', '@demo/base', '1.0.0')
  assert.equal(index.publish(original).ok, true)

  const mutatedContent = makeRecord('assets', '@demo/base', '1.0.0', {
    resources: { minMemoryBytes: 1024 },
  })
  const rejected = failure(index.publish(mutatedContent))
  assert.equal(rejected.code, 'mutation-rejected')
  assert.equal(index.size(), 1)
  assert.equal(
    index.get({ kind: 'assets', id: '@demo/base', version: semver('1.0.0') })
      ?.identity.contentDigest,
    original.identity.contentDigest,
  )
})

test('same id+version with a different kind is an identity conflict', () => {
  const index = createRegistryIndex()
  assert.equal(index.publish(makeRecord('assets', '@demo/x', '1.0.0')).ok, true)
  const conflict = failure(index.publish(makeRecord('system', '@demo/x', '1.0.0')))
  assert.equal(conflict.code, 'mutation-rejected')
  assert.equal(index.size(), 1)
})

test('checkPublish is a pure pre-flight: it never mutates the index', () => {
  const index = createRegistryIndex()
  const record = makeRecord('assets', '@demo/base', '1.0.0')
  const preflight = index.checkPublish(record)
  assert.equal(preflight.ok, true)
  assert.equal(index.size(), 0)
  assert.equal(index.get({ kind: 'assets', id: '@demo/base', version: semver('1.0.0') }), null)
})

test('structurally invalid records fail closed with violations attached', () => {
  const index = createRegistryIndex()
  const invalid = makeRecord('assets', '@demo/bad', '1.0.0', {
    dependencies: [
      { id: 'NOT-VALIDID', constraint: '^1.0.0', kind: null, optional: false },
    ],
  })
  const rejected = failure(index.publish(invalid))
  assert.equal(rejected.code, 'invalid-record')
  assert.ok(rejected.violations !== undefined && rejected.violations.length > 0)
  assert.equal(index.size(), 0)
})

test('R19 release gate: unverified license fails closed by default', () => {
  const index = createRegistryIndex()
  const unverified = makeRecord('assets', '@demo/unverified', '1.0.0', {
    license: { spdxExpression: 'MIT', status: 'declared' },
  })
  const rejected = failure(index.publish(unverified))
  assert.equal(rejected.code, 'release-gate')
  assert.ok(rejected.gateReasons !== undefined && rejected.gateReasons.length > 0)
  assert.equal(index.size(), 0)
})

test('R19 gate is an explicit, auditable opt-out — never a silent bypass', () => {
  const index = createRegistryIndex({ enforceReleaseGate: false })
  const unverified = makeRecord('assets', '@demo/unverified', '1.0.0', {
    license: { spdxExpression: 'MIT', status: 'declared' },
  })
  const admitted = index.publish(unverified)
  assert.equal(admitted.ok, true)
  assert.equal(index.size(), 1)
})

test('records stored in the index are deep-frozen (immutability defense)', () => {
  const index = createRegistryIndex()
  const result = index.publish(makeRecord('assets', '@demo/base', '1.0.0'))
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.throws(() => {
    ;(result.record as unknown as { identity: { id: string } }).identity.id = '@demo/hijack'
  }, TypeError)
  const listing = index.list()
  assert.throws(() => {
    ;(listing[0] as unknown as { identity: { id: string } }).identity.id = '@demo/hijack'
  }, TypeError)
})

test('publish never freezes the caller input object (clone isolation)', () => {
  const index = createRegistryIndex()
  const record = makeRecord('assets', '@demo/base', '1.0.0')
  const before = JSON.stringify(record)
  index.publish(record)
  assert.equal(Object.isFrozen(record), false)
  assert.equal(JSON.stringify(record), before)
})

test('listing order is stable: id ascending, then version precedence', () => {
  const records = [
    makeRecord('assets', '@demo/b', '2.0.0'),
    makeRecord('assets', '@demo/a', '1.2.0'),
    makeRecord('assets', '@demo/a', '1.0.0'),
    makeRecord('assets', '@demo/a', '1.0.0-alpha.1'),
    makeRecord('assets', '@demo/a', '2.0.0'),
    makeRecord('assets', '@demo/a', '1.0.0+z'),
  ]
  const forward = createRegistryIndex()
  for (const record of records) {
    forward.publish(record)
  }
  const backward = createRegistryIndex()
  for (const record of [...records].reverse()) {
    backward.publish(record)
  }
  const forwardList = forward.list()
  const backwardList = backward.list()
  assert.deepEqual(
    forwardList.map((record) => `${record.identity.id}@${record.identity.version.major}.${record.identity.version.minor}.${record.identity.version.patch}${record.identity.version.prerelease.length > 0 ? '-' + record.identity.version.prerelease.join('.') : ''}${record.identity.version.build.length > 0 ? '+' + record.identity.version.build.join('.') : ''}`),
    [
      '@demo/a@1.0.0-alpha.1',
      '@demo/a@1.0.0',
      '@demo/a@1.0.0+z',
      '@demo/a@1.2.0',
      '@demo/a@2.0.0',
      '@demo/b@2.0.0',
    ],
  )
  // Deterministic across insertion orders (E9).
  assert.deepEqual(
    forwardList.map((record) => record.identity.contentDigest),
    backwardList.map((record) => record.identity.contentDigest),
  )
})

test('listVersions is precedence-ordered with a deterministic tie-break', () => {
  const index = createRegistryIndex()
  for (const version of ['2.0.0', '1.0.0-alpha.1', '1.2.0', '1.0.0+z', '1.0.0']) {
    index.publish(makeRecord('assets', '@demo/a', version))
  }
  assert.deepEqual(
    index.listVersions('@demo/a').map((version) => JSON.stringify(version)),
    [
      JSON.stringify(semver('1.0.0-alpha.1')),
      JSON.stringify(semver('1.0.0')),
      JSON.stringify(semver('1.0.0+z')),
      JSON.stringify(semver('1.2.0')),
      JSON.stringify(semver('2.0.0')),
    ],
  )
  assert.deepEqual(index.listVersions('@demo/none'), [])
})

test('bestMatch selects the highest satisfying version deterministically', () => {
  const index = createRegistryIndex()
  for (const version of ['1.0.0', '1.4.2', '1.9.0', '2.0.0', '2.1.0-alpha.1']) {
    index.publish(makeRecord('system', 'demo-sys', version))
  }
  const caret = index.bestMatch('demo-sys', '^1.0.0')
  assert.ok(caret !== null)
  assert.equal(caret.identity.version.major, 1)
  assert.equal(caret.identity.version.minor, 9)

  const exact = index.bestMatch('demo-sys', '1.4.2')
  assert.ok(exact !== null)
  assert.equal(exact.identity.version.minor, 4)

  const any = index.bestMatch('demo-sys', '*')
  assert.ok(any !== null)
  assert.equal(any.identity.version.major, 2)

  // A 2.x prerelease does not satisfy caret 2.0.0 base tuple rules are
  // package-system's; here the highest satisfying is the 2.0.0 release.
  const tilde = index.bestMatch('demo-sys', '~2.0.0')
  assert.ok(tilde !== null)
  assert.equal(tilde.identity.version.patch, 0)

  assert.equal(index.bestMatch('demo-sys', '^3.0.0'), null)
  assert.equal(index.bestMatch('demo-none', '*'), null)
})

test('findProviders: capability lookup filtered by constraint', () => {
  const index = createRegistryIndex()
  const mesh = makeRecord('assets', '@demo/mesh', '1.0.0', {
    providedCapabilities: [capability('asset.mesh-format', '1.2.0')],
  })
  const legacy = makeRecord('assets', '@demo/legacy-mesh', '1.0.0', {
    providedCapabilities: [capability('asset.mesh-format', '0.9.0')],
  })
  const other = makeRecord('assets', '@demo/other', '1.0.0', {
    providedCapabilities: [capability('sim.deterministic-step', '1.0.0')],
  })
  for (const record of [mesh, legacy, other]) {
    index.publish(record)
  }
  const providers = index.findProviders(requires('asset.mesh-format', '^1.0.0'))
  assert.deepEqual(providers.map((record) => record.identity.id), ['@demo/mesh'])
  const any = index.findProviders(requires('asset.mesh-format', '*'))
  assert.deepEqual(
    any.map((record) => record.identity.id).sort(),
    ['@demo/legacy-mesh', '@demo/mesh'],
  )
  assert.deepEqual(index.findProviders(requires('no.such-capability', '*')), [])
})

test('findRequiring and findByPermission: permission/capability filters', () => {
  const index = createRegistryIndex()
  const { base, middle, top } = threePackageGraph()
  for (const record of [base, middle, top]) {
    index.publish(record)
  }
  assert.deepEqual(
    index.findRequiring('asset.mesh-format').map((record) => record.identity.id),
    ['@demo/middle', '@demo/top'],
  )
  assert.deepEqual(
    index.findByPermission('asset.mesh-format').map((record) => record.identity.id),
    ['@demo/middle'],
  )
  assert.deepEqual(index.findByPermission('no.such-capability'), [])
})

test('resolveLock: deterministic resolution reusing package-system (E9)', () => {
  const { base, middle, top } = threePackageGraph()
  const orderedIndex = createRegistryIndex()
  for (const record of [base, middle, top]) {
    orderedIndex.publish(record)
  }
  const shuffledIndex = createRegistryIndex()
  for (const record of [top, base, middle]) {
    shuffledIndex.publish(record)
  }
  const lock = makeLock([base, middle, top])
  const first = orderedIndex.resolveLock(lock)
  const second = orderedIndex.resolveLock(lock)
  const third = shuffledIndex.resolveLock(makeLock([top, middle, base]))

  assert.equal(first.ok, true)
  assert.deepEqual(first, second)
  assert.deepEqual(first, third)
  if (first.ok) {
    assert.deepEqual(first.topologicalOrder, ['@demo/base', '@demo/middle', '@demo/top'])
    assert.match(first.lockFingerprint, /^sha256:[0-9a-f]{64}$/)
  }
})

test('resolveLock rejects cyclic dependencies', () => {
  const a = makeRecord('system', '@demo/a', '1.0.0', {
    dependencies: [{ id: '@demo/b', constraint: '*', kind: null, optional: false }],
  })
  const b = makeRecord('system', '@demo/b', '1.0.0', {
    dependencies: [{ id: '@demo/a', constraint: '*', kind: null, optional: false }],
  })
  const index = createRegistryIndex()
  index.publish(a)
  index.publish(b)
  const result = index.resolveLock(makeLock([a, b]))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'cyclic-dependency')
  }
})

test('resolveLock rejects an unverified lockfile pin (tampered digest)', () => {
  const record = makeRecord('assets', '@demo/base', '1.0.0')
  const index = createRegistryIndex()
  index.publish(record)
  const lock = makeLock([record])
  ;(lock.packages[0] as { contentDigest: string }).contentDigest = computeDigest({
    tampered: true,
  })
  const result = index.resolveLock(lock)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'digest-mismatch')
  }
})

test('resolveLock passes an optional missing dependency but fails a missing required one', () => {
  const withOptional = makeRecord('world', '@demo/top', '1.0.0', {
    dependencies: [{ id: '@demo/absent', constraint: '*', kind: null, optional: true }],
  })
  const index = createRegistryIndex()
  index.publish(withOptional)
  assert.equal(index.resolveLock(makeLock([withOptional])).ok, true)

  const withRequired = makeRecord('world', '@demo/top2', '1.0.0', {
    dependencies: [{ id: '@demo/absent', constraint: '*', kind: null, optional: false }],
  })
  index.publish(withRequired)
  const result = index.resolveLock(makeLock([withRequired]))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'unpinned-dependency')
  }
})

test('provenance URLs with embedded credentials are rejected (no secret leakage)', () => {
  // Credential-like fixture assembled from fragments at runtime — no
  // secret-shaped literal in source.
  const [user, pass] = ['work', ['er', 'T0k', 'en'].join('')]
  const credentialedUrl = ['https', `://${user}:${pass}@`, 'example.invalid', '/repo'].join('')
  const index = createRegistryIndex()
  const tainted = makeRecord('assets', '@demo/leak', '1.0.0', {
    provenance: {
      origin: { type: 'repository', url: credentialedUrl },
      sourceCommit: null,
      transformationHistory: [{ kind: 'import', description: 'fixture import' }],
      modelProvenance: [],
      generatedByAi: false,
    },
  })
  const rejected = failure(index.publish(tainted))
  assert.equal(rejected.code, 'invalid-record')
  assert.ok(rejected.violations !== undefined)
})

test('empty index resolves an empty lock', () => {
  const index = createRegistryIndex()
  const result = index.resolveLock(makeLock([]))
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.packages, [])
    assert.deepEqual(result.topologicalOrder, [])
  }
})

test('makeMetadata default passes the release gate', () => {
  const index = createRegistryIndex()
  const record = makeRecord('assets', '@demo/default-meta', '1.0.0', makeMetadata())
  assert.equal(index.publish(record).ok, true)
})
