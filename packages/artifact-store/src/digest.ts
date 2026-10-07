/**
 * CAS blob digest — the canonical content-addressing algorithm of the
 * PlayLiquid artifact store.
 *
 * Work order PL-011; architecture-lock rule 9 — "Large binary artifacts use
 * content-addressed storage"; E7 — large binaries do not live wholesale in
 * ordinary Git history.
 *
 * CANONICAL ALGORITHM (documented contract, do not change without an
 * Architecture Change Request): the digest of a blob is
 *
 *   SHA-256 over the exact bytes of the blob, rendered as
 *   `sha256:<64 lowercase hexadecimal characters>`.
 *
 * This is the SAME textual shape as `@playliquid/package-system`'s
 * `ContentDigest` so that CAS references, lockfile pins and package record
 * coordinates all share one digest vocabulary. The DIGESTED INPUT differs by
 * domain: package-system digests the canonical JSON of a value
 * (`computeDigest`), while the artifact store digests raw bytes
 * (`computeBlobDigest`). A package record's content digest is therefore the
 * blob digest of its canonical-JSON content bytes — see
 * `packageRecordContentBytes` in `@playliquid/package-registry`.
 *
 * Uses `node:crypto` only (pure computation, no IO); mirrors the dependency
 * conventions of `packages/package-system` (PL-002).
 */

import { createHash } from 'node:crypto'
import { isContentDigest } from '@playliquid/package-system'
import type { ContentDigest } from '@playliquid/package-system'

/** The one canonical CAS digest algorithm (see module docs). */
export const CAS_DIGEST_ALGORITHM = 'sha256' as const

/** Media type recorded for package-record content blobs (see registry wiring). */
export const PACKAGE_RECORD_MEDIA_TYPE = 'application/vnd.playliquid.package-record+json'

/** Type guard: a well-formed CAS blob digest (`sha256:<64 hex>`). */
export function isBlobDigest(value: unknown): value is ContentDigest {
  return isContentDigest(value)
}

/**
 * Computes the CAS digest of a byte payload: SHA-256 over the exact bytes.
 * Deterministic: byte-identical payloads always produce the identical digest
 * (E9); a single differing byte always produces a different digest.
 */
export function computeBlobDigest(bytes: Uint8Array): ContentDigest {
  const hex = createHash(CAS_DIGEST_ALGORITHM).update(bytes).digest('hex')
  return `sha256:${hex}`
}

/** UTF-8 encodes a string into bytes (content serialization helper). */
export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
