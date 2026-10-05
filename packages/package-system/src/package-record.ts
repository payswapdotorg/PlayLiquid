/**
 * The package record: identity + metadata for one immutable, versioned,
 * addressable package.
 *
 * Spec: spec/package-contract.md — "A package is an immutable, versioned,
 * addressable composition unit" with the required identity (kind, id, semver,
 * content digest) and required metadata (dependencies, capabilities
 * provided/required, permissions, provenance, license/rights state,
 * supported runtimes/engines/targets, resource requirements, evaluation
 * suites, parent/lineage references).
 *
 * Composition (typed extension points and overlay declarations) and the
 * content-addressed artifact list (E7) also live in metadata.
 */

import type { PackageArtifact } from './cas.ts'
import type {
  CapabilityDeclaration,
  CapabilityReference,
  PermissionRequest,
} from './capability.ts'
import type { EvaluationSuiteRef, SemanticPath, TargetProfileRef } from './game-ir-seam.ts'
import type { LicenseState } from './license.ts'
import type { PackageKind, PackageId } from './package-id.ts'
import type {
  LineageReferences,
  PackageCoordinate,
  ProvenanceRecord,
} from './provenance.ts'
import type { ContentDigest } from './digest.ts'
import type { SemverRange, SemanticVersion } from './semver.ts'

/** Required identity of a package. */
export interface PackageIdentity {
  readonly kind: PackageKind
  readonly id: PackageId
  readonly version: SemanticVersion
  readonly contentDigest: ContentDigest
}

/** A dependency on another package. */
export interface PackageDependency {
  readonly id: PackageId
  /** Constraint in the v1 grammar: `*`, `x.y.z`, `^x.y.z`, `~x.y.z`. */
  readonly constraint: SemverRange
  /** Expected kind of the dependency, when constrained. */
  readonly kind: PackageKind | null
  /** Optional dependencies may be absent from the lock without error. */
  readonly optional: boolean
}

/** Runtime, engine and target compatibility declarations. */
export interface RuntimeCompatibility {
  /** e.g. `interactive`, `simulation`. */
  readonly runtimes: readonly string[]
  /** e.g. `native`, `playcanvas`, `unreal`. Adapters, never authorities. */
  readonly engines: readonly string[]
  /** GameIR target profiles, e.g. Spark. */
  readonly targets: readonly TargetProfileRef[]
}

/** Resource requirements of the package. */
export interface ResourceRequirements {
  readonly minMemoryBytes?: number
  readonly minStorageBytes?: number
  readonly minCpuCores?: number
  readonly gpuRequired?: boolean
  readonly networkRequired?: boolean
}

/** A typed extension point exposed by a package. */
export interface ExtensionPointDeclaration {
  readonly pointId: string
  readonly version: SemanticVersion
  /** Digest of the canonical value schema accepted at this point. */
  readonly valueSchemaDigest: ContentDigest
}

/** One overlay override: a GameIR semantic path and a content-addressed value. */
export interface SemanticOverride {
  readonly path: SemanticPath
  readonly valueDigest: ContentDigest
}

/** Overlay declaration: narrow overrides of one exact base package. */
export interface OverlayDeclaration {
  readonly target: PackageCoordinate
  readonly overrides: readonly SemanticOverride[]
}

/** Required metadata of a package. */
export interface PackageMetadata {
  readonly dependencies: readonly PackageDependency[]
  readonly providedCapabilities: readonly CapabilityDeclaration[]
  readonly requiredCapabilities: readonly CapabilityReference[]
  readonly permissions: readonly PermissionRequest[]
  readonly license: LicenseState
  readonly provenance: ProvenanceRecord
  readonly lineage: LineageReferences
  readonly compatibility: RuntimeCompatibility
  readonly resources: ResourceRequirements
  readonly evaluationSuites: readonly EvaluationSuiteRef[]
  readonly artifacts: readonly PackageArtifact[]
  readonly extensionPoints: readonly ExtensionPointDeclaration[]
  readonly overlay: OverlayDeclaration | null
}

/** A sealed package record: identity including its content digest. */
export interface PackageRecord {
  readonly identity: PackageIdentity
  readonly metadata: PackageMetadata
}

/** A package record before its content digest has been computed. */
export interface UnsealedPackageRecord {
  readonly identity: Omit<PackageIdentity, 'contentDigest'>
  readonly metadata: PackageMetadata
}
