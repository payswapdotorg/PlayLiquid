/**
 * THE LEARNING-CYCLE ADMISSION ORACLE (PL-030) — the pure intake of the
 * Lab learning layer (spec/architecture.md §Lab loop: "observed outcome →
 * calibration → next search"; R16/R17).
 *
 * One completed Lab cycle's artifacts arrive as a READ-ONLY submission:
 * the observation ledger (immutable observations + appended calibration
 * conclusions — E10, never mutated here; the only lab-contracts folds the
 * HOST already ran), the PL-028 evaluation run records (consumed, never
 * re-derived) and the PL-029 search results. The oracle validates every
 * artifact, folds it into a JSON-safe sealed content view, derives the
 * CONTENT-ADDRESSED identity (E10 receipt pattern) and answers:
 *
 * - identical folded content already recorded → the EXISTING record is
 *   returned as a typed idempotent receipt (`duplicate: true`) — never a
 *   second copy, never an error;
 * - the same cycle id with DIFFERENT content → `conflicting-cycle-content`
 *   (learning records are immutable once appended; there is no rewrite);
 * - a sequence that does not move forward → `non-monotonic-cycle-order`
 *   (learning folds only move forward, E8);
 * - a stripped or forged estimate label → `estimate-label-missing` (E11,
 *   lock 28/29 — the PL-028 refusal discipline, re-checked here because
 *   the run records cross a trust boundary);
 * - an observation that is not observed-evidence-marked →
 *   `observation-not-observed-evidence` (an estimate can never masquerade
 *   as a historical observation).
 *
 * Total: typed kebab-case refusals only; never throws, never mutates.
 * Pure module: no IO, no clocks (learnedAt is caller-supplied), no state.
 */

import type { CalibrationConclusion, LabCycleId, ObservedOutcomeRecord } from "@playliquid/lab-contracts";
import {
  asCalibrationId,
  asCandidateEvaluationId,
  asEvaluationSeed,
  asLabCycleId,
  asObservationId,
  asOrganizationId,
  asReleaseId,
  asTimestampMs,
  isLabEvaluationSuiteRef,
  isLabeledEstimate,
  isObservedEvidence,
  isOrganizationDescriptor,
  isValidContentDigest,
  sealRecord,
  validateGapRecord,
  validateOrganization,
} from "@playliquid/lab-contracts";
import type { LabEvaluationRunRecord } from "@playliquid/lab-simulation";
import { isCandidateBlueprint } from "@playliquid/lab-organization";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type {
  FoldedEvaluation,
  FoldedOutcome,
  FoldedSearchResult,
  LabCycleLearningSubmission,
  LearnAdmissionCode,
  LearnRefusalCode,
  LearningCycleRecord,
} from "./records.ts";
import { learningIdentityDigestOf, learningRecordIdOf } from "./digest.ts";
import type { LearningIdentityContent } from "./digest.ts";

/** The tenant-scoped known state the oracle admits against. */
export interface LearningIntakeKnownState {
  readonly records: readonly LearningCycleRecord[];
}

/** Result of {@link admitLearningCycle} (E10 receipt on duplicates). */
export type LearningIntakeResult =
  | { readonly ok: true; readonly record: LearningCycleRecord; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: LearnAdmissionCode; readonly detail: string };

/** Result of {@link foldSubmission} (the structural half of admission). */
export type SubmissionFoldResult =
  | { readonly ok: true; readonly content: LearningIdentityContent }
  | { readonly ok: false; readonly code: LearnRefusalCode; readonly detail: string };

/**
 * Validates and folds one submission into its JSON-safe identity content.
 * Total: every malformed artifact is a typed refusal; nothing is dropped
 * silently.
 */
