/**
 * PROVENANCE + VERIFICATION EVIDENCE AGGREGATION (PL-036, R19).
 *
 * spec/architecture.md §Build: outputs are "artifact + build manifest +
 * provenance evidence + verification evidence". Per-target staged builds
 * already assemble those (PL-020); this module aggregates them into the
 * MULTI-TARGET record's evidence shape, content-addressed through
 * package-system's digest authority:
 *
 * - provenance evidence per target: the SOURCE PINS the build was derived
 *   from (GameIR digest, package-lock fingerprint, target-profile digest,
 *   toolchain digest), the ADAPTER IDENTITY that served the target
 *   (engine family id + the digest-pinned engine binding) and the
 *   ORCHESTRATOR STAGE DIGESTS of the driven build — with a content digest
 *   over the canonical form (E9/E7);
 * - verification evidence per target: the gate results the build recorded
 *   (the orchestrator's evidence pool — evaluation-suite, vendor-SDK and
 *   on-target records) plus the terminal failure when one exists, with a
 *   content digest. Counterfeit-free by construction: every field is read
 *   from the build-orchestrator's own document, never asserted here.
 *
 * Pure module: no IO, no throws.
 */

import type { ContentDigest } from "@playliquid/package-system";
import { computeDigest } from "@playliquid/package-system";
import type { VerificationEvidence } from "@playliquid/build-contracts";
import type { EngineId } from "@playliquid/build-contracts";
import type { TargetId } from "@playliquid/target-profiles";
import type { TargetBuildResult, TargetStageDigest } from "./outcomes.ts";
import type { MultiTargetPins } from "./request.ts";

/** The source pins one target's build was derived from (R19 provenance material). */
export interface TargetSourcePins {
  readonly gameIr: ContentDigest;
  readonly packageLock: ContentDigest;
  readonly targetProfile: ContentDigest;
  readonly toolchain: ContentDigest;
}

/**
 * The source pins one target's provenance cites: the request's shared pins
 * (GameIR digest, package-lock fingerprint, toolchain profile digest) plus
 * the target's own sealed profile digest.
 */
export function sourcePinsOf(pins: MultiTargetPins, profileDigest: ContentDigest): TargetSourcePins {
  return {
    gameIr: pins.gameIr,
    packageLock: pins.packageLock.lockFingerprint,
    targetProfile: profileDigest,
    toolchain: pins.toolchain.profileDigest,
  };
}

/** The R19 provenance evidence of one target (source pins + adapter identity + stage digests). */
export interface TargetProvenanceEvidence {
  readonly target: TargetId;
  readonly engineId: EngineId;
  /** The bound adapter's digest-pinned engine binding (adapter identity). */
  readonly bindingDigest: ContentDigest;
  readonly sourcePins: TargetSourcePins;
  /** The staged build's completed stage records (orchestrator step digests). */
  readonly stageDigests: readonly TargetStageDigest[];
  /** Content digest of this provenance record (canonical form, E9/E7). */
  readonly provenanceDigest: ContentDigest;
}

/** The R19/lock-24 verification evidence of one target (gate results recorded by the build). */
export interface TargetVerificationEvidence {
  readonly target: TargetId;
  readonly verdict: "pass" | "fail" | "awaiting";
  /** Gate results the build recorded (evaluation-suite, vendor-SDK, on-target). */
  readonly gateResults: readonly VerificationEvidence[];
  /** The terminal failure, when the target build failed. */
  readonly failure: { readonly code: string; readonly message: string } | null;
  /** Content digest of this verification record (canonical form, E9/E7). */
  readonly verificationDigest: ContentDigest;
}

/** Aggregates one target's provenance evidence (content-addressed, R19). */
export function aggregateProvenance(
  target: TargetId,
  engineId: EngineId,
  bindingDigest: ContentDigest,
  sourcePins: TargetSourcePins,
  result: TargetBuildResult,
): TargetProvenanceEvidence {
  const stageDigests = result.admitted ? result.stageDigests : [];
  const provenanceDigest = computeDigest({
    target,
    engineId,
    bindingDigest,
    sourcePins,
    stageDigests: stageDigests.map((entry) => ({ stage: entry.stage, stageDigest: entry.stageDigest })),
  });
  return { target, engineId, bindingDigest, sourcePins, stageDigests, provenanceDigest };
}

/** Aggregates one target's verification evidence (content-addressed, R19/lock 24). */
export function aggregateVerification(target: TargetId, result: TargetBuildResult): TargetVerificationEvidence {
  if (!result.admitted) {
    const failure = { code: `intake-${result.intakeRefusal.code}`, message: result.intakeRefusal.message };
    return {
      target,
      verdict: "fail",
      gateResults: [],
      failure,
      verificationDigest: computeDigest({ target, verdict: "fail", gateResults: [], failure }),
    };
  }
  const verdict = result.awaitingEvidence ? "awaiting" : result.phase === "succeeded" ? "pass" : "fail";
  const failure = result.failure;
  const verificationDigest = computeDigest({
    target,
    verdict,
    gateResults: result.evidence,
    failure,
  });
  return { target, verdict, gateResults: result.evidence, failure, verificationDigest };
}

/** The content digest of a list of per-target evidence records (aggregation digest). */
export function evidenceListDigest(digests: readonly string[]): ContentDigest {
  return computeDigest({ digests: [...digests].sort() });
}
