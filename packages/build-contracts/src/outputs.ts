/**
 * Build outputs — the typed record layer for spec/architecture.md "Build":
 *
 *   Outputs: artifact + build manifest + provenance evidence +
 *   verification evidence.
 *
 * - Artifacts are content-addressed through package-system's CAS
 *   vocabulary (`CasArtifactRef`) — build contracts NEVER re-implement
 *   hashing or artifact math (E7: the CAS/digest authority is
 *   package-system). Build artifacts are ALWAYS CAS-referenced; inline
 *   payloads are refused (large binaries never live in Git history).
 * - The build manifest is typed: per-input digests, the steps performed
 *   and the environment fingerprint (E9: the pinned toolchain/environment
 *   profile IS the environment — reproducible builds require a
 *   content-addressed environment).
 * - Provenance evidence rides package-system's provenance vocabulary
 *   (R19); verification evidence is typed verdict records (see
 *   verification.ts — console gates fail closed).
 */

import { computeDigest, isContentDigest } from "@playliquid/package-system";
import type {
  CasArtifactRef,
  ContentDigest,
  ModelProvenanceEntry,
  ProvenanceRecord,
  TransformationStep,
} from "@playliquid/package-system";
import type { BuildArtifactKind, BuildId, BuildTargetId } from "./primitives.ts";
import { isBuildArtifactKind, isNonEmptyIdText } from "./primitives.ts";
import type { BuildStage } from "./stages.ts";
import type { VerificationEvidence } from "./verification.ts";

/** One emitted build artifact: a namespaced kind, its target, and its CAS bytes. */
export interface BuildArtifact {
  /** Namespaced, dotted kind, e.g. `game.bundle`, `assets.pack`. */
  readonly artifactKind: BuildArtifactKind;
  /** The target this artifact was emitted for. */
  readonly target: BuildTargetId;
  /** CAS pointer to the artifact bytes (package-system vocabulary, E7). */
  readonly bytes: CasArtifactRef;
}

/** One step performed by the build, in the frozen stage vocabulary. */
export interface BuildStepRecord {
  readonly stage: BuildStage;
  /** Digest of the stage's own plan/output record (opaque, executor-defined). */
  readonly stageDigest: ContentDigest;
}

/** The per-input digest summary a manifest records. */
export interface BuildInputsDigestSummary {
  readonly gameIr: ContentDigest;
  readonly packageLock: ContentDigest;
  readonly targetProfile: ContentDigest;
  readonly engineBinding: ContentDigest;
  readonly toolchain: ContentDigest;
}

/** The typed build manifest. */
export interface BuildManifest {
  readonly buildId: BuildId;
  /** Digest over the full input set (see `computeBuildInputsDigest`). */
  readonly inputsDigest: ContentDigest;
  readonly inputs: BuildInputsDigestSummary;
  /** The steps performed, in the frozen stage order. */
  readonly steps: readonly BuildStepRecord[];
  /**
   * The environment fingerprint: MUST be the digest of the pinned
   * toolchain/environment profile (E9 — the build environment is
   * content-addressed, never ambient).
   */
  readonly environmentFingerprint: ContentDigest;
}

/** Build provenance evidence (R19; package-system vocabulary, reused verbatim). */
export interface BuildProvenanceEvidence {
  /** The build's own transformation step. Kind must be `transform`. */
  readonly buildTransformation: TransformationStep;
  /** Provenance retained from every locked input package. */
  readonly packageProvenance: readonly ProvenanceRecord[];
  /** Model provenance when AI participated in producing the composition. */
  readonly modelProvenance: readonly ModelProvenanceEntry[];
  readonly generatedByAi: boolean;
}

/** Everything one successful build produces. */
export interface BuildOutputs {
  readonly artifacts: readonly BuildArtifact[];
  readonly manifest: BuildManifest;
  readonly provenance: BuildProvenanceEvidence;
  readonly verification: readonly VerificationEvidence[];
}

/** Type guard: a structurally valid build artifact record. */
export function isBuildArtifact(value: unknown): value is BuildArtifact {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<BuildArtifact> & { bytes?: { storage?: unknown } };
  return (
    typeof candidate.artifactKind === "string" &&
    isBuildArtifactKind(candidate.artifactKind) &&
    isNonEmptyIdText(candidate.target) &&
    typeof candidate.target === "string" &&
    typeof candidate.bytes === "object" &&
    candidate.bytes !== null &&
    candidate.bytes.storage === "cas" &&
    isContentDigest((candidate.bytes as CasArtifactRef).digest)
  );
}

/**
 * The content digest of a build manifest (E9). Deterministic by
 * construction: fixed keys via package-system's canonical JSON. This is
 * the digest console on-target evidence must verify (see
 * `checkVendorSdkGate`) — it pins the inputs, the steps and the
 * environment, and thereby every artifact the build emitted.
 */
export function computeBuildManifestDigest(manifest: BuildManifest): ContentDigest {
  return computeDigest({
    buildId: manifest.buildId,
    inputsDigest: manifest.inputsDigest,
    inputs: manifest.inputs,
    steps: manifest.steps.map((step) => ({ stage: step.stage, stageDigest: step.stageDigest })),
    environmentFingerprint: manifest.environmentFingerprint,
  });
}
