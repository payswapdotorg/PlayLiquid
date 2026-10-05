import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from './resolve.ts'
import type { PackageIndex, ResolutionError } from './resolve.ts'
import type { PackageLock } from './lockfile.ts'
import { makeLock, makePin, makeRecord } from './test-fixtures.ts'
import { sealPackageRecord } from './package-digest.ts'
import type { PackageRecord } from './package-record.ts'

const err = (result: ReturnType<typeof resolve>): ResolutionError => {
  assert.equal(result.ok, false, 'expected a resolution error')
  return result as ResolutionError
}

function threePackageGraph(): { records: PackageRecord[]; lock: PackageLock } {
  const base = makeRecord('assets', '@demo/base', '1.0.0')
  const middle = makeRecord('system', '@demo/middle', '1.1.0', {
    dependencies: [{ id: '@demo/base', constraint: '^1.0.0', kind: 'assets', optional: false }],
  })
  const top = makeRecord('world', '@demo/top', '2.0.0', {
    dependencies: [
      { id: '@demo/base', constraint: '*', kind: null, optional: false },
      { id: '@demo/middle', constraint: '^1.0.0', kind: 'system', optional: false },
    ],
  })
  const records = [base, middle, top]
  return { records, lock: makeLock(records) }
}

test('resolves a three-package graph with dependencies-first order', () => {
  const { records, lock } = threePackageGraph()
  const result = resolve(lock, { records })
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.deepEqual(result.topologicalOrder, ['@demo/base', '@demo/middle', '@demo/top'])
  assert.deepEqual(
    result.dependencyGraph,
    [
      { id: '@demo/base', dependsOn: [] },
      { id: '@demo/middle', dependsOn: ['@demo/base'] },
      { id: '@demo/top', dependsOn: ['@demo/base', '@demo/middle'] },
    ],
  )
  assert.deepEqual(
    result.packages.map((entry) => entry.record.identity.id),
    ['@demo/base', '@demo/middle', '@demo/top'],
  )
})

test('determinism: the same lock and index resolve deep-equal, run twice', () => {
  const { records, lock } = threePackageGraph()
  const first = resolve(lock, { records })
  const second = resolve(lock, { records })
  assert.deepEqual(first, second)
})

test('determinism: pin order in the lock does not change the resolution', () => {
  const { records } = threePackageGraph()
  const [base, middle, top] = records as [PackageRecord, PackageRecord, PackageRecord]
  const ordered = makeLock([base, middle, top])
  const shuffled = makeLock([top, base, middle])
  assert.deepEqual(resolve(ordered, { records }), resolve(shuffled, { records }))
})

test('determinism: index record order does not change the resolution', () => {
  const { records, lock } = threePackageGraph()
  const [base, middle, top] = records as [PackageRecord, PackageRecord, PackageRecord]
  assert.deepEqual(resolve(lock, { records }), resolve(lock, { records: [top, middle, base] }))
})

test('rejection: cyclic dependencies report the cycle path', () => {
  const a = makeRecord('system', '@demo/a', '1.0.0', {
    dependencies: [{ id: '@demo/b', constraint: '*', kind: null, optional: false }],
  })
  const b = makeRecord('system', '@demo/b', '1.0.0', {
    dependencies: [{ id: '@demo/c', constraint: '*', kind: null, optional: false }],
  })
  const c = makeRecord('system', '@demo/c', '1.0.0', {
    dependencies: [{ id: '@demo/a', constraint: '*', kind: null, optional: false }],
  })
  const records = [a, b, c]
  const error = err(resolve(makeLock(records), { records }))
  assert.equal(error.code, 'cyclic-dependency')
  assert.deepEqual(error.cyclePath, ['@demo/a', '@demo/b', '@demo/c', '@demo/a'])
})

test('rejection: self-dependency is a cycle', () => {
  const a = makeRecord('system', '@demo/a', '1.0.0', {
    dependencies: [{ id: '@demo/a', constraint: '*', kind: null, optional: false }],
  })
  const error = err(resolve(makeLock([a]), { records: [a] }))
  assert.equal(error.code, 'cyclic-dependency')
  assert.deepEqual(error.cyclePath, ['@demo/a', '@demo/a'])
})

test('rejection: pinned package missing from the index', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const error = err(resolve(makeLock([a]), { records: [] }))
  assert.equal(error.code, 'missing-package')
  assert.equal(error.packageId, '@demo/a')
})

