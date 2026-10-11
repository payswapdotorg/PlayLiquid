/**
 * Deterministic build planning (E9: reproducible seeds/locks).
 *
 * The plan is a PURE function of digest-pinned inputs — no randomness, no
 * clock, no ambient state:
 * - the toolchain profile's cited tool operations are the step material
 *   (order-insensitive: operations are sorted, so two profiles citing the
 *   same SET plan identically, mirroring build-contracts' input-digest
 *   order-insensitivity);
 * - each cited operation is assigned to a build stage by the frozen
 *   {@link OPERATION_STAGE_TABLE} below (data-driven, provider-neutral);
 *   operations without a table entry default to the `emit` stage — the
 *   artifact-producing stage of the pipeline;
 * - `resolve` and `plan` are orchestrator-owned semantic work (registry
 *   closure, planning) and carry no tool steps — Tool Fabric drives
 *   production/verification/packaging, never the kernel's own reasoning;
 * - call ids and idempotency keys are derived deterministically from the
 *   build id, stage and operation, so an interrupted build resumed later
 *   re-issues the SAME calls (E6) and the fabric's ledger replays the
 *   recorded outcomes (E9/E10).
 */

import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { BuildId, BuildStage, BuildTargetId, ToolOperationId } from "@playliquid/build-contracts";
import { BUILD_STAGES } from "@playliquid/build-contracts";
import { targetWorkflowClass } from "@playliquid/target-profiles";
import type { TargetWorkflowClass } from "@playliquid/target-profiles";

/**
 * The frozen operation → stage table. Provider-neutral operation ids only
 * (build-contracts' ToolOperationId seam vocabulary); NO engine names
 * (lock rules 20/21 — engines and DCC tools are adapters, never
 * authorities, and never leak into GameOS contracts).
 */
export const OPERATION_STAGE_TABLE: Readonly<Record<string, BuildStage>> = Object.freeze({
  build: "emit",
  compile: "emit",
  cook: "emit",
  export: "emit",
  bundle: "package",
  package: "package",
  sign: "package",
  test: "verify",
  validate: "verify",
  verify: "verify",
});

/** The stage an operation is assigned to (data-driven; default `emit`). */
export function stageForOperation(operation: ToolOperationId): BuildStage {
  return OPERATION_STAGE_TABLE[operation] ?? "emit";
}

/** One planned tool step. */
export interface PlannedBuildStep {
  readonly stage: BuildStage;
  readonly operation: ToolOperationId;
  /** Deterministic Tool Fabric call id (E9). */
  readonly callId: string;
  /** Deterministic idempotency key (E6): replays never re-execute. */
  readonly idempotencyKey: string;
}

/** The deterministic build plan. */
export interface BuildPlan {
  readonly buildId: BuildId;
  readonly target: BuildTargetId;
  /** The R12 workflow class of the target (target-profiles taxonomy). */
  readonly workflowClass: TargetWorkflowClass;
  /** Planned tool steps, stage order then operation order (frozen stages). */
  readonly steps: readonly PlannedBuildStep[];
  /** Content digest of the plan itself (E9). */
  readonly planDigest: ContentDigest;
}

function toolCallId(buildId: string, stage: BuildStage, operation: ToolOperationId): string {
  return `${buildId}#${stage}#${operation}`;
}

/**
 * Computes the deterministic build plan for one admitted build over the
 * toolchain profile's cited operations. Pure: same build id, target and
 * cited-operation SET ⇒ the same plan digest, always.
 */
export function computeBuildPlan(
  buildId: BuildId,
  target: BuildTargetId,
  citedOperations: readonly ToolOperationId[],
): BuildPlan {
  const sorted = [...new Set(citedOperations)].sort();
  const steps: PlannedBuildStep[] = [];
  for (const stage of BUILD_STAGES) {
    for (const operation of sorted) {
      if (stageForOperation(operation) !== stage) {
        continue;
      }
      const callId = toolCallId(buildId, stage, operation);
      steps.push({ stage, operation, callId, idempotencyKey: callId });
    }
  }
  const workflowClass = targetWorkflowClass(target as never);
  const planDigest = computeDigest({
    buildId,
    target,
    workflowClass,
    steps: steps.map((step) => ({ stage: step.stage, operation: step.operation })),
  });
  return { buildId, target, workflowClass, steps, planDigest };
}

/** The plan steps assigned to one stage, in plan order. */
export function planStepsForStage(plan: BuildPlan, stage: BuildStage): readonly PlannedBuildStep[] {
  return plan.steps.filter((step) => step.stage === stage);
}

/** Every operation the plan needs (for toolchain-availability checks, E11). */
export function planOperations(plan: BuildPlan): readonly ToolOperationId[] {
  return plan.steps.map((step) => step.operation);
}
