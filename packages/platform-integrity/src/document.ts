/**
 * STATE DOCUMENT — snapshot serialization and tamper-evident adoption
 * (PL-018, E10).
 *
 * The whole service state serializes to one {@link IntegrityStateDocument}
 * (canonical-JSON-stable; the snapshot id is the digest of that form).
 * Restoring adopts the WHOLE document — there is no partial apply — and
 * EVERY adopted record is re-validated against the frozen
 * platform-contracts guards before a single entry enters live state:
 *
 * - every evidence record must pass its structural guard;
 * - every report must pass the full report validator (a mutated
 *   aggregate fails with `aggregate-mismatch` — tampered history is
 *   refused, never silently repaired);
 * - every verdict must pass the full verdict validator (a forged band
 *   fails with `band-mismatch`);
 * - every reference must resolve: verdicts cite reports that exist and
 *   evidence citations that pin records that exist with the SAME payload
 *   digest (stale citations never resolve — the audit chain
 *   verdict -> report -> evidence -> pinned digests stays closed).
 *
 * Purity: pure functions over caller-supplied documents. No IO.
 */

import type {
  BehavioralEvidenceRecord,
  EvidenceCitation,
  IntegrityReport,
  IntegrityRiskVerdict,
  IntegrityVerdictId,
} from "@playliquid/platform-contracts";
import {
  citationMatchesRecord,
  isBehavioralEvidenceRecord,
  isIntegrityReport,
  isIntegrityRiskVerdict,
  validateIntegrityReport,
  validateIntegrityRiskVerdict,
} from "@playliquid/platform-contracts";
import type { EvaluationReceipt, IntegrityStateDocument } from "./ports.ts";
import { isIntegrityStateDocument } from "./ports.ts";

/** The adopted, fully-validated live state parts. */
export interface AdoptedState {
  readonly revision: number;
  readonly evidence: readonly BehavioralEvidenceRecord[];
  readonly reports: readonly IntegrityReport[];
  readonly verdicts: readonly IntegrityRiskVerdict[];
  readonly receipts: readonly EvaluationReceipt[];
}

/** Result of adopting a snapshot document. */
export type AdoptionResult =
  | { readonly ok: true; readonly state: AdoptedState }
  | {
      readonly ok: false;
      readonly code: "document-invalid" | "history-tampered" | "history-inconsistent";
      readonly detail: string;
    };

/**
 * Serializes the live state parts into one snapshot document. Array
 * order is the append-only journal order (E10: history order preserved).
 */
export function documentOf(state: AdoptedState): IntegrityStateDocument {
  return {
    documentKind: "integrity-state",
    revision: state.revision,
    evidence: [...state.evidence],
    reports: [...state.reports],
    verdicts: [...state.verdicts],
    receipts: [...state.receipts],
  };
}

/**
 * THE adoption gate (pure). Validates the whole document: structure,
 * per-record contracts validation, duplicate identity, and referential
 * integrity. Any tampering surfaces as a typed refusal — history is
 * append-only and may never be edited back into liveness.
 */
export function adoptDocument(value: unknown): AdoptionResult {
  if (!isIntegrityStateDocument(value)) {
    return { ok: false, code: "document-invalid", detail: "snapshot is not an integrity state document" };
  }
  const evidence: BehavioralEvidenceRecord[] = [];
  const evidenceIds = new Set<string>();
  for (const candidate of value.evidence) {
    if (!isBehavioralEvidenceRecord(candidate)) {
      return { ok: false, code: "history-tampered", detail: "an evidence record failed its structural guard" };
    }
    if (evidenceIds.has(candidate.evidenceId)) {
      return { ok: false, code: "history-inconsistent", detail: `duplicate evidence id ${candidate.evidenceId}` };
    }
    evidenceIds.add(candidate.evidenceId);
    evidence.push(candidate);
  }
  const reports: IntegrityReport[] = [];
  const reportIds = new Set<string>();
  for (const candidate of value.reports) {
    const validation = validateIntegrityReport(candidate);
    if (!validation.ok) {
      return {
        ok: false,
        code: "history-tampered",
        detail: `a report failed validation (${validation.code})`,
      };
    }
    if (!isIntegrityReport(candidate)) {
      return { ok: false, code: "history-tampered", detail: "a report failed its structural guard" };
    }
    if (reportIds.has(candidate.reportId)) {
      return { ok: false, code: "history-inconsistent", detail: `duplicate report id ${candidate.reportId}` };
    }
    reportIds.add(candidate.reportId);
    reports.push(candidate);
  }
  const verdicts: IntegrityRiskVerdict[] = [];
  const verdictIds = new Set<string>();
  for (const candidate of value.verdicts) {
    if (!isIntegrityRiskVerdict(candidate)) {
      return { ok: false, code: "history-tampered", detail: "a verdict failed its structural guard" };
    }
    const validation = validateIntegrityRiskVerdict(candidate);
    if (!validation.ok) {
      return {
        ok: false,
        code: "history-tampered",
        detail: `a verdict failed validation (${validation.code})`,
      };
    }
    if (verdictIds.has(candidate.verdictId)) {
      return { ok: false, code: "history-inconsistent", detail: `duplicate verdict id ${candidate.verdictId}` };
    }
    verdictIds.add(candidate.verdictId);
    verdicts.push(candidate);
  }
  // Referential integrity: verdicts follow existing reports; citations
  // pin existing evidence records at the recorded payload digest.
  for (const verdict of verdicts) {
    if (!reportIds.has(verdict.reportRef)) {
      return {
        ok: false,
        code: "history-inconsistent",
        detail: `verdict ${verdict.verdictId} cites an unknown report`,
      };
    }
    for (const citation of verdict.evidence) {
      const pinned = evidence.find((record) => citationMatchesRecord(citation, record));
      if (pinned === undefined) {
        return {
          ok: false,
          code: "history-inconsistent",
          detail: `verdict ${verdict.verdictId} cites evidence that does not resolve at the recorded digest`,
        };
      }
    }
  }
  const receipts: EvaluationReceipt[] = [];
  const receiptIds = new Set<string>();
  for (const receipt of value.receipts) {
    if (receiptIds.has(receipt.receiptId)) {
      return { ok: false, code: "history-inconsistent", detail: `duplicate receipt id ${receipt.receiptId}` };
    }
    receiptIds.add(receipt.receiptId);
    if (!reportIds.has(receipt.reportId) || !verdictIds.has(receipt.verdictId as IntegrityVerdictId)) {
      return {
        ok: false,
        code: "history-inconsistent",
        detail: `receipt ${receipt.receiptId} references unknown report/verdict`,
      };
    }
    for (const evidenceId of receipt.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        return {
          ok: false,
          code: "history-inconsistent",
          detail: `receipt ${receipt.receiptId} references unknown evidence ${evidenceId}`,
        };
      }
    }
    receipts.push(receipt);
  }
  return {
    ok: true,
    state: { revision: value.revision, evidence, reports, verdicts, receipts },
  };
}

/** Computes the pinned citations of a verdict's evidence records. */
export function citationsOf(records: readonly BehavioralEvidenceRecord[]): readonly EvidenceCitation[] {
  return records.map((record) => ({
    evidenceId: record.evidenceId,
    payloadDigest: record.payloadDigest,
  }));
}
