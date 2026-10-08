/**
 * Overlay contracts: the typed record of one NARROW change over a package
 * manifest surface.
 *
 * Spec: spec/architecture.md "Package Graph" — "Overlay packages are
 * supported for narrow changes without whole-package forks"; the Git
 * lifecycle lists overlays alongside forks and lineage.
 *
 * An {@link OverlayOperation} is a TYPED record from a closed set —
 * add/remove/replace/patch over a frozen vocabulary of package manifest
 * surfaces. There is no patch-string parsing and no diff algorithm here:
 * values are digest-pinned (`ContentDigest`) and paths are package-system
 * `SemanticPath`s. Applicability checking against a concrete base package
 * record lives in `overlay-applicability.ts`.
 *
 * The whole-package counterpart of an overlay is a fork (`fork.ts`).
 * Overlays attach only to overlay-legal bases: any package kind except
 * `overlay` itself (overlays do not stack on overlays).
 *
 * Pure only.
 */

import type { ContentDigest, PackageCoordinate } from '@playliquid/package-system'
import { isContentDigest, isPackageCoordinate } from '@playliquid/package-system'
import { isSemanticPath } from '@playliquid/package-system'
import { computeLineageNodeId } from './lineage.ts'
import type { LineageEdge } from './lineage.ts'

/** The closed overlay operation vocabulary. */
export const OVERLAY_OP_KINDS = ['add', 'remove', 'replace', 'patch'] as const

/** One overlay operation kind. */
export type OverlayOpKind = (typeof OVERLAY_OP_KINDS)[number]

/**
 * The frozen vocabulary of overlay-legal package manifest surfaces — the
 * camelCase `PackageMetadata` field names, addressed 1:1. Deliberately
 * EXCLUDES `identity`, `license`, `provenance`, `lineage` and `overlay` —
 * those surfaces are never overlayable (see
 * {@link FORBIDDEN_OVERLAY_SURFACES}).
 */
export const OVERLAY_SURFACES = [
  'dependencies',
  'providedCapabilities',
  'requiredCapabilities',
  'permissions',
  'artifacts',
  'extensionPoints',
  'evaluationSuites',
  'resources',
  'compatibility',
] as const

/** One overlayable package manifest surface. */
export type OverlaySurface = (typeof OVERLAY_SURFACES)[number]

/**
 * Manifest surfaces that may NEVER be overlaid. `license`, `provenance` and
 * `lineage` are R19/immutability surfaces (changing them through a narrow
 * overlay would bypass the release gate); `identity` is the sealed package
 * identity; `overlay` would let an overlay retarget another overlay.
 */
export const FORBIDDEN_OVERLAY_SURFACES = [
  'identity',
  'license',
  'provenance',
  'lineage',
  'overlay',
] as const

/**
 * Package kinds an overlay may attach to: every kind except `overlay`
 * (overlays do not stack; narrow changes compose through the base).
 */
export const OVERLAY_LEGAL_BASE_KINDS = [
  'game',
  'world',
  'assets',
  'avatar',
  'system',
  'evaluation-suite',
] as const

/** Legal field names of the `resources` surface. */
export const RESOURCE_FIELD_KEYS = [
  'minMemoryBytes',
  'minStorageBytes',
  'minCpuCores',
  'gpuRequired',
  'networkRequired',
] as const

/** Legal field names of the `compatibility` surface. */
export const COMPATIBILITY_FIELD_KEYS = ['runtimes', 'engines', 'targets'] as const

/** Frozen per-surface rule: which ops apply and how ops address targets. */
export interface OverlaySurfaceRule {
  readonly surface: OverlaySurface
  /** Operations legal on this surface. */
  readonly ops: readonly OverlayOpKind[]
  /** List-style surface: ops address entries by key (id/digest/pointId). */
  readonly keyed: boolean
  /** Record-style surface: `patch` addresses a `SemanticPath` rooted at a field. */
  readonly pathed: boolean
}

/** The frozen surface rule table. */
export const OVERLAY_SURFACE_RULES: Readonly<
  Record<OverlaySurface, OverlaySurfaceRule>
