/**
 * LAB EVALUATION CONTRACTS: the candidate-evaluation record and the ports
 * the Lab's simulation/organization components (PL-028/PL-029) implement.
 *
 * There is NO simulation engine here (spec/architecture.md: the Lab loop's
 * simulation/evaluation stage is implemented by later Work Orders). What
 * this module fixes is the contract that stage programs against:
 *
 * - {@link OrganizationEvaluator} — the port that turns (organization,
 *   suite, context, seed) into an {@link LabeledEstimate}. The return type
 *   is the E11 enforcement surface: a simulator can only ever return an
 *   explicitly-labeled estimate, never an observation (lock rules 28/29).
 * - {@link recordCandidateEvaluation} — assembles the immutable
 *   {@link CandidateEvaluationRecord} (the "candidate-evaluation record"
 *   required by the Work Order) from caller-supplied ids, time and an
 *   estimate produced through the port.
 * - {@link validateCandidateEvaluationRecord} — validates a record against
 *   its resolved suite, checking that every metric reading satisfies the
 *   suite's kernel {@link ValueShape} via game-ir's own
 *   `valueMatchesShape` (the seam is consumed, not duplicated).
 *
 * Pure module: no IO, no clocks, no randomness, no engine.
 */

import { valueMatchesShape } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import type {
  CandidateEvaluationId,
  EvaluationSeed,
  LabCycleId,
  OrganizationId,
  TimestampMs,
} from "./primitives.ts";
import {
  asCandidateEvaluationId,
  asEvaluationSeed,
  asLabCycleId,
  asOrganizationId,
  asTimestampMs,
  isValidContentDigest,
  sealRecord,
} from "./primitives.ts";
import type { LabeledEstimate } from "./estimates.ts";
import { isLabeledEstimate } from "./estimates.ts";
import type {
  EvaluationMetricReading,
  LabEvaluationSuite,
  LabEvaluationSuiteRef,
} from "./evaluation-suites.ts";
import { isLabEvaluationSuiteRef } from "./evaluation-suites.ts";
import type { OrganizationDescriptor, OrganizationSearchContext } from "./organization.ts";

/**
 * A candidate-evaluation record: the typed outcome of evaluating ONE
 * candidate organization against ONE game-ir evaluation suite under a
 * reproducible seed (E9). The result is an {@link LabeledEstimate} — E11
 * and lock rules 28/29 make it structurally impossible for this record to
 * claim observed evidence.
 */
export interface CandidateEvaluationRecord {
  readonly evaluationId: CandidateEvaluationId;
  readonly cycleId: LabCycleId;
  readonly organization: OrganizationId;
  readonly suite: LabEvaluationSuiteRef;
  readonly seed: EvaluationSeed;
  readonly result: LabeledEstimate<readonly EvaluationMetricReading[]>;
  readonly evaluatedAt: TimestampMs;
}

/**
 * The request handed to the evaluation port: which organization, against
 * which resolved suite, under which search context and reproducible seed.
 */
export interface OrganizationEvaluationRequest {
  readonly organization: OrganizationDescriptor;
  readonly suite: LabEvaluationSuite;
  readonly context: OrganizationSearchContext;
  readonly seed: EvaluationSeed;
}

/**
 * PORT (E11/lock 29 baked into the signature): evaluates a candidate
 * organization and returns an explicitly-labeled estimate. Implementations
 * (lab-simulation PL-028) CANNOT return observed evidence — the type has
 * no slot for it.
 */
export type OrganizationEvaluator = (request: OrganizationEvaluationRequest) => LabeledEstimate<readonly EvaluationMetricReading[]>;

/**
 * Assembles and seals a {@link CandidateEvaluationRecord} from
 * caller-supplied identifiers, time and an estimate obtained through the
 * port. The estimate is verified to be labeled (E11) — an unlabeled or
 * observation-marked result is refused with `result-not-estimate`.
 */
export type CandidateEvaluationRefusal =
  | "invalid-ids"
  | "invalid-suite-ref"
  | "invalid-seed"
  | "result-not-estimate"
  | "empty-readings"
  | "invalid-timestamp";

/** Result of {@link recordCandidateEvaluation}. */
export type CandidateEvaluationResult =
  | { readonly ok: true; readonly record: CandidateEvaluationRecord }
  | { readonly ok: false; readonly code: CandidateEvaluationRefusal; readonly detail: string };

/** Params of {@link recordCandidateEvaluation}. */
export interface RecordCandidateEvaluationParams {
  readonly evaluationId: CandidateEvaluationId;
  readonly cycleId: LabCycleId;
  readonly organization: OrganizationId;
  readonly suite: LabEvaluationSuiteRef;
  readonly seed: EvaluationSeed;
  readonly result: LabeledEstimate<readonly EvaluationMetricReading[]>;
  readonly evaluatedAt: TimestampMs;
}

