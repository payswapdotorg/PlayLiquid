import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildManifest,
  chunkSlices,
  verifyManifest,
} from './manifest.ts'
import { computeBlobDigest } from './digest.ts'
import { syntheticBytes } from './testing.ts'

test('chunkSlices cuts deterministic chunk boundaries', () => {
  const bytes = syntheticBytes(10)
  const slices = chunkSlices(bytes, 4)
  assert.deepEqual(
    slices.map((slice) => slice.byteLength),
    [4, 4, 2],
  )
  const first = slices[0]
  assert.ok(first !== undefined)
  assert.deepEqual([...first], [bytes[0], bytes[1], bytes[2], bytes[3]])
})

test('chunkSlices of the empty payload is empty', () => {
  assert.deepEqual(chunkSlices(new Uint8Array(0), 64), [])
})

test('chunkSlices of an exact multiple has no trailing empty chunk', () => {
  const slices = chunkSlices(syntheticBytes(8), 4)
  assert.equal(slices.length, 2)
})

test('buildManifest is deterministic across byte-identical payloads', () => {
  const first = buildManifest(syntheticBytes(1000, 7), 256, 'model/gltf-binary')
  const second = buildManifest(syntheticBytes(1000, 7), 256, 'model/gltf-binary')
  assert.deepEqual(first, second)
})

test('buildManifest records chunk count, sizes and per-chunk digests', () => {
  const payload = syntheticBytes(1000, 11)
  const slices = chunkSlices(payload, 256)
  const manifest = buildManifest(payload, 256, null)
  assert.equal(manifest.sizeBytes, 1000)
  assert.equal(manifest.chunkSize, 256)
  assert.equal(manifest.chunkCount, 4)
  assert.equal(manifest.mediaType, null)
  assert.equal(manifest.chunks.length, 4)
  assert.deepEqual(
    manifest.chunks.map((chunk) => chunk.sizeBytes),
    [256, 256, 256, 232],
  )
  for (const chunk of manifest.chunks) {
    const slice = slices[chunk.index]
    assert.ok(slice !== undefined)
    assert.equal(chunk.digest, computeBlobDigest(slice))
  }
  assert.equal(manifest.digest, computeBlobDigest(payload))
})

test('buildManifest of the empty payload has zero chunks', () => {
  const manifest = buildManifest(new Uint8Array(0), 64, 'application/empty')
  assert.equal(manifest.sizeBytes, 0)
  assert.equal(manifest.chunkCount, 0)
  assert.deepEqual(manifest.chunks, [])
  assert.equal(
    manifest.digest,
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
})

test('verifyManifest accepts honest content and rejects tampering (E10)', () => {
  const bytes = syntheticBytes(700, 3)
  const manifest = buildManifest(bytes, 256, null)
  assert.equal(verifyManifest(manifest, bytes), true)

  const flipped = bytes.slice()
  flipped[300] = (flipped[300] ?? 0) ^ 0xff
  assert.equal(verifyManifest(manifest, flipped), false)

  const forged = { ...manifest, digest: 'sha256:' + '0'.repeat(64) }
  assert.equal(verifyManifest(forged, bytes), false)

  assert.equal(verifyManifest(manifest, syntheticBytes(700, 4)), false)
})
