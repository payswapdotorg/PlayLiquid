/**
 * The content-addressed artifact store (PL-011, E7/E10).
 *
 * Operations:
 *   - `store(bytes) → digest`   deterministic SHA-256 content addressing,
 *                               dedupe by digest (idempotent);
 *   - `fetch(digest)`           integrity-verified read: every chunk and the
 *                               overall digest are recomputed and compared;
 *                               corruption is a HARD failure — corrupted bytes
 *                               are never returned and there is no override
 *                               (E10);
 *   - `stat(digest)`            cheap presence/manifest probe (no content
 *                               verification — fetch is the verifying path);
 *   - `readRange(d, off, len)`  byte-range read with per-chunk verification
 *                               of the touched span;
 *   - `openWrite()/openRead()`  stream-chunked sessions over the ports.
 *
 * Error discipline: the primary operations are TOTAL — they return result
 * unions and never throw for any input. The one documented exception is the
 * streaming read session, which throws {@link ArtifactIntegrityError} when
 * corruption is discovered mid-iteration, because partial data has already
 * been handed to the consumer and silent truncation would misrepresent
 * storage state (E10 fail-closed).
 *
 * The domain is pure: all persistence flows through the {@link ChunkedBlobStore}
 * port (in-memory fake by default); `node:crypto` is used for hashing only.
 */

import { createHash } from 'node:crypto'
import type { ContentDigest } from '@playliquid/package-system'
import { computeBlobDigest, isBlobDigest } from './digest.ts'
import { buildManifest, chunkSlices, verifyChunk } from './manifest.ts'
import type { BlobManifest } from './manifest.ts'
import { InMemoryBlobStore } from './ports.ts'
import type { ChunkedBlobStore } from './ports.ts'

/** Default chunk size: 64 KiB (E7 streaming discipline). */
export const DEFAULT_CHUNK_SIZE = 65_536

/** Minimum chunk size accepted at store construction. */
export const MIN_CHUNK_SIZE = 1

const MEDIA_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/

/** Failure codes of the artifact store's total operations. */
export type ArtifactFailureCode =
  | 'invalid-digest'
  | 'invalid-media-type'
  | 'media-type-conflict'
  | 'unknown-digest'
  | 'integrity'
  | 'invalid-range'

/** The failure arm of a total artifact-store operation. */
export interface ArtifactFailure {
  readonly ok: false
  readonly code: ArtifactFailureCode
  readonly message: string
  readonly expectedDigest?: ContentDigest
  readonly actualDigest?: ContentDigest
}

/** The success arm of `store`. */
export interface StoreSuccess {
  readonly ok: true
  readonly manifest: BlobManifest
  /** `true` when the digest was already present (idempotent dedupe). */
  readonly deduplicated: boolean
}

/** The result of `store` / `BlobWriteSession.finalize`. */
export type StoreResult = StoreSuccess | ArtifactFailure

/** The success arm of `fetch`. */
export interface FetchSuccess {
  readonly ok: true
  readonly bytes: Uint8Array
  readonly manifest: BlobManifest
}

/** The result of `fetch`. */
export type FetchResult = FetchSuccess | ArtifactFailure

/** The result of `readRange` (and the payload arm of `openRead`). */
export type RangeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | ArtifactFailure

/** The result of `openRead`. */
export type OpenReadResult =
  | { readonly ok: true; readonly stream: BlobReadStream }
  | ArtifactFailure

/** The cheap presence probe returned by `stat` (`null` when unknown). */
export interface BlobStat {
  readonly digest: ContentDigest
  readonly sizeBytes: number
  readonly chunkSize: number
  readonly chunkCount: number
  readonly mediaType: string | null
}

/**
 * A streaming write session (E7). Bytes appended in arbitrary pieces are cut
 * into fixed-size chunks and written through the sink port; `finalize`
 * computes the content digest, records the manifest and returns the result.
 *
 * Chunks are buffered in the session until `finalize`, because a
 * content-addressed port key (the final digest) only exists once the whole
 * stream has been hashed. Adapters that must stream to disk before the
 * digest is known need a session-keyed port shape — deliberately deferred
 * (see the package README).
 */
