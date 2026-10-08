/**
 * THE LAB LOOP (spec/architecture.md, "Lab loop"; R16/R17).
 *
 * Project evidence → diagnosis → hypothesis → organization search →
 * simulation/evaluation → implementation candidate → PR → release →
 * observed outcome → calibration → next search.
 *
 * Each stage is a typed record with TYPED LINKS to its predecessors
 * (branded ids into the evidence ledger, the observation ledger and the
 * candidate-evaluation records). The stage sequence is governed by a
 * frozen transition table (the house state-machine pattern, E1: single
 * owner, here). The cycle-closing edge `calibration → organization-search`
 * is the loop edge: it denotes the NEXT iteration — the next cycle's
 * search is informed by the previous cycle's calibration, and every cycle
 * begins by collecting fresh project evidence (R17: the Lab learns from
 * real project evidence over time). Within a single cycle each stage kind
 * appears at most once, so the loop edge is realized across cycles, never
 * by repeating a stage inside one (enforced by duplicate-stage-kind).
 * `previousCycle` records the lineage.
 *
 * E10/E11 recap enforced here: the observed-outcome stage links an
 * immutable observation; the simulation-evaluation stage links a
 * candidate-evaluation record whose result is an explicitly-labeled
 * estimate; the calibration stage links conclusions derived from immutable
 * observations. Estimates and observations meet only at calibration,
 * where they are compared — never confused.
 *
 * Pure module: no IO, no clocks (caller-supplied time), no search
 * algorithms (PL-029), no simulation (PL-028).
 */

import type { GameIdentity, GitRef } from "@playliquid/game-contracts";
import { isGitRef } from "@playliquid/game-contracts";
import type {
  CandidateEvaluationId,
  CalibrationId,
  DiagnosisId,
  EvidenceRecordId,
  HypothesisId,
  ImplementationCandidateId,
  LabCycleId,
  ContentDigest,
  ObservationId,
  OrganizationId,
  ReleaseId,
} from "./primitives.ts";
import {
  asCalibrationId,
  asCandidateEvaluationId,
  asDiagnosisId,
  asHypothesisId,
  asImplementationCandidateId,
  asLabCycleId,
  asOrganizationId,
  asReleaseId,
  isValidContentDigest,
} from "./primitives.ts";
import type { ProjectEvidenceLedger, ObservationLedger } from "./evidence.ts";
import type { OrganizationSearchContext, OrganizationDescriptor } from "./organization.ts";

/** The frozen stage vocabulary of the Lab loop, in canonical order. */
export const LAB_LOOP_STAGE_KINDS = Object.freeze([
  "project-evidence",
  "diagnosis",
  "hypothesis",
  "organization-search",
  "simulation-evaluation",
  "implementation-candidate",
  "pr",
  "release",
  "observed-outcome",
  "calibration",
] as const);

/** One stage kind of the Lab loop. */
export type LabLoopStageKind = (typeof LAB_LOOP_STAGE_KINDS)[number];

/** Returns true when `value` is a valid {@link LabLoopStageKind}. */
export function isLabLoopStageKind(value: unknown): value is LabLoopStageKind {
  return typeof value === "string" && (LAB_LOOP_STAGE_KINDS as readonly string[]).includes(value);
}

/**
 * The frozen stage transition table. Each stage advances to its canonical
 * successor; the loop-closing edge `calibration → organization-search`
 * denotes the next iteration (see module docs). There are no other edges —
 * stage skipping is unrepresentable.
 */
export const LAB_LOOP_TRANSITIONS: Readonly<Record<LabLoopStageKind, readonly LabLoopStageKind[]>> = Object.freeze({
  "project-evidence": Object.freeze(["diagnosis"] as const),
  diagnosis: Object.freeze(["hypothesis"] as const),
  hypothesis: Object.freeze(["organization-search"] as const),
  "organization-search": Object.freeze(["simulation-evaluation"] as const),
  "simulation-evaluation": Object.freeze(["implementation-candidate"] as const),
  "implementation-candidate": Object.freeze(["pr"] as const),
  pr: Object.freeze(["release"] as const),
  release: Object.freeze(["observed-outcome"] as const),
  "observed-outcome": Object.freeze(["calibration"] as const),
  calibration: Object.freeze(["organization-search"] as const),
});

/** Returns true when `from -> to` is a legal Lab-loop stage transition. */
export function canTransitionLoopStage(from: LabLoopStageKind, to: LabLoopStageKind): boolean {
  return LAB_LOOP_TRANSITIONS[from].includes(to);
}

/** Collects the project evidence of the cycle (links immutable records by id). */
export interface ProjectEvidenceStageRecord {
  readonly stage: "project-evidence";
  readonly cycleId: LabCycleId;
  readonly collected: readonly EvidenceRecordId[];
}

/** The diagnosis stage: findings derived from collected evidence. */
export interface DiagnosisStageRecord {
  readonly stage: "diagnosis";
  readonly cycleId: LabCycleId;
  readonly diagnosisId: DiagnosisId;
  readonly fromEvidence: readonly EvidenceRecordId[];
  readonly findings: readonly string[];
}

/** The hypothesis stage: one hypothesis, derived from one diagnosis. */
export interface HypothesisStageRecord {
  readonly stage: "hypothesis";
  readonly cycleId: LabCycleId;
  readonly hypothesisId: HypothesisId;
  readonly diagnosis: DiagnosisId;
  readonly statement: string;
}

