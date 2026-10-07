import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryBlobStore } from './ports.ts'
import { buildManifest } from './manifest.ts'
import { syntheticBytes } from './testing.ts'

const digestOf = (bytes: Uint8Array): string => {
  // Local import-free computation is not needed; use the manifest digest.
  return buildManifest(bytes, 64, null).digest
}

test('putChunk/putManifest/readChunk round-trips chunk bytes', () => {
  const store = new InMemoryBlobStore()
  const bytes = syntheticBytes(150, 5)
  const manifest = buildManifest(bytes, 64, null)
  store.putChunk(manifest.digest, 0, bytes.slice(0, 64))
  store.putChunk(manifest.digest, 1, bytes.slice(64, 128))
  store.putChunk(manifest.digest, 2, bytes.slice(128, 150))
  store.putManifest(manifest)

  const chunk = store.readChunk(manifest.digest, 1)
  assert.ok(chunk !== null)
  assert.deepEqual([...chunk], [...bytes.slice(64, 128)])
  assert.deepEqual(store.manifestOf(manifest.digest), manifest)
})

test('readChunk copies bytes so callers cannot corrupt the store', () => {
  const store = new InMemoryBlobStore()
  const bytes = syntheticBytes(64, 9)
  const manifest = buildManifest(bytes, 64, null)
  store.putChunk(manifest.digest, 0, bytes)
  store.putManifest(manifest)

  const chunk = store.readChunk(manifest.digest, 0)
  assert.ok(chunk !== null)
  chunk[0] = (chunk[0] ?? 0) ^ 0xff
  const again = store.readChunk(manifest.digest, 0)
  assert.ok(again !== null)
  assert.equal(again[0], bytes[0])
})

test('putChunk copies bytes so callers cannot mutate stored chunks', () => {
  const store = new InMemoryBlobStore()
  const bytes = syntheticBytes(64, 21)
  const manifest = buildManifest(bytes, 64, null)
  const shared = bytes.slice()
  store.putChunk(manifest.digest, 0, shared)
  store.putManifest(manifest)

  shared[1] = (shared[1] ?? 0) ^ 0xff
  const chunk = store.readChunk(manifest.digest, 0)
  assert.ok(chunk !== null)
  assert.equal(chunk[1], bytes[1])
})

test('unknown digests read as null', () => {
  const store = new InMemoryBlobStore()
  assert.equal(store.readChunk('sha256:' + 'a'.repeat(64), 0), null)
  assert.equal(store.manifestOf('sha256:' + 'a'.repeat(64)), null)
})

test('putManifest rejects finalizing an incomplete blob', () => {
  const store = new InMemoryBlobStore()
  const bytes = syntheticBytes(130, 13)
  const manifest = buildManifest(bytes, 64, null)
  store.putChunk(manifest.digest, 0, bytes.slice(0, 64))
  assert.throws(() => store.putManifest(manifest), /incomplete blob/)
})

test('putManifest accepts the zero-chunk empty blob', () => {
  const store = new InMemoryBlobStore()
  const manifest = buildManifest(new Uint8Array(0), 64, 'application/empty')
  store.putManifest(manifest)
  assert.deepEqual(store.manifestOf(manifest.digest), manifest)
})

test('putManifest rejects a conflicting manifest for the same digest', () => {
  const store = new InMemoryBlobStore()
  const bytes = syntheticBytes(64, 31)
  const manifest = buildManifest(bytes, 64, 'model/gltf-binary')
  store.putChunk(manifest.digest, 0, bytes)
  store.putManifest(manifest)

  const conflicting = buildManifest(bytes, 64, 'image/png')
  assert.throws(() => store.putManifest(conflicting), /conflicting manifest/)

  // Identical re-put stays idempotent.
  store.putManifest(manifest)
  assert.deepEqual(store.manifestOf(manifest.digest), manifest)
})

test('late chunk writes after finalization are rejected', () => {
  const store = new InMemoryBlobStore()
  const bytes = syntheticBytes(64, 41)
  const manifest = buildManifest(bytes, 64, null)
  store.putChunk(manifest.digest, 0, bytes)
  store.putManifest(manifest)
  assert.throws(
    () => store.putChunk(manifest.digest, 0, bytes),
    /finalized/,
  )
})

test('corruptChunkForTests flips a stored byte (E10 test seam)', () => {
  const store = new InMemoryBlobStore()
  const bytes = syntheticBytes(64, 51)
  const digest = digestOf(bytes)
  const manifest = buildManifest(bytes, 64, null)
  store.putChunk(digest, 0, bytes)
  store.putManifest(manifest)

  assert.equal(store.corruptChunkForTests(digest, 0), true)
  const chunk = store.readChunk(digest, 0)
  assert.ok(chunk !== null)
  assert.notEqual(chunk[0], bytes[0])

  assert.equal(store.corruptChunkForTests('sha256:' + 'b'.repeat(64), 0), false)
  assert.equal(store.corruptChunkForTests(digest, 9), false)
})
