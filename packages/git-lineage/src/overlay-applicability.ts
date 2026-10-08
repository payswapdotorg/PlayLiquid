/**
 * Overlay applicability: checking an overlay record against a concrete base
 * package record.
 *
 * Spec continuation of `overlay.ts` (PL-012): an overlay is only applicable
 * when its targets exist (remove/replace/patch) or are absent (add) on the
 * base, and the base is a valid, overlay-legal package record. The base
 * record is validated through package-system's `validatePackageRecord`
 * seam (fail closed) — this layer adds no second record validator.
 *
 * Deep resolution of `patch` paths against base VALUES is deferred to the
 * apply/engine work order; here existence is checked at field granularity,
 * which is what the contract layer can decide.
 *
 * Pure only.
 */

import type { PackageRecord } from '@playliquid/package-system'
import { validatePackageRecord } from '@playliquid/package-system'
import type { OverlayRecord, OverlaySurface } from './overlay.ts'
import { semanticPathRoot, validateOverlayRecord } from './overlay.ts'

/** Violation codes produced by overlay applicability checking. */
export type OverlayApplicabilityCode =
  | 'invalid-base-record'
  | 'base-coordinate-mismatch'
  | 'base-kind-forbidden'
  | 'invalid-overlay-record'
  | 'target-missing'
  | 'target-exists'

/** One applicability violation. */
export interface OverlayApplicabilityViolation {
  readonly code: OverlayApplicabilityCode
  readonly message: string
  readonly opIndex?: number
}

/** The applicability verdict: ok only when violations is empty. */
export interface OverlayApplicabilityResult {
  readonly ok: boolean
  readonly violations: readonly OverlayApplicabilityViolation[]
}

/** Existing entry keys of a list-style surface on a base record. */
function baseSurfaceKeys(record: PackageRecord, surface: OverlaySurface): readonly string[] {
  const metadata = record?.metadata as unknown as Record<string, unknown> | undefined
  const entries = metadata?.[surface]
  if (!Array.isArray(entries)) {
    return []
  }
  const keys: string[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const candidate = entry as Record<string, unknown>
    const key = candidate.id ?? candidate.pointId ?? candidate.suiteId ?? candidate.capability ?? candidate.digest
    if (typeof key === 'string') {
      keys.push(key)
    }
  }
  return keys
}

function baseFieldExists(
  record: PackageRecord,
  surface: 'resources' | 'compatibility',
  field: string,
): boolean {
  const metadata = record?.metadata as unknown as Record<string, unknown> | undefined
  const surfaceValue = metadata?.[surface]
  if (typeof surfaceValue !== 'object' || surfaceValue === null) {
    return false
  }
  return field in surfaceValue
}

/**
 * Checks whether an overlay APPLIES to a concrete base package record:
 * does each target field exist (remove/replace/patch) or is it absent
 * (add), and can it legally change? The base record itself is validated
 * through package-system's `validatePackageRecord` seam (fail closed).
 *
 * Pure and total. Deep resolution of `patch` paths against base VALUES is
 * deferred to the apply/engine work order; here existence is checked at
 * field granularity, which is what the contract layer can decide.
 */
export function checkOverlayApplicability(
  overlay: OverlayRecord,
  base: PackageRecord,
): OverlayApplicabilityResult {
  const violations: OverlayApplicabilityViolation[] = []
  const recordViolations = validatePackageRecord(base)
  if (recordViolations.length > 0) {
    violations.push({
      code: 'invalid-base-record',
      message: `base package record fails package-system validation (${recordViolations.length} violation(s)); overlay applicability fails closed`,
    })
    return { ok: false, violations }
  }
  const identity = base?.identity
  if (
    overlay.base.kind !== identity?.kind ||
    overlay.base.id !== identity?.id ||
    overlay.base.contentDigest !== identity?.contentDigest
  ) {
    violations.push({
      code: 'base-coordinate-mismatch',
      message: 'the overlay base coordinate does not match the supplied base record (kind/id/digest)',
    })
  }
  if (identity?.kind === 'overlay') {
    violations.push({
      code: 'base-kind-forbidden',
      message: 'overlays may only attach to overlay-legal (non-overlay) bases',
    })
  }
  const structural = validateOverlayRecord(overlay)
  if (structural.length > 0) {
    for (const violation of structural) {
      violations.push({
        code:
          violation.code === 'base-kind-forbidden'
            ? 'base-kind-forbidden'
            : 'invalid-overlay-record',
        message: `overlay record is not structurally valid: ${violation.message}`,
        opIndex: violation.opIndex,
      })
    }
    return { ok: false, violations }
  }
  for (let index = 0; index < overlay.operations.length; index += 1) {
    const operation = overlay.operations[index]
    if (operation === undefined) {
      continue
    }
    if (operation.op === 'patch') {
      const patchSurface =
        operation.surface === 'resources' || operation.surface === 'compatibility'
          ? operation.surface
          : null
      const root = semanticPathRoot(operation.path)
      if (patchSurface === null || root === null || !baseFieldExists(base, patchSurface, root)) {
        violations.push({
          code: 'target-missing',
          message: `patch target ${operation.path} is rooted at a field the base does not carry`,
          opIndex: index,
        })
      }
      continue
    }
    const recordStyle =
      operation.surface === 'resources' || operation.surface === 'compatibility'
    if (recordStyle) {
      // Record-style surfaces address fields, not list entries.
      if (!baseFieldExists(base, operation.surface, operation.key)) {
        violations.push({
          code: 'target-missing',
          message: `replace target ${operation.surface}#${operation.key} is not a field the base carries`,
          opIndex: index,
        })
      }
      continue
    }
    const exists = baseSurfaceKeys(base, operation.surface).includes(operation.key)
    if (operation.op === 'add' && exists) {
      violations.push({
        code: 'target-exists',
        message: `add target ${operation.surface}#${operation.key} already exists on the base`,
        opIndex: index,
      })
    }
    if ((operation.op === 'remove' || operation.op === 'replace') && !exists) {
      violations.push({
        code: 'target-missing',
        message: `${operation.op} target ${operation.surface}#${operation.key} does not exist on the base`,
        opIndex: index,
      })
    }
  }
  return { ok: violations.length === 0, violations }
}
