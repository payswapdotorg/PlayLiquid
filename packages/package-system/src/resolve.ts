/**
 * Deterministic package resolution.
 *
 * Spec: spec/package-contract.md "Resolution must be deterministic for a
 * pinned lock" (E9); PL-002 work order:
 * `resolve(lock, packageIndex) -> Resolution | ResolutionError`.
 *
 * Properties:
 * - PURE: no IO, no git client, no network, no clock, no randomness.
 * - TOTAL: every input yields either a Resolution or a ResolutionError;
 *   resolution never throws for structurally tolerable inputs.
 * - DETERMINISTIC: the result depends only on the lock's pin SET and the
 *   index's record SET — never on pin order, record order or key order.
 *   Check order is fixed: lock structure, per-pin lookup and integrity,
 *   dependency closure, cycles, capability closure, overlay targets. First
 *   failure wins.
 *
 * The registry/CAS IO layer is a later work order (PL-011); the index here
 * is an in-memory list of package records.
 */

import { capabilityProvided } from './capability.ts'
import { computeLockFingerprint, canonicalPins, validateLock } from './lockfile.ts'
import type { LockedPackage, PackageLock } from './lockfile.ts'
import type { PackageId } from './package-id.ts'
import type { PackageRecord } from './package-record.ts'
import { formatSemver, isSemanticVersion, semverSatisfies } from './semver.ts'
import { validatePackageRecord } from './validate-record.ts'

/** An in-memory index of package records (the registry's read model). */
export interface PackageIndex {
  readonly records: readonly PackageRecord[]
}

/** One resolved package: its pin and the full record selected for it. */
export interface ResolvedPackageEntry {
  readonly pin: LockedPackage
  readonly record: PackageRecord
}

/** A directed edge in the resolved dependency graph. */
export interface DependencyEdge {
  readonly id: PackageId
  readonly dependsOn: readonly PackageId[]
}

/** The successful resolution of a pinned lock against a package index. */
export interface Resolution {
  readonly ok: true
  /** Canonical fingerprint of the resolved lock (order-insensitive). */
  readonly lockFingerprint: string
  /** Resolved packages, sorted by id. */
  readonly packages: readonly ResolvedPackageEntry[]
  /** Dependencies-first topological order of package ids. */
  readonly topologicalOrder: readonly PackageId[]
  /** Adjacency lists, sorted by id and by dependency id. */
  readonly dependencyGraph: readonly DependencyEdge[]
}

/** Every rejection code resolution can produce. */
export type ResolutionErrorCode =
  | 'invalid-lock'
  | 'invalid-index'
  | 'duplicate-pin'
  | 'missing-package'
  | 'duplicate-record'
  | 'kind-mismatch'
  | 'digest-mismatch'
  | 'tampered-record'
  | 'invalid-record'
  | 'unpinned-dependency'
  | 'version-mismatch'
  | 'dependency-kind-mismatch'
  | 'cyclic-dependency'
  | 'unsatisfied-capability'
  | 'missing-overlay-target'
  | 'overlay-target-mismatch'

/** The rejection result. */
export interface ResolutionError {
  readonly ok: false
  readonly code: ResolutionErrorCode
  readonly message: string
  readonly packageId?: PackageId
  /** For cyclic dependencies: the cycle path, start and end repeated. */
  readonly cyclePath?: readonly PackageId[]
}

/** The result of resolution. */
export type ResolutionResult = Resolution | ResolutionError

function fail(
  code: ResolutionErrorCode,
  message: string,
  extra?: { packageId?: PackageId; cyclePath?: readonly PackageId[] },
): ResolutionError {
  return { ok: false, code, message, ...extra }
}

