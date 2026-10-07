/**
 * QA ASSERTION-HARNESS CONTRACTS OVER REPLAY RECORDS (R8 refinement,
 * PL-009).
 *
 * Typed EXPECTATION records, not test-runners: this module defines what
 * a QA harness may declare about a replay ({@link ReplayExpectation})
 * and how a recorded outcome of checking that expectation looks
 * ({@link ReplayExpectationResult}) — pure contracts only. No harness
 * executes here; PL-014/PL-019 own replay execution.
 *
 * Honesty discipline (E11): `inconclusive` is a first-class outcome —
 * a harness that could not verify an expectation says so instead of
 * guessing. Every result carries a digest-pinned evidence artifact; a
 * bare claim proves nothing. {@link validateExpectationResult} keeps the
 * chain closed: result -> expectation -> pinned replay digest.
 *
 * Purity: pure types + pure guards + one pure validator. No IO.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { ContentDigest, TenantId } from "./primitives.ts";
import { isValidContentDigest } from "./primitives.ts";
import type { ReplayId } from "./replay.ts";

/** Identifier of one replay expectation. */
export type QaExpectationId = Brand<string, "QaExpectationId">;

/** Parses and validates `text` as a {@link QaExpectationId}. */
export function asQaExpectationId(text: string): QaExpectationId | undefined {
  return isValidIdText(text) ? (text as QaExpectationId) : undefined;
}

/** Identifier of one recorded expectation result. */
export type QaExpectationResultId = Brand<string, "QaExpectationResultId">;

/** Parses and validates `text` as a {@link QaExpectationResultId}. */
export function asQaExpectationResultId(text: string): QaExpectationResultId | undefined {
  return isValidIdText(text) ? (text as QaExpectationResultId) : undefined;
}

// ---------------------------------------------------------------------------
// Expectation vocabulary (frozen)
// ---------------------------------------------------------------------------

/**
 * The expectation kinds a QA harness may declare over a replay:
 * determinism under re-execution, declared event sequences, declared
 * invariants, and reproduction of the authoritative outcome digest.
 */
export type ReplayExpectationKind =
  | "determinism-holds"
  | "event-sequence-matches"
  | "invariant-holds"
  | "outcome-digest-matches";

/** All valid {@link ReplayExpectationKind} values. */
export const REPLAY_EXPECTATION_KINDS: readonly ReplayExpectationKind[] = Object.freeze([
  "determinism-holds",
  "event-sequence-matches",
  "invariant-holds",
  "outcome-digest-matches",
]);

