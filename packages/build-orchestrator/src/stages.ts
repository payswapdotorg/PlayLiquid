/**
 * Stage execution over the Tool Fabric seam (E10 pipeline) and build
 * output assembly. Pure composition over injected ports — no IO, no
 * clock, no globals (E3); every tool step carries a deterministic call id
 * and idempotency key (E9) so interrupted builds resume without
 * re-executing differently.
 *
 * Fail-closed everywhere:
 * - tool failures and malformed tool outputs are TYPED stage failures —
 *   never ignored, never fabricated around;
 * - the console vendor-SDK AUTHORIZATION is required before ANY tool
 *   executes for a vendor-gated target (lock rule 24 — the orchestrator
 *   never fabricates authorization);
 * - final outputs must pass build-contracts' composition validator
 *   (artifacts CAS-addressed, manifest faithful to the pinned inputs,
 *   complete frozen stage sequence, E9 environment fingerprint) and the
 *   vendor evidence gate.
 */

import {
  isBuildArtifactKind,
  isVendorSdkAuthorization,
} from "@playliquid/build-contracts";
import type {
  BuildArtifact,
  BuildArtifactKind,
  BuildId,
  BuildInputs,
  BuildManifest,
  BuildOutputs,
  BuildStepRecord,
  BuildStage,
  ToolOperationId,
  VendorGateRequirement,
  VendorSdkEvidence,
  VerificationEvidence,
} from "@playliquid/build-contracts";
import { computeBuildInputsDigest, computeBuildManifestDigest } from "@playliquid/build-contracts";
import { isContentDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import { computeDigest } from "@playliquid/package-system";
import type { ModelProvenanceEntry, ProvenanceRecord } from "@playliquid/package-system";
import type { BuildPlan } from "./plan.ts";
import { planStepsForStage } from "./plan.ts";
import type { BuildToolOutput, ToolFabricPort, ToolEmittedArtifact } from "./ports.ts";

/** A typed stage failure (terminal for the build; recorded with the transition). */
export interface StageFailure {
  readonly code: string;
  readonly message: string;
}

/** The collected outcome of one tool-driven stage. */
export interface ToolStageOutcome {
  readonly artifacts: readonly BuildArtifact[];
  readonly evidence: readonly VerificationEvidence[];
  readonly stageDigest: ContentDigest;
  /** Which operations actually ran (audit; empty stage is legal). */
  readonly operations: readonly ToolOperationId[];
}

/** The R19 evidence retained from the resolved closure (resolve stage). */
export interface ClosureProvenanceEvidence {
  readonly packageProvenance: readonly ProvenanceRecord[];
  readonly modelProvenance: readonly ModelProvenanceEntry[];
  readonly generatedByAi: boolean;
}

/** Runs every planned step of `stage` through the fabric seam. */
export async function runToolStage(
  fabric: ToolFabricPort,
  buildId: BuildId,
  stage: BuildStage,
  plan: BuildPlan,
  stepInputBase: Record<string, unknown>,
): Promise<ToolStageOutcome | StageFailure> {
  const steps = planStepsForStage(plan, stage);
  const artifacts: BuildArtifact[] = [];
  const evidence: VerificationEvidence[] = [];
  const operations: ToolOperationId[] = [];
  const stepResults: Array<{ operation: ToolOperationId; callId: string; ok: boolean }> = [];
  for (const step of steps) {
    const result = await fabric.invokeBuildTool({
      stage,
      operation: step.operation,
      callId: step.callId,
      idempotencyKey: step.idempotencyKey,
      input: { ...stepInputBase, stage, operation: step.operation, callId: step.callId },
    });
    if (result.outcome === "failed") {
      return {
        code: "tool-step-failed",
        message: `tool operation "${step.operation}" (${step.callId}) failed: ${result.code}: ${result.message}`,
      };
    }
    const parsed = parseToolOutput(result.output);
    if (parsed === null) {
      return {
        code: "tool-output-invalid",
        message: `tool operation "${step.operation}" (${step.callId}) returned an output the build contract rejects (artifacts must be CAS-shaped, evidence records well-formed)`,
      };
    }
    for (const emitted of parsed.artifacts ?? []) {
      artifacts.push({
        artifactKind: emitted.artifactKind as BuildArtifactKind,
        target: plan.target,
        bytes: {
          storage: "cas",
          digest: emitted.digest,
          sizeBytes: emitted.sizeBytes,
          mediaType: emitted.mediaType,
        },
      });
    }
    evidence.push(...(parsed.evidence ?? []));
    operations.push(step.operation);
    stepResults.push({ operation: step.operation, callId: step.callId, ok: true });
  }
  const stageDigest = computeDigest({
    buildId,
    stage,
    steps: stepResults,
    artifacts: artifacts.map((artifact) => artifact.bytes.digest),
    evidence: evidence.map((record) => computeDigest(record)),
  });
  return { artifacts, evidence, stageDigest, operations };
}

/** Validates a tool ok-output against the build-tool output contract. Total. */
export function parseToolOutput(output: unknown): BuildToolOutput | null {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return null;
  }
  const record = output as Record<string, unknown>;
  const artifacts: ToolEmittedArtifact[] = [];
  const evidence: VerificationEvidence[] = [];
  const rawArtifacts = record["artifacts"];
  if (rawArtifacts !== undefined) {
    if (!Array.isArray(rawArtifacts)) {
      return null;
    }
    for (const candidate of rawArtifacts) {
      if (typeof candidate !== "object" || candidate === null) {
        return null;
      }
      const artifact = candidate as Record<string, unknown>;
      if (
        typeof artifact["artifactKind"] !== "string" ||
        !isBuildArtifactKind(artifact["artifactKind"]) ||
        typeof artifact["digest"] !== "string" ||
        !isContentDigest(artifact["digest"]) ||
        typeof artifact["sizeBytes"] !== "number" ||
        !Number.isSafeInteger(artifact["sizeBytes"]) ||
        artifact["sizeBytes"] <= 0 ||
        typeof artifact["mediaType"] !== "string" ||
        artifact["mediaType"].length === 0
      ) {
        return null;
      }
      artifacts.push({
        artifactKind: artifact["artifactKind"],
        digest: artifact["digest"],
        sizeBytes: artifact["sizeBytes"],
        mediaType: artifact["mediaType"],
      });
    }
  }
  const rawEvidence = record["evidence"];
  if (rawEvidence !== undefined) {
    if (!Array.isArray(rawEvidence)) {
      return null;
    }
    for (const candidate of rawEvidence) {
      if (!isVerificationEvidenceRecord(candidate)) {
        return null;
      }
      evidence.push(candidate);
    }
  }
  return { ...(artifacts.length === 0 ? {} : { artifacts }), ...(evidence.length === 0 ? {} : { evidence }) };
}

