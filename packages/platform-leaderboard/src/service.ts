/**
 * THE LEADERBOARD SERVICE — the ranking authority (PL-015; matrix row
 * `leaderboard | Platform | platform-contracts`).
 *
 * The service instance is the single mutable-state owner (E1): board
 * definitions, active seasons, frozen season archives, per-subject
 * entries, submission receipts and the evidence registry. THE platform
 * ranks: queries materialize `LeaderboardEntry` rows and rank them with
 * platform-contracts' `rankLeaderboardEntries` — never with local sort
 * logic (lock 18: games do not rank players).
 *
 * Async/stateful discipline (spec/worker-contract.md) — every item
 * owned and tested:
 *
 * - MUTABLE STATE OWNER: this instance. Persistence ONLY through the
 *   LeaderboardStore port (snapshots), time through ServiceClock,
 *   grants through GrantDirectory.
 * - COMMAND ADMISSION: every door runs actor least privilege first
 *   (`checkLeastPrivilege`: submit/administer/read on "leaderboard",
 *   R20), then derives facts from OWNED state and applies the pure
 *   oracle (`adjudicateScoreSubmission`, binding `validateScoreRecord`).
 * - EVENT ORDER: receipts append in admission order; the entry update
 *   and the receipt are one atomic step; revision advances 1:1.
 * - IDEMPOTENCY KEY: `(tenant, leaderboard, subject, evidence)`. A
 *   replay returns the recorded receipt (E10); the same key with a
 *   different score is an `idempotency-collision` refusal (E8).
 * - STALE-RESULT RULE: a submission older than the subject's last
 *   admitted one is refused (`stale-submission`, E8); queries always
 *   reflect the newest admitted state.
 * - REPLAY/RESUME BOUNDARY: `snapshot()` persists a content-addressed
 *   checkpoint (document.ts); `restore()` re-adopts it whole. Frozen
 *   seasons are immutable read models forever (E10).
 * - RETRY/CANCELLATION: rejected submissions are not recorded (a
 *   corrected retry is a fresh encounter); replays return receipts.
 *   Synchronous domain — nothing to cancel.
 */

