/**
 * Content-addressed artifact references (E7).
 *
 * Spec: spec/architecture-lock.md rule 9 — "Large binary artifacts use
 * content-addressed storage"; E7 — "Large binaries do not live wholesale in
 * ordinary Git history".
 *
 * Package metadata references artifacts as CAS pointers (digest + size +
 * media type), never as inline bytes above the inline threshold. Small
 * values may be inlined, bounded by {@link MAX_INLINE_ARTIFACT_BYTES}; any
 * artifact whose decoded size exceeds the threshold MUST be a
 * {@link CasArtifactRef}.
 */

import type { ContentDigest } from './digest.ts'
import { isContentDigest } from './digest.ts'

/** Maximum decoded size of an inline artifact: 1 MiB (2^20 bytes). */
export const MAX_INLINE_ARTIFACT_BYTES = 1_048_576

/** A pointer to a binary stored in content-addressed storage. */
export interface CasArtifactRef {
  readonly storage: 'cas'
  /** Digest of the stored artifact bytes. */
  readonly digest: ContentDigest
  /** Exact size of the stored artifact bytes. */
  readonly sizeBytes: number
  /** RFC 6838-style media type, e.g. `model/gltf-binary`. */
  readonly mediaType: string
}

/** A small artifact embedded directly in package metadata. */
export interface InlineArtifact {
  readonly storage: 'inline'
  /** Base64 (standard alphabet, padded) of the artifact bytes. */
  readonly base64: string
  readonly mediaType: string
}

/** Any package artifact reference. */
export type PackageArtifact = CasArtifactRef | InlineArtifact

const MEDIA_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

/** Decoded byte size of a base64 payload, or `null` if it is not valid base64. */
export function base64DecodedBytes(base64: string): number | null {
  if (
    typeof base64 !== 'string' ||
    base64.length % 4 !== 0 ||
    !BASE64_PATTERN.test(base64)
  ) {
    return null
  }
  let padding = 0
  if (base64.endsWith('==')) {
    padding = 2
  } else if (base64.endsWith('=')) {
    padding = 1
  }
  return (base64.length / 4) * 3 - padding
}

/** A single artifact placement verdict. */
export type ArtifactPlacement =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: 'invalid-artifact' | 'inline-artifact-too-large'
      readonly message: string
    }

/**
 * Checks one artifact against the content-addressing rules (E7).
 * Fails closed on malformed references and oversized inline payloads.
 */
export function checkArtifactPlacement(artifact: PackageArtifact): ArtifactPlacement {
  if (artifact === null || typeof artifact !== 'object') {
    return { ok: false, code: 'invalid-artifact', message: 'artifact is not an object' }
  }
  const storage = (artifact as { storage?: unknown }).storage
  const mediaType = (artifact as { mediaType?: unknown }).mediaType
  if (typeof mediaType !== 'string' || !MEDIA_TYPE_PATTERN.test(mediaType)) {
    return {
      ok: false,
      code: 'invalid-artifact',
      message: `invalid media type: ${String(mediaType)}`,
    }
  }
  if (storage === 'cas') {
    const reference = artifact as CasArtifactRef
    if (!isContentDigest(reference.digest)) {
      return {
        ok: false,
        code: 'invalid-artifact',
        message: 'CAS artifact has invalid digest',
      }
    }
    if (
      typeof reference.sizeBytes !== 'number' ||
      !Number.isInteger(reference.sizeBytes) ||
      reference.sizeBytes < 0
    ) {
      return {
        ok: false,
        code: 'invalid-artifact',
        message: 'CAS artifact has invalid sizeBytes',
      }
    }
    return { ok: true }
  }
  if (storage === 'inline') {
    const inline = artifact as InlineArtifact
    const bytes = base64DecodedBytes(inline.base64)
    if (bytes === null) {
      return {
        ok: false,
        code: 'invalid-artifact',
        message: 'inline artifact has invalid base64 payload',
      }
    }
    if (bytes > MAX_INLINE_ARTIFACT_BYTES) {
      return {
        ok: false,
        code: 'inline-artifact-too-large',
        message: `inline artifact is ${bytes} bytes; limit is ${MAX_INLINE_ARTIFACT_BYTES}; use CAS storage (E7)`,
      }
    }
    return { ok: true }
  }
  return {
    ok: false,
    code: 'invalid-artifact',
    message: `unknown artifact storage: ${String(storage)}`,
  }
}
