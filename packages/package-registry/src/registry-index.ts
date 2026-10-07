/**
 * The registry index — the pure, in-memory-first core of the package
 * registry (Work Order PL-011).
 *
 * A deterministic in-memory index over sealed `PackageRecord`s from
 * `@playliquid/package-system` (PL-002): publish (immutable, idempotent,
 * mutation-rejecting), lookup by identity / digest / capability /
 * permission, listing with stable ordering, and deterministic lock
 * resolution that REUSES package-system's `resolve` (never re-implemented).
 *
 * Purity discipline: no IO, no fs, no network, no clock, no randomness
 * (E1: this object is the single owner of the in-memory index state; the
 * same sequence of publishes always produces the identical index state —
 * E9 determinism). Persistence belongs to the `RegistryStore` port (see
 * `registry.ts`).
 */

import {
  capabilityProvided,
  checkReleaseGate,
  compareSemver,
  formatSemver,
  semverSatisfies,
  validatePackageRecord,
} from '@playliquid/package-system'
import type {
  CapabilityId,
  CapabilityReference,
  ContentDigest,
  PackageId,
  PackageKind,
  PackageLock,
  PackageRecord,
  RecordViolation,
  ReleaseGateFailure,
  ReleaseGateResult,
  ResolutionResult,
  SemanticVersion,
} from '@playliquid/package-system'
import { resolve } from '@playliquid/package-system'
import { sealedCopy } from './freeze.ts'

/** Options controlling record admission. */
export interface RegistryIndexOptions {
  /**
   * Enforce the provenance/licensing release gate (R19) on publish. Default
   * `true` — publication fails closed when required license/provenance
   * evidence is missing. Setting this to `false` admits structurally valid
   * records WITHOUT gate evidence (an explicit, auditable opt-out for local
   * analysis indexes; production publication keeps the default).
   */
  readonly enforceReleaseGate?: boolean
}

/** Identity lookup coordinate (digest excluded — it is the lookup answer). */
export interface RegistryCoordinate {
  readonly kind: PackageKind
  readonly id: PackageId
  readonly version: SemanticVersion
}

/** Failure codes of registry publication. */
export type RegistryPublishFailureCode =
  | 'invalid-record'
  | 'release-gate'
  | 'mutation-rejected'

/** The success arm of publication. */
export interface RegistryPublishSuccess {
  readonly ok: true
  /** The record as stored (a sealed, deep-frozen copy). */
  readonly record: PackageRecord
  /** `published` — new coordinate; `already-published` — idempotent hit. */
  readonly status: 'published' | 'already-published'
}

/** The failure arm of publication. */
export interface RegistryPublishFailure {
  readonly ok: false
  readonly code: RegistryPublishFailureCode
  readonly message: string
  /** Structural violations (`invalid-record`). */
  readonly violations?: readonly RecordViolation[]
  /** Release-gate reasons (`release-gate`). */
  readonly gateReasons?: readonly ReleaseGateFailure[]
  /** The digest already pinned at the contested coordinate. */
  readonly existingDigest?: ContentDigest
}

/** The result of a publish attempt. */
export type RegistryPublishResult = RegistryPublishSuccess | RegistryPublishFailure

/** The registry index itself. */
export interface RegistryIndex {
  /** Admits a record; see module docs for immutability semantics. */
  publish(record: PackageRecord): RegistryPublishResult
  /** Pure pre-flight of {@link publish} without mutating the index. */
  checkPublish(record: PackageRecord): RegistryPublishResult
  /** Exact-coordinate lookup (build metadata is significant). */
  get(coordinate: RegistryCoordinate): PackageRecord | null
  /** Digest lookup: the record whose content hashes to `digest`. */
  getByDigest(digest: ContentDigest): PackageRecord | null
  /** Highest-precedence version of `id` satisfying `constraint`. */
  bestMatch(id: PackageId, constraint: string): PackageRecord | null
  /** Records PROVIDING a capability that satisfies the reference. */
  findProviders(reference: CapabilityReference): readonly PackageRecord[]
  /** Records REQUIRING a capability (by id). */
  findRequiring(capabilityId: CapabilityId): readonly PackageRecord[]
  /** Records holding a permission on a capability (permission filter). */
  findByPermission(capabilityId: CapabilityId): readonly PackageRecord[]
  /** All records in stable order: id ascending, then version precedence. */
  list(): readonly PackageRecord[]
  /** Versions of one id in precedence order (deterministic tie-break). */
  listVersions(id: PackageId): readonly SemanticVersion[]
  /** Snapshot usable as package-system's `PackageIndex`. */
  snapshot(): readonly PackageRecord[]
  /** Deterministic resolution of a lock against the snapshot (E9). */
  resolveLock(lock: PackageLock): ResolutionResult
  /** Number of indexed records. */
  size(): number
}

