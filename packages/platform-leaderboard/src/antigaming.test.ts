/**
 * Anti-gaming + service pipeline tests (E8/E10): the full submitScore
 * journey — idempotent replays with receipts, stale ordering, season
 * freezing, deterministic tie-breaking, ranking via the platform
 * oracle, and least-privilege refusals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { LeaderboardService } from "./service.ts";
import {
  createFixedClock,
  createMemoryGrantDirectory,
  createMemoryLeaderboardStore,
  leaderboardAdminGrant,
  leaderboardSubmitGrant,
} from "./fakes.ts";
import { asContentDigest, asLeaderboardId, asSubjectId, asTenantId, asTimestampMs } from "@playliquid/platform-contracts";

const ts = (ms: number) => asTimestampMs(ms)!;
import type { LeaderboardBoardDefinition } from "./boards.ts";

const tenant = asTenantId("tenant-alpha")!;
const leaderboard = asLeaderboardId("board-1")!;
const admin = asSubjectId("admin-service")!;
const subjectOne = asSubjectId("player-one")!;
const subjectTwo = asSubjectId("player-two")!;

function definition(over: Partial<LeaderboardBoardDefinition> = {}): LeaderboardBoardDefinition {
  return {
    tenant,
    leaderboard,
    metric: "score",
    aggregation: "sum",
    ordering: "descending",
    policy: { tieBreaking: "first-achieved", resetCadence: "seasonal", entryVisibility: "public", minIntegrityConfidence: 0 },
    ...over,
  };
}

function makeService(over: Partial<LeaderboardBoardDefinition> = {}) {
  const store = createMemoryLeaderboardStore();
  const clock = createFixedClock();
  const grants = createMemoryGrantDirectory();
  grants.grant(leaderboardAdminGrant(tenant, admin));
  const service = new LeaderboardService({ store: store.store, clock: clock.clock, grants: grants.grantsDirectory });
  const registered = service.registerBoard(admin, definition(over), { seasonId: "season-1", startsAt: ts(0), endsAt: ts(100_000) });
  assert.ok(registered.ok);
  return { store, clock, grants, service };
}

function submission(subject: { toString(): string }, score: number, recordedAt: number, evidence: string) {
  return {
    record: {
      tenant,
      leaderboard,
      subject: subject as never,
      score,
      recordedAt: asTimestampMs(recordedAt)!,
      sourceEventKind: "match.scored" as never,
      evidence: asContentDigest(evidence)!,
      decidedBy: "platform-authority" as const,
    },
    integrityConfidence: 0.99,
  };
}

test("antigaming: replayed evidence returns the recorded receipt, never a second mutation (E10)", () => {
  const { service } = makeService();
  const first = service.submitScore(admin, submission(subjectOne, 10, 1_000, "a".repeat(64)));
  assert.ok(first.accepted);
  const replay = service.submitScore(admin, submission(subjectOne, 10, 1_000, "a".repeat(64)));
  assert.ok(!replay.accepted);
  assert.equal(replay.code, "duplicate-submission");
  assert.ok(replay.recorded !== undefined);
  assert.equal(replay.recorded.receiptId, first.receipt.receiptId);
  // History has exactly ONE receipt: no second mutation.
  assert.equal(service.history(tenant, leaderboard).length, 1);
  const rank = service.subjectRank(admin, tenant, leaderboard, subjectOne);
  assert.ok(!("ok" in rank) && rank.entry.submissions === 1);
});

test("antigaming: the same evidence with a different score is a collision (E8)", () => {
  const { service } = makeService();
  service.submitScore(admin, submission(subjectOne, 10, 1_000, "a".repeat(64)));
  const collision = service.submitScore(admin, submission(subjectOne, 999, 1_000, "a".repeat(64)));
  assert.ok(!collision.accepted && collision.code === "idempotency-collision");
  const rank = service.subjectRank(admin, tenant, leaderboard, subjectOne);
  assert.ok(!("ok" in rank) && rank.entry.score === 10);
});

test("antigaming: out-of-order submissions are refused (E8)", () => {
  const { service } = makeService();
  assert.ok(service.submitScore(admin, submission(subjectOne, 10, 2_000, "a".repeat(64))).accepted);
  const stale = service.submitScore(admin, submission(subjectOne, 99, 1_000, "b".repeat(64)));
  assert.ok(!stale.accepted && stale.code === "stale-submission");
  // The stale score never landed.
  const rank = service.subjectRank(admin, tenant, leaderboard, subjectOne);
  assert.ok(!("ok" in rank) && rank.entry.score === 10);
});

test("antigaming: season advance freezes the old board forever (E10)", () => {
  const { service } = makeService();
  service.submitScore(admin, submission(subjectOne, 10, 1_000, "a".repeat(64)));
  service.submitScore(admin, submission(subjectTwo, 20, 2_000, "b".repeat(64)));
  const advanced = service.advanceSeason(admin, tenant, leaderboard, "season-2", ts(100_000), 100_000);
  assert.ok(advanced.ok);
  // The frozen board is readable and immutable.
  const frozen = service.seasonBoard(admin, tenant, leaderboard, "season-1");
  assert.ok("entries" in frozen);
  assert.equal(frozen.entries.length, 2);
  // Old evidence replaying into the new season is out of window.
  const late = service.submitScore(admin, submission(subjectOne, 5, 1_500, "a".repeat(64)));
  assert.ok(!late.accepted && late.code === "window-closed");
  // New-season submissions build a fresh board.
  assert.ok(service.submitScore(admin, submission(subjectOne, 7, 100_500, "c".repeat(64))).accepted);
  const fresh = service.subjectRank(admin, tenant, leaderboard, subjectOne);
  assert.ok(!("ok" in fresh) && fresh.entry.score === 7);
});

test("antigaming: ranking uses THE platform oracle with deterministic tie-breaking", () => {
  const { service } = makeService({ aggregation: "max" });
  // Same score, different achievedAt: first-achieved wins deterministically.
  service.submitScore(admin, submission(subjectTwo, 50, 5_000, "a".repeat(64)));
  service.submitScore(admin, submission(subjectOne, 50, 6_000, "b".repeat(64)));
  const page = service.query(admin, { tenant, leaderboard, window: { offset: 0, limit: 10 } });
  assert.ok("entries" in page);
  assert.deepEqual(
    page.entries.map((entry) => [String(entry.subject), entry.rank]),
    [["player-two", 1], ["player-one", 2]],
  );
  assert.equal(page.totalEntries, 2);
});

test("antigaming: pagination windows are honored", () => {
  const { service } = makeService();
  for (let index = 0; index < 5; index += 1) {
    const subject = asSubjectId(`player-${index}`)!;
    assert.ok(
      service.submitScore(admin, submission(subject, index * 10, 1_000 + index, String(index).repeat(64))).accepted,
    );
  }
  const page = service.query(admin, { tenant, leaderboard, window: { offset: 1, limit: 2 } });
  assert.ok("entries" in page);
  assert.equal(page.entries.length, 2);
  assert.equal(page.totalEntries, 5);
  assert.deepEqual(
    page.entries.map((entry) => entry.rank),
    [2, 3],
  );
});

test("antigaming: submit grants are required; readers cannot submit (R20)", () => {
  const { service, grants } = makeService();
  const submitter = asSubjectId("game-service")!;
  grants.grant(leaderboardSubmitGrant(tenant, submitter));
  assert.ok(service.submitScore(submitter, submission(subjectOne, 10, 1_000, "a".repeat(64))).accepted);
  grants.revokeAll();
  grants.grant({ tenant, subject: admin, capability: "leaderboard", permissions: ["read"] });
  const refused = service.submitScore(admin, submission(subjectTwo, 10, 2_000, "b".repeat(64)));
  assert.ok(!refused.accepted && refused.code === "permission-not-granted");
});

test("antigaming: snapshot and restore round-trip boards, seasons and evidence", () => {
  const { store, service } = makeService();
  service.submitScore(admin, submission(subjectOne, 10, 1_000, "a".repeat(64)));
  const snapshot = service.snapshot();
  assert.ok(snapshot.ok);
  const grants = createMemoryGrantDirectory();
  grants.grant(leaderboardAdminGrant(tenant, admin));
  const resumed = new LeaderboardService({
    store: store.store,
    clock: createFixedClock(9_999).clock,
    grants: grants.grantsDirectory,
  });
  const restored = resumed.restore(snapshot.snapshotId);
  assert.ok(restored.ok);
  const replay = resumed.submitScore(admin, submission(subjectOne, 10, 1_000, "a".repeat(64)));
  assert.ok(!replay.accepted && replay.code === "duplicate-submission");
  const rank = resumed.subjectRank(admin, tenant, leaderboard, subjectOne);
  assert.ok(!("ok" in rank) && rank.entry.score === 10);
  assert.equal(resumed.history(tenant, leaderboard).length, 1);
});

test("antigaming: duplicate board registration is refused", () => {
  const { service } = makeService();
  const duplicate = service.registerBoard(admin, definition());
  assert.ok(!duplicate.ok && duplicate.code === "board-already-registered");
});

test("antigaming: malformed queries and unknown boards are refused", () => {
  const { service } = makeService();
  const malformed = service.query(admin, { tenant, leaderboard, window: { offset: -1, limit: 5 } } as never);
  assert.ok("code" in malformed && malformed.code === "malformed-query");
  const unknown = service.query(admin, { tenant, leaderboard: asLeaderboardId("nope")!, window: { offset: 0, limit: 5 } });
  assert.ok("code" in unknown && unknown.code === "board-not-registered");
  const noSnapshot = service.restore();
  assert.ok(!noSnapshot.ok && noSnapshot.code === "unknown-snapshot");
});
