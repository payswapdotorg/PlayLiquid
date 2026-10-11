/**
 * THE PHASE-ARC ENGINE (E10) — the orchestration pipeline arcs of the
 * build orchestrator service, extracted from service.ts (max-lines
 * discipline; the house apply.ts precedent). Every arc advances exactly
 * one build by one phase transition plus its stage work, mutates the
 * owning service's state through the {@link ArcHost} seam, and appends
 * the matching events (state mutation and its event(s) append together).
 *
 * Arcs (the frozen phase machine):
 * - resolve: package-closure adjudication against the registry seam with
 *   the R19 provenance/licensing gate (fail-closed, typed reasons);
 * - plan: deterministic seeded planning over digest-pinned inputs (E9)
 *   plus toolchain-availability observation (E11: a missing toolchain is
 *   a truthful limitation, never faked success);
 * - emit / verify: tool steps through the Tool Fabric seam only;
 * - package: the console vendor gate FIRST (build-contracts'
 *   `checkVendorSdkGate` over the PLAN-PREDICTED manifest digest —
 *   knowable before packaging because the package step digest is
 *   plan-derived, E9), then packaging + manifest assembly + composition
 *   validation. A gate whose evidence is still MISSING refuses the arc
 *   RETRYABLY (the build is NOT failed; the refusal names the manifest
 *   digest the vendor pipeline must verify, lock rule 24); evidence that
 *   CONTRADICTS the build (a PASS record verifying a different digest, an
 *   unauthorized vendor, a failing verdict) fails the arc TERMINALLY —
 *   contradictory attestations are never charitably reinterpreted.
 */

import {
  asBuildId,
  checkVendorSdkGate,
  computeBuildManifestDigest,
  validateBuildOutputs,
} from "@playliquid/build-contracts";
import type {
  BuildPhase,
  BuildStage,
  ToolOperationId,
  VerificationEvidence,
} from "@playliquid/build-contracts";
import { adjudicateClosure } from "./closure.ts";
import { closureModelProvenance } from "./closure.ts";
import type { BuildPlan } from "./plan.ts";
import {
  assembleManifest,
  assembleOutputs,
  hasAuthorizedVendorEvidence,
  packageStageDigest,
  runToolStage,
  stepRecord,
} from "./stages.ts";
import type { StageFailure } from "./stages.ts";
import type { BuildEvent, BuildEventType } from "./events.ts";
import type { BuildRecord } from "./document.ts";
import type { BuildSourcePort, ToolFabricPort } from "./ports.ts";
import type { DriveOptions, DriveStepResult } from "./service-types.ts";

/** The drive arc each non-terminal phase performs next. */
const NEXT_STAGE_BY_PHASE: Readonly<Record<Exclude<BuildPhase, "succeeded" | "failed" | "cancelled">, BuildStage>> = Object.freeze({
  queued: "resolve",
  resolve: "plan",
  plan: "emit",
  emit: "verify",
  verify: "package",
  package: "package",
});

/** A phase a non-terminal build is in (the index type of {@link NEXT_STAGE_BY_PHASE}). */
type NonTerminalBuildPhase = Exclude<BuildPhase, "succeeded" | "failed" | "cancelled">;

/**
 * Vendor-gate failure codes that mean "the out-of-band vendor-pipeline
 * activity has not happened yet" — a retryable wait, never a build defect.
 * Every other code is evidence that EXISTS but contradicts this build.
 */
const PENDING_VENDOR_GATE_CODES: ReadonlySet<string> = new Set(["vendor-sdk-evidence-missing", "actual-verification-missing"]);

/**
 * The seam the arc engine needs from its OWNING service instance (the
 * single mutable-state owner). The service constructs one host object in
 * its constructor; the arcs never reach around it.
 */
export interface ArcHost {
  readonly sources: BuildSourcePort;
  readonly fabric: ToolFabricPort;
  emit(tenant: string, buildId: string, type: BuildEventType, phase: BuildPhase, detail?: unknown): BuildEvent;
  mutate(buildId: string, patch: (current: BuildRecord) => Partial<BuildRecord>): void;
  recordOf(buildId: string): BuildRecord;
  planOf(record: BuildRecord): BuildPlan;
  stepInputBase(record: BuildRecord): Record<string, unknown>;
  missingOperations(plan: BuildPlan): readonly ToolOperationId[];
  recordLimitation(record: BuildRecord, code: string, message: string, operation?: string): void;
}