function publishFailureFromGate(gate: ReleaseGateResult): RegistryPublishFailure {
  return {
    ok: false,
    code: 'release-gate',
    message: `release gate failed (R19 fail-closed): ${gate.reasons
      .map((reason) => reason.message)
      .join('; ')}`,
    gateReasons: gate.reasons,
  }
}

/**
 * Creates an empty registry index. Records are admitted through
 * {@link RegistryIndex.publish} (or `loadRecords` on the port-wired facade),
 * never through the constructor — construction cannot fail.
 */
export function createRegistryIndex(
  options: RegistryIndexOptions = {},
): RegistryIndex {
  const enforceReleaseGate = options.enforceReleaseGate ?? true
  const byId = new Map<PackageId, Map<string, PackageRecord>>()
  const byDigest = new Map<ContentDigest, PackageRecord>()
  let count = 0

  function versionKey(version: SemanticVersion): string {
    return formatSemver(version)
  }

  /** Total order for stable listing: id, then precedence, then format. */
  function compareRecords(a: PackageRecord, b: PackageRecord): number {
    if (a.identity.id !== b.identity.id) {
      return a.identity.id < b.identity.id ? -1 : 1
    }
    const precedence = compareSemver(a.identity.version, b.identity.version)
    if (precedence !== 0) {
      return precedence
    }
    const aKey = versionKey(a.identity.version)
    const bKey = versionKey(b.identity.version)
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
  }

  function evaluatePublish(record: PackageRecord): RegistryPublishResult {
    const violations = validatePackageRecord(record)
    if (violations.length > 0) {
      return {
        ok: false,
        code: 'invalid-record',
        message: `record failed structural validation: ${violations
          .map((violation) => `${violation.code} (${violation.message})`)
          .join('; ')}`,
        violations,
      }
    }
    if (enforceReleaseGate) {
      const gate = checkReleaseGate(record)
      if (!gate.pass) {
        return publishFailureFromGate(gate)
      }
    }
    const versions = byId.get(record.identity.id)
    const existing = versions?.get(versionKey(record.identity.version))
    if (existing !== undefined) {
      if (existing.identity.contentDigest === record.identity.contentDigest) {
        return { ok: true, record: existing, status: 'already-published' }
      }
      return {
        ok: false,
        code: 'mutation-rejected',
        message:
          `coordinate ${record.identity.kind}:${record.identity.id}@${versionKey(record.identity.version)} ` +
          `is already published with digest ${existing.identity.contentDigest}; ` +
          `packages are immutable — mutating a published coordinate is rejected (lock rule 8)`,
        existingDigest: existing.identity.contentDigest,
      }
    }
    return { ok: true, record: sealedCopy(record), status: 'published' }
  }

  return {
    publish: (record: PackageRecord): RegistryPublishResult => {
      const verdict = evaluatePublish(record)
      if (!verdict.ok || verdict.status === 'already-published') {
        return verdict
      }
      const stored = verdict.record
      let versions = byId.get(stored.identity.id)
      if (versions === undefined) {
        versions = new Map<string, PackageRecord>()
        byId.set(stored.identity.id, versions)
      }
      versions.set(versionKey(stored.identity.version), stored)
      byDigest.set(stored.identity.contentDigest, stored)
      count += 1
      return verdict
    },

    checkPublish: (record: PackageRecord): RegistryPublishResult =>
      evaluatePublish(record),

    get: (coordinate: RegistryCoordinate): PackageRecord | null => {
      const record = byId.get(coordinate.id)?.get(versionKey(coordinate.version))
      if (record === undefined) {
        return null
      }
      // Kind is part of package identity: a coordinate of another kind never
      // resolves to this record (fail closed, no kind-blind lookup).
      return record.identity.kind === coordinate.kind ? record : null
    },

    getByDigest: (digest: ContentDigest): PackageRecord | null =>
      byDigest.get(digest) ?? null,

    bestMatch: (id: PackageId, constraint: string): PackageRecord | null => {
      const versions = byId.get(id)
      if (versions === undefined) {
        return null
      }
      const satisfying = [...versions.values()].filter((record) =>
        semverSatisfies(record.identity.version, constraint),
      )
      if (satisfying.length === 0) {
        return null
      }
      satisfying.sort(compareRecords)
      return satisfying[satisfying.length - 1] ?? null
    },

    findProviders: (reference: CapabilityReference): readonly PackageRecord[] => {
      const providers: PackageRecord[] = []
      for (const record of snapshotRecords()) {
        if (
          record.metadata.providedCapabilities.length > 0 &&
          capabilityProvided(record.metadata.providedCapabilities, reference) !== null
        ) {
          providers.push(record)
        }
      }
      return providers
    },

    findRequiring: (capabilityId: CapabilityId): readonly PackageRecord[] => {
      const requiring: PackageRecord[] = []
      for (const record of snapshotRecords()) {
        if (
          record.metadata.requiredCapabilities.some(
            (requirement) => requirement.id === capabilityId,
          )
        ) {
          requiring.push(record)
        }
      }
      return requiring
    },

    findByPermission: (capabilityId: CapabilityId): readonly PackageRecord[] => {
      const holders: PackageRecord[] = []
      for (const record of snapshotRecords()) {
        if (
          record.metadata.permissions.some(
            (permission) => permission.capability === capabilityId,
          )
        ) {
          holders.push(record)
        }
      }
      return holders
    },

    list: (): readonly PackageRecord[] => snapshotRecords(),

    listVersions: (id: PackageId): readonly SemanticVersion[] => {
      const versions = byId.get(id)
      if (versions === undefined) {
        return []
      }
      return [...versions.values()]
        .map((record) => record.identity.version)
        .sort((a, b) => {
          const precedence = compareSemver(a, b)
          if (precedence !== 0) {
            return precedence
          }
          return versionKey(a) < versionKey(b) ? -1 : versionKey(a) > versionKey(b) ? 1 : 0
        })
    },

    snapshot: (): readonly PackageRecord[] => snapshotRecords(),

    resolveLock: (lock: PackageLock): ResolutionResult =>
      resolve(lock, { records: snapshotRecords() }),

    size: (): number => count,
  }

  /** Stable snapshot (id + version precedence + format tie-break ordered). */
  function snapshotRecords(): PackageRecord[] {
    const records: PackageRecord[] = []
    for (const versions of byId.values()) {
      for (const record of versions.values()) {
        records.push(record)
      }
    }
    records.sort(compareRecords)
    return records
  }
}

/**
 * Admits a list of records into an index (load path). Returns per-record
 * verdicts; `already-published` counts as loaded, never as a failure. Used
 * by the port-wired facade and by tests seeding an index.
 */
export function loadRecords(
  index: RegistryIndex,
  records: readonly PackageRecord[],
): { loaded: number; failures: readonly { record: PackageRecord; result: RegistryPublishResult }[] } {
  let loaded = 0
  const failures: { record: PackageRecord; result: RegistryPublishResult }[] = []
  for (const record of records) {
    const result = index.publish(record)
    if (result.ok) {
      loaded += 1
    } else {
      failures.push({ record, result })
    }
  }
  return { loaded, failures }
}
