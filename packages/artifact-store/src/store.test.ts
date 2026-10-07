import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createArtifactStore, DEFAULT_CHUNK_SIZE } from './store.ts'
import type { ArtifactFailure, ArtifactStore } from './store.ts'
import { ArtifactIntegrityError } from './store.ts'
import { computeBlobDigest } from './digest.ts'
import { InMemoryBlobStore } from './ports.ts'
import type { ChunkedBlobStore } from './ports.ts'
import { syntheticBytes } from './testing.ts'

const failure = (result: { ok: boolean }): ArtifactFailure => {
  assert.equal(result.ok, false, `expected a failure, received: ${JSON.stringify(result)}`)
  return result as ArtifactFailure
}

function seededStore(chunkSize = 64): {
  store: ArtifactStore
  blobs: InMemoryBlobStore
} {
  const blobs = new InMemoryBlobStore()
  return { store: createArtifactStore({ blobStore: blobs, chunkSize }), blobs }
}

test('store → fetch round-trips a multi-chunk payload byte-exactly', () => {
  const { store } = seededStore()
  const payload = syntheticBytes(1000, 17)
  const result = store.store(payload)
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.equal(result.deduplicated, false)
  assert.equal(result.manifest.chunkCount, 16)
  assert.equal(result.manifest.digest, computeBlobDigest(payload))

  const fetched = store.fetch(result.manifest.digest)
  assert.equal(fetched.ok, true)
  if (!fetched.ok) {
    return
  }
  assert.deepEqual([...fetched.bytes], [...payload])
  assert.deepEqual(fetched.manifest, result.manifest)
})

test('E7 large payload: 512 KiB across the default 64 KiB chunks', () => {
  const blobs = new InMemoryBlobStore()
  const store = createArtifactStore({ blobStore: blobs })
  const payload = syntheticBytes(DEFAULT_CHUNK_SIZE * 8, 23)
  const result = store.store(payload)
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.equal(result.manifest.chunkCount, 8)
  assert.equal(result.manifest.chunkSize, DEFAULT_CHUNK_SIZE)
  assert.equal(blobs.blobCount, 1)

  const fetched = store.fetch(result.manifest.digest)
  assert.equal(fetched.ok, true)
  if (!fetched.ok) {
    return
  }
  assert.equal(fetched.bytes.byteLength, payload.byteLength)
  assert.deepEqual([...fetched.bytes], [...payload])
})

test('empty payload: store, fetch, stat and zero-length ranges', () => {
  const { store } = seededStore()
  const result = store.store(new Uint8Array(0))
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.equal(result.manifest.digest, computeBlobDigest(new Uint8Array(0)))
  assert.equal(result.manifest.sizeBytes, 0)
  assert.equal(result.manifest.chunkCount, 0)

  const fetched = store.fetch(result.manifest.digest)
  assert.equal(fetched.ok, true)
  if (!fetched.ok) {
    return
  }
  assert.equal(fetched.bytes.byteLength, 0)

  const empty = store.readRange(result.manifest.digest, 0, 0)
  assert.equal(empty.ok, true)
  if (empty.ok) {
    assert.equal(empty.bytes.byteLength, 0)
  }
})

test('determinism: byte-identical payloads dedupe to one blob (E9)', () => {
  const { store, blobs } = seededStore()
  const first = store.store(syntheticBytes(300, 99))
  const second = store.store(syntheticBytes(300, 99))
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) {
    return
  }
  assert.equal(second.deduplicated, true)
  assert.equal(first.manifest.digest, second.manifest.digest)
  assert.deepEqual(second.manifest, first.manifest)
  assert.equal(blobs.blobCount, 1)
})

test('one differing byte produces a different digest and a second blob', () => {
  const { store, blobs } = seededStore()
  const first = store.store(syntheticBytes(300, 99))
  const mutated = syntheticBytes(300, 99)
  mutated[150] = (mutated[150] ?? 0) ^ 0x01
  const second = store.store(mutated)
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) {
    return
  }
  assert.notEqual(first.manifest.digest, second.manifest.digest)
  assert.equal(blobs.blobCount, 2)
})