export interface BlobWriteSession {
  /** Appends bytes to the stream. Copies the input. */
  append(bytes: Uint8Array): void
  /** Seals the stream: persists chunks + manifest, returns the digest. */
  finalize(options?: { mediaType?: string }): StoreResult
}

/**
 * A streaming read session (E7). Each `read()` returns the next chunk,
 * verified against the manifest's per-chunk digest; the overall digest is
 * verified incrementally across the consumed stream. Returns `null` after
 * the last chunk.
 *
 * Corruption discovered mid-stream throws {@link ArtifactIntegrityError} —
 * a hard error (E10), because partial data has already been consumed.
 */
export interface BlobReadStream {
  readonly manifest: BlobManifest
  /** Next verified chunk, or `null` at end-of-stream. */
  read(): Uint8Array | null
}

/** The artifact store itself. Total operations; see module docs. */
export interface ArtifactStore {
  store(bytes: Uint8Array, options?: { mediaType?: string }): StoreResult
  openWrite(): BlobWriteSession
  fetch(digest: ContentDigest): FetchResult
  openRead(digest: ContentDigest): OpenReadResult
  readRange(digest: ContentDigest, offset: number, length: number): RangeResult
  stat(digest: ContentDigest): BlobStat | null
}

/** Hard error thrown for corruption discovered mid-stream (E10). */
export class ArtifactIntegrityError extends Error {
  readonly expectedDigest: ContentDigest | null
  readonly actualDigest: ContentDigest | null

  constructor(
    message: string,
    expected: ContentDigest | null,
    actual: ContentDigest | null,
  ) {
    super(message)
    this.name = 'ArtifactIntegrityError'
    this.expectedDigest = expected
    this.actualDigest = actual
  }
}

function fail(
  code: ArtifactFailureCode,
  message: string,
  extra?: { expectedDigest?: ContentDigest; actualDigest?: ContentDigest },
): ArtifactFailure {
  return { ok: false, code, message, ...extra }
}

function isFailure(value: unknown): value is ArtifactFailure {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Partial<ArtifactFailure>).ok === false
  )
}

function isValidMediaType(mediaType: string): boolean {
  return typeof mediaType === 'string' && MEDIA_TYPE_PATTERN.test(mediaType)
}

function isNonNegativeInteger(value: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function concat(base: Uint8Array, ...parts: Uint8Array[]): Uint8Array {
  let total = base.byteLength
  for (const part of parts) {
    total += part.byteLength
  }
  const merged = new Uint8Array(total)
  merged.set(base, 0)
  let offset = base.byteLength
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.byteLength
  }
  return merged
}

/** Options of {@link createArtifactStore}. */
export interface CreateArtifactStoreOptions {
  /** The chunked blob persistence port; in-memory fake by default. */
  readonly blobStore?: ChunkedBlobStore
  /** Fixed chunk size for new blobs (default 64 KiB). */
  readonly chunkSize?: number
}

/**
 * Creates an artifact store over a chunked blob port. In-memory-first: with
 * no options the store is fully functional over an internal
 * {@link InMemoryBlobStore}; the application wires a real adapter for
 * persistence.
 *
 * Throws only for construction-time programmer errors (invalid chunkSize).
 */
