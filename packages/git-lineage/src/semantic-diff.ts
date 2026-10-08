/**
 * Semantic diff surface: the typed classification of a change set between
 * two exact package states.
 *
 * Spec: spec/architecture.md "Git lifecycle" — "Semantic PRs can show:
 * code; package; world; asset; avatar; capability; policy; license;
 * simulation; replay; performance changes." That ten-kind list is the
 * FROZEN change-kind vocabulary here.
 *
 * This is the CONTRACT layer: a {@link SemanticDiff} is a typed
 * classification of a change set with digest-pinned opaque payloads for the
 * native details. COMPUTING a diff from real Git repositories is a later
 * work order (ports only). Subjects are typed against the GameIR semantic
 * kernel vocabulary (`NodeKind`/`NodeId` from @playliquid/game-ir) and
 * package-system semantic paths — engine-native details never leak into
 * these contracts (E3/E4).
 *
 * Pure only.
 */

import type { NodeId, NodeKind } from '@playliquid/game-ir'
import { isGameIRNodeKind } from '@playliquid/game-ir'
import type {
  ContentDigest,
  PackageCoordinate,
  SemanticPath,
} from '@playliquid/package-system'
import { computeDigest } from '@playliquid/package-system'
import { isContentDigest } from '@playliquid/package-system'
import { isPackageCoordinate } from '@playliquid/package-system'
import { isSemanticPath } from '@playliquid/package-system'

/** The frozen semantic change-kind vocabulary (architecture "Git lifecycle"). */
export const SEMANTIC_CHANGE_KINDS = [
  'code',
  'package',
  'world',
  'asset',
  'avatar',
  'capability',
  'policy',
  'license',
  'simulation',
  'replay',
  'performance',
] as const

/** One semantic change kind. */
export type SemanticChangeKind = (typeof SEMANTIC_CHANGE_KINDS)[number]

/** Type guard: a member of the semantic change-kind vocabulary. */
export function isSemanticChangeKind(value: unknown): value is SemanticChangeKind {
  return (
    typeof value === 'string' &&
    (SEMANTIC_CHANGE_KINDS as readonly string[]).includes(value)
  )
}

/** Where a semantic change applies. */
export type SemanticChangeSubject =
  /** The whole package identity (a package-level change). */
  | { readonly type: 'package'; readonly coordinate: PackageCoordinate }
  /** A GameIR semantic-kernel node (world/scene/entity/rule/...). */
  | { readonly type: 'ir-node'; readonly nodeKind: NodeKind; readonly nodeId: NodeId }
  /** A semantic path into GameIR/package metadata. */
  | { readonly type: 'semantic-path'; readonly path: SemanticPath }

/** Subject types each change kind admits (frozen coherence table). */
export const SEMANTIC_KIND_SUBJECT_RULES: Readonly<
  Record<SemanticChangeKind, readonly SemanticChangeSubject['type'][]>
> = Object.freeze({
  code: ['package', 'ir-node', 'semantic-path'],
  package: ['package', 'semantic-path'],
  world: ['ir-node', 'semantic-path'],
  asset: ['package', 'semantic-path'],
  avatar: ['ir-node', 'semantic-path'],
  capability: ['ir-node', 'semantic-path'],
  policy: ['semantic-path'],
  license: ['package', 'semantic-path'],
  simulation: ['ir-node', 'semantic-path'],
  replay: ['ir-node', 'semantic-path'],
  performance: ['package', 'semantic-path'],
})

/** GameIR node kinds each change kind admits when the subject is an ir-node. */
export const SEMANTIC_KIND_IR_NODE_RULES: Readonly<
  Record<SemanticChangeKind, readonly NodeKind[]>
> = Object.freeze({
  code: ['world', 'scene', 'entity', 'rule', 'event-declaration', 'capability-declaration', 'avatar-binding'],
  package: [],
  world: ['world', 'scene', 'entity', 'rule'],
  asset: [],
  avatar: ['avatar-binding'],
  capability: ['capability-declaration', 'event-declaration'],
  policy: [],
  license: [],
  simulation: ['rule', 'event-declaration'],
  replay: ['capability-declaration', 'event-declaration'],
  performance: [],
})

/** One classified change: kind + typed subject + digest-pinned payload. */
export interface SemanticChange {
  readonly kind: SemanticChangeKind
  readonly subject: SemanticChangeSubject
  /** Content digest pinning the opaque native-detail payload. */
  readonly payloadDigest: ContentDigest
}

/** A typed semantic diff between two exact package states. */
export interface SemanticDiff {
  readonly base: PackageCoordinate
  readonly target: PackageCoordinate
  readonly changes: readonly SemanticChange[]
}

/** Violation codes produced by semantic-diff validation. */
export type SemanticDiffValidationCode =
  | 'invalid-kind'
  | 'invalid-subject'
  | 'kind-subject-mismatch'
  | 'invalid-payload-digest'
  | 'invalid-coordinate'
  | 'duplicate-change'