/**
 * Advances one non-terminal build by exactly one phase arc. `record` is
 * the build's pre-arc state as the service read it; every arc re-reads
 * fresh state through the host before mutating (no torn reads).
 */
export async function advanceOneArc(
  host: ArcHost,
  record: BuildRecord,
  options?: DriveOptions,
): Promise<DriveStepResult> {
  const evidence = options?.vendorEvidence;
  if (record.phase === "queued") {
    return resolveArc(host, record);
  }
  if (record.phase === "resolve") {
    return planArc(host, record);
  }
  const stage = NEXT_STAGE_BY_PHASE[record.phase as NonTerminalBuildPhase];
  if (stage === "package") {
    return packageArc(host, record, evidence);
  }
  return toolArc(host, record, stage, evidence);
}

/** resolve arc: transition + package-closure adjudication (R19 gate). */
async function resolveArc(host: ArcHost, record: BuildRecord): Promise<DriveStepResult> {
  host.emit(record.tenant, record.buildId, "phase-transition", "resolve", { from: "queued", to: "resolve" });
  const admission = adjudicateClosure(host.sources, record.request.inputs.packageLock.lockFingerprint);
  if (!admission.ok) {
    return failBuild(host, record, `closure-${admission.code}`, admission.message);
  }
  const closure = admission.closure;
  const modelProvenance = closureModelProvenance(closure);
  host.mutate(record.buildId, (current) => ({
    phase: "resolve",
    steps: [...current.steps, stepRecord("resolve", closure.closureDigest)],
    closureSummary: { closureDigest: closure.closureDigest, packageCount: closure.resolution.packages.length },
    provenance: {
      packageProvenance: closure.resolution.packages.map((entry) => entry.record.metadata.provenance),
      modelProvenance: modelProvenance.entries,
      generatedByAi: modelProvenance.generatedByAi,
    },
  }));
  host.emit(record.tenant, record.buildId, "stage-completed", "resolve", { stage: "resolve", stageDigest: closure.closureDigest });
  return { ok: true, buildId: asBuildId(record.buildId), phase: "resolve", terminal: false };
}

/** plan arc: transition + deterministic plan + toolchain availability (E11). */
async function planArc(host: ArcHost, record: BuildRecord): Promise<DriveStepResult> {
  host.emit(record.tenant, record.buildId, "phase-transition", "plan", { from: "resolve", to: "plan" });
  const plan = host.planOf(record);
  const missing = host.missingOperations(plan);
  if (missing.length > 0) {
    host.recordLimitation(record, "toolchain-unavailable", `toolchain does not provide the cited operation(s): ${missing.join(", ")}`, missing[0]);
    return failBuild(host, record, "toolchain-unavailable", `the pinned toolchain profile cites operation(s) not available through the Tool Fabric: ${missing.join(", ")} (E11 limitation recorded, never simulated)`);
  }
  host.mutate(record.buildId, (current) => ({
    phase: "plan",
    steps: [...current.steps, stepRecord("plan", plan.planDigest)],
  }));
  host.emit(record.tenant, record.buildId, "stage-completed", "plan", { stage: "plan", stageDigest: plan.planDigest });
  return { ok: true, buildId: asBuildId(record.buildId), phase: "plan", terminal: false };
}

/** emit/verify arc: transition + tool steps through the fabric seam. */
async function toolArc(
  host: ArcHost,
  record: BuildRecord,
  stage: BuildStage,
  evidence: readonly VerificationEvidence[] | undefined,
): Promise<DriveStepResult> {
  const from = record.phase;
  host.emit(record.tenant, record.buildId, "phase-transition", stage, { from, to: stage });
  if (evidence !== undefined && evidence.length > 0) {
    host.mutate(record.buildId, (current) => ({ evidence: [...current.evidence, ...evidence] }));
  }
  if (stage === "emit") {
    const gate = record.request.inputs.targetProfile.vendorGate;
    if (gate.kind === "authorized-vendor-sdk") {
      const pool = [...record.evidence, ...(evidence ?? [])];
      if (!hasAuthorizedVendorEvidence(gate, pool)) {
        host.recordLimitation(record, "console-verification-out-of-band", `console-class build requires authorized vendor-SDK evidence (vendor "${gate.vendorId}") supplied out-of-band via drive options before any tool step executes`, undefined);
        return failBuild(host, record, "vendor-evidence-required", `vendor-gated target requires authorized vendor-SDK evidence (vendor "${gate.vendorId}"); authorization is never fabricated (lock rule 24, E11)`);
      }
    }
  }
  const plan = host.planOf(record);
  const missing = host.missingOperations(plan);
  if (missing.length > 0) {
    host.recordLimitation(record, "toolchain-unavailable", `toolchain no longer provides: ${missing.join(", ")}`, missing[0]);
    return failBuild(host, record, "toolchain-unavailable", `cited operation(s) became unavailable through the Tool Fabric: ${missing.join(", ")} (E11)`);
  }
  const outcome = await runToolStage(host.fabric, asBuildId(record.buildId), stage, plan, host.stepInputBase(record));
  if ("code" in outcome) {
    return failBuild(host, record, outcome.code, outcome.message);
  }
  commitToolOutcome(host, record, stage, outcome);
  return { ok: true, buildId: asBuildId(record.buildId), phase: stage, terminal: false };
}

