import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openRegistry } from './registry.ts'
import type { PackageRegistry, RegistryOpenResult } from './registry.ts'
import { InMemoryRegistryStore } from './registry-store.ts'
import type { RegistryStore } from './registry-store.ts'
import { makeLock, makeRecord, semver } from './test-fixtures.ts'
import type { PackageRecord } from '@playliquid/package-system'

const ok = async (result: RegistryOpenResult): Promise<PackageRegistry> => {
  assert.equal(result.ok, true, `expected open to succeed: ${JSON.stringify(result)}`)
  if (!result.ok) {
    throw new Error('unreachable')
  }
  return result.registry
}

test('openRegistry loads a clean store and resolves lookups', async () => {
  const store = new InMemoryRegistryStore()
  const record = makeRecord('assets', '@demo/base', '1.0.0')
  await store.putRecord(record)
  const registry = await ok(await openRegistry({ store }))
  assert.equal(registry.size(), 1)
  assert.deepEqual(
    registry.get({ kind: 'assets', id: '@demo/base', version: semver('1.0.0') }),
    registry.list()[0],
  )
})

test('openRegistry over an empty store yields an empty working registry', async () => {
  const registry = await ok(await openRegistry({ store: new InMemoryRegistryStore() }))
  assert.equal(registry.size(), 0)
  assert.deepEqual(registry.list(), [])
  assert.equal(registry.resolveLock(makeLock([])).ok, true)
})

test('openRegistry fails closed on a store with invalid records', async () => {
  const store = new InMemoryRegistryStore()
  const invalid = makeRecord('assets', '@demo/bad', '1.0.0', {
    license: { spdxExpression: '', status: 'verified' },
  })
  await store.putRecord(invalid)
  const result = await openRegistry({ store })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'invalid-store-record')
    assert.equal(result.failures.length, 1)
  }
})

test('openRegistry fails closed on a store with conflicting coordinates', async () => {
  const store = new InMemoryRegistryStore()
  await store.putRecord(makeRecord('assets', '@demo/a', '1.0.0'))
  await store.putRecord(
    makeRecord('assets', '@demo/a', '1.0.0', {
      resources: { minMemoryBytes: 4 },
    }),
  )
  const result = await openRegistry({ store })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'invalid-store-record')
    const code = result.failures[0]?.result
    assert.ok(code !== undefined && !code.ok && code.code === 'mutation-rejected')
  }
})

test('openRegistry surfaces a failing store port (listRecords error)', async () => {
  const failing: RegistryStore = {
    listRecords: async () => {
      throw new Error('store unavailable')
    },
    putRecord: async () => {},
  }
  const result = await openRegistry({ store: failing })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'invalid-store-record')
    assert.ok(result.message.includes('store unavailable'))
  }
})

test('publish persists through the store and is visible after reopen', async () => {
  const store = new InMemoryRegistryStore()
  const registry = await ok(await openRegistry({ store }))
  const record = makeRecord('system', '@demo/sys', '1.0.0')
  const result = await registry.publish(record)
  assert.equal(result.ok, true)
  assert.equal(store.recordCount, 1)

  const reopened = await ok(await openRegistry({ store }))
  assert.equal(reopened.size(), 1)
  assert.deepEqual(reopened.list()[0]?.identity.id, '@demo/sys')
})

test('publish is idempotent end-to-end: one store write, one index record', async () => {
  const store = new InMemoryRegistryStore()
  const registry = await ok(await openRegistry({ store }))
  const record = makeRecord('assets', '@demo/a', '1.0.0')
  const first = await registry.publish(record)
  const second = await registry.publish(record)
  assert.equal(first.ok && second.ok, true)
  if (first.ok && second.ok) {
    assert.equal(first.status, 'published')
    assert.equal(second.status, 'already-published')
  }
  assert.equal(store.recordCount, 1)
  assert.equal(registry.size(), 1)
})

test('publish with mutation is rejected and the store stays untouched', async () => {
  const store = new InMemoryRegistryStore()
  const registry = await ok(await openRegistry({ store }))
  const original = makeRecord('assets', '@demo/a', '1.0.0')
  assert.equal((await registry.publish(original)).ok, true)
  const mutated = makeRecord('assets', '@demo/a', '1.0.0', {
    resources: { minMemoryBytes: 2048 },
  })
  const rejected = await registry.publish(mutated)
  assert.equal(rejected.ok, false)
  if (!rejected.ok) {
    assert.equal(rejected.code, 'mutation-rejected')
  }
  assert.equal(store.recordCount, 1)
  assert.equal(registry.size(), 1)
})

test('a failing putRecord surfaces as store-error and never mutates the index', async () => {
  const store = new InMemoryRegistryStore()
  const broken: RegistryStore = {
    listRecords: () => store.listRecords(),
    putRecord: async () => {
      throw new Error('disk full')
    },
  }
  const registry = await ok(await openRegistry({ store: broken }))
  const result = await registry.publish(makeRecord('assets', '@demo/a', '1.0.0'))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'store-error')
    assert.ok(result.message.includes('disk full'))
  }
  assert.equal(registry.size(), 0)
  // A retry against a healthy port succeeds — publication is retriable.
  const healthy = await ok(await openRegistry({ store }))
  assert.equal((await healthy.publish(makeRecord('assets', '@demo/a', '1.0.0'))).ok, true)
})

test('concurrent conflicting publishes serialize: exactly one wins (E1/E2)', async () => {
  const store = new InMemoryRegistryStore()
  const registry = await ok(await openRegistry({ store }))
  const first = makeRecord('assets', '@demo/a', '1.0.0')
  const second = makeRecord('assets', '@demo/a', '1.0.0', {
    resources: { minMemoryBytes: 32 },
  })
  const [a, b] = await Promise.all([registry.publish(first), registry.publish(second)])
  const outcomes = [a, b].sort((x, y) => (x.ok === y.ok ? 0 : x.ok ? -1 : 1))
  const winner = outcomes[0]
  const loser = outcomes[1]
  assert.ok(winner !== undefined && winner.ok)
  assert.ok(loser !== undefined && !loser.ok && loser.code === 'mutation-rejected')
  assert.equal(registry.size(), 1)
  assert.equal(store.recordCount, 1)
})

test('the facade exposes the pure index and read operations', async () => {
  const store = new InMemoryRegistryStore()
  const registry = await ok(await openRegistry({ store }))
  const record = makeRecord('assets', '@demo/base', '1.0.0')
  await registry.publish(record)
  assert.equal(registry.index.size(), 1)
  assert.deepEqual(registry.snapshot(), registry.list())
  assert.deepEqual(registry.listVersions('@demo/base'), [semver('1.0.0')])
  assert.ok(registry.bestMatch('@demo/base', '*') !== null)
  assert.ok(registry.getByDigest(record.identity.contentDigest) !== null)
  assert.deepEqual(registry.findProviders({ id: 'none', constraint: '*' }), [])
})

test('the gate option flows through the facade (R19 default on)', async () => {
  const unverified: PackageRecord = makeRecord('assets', '@demo/u', '1.0.0', {
    license: { spdxExpression: 'MIT', status: 'declared' },
  })
  const strict = await ok(await openRegistry({ store: new InMemoryRegistryStore() }))
  const rejected = await strict.publish(unverified)
  assert.equal(rejected.ok, false)
  if (!rejected.ok) {
    assert.equal(rejected.code, 'release-gate')
  }

  const lenient = await ok(
    await openRegistry({ store: new InMemoryRegistryStore(), enforceReleaseGate: false }),
  )
  assert.equal((await lenient.publish(unverified)).ok, true)
})