import { checkLeastPrivilege, isLeaderboardQueryRequest, rankLeaderboardEntries } from "@playliquid/platform-contracts";
import type {
  CapabilityPermission,
  ContentDigest,
  LeaderboardEntry,
  LeaderboardId,
  LeaderboardPage,
  LeaderboardQueryRequest,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import { canonicalJson, digestOf } from "./digest.ts";
import { aggregateEntry, nextSeason, unboundedSeason, windowContains } from "./boards.ts";
import type { BoardSubjectEntry, LeaderboardBoardDefinition, SeasonWindow } from "./boards.ts";
import { adjudicateScoreSubmission, submissionIdempotencyKey } from "./submission.ts";
import type { ScoreSubmission } from "./submission.ts";
import type { GrantDirectory, LeaderboardStore, ServiceClock } from "./ports.ts";
import { isLeaderboardStateDocument } from "./ports.ts";
import { archivesOf, documentOf, toArchive } from "./document.ts";
import type { BoardArchive, BoardState, SubmissionReceipt } from "./document.ts";

/** Construction options. */
export interface LeaderboardServiceOptions {
  readonly store: LeaderboardStore;
  readonly clock: ServiceClock;
  readonly grants: GrantDirectory;
}

/** Submission result: admission plus the receipt, or the recorded one. */
export type SubmitScoreResult =
  | { readonly accepted: true; readonly receipt: SubmissionReceipt }
  | { readonly accepted: false; readonly code: string; readonly detail: string; readonly recorded?: SubmissionReceipt };

/** Generic refusal result for board administration and queries. */
export type LeaderboardRefusal = { readonly ok: false; readonly code: string; readonly detail: string };

/** Result of a board registration. */
export type RegisterBoardResult = { readonly ok: true; readonly season: SeasonWindow } | LeaderboardRefusal;

/** Result of a season advance. */
export type AdvanceSeasonResult =
  | { readonly ok: true; readonly frozen: SeasonWindow; readonly next: SeasonWindow }
  | LeaderboardRefusal;

/** Result of snapshot/restore. */
export type SnapshotResult =
  | { readonly ok: true; readonly snapshotId: ContentDigest; readonly revision: number }
  | LeaderboardRefusal;

/** The leaderboard authority. Construct, then register boards. */
export class LeaderboardService {
  private readonly clock: ServiceClock;
  private readonly grants: GrantDirectory;
  private readonly store: LeaderboardStore;
  private readonly boards = new Map<string, BoardState>();
  private revision = 0;
  private lastPrivilegeCode = "capability-not-granted";

  constructor(options: LeaderboardServiceOptions) {
    this.store = options.store;
    this.clock = options.clock;
    this.grants = options.grants;
  }

  // -----------------------------------------------------------------------
  // Board administration (administer permission, R20)
  // -----------------------------------------------------------------------

  /** Register one board; "never"-cadence boards get an unbounded season. */
  registerBoard(actor: SubjectId, definition: LeaderboardBoardDefinition, firstSeason?: SeasonWindow): RegisterBoardResult {
    if (!this.requirePrivilege(actor, definition.tenant, "administer")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const key = boardKey(definition.tenant, definition.leaderboard);
    if (this.boards.has(key)) {
      return { ok: false, code: "board-already-registered", detail: "the leaderboard is already registered" };
    }
    const season = definition.policy.resetCadence === "never" ? unboundedSeason(0 as TimestampMs) : (firstSeason ?? unboundedSeason(0 as TimestampMs));
    this.boards.set(key, {
      definition,
      currentSeason: season,
      frozenSeasons: [],
      entries: new Map(),
      frozenEntries: new Map(),
      receipts: [],
      evidence: new Map(),
    });
    this.revision += 1;
    return { ok: true, season };
  }

  /** Advance to the next season; the current one freezes forever (E10). */
  advanceSeason(actor: SubjectId, tenant: TenantId, leaderboard: LeaderboardId, seasonId: string, startsAt: TimestampMs, durationMs: number): AdvanceSeasonResult {
    if (!this.requirePrivilege(actor, tenant, "administer")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const board = this.boards.get(boardKey(tenant, leaderboard));
    if (board === undefined) {
      return { ok: false, code: "board-not-registered", detail: "the leaderboard is not registered" };
    }
    const next = nextSeason(board.currentSeason, seasonId, startsAt, durationMs);
    if (next === undefined) {
      return { ok: false, code: "invalid-season-window", detail: "season window does not advance past the current one, or the id is malformed/reused" };
    }
    board.frozenSeasons.push(board.currentSeason);
    board.frozenEntries.set(board.currentSeason.seasonId, board.entries);
    board.entries = new Map();
    board.currentSeason = next;
    this.revision += 1;
    return { ok: true, frozen: board.frozenSeasons[board.frozenSeasons.length - 1]!, next };
  }

  // -----------------------------------------------------------------------
  // Score submission (submit permission, idempotent, E10)
  // -----------------------------------------------------------------------

  /** Submit one authoritative score record through the full pipeline. */
  submitScore(actor: SubjectId, submission: ScoreSubmission): SubmitScoreResult {
    const record = submission.record;
    if (!this.requirePrivilege(actor, record.tenant, "submit")) {
      return { accepted: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const board = this.boards.get(boardKey(record.tenant, record.leaderboard));
    const idempotency = submissionIdempotencyKey(record.tenant, record.leaderboard, record.subject, record.evidence);
    const seen = board?.evidence.get(idempotency);
    const admission = adjudicateScoreSubmission(
      submission,
      {
        boardExists: board !== undefined,
        boardTenant: board?.definition.tenant,
        withinWindow: board === undefined ? false : windowContains(board.currentSeason, record.recordedAt),
        lastRecordedAt: board?.entries.get(String(record.subject))?.lastRecordedAt,
        evidenceSeen: seen !== undefined,
        recordedScore: seen?.score,
        currentEntry: board?.entries.get(String(record.subject)),
      },
      board?.definition.policy ?? {
        tieBreaking: "first-achieved" as const,
        resetCadence: "never" as const,
        entryVisibility: "public" as const,
        minIntegrityConfidence: 0,
      },
    );
    if (!admission.accepted) {
      if (admission.code === "duplicate-submission" && board !== undefined && seen !== undefined) {
        const recorded = board.receipts.find((receipt) => receipt.receiptId === seen.receiptId);
        return { accepted: false, code: admission.code, detail: admission.detail, recorded };
      }
      return admission;
    }
    const now = this.clock.now();
    const updated = aggregateEntry(
      board!.definition.aggregation,
      record.subject,
      board!.entries.get(String(record.subject)),
      record.score,
      record.recordedAt,
      record.evidence,
      submission.integrityConfidence,
    );
    board!.entries.set(String(record.subject), updated);
    const receipt: SubmissionReceipt = {
      receiptId: `${idempotency}:${now}:${this.revision}`,
      tenant: record.tenant,
      leaderboard: record.leaderboard,
      subject: record.subject,
      score: record.score,
      recordedAt: record.recordedAt,
      evidence: record.evidence,
      admittedAt: now,
      rankAfter: this.rankOfSubjectIn(board!, record.subject),
      seasonId: board!.currentSeason.seasonId,
      decidedBy: "platform-authority",
    };
    board!.receipts.push(receipt);
    board!.evidence.set(idempotency, { receiptId: receipt.receiptId, score: record.score });
    this.revision += 1;
    return { accepted: true, receipt };
  }

  // -----------------------------------------------------------------------
  // Queries (read permission; THE platform ranking oracle)
  // -----------------------------------------------------------------------

  /** Query one board page (platform-contracts request/response shapes). */
  query(actor: SubjectId, request: LeaderboardQueryRequest): LeaderboardPage | LeaderboardRefusal {
    if (!isLeaderboardQueryRequest(request)) {
      return { ok: false, code: "malformed-query", detail: "request is not a valid LeaderboardQueryRequest" };
    }
    const board = this.boards.get(boardKey(request.tenant, request.leaderboard));
    if (board === undefined) {
      return { ok: false, code: "board-not-registered", detail: "the leaderboard is not registered" };
    }
    if (!this.requirePrivilege(actor, request.tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const ranked = this.rankedEntriesOf(board);
    const sliced = ranked.slice(request.window.offset, request.window.offset + request.window.limit);
    return { leaderboard: request.leaderboard, entries: sliced, totalEntries: ranked.length };
  }

  /** One subject's current rank and entry in the active season. */
  subjectRank(actor: SubjectId, tenant: TenantId, leaderboard: LeaderboardId, subject: SubjectId): { readonly rank: number; readonly entry: BoardSubjectEntry } | LeaderboardRefusal {
    const board = this.boards.get(boardKey(tenant, leaderboard));
    if (board === undefined) {
      return { ok: false, code: "board-not-registered", detail: "the leaderboard is not registered" };
    }
    if (!this.requirePrivilege(actor, tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const entry = board.entries.get(String(subject));
    if (entry === undefined) {
      return { ok: false, code: "unknown-subject", detail: "the subject has no entry in the active season" };
    }
    return { rank: this.rankOfSubjectIn(board, subject), entry: { ...entry } };
  }

  /** The immutable frozen board of one past season (E10). */
  seasonBoard(actor: SubjectId, tenant: TenantId, leaderboard: LeaderboardId, seasonId: string): { readonly season: SeasonWindow; readonly entries: readonly BoardSubjectEntry[] } | LeaderboardRefusal {
    const board = this.boards.get(boardKey(tenant, leaderboard));
    if (board === undefined) {
      return { ok: false, code: "board-not-registered", detail: "the leaderboard is not registered" };
    }
    if (!this.requirePrivilege(actor, tenant, "read")) {
      return { ok: false, code: this.lastPrivilegeCode, detail: `least-privilege refusal: ${this.lastPrivilegeCode}` };
    }
    const season = board.frozenSeasons.find((candidate) => candidate.seasonId === seasonId);
    const entries = board.frozenEntries.get(seasonId);
    if (season === undefined || entries === undefined) {
      return { ok: false, code: "unknown-season", detail: "the season is not a frozen season of this board" };
    }
    return { season, entries: [...entries.values()].map((entry) => ({ ...entry })) };
  }

  /** The append-only submission history (E10), tenant/board-scoped. */
  history(tenant: TenantId, leaderboard?: LeaderboardId): readonly SubmissionReceipt[] {
    const receipts: SubmissionReceipt[] = [];
    for (const board of this.boards.values()) {
      if (board.definition.tenant !== tenant) continue;
      if (leaderboard !== undefined && board.definition.leaderboard !== leaderboard) continue;
      receipts.push(...board.receipts);
    }
    return receipts.map((receipt) => ({ ...receipt }));
  }

  // -----------------------------------------------------------------------
  // Snapshot / restore
  // -----------------------------------------------------------------------

  /** Persist a byte-stable, content-addressed checkpoint of all state. */
  snapshot(): SnapshotResult {
    if (this.boards.size === 0) {
      return { ok: false, code: "empty-state", detail: "nothing to snapshot" };
    }
    const document = canonicalJson(documentOf([...this.boards.values()].map(toArchive), this.revision));
    const snapshotId = digestOf(document);
    this.store.save({ snapshotId, revision: this.revision, document });
    return { ok: true, snapshotId, revision: this.revision };
  }

  /** Re-adopt a stored snapshot document (whole-document, no partial apply). */
  restore(snapshotId?: ContentDigest): SnapshotResult {
    const stored = snapshotId === undefined ? this.store.list().at(-1) : this.store.load(snapshotId);
    if (stored === undefined) {
      return { ok: false, code: "unknown-snapshot", detail: "no stored snapshot to restore" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored.document);
    } catch {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not valid JSON" };
    }
    if (!isLeaderboardStateDocument(parsed)) {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not a leaderboard state document" };
    }
    this.adoptArchives(archivesOf(parsed));
    return { ok: true, snapshotId: stored.snapshotId, revision: stored.revision };
  }

  // -----------------------------------------------------------------------
  // Internals: ranking + privilege + archive conversion
  // -----------------------------------------------------------------------

  private requirePrivilege(actor: SubjectId, tenant: TenantId, permission: CapabilityPermission): boolean {
    const decision = checkLeastPrivilege({ tenant, subject: actor, capability: "leaderboard", permission }, this.grants.grants());
    if (decision.ok) return true;
    this.lastPrivilegeCode = decision.code;
    return false;
  }

  /** Deterministic pre-order (by subject id) then THE contracts ranking oracle. */
  private rankedEntriesOf(board: BoardState): readonly LeaderboardEntry[] {
    const entries = [...board.entries.values()]
      .sort((a, b) => String(a.subject).localeCompare(String(b.subject)))
      .map((entry): LeaderboardEntry => ({
        tenant: board.definition.tenant,
        leaderboard: board.definition.leaderboard,
        subject: entry.subject,
        rank: 0,
        score: entry.score,
        achievedAt: entry.achievedAt,
        integrityConfidence: entry.lastIntegrityConfidence,
      }));
    return rankLeaderboardEntries(entries, board.definition.ordering, board.definition.policy.tieBreaking);
  }

  private rankOfSubjectIn(board: BoardState, subject: SubjectId): number {
    return this.rankedEntriesOf(board).find((entry) => entry.subject === subject)?.rank ?? 0;
  }

  private adoptArchives(archives: readonly BoardArchive[]): void {
    this.boards.clear();
    for (const archive of archives) {
      const key = boardKey(archive.definition.tenant, archive.definition.leaderboard);
      this.boards.set(key, {
        definition: archive.definition,
        currentSeason: archive.currentSeason,
        frozenSeasons: [...archive.frozenSeasons],
        entries: new Map(archive.entries.map((entry) => [String(entry.subject), entry])),
        frozenEntries: new Map(archive.frozenEntries.map((frozen) => [frozen.seasonId, new Map(frozen.entries.map((entry) => [String(entry.subject), entry]))])),
        receipts: [...archive.receipts],
        evidence: new Map(archive.evidence.map((seen) => [seen.key, { receiptId: seen.receiptId, score: seen.score }])),
      });
    }
    this.revision = 0;
  }
}

function boardKey(tenant: TenantId, leaderboard: LeaderboardId): string {
  return `${String(tenant)}|${String(leaderboard)}`;
}
