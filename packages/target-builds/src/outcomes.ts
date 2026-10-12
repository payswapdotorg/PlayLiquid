/**
 * PER-TARGET OUTCOMES (PL-036) — the result of driving one target's staged
 * build, the typed outcome views the multi-target record aggregates, the
 * DURABLE resume material (E6) and the overall verdict computation.
 *
 * One authority per concern: the staged build itself (phases, steps,
 * artifacts, evidence) belongs to the build-orchestrator document — the
 * result below is a READ of that document, never a re-implementation.
 * The durable outcome carries the orchestrator's content-addressed
 * snapshot so a later run can restore and resume a non-terminal target
 * (E6); the outcome views are the honest, typed projections the
 * multi-target record carries (failure isolation: every target's outcome
 * is recorded, whatever happened to the others).
 */

import type { BuildArtifact, BuildPhase, BuildStage, EngineId, VerificationEvidence } from "@playliquid/build-contracts";
import type { ContentDigest } from "@playliquid/package-system";
import type { StoredBuildSnapshot } from "@playliquid/build-orchestrator";
import type { TargetId } from "@playliquid/target-profiles";

/** One completed stage of a driven target build (orchestrator step record). */
export interface TargetStageDigest {
  readonly stage: BuildStage;
  readonly stageDigest: ContentDigest;
}

/** The materialized result of driving one target's staged build (read from the orchestrator document). */
export type TargetBuildResult =
  | {
      readonly admitted: true;
      readonly phase: BuildPhase;
      readonly buildId: string;
      /** Digest of the target's full build-orchestrator document (snapshot id, E6/E10). */
      readonly documentDigest: ContentDigest;
      /** The build manifest digest, once the package stage produced a manifest. */
      readonly manifestDigest: ContentDigest | null;
      /** CAS-shaped artifact references emitted by the build (E7). */
      readonly artifacts: readonly BuildArtifact[];
      /** The orchestrator's completed stage records (R19 provenance material). */
      readonly stageDigests: readonly TargetStageDigest[];
      /** Gate results recorded by the build (verification evidence). */
      readonly evidence: readonly VerificationEvidence[];
      readonly failure: { readonly code: string; readonly message: string } | null;
      /** True iff the build stalled on out-of-band vendor evidence (retryable, E11). */
      readonly awaitingEvidence: boolean;
    }
  | {
      readonly admitted: false;
      /** The build-orchestrator's typed intake refusal (E1). */
      readonly intakeRefusal: { readonly code: string; readonly message: string };
    };

/** The typed per-target outcome views the multi-target record carries. */
export type TargetOutcome =
  | {
      readonly outcome: "succeeded";
      readonly target: TargetId;
      readonly engineId: EngineId;
      readonly buildId: string;
      readonly documentDigest: ContentDigest;
      readonly manifestDigest: ContentDigest;
      readonly artifacts: readonly BuildArtifact[];
    }
  | {
      readonly outcome: "failed";
      readonly target: TargetId;
      readonly engineId: EngineId;
      readonly buildId: string | null;
      readonly documentDigest: ContentDigest | null;
      readonly failure: { readonly code: string; readonly message: string };
    }
  | {
      readonly outcome: "awaiting-evidence";
      readonly target: TargetId;
      readonly engineId: EngineId;
      readonly buildId: string;
      readonly documentDigest: ContentDigest;
      /** The manifest digest the out-of-band vendor pipeline must verify (lock rule 24). */
      readonly manifestDigest: ContentDigest | null;
    }
  | {
      readonly outcome: "skipped";
      readonly target: TargetId;
      readonly engineId: EngineId;
      readonly buildId: string;
      readonly documentDigest: ContentDigest;
      readonly manifestDigest: ContentDigest;
      readonly artifacts: readonly BuildArtifact[];
      /** The run that originally completed this target (E6 resume trace). */
      readonly resumedFromRecordId: string;
    };