export function foldSubmission(submission: LabCycleLearningSubmission): SubmissionFoldResult {
  if (asTenantId(submission.tenant) === undefined) return fail("invalid-tenant", "tenant id failed validation");
  if (asSubjectId(submission.owner) === undefined) return fail("invalid-owner", "owner subject id failed validation");
  if (asLabCycleId(submission.cycleId) === undefined) return fail("invalid-cycle", "cycle id failed validation");
  if (!Number.isSafeInteger(submission.sequence) || submission.sequence < 1) {
    return fail("invalid-sequence", "sequence must be a safe integer >= 1 (learning folds move forward)");
  }
  if (asTimestampMs(submission.learnedAt) === undefined) {
    return fail("invalid-time", "learnedAt must be a safe integer millisecond value");
  }

  const outcomes: FoldedOutcome[] = [];
  const seenObservations = new Set<string>();
  for (const observation of submission.observations.observations) {
    if (observation.cycleId !== (submission.cycleId as LabCycleId)) continue;
    const folded = foldObservation(observation);
    if (folded === undefined) {
      return fail(
        isObservedEvidence(observation) ? "invalid-observation" : "observation-not-observed-evidence",
        `observation ${String(observation.observationId)} failed validation (E10/E11: observations are immutable observed-evidence records)`,
      );
    }
    if (seenObservations.has(folded.observationId)) {
      return fail("invalid-observation", `observation ${folded.observationId} appears twice`);
    }
    seenObservations.add(folded.observationId);
    outcomes.push(folded);
  }

  const conclusions: CalibrationConclusion[] = [];
  for (const conclusion of submission.observations.conclusions) {
    if (conclusion.cycleId !== (submission.cycleId as LabCycleId)) continue;
    if (
      asCalibrationId(conclusion.calibrationId) === undefined ||
      conclusion.derivedFrom.length === 0 ||
      conclusion.derivedFrom.some((id) => asObservationId(id) === undefined) ||
      conclusion.statement.length === 0
    ) {
      return fail("invalid-conclusion", `calibration ${String(conclusion.calibrationId)} failed validation`);
    }
    for (const id of conclusion.derivedFrom) {
      if (!seenObservations.has(String(id))) {
        return fail(
          "unknown-observation-reference",
          `calibration ${String(conclusion.calibrationId)} cites observation ${String(id)} which is not folded from this cycle`,
        );
      }
    }
    conclusions.push(conclusion);
  }

  const evaluations: FoldedEvaluation[] = [];
  for (const run of submission.evaluations) {
    const folded = foldEvaluation(run, submission);
    if (typeof folded === "string") {
      return { ok: false, code: folded, detail: evaluationDetail(folded, run, submission) };
    }
    evaluations.push(folded);
  }

  const searchResults: FoldedSearchResult[] = [];
  for (const entry of submission.searchResults) {
    const folded = foldSearchResult(entry);
    if (folded === undefined) {
      return {
        ok: false,
        code: "invalid-search-result",
        detail: `search result ${String((entry as { readonly position?: unknown })?.position ?? "<malformed>")} failed validation`,
      };
    }
    searchResults.push(folded);
  }

  for (const gap of submission.gaps) {
    const validation = validateGapRecord(gap);
    if (!validation.ok) {
      return fail(
        "gap-record-invalid",
        `gap ${String(gap.gapId)} failed lab-contracts validation: ${validation.violations[0]?.code ?? "violations"}`,
      );
    }
  }

  if (outcomes.length === 0 && conclusions.length === 0 && evaluations.length === 0 && searchResults.length === 0 && submission.gaps.length === 0) {
    return fail("empty-cycle-fold", "a cycle without artifacts has nothing to learn");
  }

  return {
    ok: true,
    content: {
      tenant: String(submission.tenant),
      cycleId: String(submission.cycleId),
      sequence: submission.sequence,
      outcomes,
      conclusions,
      evaluations,
      searchResults,
      gaps: [...submission.gaps],
    },
  };
}

/**
 * The admission oracle: validates + folds the submission, derives its
 * content-addressed identity, then checks the tenant's known records for
 * the E10 duplicate receipt, a conflicting re-learn of the same cycle and
 * forward-only sequencing. The returned record is SEALED (deep-frozen).
 */
export function admitLearningCycle(
  submission: LabCycleLearningSubmission,
  known: LearningIntakeKnownState,
): LearningIntakeResult {
  const folded = foldSubmission(submission);
  if (!folded.ok) return { ok: false, code: folded.code, detail: folded.detail };
  const identityDigest = learningIdentityDigestOf(folded.content);
  const recordId = learningRecordIdOf(identityDigest);

  const duplicate = known.records.find((record) => String(record.identityDigest) === String(identityDigest));
  if (duplicate !== undefined) {
    return { ok: true, record: duplicate, duplicate: true };
  }
  const conflicting = known.records.find((record) => record.cycleId === submission.cycleId);
  if (conflicting !== undefined) {
    return {
      ok: false,
      code: "conflicting-cycle-content",
      detail: `cycle ${String(submission.cycleId)} was already learned as ${conflicting.recordId} with different content (E10: learning records are immutable once appended)`,
    };
  }
  const maxSequence = known.records.reduce((max, record) => Math.max(max, record.sequence), 0);
  if (submission.sequence <= maxSequence) {
    return {
      ok: false,
      code: "non-monotonic-cycle-order",
      detail: `sequence ${submission.sequence} does not move the learning fold forward (tenant is at ${maxSequence})`,
    };
  }

  const record: LearningCycleRecord = {
    recordId,
    identityDigest,
    tenant: submission.tenant,
    owner: submission.owner,
    cycleId: submission.cycleId,
    sequence: submission.sequence,
    learnedAt: submission.learnedAt,
    outcomes: Object.freeze(folded.content.outcomes),
    conclusions: Object.freeze(folded.content.conclusions),
    evaluations: Object.freeze(folded.content.evaluations),
    searchResults: Object.freeze(folded.content.searchResults),
    gaps: Object.freeze(folded.content.gaps),
  };
  return { ok: true, record: sealRecord(record), duplicate: false };
}

