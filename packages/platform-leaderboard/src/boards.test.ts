/**
 * Board + season window tests: definition guard, window containment,
 * season advance rules (no overlap, no id reuse) and the aggregation
 * fold for latest/sum/max.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNBOUNDED_SEASON_END,
  aggregateEntry,
  isLeaderboardBoardDefinition,
  isSeasonWindow,
  isValidSeasonIdText,
  nextSeason,
  unboundedSeason,
  windowContains,
} from "./boards.ts";
import { asContentDigest, asSubjectId, asTenantId, asTimestampMs } from "@playliquid/platform-contracts";

const ts = (ms: number) => asTimestampMs(ms)!;

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const evidence = asContentDigest("a".repeat(64))!;

test("boards: season id text rules", () => {
  assert.ok(isValidSeasonIdText("season-1"));
  assert.ok(isValidSeasonIdText("s"));
  assert.ok(!isValidSeasonIdText("Season-1"));
  assert.ok(!isValidSeasonIdText(""));
  assert.ok(!isValidSeasonIdText("x".repeat(65)));
});

test("boards: the board definition guard validates shape", () => {
  const definition = {
    tenant,
    leaderboard: "board-1" as never,
    metric: "score",
    aggregation: "sum" as const,
    ordering: "descending" as const,
    policy: { tieBreaking: "first-achieved" as const, resetCadence: "never" as const, entryVisibility: "public" as const, minIntegrityConfidence: 0 },
  };
  assert.ok(isLeaderboardBoardDefinition(definition));
  assert.ok(!isLeaderboardBoardDefinition({ ...definition, aggregation: "avg" }));
  assert.ok(!isLeaderboardBoardDefinition({ ...definition, ordering: "mixed" }));
  assert.ok(!isLeaderboardBoardDefinition({ ...definition, tenant: "" }));
  assert.ok(!isLeaderboardBoardDefinition(null));
});

test("boards: window containment is half-open [startsAt, endsAt)", () => {
  const window = { seasonId: "season-1", startsAt: ts(100), endsAt: ts(200) };
  assert.ok(isSeasonWindow(window));
  assert.ok(windowContains(window, ts(100)));
  assert.ok(windowContains(window, ts(199)));
  assert.ok(!windowContains(window, ts(99)));
  assert.ok(!windowContains(window, ts(200)));
  assert.ok(!isSeasonWindow({ seasonId: "s", startsAt: ts(200), endsAt: ts(200) }));
  assert.ok(!isSeasonWindow({ seasonId: "S", startsAt: ts(100), endsAt: ts(200) }));
});

test("boards: season advance must strictly advance and never reuse ids", () => {
  const current = { seasonId: "season-1", startsAt: ts(0), endsAt: ts(1_000) };
  assert.deepEqual(nextSeason(current, "season-2", ts(1_000), 500), { seasonId: "season-2", startsAt: ts(1_000), endsAt: ts(1_500) });
  // Overlapping window refused.
  assert.equal(nextSeason(current, "season-2", ts(500), 500), undefined);
  // Reused id refused (a season can only ever be entered once, E10).
  assert.equal(nextSeason(current, "season-1", ts(1_000), 500), undefined);
  // Malformed ids/durations refused.
  assert.equal(nextSeason(current, "BAD", ts(1_000), 500), undefined);
  assert.equal(nextSeason(current, "season-2", ts(1_000), 0), undefined);
  assert.deepEqual(nextSeason(undefined, "season-1", ts(0), 100), { seasonId: "season-1", startsAt: ts(0), endsAt: ts(100) });
});

test("boards: the unbounded season spans to the sentinel end", () => {
  const season = unboundedSeason(ts(0));
  assert.equal(season.seasonId, "all-time");
  assert.ok(windowContains(season, ts(0)));
  assert.ok(windowContains(season, ts(UNBOUNDED_SEASON_END - 1)));
  assert.ok(!windowContains(season, ts(UNBOUNDED_SEASON_END)));
});

test("boards: latest aggregation replaces the score", () => {
  const first = aggregateEntry("latest", subject, undefined, 10, ts(1_000), evidence, 0.9);
  assert.equal(first.score, 10);
  const second = aggregateEntry("latest", subject, first, 7, ts(2_000), evidence, 0.9);
  assert.equal(second.score, 7);
  assert.equal(second.achievedAt, ts(2_000));
  assert.equal(second.submissions, 2);
});

test("boards: sum aggregation accumulates", () => {
  const first = aggregateEntry("sum", subject, undefined, 10, ts(1_000), evidence, 0.9);
  const second = aggregateEntry("sum", subject, first, 15, ts(2_000), evidence, 0.9);
  assert.equal(second.score, 25);
  assert.equal(second.achievedAt, ts(2_000));
  assert.equal(second.submissions, 2);
});

test("boards: max aggregation only rises and pins achievedAt to the maximum", () => {
  const first = aggregateEntry("max", subject, undefined, 10, ts(1_000), evidence, 0.9);
  const lower = aggregateEntry("max", subject, first, 5, ts(2_000), evidence, 0.9);
  assert.equal(lower.score, 10);
  assert.equal(lower.achievedAt, ts(1_000));
  assert.equal(lower.submissions, 2);
  const higher = aggregateEntry("max", subject, lower, 20, ts(3_000), evidence, 0.9);
  assert.equal(higher.score, 20);
  assert.equal(higher.achievedAt, ts(3_000));
});