> = Object.freeze({
  dependencies: {
    surface: 'dependencies',
    ops: ['add', 'remove', 'replace'],
    keyed: true,
    pathed: false,
  },
  providedCapabilities: {
    surface: 'providedCapabilities',
    ops: ['add', 'remove', 'replace'],
    keyed: true,
    pathed: false,
  },
  requiredCapabilities: {
    surface: 'requiredCapabilities',
    ops: ['add', 'remove', 'replace'],
    keyed: true,
    pathed: false,
  },
  permissions: {
    surface: 'permissions',
    ops: ['add', 'remove', 'replace'],
    keyed: true,
    pathed: false,
  },
  artifacts: {
    surface: 'artifacts',
    ops: ['add', 'remove'],
    keyed: true,
    pathed: false,
  },
  extensionPoints: {
    surface: 'extensionPoints',
    ops: ['add', 'remove', 'replace'],
    keyed: true,
    pathed: false,
  },
  evaluationSuites: {
    surface: 'evaluationSuites',
    ops: ['add', 'remove', 'replace'],
    keyed: true,
    pathed: false,
  },
  resources: {
    surface: 'resources',
    ops: ['replace', 'patch'],
    keyed: true,
    pathed: true,
  },
  compatibility: {
    surface: 'compatibility',
    ops: ['replace', 'patch'],
    keyed: true,
    pathed: true,
  },
})

/** One typed overlay operation (closed set; no patch strings). */
export type OverlayOperation =
  | {
      readonly op: 'add'
      readonly surface: OverlaySurface
      readonly key: string
      readonly valueDigest: ContentDigest
    }
  | {
      readonly op: 'remove'
      readonly surface: OverlaySurface
      readonly key: string
    }
  | {
      readonly op: 'replace'
      readonly surface: OverlaySurface
      readonly key: string
      readonly valueDigest: ContentDigest
    }
  | {
      readonly op: 'patch'
      readonly surface: OverlaySurface
      readonly path: string
      readonly valueDigest: ContentDigest
    }

/** The typed record of one narrow overlay over an exact base package. */
export interface OverlayRecord {
  /** The base package coordinate this overlay applies to. */
  readonly base: PackageCoordinate
  readonly operations: readonly OverlayOperation[]
}

/** Violation codes produced by overlay-record validation. */
export type OverlayValidationCode =
  | 'invalid-base-coordinate'
  | 'base-kind-forbidden'
  | 'empty-overlay'
  | 'unknown-surface'
  | 'unknown-op'
  | 'invalid-key'
  | 'invalid-path'
  | 'invalid-value-digest'
  | 'conflicting-operations'

/** One overlay-record violation. */
export interface OverlayViolation {
  readonly code: OverlayValidationCode
  readonly message: string
  readonly opIndex?: number
}

/** Type guard: a member of the overlay surface vocabulary. */
export function isOverlaySurface(value: unknown): value is OverlaySurface {
  return (
    typeof value === 'string' &&
    (OVERLAY_SURFACES as readonly string[]).includes(value)
  )
}

/** Root segment of a semantic path (before the first `.` or `[`), or null. */
export function semanticPathRoot(path: string): string | null {
  if (!isSemanticPath(path)) {
    return null
  }
  const match = /^[a-zA-Z][a-zA-Z0-9_-]*/.exec(path)
  return match === null ? null : match[0]
}

function fieldKeysOfSurface(surface: OverlaySurface): readonly string[] {
  if (surface === 'resources') {
    return RESOURCE_FIELD_KEYS
  }
  if (surface === 'compatibility') {
    return COMPATIBILITY_FIELD_KEYS
  }
  return []
}