test('rejection: index lacks the pinned version', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const aNext = makeRecord('assets', '@demo/a', '1.1.0')
  const error = err(resolve(makeLock([aNext]), { records: [a] }))
  assert.equal(error.code, 'missing-package')
})

test('rejection (E8): pin digest does not match the record digest', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const tamperedPin = makeLock([a])
  ;(tamperedPin.packages[0] as { contentDigest: string }).contentDigest =
    'sha256:' + '0'.repeat(64)
  const error = err(resolve(tamperedPin, { records: [a] }))
  assert.equal(error.code, 'digest-mismatch')
})

test('rejection (E8): record whose declared digest does not match its content', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const tampered: PackageRecord = {
    ...a,
    metadata: { ...a.metadata, resources: { minStorageBytes: 12345 } },
  }
  const error = err(resolve(makeLock([a]), { records: [tampered] }))
  assert.equal(error.code, 'tampered-record')
})

test('rejection: semver mismatch between dependency constraint and pinned version', () => {
  const base = makeRecord('assets', '@demo/base', '2.0.0')
  const top = makeRecord('world', '@demo/top', '1.0.0', {
    dependencies: [{ id: '@demo/base', constraint: '^1.0.0', kind: null, optional: false }],
  })
  const records = [base, top]
  const error = err(resolve(makeLock(records), { records }))
  assert.equal(error.code, 'version-mismatch')
  assert.equal(error.packageId, '@demo/base')
})

test('rejection: non-optional dependency not pinned in the lock', () => {
  const base = makeRecord('assets', '@demo/base', '1.0.0')
  const top = makeRecord('world', '@demo/top', '1.0.0', {
    dependencies: [{ id: '@demo/base', constraint: '*', kind: null, optional: false }],
  })
  const error = err(resolve(makeLock([top]), { records: [base, top] }))
  assert.equal(error.code, 'unpinned-dependency')
})

test('optional dependencies may be absent from the lock', () => {
  const base = makeRecord('assets', '@demo/base', '1.0.0')
  const top = makeRecord('world', '@demo/top', '1.0.0', {
    dependencies: [{ id: '@demo/base', constraint: '*', kind: null, optional: true }],
  })
  const result = resolve(makeLock([top]), { records: [base, top] })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.dependencyGraph, [{ id: '@demo/top', dependsOn: [] }])
  }
})

test('optional dependencies are validated when present', () => {
  const base = makeRecord('assets', '@demo/base', '5.0.0')
  const top = makeRecord('world', '@demo/top', '1.0.0', {
    dependencies: [{ id: '@demo/base', constraint: '^1.0.0', kind: null, optional: true }],
  })
  const records = [base, top]
  const error = err(resolve(makeLock(records), { records }))
  assert.equal(error.code, 'version-mismatch')
})

test('rejection: pin kind does not match record kind', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const pin = makeLock([a])
  ;(pin.packages[0] as { kind: 'world' }).kind = 'world'
  const error = err(resolve(pin, { records: [a] }))
  assert.equal(error.code, 'kind-mismatch')
})

test('rejection: dependency kind expectation violated', () => {
  const base = makeRecord('assets', '@demo/base', '1.0.0')
  const top = makeRecord('world', '@demo/top', '1.0.0', {
    dependencies: [{ id: '@demo/base', constraint: '*', kind: 'system', optional: false }],
  })
  const records = [base, top]
  const error = err(resolve(makeLock(records), { records }))
  assert.equal(error.code, 'dependency-kind-mismatch')
})

test('rejection: duplicate pins for the same id', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const lock = makeLock([a])
  const duplicated = { ...lock, packages: [makePin(a), makePin(a)] }
  const error = err(resolve(duplicated, { records: [a] }))
  assert.equal(error.code, 'duplicate-pin')
})

test('rejection: duplicate records for the same coordinate in the index', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const error = err(resolve(makeLock([a]), { records: [a, a] }))
  assert.equal(error.code, 'duplicate-record')
})

test('rejection: invalid lock structure', () => {
  const a = makeRecord('assets', '@demo/a', '1.0.0')
  const bad = { ...makeLock([a]), lockVersion: 99 } as unknown as PackageLock
  assert.equal(err(resolve(bad, { records: [a] })).code, 'invalid-lock')
  assert.equal(err(resolve(null as unknown as PackageLock, { records: [] })).code, 'invalid-lock')
  assert.equal(
    err(resolve(makeLock([a]), null as unknown as PackageIndex)).code,
    'invalid-index',
  )
})

