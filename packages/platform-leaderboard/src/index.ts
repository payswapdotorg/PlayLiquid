/**
 * @playliquid/platform-leaderboard — public surface (PL-015).
 *
 * The leaderboard AUTHORITY service: ranked score submission with
 * evidence-keyed idempotency, windowed/seasonal boards, deterministic
 * tie-breaking and anti-gaming refusals, implemented over
 * `@playliquid/platform-contracts` per spec/module-dependency-matrix.md
 * row `leaderboard | Platform | platform-contracts`.
 *
 * Module map:
 * - digest.ts      pure SHA-256 + byte-stable canonical JSON (E9)
 * - boards.ts       board definitions, season windows, aggregation fold
 * - submission.ts   the pure submission admission oracle
 * - ports.ts        store, clock, grant directory ports
 * - document.ts     snapshot document (de)serialization
 * - service.ts      the leaderboard service (the mutable-state owner)
 * - fakes.ts        deterministic in-memory fakes for tests/harness
 *
 * Purity: the domain has no IO, no timers, no globals; every effect
 * lives behind a port. The service instance is the single
 * mutable-state owner.
 */

// Values
export { canonicalJson, sha256Hex, digestOf } from "./digest.ts";
export {
  UNBOUNDED_SEASON_END,
  isValidSeasonIdText,
  isLeaderboardBoardDefinition,
  isSeasonWindow,
  windowContains,
  nextSeason,
  unboundedSeason,
  aggregateEntry,
} from "./boards.ts";
export { submissionIdempotencyKey, adjudicateScoreSubmission } from "./submission.ts";
export { isLeaderboardStateDocument } from "./ports.ts";
export { documentOf, archivesOf } from "./document.ts";
export { LeaderboardService } from "./service.ts";
export {
  createMemoryLeaderboardStore,
  createFixedClock,
  createMemoryGrantDirectory,
  leaderboardAdminGrant,
  leaderboardSubmitGrant,
} from "./fakes.ts";

// Types — boards
export type {
  ScoreAggregation,
  LeaderboardBoardDefinition,
  SeasonWindow,
  BoardSubjectEntry,
} from "./boards.ts";
// Types — submission
export type {
  ScoreSubmission,
  SubmissionFactsInput,
  LeaderboardRefusalCode,
  ScoreSubmissionAdmission,
} from "./submission.ts";
// Types — ports
export type {
  BoardRow,
  EntryRow,
  LeaderboardStateDocument,
  StoredLeaderboardSnapshot,
  LeaderboardStore,
  ServiceClock,
  GrantDirectory,
} from "./ports.ts";
// Types — document
export type { BoardArchive, BoardState, SubmissionReceipt } from "./document.ts";
// Types — service
export type {
  LeaderboardServiceOptions,
  SubmitScoreResult,
  LeaderboardRefusal,
  RegisterBoardResult,
  AdvanceSeasonResult,
  SnapshotResult,
} from "./service.ts";
