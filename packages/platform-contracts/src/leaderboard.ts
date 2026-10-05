/**
 * LEADERBOARD SERVICE CONTRACTS (R7 / lock rule 17).
 *
 * The leaderboard is a PLATFORM capability: the platform service owns
 * ranking, score admission and entry visibility. Games declare which of
 * their semantic events feed which metric ({@link LeaderboardEventBinding},
 * lock 18) and the display policy; they never rank players themselves and
 * never submit scores on a client's word.
 *
 * Authority split (lock 19/41, R9):
 * - {@link AuthoritativeScoreRecord} — the only admissible score source:
 *   decided by the platform authority marker, carrying content-addressed
 *   evidence and the game event that produced it.
 * - {@link ClientScoreClaim} — what an untrusted client asserts; it
 *   carries the {@link UntrustedClientInput} marker and is never
 *   assignable to the authoritative shape (type-misuse test).
 *
 * Purity: pure types + pure guards + a pure ranking oracle
 * ({@link rankLeaderboardEntries}). No IO, no storage.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { SubjectId, TenantId, ContentDigest, TimestampMs } from "./primitives.ts";
import { asContentDigest, isPlatformAuthorityMarker } from "./primitives.ts";
import type { UntrustedClientInput, GameEventKind } from "./events.ts";

/** Identifier of one leaderboard definition within a game. */
export type LeaderboardId = Brand<string, "LeaderboardId">;

/** Parses and validates `text` as a {@link LeaderboardId}. */
export function asLeaderboardId(text: string): LeaderboardId | undefined {
  return isValidIdText(text) ? (text as LeaderboardId) : undefined;
}

// ---------------------------------------------------------------------------
// Service policy (platform-side behavior, distinct from the game's
// game-contracts `LeaderboardPolicy` declaration)
// ---------------------------------------------------------------------------

/** Platform leaderboard behavior descriptor. */
export interface LeaderboardServicePolicy {
  readonly tieBreaking: "first-achieved" | "shared";
  readonly resetCadence: "never" | "daily" | "weekly" | "seasonal";
  readonly entryVisibility: "public" | "social" | "private";
  /** Entries with integrity confidence below this bound are quarantined (R11). */
  readonly minIntegrityConfidence: number;
}

/** Returns true when `value` is a structurally valid {@link LeaderboardServicePolicy}. */
export function isLeaderboardServicePolicy(value: unknown): value is LeaderboardServicePolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    (policy.tieBreaking === "first-achieved" || policy.tieBreaking === "shared") &&
    (policy.resetCadence === "never" ||
      policy.resetCadence === "daily" ||
      policy.resetCadence === "weekly" ||
      policy.resetCadence === "seasonal") &&
    (policy.entryVisibility === "public" || policy.entryVisibility === "social" || policy.entryVisibility === "private") &&
    typeof policy.minIntegrityConfidence === "number" &&
    policy.minIntegrityConfidence >= 0 &&
    policy.minIntegrityConfidence <= 1
  );
}

// ---------------------------------------------------------------------------
// Game-side event binding (lock 18)
// ---------------------------------------------------------------------------

/**
 * How a game binds one of ITS declared events to a leaderboard metric.
 * The platform aggregates; the game only points at semantics.
 */
export interface LeaderboardEventBinding {
  readonly capability: "leaderboard";
  readonly eventKind: GameEventKind;
  readonly metric: string;
  readonly aggregation: "latest" | "sum" | "max";
}

/** Returns true when `value` is a structurally valid {@link LeaderboardEventBinding}. */
export function isLeaderboardEventBinding(value: unknown): value is LeaderboardEventBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return (
    binding.capability === "leaderboard" &&
    typeof binding.eventKind === "string" &&
    binding.eventKind.length > 0 &&
    typeof binding.metric === "string" &&
    binding.metric.length > 0 &&
    (binding.aggregation === "latest" || binding.aggregation === "sum" || binding.aggregation === "max")
  );
}

// ---------------------------------------------------------------------------
// Score admission (authority split)
// ---------------------------------------------------------------------------

/** The only admissible score source: platform-decided, evidence-backed. */
export interface AuthoritativeScoreRecord {
  readonly tenant: TenantId;
  readonly leaderboard: LeaderboardId;
  readonly subject: SubjectId;
  readonly score: number;
  readonly recordedAt: TimestampMs;
  readonly sourceEventKind: GameEventKind;
  readonly evidence: ContentDigest;
  readonly decidedBy: "platform-authority";
}

