/**
 * Provenance and lineage contracts.
 *
 * Spec: spec/package-contract.md "Required metadata: provenance" and
 * "Provenance: a package derivative retains: origin, parent, source commit,
 * transformation history, rights state and model provenance where relevant".
 *
 * Rights state itself is carried by the license contract (`license.ts`);
 * this module carries the origin/parent/commit/transformation/model
 * evidence. R19 makes this evidence a release gate (see `release-gate.ts`).
 */

import type { ContentDigest } from './digest.ts'
import { isContentDigest } from './digest.ts'
import type { PackageKind } from './package-id.ts'
import { isPackageKind, parsePackageId } from './package-id.ts'
import type { SemanticVersion } from './semver.ts'
import { isSemanticVersion } from './semver.ts'

/** A Git commit SHA (40 or 64 lowercase hex characters). */
export type GitCommitSha = string

const GIT_COMMIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** Type guard: a well-formed Git commit SHA. */
export function isGitCommitSha(value: unknown): value is GitCommitSha {
  return typeof value === 'string' && GIT_COMMIT_SHA_PATTERN.test(value)
}

/** The exact coordinate of a package: kind, id, version, digest. */
export interface PackageCoordinate {
  readonly kind: PackageKind
  readonly id: string
  readonly version: SemanticVersion
  readonly contentDigest: ContentDigest
}

/** Type guard: a structurally valid package coordinate. */
export function isPackageCoordinate(value: unknown): value is PackageCoordinate {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<PackageCoordinate>
  return (
    isPackageKind(candidate.kind) &&
    parsePackageId(candidate.id ?? '') !== null &&
    isSemanticVersion(candidate.version) &&
    isContentDigest(candidate.contentDigest)
  )
}

/** Parent/origin references retained by derivatives (forks, overlays). */
export interface LineageReferences {
  /** The original package this line derives from; `null` when original. */
  readonly origin: PackageCoordinate | null
  /** The immediate parent in the derivation chain; `null` when original. */
  readonly parent: PackageCoordinate | null
}

/** Where the package content originated. */
export type ProvenanceOrigin =
  | { readonly type: 'original' }
  | { readonly type: 'repository'; readonly url: string }
  | { readonly type: 'package'; readonly coordinate: PackageCoordinate }

/** Kinds of transformations recorded in a provenance trail. */
export type TransformationKind =
  | 'author'
  | 'import'
  | 'derive'
  | 'transform'
  | 'overlay'
  | 'port'

/** One step in the transformation history. */
export interface TransformationStep {
  readonly kind: TransformationKind
  readonly description: string
  readonly tool?: string
}

/** How an AI model participated in producing the package. */
export type ModelUsage = 'generation' | 'assistance' | 'transformation'

/** Model provenance entry — required when content is AI-generated. */
export interface ModelProvenanceEntry {
  readonly model: string
  readonly provider: string
  readonly usage: ModelUsage
  readonly disclosed: boolean
}

/** The provenance record retained by every package. */
export interface ProvenanceRecord {
  readonly origin: ProvenanceOrigin
  readonly sourceCommit: GitCommitSha | null
  readonly transformationHistory: readonly TransformationStep[]
  readonly modelProvenance: readonly ModelProvenanceEntry[]
  readonly generatedByAi: boolean
}

/**
 * Accepts only `http:`/`https:` URLs that carry no embedded credentials
 * (userinfo). Provenance origins must never embed secrets.
 */
export function isHttpUrlWithoutCredentials(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false
  }
  return parsed.username === '' && parsed.password === ''
}

/** Type guard: a structurally valid provenance record. */
export function isProvenanceRecord(value: unknown): value is ProvenanceRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<ProvenanceRecord>
  if (
    typeof candidate.origin !== 'object' ||
    candidate.origin === null ||
    typeof candidate.generatedByAi !== 'boolean' ||
    !Array.isArray(candidate.transformationHistory) ||
    !Array.isArray(candidate.modelProvenance)
  ) {
    return false
  }
  if (candidate.sourceCommit !== null && !isGitCommitSha(candidate.sourceCommit)) {
    return false
  }
  const origin = candidate.origin as Partial<ProvenanceOrigin> & { type?: unknown }
  if (origin.type === 'repository') {
    return typeof origin.url === 'string' && isHttpUrlWithoutCredentials(origin.url)
  }
  return (
    origin.type === 'original' ||
    (origin.type === 'package' && isPackageCoordinate(origin.coordinate))
  )
}
