/**
 * SERVICE RESULT TYPES (PL-018).
 *
 * Every door of the integrity service returns a typed result — never a
 * naked throw, never a silent default. Success shapes carry the
 * evidence/confidence payload; refusal shapes carry a frozen kebab-case
 * code plus a human-readable detail (E8: every negative path is typed).
 *
 * The duplicate-submission refusal carries the RECORDED receipt
 * (`recorded`): re-submitting the same evaluation content is idempotent
 * (E10) — the caller receives what was recorded, and the history is
 * never re-mutated.
 *
 * Purity: types only.
 */

import type { BehavioralEvidenceRecord, IntegrityReport, IntegrityRiskVerdict, ContentDigest } from "@playliquid/platform-contracts";
import type { EvaluationReceipt } from "./ports.ts";

/** Generic refusal: every negative door result is typed, never thrown. */
export type IntegrityRefusal = { readonly ok: false; readonly code: string; readonly detail: string };

/**
 * Result of one evaluation submission. Mirroring the sibling submission
 * doors (platform-leaderboard), the shared discriminant is `accepted`:
 * success carries the receipt/report/verdict, refusal carries a typed
 * code (+ the recorded receipt when the content was already journaled).
 */
export type EvaluationResult =
  | {
      readonly accepted: true;
      readonly receipt: EvaluationReceipt;
      readonly report: IntegrityReport;
      readonly verdict: IntegrityRiskVerdict;
    }
  | { readonly accepted: false; readonly code: string; readonly detail: string; readonly recorded?: EvaluationReceipt };

/** Result of reading one report. */
export type ReportReadResult = { readonly ok: true; readonly report: IntegrityReport } | IntegrityRefusal;

/** Result of reading one verdict. */
export type VerdictReadResult = { readonly ok: true; readonly verdict: IntegrityRiskVerdict } | IntegrityRefusal;

/** Result of reading one evidence record. */
export type EvidenceReadResult =
  | { readonly ok: true; readonly record: BehavioralEvidenceRecord }
  | IntegrityRefusal;

/** Result of reading the append-only journal. */
export type HistoryResult = { readonly ok: true; readonly receipts: readonly EvaluationReceipt[] } | IntegrityRefusal;

/** Result of querying a subject's latest recorded standing. */
export type StandingResult = { readonly ok: true; readonly verdict: IntegrityRiskVerdict } | IntegrityRefusal;

/** Result of a state snapshot. */
export type SnapshotResult = { readonly ok: true; readonly snapshotId: ContentDigest; readonly revision: number } | IntegrityRefusal;

/** Result of a state restore. */
export type RestoreResult = { readonly ok: true; readonly revision: number } | IntegrityRefusal;
