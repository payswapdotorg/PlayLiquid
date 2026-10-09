/**
 * R20 tenant-isolation + least-privilege tests for the achievements
 * service: cross-tenant evidence, tenant-scoped definitions, and
 * tenant-scoped awards/progression.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { AchievementsService } from "./service.ts";
import {
  FAKE_ACHIEVEMENT_EVENT_KINDS,
  achievementsAdminGrant,
  createFixedClock,
  createMemoryAchievementsStore,
  createMemoryGrantDirectory,
} from "./fakes.ts";
import {
  asAchievementId,
  asContentDigest,
  asGameEventKind,
  asSubjectId,
  asTenantId,
  asTimestampMs,
} from "@playliquid/platform-contracts";

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const adminA = asSubjectId("admin-a")!;
const adminB = asSubjectId("admin-b")!;
const subjectOne = asSubjectId("player-one")!;
const achievement = asAchievementId("wins-ten")!;
const wonKind = asGameEventKind(FAKE_ACHIEVEMENT_EVENT_KINDS.matchWon)!;

function makeService() {
  const grants = createMemoryGrantDirectory();
  grants.grant(achievementsAdminGrant(tenantA, adminA));
  const service = new AchievementsService({
    store: createMemoryAchievementsStore().store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
  });
  const registered = service.registerDefinition(
    adminA,
    { tenant: tenantA, achievementId: achievement, metric: "wins", threshold: 1, visibility: "public", progression: "event" },
    [{ capability: "achievements", eventKind: wonKind, achievement, increment: 1 }],
  );
  assert.ok(registered.ok);
  return { grants, service };
}

function evidence(tenant: { toString(): string }, subject: { toString(): string }, digestText: string, observedAt = 1_000) {
  return {
    tenant: tenant as never,
    subject: subject as never,
    eventKind: wonKind,
    digest: asContentDigest(digestText)!,
    observedAt: asTimestampMs(observedAt)!,
  };
}

test("tenancy: tenant-A admins cannot register definitions in tenant B", () => {
  const { service } = makeService();
  const cross = service.registerDefinition(
    adminA,
    { tenant: tenantB, achievementId: achievement, metric: "wins", threshold: 1, visibility: "public", progression: "event" },
    [],
  );
  assert.ok(!cross.ok && cross.code === "tenant-mismatch");
  assert.equal(service.definitionsOf(tenantB).length, 0);
});

test("tenancy: tenant-B evidence cannot ride tenant-A grants", () => {
  const { service } = makeService();
  const cross = service.applyEvidence(adminA, evidence(tenantB, subjectOne, "a".repeat(64)));
  assert.ok(!cross.accepted && cross.code === "tenant-mismatch");
  assert.equal(service.awardsOf(tenantB).length, 0);
});

test("tenancy: same achievement id in two tenants is two isolated definitions", () => {
  const { grants, service } = makeService();
  grants.grant(achievementsAdminGrant(tenantB, adminB));
  const registered = service.registerDefinition(
    adminB,
    { tenant: tenantB, achievementId: achievement, metric: "wins", threshold: 5, visibility: "private", progression: "event" },
    [{ capability: "achievements", eventKind: wonKind, achievement, increment: 1 }],
  );
  assert.ok(registered.ok);
  assert.equal(service.definitionsOf(tenantA)[0]!.threshold, 1);
  assert.equal(service.definitionsOf(tenantB)[0]!.threshold, 5);
  // Tenant A evidence awards under tenant A only.
  assert.ok(service.applyEvidence(adminA, evidence(tenantA, subjectOne, "a".repeat(64))).accepted);
  assert.equal(service.awardsOf(tenantA, subjectOne).length, 1);
  assert.equal(service.awardsOf(tenantB, subjectOne).length, 0);
});

test("tenancy: reads are grant-checked within the evidence tenant", () => {
  const { service } = makeService();
  assert.ok(service.applyEvidence(adminA, evidence(tenantA, subjectOne, "a".repeat(64))).accepted);
  const page = service.query(adminB, { tenant: tenantA, subject: subjectOne, unlockedOnly: false });
  assert.ok("code" in page && page.code === "capability-not-granted");
  const home = service.query(adminA, { tenant: tenantA, subject: subjectOne, unlockedOnly: false });
  assert.ok("progress" in home);
  assert.equal(home.progress.length, 1);
});

test("tenancy: read-only grants cannot register definitions", () => {
  const { grants, service } = makeService();
  const reader = asSubjectId("reader-service")!;
  grants.grant({ tenant: tenantA, subject: reader, capability: "achievements", permissions: ["read"] });
  const refused = service.registerDefinition(
    reader,
    { tenant: tenantA, achievementId: asAchievementId("another-one")!, metric: "wins", threshold: 1, visibility: "public", progression: "event" },
    [],
  );
  assert.ok(!refused.ok && refused.code === "permission-not-granted");
});
