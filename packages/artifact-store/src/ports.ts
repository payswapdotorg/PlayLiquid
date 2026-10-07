/**
 * Stream-chunked blob storage ports (E7) — the IO boundary of the artifact
 * store.
 *
 * The domain never touches fs/network. It addresses blobs only through these
 * pure interfaces; the application wires a real adapter (local disk, object
 * storage, remote registry) at composition time.
 *
 *   - `ChunkedBlobSink`   — write side: chunk-by-chunk writes + manifest.
 *   - `ChunkedBlobSource` — read side: chunk reads + manifest lookup.
 *   - `ChunkedBlobStore`  — the combined port an adapter typically implements.
 *
 * `InMemoryBlobStore` is the reference in-memory fake for tests and for the
 * in-memory-first default wiring. It exposes a corruption seam
 * (`corruptChunkForTests`) so negative tests can simulate storage decay and
 * prove the fail-closed integrity behavior (E10) without any IO.
 */

import type { ContentDigest } from '@playliquid/package-system'
import type { BlobManifest } from './manifest.ts'

/**
 * Write-side port: persists blob content as addressable chunks and records
 * the blob's manifest. Chunks are written first (in any order); the manifest
 * finalizes the blob.
 */
export interface ChunkedBlobSink {
  /** Persists one chunk of the blob addressed by `digest`. */
  putChunk(digest: ContentDigest, chunkIndex: number, bytes: Uint8Array): void
  /** Records the blob's manifest, finalizing the blob. */
  putManifest(manifest: BlobManifest): void
}

/** Read-side port: retrieves manifest-recorded blob content. */
export interface ChunkedBlobSource {
  /**
   * Returns the chunk bytes of the blob addressed by `digest`, or `null`
   * when the chunk is absent.
   */
  readChunk(digest: ContentDigest, chunkIndex: number): Uint8Array | null
  /** Returns the blob's manifest, or `null` when the digest is unknown. */
  manifestOf(digest: ContentDigest): BlobManifest | null
}

/** The combined read/write blob port an adapter typically implements. */
export interface ChunkedBlobStore extends ChunkedBlobSink, ChunkedBlobSource {}

interface StoredBlob {
  readonly manifest: BlobManifest | null
  readonly chunks: Map<number, Uint8Array>
  finalized: boolean
}

function openBlob(blobs: Map<ContentDigest, StoredBlob>, digest: ContentDigest): StoredBlob {
  const existing = blobs.get(digest)
  if (existing !== undefined) {
    return existing
  }
  const created: StoredBlob = { manifest: null, chunks: new Map<number, Uint8Array>(), finalized: false }
  blobs.set(digest, created)
  return created
}

/**
 * In-memory reference implementation of {@link ChunkedBlobStore}.
 *
 * Copies bytes on write and on read so callers can never alias internal
 * state. `corruptChunkForTests` is the documented test seam for simulating
 * storage corruption (E10 negative evidence); it must never be used outside
 * tests.
 */
export class InMemoryBlobStore implements ChunkedBlobStore {
  readonly #blobs = new Map<ContentDigest, StoredBlob>()

  /** Number of distinct digests currently stored (test introspection). */
  get blobCount(): number {
    return this.#blobs.size
  }

  putChunk(digest: ContentDigest, chunkIndex: number, bytes: Uint8Array): void {
    const blob = openBlob(this.#blobs, digest)
    if (blob.finalized) {
      throw new Error(`blob ${digest} is finalized; late chunk writes are rejected`)
    }
    if (chunkIndex < 0 || !Number.isInteger(chunkIndex)) {
      throw new Error(`invalid chunk index ${chunkIndex} for ${digest}`)
    }
    blob.chunks.set(chunkIndex, bytes.slice())
  }

  putManifest(manifest: BlobManifest): void {
    const blob = openBlob(this.#blobs, manifest.digest)
    if (blob.finalized) {
      // Idempotent re-put of an identical manifest is a no-op; a DIFFERENT
      // manifest for the same digest is a content-addressing violation.
      if (blob.manifest !== null && manifestDigestKey(blob.manifest) === manifestDigestKey(manifest)) {
        return
      }
      throw new Error(`conflicting manifest for ${manifest.digest}`)
    }
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      if (!blob.chunks.has(index)) {
        throw new Error(`manifest for ${manifest.digest} finalizes an incomplete blob (missing chunk ${index})`)
      }
    }
    const settled: StoredBlob = { manifest, chunks: blob.chunks, finalized: true }
    this.#blobs.set(manifest.digest, settled)
  }

  readChunk(digest: ContentDigest, chunkIndex: number): Uint8Array | null {
    const blob = this.#blobs.get(digest)
    if (blob === undefined || !blob.finalized) {
      return null
    }
    const chunk = blob.chunks.get(chunkIndex)
    return chunk === undefined ? null : chunk.slice()
  }

  manifestOf(digest: ContentDigest): BlobManifest | null {
    const blob = this.#blobs.get(digest)
    return blob !== undefined && blob.finalized ? blob.manifest : null
  }

  /**
   * TEST SEAM (E10 negative evidence): flips one byte of a stored chunk.
   * Returns `true` when the chunk existed and was corrupted. Never use this
   * outside tests — it deliberately violates storage integrity.
   */
  corruptChunkForTests(digest: ContentDigest, chunkIndex: number): boolean {
    const blob = this.#blobs.get(digest)
    if (blob === undefined) {
      return false
    }
    const chunk = blob.chunks.get(chunkIndex)
    if (chunk === undefined || chunk.byteLength === 0) {
      return false
    }
    chunk[0] = (chunk[0] ?? 0) ^ 0xff
    return true
  }
}

function manifestDigestKey(manifest: BlobManifest): string {
  return JSON.stringify({
    digest: manifest.digest,
    sizeBytes: manifest.sizeBytes,
    chunkSize: manifest.chunkSize,
    chunkCount: manifest.chunkCount,
    mediaType: manifest.mediaType,
    chunks: manifest.chunks,
  })
}
