/**
 * LEADERBOARD BOARDS + SEASONS (PL-015).
 *
 * Board definitions bind the platform-contracts shapes
 * (`LeaderboardServicePolicy`, `LeaderboardOrdering`, and the game-side
 * `LeaderboardEventBinding` aggregation vocabulary: latest/sum/max) into
 * the platform-side board state. Boards are WINDOWED: every board has
 * exactly one active season; a season advance FREEZES the previous
 * season's entries forever (E10 — frozen boards are immutable read
 * models, never rewritten).
 *
 * Purity: types + pure window/aggregation functions. No IO.
 */

import type {
  LeaderboardId,
  LeaderboardOrdering,
  LeaderboardServicePolicy,
  SubjectId,
  TenantId,
  TimestampMs,
  ContentDigest,
} from "@playliquid/platform-contracts";

/** Sentinel end for `resetCadence: "never"` boards: one unbounded season. */
export const UNBOUNDED_SEASON_END = 9_007_199_254_740_991;

/** How a metric aggregates successive submissions (mirrors the binding). */
export type ScoreAggregation = "latest" | "sum" | "max";

/** A platform board definition: policy + metric + ordering + aggregation. */
export interface LeaderboardBoardDefinition {
  readonly tenant: TenantId;
  readonly leaderboard: LeaderboardId;
  readonly metric: string;
  readonly aggregation: ScoreAggregation;
  readonly ordering: LeaderboardOrdering;
  readonly policy: LeaderboardServicePolicy;
}

/** Returns true when `value` is a structurally valid {@link LeaderboardBoardDefinition}. */
export function isLeaderboardBoardDefinition(value: unknown): value is LeaderboardBoardDefinition {
  if (typeof value !== "object" || value === null) return false;
  const definition = value as Record<string, unknown>;
  return (
    typeof definition.tenant === "string" &&
    definition.tenant.length > 0 &&
    typeof definition.leaderboard === "string" &&
    definition.leaderboard.length > 0 &&
    typeof definition.metric === "string" &&
    definition.metric.length > 0 &&
    (definition.aggregation === "latest" || definition.aggregation === "sum" || definition.aggregation === "max") &&
    (definition.ordering === "ascending" || definition.ordering === "descending")
  );
}

// ---------------------------------------------------------------------------
// Season windows
// ---------------------------------------------------------------------------

/** One season window: `[startsAt, endsAt)` in caller-supplied time. */
export interface SeasonWindow {
  readonly seasonId: string;
  readonly startsAt: TimestampMs;
  readonly endsAt: TimestampMs;
}

/** Season id text: 1..64 chars of the platform id grammar. */
export function isValidSeasonIdText(text: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(text);
}

/** Returns true when `value` is a structurally valid {@link SeasonWindow}. */
export function isSeasonWindow(value: unknown): value is SeasonWindow {
  if (typeof value !== "object" || value === null) return false;
  const window = value as Record<string, unknown>;
  return (
    typeof window.seasonId === "string" &&
    isValidSeasonIdText(window.seasonId) &&
    typeof window.startsAt === "number" &&
    Number.isSafeInteger(window.startsAt) &&
    window.startsAt >= 0 &&
    typeof window.endsAt === "number" &&
    Number.isSafeInteger(window.endsAt) &&
    window.endsAt > window.startsAt
  );
}

/** Pure window containment: `[startsAt, endsAt)`. */
export function windowContains(window: SeasonWindow, at: TimestampMs): boolean {
  return at >= window.startsAt && at < window.endsAt;
}

/**
 * Derive the next season window after `current`. Refuses non-advancing
 * windows (`startsAt` before the current end would overlap) and ids that
 * were already used — a season can only ever be entered once (E10).
 */
export function nextSeason(
  current: SeasonWindow | undefined,
  seasonId: string,
  startsAt: TimestampMs,
  durationMs: number,
): SeasonWindow | undefined {
  if (!isValidSeasonIdText(seasonId)) return undefined;
  if (!Number.isSafeInteger(startsAt) || startsAt < 0) return undefined;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) return undefined;
  if (current !== undefined) {
    if (startsAt < current.endsAt) return undefined;
    if (seasonId === current.seasonId) return undefined;
  }
  return { seasonId, startsAt, endsAt: (startsAt + durationMs) as TimestampMs };
}

/** The default unbounded season for `resetCadence: "never"` boards. */
export function unboundedSeason(startsAt: TimestampMs): SeasonWindow {
  return { seasonId: "all-time", startsAt, endsAt: UNBOUNDED_SEASON_END as TimestampMs };
}

// ---------------------------------------------------------------------------
// Per-subject entry state + aggregation
// ---------------------------------------------------------------------------

/** One subject's aggregated entry within one season. */
export interface BoardSubjectEntry {
  readonly subject: SubjectId;
  readonly score: number;
  /** When the current score was achieved (deterministic tie-breaking input). */
  readonly achievedAt: TimestampMs;
  readonly submissions: number;
  readonly lastEvidence: ContentDigest;
  readonly lastRecordedAt: TimestampMs;
  readonly lastIntegrityConfidence: number;
}

/**
 * Pure aggregation fold: how one admissible submission updates a
 * subject's entry.
 * - `latest`: the score becomes the submitted value.
 * - `sum`: the score accumulates.
 * - `max`: the score only rises; `achievedAt` pins to the submission
 *   that set the running maximum (deterministic).
 */
export function aggregateEntry(
  aggregation: ScoreAggregation,
  subject: SubjectId,
  current: BoardSubjectEntry | undefined,
  score: number,
  recordedAt: TimestampMs,
  evidence: ContentDigest,
  integrityConfidence: number,
): BoardSubjectEntry {
  const submissions = (current?.submissions ?? 0) + 1;
  if (aggregation === "latest" || current === undefined) {
    return { subject, score, achievedAt: recordedAt, submissions, lastEvidence: evidence, lastRecordedAt: recordedAt, lastIntegrityConfidence: integrityConfidence };
  }
  if (aggregation === "sum") {
    return { ...current, score: current.score + score, achievedAt: recordedAt, submissions, lastEvidence: evidence, lastRecordedAt: recordedAt, lastIntegrityConfidence: integrityConfidence };
  }
  if (score > current.score) {
    return { ...current, score, achievedAt: recordedAt, submissions, lastEvidence: evidence, lastRecordedAt: recordedAt, lastIntegrityConfidence: integrityConfidence };
  }
  return { ...current, submissions, lastEvidence: evidence, lastRecordedAt: recordedAt, lastIntegrityConfidence: integrityConfidence };
}
