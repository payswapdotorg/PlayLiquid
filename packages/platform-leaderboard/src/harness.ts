/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full leaderboard journey over the in-memory fakes:
 * register a seasonal board -> submit scores for two subjects (ranks
 * via the platform ranking oracle) -> duplicate submission returns the
 * recorded receipt (E10) -> stale submission refused (E8) -> advance
 * the season (old board frozen, E10) -> out-of-window submission
 * refused -> cross-tenant submission refused (R20). Prints
 * deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no clock, no randomness,
 * no network.
 */

import { LeaderboardService } from "./service.ts";
import {
  createFixedClock,
  createMemoryGrantDirectory,
  createMemoryLeaderboardStore,
  leaderboardAdminGrant,
} from "./fakes.ts";
import {
  asContentDigest,
  asLeaderboardId,
  asSubjectId,
  asTenantId,
  asTimestampMs,
} from "@playliquid/platform-contracts";

const ts = (ms: number) => asTimestampMs(ms)!;
const tenant = asTenantId("tenant-harness")!;
const leaderboard = asLeaderboardId("board-harness")!;
const admin = asSubjectId("admin-service")!;
const subjectOne = asSubjectId("player-one")!;
const subjectTwo = asSubjectId("player-two")!;

const grants = createMemoryGrantDirectory();
grants.grant(leaderboardAdminGrant(tenant, admin));
const service = new LeaderboardService({
  store: createMemoryLeaderboardStore().store,
  clock: createFixedClock().clock,
  grants: grants.grantsDirectory,
});

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

const definition = {
  tenant,
  leaderboard,
  metric: "score",
  aggregation: "sum" as const,
  ordering: "descending" as const,
  policy: { tieBreaking: "first-achieved" as const, resetCadence: "seasonal" as const, entryVisibility: "public" as const, minIntegrityConfidence: 0.5 },
};

// 1. Register a seasonal board.
const registered = service.registerBoard(admin, definition, {
  seasonId: "season-1",
  startsAt: ts(0),
  endsAt: ts(10_000),
});
record("register", "ok:season-1", registered.ok ? `ok:${registered.season.seasonId}` : `failed:${registered.code}`);

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

// 2. Two subjects submit; ranks come from the platform oracle.
const first = service.submitScore(admin, submission(subjectOne, 10, 1_000, "a".repeat(64)));
record("submit-1", "accepted:1", first.accepted ? `accepted:${first.receipt.rankAfter}` : `refused:${first.code}`);
const second = service.submitScore(admin, submission(subjectTwo, 20, 2_000, "b".repeat(64)));
record("submit-2", "accepted:1", second.accepted ? `accepted:${second.receipt.rankAfter}` : `refused:${second.code}`);
const third = service.submitScore(admin, submission(subjectOne, 5, 3_000, "c".repeat(64)));
record("submit-3", "accepted:2", third.accepted ? `accepted:${third.receipt.rankAfter}` : `refused:${third.code}`);

// 3. Page query returns the ranked board.
const page = service.query(admin, { tenant, leaderboard, window: { offset: 0, limit: 10 } });
record("query", "20,15", "entries" in page ? page.entries.map((entry) => entry.score).join(",") : `refused:${page.code}`);

// 4. Duplicate submission returns the recorded receipt (E10).
const duplicate = service.submitScore(admin, submission(subjectOne, 10, 1_000, "a".repeat(64)));
record(
  "duplicate",
  "refused:duplicate-submission+receipt",
  duplicate.accepted ? "accepted" : `refused:${duplicate.code}${duplicate.recorded !== undefined ? "+receipt" : ""}`,
);

// 5. Stale submission refused (E8: out-of-order evidence).
const stale = service.submitScore(admin, submission(subjectOne, 99, 2_500, "d".repeat(64)));
record("stale", "refused:stale-submission", stale.accepted ? "accepted" : `refused:${stale.code}`);

// 6. Advance the season: the old board freezes (E10).
const advanced = service.advanceSeason(admin, tenant, leaderboard, "season-2", ts(10_000), 10_000);
record("advance-season", "ok:season-2", advanced.ok ? `ok:${advanced.next.seasonId}` : `failed:${advanced.code}`);
const frozen = service.seasonBoard(admin, tenant, leaderboard, "season-1");
record("frozen-board", "2", "entries" in frozen ? String(frozen.entries.length) : `refused:${frozen.code}`);

// 7. Out-of-window submission refused.
const late = service.submitScore(admin, submission(subjectOne, 7, 5_000, "e".repeat(64)));
record("window-closed", "refused:window-closed", late.accepted ? "accepted" : `refused:${late.code}`);

// 8. Cross-tenant submission refused (R20: grants are tenant-scoped).
const foreignTenant = asTenantId("tenant-foreign")!;
const crossTenant = service.submitScore(
  admin,
  {
    record: {
      tenant: foreignTenant,
      leaderboard,
      subject: subjectOne,
      score: 3,
      recordedAt: asTimestampMs(11_000)!,
      sourceEventKind: "match.scored" as never,
      evidence: asContentDigest("f".repeat(64))!,
      decidedBy: "platform-authority" as const,
    },
    integrityConfidence: 0.99,
  },
);
record("cross-tenant", "refused:tenant-mismatch", crossTenant.accepted ? "accepted" : `refused:${crossTenant.code}`);

// 9. Append-only history (E10).
record("history", "3", String(service.history(tenant, leaderboard).length));

const failures = steps.filter((item) => item.expected !== item.actual);
console.log(JSON.stringify({ harness: "platform-leaderboard", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