/** Structural check of one verification evidence record (fail-closed). */
export function isVerificationEvidenceRecord(value: unknown): value is VerificationEvidence {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record["verdict"] !== "pass" && record["verdict"] !== "fail") {
    return false;
  }
  if (record["kind"] === "evaluation-suite") {
    const suite = record["suite"];
    return (
      typeof suite === "object" &&
      suite !== null &&
      typeof (suite as Record<string, unknown>)["suiteId"] === "string" &&
      isContentDigest((suite as Record<string, unknown>)["suiteDigest"]) &&
      isContentDigest(record["evidenceDigest"])
    );
  }
  if (record["kind"] === "vendor-sdk") {
    return isVendorSdkAuthorization(record["authorization"]) && isContentDigest(record["evidenceDigest"]);
  }
  if (record["kind"] === "on-target") {
    return isContentDigest(record["verifiedDigest"]) && isContentDigest(record["evidenceDigest"]);
  }
  return false;
}

/** True iff `evidence` carries a passing, authorized vendor-sdk record for `gate`'s vendor. */
export function hasAuthorizedVendorEvidence(gate: VendorGateRequirement, evidence: readonly VerificationEvidence[]): boolean {
  if (gate.kind !== "authorized-vendor-sdk") {
    return true;
  }
  return evidence.some(
    (record): record is VendorSdkEvidence =>
      record.kind === "vendor-sdk" &&
      record.verdict === "pass" &&
      record.authorization.vendorId === gate.vendorId,
  );
}

/** Assembles the typed build manifest from pinned inputs and recorded steps (E9). */
export function assembleManifest(
  buildId: BuildId,
  inputs: BuildInputs,
  steps: readonly BuildStepRecord[],
): BuildManifest {
  return {
    buildId,
    inputsDigest: computeBuildInputsDigest(inputs),
    inputs: {
      gameIr: inputs.gameIr.digest,
      packageLock: inputs.packageLock.lockFingerprint,
      targetProfile: inputs.targetProfile.profileDigest,
      engineBinding: inputs.engineBinding.bindingDigest,
      toolchain: inputs.toolchain.profileDigest,
    },
    steps,
    environmentFingerprint: inputs.toolchain.profileDigest,
  };
}

/** Assembles the full build outputs record (artifact + manifest + provenance + verification). */
export function assembleOutputs(
  buildId: BuildId,
  inputs: BuildInputs,
  steps: readonly BuildStepRecord[],
  artifacts: readonly BuildArtifact[],
  provenance: ClosureProvenanceEvidence,
  verification: readonly VerificationEvidence[],
): BuildOutputs {
  const manifest = assembleManifest(buildId, inputs, steps);
  return {
    artifacts,
    manifest,
    provenance: {
      buildTransformation: {
        kind: "transform",
        description: `PlayLiquid build orchestration pipeline for target ${inputs.targetProfile.target} (PL-020)`,
        tool: "build-orchestrator",
      },
      packageProvenance: provenance.packageProvenance,
      modelProvenance: provenance.modelProvenance,
      generatedByAi: provenance.generatedByAi,
    },
    verification,
  };
}

/** The digest of a completed step sequence entry (helper for stage records). */
export function stepRecord(stage: BuildStage, stageDigest: ContentDigest): BuildStepRecord {
  return { stage, stageDigest };
}

/**
 * The PACKAGE stage digest is PLAN-derived (digest over the planned steps,
 * not the executed results). This is deliberate and load-bearing: it makes
 * the full manifest — and thereby the manifest digest — computable BEFORE
 * the packaging steps execute, so the console toolchain invoked through
 * the fabric receives the manifest digest in its step input and can return
 * the on-target evidence record that references it (build-contracts'
 * vendor gate requires on-target evidence to verify exactly the manifest
 * digest). The package stage's EXECUTED outcomes remain fully recorded:
 * append-only stage events (E10) and CAS-referenced artifacts (E7).
 */
export function packageStageDigest(plan: BuildPlan): ContentDigest {
  return computeDigest({
    stage: "package",
    steps: planStepsForStage(plan, "package").map((step) => ({
      operation: step.operation,
      callId: step.callId,
    })),
  });
}

/** The digest of a completed build's manifest (the on-target verification subject). */
export function manifestDigestOf(outputs: BuildOutputs): ContentDigest {
  return computeBuildManifestDigest(outputs.manifest);
}

/** Planned-step summary retained in build state (JSON document form of {@link PlannedBuildStep}). */
export interface PlannedStepSummary {
  readonly stage: BuildStage;
  readonly operation: ToolOperationId;
  readonly callId: string;
}
