/**
 * SCORE SUBMISSION ADMISSION (PL-015) — the pure oracle over
 * platform-contracts' leaderboard authority shapes.
 *
 * The first stage binds THE platform-contracts validation oracle
 * (`validateScoreRecord`): a submission is only ever an
 * {@link AuthoritativeScoreRecord} — platform-decided, evidence-backed.
 * Client-shaped claims (the `UntrustedClientInput` marker) are refused
 * as `not-authoritative` before anything else (R9 / lock 19 / E8).
 *
 * The oracle then enforces, in normative order: board registration,
 * tenant isolation (R20), the active season window, evidence-keyed
 * idempotency (E10: a replay returns the recorded result, never a
 * second mutation) and the STALE-SUBMISSION anti-gaming rule (E8: a
 * submission carrying an earlier `recordedAt` than the subject's last
 * admitted one is out-of-order and refused), and the integrity
 * quarantine bound from the board's {@link LeaderboardServicePolicy}
 * (R11 spirit).
 *
 * Purity: one pure function over caller-derived facts. No IO.
 */

import { validateScoreRecord } from "@playliquid/platform-contracts";
import type {
  AuthoritativeScoreRecord,
  ContentDigest,
  LeaderboardId,
  LeaderboardServicePolicy,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import type { BoardSubjectEntry } from "./boards.ts";

/** A score submission: the authoritative record plus integrity confidence. */
export interface ScoreSubmission {
  readonly record: AuthoritativeScoreRecord;
  /** Confidence in [0,1]; below the policy bound the entry is quarantined. */
  readonly integrityConfidence: number;
}

/** The facts the state owner derives for the oracle (never from the submission). */
export interface SubmissionFactsInput {
  readonly boardExists: boolean;
  /** Tenant the board is registered under (R20 cross-tenant detection). */
  readonly boardTenant: TenantId | undefined;
  /** Whether `record.recordedAt` falls inside the board's active season. */
  readonly withinWindow: boolean;
  /** The subject's last admitted submission time in the active season. */
  readonly lastRecordedAt: TimestampMs | undefined;
  /** The evidence digest was already recorded (idempotency encounter). */
  readonly evidenceSeen: boolean;
  /** Score recorded under that evidence digest, when seen (collision detect). */
  readonly recordedScore: number | undefined;
  /** The subject's current entry in the active season, if any. */
  readonly currentEntry: BoardSubjectEntry | undefined;
}

/** Typed refusal codes (E8 negative coverage; contracts codes surface verbatim). */
export type LeaderboardRefusalCode =
  | "invalid-tenant"
  | "invalid-leaderboard"
  | "invalid-subject"
  | "invalid-integrity-confidence"
  | "not-authoritative"
  | "missing-evidence"
  | "invalid-score"
  | "malformed-record"
  | "board-not-registered"
  | "cross-tenant-access"
  | "window-closed"
  | "duplicate-submission"
  | "idempotency-collision"
  | "stale-submission"
  | "quarantined-low-integrity";

/** Result of score submission admission (the service attaches the receipt). */
export type ScoreSubmissionAdmission =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly code: LeaderboardRefusalCode; readonly detail: string };

/** The idempotency key of a submission: (tenant, leaderboard, subject, evidence). */
export function submissionIdempotencyKey(
  tenant: TenantId,
  leaderboard: LeaderboardId,
  subject: SubjectId,
  evidence: ContentDigest,
): string {
  return `${String(tenant)}|${String(leaderboard)}|${String(subject)}|${String(evidence)}`;
}

/**
 * THE pure score submission oracle. Rule order is normative:
 * record authority/validity -> integrity confidence shape -> board
 * registration -> tenant isolation -> season window -> evidence
 * idempotency (replay vs collision) -> stale ordering -> quarantine.
 */
export function adjudicateScoreSubmission(
  submission: ScoreSubmission,
  facts: SubmissionFactsInput,
  policy: LeaderboardServicePolicy,
): ScoreSubmissionAdmission {
  const record = submission.record;
  const validation = validateScoreRecord(record);
  if (!validation.ok) {
    return { accepted: false, code: validation.code, detail: `score record validation refused: ${validation.code}` };
  }
  if (
    typeof submission.integrityConfidence !== "number" ||
    !Number.isFinite(submission.integrityConfidence) ||
    submission.integrityConfidence < 0 ||
    submission.integrityConfidence > 1
  ) {
    return { accepted: false, code: "invalid-integrity-confidence", detail: "integrity confidence must be a number in [0,1]" };
  }
  if (String(record.tenant).length === 0 || String(record.leaderboard).length === 0) {
    return { accepted: false, code: "invalid-tenant", detail: "tenant or leaderboard id text is empty" };
  }
  if (!facts.boardExists) {
    return { accepted: false, code: "board-not-registered", detail: "the leaderboard is not registered in this service" };
  }
  if (facts.boardTenant !== undefined && facts.boardTenant !== record.tenant) {
    return {
      accepted: false,
      code: "cross-tenant-access",
      detail: `board belongs to tenant ${String(facts.boardTenant)}, submission is scoped to ${String(record.tenant)}`,
    };
  }
  if (!facts.withinWindow) {
    return { accepted: false, code: "window-closed", detail: "recordedAt is outside the active season window" };
  }
  if (facts.evidenceSeen) {
    if (facts.recordedScore === record.score) {
      return { accepted: false, code: "duplicate-submission", detail: "evidence digest already recorded (E10: the first receipt stands)" };
    }
    return {
      accepted: false,
      code: "idempotency-collision",
      detail: "evidence digest already recorded with a DIFFERENT score (E8: never a second mutation)",
    };
  }
  if (facts.lastRecordedAt !== undefined && record.recordedAt < facts.lastRecordedAt) {
    return {
      accepted: false,
      code: "stale-submission",
      detail: `recordedAt ${record.recordedAt} predates the subject's last admitted submission at ${facts.lastRecordedAt}`,
    };
  }
  if (submission.integrityConfidence < policy.minIntegrityConfidence) {
    return {
      accepted: false,
      code: "quarantined-low-integrity",
      detail: `integrity confidence ${submission.integrityConfidence} is below the policy bound ${policy.minIntegrityConfidence}`,
    };
  }
  return { accepted: true };
}
