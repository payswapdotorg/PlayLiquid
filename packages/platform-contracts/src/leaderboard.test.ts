import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asTimestampMs, asContentDigest } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import {
  asLeaderboardId,
  isLeaderboardServicePolicy,
  isLeaderboardEventBinding,
  validateScoreRecord,
  isLeaderboardQueryRequest,
  rankLeaderboardEntries,
} from "./leaderboard.ts";
import type {
  LeaderboardEntry,
  LeaderboardServicePolicy,
  ClientScoreClaim,
  AuthoritativeScoreRecord,
} from "./leaderboard.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const board = asLeaderboardId("board-arena")!;
const evidence = asContentDigest("ab".repeat(32))!;
const kind = asGameEventKind("match.completed")!;

test("leaderboard: ids and service policies validate", () => {
  assert.ok(asLeaderboardId("board-arena"));
  assert.equal(asLeaderboardId("Board Arena"), undefined);
  const policy: LeaderboardServicePolicy = {
    tieBreaking: "first-achieved",
    resetCadence: "seasonal",
    entryVisibility: "public",
    minIntegrityConfidence: 0.8,
  };
  assert.ok(isLeaderboardServicePolicy(policy));
  assert.equal(isLeaderboardServicePolicy({ ...policy, minIntegrityConfidence: 1.5 }), false);
  assert.equal(isLeaderboardServicePolicy({ ...policy, tieBreaking: "alphabetical" }), false);
});

test("leaderboard: games bind their events to metrics (lock 18 declaration)", () => {
  assert.ok(
    isLeaderboardEventBinding({
      capability: "leaderboard",
      eventKind: kind,
      metric: "score",
      aggregation: "max",
    }),
  );
  assert.equal(
    isLeaderboardEventBinding({ capability: "social", eventKind: kind, metric: "score", aggregation: "max" }),
    false,
  );
  assert.equal(
    isLeaderboardEventBinding({ capability: "leaderboard", eventKind: kind, metric: "", aggregation: "max" }),
    false,
  );
});

test("leaderboard: only authoritative, evidence-backed score records validate (R9/E8)", () => {
  const record: AuthoritativeScoreRecord = {
    tenant,
    leaderboard: board,
    subject,
    score: 1200,
    recordedAt: asTimestampMs(1_767_225_600_000)!,
    sourceEventKind: kind,
    evidence,
    decidedBy: "platform-authority",
  };
  assert.deepEqual(validateScoreRecord(record), { ok: true, subject });

  const missingEvidence = { ...record, evidence: "not-a-digest" };
  assert.deepEqual(validateScoreRecord(missingEvidence), { ok: false, code: "missing-evidence" });

  const negative = { ...record, score: -1 };
  assert.deepEqual(validateScoreRecord(negative), { ok: false, code: "invalid-score" });

  const notAuthoritative = { ...record, decidedBy: "game-declared" };
  assert.deepEqual(validateScoreRecord(notAuthoritative), { ok: false, code: "not-authoritative" });

  assert.deepEqual(validateScoreRecord("junk"), { ok: false, code: "malformed-record" });
});

test("leaderboard: client score claims are untrusted and never admissible (E8)", () => {
  const claim: ClientScoreClaim = {
    leaderboard: board,
    claimedScore: 999_999,
    untrusted: "untrusted-client-input",
  };
  assert.deepEqual(validateScoreRecord(claim), { ok: false, code: "not-authoritative" });
  // @ts-expect-error — a ClientScoreClaim is not assignable to an AuthoritativeScoreRecord
  const laundered: AuthoritativeScoreRecord = claim;
  assert.equal(laundered.leaderboard, board);
});

test("leaderboard: query windows are bounded", () => {
  assert.ok(isLeaderboardQueryRequest({ tenant, leaderboard: board, window: { offset: 0, limit: 50 } }));
  assert.equal(isLeaderboardQueryRequest({ tenant, leaderboard: board, window: { offset: -1, limit: 50 } }), false);
  assert.equal(isLeaderboardQueryRequest({ tenant, leaderboard: board, window: { offset: 0, limit: 0 } }), false);
  assert.equal(isLeaderboardQueryRequest({ tenant, leaderboard: board, window: { offset: 0, limit: 101 } }), false);
});

function entry(subjectText: string, score: number, achievedAt: number, rank = 1): LeaderboardEntry {
  return {
    tenant,
    leaderboard: board,
    subject: asSubjectId(subjectText)!,
    rank,
    score,
    achievedAt: asTimestampMs(achievedAt)!,
    integrityConfidence: 0.9,
  };
}

test("leaderboard: the platform ranks entries, not the game (descending + first-achieved ties)", () => {
  const ranked = rankLeaderboardEntries(
    [entry("p1", 100, 300), entry("p2", 300, 200), entry("p3", 300, 100), entry("p4", 50, 400)],
    "descending",
    "first-achieved",
  );
  assert.deepEqual(
    ranked.map((row) => [row.subject, row.rank]),
    [
      ["p3", 1],
      ["p2", 2],
      ["p1", 3],
      ["p4", 4],
    ],
  );
});

test("leaderboard: shared ties give equal ranks (ascending)", () => {
  const ranked = rankLeaderboardEntries(
    [entry("p1", 10, 500), entry("p2", 20, 400), entry("p3", 10, 300)],
    "ascending",
    "shared",
  );
  assert.deepEqual(
    ranked.map((row) => [row.subject, row.rank]),
    [
      ["p1", 1],
      ["p3", 1],
      ["p2", 3],
    ],
  );
});

test("leaderboard: ranking never trusts input order", () => {
  const ranked = rankLeaderboardEntries([entry("p1", 1, 0), entry("p2", 2, 0)], "ascending", "first-achieved");
  assert.deepEqual(
    ranked.map((row) => row.subject),
    ["p1", "p2"],
  );
});