/** Returns true when `value` is a valid {@link ReplayExpectationKind}. */
export function isReplayExpectationKind(value: unknown): value is ReplayExpectationKind {
  return (
    typeof value === "string" &&
    (REPLAY_EXPECTATION_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Expectation records
// ---------------------------------------------------------------------------

/**
 * One QA expectation over ONE pinned replay artifact: the kind of check,
 * plus a digest-pinned opaque parameter block (the kind determines its
 * interpretation — expected sequence document, invariant statement,
 * target outcome digest — never inline contract data).
 */
export interface ReplayExpectation {
  readonly expectationId: QaExpectationId;
  readonly tenant: TenantId;
  readonly replayRef: ReplayId;
  /** Pins the artifact content under test. */
  readonly replayDigest: ContentDigest;
  readonly kind: ReplayExpectationKind;
  /** Digest of the opaque expectation-parameter document. */
  readonly expectationDigest: ContentDigest;
}

/** Returns true when `value` is a structurally valid {@link ReplayExpectation}. */
export function isReplayExpectation(value: unknown): value is ReplayExpectation {
  if (typeof value !== "object" || value === null) return false;
  const expectation = value as Record<string, unknown>;
  if (typeof expectation.expectationId !== "string" || expectation.expectationId.length === 0) {
    return false;
  }
  if (typeof expectation.replayRef !== "string" || expectation.replayRef.length === 0) return false;
  if (!isReplayExpectationKind(expectation.kind)) return false;
  if (typeof expectation.replayDigest !== "string" || !isValidContentDigest(expectation.replayDigest)) {
    return false;
  }
  return (
    typeof expectation.expectationDigest === "string" &&
    isValidContentDigest(expectation.expectationDigest)
  );
}

// ---------------------------------------------------------------------------
// Recorded outcomes
// ---------------------------------------------------------------------------

/** The honest outcome vocabulary: met, not-met, or honestly inconclusive. */
export type ExpectationOutcome = "met" | "not-met" | "inconclusive";

/** All valid {@link ExpectationOutcome} values. */
export const EXPECTATION_OUTCOMES: readonly ExpectationOutcome[] = Object.freeze([
  "met",
  "not-met",
  "inconclusive",
]);

/** Returns true when `value` is a valid {@link ExpectationOutcome}. */
export function isExpectationOutcome(value: unknown): value is ExpectationOutcome {
  return typeof value === "string" && (EXPECTATION_OUTCOMES as readonly string[]).includes(value);
}

/**
 * One recorded outcome of checking an expectation. The evidence digest
 * is MANDATORY for every outcome — including `inconclusive`, which must
 * pin what was attempted and why it could not verify (E11: external
 * limitations are represented truthfully). Recorded only by the
 * platform authority.
 */
export interface ReplayExpectationResult {
  readonly resultId: QaExpectationResultId;
  readonly expectationRef: QaExpectationId;
  readonly tenant: TenantId;
  /** Must equal the expectation's pinned replay digest (defense in depth). */
  readonly replayDigest: ContentDigest;
  readonly outcome: ExpectationOutcome;
  /** Digest of the evidence artifact backing the outcome. Never empty. */
  readonly evidenceDigest: ContentDigest;
  readonly decidedBy: "platform-authority";
}

/** Returns true when `value` is a structurally valid {@link ReplayExpectationResult}. */
export function isReplayExpectationResult(value: unknown): value is ReplayExpectationResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  if (typeof result.resultId !== "string" || result.resultId.length === 0) return false;
  if (typeof result.expectationRef !== "string" || result.expectationRef.length === 0) return false;
  if (!isExpectationOutcome(result.outcome)) return false;
  if (typeof result.replayDigest !== "string" || !isValidContentDigest(result.replayDigest)) {
    return false;
  }
  if (typeof result.evidenceDigest !== "string" || !isValidContentDigest(result.evidenceDigest)) {
    return false;
  }
  return result.decidedBy === "platform-authority";
}

// ---------------------------------------------------------------------------
// Chain validation
// ---------------------------------------------------------------------------

/** Result of {@link validateExpectationResult}. */
export type ExpectationResultValidation =
  | { readonly ok: true; readonly outcome: ExpectationOutcome }
  | {
      readonly ok: false;
      readonly code:
        | "malformed-expectation"
        | "malformed-result"
        | "expectation-ref-mismatch"
        | "tenant-mismatch"
        | "replay-mismatch";
    };

/**
 * Pure chain validator: the result must be structurally sound, reference
 * THIS expectation (`expectation-ref-mismatch`), belong to the same
 * tenant (`tenant-mismatch`), and pin the SAME replay digest the
 * expectation pins (`replay-mismatch` — a result may never quietly
 * attach to different artifact content than its expectation).
 */
export function validateExpectationResult(
  result: unknown,
  expectation: ReplayExpectation,
): ExpectationResultValidation {
  if (!isReplayExpectationResult(result)) return { ok: false, code: "malformed-result" };
  if (result.expectationRef !== expectation.expectationId) {
    return { ok: false, code: "expectation-ref-mismatch" };
  }
  if (result.tenant !== expectation.tenant) return { ok: false, code: "tenant-mismatch" };
  if (result.replayDigest !== expectation.replayDigest) {
    return { ok: false, code: "replay-mismatch" };
  }
  return { ok: true, outcome: result.outcome };
}