export function createArtifactStore(
  options: CreateArtifactStoreOptions = {},
): ArtifactStore {
  const blobStore = options.blobStore ?? new InMemoryBlobStore()
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  if (!isNonNegativeInteger(chunkSize) || chunkSize < MIN_CHUNK_SIZE) {
    throw new Error(
      `chunkSize must be an integer >= ${MIN_CHUNK_SIZE} (received ${String(chunkSize)})`,
    )
  }

  /** Manifest lookup + digest validation. */
  function requireManifest(
    digest: ContentDigest,
  ): BlobManifest | ArtifactFailure {
    if (!isBlobDigest(digest)) {
      return fail('invalid-digest', `malformed digest: ${String(digest)}`)
    }
    const manifest = blobStore.manifestOf(digest)
    if (manifest === null) {
      return fail('unknown-digest', `no blob is stored for digest ${digest}`)
    }
    return manifest
  }

  /** Single-pass verified read: chunks + overall digest (E10). */
  function fetchAndVerify(
    digest: ContentDigest,
    manifest: BlobManifest,
  ): { ok: true; bytes: Uint8Array } | ArtifactFailure {
    const bytes = new Uint8Array(manifest.sizeBytes)
    for (const record of manifest.chunks) {
      const chunk = blobStore.readChunk(digest, record.index)
      if (chunk === null) {
        return fail(
          'integrity',
          `chunk ${record.index} of ${digest} is missing from the blob store`,
          { expectedDigest: digest },
        )
      }
      if (!verifyChunk(chunk, record)) {
        return fail(
          'integrity',
          `chunk ${record.index} of ${digest} does not match its recorded digest`,
          { expectedDigest: record.digest, actualDigest: computeBlobDigest(chunk) },
        )
      }
      bytes.set(chunk, record.index * manifest.chunkSize)
    }
    const actual = computeBlobDigest(bytes)
    if (actual !== digest) {
      return fail(
        'integrity',
        `stored content of ${digest} hashes to ${actual} — the blob is corrupted or the manifest was forged`,
        { expectedDigest: digest, actualDigest: actual },
      )
    }
    return { ok: true, bytes }
  }

  function storeBytes(bytes: Uint8Array, mediaType: string | undefined): StoreResult {
    if (mediaType !== undefined && !isValidMediaType(mediaType)) {
      return fail('invalid-media-type', `invalid media type: ${mediaType}`)
    }
    const digest = computeBlobDigest(bytes)
    const existing = blobStore.manifestOf(digest)
    if (existing !== null) {
      // Dedupe by digest: byte-identical content is stored once. The media
      // type follows first-assertion-wins; two conflicting non-null
      // assertions are a manifest mutation attempt and fail closed. The
      // existing content is integrity-verified so a dedupe hit can never
      // claim success over decayed storage (E10).
      const verified = fetchAndVerify(digest, existing)
      if (isFailure(verified)) {
        return verified
      }
      if (
        mediaType !== undefined &&
        existing.mediaType !== null &&
        existing.mediaType !== mediaType
      ) {
        return fail(
          'media-type-conflict',
          `digest ${digest} is already stored with media type ${existing.mediaType}; refusing to re-store as ${mediaType}`,
        )
      }
      return { ok: true, manifest: existing, deduplicated: true }
    }
    const manifest = buildManifest(bytes, chunkSize, mediaType ?? null)
    const slices = chunkSlices(bytes, chunkSize)
    for (let index = 0; index < slices.length; index += 1) {
      const slice = slices[index]
      if (slice === undefined) {
        return fail('integrity', `chunk slicing failed at index ${index}`)
      }
      blobStore.putChunk(digest, index, slice)
    }
    blobStore.putManifest(manifest)
    // Fail-closed write verification: read every chunk back and compare
    // before announcing success (E10).
    const written = fetchAndVerify(digest, manifest)
    if (isFailure(written)) {
      return written
    }
    return { ok: true, manifest, deduplicated: false }
  }

  return {
    store: (bytes: Uint8Array, options?: { mediaType?: string }): StoreResult =>
      storeBytes(bytes.slice(), options?.mediaType),

    openWrite: (): BlobWriteSession => {
      const pending: Uint8Array[] = []
      let buffer: Uint8Array = new Uint8Array(0)
      let finalized = false
      return {
        append: (bytes: Uint8Array): void => {
          if (finalized) {
            throw new Error('write session is already finalized')
          }
          if (bytes.byteLength === 0) {
            return
          }
          buffer = concat(buffer, bytes.slice())
          while (buffer.byteLength >= chunkSize) {
            pending.push(buffer.slice(0, chunkSize))
            buffer = buffer.slice(chunkSize)
          }
        },
        finalize: (options?: { mediaType?: string }): StoreResult => {
          if (finalized) {
            throw new Error('write session is already finalized')
          }
          finalized = true
          if (buffer.byteLength > 0) {
            pending.push(buffer)
            buffer = new Uint8Array(0)
          }
          return storeBytes(concat(new Uint8Array(0), ...pending), options?.mediaType)
        },
      }
    },

    fetch: (digest: ContentDigest): FetchResult => {
      const manifest = requireManifest(digest)
      if (isFailure(manifest)) {
        return manifest
      }
      const verdict = fetchAndVerify(digest, manifest)
      if (isFailure(verdict)) {
        return verdict
      }
      return { ok: true, bytes: verdict.bytes, manifest }
    },

    openRead: (digest: ContentDigest): OpenReadResult => {
      const manifest = requireManifest(digest)
      if (isFailure(manifest)) {
        return manifest
      }
      let position = 0
      const hasher = createHash('sha256')
      const stream: BlobReadStream = {
        manifest,
        read: (): Uint8Array | null => {
          if (position >= manifest.chunks.length) {
            return null
          }
          const record = manifest.chunks[position]
          if (record === undefined) {
            throw new ArtifactIntegrityError(
              `chunk descriptor ${position} of ${digest} is missing from the manifest`,
              digest,
              null,
            )
          }
          const chunk = blobStore.readChunk(digest, record.index)
          if (chunk === null) {
            throw new ArtifactIntegrityError(
              `chunk ${record.index} of ${digest} is missing from the blob store`,
              digest,
              null,
            )
          }
          const actual = computeBlobDigest(chunk)
          if (actual !== record.digest) {
            throw new ArtifactIntegrityError(
              `chunk ${record.index} of ${digest} is corrupted (expected ${record.digest}, found ${actual})`,
              record.digest,
              actual,
            )
          }
          hasher.update(chunk)
          position += 1
          if (position === manifest.chunks.length) {
            const overall = `sha256:${hasher.digest('hex')}`
            if (overall !== digest) {
              throw new ArtifactIntegrityError(
                `stream ${digest} hashes to ${overall} after full consumption — the blob is corrupted or the manifest was forged`,
                digest,
                overall,
              )
            }
          }
          return chunk
        },
      }
      return { ok: true, stream }
    },

    readRange: (
      digest: ContentDigest,
      offset: number,
      length: number,
    ): RangeResult => {
      const manifest = requireManifest(digest)
      if (isFailure(manifest)) {
        return manifest
      }
      if (!isNonNegativeInteger(offset) || !isNonNegativeInteger(length)) {
        return fail(
          'invalid-range',
          `offset and length must be non-negative integers (received offset=${String(offset)}, length=${String(length)})`,
        )
      }
      if (offset > manifest.sizeBytes || offset + length > manifest.sizeBytes) {
        return fail(
          'invalid-range',
          `range [${String(offset)}, ${String(offset + length)}) exceeds blob size ${String(manifest.sizeBytes)} of ${digest}`,
        )
      }
      if (length === 0) {
        return { ok: true, bytes: new Uint8Array(0) }
      }
      // Read and verify every chunk touched by the range, then slice. Chunks
      // outside the range are not read (E7 discipline: no wholesale pulls).
      const first = Math.floor(offset / manifest.chunkSize)
      const last = Math.floor((offset + length - 1) / manifest.chunkSize)
      const touched: Uint8Array[] = []
      for (let index = first; index <= last; index += 1) {
        const record = manifest.chunks[index]
        if (record === undefined) {
          return fail(
            'integrity',
            `chunk ${String(index)} of ${digest} is missing from the manifest`,
            { expectedDigest: digest },
          )
        }
        const chunk = blobStore.readChunk(digest, record.index)
        if (chunk === null) {
          return fail(
            'integrity',
            `chunk ${record.index} of ${digest} is missing from the blob store`,
            { expectedDigest: digest },
          )
        }
        if (!verifyChunk(chunk, record)) {
          return fail(
            'integrity',
            `chunk ${record.index} of ${digest} does not match its recorded digest (range reads verify the touched span; full verification is fetch)`,
            { expectedDigest: record.digest, actualDigest: computeBlobDigest(chunk) },
          )
        }
        touched.push(chunk)
      }
      const span = concat(new Uint8Array(0), ...touched)
      const start = offset - first * manifest.chunkSize
      return { ok: true, bytes: span.slice(start, start + length) }
    },

    stat: (digest: ContentDigest): BlobStat | null => {
      const manifest = blobStore.manifestOf(digest)
      if (manifest === null) {
        return null
      }
      return {
        digest: manifest.digest,
        sizeBytes: manifest.sizeBytes,
        chunkSize: manifest.chunkSize,
        chunkCount: manifest.chunkCount,
        mediaType: manifest.mediaType,
      }
    },
  }
}
