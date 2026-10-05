/**
 * Test fixtures — ergonomic builders for structurally valid package records
 * and locks. Digested fields are computed at runtime via sealing, so no
 * digest literal ever needs to appear in source.
 *
 * Not exported from the package index; test-only.
 */

import type { CapabilityDeclaration } from './capability.ts'
import { sealPackageRecord } from './package-digest.ts'
import type {
  PackageIdentity,
  PackageMetadata,
  PackageRecord,
  UnsealedPackageRecord,
} from './package-record.ts'
import type { LockedPackage, PackageLock } from './lockfile.ts'
import type { PackageKind } from './package-id.ts'
import { LOCK_SCHEMA_VERSION } from './lockfile.ts'
import type { SemanticVersion } from './semver.ts'
import { parseSemver } from './semver.ts'

/** Parses or throws — for fixture literals only. */
export function semver(value: string): SemanticVersion {
  const parsed = parseSemver(value)
  if (parsed === null) {
    throw new Error(`fixture semver literal is invalid: ${value}`)
  }
  return parsed
}

export const BASE_COMMIT = '0123456789abcdef0123456789abcdef01234567'

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
      sourceCommit: BASE_COMMIT,
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

export function makePin(record: PackageRecord, resolvedFrom?: string): LockedPackage {
  const pin: LockedPackage = {
    kind: record.identity.kind,
    id: record.identity.id,
    version: record.identity.version,
    contentDigest: record.identity.contentDigest,
    ...(resolvedFrom === undefined ? {} : { resolvedFrom }),
  }
  return pin
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

/** Re-seals a record after mutating its unsealed shape (for tamper tests). */
export function reseal(record: PackageRecord): PackageRecord {
  const unsealed: UnsealedPackageRecord = {
    identity: {
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
    },
    metadata: record.metadata,
  }
  return sealPackageRecord(unsealed)
}