export function recordCandidateEvaluation(params: RecordCandidateEvaluationParams): CandidateEvaluationResult {
  if (
    asCandidateEvaluationId(params.evaluationId) === undefined ||
    asLabCycleId(params.cycleId) === undefined ||
    asOrganizationId(params.organization) === undefined
  ) {
    return { ok: false, code: "invalid-ids", detail: "evaluation/cycle/organization ids failed validation" };
  }
  if (!isLabEvaluationSuiteRef(params.suite)) {
    return { ok: false, code: "invalid-suite-ref", detail: "suite reference failed validation" };
  }
  if (asEvaluationSeed(params.seed) === undefined) {
    return { ok: false, code: "invalid-seed", detail: "seed must be non-empty opaque text (E9)" };
  }
  if (!isLabeledEstimate(params.result)) {
    return { ok: false, code: "result-not-estimate", detail: "result must carry the labeled-estimate marker (E11)" };
  }
  if (params.result.payload.length === 0) {
    return { ok: false, code: "empty-readings", detail: "an evaluation without readings is not an evaluation" };
  }
  if (asTimestampMs(params.evaluatedAt) === undefined) {
    return { ok: false, code: "invalid-timestamp", detail: "evaluatedAt must be caller-supplied safe integer ms" };
  }
  const record: CandidateEvaluationRecord = {
    evaluationId: params.evaluationId,
    cycleId: params.cycleId,
    organization: params.organization,
    suite: params.suite,
    seed: params.seed,
    result: params.result,
    evaluatedAt: params.evaluatedAt,
  };
  return { ok: true, record: sealRecord(record) };
}

/** Typed violation of {@link validateCandidateEvaluationRecord}. */
export type CandidateEvaluationViolationCode =
  | "record-ids-invalid"
  | "suite-mismatch"
  | "result-not-labeled-estimate"
  | "unknown-metric"
  | "reading-shape-mismatch"
  | "timestamp-invalid";

/** One typed violation. */
export interface CandidateEvaluationViolation {
  readonly code: CandidateEvaluationViolationCode;
  readonly detail: string;
}

/** Result of {@link validateCandidateEvaluationRecord}. */
export type CandidateEvaluationValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly CandidateEvaluationViolation[] };

/**
 * Validates a {@link CandidateEvaluationRecord} against its resolved
 * game-ir suite: ids parse, the suite matches the record's reference, the
 * result is a labeled estimate (E11), every reading names a declared
 * metric, and every reading SATISFIES the metric's kernel value shape
 * (checked with game-ir's own `valueMatchesShape` — the seam consumed,
 * never re-implemented).
 */
export function validateCandidateEvaluationRecord(
  record: CandidateEvaluationRecord,
  suite: LabEvaluationSuite,
): CandidateEvaluationValidation {
  const violations: CandidateEvaluationViolation[] = [];
  if (
    asCandidateEvaluationId(record.evaluationId) === undefined ||
    asLabCycleId(record.cycleId) === undefined ||
    asOrganizationId(record.organization) === undefined ||
    asTimestampMs(record.evaluatedAt) === undefined
  ) {
    violations.push({ code: "record-ids-invalid", detail: "record identifiers or timestamp failed validation" });
  }
  if (
    record.suite.suiteId !== suite.ref.suiteId ||
    record.suite.contentDigest !== suite.ref.contentDigest ||
    !isValidContentDigest(record.suite.contentDigest)
  ) {
    violations.push({ code: "suite-mismatch", detail: "record does not reference the given suite" });
  }
  if (!isLabeledEstimate(record.result)) {
    violations.push({ code: "result-not-labeled-estimate", detail: "result lacks the labeled-estimate marker (E11)" });
    return violations.length === 0 ? { ok: true } : { ok: false, violations: Object.freeze(violations) };
  }
  const shapes = new Map<string, GameIRValue["kind"] | undefined>();
  for (const metric of suite.metrics) {
    shapes.set(metric.metricId, metric.shape.kind);
  }
  for (const reading of record.result.payload) {
    if (!shapes.has(reading.metricId)) {
      violations.push({ code: "unknown-metric", detail: `reading cites undeclared metric ${reading.metricId}` });
      continue;
    }
    const metric = suite.metrics.find((candidate) => candidate.metricId === reading.metricId);
    if (metric === undefined || !valueMatchesShape(reading.value, metric.shape)) {
      violations.push({ code: "reading-shape-mismatch", detail: `reading of ${reading.metricId} does not satisfy the suite's kernel shape` });
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations: Object.freeze(violations) };
}

/** Returns true when `value` is structurally a {@link CandidateEvaluationRecord}. */
export function isCandidateEvaluationRecord(value: unknown): value is CandidateEvaluationRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.evaluationId === "string" &&
    asCandidateEvaluationId(record.evaluationId) !== undefined &&
    typeof record.cycleId === "string" &&
    asLabCycleId(record.cycleId) !== undefined &&
    typeof record.organization === "string" &&
    asOrganizationId(record.organization) !== undefined &&
    isLabEvaluationSuiteRef(record.suite) &&
    isLabeledEstimate(record.result)
  );
}