/** package arc: console vendor gate (predicted manifest) + packaging + manifest assembly + output validation + success stamp. */
async function packageArc(
  host: ArcHost,
  record: BuildRecord,
  evidence: readonly VerificationEvidence[] | undefined,
): Promise<DriveStepResult> {
  const plan = host.planOf(record);
  const packageDigest = packageStageDigest(plan);
  // The manifest digest is knowable BEFORE packaging (E9): the executed
  // stage digests are recorded and the package step digest is plan-derived.
  // That is what lets console on-target evidence reference it out-of-band.
  const manifestDigest = computeBuildManifestDigest(
    assembleManifest(asBuildId(record.buildId), record.request.inputs, [
      ...record.steps,
      stepRecord("package", packageDigest),
    ]),
  );
  const gate = record.request.inputs.targetProfile.vendorGate;
  if (gate.kind === "authorized-vendor-sdk") {
    const verdict = checkVendorSdkGate({
      vendorGate: gate,
      manifestDigest,
      evidence: [...record.evidence, ...(evidence ?? [])],
    });
    if (!verdict.pass) {
      const contradictions = verdict.reasons.filter((reason) => !PENDING_VENDOR_GATE_CODES.has(reason.code));
      if (contradictions.length > 0) {
        // Fail-closed: the vendor pipeline DID speak and its record attests
        // something other than this build (wrong digest, wrong vendor or a
        // failing verdict). A contradictory attestation is never generously
        // reinterpreted as "still waiting"; the build dies naming the
        // manifest digest the evidence failed to verify (lock rule 24).
        host.recordLimitation(
          record,
          "console-verification-out-of-band",
          `console vendor gate received contradictory evidence for manifest ${manifestDigest}: ${contradictions.map((reason) => reason.message).join("; ")} — the on-target verification of this exact manifest digest is an out-of-band vendor-pipeline activity (lock rule 24)`,
          undefined,
        );
        return failBuild(
          host,
          record,
          "vendor-evidence-required",
          `console-class build failed the authorized-vendor-SDK evidence gate for manifest ${manifestDigest} (fail-closed): ${contradictions.map((reason) => reason.message).join("; ")}`,
          manifestDigest,
        );
      }
      // Out-of-band wait, NOT a build defect: the on-target verification of
      // this exact manifest digest is a vendor-pipeline activity. The arc
      // refuses retryably (no transition, no tool step, no fabricated ok);
      // the build stays drivable and the refusal names the digest to verify.
      host.recordLimitation(
        record,
        "console-verification-out-of-band",
        `console vendor gate is not yet satisfied for manifest ${manifestDigest}: the authorized vendor-SDK record and the on-target verification of this exact manifest digest are out-of-band vendor-pipeline activities (lock rule 24, E11); re-drive with the evidence`,
        undefined,
      );
      return {
        ok: true,
        buildId: asBuildId(record.buildId),
        phase: record.phase,
        terminal: false,
        failure: {
          code: "vendor-evidence-required",
          message: `console-class build awaits out-of-band vendor evidence for manifest ${manifestDigest}: ${verdict.reasons.map((reason) => reason.message).join("; ")}`,
        },
        manifestDigest,
      };
    }
  }
  host.emit(record.tenant, record.buildId, "phase-transition", "package", { from: record.phase, to: "package" });
  if (evidence !== undefined && evidence.length > 0) {
    host.mutate(record.buildId, (current) => ({ evidence: [...current.evidence, ...evidence] }));
  }
  const missing = host.missingOperations(plan);
  if (missing.length > 0) {
    host.recordLimitation(record, "toolchain-unavailable", `toolchain no longer provides: ${missing.join(", ")}`, missing[0]);
    return failBuild(host, record, "toolchain-unavailable", `cited operation(s) became unavailable through the Tool Fabric: ${missing.join(", ")} (E11)`);
  }
  const outcome = await runToolStage(host.fabric, asBuildId(record.buildId), "package", plan, { ...host.stepInputBase(record), manifestPending: true });
  if ("code" in outcome) {
    return failBuild(host, record, outcome.code, outcome.message);
  }
  host.mutate(record.buildId, (current) => ({
    steps: [...current.steps, stepRecord("package", packageDigest)],
    artifacts: [...current.artifacts, ...outcome.artifacts],
    evidence: [...current.evidence, ...outcome.evidence],
    phase: "package",
  }));
  host.emit(record.tenant, record.buildId, "stage-completed", "package", { stage: "package", stageDigest: packageDigest });
  const current = host.recordOf(record.buildId);
  const outputs = assembleOutputs(
    asBuildId(record.buildId),
    record.request.inputs,
    current.steps,
    current.artifacts,
    current.provenance ?? { packageProvenance: [], modelProvenance: [], generatedByAi: false },
    current.evidence,
  );
  const digest = computeBuildManifestDigest(outputs.manifest);
  const validation = validateBuildOutputs(outputs, record.request.inputs);
  if (!validation.ok) {
    const codes = validation.reasons.map((reason) => reason.code);
    if (codes.includes("vendor-gate-failed")) {
      // Defense-in-depth: the pre-gate above already admitted the evidence,
      // so reaching here means the assembled outputs contradict it.
      host.recordLimitation(record, "console-verification-out-of-band", `console vendor gate failed for manifest digest ${digest}; the on-target verification of this manifest digest is an out-of-band vendor-pipeline activity`, undefined);
      return failBuild(
        host,
        record,
        "vendor-evidence-required",
        `console-class build failed the authorized-vendor-SDK evidence gate for manifest ${digest}: ${validation.reasons.find((reason) => reason.code === "vendor-gate-failed")?.message ?? ""}`.trim(),
        digest,
      );
    }
    return failBuild(host, record, "outputs-invalid", `build outputs failed composition validation: ${codes.join(", ")}`, digest);
  }
  host.mutate(record.buildId, () => ({ phase: "succeeded", outputs }));
  host.emit(record.tenant, record.buildId, "phase-transition", "succeeded", { from: "package", to: "succeeded" });
  host.emit(record.tenant, record.buildId, "build-succeeded", "succeeded", { manifestDigest: digest });
  return { ok: true, buildId: asBuildId(record.buildId), phase: "succeeded", terminal: true, manifestDigest: digest };
}

