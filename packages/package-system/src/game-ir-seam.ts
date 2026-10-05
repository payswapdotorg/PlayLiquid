/**
 * GameIR binding seam (PL-002).
 *
 * `packages/game-ir` (Work Order PL-001) does not exist yet at the time of
 * this work order; surfaces are disjoint and PL-001 runs in parallel. Per
 * the PL-002 work order, package metadata that would import GameIR types
 * references them through the minimal LOCAL STRUCTURAL types below.
 *
 * TODO: bind to @playliquid/game-ir at graft time.
 *
 * Graft procedure (TL): replace the bodies of the types in this module with
 * re-exports from `@playliquid/game-ir`, keeping the exported names stable:
 *
 *   - {@link EvaluationSuiteRef} — a reference to a GameIR evaluation suite;
 *   - {@link TargetProfileRef} — a reference to a GameIR target profile
 *     (e.g. the Spark 9:16 mobile-first profile);
 *   - {@link SemanticPath} — a path into the GameIR semantic tree, used by
 *     overlay packages to address the semantic values they override.
 *
 * The structural shapes below are intentionally minimal: they carry exactly
 * the fields the package contract needs to content-address the reference.
 */

import type { ContentDigest } from './digest.ts'
import { isContentDigest } from './digest.ts'
import type { SemanticVersion } from './semver.ts'

/** A content-addressed reference to a GameIR evaluation suite. */
export interface EvaluationSuiteRef {
  readonly suiteId: string
  readonly version: SemanticVersion
  readonly contentDigest: ContentDigest
}

/** A reference to a GameIR target profile. */
export interface TargetProfileRef {
  readonly profileId: string
  readonly version: SemanticVersion
}

/**
 * A path into the GameIR semantic tree, e.g. `world.regions[0].rules.combat`.
 * Segments are `[a-zA-Z][a-zA-Z0-9_-]*`, joined by `.`, with optional
 * `[<index>]` accessors.
 */
export type SemanticPath = string

const SEMANTIC_PATH_PATTERN =
  /^[a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_-]*|\[\d+\])*$/

/** Type guard: a well-formed GameIR semantic path. */
export function isSemanticPath(value: unknown): value is SemanticPath {
  return typeof value === 'string' && SEMANTIC_PATH_PATTERN.test(value)
}

/** Type guard: a structurally valid evaluation-suite reference. */
export function isEvaluationSuiteRef(value: unknown): value is EvaluationSuiteRef {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<EvaluationSuiteRef>
  return (
    typeof candidate.suiteId === 'string' &&
    candidate.suiteId.length > 0 &&
    isContentDigest(candidate.contentDigest)
  )
}

/** Type guard: a structurally valid target-profile reference. */
export function isTargetProfileRef(value: unknown): value is TargetProfileRef {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<TargetProfileRef>
  return (
    typeof candidate.profileId === 'string' && candidate.profileId.length > 0
  )
}