/** One semantic-diff violation. */
export interface SemanticDiffViolation {
  readonly code: SemanticDiffValidationCode
  readonly message: string
  readonly changeIndex?: number
}

function isSemanticChangeSubject(value: unknown): value is SemanticChangeSubject {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<SemanticChangeSubject> & { type?: unknown }
  if (candidate.type === 'package') {
    return isPackageCoordinate(candidate.coordinate)
  }
  if (candidate.type === 'ir-node') {
    return isGameIRNodeKind(candidate.nodeKind) && typeof candidate.nodeId === 'string'
  }
  if (candidate.type === 'semantic-path') {
    return isSemanticPath(candidate.path)
  }
  return false
}

/**
 * Validates a semantic diff. Pure and total; an empty violation list means
 * every change carries a vocabulary kind, a coherent typed subject and a
 * well-formed payload digest, and base/target are exact coordinates.
 */
export function validateSemanticDiff(
  diff: SemanticDiff,
): readonly SemanticDiffViolation[] {
  const violations: SemanticDiffViolation[] = []
  if (diff === null || typeof diff !== 'object') {
    return [
      { code: 'invalid-coordinate', message: 'semantic diff is not an object' },
    ]
  }
  if (!isPackageCoordinate(diff.base)) {
    violations.push({ code: 'invalid-coordinate', message: 'diff base coordinate is malformed' })
  }
  if (!isPackageCoordinate(diff.target)) {
    violations.push({ code: 'invalid-coordinate', message: 'diff target coordinate is malformed' })
  }
  if (!Array.isArray(diff.changes)) {
    violations.push({ code: 'invalid-kind', message: 'diff changes is not an array' })
    return violations
  }
  // Array.isArray narrows readonly arrays to any[]; restore the typed view.
  const changes = diff.changes as readonly SemanticChange[]
  const seenPayloads = new Set<string>()
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]
    if (typeof change !== 'object' || change === null) {
      violations.push({
        code: 'invalid-kind',
        message: 'change is not an object',
        changeIndex: index,
      })
      continue
    }
    if (!isSemanticChangeKind(change.kind)) {
      violations.push({
        code: 'invalid-kind',
        message: `unknown semantic change kind: ${String(change.kind)}`,
        changeIndex: index,
      })
      continue
    }
    if (!isSemanticChangeSubject(change.subject)) {
      violations.push({
        code: 'invalid-subject',
        message: `change of kind ${change.kind} has a malformed subject`,
        changeIndex: index,
      })
      continue
    }
    const allowedTypes = SEMANTIC_KIND_SUBJECT_RULES[change.kind]
    if (!allowedTypes.includes(change.subject.type)) {
      violations.push({
        code: 'kind-subject-mismatch',
        message: `change kind ${change.kind} cannot take a subject of type ${change.subject.type}`,
        changeIndex: index,
      })
      continue
    }
    if (
      change.subject.type === 'ir-node' &&
      !SEMANTIC_KIND_IR_NODE_RULES[change.kind].includes(change.subject.nodeKind)
    ) {
      violations.push({
        code: 'kind-subject-mismatch',
        message: `change kind ${change.kind} cannot target a GameIR ${change.subject.nodeKind} node`,
        changeIndex: index,
      })
      continue
    }
    if (!isContentDigest(change.payloadDigest)) {
      violations.push({
        code: 'invalid-payload-digest',
        message: `change of kind ${change.kind} has a malformed payload digest`,
        changeIndex: index,
      })
    }
    const dedupeKey = `${change.kind}:${change.subject.type}:${
      change.subject.type === 'package'
        ? change.subject.coordinate.contentDigest
        : change.subject.type === 'ir-node'
          ? change.subject.nodeId
          : change.subject.path
    }`
    if (seenPayloads.has(dedupeKey)) {
      violations.push({
        code: 'duplicate-change',
        message: 'the same change kind and subject appears twice',
        changeIndex: index,
      })
    }
    seenPayloads.add(dedupeKey)
  }
  return violations
}

/** Type guard: a structurally valid, coherent semantic diff. */
export function isSemanticDiff(value: unknown): value is SemanticDiff {
  return validateSemanticDiff(value as SemanticDiff).length === 0
}

/**
 * Computes the content-addressed id of a semantic diff with package-system's
 * digest machinery (E5/E7 — no parallel hashing). Depends only on the VALUE.
 */
export function semanticDiffId(diff: SemanticDiff): ContentDigest {
  return computeDigest({
    tag: 'playliquid:semantic-diff:1',
    base: diff.base,
    target: diff.target,
    changes: diff.changes,
  })
}

/**
 * The distinct change kinds a diff contains, in frozen vocabulary order —
 * the summary a semantic PR surface shows.
 */
export function classifyChangeKinds(
  diff: SemanticDiff,
): readonly SemanticChangeKind[] {
  const present = new Set<SemanticChangeKind>()
  for (const change of diff.changes) {
    if (isSemanticChangeKind(change?.kind)) {
      present.add(change.kind)
    }
  }
  return SEMANTIC_CHANGE_KINDS.filter((kind) => present.has(kind))
}
