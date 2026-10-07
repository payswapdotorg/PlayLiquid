import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryRegistryStore } from './registry-store.ts'
import { makeRecord, makeUnsealedRecord, seal } from './test-fixtures.ts'

test('putRecord/listRecords round-trips records in insertion order', async () => {
  const store = new InMemoryRegistryStore()
  const first = makeRecord('assets', '@demo/a', '1.0.0')
  const second = makeRecord('system', '@demo/b', '2.0.0')
  await store.putRecord(first)
  await store.putRecord(second)
  const records = await store.listRecords()
  assert.equal(records.length, 2)
  assert.deepEqual(records[0], first)
  assert.deepEqual(records[1], second)
})

test('putRecord is idempotent for the identical coordinate+digest', async () => {
  const store = new InMemoryRegistryStore()
  const record = makeRecord('assets', '@demo/a', '1.0.0')
  await store.putRecord(record)
  await store.putRecord(record)
  await store.putRecord(makeRecord('assets', '@demo/a', '1.0.0'))
  assert.equal(store.recordCount, 1)
})

test('putRecord admits different versions and digests (registry enforces policy)', async () => {
  const store = new InMemoryRegistryStore()
  await store.putRecord(makeRecord('assets', '@demo/a', '1.0.0'))
  await store.putRecord(makeRecord('assets', '@demo/a', '1.1.0'))
  await store.putRecord(
    makeRecord('assets', '@demo/a', '1.0.0', {
      resources: { minMemoryBytes: 1 },
    }),
  )
  assert.equal(store.recordCount, 3)
  // The store is a dumb persistence edge; the registry index is the
  // authority that fail-closes on the conflicting third record.
})

test('listRecords returns a defensive copy', async () => {
  const store = new InMemoryRegistryStore()
  await store.putRecord(makeRecord('assets', '@demo/a', '1.0.0'))
  const first = await store.listRecords()
  const second = await store.listRecords()
  assert.equal(first.length, 1)
  assert.notEqual(first, second)
  assert.deepEqual(first, second)
})

test('unsealed records seal deterministically (fixture sanity)', () => {
  const unsealed = makeUnsealedRecord('assets', '@demo/c', '3.1.4')
  assert.deepEqual(seal(unsealed), seal(makeUnsealedRecord('assets', '@demo/c', '3.1.4')))
  assert.notDeepEqual(
    seal(unsealed),
    seal(makeUnsealedRecord('assets', '@demo/c', '3.1.5')),
  )
})
