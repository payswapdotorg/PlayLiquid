/**
 * Lockfile contract.
 *
 * Spec: spec/package-contract.md "Resolution: a package lock records exact
 * package versions and content digests"; architecture-lock rule 10 — "Game
 * lockfiles pin exact package versions/digests".
 *
 * A lock is a SET of pins: at most one pin per package id, each pin carrying
 * the exact version and exact content digest. Pin order inside the file is
 * not semantically significant: the lock fingerprint is computed over the
 * canonically sorted pin set (E9).
 */

import type { CapabilityDeclaration } from './capability.ts'
import { computeDigest } from './digest.ts'
import type { ContentDigest } from './digest.ts'
import type { PackageCoordinate } from './provenance.ts'
import { isPackageCoordinate } from './provenance.ts'
import { isPackageKind, parsePackageId } from './package-id.ts'
import { isContentDigest } from './digest.ts'
import { isSemanticVersion } from './semver.ts'

/** The lockfile schema version understood by this contract. */
export const LOCK_SCHEMA_VERSION = 1

/** One pinned package: an exact coordinate plus an audit locator. */
export interface LockedPackage extends PackageCoordinate {
  /**
   * Where the record was resolved from (registry URL, CAS address, Git
   * ref). Audit information only; resolution never fetches it.
   */
  readonly resolvedFrom?: string
}

/** A game lockfile: the exact, pinned package set of one game state. */
export interface PackageLock {
  readonly lockVersion: typeof LOCK_SCHEMA_VERSION
  readonly packages: readonly LockedPackage[]
  /** Capability declarations provided by the host environment. */
  readonly hostCapabilities: readonly CapabilityDeclaration[]
}

/** A lockfile validation error. */
export interface LockValidationError {
  readonly code: 'invalid-lock' | 'duplicate-pin'
  readonly message: string
  readonly packageId?: string
}

function compareLockedPackages(a: LockedPackage, b: LockedPackage): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function compareCapabilityDeclarations(
  a: CapabilityDeclaration,
  b: CapabilityDeclaration,
): number {
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1
  }
  return 0
}

/** Pins sorted by id — the canonical pin ordering. */
export function canonicalPins(lock: PackageLock): readonly LockedPackage[] {
  return [...lock.packages].sort(compareLockedPackages)
}

/** Host capabilities sorted by id — the canonical host ordering. */
export function canonicalHostCapabilities(
  lock: PackageLock,
): readonly CapabilityDeclaration[] {
  return [...lock.hostCapabilities].sort(compareCapabilityDeclarations)
}

/**
 * Computes the lock fingerprint: the content digest of the canonical JSON
 * of the lock with pins and host capabilities in canonical order. Two locks
 * pinning the same set produce the same fingerprint regardless of file
 * order. Assumes a structurally valid lock (see {@link validateLock}).
 */
export function computeLockFingerprint(lock: PackageLock): ContentDigest {
  return computeDigest({
    lockVersion: lock.lockVersion,
    packages: canonicalPins(lock).map((pin) => ({
      kind: pin.kind,
      id: pin.id,
      version: pin.version,
      contentDigest: pin.contentDigest,
    })),
    hostCapabilities: canonicalHostCapabilities(lock).map((capability) => ({
      id: capability.id,
      version: capability.version,
    })),
  })
}

/**
 * Validates lockfile structure. Pure and total; first failure wins.
 */
export function validateLock(
  lock: PackageLock,
): { ok: true } | { ok: false; error: LockValidationError } {
  if (typeof lock !== 'object' || lock === null) {
    return { ok: false, error: { code: 'invalid-lock', message: 'lock is not an object' } }
  }
  if (lock.lockVersion !== LOCK_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: 'invalid-lock',
        message: `unsupported lockVersion: ${String(lock.lockVersion)}`,
      },
    }
  }
  if (!Array.isArray(lock.packages)) {
    return { ok: false, error: { code: 'invalid-lock', message: 'packages is not an array' } }
  }
  const seen = new Set<string>()
  for (const pin of lock.packages) {
    if (!isPackageCoordinate(pin)) {
      return {
        ok: false,
        error: {
          code: 'invalid-lock',
          message: `pin is malformed: ${String(pin?.id ?? 'unknown id')}`,
        },
      }
    }
    if (parsePackageId(pin.id) === null) {
      return {
        ok: false,
        error: { code: 'invalid-lock', message: `pin id is invalid: ${pin.id}` },
      }
    }
    if (!isContentDigest(pin.contentDigest)) {
      return {
        ok: false,
        error: { code: 'invalid-lock', message: `pin digest is invalid: ${pin.id}` },
      }
    }
    if (!isSemanticVersion(pin.version)) {
      return {
        ok: false,
        error: { code: 'invalid-lock', message: `pin version is invalid: ${pin.id}` },
      }
    }
    if (!isPackageKind(pin.kind)) {
      return {
        ok: false,
        error: { code: 'invalid-lock', message: `pin kind is unknown: ${pin.id}` },
      }
    }
    if (seen.has(pin.id)) {
      return {
        ok: false,
        error: {
          code: 'duplicate-pin',
          message: `package id pinned more than once: ${pin.id}`,
          packageId: pin.id,
        },
      }
    }
    seen.add(pin.id)
  }
  if (!Array.isArray(lock.hostCapabilities)) {
    return {
      ok: false,
      error: { code: 'invalid-lock', message: 'hostCapabilities is not an array' },
    }
  }
  for (const capability of lock.hostCapabilities) {
    if (
      typeof capability?.id !== 'string' ||
      capability.id.length === 0 ||
      !isSemanticVersion(capability.version)
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid-lock',
          message: `host capability is malformed: ${String(capability?.id)}`,
        },
      }
    }
  }
  return { ok: true }
}