function checkOperation(
  operation: OverlayOperation,
  index: number,
  violations: OverlayViolation[],
): void {
  if (typeof operation !== 'object' || operation === null) {
    violations.push({ code: 'unknown-op', message: 'operation is not an object', opIndex: index })
    return
  }
  const candidate = operation as Partial<OverlayOperation> & {
    op?: unknown
    surface?: unknown
    key?: unknown
    path?: unknown
    valueDigest?: unknown
  }
  if (!isOverlaySurface(candidate.surface)) {
    violations.push({
      code: 'unknown-surface',
      message: `unknown or forbidden overlay surface: ${String(candidate.surface)}`,
      opIndex: index,
    })
    return
  }
  const rule = OVERLAY_SURFACE_RULES[candidate.surface]
  if (!rule.ops.includes(candidate.op as OverlayOpKind)) {
    violations.push({
      code: 'unknown-op',
      message: `op ${String(candidate.op)} is not legal on surface ${candidate.surface}`,
      opIndex: index,
    })
    return
  }
  if (candidate.op === 'patch') {
    const path = candidate.path
    if (typeof path !== 'string' || !isSemanticPath(path)) {
      violations.push({
        code: 'invalid-path',
        message: 'patch path is not a well-formed semantic path',
        opIndex: index,
      })
      return
    }
    const root = semanticPathRoot(path)
    if (root === null || !fieldKeysOfSurface(candidate.surface).includes(root)) {
      violations.push({
        code: 'invalid-path',
        message: `patch path ${path} is not rooted at a legal field of ${candidate.surface}`,
        opIndex: index,
      })
      return
    }
  } else {
    const key = candidate.key
    const legalFields = fieldKeysOfSurface(candidate.surface)
    if (typeof key !== 'string' || key.length === 0) {
      violations.push({
        code: 'invalid-key',
        message: `${String(candidate.op)} key must be a non-empty string`,
        opIndex: index,
      })
      return
    }
    if (legalFields.length > 0 && !legalFields.includes(key)) {
      violations.push({
        code: 'invalid-key',
        message: `${String(candidate.op)} key ${key} is not a legal field of ${candidate.surface}`,
        opIndex: index,
      })
      return
    }
  }
  if (candidate.op !== 'remove' && !isContentDigest(candidate.valueDigest)) {
    violations.push({
      code: 'invalid-value-digest',
      message: `${String(candidate.op)} value must be pinned by a well-formed content digest`,
      opIndex: index,
    })
  }
}

/**
 * Validates an overlay record structurally. Pure and total; an empty
 * violation list means every operation is typed, closed-set-legal and
 * non-conflicting, and the base is an overlay-legal coordinate.
 */
export function validateOverlayRecord(
  record: OverlayRecord,
): readonly OverlayViolation[] {
  const violations: OverlayViolation[] = []
  if (record === null || typeof record !== 'object') {
    return [
      { code: 'invalid-base-coordinate', message: 'overlay record is not an object' },
    ]
  }
  if (!isPackageCoordinate(record.base)) {
    violations.push({
      code: 'invalid-base-coordinate',
      message: 'the overlay base package coordinate is missing or malformed',
    })
  } else if (record.base.kind === 'overlay') {
    violations.push({
      code: 'base-kind-forbidden',
      message: 'overlays may only attach to overlay-legal (non-overlay) bases',
    })
  }
  const operations = record.operations
  if (!Array.isArray(operations) || operations.length === 0) {
    violations.push({
      code: 'empty-overlay',
      message: 'an overlay must declare at least one operation (an empty overlay is a no-op)',
    })
    return violations
  }
  const seenTargets = new Set<string>()
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]
    checkOperation(operation, index, violations)
    if (typeof operation === 'object' && operation !== null) {
      const candidate = operation as Partial<OverlayOperation>
      const targetKey =
        candidate.op === 'patch'
          ? candidate.path
          : (candidate as { key?: unknown }).key
      const target = `${String(candidate.surface)}#${String(targetKey)}`
      if (seenTargets.has(target)) {
        violations.push({
          code: 'conflicting-operations',
          message: `two operations address the same target ${target}`,
          opIndex: index,
        })
      }
      seenTargets.add(target)
    }
  }
  return violations
}

/** Type guard: a structurally valid, rule-legal overlay record. */
export function isOverlayRecord(value: unknown): value is OverlayRecord {
  return validateOverlayRecord(value as OverlayRecord).length === 0
}


/**
 * Derives the `overlay-of` lineage edge between an overlay package and its
 * base: endpoints are the content-addressed node ids of the two exact
 * coordinates. Assumes validated inputs — the overlay coordinate is a
 * `kind: 'overlay'` package and the base is overlay-legal (see
 * {@link validateOverlayRecord}).
 */
export function overlayEdgeOf(
  overlay: PackageCoordinate,
  base: PackageCoordinate,
): LineageEdge {
  return {
    kind: 'overlay-of',
    from: computeLineageNodeId(overlay),
    to: computeLineageNodeId(base),
  }
}
