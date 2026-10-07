/**
 * Test fixtures — ergonomic builders for structurally valid, gate-passing
 * package records and locks. Mirrors the `test-fixtures.ts` conventions of
 * `@playliquid/package-system` (which is not exported from that package's
 * index, so this local builder wraps the same sealing helpers).
 *
 * Digested fields are computed at runtime via sealing — no digest literals
 * in source. Not exported from the package index; test-only.
 */

import { sealPackageRecord } from '@playliquid/package-system'
import type {
  CapabilityDeclaration,
  CapabilityReference,
  LockedPackage,
  PackageArtifact,
  PackageIdentity,
  PackageKind,
  PackageLock,
  PackageMetadata,
  PackageRecord,
  PermissionRequest,
  UnsealedPackageRecord,
} from '@playliquid/package-system'
import { LOCK_SCHEMA_VERSION } from '@playliquid/package-system'
import { parseSemver } from '@playliquid/package-system'
import type { SemanticVersion } from '@playliquid/package-system'

/** Parses or throws — for fixture literals only. */
export function semver(value: string): SemanticVersion {
  const parsed = parseSemver(value)
  if (parsed === null) {
    throw new Error(`fixture semver literal is invalid: ${value}`)
  }
  return parsed
}

export const FIXTURE_COMMIT = '0123456789abcdef0123456789abcdef01234567'

/** Default metadata: gate-passing provenance/license, no capabilities. */
export function makeMetadata(
  overrides?: Partial<PackageMetadata>,
): PackageMetadata {
  return {
    dependencies: [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: {
      spdxExpression: 'Apache-2.0',
      status: 'verified',
    },
    provenance: {
      origin: { type: 'original' },
      sourceCommit: FIXTURE_COMMIT,
      transformationHistory: [
        { kind: 'author', description: 'authored for the fixture corpus' },
      ],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ['simulation'], engines: ['native'], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [],
    extensionPoints: [],
    overlay: null,
    ...overrides,
  }
}

export function makeIdentity(
  kind: PackageKind,
  id: string,
  version: string,
): Omit<PackageIdentity, 'contentDigest'> {
  return { kind, id, version: semver(version) }
}

/** Builds a sealed, gate-passing record. */
export function makeRecord(
  kind: PackageKind,
  id: string,
  version: string,
  metadata?: Partial<PackageMetadata>,
): PackageRecord {
  return sealPackageRecord({
    identity: makeIdentity(kind, id, version),
    metadata: makeMetadata(metadata),
  })
}

/** Builds an unsealed record for mutation/tamper tests. */
export function makeUnsealedRecord(
  kind: PackageKind,
  id: string,
  version: string,
  metadata?: Partial<PackageMetadata>,
): UnsealedPackageRecord {
  return {
    identity: makeIdentity(kind, id, version),
    metadata: makeMetadata(metadata),
  }
}

/** Convenience: re-seals an unsealed record. */
export function seal(unsealed: UnsealedPackageRecord): PackageRecord {
  return sealPackageRecord(unsealed)
}

export function makePin(record: PackageRecord, resolvedFrom?: string): LockedPackage {
  return {
    kind: record.identity.kind,
    id: record.identity.id,
    version: record.identity.version,
    contentDigest: record.identity.contentDigest,
    ...(resolvedFrom === undefined ? {} : { resolvedFrom }),
  }
}

export function makeLock(
  records: readonly PackageRecord[],
  hostCapabilities: readonly CapabilityDeclaration[] = [],
): PackageLock {
  return {
    lockVersion: LOCK_SCHEMA_VERSION,
    packages: records.map((record) => makePin(record)),
    hostCapabilities,
  }
}

/** A capability declaration fixture. */
export function capability(id: string, version: string): CapabilityDeclaration {
  return { id, version: semver(version) }
}

/** A capability requirement fixture. */
export function requires(id: string, constraint: string): CapabilityReference {
  return { id, constraint }
}

/** A permission fixture. */
export function permission(
  capabilityId: string,
  access: PermissionRequest['access'] = 'read',
): PermissionRequest {
  return { capability: capabilityId, access, justification: 'fixture' }
}

/** Builds a synthetic CAS artifact blob reference over given bytes. */
export function makeCasArtifact(
  bytes: Uint8Array,
  digest: string,
  mediaType = 'application/octet-stream',
): PackageArtifact {
  return {
    storage: 'cas',
    digest,
    sizeBytes: bytes.byteLength,
    mediaType,
  }
}
