/**
 * SNAPSHOT DOCUMENT (DE)SERIALIZATION for the leaderboard service —
 * split out of service.ts for the 400-line ceiling (the
 * platform-multiplayer `document.ts` precedent). Pure conversions
 * between the service's in-memory board state and the serializable
 * {@link LeaderboardStateDocument}; no IO, no mutation of inputs.
 */

import type {
  ContentDigest,
  LeaderboardId,
  LeaderboardServicePolicy,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import type { BoardSubjectEntry, LeaderboardBoardDefinition, SeasonWindow } from "./boards.ts";
import type { LeaderboardStateDocument } from "./ports.ts";

/** One immutable submission receipt (E10). */
export interface SubmissionReceipt {
  readonly receiptId: string;
  readonly tenant: TenantId;
  readonly leaderboard: LeaderboardId;
  readonly subject: SubjectId;
  readonly score: number;
  readonly recordedAt: TimestampMs;
  readonly evidence: ContentDigest;
  readonly admittedAt: TimestampMs;
  readonly rankAfter: number;
  readonly seasonId: string;
  readonly decidedBy: "platform-authority";
}

/** The service-owned board state shape (the service instance owns the instances, E1). */
export interface BoardState {
  definition: LeaderboardBoardDefinition;
  currentSeason: SeasonWindow;
  frozenSeasons: SeasonWindow[];
  entries: Map<string, BoardSubjectEntry>;
  frozenEntries: Map<string, Map<string, BoardSubjectEntry>>;
  receipts: SubmissionReceipt[];
  evidence: Map<string, { receiptId: string; score: number }>;
}

/** Convert one board's live state into its serializable archive. */
export function toArchive(board: BoardState): BoardArchive {
  return {
    definition: board.definition,
    currentSeason: board.currentSeason,
    frozenSeasons: [...board.frozenSeasons],
    entries: [...board.entries.values()],
    frozenEntries: [...board.frozenEntries.entries()].map(([seasonId, entries]) => ({
      seasonId,
      entries: [...entries.values()],
    })),
    receipts: [...board.receipts],
    evidence: [...board.evidence.entries()].map(([key, seen]) => ({ key, receiptId: seen.receiptId, score: seen.score })),
  };
}

/** One board's state in serializable (array-based) form. */
export interface BoardArchive {
  readonly definition: LeaderboardBoardDefinition;
  readonly currentSeason: SeasonWindow;
  readonly frozenSeasons: readonly SeasonWindow[];
  readonly entries: readonly BoardSubjectEntry[];
  readonly frozenEntries: readonly { readonly seasonId: string; readonly entries: readonly BoardSubjectEntry[] }[];
  readonly receipts: readonly SubmissionReceipt[];
  readonly evidence: readonly { readonly key: string; readonly receiptId: string; readonly score: number }[];
}

/** Build the canonical state document from board archives. */
export function documentOf(archives: readonly BoardArchive[], revision: number): LeaderboardStateDocument {
  const boards: LeaderboardStateDocument["boards"][number][] = [];
  const currentSeasons: LeaderboardStateDocument["currentSeasons"][number][] = [];
  const frozenSeasons: LeaderboardStateDocument["frozenSeasons"][number][] = [];
  const entries: LeaderboardStateDocument["entries"][number][] = [];
  const receipts: unknown[] = [];
  const evidenceRegistry: LeaderboardStateDocument["evidenceRegistry"][number][] = [];
  for (const archive of archives) {
    const tenant = String(archive.definition.tenant);
    const leaderboard = String(archive.definition.leaderboard);
    boards.push({
      tenant,
      leaderboard,
      metric: archive.definition.metric,
      aggregation: archive.definition.aggregation,
      ordering: archive.definition.ordering,
      policy: archive.definition.policy,
    });
    currentSeasons.push({ tenant, leaderboard, season: archive.currentSeason });
    frozenSeasons.push({ tenant, leaderboard, seasons: [...archive.frozenSeasons] });
    for (const entry of archive.entries) {
      entries.push({
        seasonId: archive.currentSeason.seasonId,
        subject: String(entry.subject),
        score: entry.score,
        achievedAt: entry.achievedAt,
        submissions: entry.submissions,
        lastEvidence: String(entry.lastEvidence),
        lastRecordedAt: entry.lastRecordedAt,
        lastIntegrityConfidence: entry.lastIntegrityConfidence,
      });
    }
    for (const frozen of archive.frozenEntries) {
      for (const entry of frozen.entries) {
        entries.push({
          seasonId: frozen.seasonId,
          subject: String(entry.subject),
          score: entry.score,
          achievedAt: entry.achievedAt,
          submissions: entry.submissions,
          lastEvidence: String(entry.lastEvidence),
          lastRecordedAt: entry.lastRecordedAt,
          lastIntegrityConfidence: entry.lastIntegrityConfidence,
        });
      }
    }
    receipts.push(...archive.receipts);
    evidenceRegistry.push(...archive.evidence);
  }
  return { revision, boards, currentSeasons, frozenSeasons, entries, receipts, evidenceRegistry };
}

/** Rebuild board archives from a state document (whole-document adoption). */
export function archivesOf(document: LeaderboardStateDocument): readonly BoardArchive[] {
  const archives: BoardArchive[] = [];
  const find = (tenant: string, leaderboard: string): BoardArchive | undefined =>
    archives.find(
      (archive) =>
        String(archive.definition.tenant) === tenant && String(archive.definition.leaderboard) === leaderboard,
    );
  for (const row of document.boards) {
    archives.push({
      definition: {
        tenant: row.tenant as TenantId,
        leaderboard: row.leaderboard as LeaderboardId,
        metric: row.metric,
        aggregation: row.aggregation,
        ordering: row.ordering,
        policy: row.policy as LeaderboardServicePolicy,
      },
      currentSeason: { seasonId: "all-time", startsAt: 0 as TimestampMs, endsAt: 9_007_199_254_740_991 as TimestampMs },
      frozenSeasons: [],
      entries: [],
      frozenEntries: [],
      receipts: [],
      evidence: [],
    });
  }
  for (const row of document.currentSeasons) {
    const archive = find(row.tenant, row.leaderboard);
    if (archive !== undefined) {
      archives[archives.indexOf(archive)] = { ...archive, currentSeason: row.season as SeasonWindow };
    }
  }
  for (const row of document.frozenSeasons) {
    const archive = find(row.tenant, row.leaderboard);
    if (archive === undefined) continue;
    const seasons = (row.seasons as SeasonWindow[]) ?? [];
    archives[archives.indexOf(archive)] = {
      ...archive,
      frozenSeasons: seasons,
      frozenEntries: seasons.map((season) => ({ seasonId: season.seasonId, entries: [] })),
    };
  }
  for (const row of document.entries) {
    const archive = archives.find(
      (candidate) =>
        candidate.currentSeason.seasonId === row.seasonId ||
        candidate.frozenEntries.some((frozen) => frozen.seasonId === row.seasonId),
    );
    if (archive === undefined) continue;
    const entry: BoardSubjectEntry = {
      subject: row.subject as SubjectId,
      score: row.score,
      achievedAt: row.achievedAt,
      submissions: row.submissions,
      lastEvidence: row.lastEvidence as ContentDigest,
      lastRecordedAt: row.lastRecordedAt,
      lastIntegrityConfidence: row.lastIntegrityConfidence,
    };
    const index = archives.indexOf(archive);
    if (archive.currentSeason.seasonId === row.seasonId) {
      archives[index] = { ...archive, entries: [...archive.entries, entry] };
    } else {
      archives[index] = {
        ...archive,
        frozenEntries: archive.frozenEntries.map((frozen) =>
          frozen.seasonId === row.seasonId ? { ...frozen, entries: [...frozen.entries, entry] } : frozen,
        ),
      };
    }
  }
  for (const receipt of document.receipts as unknown as SubmissionReceipt[]) {
    const archive = find(String(receipt.tenant), String(receipt.leaderboard));
    if (archive !== undefined) {
      archives[archives.indexOf(archive)] = { ...archive, receipts: [...archive.receipts, receipt] };
    }
  }
  for (const row of document.evidenceRegistry) {
    const [tenant, leaderboard] = row.key.split("|");
    const archive = find(tenant ?? "", leaderboard ?? "");
    if (archive !== undefined) {
      archives[archives.indexOf(archive)] = {
        ...archive,
        evidence: [...archive.evidence, { key: row.key, receiptId: row.receiptId, score: row.score }],
      };
    }
  }
  return archives;
}
