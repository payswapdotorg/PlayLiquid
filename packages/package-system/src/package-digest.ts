/**
 * Package content digest computation and sealing.
 *
 * The content digest of a package record is the SHA-256 of the canonical
 * JSON of the record with the `contentDigest` field removed — i.e. it pins
 * the identity fields and the complete metadata. Because canonicalization
 * is key-order independent, two structurally equal records with different
 * key insertion order seal to the same digest (E9).
 */

import { computeDigest } from './digest.ts'
import type { ContentDigest } from './digest.ts'
import type { PackageRecord, UnsealedPackageRecord } from './package-record.ts'

/**
 * Computes the content digest of a package record (sealed or unsealed):
 * the digest is taken over the canonical JSON of the record with the
 * `contentDigest` identity field removed.
 */
export function computePackageDigest(
  record: UnsealedPackageRecord | PackageRecord,
): ContentDigest {
  return computeDigest({
    identity: {
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
    },
    metadata: record.metadata,
  })
}

/**
 * Seals an unsealed record by computing and attaching its content digest.
 * Pure: the input is not mutated.
 */
export function sealPackageRecord(record: UnsealedPackageRecord): PackageRecord {
  return {
    identity: { ...record.identity, contentDigest: computePackageDigest(record) },
    metadata: record.metadata,
  }
}

/**
 * Verifies that a sealed record's declared digest matches its content.
 * Pure integrity check (E8: tampering with any sealed field breaks this).
 */
export function verifyPackageDigest(record: PackageRecord): boolean {
  return record.identity.contentDigest === computePackageDigest(record)
}