/**
 * The organization-search stage (lock 25: contextual and evidence-driven).
 * `baseline` is MANDATORY — the always-available generalist candidate
 * (lock 26) — so a search can never be structurally performed without its
 * fallback candidate.
 */
export interface OrganizationSearchStageRecord {
  readonly stage: "organization-search";
  readonly cycleId: LabCycleId;
  readonly hypothesis: HypothesisId;
  readonly context: OrganizationSearchContext;
  readonly baseline: OrganizationId;
  readonly candidates: readonly OrganizationId[];
}

/** The simulation/evaluation stage: links one candidate-evaluation record. */
export interface SimulationEvaluationStageRecord {
  readonly stage: "simulation-evaluation";
  readonly cycleId: LabCycleId;
  readonly evaluation: CandidateEvaluationId;
}

/**
 * The implementation-candidate stage: the candidate chosen for
 * implementation, with the evaluation it is based on and its
 * content-addressed content.
 */
export interface ImplementationCandidateStageRecord {
  readonly stage: "implementation-candidate";
  readonly cycleId: LabCycleId;
  readonly candidateId: ImplementationCandidateId;
  readonly evaluation: CandidateEvaluationId;
  readonly organization: OrganizationId;
  readonly contentDigest: ContentDigest;
}

/** The PR stage: the candidate opened as a Git pull request (R1). */
export interface PrStageRecord {
  readonly stage: "pr";
  readonly cycleId: LabCycleId;
  readonly candidate: ImplementationCandidateId;
  readonly pr: GitRef;
}

/** The release stage: the candidate released at a pinned Git ref. */
export interface ReleaseStageRecord {
  readonly stage: "release";
  readonly cycleId: LabCycleId;
  readonly releaseId: ReleaseId;
  readonly candidate: ImplementationCandidateId;
  readonly released: GitRef;
}

/** The observed-outcome stage: links an IMMUTABLE observation (E10). */
export interface ObservedOutcomeStageRecord {
  readonly stage: "observed-outcome";
  readonly cycleId: LabCycleId;
  readonly observation: ObservationId;
  readonly release: ReleaseId;
}

/** The calibration stage: links conclusions derived from immutable observations. */
export interface CalibrationStageRecord {
  readonly stage: "calibration";
  readonly cycleId: LabCycleId;
  readonly calibration: CalibrationId;
  readonly observations: readonly ObservationId[];
}

/** Any stage record of the Lab loop. */
export type LabLoopStageRecord =
  | ProjectEvidenceStageRecord
  | DiagnosisStageRecord
  | HypothesisStageRecord
  | OrganizationSearchStageRecord
  | SimulationEvaluationStageRecord
  | ImplementationCandidateStageRecord
  | PrStageRecord
  | ReleaseStageRecord
  | ObservedOutcomeStageRecord
  | CalibrationStageRecord;

/** One iteration of the Lab loop for one project. */
export interface LabCycleRecord {
  readonly cycleId: LabCycleId;
  readonly project: GameIdentity;
  /** Lineage: the cycle whose calibration informed this one's search. */
  readonly previousCycle?: LabCycleId;
  readonly stages: readonly LabLoopStageRecord[];
}

/** Typed refusal of {@link appendLoopStage}. */
export type LoopAppendRefusal =
  | "cycle-id-mismatch"
  | "duplicate-stage-kind"
  | "illegal-stage-transition"
  | "first-stage-must-collect-evidence";

/** Result of {@link appendLoopStage}. */
export type LoopAppendResult =
  | { readonly ok: true; readonly cycle: LabCycleRecord }
  | { readonly ok: false; readonly code: LoopAppendRefusal; readonly cycle: LabCycleRecord; readonly detail: string };

/**
 * Appends one stage record to a cycle (pure copy-on-write). The stage's
 * `cycleId` must match; each stage kind appears at most once per cycle;
 * the stage must be the canonical successor of the current last stage.
 * Every cycle starts at `project-evidence` — the Lab learns from real
 * project evidence before it searches organizations (R17).
 */
export function appendLoopStage(cycle: LabCycleRecord, stage: LabLoopStageRecord): LoopAppendResult {
  if (stage.cycleId !== cycle.cycleId) {
    return { ok: false, code: "cycle-id-mismatch", cycle, detail: `stage belongs to cycle ${stage.cycleId}` };
  }
  if (cycle.stages.some((existing) => existing.stage === stage.stage)) {
    return { ok: false, code: "duplicate-stage-kind", cycle, detail: `stage ${stage.stage} already present this cycle` };
  }
  if (cycle.stages.length === 0) {
    if (stage.stage !== "project-evidence") {
      return {
        ok: false,
        code: "first-stage-must-collect-evidence",
        cycle,
        detail: "a cycle starts at project-evidence (R17: evidence before search)",
      };
    }
  } else {
    const last = cycle.stages[cycle.stages.length - 1];
    if (last === undefined || !canTransitionLoopStage(last.stage, stage.stage)) {
      return {
        ok: false,
        code: "illegal-stage-transition",
        cycle,
        detail: `cannot append ${stage.stage} after ${last?.stage ?? "nothing"}`,
      };
    }
  }
  return { ok: true, cycle: { ...cycle, stages: Object.freeze([...cycle.stages, stage]) } };
}

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
