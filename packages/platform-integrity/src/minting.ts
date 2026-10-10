/**
 * EVALUATION ARTIFACT MINTING (PL-018, E9/E10).
 *
 * Pure derivation of EVERY record one accepted evaluation produces:
 * digest-pinned behavioral evidence records (content-derived ids),
 * the signal set (policy-calibrated, evidence-cited), the aggregate
 * (via the FROZEN platform-contracts oracle), the validated report, and
 * the classified verdict. The service commits these; nothing here
 * mutates state. Identical (evaluation, policy, key) → byte-identical
 * artifacts, forever — recomputation with different content mints NEW
 * ids and never edits history (E10).
 *
 * Purity: no IO, no clocks, no randomness.
 */

import type {
  BehavioralEvidenceRecord,
  ContentDigest,
  EvidenceCitation,
  IntegrityEvidenceRef,
  IntegrityReport,
  IntegrityRiskVerdict,
} from "@playliquid/platform-contracts";
import {
  PLATFORM_AUTHORITY,
  aggregateIntegritySignals,
  asEvidenceRecordId,
  asIntegrityReportId,
  asIntegrityVerdictId,
  validateIntegrityReport,
} from "@playliquid/platform-contracts";
import type { AdmittedEvaluation } from "./admission.ts";
import type { IntegrityRiskPolicy } from "./policy.ts";
import { evaluateIntegritySignals } from "./signals.ts";
import { classifyIntegrityRisk, mintIntegrityRiskVerdict } from "./verdicts.ts";
import { citationsOf } from "./document.ts";
import { digestOf, digestSlug } from "./digest.ts";

/** Everything one accepted evaluation mints, ready to commit. */
export interface MintedArtifacts {
  /** Digest-pinned evidence records in frozen order (timing, trajectory, outcome). */
  readonly evidenceRecords: readonly BehavioralEvidenceRecord[];
  /** The minted evidence ids, in the same order. */
  readonly evidenceIds: readonly string[];
  readonly report: IntegrityReport;
  readonly verdict: IntegrityRiskVerdict;
}

/**
 * Pure minting of one evaluation's artifacts under one policy. The
 * report is validated with the frozen contracts validator before it is
 * returned (fail closed — an invalid report can never exist).
 */
export function mintEvaluationArtifacts(
  evaluation: AdmittedEvaluation,
  policy: IntegrityRiskPolicy,
  evaluationKey: ContentDigest,
): MintedArtifacts {
  const outcomeAdmissible =
    evaluation.outcome !== undefined && evaluation.outcome.reexecutionKind !== "inconclusive";
  const kinds: readonly [BehavioralEvidenceRecord["kind"], unknown][] = outcomeAdmissible
    ? [
        ["timing", evaluation.timing],
        ["trajectory", evaluation.trajectory],
        ["outcome-pattern", evaluation.outcome],
      ]
    : [
        ["timing", evaluation.timing],
        ["trajectory", evaluation.trajectory],
      ];
  const evidenceRecords: BehavioralEvidenceRecord[] = [];
  const evidenceIds: string[] = [];
  const evidenceByKind = new Map<string, BehavioralEvidenceRecord>();
  for (const [kind, payload] of kinds) {
    const evidenceId = `evid-${digestSlug({ key: evaluationKey, kind })}`;
    const record: BehavioralEvidenceRecord = {
      recordKind: "integrity-evidence",
      evidenceId: asEvidenceRecordId(evidenceId)!,
      tenant: evaluation.tenant,
      subject: evaluation.subject,
      kind,
      payloadDigest: digestOf(payload),
      sourceDigest: evaluation.sourceDigest,
      capturedAt: evaluation.capturedAt,
    };
    evidenceRecords.push(record);
    evidenceIds.push(evidenceId);
    evidenceByKind.set(kind, record);
  }
  // Signals: policy-calibrated, evidence-cited, honest intervals.
  const refOf = (record: BehavioralEvidenceRecord): IntegrityEvidenceRef => ({
    source: "replay",
    replayId: evaluation.replayId,
    digest: record.payloadDigest,
  });
  const timingRecord = evidenceByKind.get("timing")!;
  const trajectoryRecord = evidenceByKind.get("trajectory")!;
  const outcomeRecord = evidenceByKind.get("outcome-pattern");
  const signalEvaluation = evaluateIntegritySignals(
    evaluation.timing,
    evaluation.trajectory,
    evaluation.outcome,
    evaluation.playMode,
    policy,
    {
      timing: [refOf(timingRecord)],
      trajectory: [refOf(trajectoryRecord)],
      outcome: outcomeRecord === undefined ? [] : [refOf(outcomeRecord)],
    },
  );
  // Aggregate: the FROZEN contracts oracle — never re-implemented here.
  const aggregate = aggregateIntegritySignals(signalEvaluation.signals);
  const reportId = `rpt-${digestSlug({ key: evaluationKey, policyId: policy.policyId })}`;
  const report: IntegrityReport = {
    reportId: asIntegrityReportId(reportId)!,
    tenant: evaluation.tenant,
    subject: evaluation.subject,
    playMode: evaluation.playMode,
    signals: signalEvaluation.signals,
    aggregate,
    enforcement: evaluation.enforcement,
    decidedBy: PLATFORM_AUTHORITY,
  };
  const reportValidation = validateIntegrityReport(report);
  if (!reportValidation.ok) {
    throw new RangeError(`integrity-service: refused to mint an invalid report (${reportValidation.code})`);
  }
  // Verdict: frozen vocabulary, derived band, pinned evidence citations.
  const verdictId = `vrd-${digestSlug({ reportId, policyId: policy.policyId })}`;
  const citedRecords = outcomeAdmissible
    ? [timingRecord, trajectoryRecord, outcomeRecord!]
    : [timingRecord, trajectoryRecord];
  const citations: readonly EvidenceCitation[] = citationsOf(citedRecords);
  const verdict = mintIntegrityRiskVerdict({
    verdictId: asIntegrityVerdictId(verdictId)!,
    tenant: evaluation.tenant,
    subject: evaluation.subject,
    reportRef: report.reportId,
    risk: aggregate,
    kind: classifyIntegrityRisk(aggregate, policy),
    evidence: citations,
  });
  return { evidenceRecords, evidenceIds, report, verdict };
}
