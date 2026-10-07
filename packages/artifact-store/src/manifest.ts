/**
 * Blob manifest records (E7 large-binary discipline).
 *
 * Every stored blob is described by a manifest record that is fully DERIVED
 * from the content: overall digest, exact byte size, chunk size, per-chunk
 * digests and media type. The manifest is deterministic — the same bytes,
 * chunk size and media type always produce the identical manifest (E9) — so
 * manifests can be recomputed and compared at any time to detect tampering
 * (E10: corruption and manifest forgery are hard errors, never silently
 * accepted).
 *
 * Chunks are cut deterministically: chunk i covers bytes
 * [i * chunkSize, min((i + 1) * chunkSize, sizeBytes)). A zero-byte blob has
 * zero chunks.
 */

import type { ContentDigest } from '@playliquid/package-system'
import { computeBlobDigest } from './digest.ts'

/** One chunk's content-addressed descriptor. */
export interface ChunkRecord {
  readonly index: number
  readonly sizeBytes: number
  /** SHA-256 of this chunk's exact bytes (`sha256:<64 hex>`). */
  readonly digest: ContentDigest
}

/** A blob manifest: the content-derived record of one stored blob. */
export interface BlobManifest {
  /** SHA-256 over the full byte stream of the blob. */
  readonly digest: ContentDigest
  readonly sizeBytes: number
  readonly chunkSize: number
  readonly chunkCount: number
  /** Media type asserted at store time; `null` when never asserted. */
  readonly mediaType: string | null
  readonly chunks: readonly ChunkRecord[]
}

/** Splits a payload into deterministic chunk slices. */
export function chunkSlices(
  bytes: Uint8Array,
  chunkSize: number,
): readonly Uint8Array[] {
  const slices: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    slices.push(bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength)))
  }
  return slices
}

/** Builds the chunk descriptor list for a payload. */
export function buildChunkRecords(
  bytes: Uint8Array,
  chunkSize: number,
): readonly ChunkRecord[] {
  return chunkSlices(bytes, chunkSize).map((chunk, index) => ({
    index,
    sizeBytes: chunk.byteLength,
    digest: computeBlobDigest(chunk),
  }))
}

/** Builds the full manifest for a payload. Pure and deterministic. */
export function buildManifest(
  bytes: Uint8Array,
  chunkSize: number,
  mediaType: string | null,
): BlobManifest {
  return {
    digest: computeBlobDigest(bytes),
    sizeBytes: bytes.byteLength,
    chunkSize,
    chunkCount: Math.ceil(bytes.byteLength / chunkSize),
    mediaType,
    chunks: buildChunkRecords(bytes, chunkSize),
  }
}

/** Verifies one chunk's bytes against its descriptor. */
export function verifyChunk(
  chunkBytes: Uint8Array,
  record: ChunkRecord,
): boolean {
  return (
    chunkBytes.byteLength === record.sizeBytes &&
    computeBlobDigest(chunkBytes) === record.digest
  )
}

/**
 * Verifies a manifest's internal consistency against a full payload:
 * per-chunk digest/size equality and overall digest equality.
 * A tampered manifest or tampered bytes both fail this check (E10).
 */
export function verifyManifest(
  manifest: BlobManifest,
  bytes: Uint8Array,
): boolean {
  if (manifest.sizeBytes !== bytes.byteLength) {
    return false
  }
  if (manifest.digest !== computeBlobDigest(bytes)) {
    return false
  }
  const slices = chunkSlices(bytes, manifest.chunkSize)
  if (slices.length !== manifest.chunks.length || slices.length !== manifest.chunkCount) {
    return false
  }
  for (const record of manifest.chunks) {
    const slice = slices[record.index]
    if (slice === undefined || !verifyChunk(slice, record)) {
      return false
    }
  }
  return true
}