/** Fails the build terminally: mutation + transition + failure events (one arc, atomic). */
function failBuild(host: ArcHost, record: BuildRecord, code: string, message: string, manifestDigest?: string): DriveStepResult {
  const from = host.recordOf(record.buildId).phase;
  host.mutate(record.buildId, () => ({ phase: "failed", failure: { code, message } }));
  host.emit(record.tenant, record.buildId, "phase-transition", "failed", { from, to: "failed" });
  host.emit(record.tenant, record.buildId, "build-failed", "failed", { code, message });
  return {
    ok: true,
    buildId: asBuildId(record.buildId),
    phase: "failed",
    terminal: true,
    failure: { code, message },
    ...(manifestDigest === undefined ? {} : { manifestDigest }),
  };
}

/** Commits one tool stage outcome: steps/artifacts/evidence + stage event. */
function commitToolOutcome(
  host: ArcHost,
  record: BuildRecord,
  stage: BuildStage,
  outcome: Exclude<Awaited<ReturnType<typeof runToolStage>>, StageFailure>,
): void {
  host.mutate(record.buildId, (current) => ({
    phase: stage,
    steps: [...current.steps, stepRecord(stage, outcome.stageDigest)],
    artifacts: [...current.artifacts, ...outcome.artifacts],
    evidence: [...current.evidence, ...outcome.evidence],
  }));
  host.emit(record.tenant, record.buildId, "stage-completed", stage, { stage, stageDigest: outcome.stageDigest });
}