/** Projects a driven result into its typed outcome view. */
export function outcomeOfResult(target: TargetId, engineId: EngineId, result: TargetBuildResult): TargetOutcome {
  if (!result.admitted) {
    return {
      outcome: "failed",
      target,
      engineId,
      buildId: null,
      documentDigest: null,
      failure: { code: `intake-${result.intakeRefusal.code}`, message: result.intakeRefusal.message },
    };
  }
  if (result.awaitingEvidence) {
    return {
      outcome: "awaiting-evidence",
      target,
      engineId,
      buildId: result.buildId,
      documentDigest: result.documentDigest,
      manifestDigest: result.manifestDigest,
    };
  }
  if (result.phase === "succeeded") {
    return {
      outcome: "succeeded",
      target,
      engineId,
      buildId: result.buildId,
      documentDigest: result.documentDigest,
      manifestDigest: result.manifestDigest ?? "",
      artifacts: result.artifacts,
    };
  }
  return {
    outcome: "failed",
    target,
    engineId,
    buildId: result.buildId,
    documentDigest: result.documentDigest,
    failure: result.failure ?? { code: `phase-${result.phase}`, message: `target build ended in phase "${result.phase}"` },
  };
}

/** The durable, resumable per-target state (E6): the driven result + the content-addressed orchestrator document. */
export interface DurableTargetOutcome {
  readonly kind: "durable-target-outcome";
  /** The plan-scoped resume key (`${planId}|${target}`). */
  readonly planKey: string;
  /** The host store key the target's build-orchestrator event store lives under. */
  readonly storeKey: string;
  /** The multi-target record id whose run produced this outcome (E6 trace). */
  readonly originRecordId: string;
  readonly target: TargetId;
  readonly engineId: EngineId;
  readonly result: TargetBuildResult;
  /** The content-addressed build-orchestrator document (resume material, E6). */
  readonly snapshot: StoredBuildSnapshot | null;
  readonly recordedAt: number;
}

/** The overall verdict of one multi-target build record. */
export type MultiTargetVerdict = "succeeded" | "partial" | "failed" | "refused";

/** True iff an outcome view satisfies its target (succeeded now or in the resumed past). */
function isSatisfied(outcome: TargetOutcome): boolean {
  return outcome.outcome === "succeeded" || outcome.outcome === "skipped";
}

/**
 * Computes the overall verdict. Total and honest:
 * - `refused`  — nothing was bound (all targets refused at resolution; the
 *   record carries every typed rejection);
 * - `succeeded`— every bound target is satisfied and nothing was refused;
 * - `failed`   — bound targets exist but every one of them failed hard;
 * - `partial`  — everything else: a mix of satisfied/awaiting/failed
 *   outcomes, or satisfied outcomes alongside refusals (isolation: the
 *   satisfied targets are NOT voided; an awaiting target is a retryable
 *   out-of-band wait, never a hard failure — lock rule 24).
 */
export function computeVerdict(outcomes: readonly TargetOutcome[], refusalCount: number): MultiTargetVerdict {
  if (outcomes.length === 0) {
    return "refused";
  }
  const satisfied = outcomes.filter(isSatisfied).length;
  if (satisfied === outcomes.length && refusalCount === 0) {
    return "succeeded";
  }
  const awaiting = outcomes.filter((outcome) => outcome.outcome === "awaiting-evidence").length;
  if (satisfied === 0 && awaiting === 0) {
    return "failed";
  }
  return "partial";
}

/**
 * The typed SKIP outcome view over one prior succeeded durable outcome (E6
 * resume-skip): the target already completed under the same content key, so
 * this run carries its recorded truth (build id, document/manifest digests,
 * artifacts) and names the run that originally completed it.
 */
export function skipOutcomeOf(prior: DurableTargetOutcome): TargetOutcome {
  const result = prior.result;
  if (!result.admitted) {
    return {
      outcome: "failed",
      target: prior.target,
      engineId: prior.engineId,
      buildId: null,
      documentDigest: null,
      failure: { code: "intake-skip-invariant", message: "skip candidate was never admitted (internal invariant)" },
    };
  }
  return {
    outcome: "skipped",
    target: prior.target,
    engineId: prior.engineId,
    buildId: result.buildId,
    documentDigest: result.documentDigest,
    manifestDigest: result.manifestDigest ?? "",
    artifacts: result.artifacts,
    resumedFromRecordId: prior.originRecordId,
  };
}
