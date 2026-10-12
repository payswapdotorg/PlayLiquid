/**
 * EVALUATION WIRING (PL-029) — candidates compile → lab-simulation
 * evaluation requests → immutable evidence records
 * (spec/architecture.md §Lab loop: "organization search →
 * simulation/evaluation").
 *
 * The pure oracle here binds one compiled candidate to one
 * {@link LabEvaluationPort} call and one CONTENT-ADDRESSED evidence record:
 *
 * - the evaluation CONTENT KEY (digest.ts) is the idempotency key — it
 *   covers tenant, cycle, candidate content, suite pin, evidence bundle
 *   digest, seed, tick budget and objective context (the lab-simulation
 *   identity discipline, keyed by candidate digest);
 * - re-evaluation of an identical candidate+seed REPLAYS the recorded
 *   outcome (E10: recorded runs are immutable; the oracle returns the
 *   existing record with `replayed: true`, never recomputes);
 * - the port dance is honest about lab-simulation's own E10 receipts: a
 *   duplicate ADMISSION at the engine is answered by running the recorded
 *   intake; an already-run evaluation returns the recorded run;
 * - the recorded outcome is a lab-simulation run record — an
 *   EXPLICITLY-LABELED ESTIMATE (E11, lock 28/29): nothing in this module
 *   can convert it to observed evidence.
 *
 * Pure module: no IO, no clocks (evaluatedAt is caller-supplied), no
 * randomness.
 */

import type {
  CandidateEvaluationId,
  ContentDigest,
  EvaluationSeed,
  LabCycleId,
  LabEvaluationSuiteRef,
  OrganizationSearchContext,
  TimestampMs,
} from "@playliquid/lab-contracts";
import { asTimestampMs, sealRecord } from "@playliquid/lab-contracts";
import type {
  EvidenceBundleRef,
  LabEvaluationRequest,
  LabEvaluationRunRecord,
  LabIntakeRefusalCode,
  LabRunRefusalCode,
} from "@playliquid/lab-simulation";
import type { LabEvaluationPort, LabOrganizationCaller, StoredCandidateEvidence } from "./ports.ts";
import type { CompiledOrganization, EvaluateRefusalCode } from "./records.ts";
import { evaluationContentKeyOf } from "./digest.ts";
import { labEvaluationRequestOf } from "./compile.ts";

/** Input of {@link evaluateThroughPort}. */
export interface EvaluateThroughPortInput {
  readonly compiled: CompiledOrganization;
  readonly caller: LabOrganizationCaller;
  readonly cycleId: LabCycleId;
  readonly context: OrganizationSearchContext;
  readonly suite: LabEvaluationSuiteRef;
  readonly evidence: EvidenceBundleRef;
  readonly parameters: { readonly seed: EvaluationSeed; readonly tickBudget: number };
  readonly searchId?: string;
  readonly position?: number;
  readonly port: LabEvaluationPort;
  /** Previously recorded evidence (content-key replay detection, E10). */
  readonly known: readonly StoredCandidateEvidence[];
  /** Caller-supplied record time (no clock authority here). */
  readonly now: number;
}

/** Result of {@link evaluateThroughPort}. */
export type EvaluateThroughPortResult =
  | { readonly ok: true; readonly evidence: StoredCandidateEvidence; readonly replayed: boolean }
  | {
      readonly ok: false;
      readonly code: EvaluateRefusalCode;
      readonly detail: string;
      readonly portCode?: LabIntakeRefusalCode | LabRunRefusalCode;
    };

/**
 * Evaluates one compiled candidate through the lab-simulation port and
 * assembles the immutable evidence record. Total: typed refusals only.
 */
export function evaluateThroughPort(input: EvaluateThroughPortInput): EvaluateThroughPortResult {
  const now = asTimestampMs(input.now);
  if (now === undefined) {
    return { ok: false, code: "invalid-request-time", detail: "evaluation time must be a safe integer millisecond value" };
  }
  const candidateDigest = input.compiled.contentDigest;
  const contentKey = evaluationContentKeyOf({
    tenant: String(input.caller.tenant),
    cycleId: String(input.cycleId),
    candidateDigest,
    suite: input.suite,
    evidenceBundleDigest: String(input.evidence.declaredDigest),
    seed: String(input.parameters.seed),
    tickBudget: input.parameters.tickBudget,
    context: input.context,
  });
  const existing = input.known.find(
    (record) => String(record.contentKey) === String(contentKey) && record.tenant === input.caller.tenant,
  );
  if (existing !== undefined) {
    return { ok: true, evidence: existing, replayed: true };
  }

  const request: LabEvaluationRequest = labEvaluationRequestOf({
    compiled: input.compiled,
    tenant: input.caller.tenant,
    owner: input.caller.subject,
    cycleId: input.cycleId,
    suite: input.suite,
    evidence: input.evidence,
    context: input.context,
    parameters: input.parameters,
    requestedAt: now,
  });
  const admitted = input.port.admitEvaluation(request);
  let evaluationId: CandidateEvaluationId;
  if (admitted.ok) {
    evaluationId = admitted.record.evaluationId;
  } else if (admitted.code === "duplicate-evaluation" && admitted.recorded !== undefined) {
    evaluationId = admitted.recorded.evaluationId;
  } else {
    return {
      ok: false,
      code: "evaluation-refused",
      detail: `lab-simulation admission refused: ${admitted.code}: ${admitted.detail}`,
      portCode: admitted.code,
    };
  }

  const run = input.port.runEvaluation({ evaluationId, as: input.caller });
  if (run.ok) {
    return { ok: true, evidence: sealEvidence(input, now, contentKey, candidateDigest, evaluationId, run.run), replayed: false };
  }
  if (run.code === "evaluation-already-run" && run.recorded !== undefined) {
    return {
      ok: true,
      evidence: sealEvidence(input, now, contentKey, candidateDigest, evaluationId, run.recorded),
      replayed: true,
    };
  }
  return {
    ok: false,
    code: "evaluation-refused",
    detail: `lab-simulation run refused: ${run.code}: ${run.detail}`,
    portCode: run.code,
  };
}

/** Assembles and seals one evidence record (the only write path, E10). */
function sealEvidence(
  input: EvaluateThroughPortInput,
  now: TimestampMs,
  contentKey: ContentDigest,
  candidateDigest: ContentDigest,
  evaluationId: CandidateEvaluationId,
  run: LabEvaluationRunRecord,
): StoredCandidateEvidence {
  return sealRecord({
    contentKey,
    tenant: input.caller.tenant,
    owner: input.caller.subject,
    cycleId: input.cycleId,
    searchId: input.searchId,
    position: input.position,
    candidateDigest,
    suite: input.suite,
    seed: input.parameters.seed,
    tickBudget: input.parameters.tickBudget,
    evaluationId,
    run,
    recordedAt: now,
  });
}
