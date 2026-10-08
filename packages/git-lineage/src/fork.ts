/**
 * Fork contracts: the typed record of one whole-package fork.
 *
 * Spec: spec/architecture.md "Git lifecycle" ("forks"); "Package Graph"
 * ("Overlay packages are supported for narrow changes without whole-package
 * forks" — the inverse implication: a FORK is whole-package); lock rule 34 —
 * "Forks preserve lineage".
 *
 * A {@link ForkRecord} pins:
 * - the fork's own exact coordinate (the fork is a full package);
 * - the base ref: a frozen {@link PackageCoordinate} (whose content digest
 *   pins the base package content) plus a content-addressed Git commit ref
 *   (the exact commit the fork diverged from);
 * - a declared reason from a frozen vocabulary.
 *
 * The narrow counterpart of a fork is an overlay (`overlay.ts`): forks are
 * whole-package, overlays are narrow. This package records contracts only;
 * actually forking a Git repository is a later work order.
 *
 * Pure only.
 */

import type { GitCommitSha } from '@playliquid/package-system'
import { isGitCommitSha } from '@playliquid/package-system'
import type { PackageCoordinate } from '@playliquid/package-system'
import { isPackageCoordinate } from '@playliquid/package-system'
import { computeLineageNodeId } from './lineage.ts'
import type { LineageEdge } from './lineage.ts'

/** The frozen fork-reason vocabulary. */
export const FORK_REASONS = [
  /** Creative divergence: the fork intends to become a different thing. */
  'divergence',
  /** Maintenance: keeping a package alive independently of its origin. */
  'maintenance',
  /** Experiment: a Lab-style branch of experimentation. */
  'experiment',
  /** Port: adapting the package to another engine/target. */
  'port',
  /** Localization: language/region-specific content fork. */
  'localization',
  /** Policy: forking to satisfy a stricter policy envelope. */
  'policy',
  /** Security: security hardening fork. */
  'security',
] as const

/** One declared fork reason. */
export type ForkReason = (typeof FORK_REASONS)[number]

/** Type guard: a member of the fork-reason vocabulary. */
export function isForkReason(value: unknown): value is ForkReason {
  return (
    typeof value === 'string' && (FORK_REASONS as readonly string[]).includes(value)
  )
}

/** Maximum length of the free-text fork note. */
export const MAX_FORK_NOTE_LENGTH = 512

/** The fork's base ref: a frozen package coordinate plus its commit. */
export interface ForkBase {
  /** The exact base package coordinate (content digest included). */
  readonly package: PackageCoordinate
  /** The content-addressed commit the fork diverged from. */
  readonly commit: GitCommitSha
}

/** The typed record of one whole-package fork. */
export interface ForkRecord {
  /** The fork package itself: a full, sealed package coordinate. */
  readonly fork: PackageCoordinate
  readonly base: ForkBase
  readonly reason: ForkReason
  /** Optional bounded free-text justification. */
  readonly note?: string
}

/** Violation codes produced by fork-record validation. */
export type ForkValidationCode =
  | 'invalid-fork-coordinate'
  | 'invalid-base-coordinate'
  | 'invalid-base-commit'
  | 'unknown-reason'
  | 'fork-kind-mismatch'
  | 'fork-base-forbidden'
  | 'note-too-long'

/** One fork-record violation. */
export interface ForkViolation {
  readonly code: ForkValidationCode
  readonly message: string
}

function checkNote(note: string | undefined, violations: ForkViolation[]): void {
  if (note === undefined) {
    return
  }
  if (typeof note !== 'string' || note.length > MAX_FORK_NOTE_LENGTH) {
    violations.push({
      code: 'note-too-long',
      message: `fork note must be a string of at most ${MAX_FORK_NOTE_LENGTH} characters`,
    })
  }
}

/**
 * Validates a fork record against the frozen rules. Pure and total; an
 * empty violation list means the record is a legal whole-package fork.
 *
 * Rules beyond shape: the fork kind must EQUAL the base kind (forks are
 * whole-package), and the base must not itself be an overlay package
 * (narrow deltas are overlays, never fork bases).
 */
export function validateForkRecord(record: ForkRecord): readonly ForkViolation[] {
  const violations: ForkViolation[] = []
  if (record === null || typeof record !== 'object') {
    return [
      { code: 'invalid-fork-coordinate', message: 'fork record is not an object' },
    ]
  }
  if (!isPackageCoordinate(record.fork)) {
    violations.push({
      code: 'invalid-fork-coordinate',
      message: 'the fork package coordinate is missing or malformed',
    })
  }
  const base = record.base
  if (
    typeof base !== 'object' ||
    base === null ||
    !isPackageCoordinate(base.package)
  ) {
    violations.push({
      code: 'invalid-base-coordinate',
      message: 'the fork base package coordinate is missing or malformed',
    })
  }
  if (
    typeof base !== 'object' ||
    base === null ||
    !isGitCommitSha(base.commit)
  ) {
    violations.push({
      code: 'invalid-base-commit',
      message: 'the fork base commit must be a 40- or 64-hex Git commit SHA',
    })
  }
  if (!isForkReason(record.reason)) {
    violations.push({
      code: 'unknown-reason',
      message: `unknown fork reason: ${String(record.reason)}`,
    })
  }
  if (isPackageCoordinate(record.fork) && isPackageCoordinate(base?.package)) {
    const fork = record.fork
    const basePackage = base.package
    if (fork.kind !== basePackage.kind) {
      violations.push({
        code: 'fork-kind-mismatch',
        message: `forks are whole-package: fork kind ${fork.kind} must equal base kind ${basePackage.kind}`,
      })
    }
    if (basePackage.kind === 'overlay') {
      violations.push({
        code: 'fork-base-forbidden',
        message: 'an overlay package cannot be forked wholesale; fork the overlay\'s base instead (forks are whole-package, overlays are narrow)',
      })
    }
  }
  checkNote(record.note, violations)
  return violations
}

/** Type guard: a structurally valid, rule-legal fork record. */
export function isForkRecord(value: unknown): value is ForkRecord {
  return validateForkRecord(value as ForkRecord).length === 0
}

/**
 * Derives the `fork-of` lineage edge carried by a fork record. The edge
 * endpoints are the content-addressed node ids of the fork and its base.
 * Assumes a validated record (see {@link validateForkRecord}).
 */
export function forkEdgeOf(record: ForkRecord): LineageEdge {
  return {
    kind: 'fork-of',
    from: computeLineageNodeId(record.fork),
    to: computeLineageNodeId(record.base.package),
  }
}