/** What an untrusted client asserts a score is. Never admissible. */
export interface ClientScoreClaim {
  readonly leaderboard: LeaderboardId;
  readonly claimedScore: number;
  readonly untrusted: UntrustedClientInput["untrusted"];
}

/** Result of score-record validation. */
export type ScoreRecordValidation =
  | { readonly ok: true; readonly subject: SubjectId }
  | {
      readonly ok: false;
      readonly code: "not-authoritative" | "missing-evidence" | "invalid-score" | "malformed-record";
    };

/**
 * Pure validation of a score record against the authority invariants.
 * Rejects: client-shaped records (untrusted marker -> `not-authoritative`,
 * E8), records without a valid evidence digest (`missing-evidence`),
 * non-finite or negative scores (`invalid-score`), and structurally
 * malformed input (`malformed-record`).
 */
export function validateScoreRecord(value: unknown): ScoreRecordValidation {
  if (typeof value !== "object" || value === null) return { ok: false, code: "malformed-record" };
  const record = value as Record<string, unknown>;
  if (record.untrusted === "untrusted-client-input") return { ok: false, code: "not-authoritative" };
  if (!isPlatformAuthorityMarker(record.decidedBy)) return { ok: false, code: "not-authoritative" };
  if (typeof record.evidence !== "string" || !asContentDigest(record.evidence)) {
    return { ok: false, code: "missing-evidence" };
  }
  if (typeof record.score !== "number" || !Number.isFinite(record.score) || record.score < 0) {
    return { ok: false, code: "invalid-score" };
  }
  if (typeof record.subject !== "string" || record.subject.length === 0) {
    return { ok: false, code: "malformed-record" };
  }
  return { ok: true, subject: record.subject as SubjectId };
}

// ---------------------------------------------------------------------------
// Queries and ranking (platform-owned)
// ---------------------------------------------------------------------------

/** A page request into a leaderboard. */
export interface LeaderboardQueryRequest {
  readonly tenant: TenantId;
  readonly leaderboard: LeaderboardId;
  readonly window: { readonly offset: number; readonly limit: number };
}

/** Returns true when `value` is a structurally valid {@link LeaderboardQueryRequest}. */
export function isLeaderboardQueryRequest(value: unknown): value is LeaderboardQueryRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  if (typeof request.leaderboard !== "string" || request.leaderboard.length === 0) return false;
  const window = request.window as Record<string, unknown> | undefined;
  if (typeof window !== "object" || window === null) return false;
  return (
    typeof window.offset === "number" &&
    Number.isInteger(window.offset) &&
    window.offset >= 0 &&
    typeof window.limit === "number" &&
    Number.isInteger(window.limit) &&
    window.limit >= 1 &&
    window.limit <= 100
  );
}

/** One materialized leaderboard row. */
export interface LeaderboardEntry {
  readonly tenant: TenantId;
  readonly leaderboard: LeaderboardId;
  readonly subject: SubjectId;
  readonly rank: number;
  readonly score: number;
  readonly achievedAt: TimestampMs;
  readonly integrityConfidence: number;
}

/** A materialized page of leaderboard rows. */
export interface LeaderboardPage {
  readonly leaderboard: LeaderboardId;
  readonly entries: readonly LeaderboardEntry[];
  readonly totalEntries: number;
}

/** Ordering direction a game declares for a metric (mirrors game-contracts). */
export type LeaderboardOrdering = "ascending" | "descending";

/**
 * Pure ranking oracle: the PLATFORM ranks, games do not. Sorts entries by
 * score under the declared ordering, breaks ties per the service policy
 * (`first-achieved`: earlier `achievedAt` wins; `shared`: equal ranks),
 * and assigns 1-based ranks. Input order is never trusted as rank order.
 */
export function rankLeaderboardEntries(
  entries: readonly LeaderboardEntry[],
  ordering: LeaderboardOrdering,
  tieBreaking: LeaderboardServicePolicy["tieBreaking"],
): readonly LeaderboardEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const byScore = ordering === "ascending" ? a.score - b.score : b.score - a.score;
    if (byScore !== 0) return byScore;
    return tieBreaking === "first-achieved" ? a.achievedAt - b.achievedAt : 0;
  });
  let lastScore: number | undefined;
  let lastRank = 0;
  return sorted.map((entry, index) => {
    const position = index + 1;
    if (tieBreaking === "shared" && lastScore !== undefined && entry.score === lastScore) {
      return { ...entry, rank: lastRank };
    }
    lastScore = entry.score;
    lastRank = position;
    return { ...entry, rank: position };
  });
}
