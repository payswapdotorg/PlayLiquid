/**
 * Pure-check harness (PL-011 evidence) — artifact store.
 *
 * Stores a deterministic multi-chunk blob, dedupes it, fetches it back
 * integrity-verified, performs byte-range reads, streams a write session and
 * a read session, and proves the fail-closed corruption behavior with the
 * in-memory fake's test seam. Prints a canonical summary so the output is
 * byte-stable across runs and machines.
 *
 * Run: `node src/harness.ts`
 * Exit code 0 when every check passes, 1 otherwise.
 */

import { createArtifactStore } from './store.ts'
import { computeBlobDigest } from './digest.ts'
import { InMemoryBlobStore } from './ports.ts'
import { syntheticBytes } from './testing.ts'

const blobs = new InMemoryBlobStore()
const store = createArtifactStore({ blobStore: blobs, chunkSize: 256 })

const payload = syntheticBytes(1000, 0x5eed)

const stored = store.store(payload, { mediaType: 'model/gltf-binary' })
const deduped = store.store(payload, { mediaType: 'model/gltf-binary' })
const fetched = store.fetch(stored.ok ? stored.manifest.digest : '')
const range = store.fetch(stored.ok ? stored.manifest.digest : '')

const session = store.openWrite()
session.append(payload.slice(0, 300))
session.append(payload.slice(300))
const streamed = session.finalize()

const opened = store.openRead(stored.ok ? stored.manifest.digest : '')
const collected: number[] = []
if (opened.ok) {
  let chunk: Uint8Array | null = opened.stream.read()
  while (chunk !== null) {
    collected.push(...chunk)
    chunk = opened.stream.read()
  }
}

const rangeRead = store.readRange(stored.ok ? stored.manifest.digest : '', 700, 100)

// E10 negative evidence: corrupt a chunk, then prove the hard failure.
const corruptionTarget = blobs
let corruptionCode = 'none'
let corruptionExpected = 'none'
if (stored.ok) {
  const digest = stored.manifest.digest
  blobs.corruptChunkForTests(digest, 1)
  const corrupted = store.fetch(digest)
  if (!corrupted.ok) {
    corruptionCode = corrupted.code
    corruptionExpected = corrupted.expectedDigest ?? 'none'
  }
}

const digestOfPayload = computeBlobDigest(payload)

const summary = {
  stored: stored.ok ? 'yes' : 'no',
  digestMatchesPayload:
    stored.ok && stored.manifest.digest === digestOfPayload ? 'yes' : 'no',
  chunkCount: stored.ok ? stored.manifest.chunkCount : -1,
  deduplicated: deduped.ok && deduped.deduplicated ? 'yes' : 'no',
  fetchIntegrityVerified:
    fetched.ok && fetched.bytes.byteLength === payload.byteLength ? 'yes' : 'no',
  rangeBytesMatch:
    rangeRead.ok && rangeRead.bytes !== undefined
      ? [...rangeRead.bytes].join(',') === [...payload.slice(700, 800)].join(',')
        ? 'yes'
        : 'no'
      : 'no',
  streamedDigestMatches:
    streamed.ok && stored.ok && streamed.manifest.digest === stored.manifest.digest
      ? 'yes'
      : 'no',
  streamedDeduplicated: streamed.ok && streamed.deduplicated ? 'yes' : 'no',
  streamReassembled:
    collected.length === payload.length &&
    collected.every((byte, index) => byte === payload[index])
      ? 'yes'
      : 'no',
  corruptedFetchCode: corruptionCode,
  corruptionExpectedDigestPrefix: corruptionExpected.slice(0, 14),
  blobCount: blobs.blobCount,
  rangeSecondFetchOk: range.ok ? 'yes' : 'no',
}

const checks = [
  summary.stored === 'yes',
  summary.digestMatchesPayload === 'yes',
  summary.chunkCount === 4,
  summary.deduplicated === 'yes',
  summary.fetchIntegrityVerified === 'yes',
  summary.rangeBytesMatch === 'yes',
  summary.streamedDigestMatches === 'yes',
  summary.streamedDeduplicated === 'yes',
  summary.streamReassembled === 'yes',
  summary.corruptedFetchCode === 'integrity',
  summary.blobCount === 1,
  summary.rangeSecondFetchOk === 'yes',
]

console.log(JSON.stringify(summary, null, 2))
const pass = checks.every(Boolean)
console.log(pass ? 'harness: PASS' : 'harness: FAIL')
process.exit(pass ? 0 : 1)