test('media types: recorded, idempotent, conflicting and invalid', () => {
  const { store } = seededStore()
  const payload = syntheticBytes(64, 7)
  const stored = store.store(payload, { mediaType: 'model/gltf-binary' })
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const stat = store.stat(stored.manifest.digest)
  assert.ok(stat !== null)
  assert.equal(stat.mediaType, 'model/gltf-binary')

  const again = store.store(payload, { mediaType: 'model/gltf-binary' })
  assert.equal(again.ok, true)
  if (again.ok) {
    assert.equal(again.deduplicated, true)
  }

  const unasserted = store.store(payload)
  assert.equal(unasserted.ok, true)

  const conflict = failure(store.store(payload, { mediaType: 'image/png' }))
  assert.equal(conflict.code, 'media-type-conflict')

  const invalid = failure(store.store(syntheticBytes(8, 8), { mediaType: 'not a media type' }))
  assert.equal(invalid.code, 'invalid-media-type')
})

test('unknown digest: fetch, range and openRead fail closed', () => {
  const { store } = seededStore()
  const unknown = 'sha256:' + 'c'.repeat(64)
  assert.equal(failure(store.fetch(unknown)).code, 'unknown-digest')
  assert.equal(failure(store.readRange(unknown, 0, 1)).code, 'unknown-digest')
  assert.equal(failure(store.openRead(unknown)).code, 'unknown-digest')
  assert.equal(store.stat(unknown), null)
})

test('malformed digest arguments are rejected, never resolved', () => {
  const { store } = seededStore()
  assert.equal(failure(store.fetch('not-a-digest')).code, 'invalid-digest')
  assert.equal(failure(store.fetch('sha256:deadbeef')).code, 'invalid-digest')
  assert.equal(store.stat('sha256:xyz'), null)
})

test('E10 corrupted fetch: chunk tampering is a hard integrity failure', () => {
  const { store, blobs } = seededStore()
  const payload = syntheticBytes(200, 61)
  const stored = store.store(payload)
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const digest = stored.manifest.digest
  assert.equal(blobs.corruptChunkForTests(digest, 1), true)

  const corrupted = failure(store.fetch(digest))
  assert.equal(corrupted.code, 'integrity')
  assert.ok(corrupted.message.includes('chunk 1'))
  assert.ok(corrupted.expectedDigest !== undefined)
})

test('E10 corrupted fetch: a missing chunk is a hard integrity failure', () => {
  const blobs = new InMemoryBlobStore()
  const store = createArtifactStore({ blobStore: blobs, chunkSize: 64 })
  const stored = store.store(syntheticBytes(130, 71))
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const digest = stored.manifest.digest
  // Simulate a dropped chunk by building a fresh store that only persists
  // chunks 0 and 2 behind the same manifest.
  const decaying: ChunkedBlobStore = {
    putChunk: () => {},
    putManifest: () => {},
    manifestOf: (query) => (query === digest ? blobs.manifestOf(digest) : null),
    readChunk: (query, index) => (index === 1 ? null : blobs.readChunk(query, index)),
  }
  const degraded = createArtifactStore({ blobStore: decaying, chunkSize: 64 })
  const result = failure(degraded.fetch(digest))
  assert.equal(result.code, 'integrity')
  assert.ok(result.message.includes('missing'))
})

test('E10 digest collision mismatch: forged manifest fails the overall digest', () => {
  const blobs = new InMemoryBlobStore()
  const store = createArtifactStore({ blobStore: blobs, chunkSize: 64 })
  const honest = store.store(syntheticBytes(128, 81))
  assert.equal(honest.ok, true)
  const decoy = store.store(syntheticBytes(128, 82))
  assert.equal(decoy.ok, true)
  if (!honest.ok || !decoy.ok) {
    return
  }

  // A hostile source serves the decoy blob's HONEST chunk records under a
  // manifest whose top-level digest claims the honest digest (same digest,
  // different bytes). Per-chunk verification passes; the overall digest
  // check catches the forgery.
  const claimed = honest.manifest
  const decoyManifest = decoy.manifest
  const decoyDigest = decoyManifest.digest
  const forgedManifest = { ...decoyManifest, digest: claimed.digest }
  const forged: ChunkedBlobStore = {
    putChunk: () => {},
    putManifest: () => {},
    manifestOf: (query) => (query === claimed.digest ? forgedManifest : blobs.manifestOf(query)),
    readChunk: (query, index) =>
      query === claimed.digest ? blobs.readChunk(decoyDigest, index) : blobs.readChunk(query, index),
  }
  const hostile = createArtifactStore({ blobStore: forged, chunkSize: 64 })
  const result = failure(hostile.fetch(claimed.digest))
  assert.equal(result.code, 'integrity')
  assert.ok(result.message.includes('hashes to'))
  assert.equal(result.expectedDigest, claimed.digest)
  assert.equal(result.actualDigest, decoyDigest)
})