test('rejection: capability not provided by any resolved package or the host', () => {
  const top = makeRecord('world', '@demo/top', '1.0.0', {
    requiredCapabilities: [{ id: 'sim.deterministic-step', constraint: '^1.0.0' }],
  })
  const error = err(resolve(makeLock([top]), { records: [top] }))
  assert.equal(error.code, 'unsatisfied-capability')
})

test('capabilities satisfied by the host pass closure', () => {
  const top = makeRecord('world', '@demo/top', '1.0.0', {
    requiredCapabilities: [{ id: 'sim.deterministic-step', constraint: '^1.0.0' }],
  })
  const lock = makeLock([top], [
    { id: 'sim.deterministic-step', version: top.identity.version },
  ])
  assert.equal(resolve(lock, { records: [top] }).ok, true)
})

test('capabilities satisfied by another resolved package pass closure', () => {
  const provider = makeRecord('system', '@demo/provider', '1.0.0', {
    providedCapabilities: [
      { id: 'sim.deterministic-step', version: { major: 1, minor: 2, patch: 0, prerelease: [], build: [] } },
    ],
  })
  const consumer = makeRecord('world', '@demo/consumer', '1.0.0', {
    dependencies: [{ id: '@demo/provider', constraint: '*', kind: null, optional: false }],
    requiredCapabilities: [{ id: 'sim.deterministic-step', constraint: '^1.0.0' }],
  })
  const records = [provider, consumer]
  const result = resolve(makeLock(records), { records })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.topologicalOrder, ['@demo/provider', '@demo/consumer'])
  }
})

test('rejection: overlay target missing from the lock', () => {
  const base = makeRecord('world', '@demo/base-world', '1.0.0')
  const overlay = makeRecord('overlay', '@demo/overlay', '0.1.0', {
    overlay: {
      target: {
        kind: base.identity.kind,
        id: base.identity.id,
        version: base.identity.version,
        contentDigest: base.identity.contentDigest,
      },
      overrides: [
        {
          path: 'world.regions[0].rules.combat',
          valueDigest: 'sha256:' + '1'.repeat(64),
        },
      ],
    },
  })
  const error = err(resolve(makeLock([overlay]), { records: [base, overlay] }))
  assert.equal(error.code, 'missing-overlay-target')
})

test('rejection: overlay target pinned at a different coordinate', () => {
  const baseV1 = makeRecord('world', '@demo/base-world', '1.0.0')
  const baseV2 = makeRecord('world', '@demo/base-world', '1.0.1')
  const overlay = makeRecord('overlay', '@demo/overlay', '0.1.0', {
    overlay: {
      target: {
        kind: baseV1.identity.kind,
        id: baseV1.identity.id,
        version: baseV1.identity.version,
        contentDigest: baseV1.identity.contentDigest,
      },
      overrides: [],
    },
  })
  const records = [baseV1, baseV2, overlay]
  const error = err(resolve(makeLock([baseV2, overlay]), { records }))
  assert.equal(error.code, 'overlay-target-mismatch')
})

test('overlays resolve when the exact target is pinned', () => {
  const base = makeRecord('world', '@demo/base-world', '1.0.0')
  const overlay = makeRecord('overlay', '@demo/overlay', '0.1.0', {
    overlay: {
      target: {
        kind: base.identity.kind,
        id: base.identity.id,
        version: base.identity.version,
        contentDigest: base.identity.contentDigest,
      },
      overrides: [
        { path: 'world.rules.combat', valueDigest: 'sha256:' + '2'.repeat(64) },
      ],
    },
  })
  const records = [base, overlay]
  const result = resolve(makeLock(records), { records })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.topologicalOrder, ['@demo/base-world', '@demo/overlay'])
  }
})

test('records with undeclared-capability permissions are rejected', () => {
  const bad = sealPackageRecord({
    identity: { kind: 'system', id: '@demo/bad', version: makeRecord('system', '@demo/x', '1.0.0').identity.version },
    metadata: {
      ...makeRecord('system', '@demo/x', '1.0.0').metadata,
      permissions: [{ capability: 'net.fetch', access: 'write' }],
    },
  })
  const error = err(resolve(makeLock([bad]), { records: [bad] }))
  assert.equal(error.code, 'invalid-record')
})

test('empty lock resolves to an empty graph', () => {
  const result = resolve(makeLock([]), { records: [] })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.packages, [])
    assert.deepEqual(result.topologicalOrder, [])
    assert.deepEqual(result.dependencyGraph, [])
  }
})
