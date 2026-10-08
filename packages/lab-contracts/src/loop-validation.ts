/**
 * Lab-loop linkage validation (R16/R17 negative surface).
 *
 * `validateLabCycle` checks a {@link LabCycleRecord} against the
 * evidence/observation ledgers (and optionally the searched organization
 * descriptors): every typed link resolves, the stage order is canonical,
 * observed outcomes belong to the cycle's releases, calibration cites
 * existing immutable observations, and the search's mandatory baseline is
 * among the candidates. Pure: never throws, never mutates. Split from
 * loop.ts to keep both modules inside the house file-size budget.
 */

import { isGitRef } from "@playliquid/game-contracts";
import type { ProjectEvidenceLedger, ObservationLedger } from "./evidence.ts";
import type { OrganizationDescriptor } from "./organization.ts";
import type { DiagnosisId, HypothesisId, ImplementationCandidateId, ReleaseId } from "./primitives.ts";
import { asCalibrationId, asCandidateEvaluationId, asDiagnosisId, asHypothesisId, asImplementationCandidateId, asLabCycleId, asOrganizationId, asReleaseId, isValidContentDigest } from "./primitives.ts";
import type { LabCycleRecord, LabLoopStageKind, LabLoopStageRecord } from "./loop.ts";
import { canTransitionLoopStage } from "./loop.ts";

/** The cross-store state needed to validate a cycle's typed links. */
export interface LabCycleValidationStores {
  readonly evidence: ProjectEvidenceLedger;
  readonly observations: ObservationLedger;
  readonly organizations?: readonly OrganizationDescriptor[];
}

/** Typed violation of {@link validateLabCycle}. */
export type LabCycleViolationCode =
  | "invalid-cycle-id"
  | "stage-cycle-id-mismatch"
  | "empty-cycle"
  | "stage-order-violation"
  | "duplicate-stage-kind"
  | "first-stage-violation"
  | "unknown-evidence-reference"
  | "unknown-diagnosis-reference"
  | "unknown-hypothesis-reference"
  | "unknown-organization-reference"
  | "baseline-not-among-candidates"
  | "unknown-evaluation-reference"
  | "unknown-candidate-reference"
  | "unknown-release-reference"
  | "unknown-observation-reference"
  | "observation-release-mismatch"
  | "unknown-calibration-reference"
  | "calibration-observation-mismatch"
  | "empty-stage-collection";

/** One typed violation. */
export interface LabCycleViolation {
  readonly code: LabCycleViolationCode;
  readonly detail: string;
}

/** Result of {@link validateLabCycle}. */
export type LabCycleValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly LabCycleViolation[] };

/**
 * Pure linkage validation for a {@link LabCycleRecord} against the
 * evidence/observation ledgers (and optionally the searched organization
 * descriptors): every typed link resolves, the stage order is canonical,
 * observed outcomes belong to the cycle's releases, calibration cites
 * existing immutable observations, and the search's mandatory baseline is
 * among the candidates.
 */