/** Folds one immutable observation (undefined = malformed or estimate-marked). */
function foldObservation(observation: ObservedOutcomeRecord): FoldedOutcome | undefined {
  if (!isObservedEvidence(observation)) return undefined;
  if (
    asObservationId(observation.observationId) === undefined ||
    asLabCycleId(observation.cycleId) === undefined ||
    asReleaseId(observation.release) === undefined ||
    !isValidContentDigest(observation.contentDigest) ||
    observation.summary.length === 0 ||
    asTimestampMs(observation.observedAt) === undefined
  ) {
    return undefined;
  }
  return {
    observationId: String(observation.observationId),
    release: String(observation.release),
    contentDigest: String(observation.contentDigest),
    summary: observation.summary,
    observedAt: Number(observation.observedAt),
  };
}

/** Folds one evaluation run (string = refusal code; never re-derives the estimate). */
function foldEvaluation(
  run: LabEvaluationRunRecord,
  submission: LabCycleLearningSubmission,
): FoldedEvaluation | LearnRefusalCode {
  if (asCandidateEvaluationId(run.evaluationId) === undefined) return "invalid-evaluation";
  if (run.tenant !== submission.tenant) return "cross-tenant";
  if (run.cycleId !== (submission.cycleId as LabCycleId)) return "evaluation-cycle-mismatch";
  if (!isLabeledEstimate(run.result)) {
    return "estimate-label-missing";
  }
  if (
    asOrganizationId(run.organization) === undefined ||
    !isLabEvaluationSuiteRef(run.suite) ||
    asEvaluationSeed(run.seed) === undefined ||
    typeof run.simulator !== "string" ||
    run.simulator.length === 0 ||
    asTimestampMs(run.runAt) === undefined
  ) {
    return "invalid-evaluation";
  }
  const statistics = run.statistics;
  if (
    !Number.isFinite(statistics.completedWork) ||
    !Number.isFinite(statistics.capabilityCoverage) ||
    statistics.capabilityCoverage < 0 ||
    statistics.capabilityCoverage > 1
  ) {
    return "invalid-evaluation";
  }
  const metricKinds: { readonly metricId: string; readonly kind: string }[] = [];
  for (const reading of run.result.payload) {
    if (typeof reading.metricId !== "string" || reading.metricId.length === 0) return "invalid-evaluation";
    const kind = (reading.value as { readonly kind?: unknown })?.kind;
    if (typeof kind !== "string" || kind.length === 0) return "invalid-evaluation";
    metricKinds.push({ metricId: reading.metricId, kind });
  }
  return {
    evaluationId: String(run.evaluationId),
    organization: String(run.organization),
    suiteId: String(run.suite.suiteId),
    seed: String(run.seed),
    simulator: run.simulator,
    method: run.result.method,
    runAt: Number(run.runAt),
    statistics,
    metricKinds: Object.freeze(metricKinds),
  };
}

/** Folds one search result (undefined = malformed). */
function foldSearchResult(entry: unknown): FoldedSearchResult | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const result = entry as {
    readonly contentDigest?: unknown;
    readonly position?: unknown;
    readonly spaceIndex?: unknown;
    readonly isBaseline?: unknown;
    readonly organization?: unknown;
    readonly blueprint?: unknown;
  };
  if (
    typeof result.contentDigest !== "string" ||
    !isValidContentDigest(result.contentDigest) ||
    !Number.isSafeInteger(result.position) ||
    (result.position as number) < 0 ||
    !Number.isSafeInteger(result.spaceIndex) ||
    (result.spaceIndex as number) < 0 ||
    typeof result.isBaseline !== "boolean" ||
    !isOrganizationDescriptor(result.organization) ||
    !validateOrganization(result.organization).ok ||
    asOrganizationId(result.organization.id) === undefined
  ) {
    return undefined;
  }
  if (result.blueprint !== undefined && !isCandidateBlueprint(result.blueprint)) return undefined;
  return {
    contentDigest: result.contentDigest,
    position: result.position as number,
    spaceIndex: result.spaceIndex as number,
    isBaseline: result.isBaseline,
    organization: String(result.organization.id),
    blueprint: result.blueprint,
  };
}

/** Renders the refusal detail of one rejected evaluation run. */
function evaluationDetail(
  code: LearnRefusalCode,
  run: LabEvaluationRunRecord,
  submission: LabCycleLearningSubmission,
): string {
  const id = typeof run.evaluationId === "string" ? run.evaluationId : "<malformed>";
  if (code === "estimate-label-missing") {
    return `evaluation ${id} no longer carries the labeled-estimate marker (E11) — a stripped or forged estimate cannot be learned`;
  }
  if (code === "cross-tenant") {
    return `evaluation ${id} belongs to tenant ${String(run.tenant)}, not the submitting tenant (R20)`;
  }
  if (code === "evaluation-cycle-mismatch") {
    return `evaluation ${id} belongs to cycle ${String(run.cycleId)}, not the submitted cycle ${String(submission.cycleId)}`;
  }
  return `evaluation ${id} failed structural validation`;
}

/** Refusal helper. */
function fail(code: LearnRefusalCode, detail: string): SubmissionFoldResult {
  return { ok: false, code, detail };
}