test('E10 corrupted re-store: dedupe refuses to succeed over decayed content', () => {
  const { store, blobs } = seededStore()
  const payload = syntheticBytes(100, 91)
  const stored = store.store(payload)
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  assert.equal(blobs.corruptChunkForTests(stored.manifest.digest, 0), true)
  const reStored = failure(store.store(payload))
  assert.equal(reStored.code, 'integrity')
})

test('write-path integrity: a port that mutates bytes on write fails closed', () => {
  const blobs = new InMemoryBlobStore()
  const sabotaged: ChunkedBlobStore = {
    putChunk: (digest, index, bytes) => {
      const mutated = bytes.slice()
      if (mutated.byteLength > 0) {
        mutated[0] = (mutated[0] ?? 0) ^ 0xff
      }
      blobs.putChunk(digest, index, mutated)
    },
    putManifest: (manifest) => blobs.putManifest(manifest),
    manifestOf: (digest) => blobs.manifestOf(digest),
    readChunk: (digest, index) => blobs.readChunk(digest, index),
  }
  const store = createArtifactStore({ blobStore: sabotaged, chunkSize: 64 })
  const result = failure(store.store(syntheticBytes(100, 101)))
  assert.equal(result.code, 'integrity')
})

test('readRange: bounds validation fails closed', () => {
  const { store } = seededStore()
  const stored = store.store(syntheticBytes(200, 111))
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const digest = stored.manifest.digest
  assert.equal(failure(store.readRange(digest, -1, 10)).code, 'invalid-range')
  assert.equal(failure(store.readRange(digest, 0, -1)).code, 'invalid-range')
  assert.equal(failure(store.readRange(digest, 0, 201)).code, 'invalid-range')
  assert.equal(failure(store.readRange(digest, 200, 1)).code, 'invalid-range')
  assert.equal(failure(store.readRange(digest, 1.5, 1)).code, 'invalid-range')
  // Offset at end-of-blob with zero length is valid and empty.
  const atEnd = store.readRange(digest, 200, 0)
  assert.equal(atEnd.ok, true)
})

test('readRange: byte-exact ranges across chunk boundaries', () => {
  const { store } = seededStore()
  const payload = syntheticBytes(200, 121)
  const stored = store.store(payload)
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const digest = stored.manifest.digest

  const within = store.readRange(digest, 10, 30)
  assert.equal(within.ok, true)
  if (within.ok) {
    assert.deepEqual([...within.bytes], [...payload.slice(10, 40)])
  }

  const across = store.readRange(digest, 60, 80)
  assert.equal(across.ok, true)
  if (across.ok) {
    assert.deepEqual([...across.bytes], [...payload.slice(60, 140)])
  }

  const tail = store.readRange(digest, 190, 10)
  assert.equal(tail.ok, true)
  if (tail.ok) {
    assert.deepEqual([...tail.bytes], [...payload.slice(190, 200)])
  }
})

test('readRange: a corrupted chunk inside the range fails; outside it succeeds', () => {
  const { store, blobs } = seededStore()
  const payload = syntheticBytes(200, 131)
  const stored = store.store(payload)
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const digest = stored.manifest.digest
  assert.equal(blobs.corruptChunkForTests(digest, 2), true)

  const overlapping = failure(store.readRange(digest, 128, 10))
  assert.equal(overlapping.code, 'integrity')

  // Chunk 2 covers [128, 192); a range fully inside chunk 1 is untouched.
  const untouched = store.readRange(digest, 64, 10)
  assert.equal(untouched.ok, true)
  if (untouched.ok) {
    assert.deepEqual([...untouched.bytes], [...payload.slice(64, 74)])
  }
})

