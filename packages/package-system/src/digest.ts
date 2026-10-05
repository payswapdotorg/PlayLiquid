/**
 * Content digest contract.
 *
 * Spec: spec/package-contract.md "Required identity: content digest".
 *
 * A digest is `sha256:` followed by 64 lowercase hexadecimal characters —
 * the SHA-256 of the UTF-8 encoding of the canonical JSON serialization
 * (see `canonical-json.ts`) of the addressed value.
 *
 * Uses `node:crypto` only; no external dependencies.
 */

import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.ts'

/** A content digest: `sha256:<64 lowercase hex>`. */
export type ContentDigest = string

const CONTENT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/

/** Type guard: a well-formed content digest. */
export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value)
}

/**
 * Computes the content digest of a JSON-safe value:
 * SHA-256 over the UTF-8 bytes of its canonical JSON serialization.
 *
 * The result depends only on the VALUE (key order independent), not on the
 * shape in which the value was constructed (E9).
 */
export function computeDigest(value: unknown): ContentDigest {
  const canonical = canonicalJson(value)
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex')
  return `sha256:${hex}`
}
