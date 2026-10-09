/**
 * R20 tenant-isolation + least-privilege tests for the leaderboard
 * service: cross-tenant submissions, tenant-scoped grants, and
 * tenant-scoped history.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { LeaderboardService } from "./service.ts";
import {
  createFixedClock,
  createMemoryGrantDirectory,
  createMemoryLeaderboardStore,
  leaderboardAdminGrant,
} from "./fakes.ts";
import { asContentDigest, asLeaderboardId, asSubjectId, asTenantId, asTimestampMs } from "@playliquid/platform-contracts";

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const leaderboard = asLeaderboardId("board-1")!;
const adminA = asSubjectId("admin-a")!;
const subjectOne = asSubjectId("player-one")!;

function makeService() {
  const grants = createMemoryGrantDirectory();
  grants.grant(leaderboardAdminGrant(tenantA, adminA));
  const service = new LeaderboardService({
    store: createMemoryLeaderboardStore().store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
  });
  const registered = service.registerBoard(adminA, {
    tenant: tenantA,
    leaderboard,
    metric: "score",
    aggregation: "sum",
    ordering: "descending",
    policy: { tieBreaking: "first-achieved", resetCadence: "never", entryVisibility: "public", minIntegrityConfidence: 0 },
  });
  assert.ok(registered.ok);
  return { grants, service };
}

function submission(tenant: { toString(): string }, subject: { toString(): string }, score: number, recordedAt: number, evidence: string) {
  return {
    record: {
      tenant: tenant as never,
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

test("tenancy: a tenant-A admin cannot submit against tenant B", () => {
  const { service } = makeService();
  const cross = service.submitScore(adminA, submission(tenantB, subjectOne, 10, 1_000, "a".repeat(64)));
  assert.ok(!cross.accepted);
  assert.equal(cross.code, "tenant-mismatch");
  // Tenant B has no boards registered; nothing was created.
  const page = service.query(adminA, { tenant: tenantB, leaderboard, window: { offset: 0, limit: 10 } });
  assert.ok("code" in page && page.code === "board-not-registered");
});

test("tenancy: a tenant-A admin cannot register boards in tenant B", () => {
  const { service } = makeService();
  const cross = service.registerBoard(adminA, {
    tenant: tenantB,
    leaderboard,
    metric: "score",
    aggregation: "sum",
    ordering: "descending",
    policy: { tieBreaking: "first-achieved", resetCadence: "never", entryVisibility: "public", minIntegrityConfidence: 0 },
  });
  assert.ok(!cross.ok && cross.code === "tenant-mismatch");
});

test("tenancy: a tenant-B grant never satisfies a tenant-A request", () => {
  const { grants, service } = makeService();
  const adminB = asSubjectId("admin-b")!;
  grants.grant(leaderboardAdminGrant(tenantB, adminB));
  const cross = service.submitScore(adminB, submission(tenantA, subjectOne, 10, 1_000, "a".repeat(64)));
  assert.ok(!cross.accepted && cross.code === "tenant-mismatch");
  // The same admin can act in their own tenant.
  const home = service.registerBoard(adminB, {
    tenant: tenantB,
    leaderboard,
    metric: "score",
    aggregation: "sum",
    ordering: "descending",
    policy: { tieBreaking: "first-achieved", resetCadence: "never", entryVisibility: "public", minIntegrityConfidence: 0 },
  });
  assert.ok(home.ok);
});

test("tenancy: history is tenant-scoped", () => {
  const { grants, service } = makeService();
  const adminB = asSubjectId("admin-b")!;
  grants.grant(leaderboardAdminGrant(tenantB, adminB));
  const home = service.registerBoard(adminB, {
    tenant: tenantB,
    leaderboard,
    metric: "score",
    aggregation: "sum",
    ordering: "descending",
    policy: { tieBreaking: "first-achieved", resetCadence: "never", entryVisibility: "public", minIntegrityConfidence: 0 },
  });
  assert.ok(home.ok);
  assert.ok(service.submitScore(adminA, submission(tenantA, subjectOne, 10, 1_000, "a".repeat(64))).accepted);
  assert.ok(service.submitScore(adminB, submission(tenantB, asSubjectId("player-b")!, 20, 1_000, "b".repeat(64))).accepted);
  assert.equal(service.history(tenantA).length, 1);
  assert.equal(service.history(tenantB).length, 1);
  assert.equal(service.history(tenantA, leaderboard)[0]!.subject, subjectOne);
});