test('openWrite: streamed appends in unaligned pieces produce the same blob', () => {
  const { store, blobs } = seededStore()
  const payload = syntheticBytes(500, 141)
  const session = store.openWrite()
  session.append(payload.slice(0, 33))
  session.append(payload.slice(33, 300))
  session.append(payload.slice(300))
  const result = session.finalize({ mediaType: 'application/octet-stream' })
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.equal(result.manifest.digest, computeBlobDigest(payload))
  assert.equal(result.manifest.sizeBytes, 500)
  assert.equal(result.manifest.chunkCount, 8)
  assert.equal(result.manifest.mediaType, 'application/octet-stream')
  assert.equal(blobs.blobCount, 1)

  const fetched = store.fetch(result.manifest.digest)
  assert.equal(fetched.ok, true)
  if (!fetched.ok) {
    return
  }
  assert.deepEqual([...fetched.bytes], [...payload])
})

test('openWrite: empty stream stores the empty blob; re-finalize throws', () => {
  const { store } = seededStore()
  const session = store.openWrite()
  session.append(new Uint8Array(0))
  const result = session.finalize()
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.equal(result.manifest.sizeBytes, 0)
  assert.throws(() => session.finalize(), /finalized/)
  assert.throws(() => session.append(new Uint8Array(1)), /finalized/)
})

test('openWrite dedupes against an identical direct store', () => {
  const { store } = seededStore()
  const payload = syntheticBytes(150, 151)
  const direct = store.store(payload)
  assert.equal(direct.ok, true)

  const session = store.openWrite()
  session.append(payload)
  const streamed = session.finalize()
  assert.equal(streamed.ok, true)
  if (!streamed.ok || !direct.ok) {
    return
  }
  assert.equal(streamed.manifest.digest, direct.manifest.digest)
  assert.equal(streamed.deduplicated, true)
})

test('openRead: streams verified chunks and completes the overall digest', () => {
  const { store } = seededStore()
  const payload = syntheticBytes(200, 161)
  const stored = store.store(payload)
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const opened = store.openRead(stored.manifest.digest)
  assert.equal(opened.ok, true)
  if (!opened.ok) {
    return
  }
  const collected: number[] = []
  let chunk: Uint8Array | null = opened.stream.read()
  while (chunk !== null) {
    collected.push(...chunk)
    chunk = opened.stream.read()
  }
  assert.equal(opened.stream.read(), null)
  assert.deepEqual(collected, [...payload])
})

test('openRead: mid-stream corruption throws the hard integrity error (E10)', () => {
  const { store, blobs } = seededStore()
  const stored = store.store(syntheticBytes(200, 171))
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const digest = stored.manifest.digest
  assert.equal(blobs.corruptChunkForTests(digest, 0), true)

  const opened = store.openRead(digest)
  assert.equal(opened.ok, true)
  if (!opened.ok) {
    return
  }
  assert.throws(
    () => opened.stream.read(),
    (error: unknown) => error instanceof ArtifactIntegrityError,
  )
})

test('stat reflects the manifest without touching content', () => {
  const { store } = seededStore()
  const payload = syntheticBytes(100, 181)
  const stored = store.store(payload, { mediaType: 'model/gltf-binary' })
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  const stat = store.stat(stored.manifest.digest)
  assert.ok(stat !== null)
  assert.deepEqual(
    stat,
    {
      digest: stored.manifest.digest,
      sizeBytes: 100,
      chunkSize: 64,
      chunkCount: 2,
      mediaType: 'model/gltf-binary',
    },
  )
})

test('store input is copied: later caller mutation cannot corrupt the store', () => {
  const { store } = seededStore()
  const payload = syntheticBytes(100, 191)
  const shared = payload.slice()
  const stored = store.store(shared)
  assert.equal(stored.ok, true)
  if (!stored.ok) {
    return
  }
  shared[0] = (shared[0] ?? 0) ^ 0xff
  const fetched = store.fetch(stored.manifest.digest)
  assert.equal(fetched.ok, true)
  if (!fetched.ok) {
    return
  }
  assert.deepEqual([...fetched.bytes], [...payload])
})