/** Groups index records by id; rejects malformed ids/versions and duplicate coordinates. */
function groupIndexRecords(
  records: readonly PackageRecord[],
): Map<PackageId, PackageRecord[]> | ResolutionError {
  const byId = new Map<PackageId, PackageRecord[]>()
  const seenCoordinates = new Set<string>()
  for (const record of records) {
    const identity = record?.identity
    const id = identity?.id
    if (typeof id !== 'string' || !isSemanticVersion(identity?.version)) {
      return fail('invalid-index', 'index contains a record without a valid identity')
    }
    const coordinateKey = `${id}@${formatSemver(identity.version)}`
    if (seenCoordinates.has(coordinateKey)) {
      return fail('duplicate-record', `index contains more than one record for ${coordinateKey}`, {
        packageId: id,
      })
    }
    seenCoordinates.add(coordinateKey)
    const bucket = byId.get(id)
    if (bucket === undefined) {
      byId.set(id, [record])
    } else {
      bucket.push(record)
    }
  }
  return byId
}

/**
 * Resolves a pinned lock against an in-memory package index.
 *
 * Deterministic and total (E9). Never fetches; the IO layer is PL-011.
 */
export function resolve(lock: PackageLock, index: PackageIndex): ResolutionResult {
  const lockCheck = validateLock(lock)
  if (!lockCheck.ok) {
    return fail(lockCheck.error.code, lockCheck.error.message, {
      packageId: lockCheck.error.packageId,
    })
  }
  if (typeof index !== 'object' || index === null || !Array.isArray(index.records)) {
    return fail('invalid-index', 'package index is not an object with a records array')
  }

  const grouped = groupIndexRecords(index.records)
  if (!(grouped instanceof Map)) {
    return grouped
  }
  const byId = grouped

  // Select and verify one record per pin, in canonical (id-sorted) order.
  const pins = canonicalPins(lock)
  const resolved = new Map<PackageId, ResolvedPackageEntry>()
  for (const pin of pins) {
    const candidates = byId.get(pin.id) ?? []
    const matches = candidates.filter(
      (record) => formatSemver(record.identity.version) === formatSemver(pin.version),
    )
    const record = matches[0]
    if (record === undefined) {
      return fail(
        'missing-package',
        `no record for ${pin.id}@${formatSemver(pin.version)} in the package index`,
        { packageId: pin.id },
      )
    }
    if (record.identity.kind !== pin.kind) {
      return fail(
        'kind-mismatch',
        `pin expects kind ${pin.kind} but record for ${pin.id} declares ${String(record.identity.kind)}`,
        { packageId: pin.id },
      )
    }
    if (record.identity.contentDigest !== pin.contentDigest) {
      return fail(
        'digest-mismatch',
        `pin digest for ${pin.id} does not match the index record (expected ${pin.contentDigest}, found ${String(record.identity.contentDigest)})`,
        { packageId: pin.id },
      )
    }
    const violations = validatePackageRecord(record)
    const first = violations[0]
    if (first !== undefined) {
      const code: ResolutionErrorCode =
        first.code === 'digest-integrity' ? 'tampered-record' : 'invalid-record'
      return fail(code, `${first.code}: ${first.message}`, { packageId: pin.id })
    }
    resolved.set(pin.id, { pin, record })
  }

  // Dependency closure: every non-optional dependency must be pinned and
  // satisfy the declared constraint and kind.
  const adjacency = new Map<PackageId, PackageId[]>()
  const sortedIds = [...resolved.keys()].sort()
  for (const id of sortedIds) {
    const entry = resolved.get(id)
    if (entry === undefined) {
      continue
    }
    const dependsOn: PackageId[] = []
    for (const dependency of entry.record.metadata.dependencies) {
      const dependencyEntry = resolved.get(dependency.id)
      if (dependencyEntry === undefined) {
        if (dependency.optional) {
          continue
        }
        return fail(
          'unpinned-dependency',
          `${id} depends on ${dependency.id} (${dependency.constraint}) which is not pinned in the lock`,
          { packageId: dependency.id },
        )
      }
      if (!semverSatisfies(dependencyEntry.record.identity.version, dependency.constraint)) {
        return fail(
          'version-mismatch',
          `${id} requires ${dependency.id} ${dependency.constraint} but the lock pins ${formatSemver(dependencyEntry.record.identity.version)}`,
          { packageId: dependency.id },
        )
      }
      if (
        dependency.kind !== null &&
        dependencyEntry.record.identity.kind !== dependency.kind
      ) {
        return fail(
          'dependency-kind-mismatch',
          `${id} expects dependency ${dependency.id} of kind ${dependency.kind} but found ${String(dependencyEntry.record.identity.kind)}`,
          { packageId: dependency.id },
        )
      }
      dependsOn.push(dependency.id)
    }
    dependsOn.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    adjacency.set(id, dependsOn)
  }

  // Cycle detection and dependencies-first topological order. Iterative
  // DFS over id-sorted roots and id-sorted adjacency keeps the function
  // total (no recursion-depth limit) and deterministic.
  const order: PackageId[] = []
  const finished = new Set<PackageId>()
  const onStack = new Set<PackageId>()
  const frames: Array<{ id: PackageId; next: number }> = []
  for (const root of sortedIds) {
    if (finished.has(root)) {
      continue
    }
    frames.push({ id: root, next: 0 })
    onStack.add(root)
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      if (frame === undefined) {
        break
      }
      const children = adjacency.get(frame.id) ?? []
      const child = children[frame.next]
      frame.next += 1
      if (child === undefined) {
        onStack.delete(frame.id)
        finished.add(frame.id)
        order.push(frame.id)
        frames.pop()
        continue
      }
      if (finished.has(child)) {
        continue
      }
      if (onStack.has(child)) {
        const startIndex = frames.findIndex((entry) => entry.id === child)
        const cycle = [
          ...frames.slice(startIndex === -1 ? 0 : startIndex).map((entry) => entry.id),
          child,
        ]
        return fail('cyclic-dependency', `dependency cycle detected: ${cycle.join(' -> ')}`, {
          packageId: child,
          cyclePath: cycle,
        })
      }
      onStack.add(child)
      frames.push({ id: child, next: 0 })
    }
  }

  // Capability closure: every required capability must be provided by a
  // resolved package or by the host declarations in the lock.
  const provided = [
    ...sortedIds.flatMap(
      (id) => resolved.get(id)?.record.metadata.providedCapabilities ?? [],
    ),
    ...lock.hostCapabilities,
  ]
  for (const id of sortedIds) {
    const entry = resolved.get(id)
    if (entry === undefined) {
      continue
    }
    for (const requirement of entry.record.metadata.requiredCapabilities) {
      if (capabilityProvided(provided, requirement) === null) {
        return fail(
          'unsatisfied-capability',
          `${id} requires capability ${requirement.id} ${requirement.constraint} which no resolved package or host provides`,
          { packageId: id },
        )
      }
    }
  }

  // Overlay targets must be pinned at the exact declared coordinate.
  for (const id of sortedIds) {
    const entry = resolved.get(id)
    if (entry === undefined) {
      continue
    }
    const overlay = entry.record.metadata.overlay
    if (overlay === null || overlay === undefined) {
      continue
    }
    const targetEntry = resolved.get(overlay.target.id)
    if (targetEntry === undefined) {
      return fail(
        'missing-overlay-target',
        `overlay ${id} targets ${overlay.target.id} which is not pinned in the lock`,
        { packageId: id },
      )
    }
    const target = targetEntry.record.identity
    if (
      target.kind !== overlay.target.kind ||
      formatSemver(target.version) !== formatSemver(overlay.target.version) ||
      target.contentDigest !== overlay.target.contentDigest
    ) {
      return fail(
        'overlay-target-mismatch',
        `overlay ${id} targets ${overlay.target.id}@${formatSemver(overlay.target.version)} (${overlay.target.contentDigest}) but the lock pins ${formatSemver(target.version)} (${target.contentDigest})`,
        { packageId: id },
      )
    }
  }

  const packages = sortedIds.flatMap((id) => {
    const entry = resolved.get(id)
    return entry === undefined ? [] : [entry]
  })
  const dependencyGraph = sortedIds.map((id) => ({
    id,
    dependsOn: adjacency.get(id) ?? [],
  }))

  return {
    ok: true,
    lockFingerprint: computeLockFingerprint(lock),
    packages,
    topologicalOrder: order,
    dependencyGraph,
  }
}

/** Narrows a resolution result to its error form. */
export function isResolutionError(
  result: ResolutionResult,
): result is ResolutionError {
  return result.ok === false
}
