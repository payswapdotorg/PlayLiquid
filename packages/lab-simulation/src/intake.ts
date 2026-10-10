/**
 * EVALUATION INTAKE ADMISSION (E1, PL-028) — the pure oracle behind the
 * service's `admitEvaluation` door.
 *
 * One evaluation request is admitted as ONE record. The oracle:
 *
 * 1. validates the tenant/owner/cycle/request-time primitives;
 * 2. validates the candidate organization with lab-contracts'
 *    `validateOrganization` (the Lab's own validator — consumed, never
 *    re-implemented);
 * 3. resolves the suite through the {@link LabSuiteResolver} port
 *    (lab-contracts `EvaluationSuiteResolver` seam) — unknown pins are
 *    refused;
 * 4. resolves EVERY evidence record through the read-only
 *    {@link LabEvidenceLedger} port (R17: real project evidence;
 *    unknown ids are refused);
 * 5. RECOMPUTES the evidence bundle digest and refuses a declared digest
 *    that does not match (E8: tampered evidence digest refusal);
 * 6. validates the parameters (seed parse, bounded tick budget — E9);
 * 7. derives the content-addressed identity (digest.ts) and returns the
 *    sealed intake record — or the E10 duplicate receipt when the same
 *    identity was already admitted.
 *
 * Pure module: no IO, no clocks (admission time is caller-supplied), no
 * state (duplicates are answered from the caller-supplied known set).
 */

import type { ProjectEvidenceRecord } from "@playliquid/lab-contracts";
import { asLabCycleId, asTimestampMs, validateOrganization } from "@playliquid/lab-contracts";
import type { EvaluationSuiteResolver } from "@playliquid/lab-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { asEvaluationSeed } from "@playliquid/lab-contracts";
import type { LabEvaluationIntakeRecord, LabEvaluationRequest, LabIntakeRefusalCode, LabIntakeResult } from "./records.ts";
import {
  MAX_EVIDENCE_RECORDS,
  MAX_TICK_BUDGET,
  MIN_EVIDENCE_RECORDS,
  MIN_TICK_BUDGET,
} from "./records.ts";
import {
  evidenceBundleDigestOf,
  labEvaluationIdentityDigest,
  labEvaluationSlugId,
  normalizeEvidenceIds,
} from "./digest.ts";
import { sealRecord } from "@playliquid/lab-contracts";

/**
 * Read-only evidence lookup: the immutable project-evidence ledger view
 * (E10). Implementations resolve evidence record ids to their sealed
 * records or `undefined` — they can never mutate them through this seam.
 */
export type LabEvidenceLedger = (recordId: string) => ProjectEvidenceRecord | undefined;

/** The ports the intake oracle needs (both host-injected, fakes in fakes.ts). */
export interface LabIntakePorts {
  readonly suites: EvaluationSuiteResolver;
  readonly evidence: LabEvidenceLedger;
}

/**
 * Adjudicates one evaluation request. Total: either the sealed intake
 * record or a typed refusal (with the E10 duplicate receipt when the same
 * content was already admitted). Never mutates its inputs.
 */
export function admitLabEvaluation(input: {
  readonly request: LabEvaluationRequest;
  readonly ports: LabIntakePorts;
  /** Caller-supplied admission time (no clock authority here). */
  readonly admittedAt: number;
  /** Previously admitted intake records (duplicate detection, E10). */
  readonly known: readonly LabEvaluationIntakeRecord[];
}): LabIntakeResult {
  const { request, ports, admittedAt } = input;

  if (asTenantId(request.tenant) === undefined) {
    return refuse("invalid-tenant", "tenant id failed validation");
  }
  if (asSubjectId(request.owner) === undefined) {
    return refuse("invalid-owner", "owner subject id failed validation");
  }
  if (asLabCycleId(request.cycleId) === undefined) {
    return refuse("invalid-cycle", "cycle id failed validation");
  }
  const admitted = asTimestampMs(admittedAt);
  if (admitted === undefined) {
    return refuse("invalid-request-time", "admittedAt must be a safe integer millisecond value");
  }
  if (asTimestampMs(request.requestedAt) === undefined) {
    return refuse("invalid-request-time", "requestedAt must be a safe integer millisecond value");
  }

  const organization = validateOrganization(request.organization);
  if (!organization.ok) {
    const first = organization.violations[0];
    return refuse(
      "invalid-organization",
      `candidate organization failed validation: ${first ? `${first.code}: ${first.detail}` : "violations"}`,
    );
  }

  const suite = ports.suites(request.suite);
  if (suite === undefined) {
    return refuse("unknown-suite", "suite reference did not resolve (unknown suiteId or digest pin)");
  }

  if (asEvaluationSeed(request.parameters.seed) === undefined) {
    return refuse("invalid-parameters", "seed must be non-empty opaque text (E9)");
  }
  const tickBudget = request.parameters.tickBudget;
  if (
    !Number.isInteger(tickBudget) ||
    tickBudget < MIN_TICK_BUDGET ||
    tickBudget > MAX_TICK_BUDGET
  ) {
    return refuse(
      "invalid-parameters",
      `tickBudget must be an integer in [${MIN_TICK_BUDGET}, ${MAX_TICK_BUDGET}]`,
    );
  }

  const recordIds = normalizeEvidenceIds(request.evidence.recordIds);
  if (recordIds.length < MIN_EVIDENCE_RECORDS || recordIds.length > MAX_EVIDENCE_RECORDS) {
    return refuse(
      "unknown-evidence",
      `evidence bundle must reference ${MIN_EVIDENCE_RECORDS}..${MAX_EVIDENCE_RECORDS} distinct records`,
    );
  }
  const resolved: ProjectEvidenceRecord[] = [];
  for (const recordId of recordIds) {
    const record = ports.evidence(recordId);
    if (record === undefined) {
      return refuse("unknown-evidence", `evidence record ${recordId} is not in the ledger`);
    }
    resolved.push(record);
  }
  const recomputed = evidenceBundleDigestOf(resolved);
  if (recomputed !== request.evidence.declaredDigest) {
    return refuse(
      "evidence-digest-mismatch",
      `declared evidence bundle digest ${String(request.evidence.declaredDigest)} does not match the resolved records (${String(recomputed)}) — tampered evidence is refused (E8)`,
    );
  }

  const identityDigest = labEvaluationIdentityDigest(request);
  const duplicate = input.known.find((record) => record.identityDigest === identityDigest);
  if (duplicate !== undefined && duplicate.tenant === request.tenant) {
    return {
      ok: false,
      code: "duplicate-evaluation",
      detail: `evaluation ${String(duplicate.evaluationId)} already admitted (E10: no rewrite path exists)`,
      recorded: duplicate,
    };
  }

  const record: LabEvaluationIntakeRecord = sealRecord({
    evaluationId: labEvaluationSlugId(identityDigest),
    identityDigest,
    tenant: request.tenant,
    owner: request.owner,
    cycleId: request.cycleId,
    organization: request.organization.id,
    suite: request.suite,
    evidenceRecordIds: recordIds,
    evidenceBundleDigest: recomputed,
    seed: request.parameters.seed,
    tickBudget,
    requestedAt: request.requestedAt,
    admittedAt: admitted,
  });
  return { ok: true, record };
}

/** Builds the typed refusal arm (kept local and simple). */
function refuse(code: LabIntakeRefusalCode, detail: string): LabIntakeResult {
  return { ok: false, code, detail };
}