export function validateLabCycle(cycle: LabCycleRecord, stores: LabCycleValidationStores): LabCycleValidationResult {
  const violations: LabCycleViolation[] = [];
  if (asLabCycleId(cycle.cycleId) === undefined) {
    violations.push({ code: "invalid-cycle-id", detail: "cycle id failed validation" });
  }
  if (cycle.stages.length === 0) {
    violations.push({ code: "empty-cycle", detail: "a cycle without stages has no links to check" });
    return { ok: false, violations: Object.freeze(violations) };
  }
  const byKind = new Map<LabLoopStageKind, LabLoopStageRecord>();
  for (let index = 0; index < cycle.stages.length; index += 1) {
    const stage = cycle.stages[index];
    if (stage === undefined) continue;
    if (stage.cycleId !== cycle.cycleId) {
      violations.push({ code: "stage-cycle-id-mismatch", detail: `stage ${stage.stage} belongs to another cycle` });
    }
    if (byKind.has(stage.stage)) {
      violations.push({ code: "duplicate-stage-kind", detail: `stage ${stage.stage} appears twice` });
    }
    byKind.set(stage.stage, stage);
    const previous = index === 0 ? undefined : cycle.stages[index - 1];
    const legal =
      index === 0
        ? stage.stage === "project-evidence"
        : previous !== undefined && canTransitionLoopStage(previous.stage, stage.stage);
    if (!legal) {
      violations.push({ code: index === 0 ? "first-stage-violation" : "stage-order-violation", detail: `stage ${stage.stage} is out of canonical order at position ${index}` });
    }
  }
  const evidenceIds = new Set(stores.evidence.records.map((record) => record.evidenceId));
  const diagnosisIds = new Set<DiagnosisId>();
  const hypothesisIds = new Set<HypothesisId>();
  const candidateIds = new Set<ImplementationCandidateId>();
  const releaseIds = new Set<ReleaseId>();
  const organizationIds = new Set((stores.organizations ?? []).map((descriptor) => descriptor.id));

  for (const stage of cycle.stages) {
    switch (stage.stage) {
      case "project-evidence": {
        if (stage.collected.length === 0) violations.push({ code: "empty-stage-collection", detail: "project-evidence stage collected nothing" });
        for (const id of stage.collected) {
          if (!evidenceIds.has(id)) violations.push({ code: "unknown-evidence-reference", detail: `evidence ${id} is not in the ledger` });
        }
        break;
      }
      case "diagnosis": {
        if (asDiagnosisId(stage.diagnosisId) === undefined) violations.push({ code: "unknown-diagnosis-reference", detail: "malformed diagnosis id" });
        else diagnosisIds.add(stage.diagnosisId);
        if (stage.findings.length === 0) violations.push({ code: "empty-stage-collection", detail: "diagnosis has no findings" });
        for (const id of stage.fromEvidence) {
          if (!evidenceIds.has(id)) violations.push({ code: "unknown-evidence-reference", detail: `diagnosis cites unknown evidence ${id}` });
        }
        break;
      }
      case "hypothesis": {
        if (asHypothesisId(stage.hypothesisId) === undefined || stage.statement.length === 0) {
          violations.push({ code: "unknown-hypothesis-reference", detail: "malformed hypothesis" });
        } else hypothesisIds.add(stage.hypothesisId);
        if (!diagnosisIds.has(stage.diagnosis)) violations.push({ code: "unknown-diagnosis-reference", detail: `hypothesis cites unknown diagnosis ${stage.diagnosis}` });
        break;
      }
      case "organization-search": {
        if (!hypothesisIds.has(stage.hypothesis)) violations.push({ code: "unknown-hypothesis-reference", detail: `search cites unknown hypothesis ${stage.hypothesis}` });
        if (asOrganizationId(stage.baseline) === undefined) violations.push({ code: "unknown-organization-reference", detail: "search baseline is malformed" });
        if (!stage.candidates.includes(stage.baseline)) violations.push({ code: "baseline-not-among-candidates", detail: "the generalist baseline must be among the candidates (lock 26)" });
        for (const id of [stage.baseline, ...stage.candidates]) {
          if (organizationIds.size > 0 && !organizationIds.has(id)) violations.push({ code: "unknown-organization-reference", detail: `search references undescribed organization ${id}` });
        }
        break;
      }
      case "simulation-evaluation": {
        if (asCandidateEvaluationId(stage.evaluation) === undefined) violations.push({ code: "unknown-evaluation-reference", detail: "malformed evaluation reference" });
        break;
      }
      case "implementation-candidate": {
        if (asImplementationCandidateId(stage.candidateId) === undefined) violations.push({ code: "unknown-candidate-reference", detail: "malformed candidate id" });
        else candidateIds.add(stage.candidateId);
        if (asCandidateEvaluationId(stage.evaluation) === undefined) violations.push({ code: "unknown-evaluation-reference", detail: "candidate cites malformed evaluation" });
        if (asOrganizationId(stage.organization) === undefined || (organizationIds.size > 0 && !organizationIds.has(stage.organization))) {
          violations.push({ code: "unknown-organization-reference", detail: `candidate organization ${stage.organization} is not among the searched organizations` });
        }
        if (!isValidContentDigest(stage.contentDigest)) violations.push({ code: "unknown-candidate-reference", detail: "candidate content digest is malformed" });
        break;
      }
      case "pr": {
        if (!candidateIds.has(stage.candidate)) violations.push({ code: "unknown-candidate-reference", detail: `PR cites unknown candidate ${stage.candidate}` });
        if (!isGitRef(stage.pr)) violations.push({ code: "unknown-candidate-reference", detail: "PR ref is malformed" });
        break;
      }
      case "release": {
        if (asReleaseId(stage.releaseId) === undefined) violations.push({ code: "unknown-release-reference", detail: "malformed release id" });
        else releaseIds.add(stage.releaseId);
        if (!candidateIds.has(stage.candidate)) violations.push({ code: "unknown-candidate-reference", detail: `release cites unknown candidate ${stage.candidate}` });
        if (!isGitRef(stage.released)) violations.push({ code: "unknown-release-reference", detail: "released ref is malformed" });
        break;
      }
      case "observed-outcome": {
        const observation = stores.observations.observations.find((record) => record.observationId === stage.observation);
        if (observation === undefined) {
          violations.push({ code: "unknown-observation-reference", detail: `observation ${stage.observation} is not in the ledger` });
        }
        if (!releaseIds.has(stage.release)) violations.push({ code: "unknown-release-reference", detail: `observed outcome cites unknown release ${stage.release}` });
        if (observation !== undefined && observation.release !== stage.release) {
          violations.push({ code: "observation-release-mismatch", detail: "observation does not belong to the cited release" });
        }
        if (observation !== undefined && observation.cycleId !== cycle.cycleId) {
          violations.push({ code: "unknown-observation-reference", detail: "observation belongs to another cycle" });
        }
        break;
      }
      case "calibration": {
        if (asCalibrationId(stage.calibration) === undefined) violations.push({ code: "unknown-calibration-reference", detail: "malformed calibration id" });
        const conclusion = stores.observations.conclusions.find((record) => record.calibrationId === stage.calibration);
        if (conclusion === undefined) {
          violations.push({ code: "unknown-calibration-reference", detail: `calibration ${stage.calibration} is not appended to the ledger` });
        }
        if (stage.observations.length === 0) violations.push({ code: "empty-stage-collection", detail: "calibration cites no observations" });
        for (const id of stage.observations) {
          if (!stores.observations.observations.some((record) => record.observationId === id)) {
            violations.push({ code: "unknown-observation-reference", detail: `calibration cites unknown observation ${id}` });
          }
        }
        if (conclusion !== undefined && conclusion.cycleId !== cycle.cycleId) {
          violations.push({ code: "calibration-observation-mismatch", detail: "calibration conclusion belongs to another cycle" });
        }
        break;
      }
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations: Object.freeze(violations) };
}
