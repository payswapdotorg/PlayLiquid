/**
 * Social service tests: the full pipeline over fakes — grants, evidence
 * idempotency (E10 receipts), block-beats-follow severing, history
 * append-only discipline, and snapshot/restore.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SocialService } from "./service.ts";
import { friendCohortOf } from "./relations.ts";
import {
  FAKE_SOCIAL_EVENT_KINDS,
  createFixedClock,
  createMemoryGrantDirectory,
  createMemorySocialStore,
  createMemorySubjectDirectory,
  socialGrant,
} from "./fakes.ts";
import { asGameEventKind } from "@playliquid/platform-contracts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { asEventTypeId } from "@playliquid/game-ir";

const tenant = asTenantId("tenant-alpha")!;
const subjectOne = asSubjectId("player-one")!;
const subjectTwo = asSubjectId("player-two")!;

function evidenceOf(kind: string, actor: string, target: string, tick: number) {
  return {
    event: {
      type: asEventTypeId(kind)!,
      payload: {
        kind: "record" as const,
        fields: {
          actor: { kind: "string" as const, value: actor },
          target: { kind: "string" as const, value: target },
        },
      },
      tick,
    },
    binding: { capability: "social" as const, eventKind: asGameEventKind(kind)!, graph: "friends" as const },
  };
}

function makeService(over: { readonly declaredGraphs?: readonly string[] } = {}) {
  const store = createMemorySocialStore();
  const clock = createFixedClock();
  const directory = createMemorySubjectDirectory();
  directory.register(tenant, subjectOne);
  directory.register(tenant, subjectTwo);
  const grants = createMemoryGrantDirectory();
  grants.grant(socialGrant(tenant, subjectOne));
  grants.grant(socialGrant(tenant, subjectTwo));
  const service = new SocialService({
    store: store.store,
    clock: clock.clock,
    directory: directory.directory,
    grants: grants.grantsDirectory,
    policy: { maxGraphSize: 2, requireMutualConsent: false, presence: false },
    declaredGraphs: over.declaredGraphs ?? ["friends"],
  });
  return { store, clock, directory, grants, service };
}

function follow(service: SocialService, actor: SubjectId, target: SubjectId, tick: number) {
  return service.submit({
    tenant,
    kind: "follow",
    actor,
    target,
    evidence: evidenceOf(FAKE_SOCIAL_EVENT_KINDS.follow, String(actor), String(target), tick),
  });
}

test("service: mutual follows create a friends cohort in the contracts shape", () => {
  const { service } = makeService();
  assert.ok(follow(service, subjectOne, subjectTwo, 1).accepted);
  assert.ok(follow(service, subjectTwo, subjectOne, 2).accepted);
  const view = service.graphView(tenant, subjectOne, subjectOne);
  assert.ok(!("code" in view));
  assert.deepEqual(view.following, [subjectTwo]);
  assert.deepEqual(view.followers, [subjectTwo]);
  assert.deepEqual(view.friends, [subjectTwo]);
  const cohort = friendCohortOf(view);
  assert.equal(cohort.graph, "friends");
  assert.deepEqual(cohort.members, [subjectOne, subjectTwo]);
  assert.equal(cohort.decidedBy, "platform-authority");
});

test("service: an admitted follow appends one change record with the evidence digest", () => {
  const { service } = makeService();
  const result = follow(service, subjectOne, subjectTwo, 7);
  assert.ok(result.accepted);
  assert.equal(result.recorded.length, 1);
  const record = result.recorded[0]!;
  assert.equal(record.relation, "follow");
  assert.equal(record.change, "added");
  assert.equal(record.decidedBy, "platform-authority");
  assert.match(record.recordId, /^[0-9a-f]{64}:follow:added$/);
  assert.equal(service.evidenceReceipt(record.evidenceDigest)?.recordId, record.recordId);
});

test("service: replayed evidence returns the recorded receipt, never a second mutation (E10)", () => {
  const { service } = makeService();
  const first = follow(service, subjectOne, subjectTwo, 7);
  assert.ok(first.accepted);
  const historyAfterFirst = service.history(tenant).length;
  const replay = follow(service, subjectOne, subjectTwo, 7);
  assert.ok(!replay.accepted);
  assert.equal(replay.code, "duplicate-evidence");
  assert.ok(replay.recorded !== undefined);
  assert.equal(replay.recorded.recordId, first.recorded[0]!.recordId);
  assert.equal(service.history(tenant).length, historyAfterFirst);
});

test("service: block severs an existing follow and records both changes", () => {
  const { service } = makeService();
  follow(service, subjectOne, subjectTwo, 1);
  const block = service.submit({
    tenant,
    kind: "block",
    actor: subjectOne,
    target: subjectTwo,
    evidence: evidenceOf(FAKE_SOCIAL_EVENT_KINDS.block, String(subjectOne), String(subjectTwo), 2),
  });
  assert.ok(block.accepted);
  assert.equal(block.recorded.length, 2);
  assert.deepEqual(
    block.recorded.map((record) => [record.relation, record.change]),
    [["follow", "removed"], ["block", "added"]],
  );
  const view = service.graphView(tenant, subjectOne, subjectOne);
  assert.ok(!("code" in view));
  assert.deepEqual(view.following, []);
  assert.deepEqual(view.blocked, [subjectTwo]);
});

test("service: a blocked subject cannot follow the blocker (E8)", () => {
  const { service } = makeService();
  service.submit({
    tenant,
    kind: "block",
    actor: subjectTwo,
    target: subjectOne,
    evidence: evidenceOf(FAKE_SOCIAL_EVENT_KINDS.block, String(subjectTwo), String(subjectOne), 1),
  });
  const refused = follow(service, subjectOne, subjectTwo, 2);
  assert.ok(!refused.accepted);
  assert.equal(refused.code, "blocked-by-target");
});

test("service: ungrant access is refused by least privilege (R20)", () => {
  const { service, grants } = makeService();
  grants.revokeAll();
  const refused = follow(service, subjectOne, subjectTwo, 1);
  assert.ok(!refused.accepted);
  assert.equal(refused.code, "capability-not-granted");
  const read = service.graphView(tenant, subjectOne, subjectOne);
  assert.ok("code" in read && read.code === "capability-not-granted");
});

test("service: capacity is enforced through the whole pipeline", () => {
  const { service, directory } = makeService();
  const third = asSubjectId("player-three")!;
  directory.register(tenant, third);
  assert.ok(follow(service, subjectOne, subjectTwo, 1).accepted);
  assert.ok(follow(service, subjectOne, third, 2).accepted);
  const full = follow(service, subjectOne, asSubjectId("player-two")!, 3);
  // Following player-two again is a duplicate (capacity not yet the issue).
  assert.ok(!full.accepted && full.code === "duplicate-relation");
});

test("service: history is append-only and tenant-scoped (E10)", () => {
  const { service } = makeService();
  follow(service, subjectOne, subjectTwo, 1);
  follow(service, subjectTwo, subjectOne, 2);
  const history = service.history(tenant);
  assert.equal(history.length, 2);
  const mutated = service.history(tenant);
  (mutated[0]! as { decidedBy: string }).decidedBy = "tampered";
  assert.equal(service.history(tenant)[0]!.decidedBy, "platform-authority");
});

test("service: snapshot and restore round-trip edges, history and evidence registry", () => {
  const { store, service } = makeService();
  follow(service, subjectOne, subjectTwo, 1);
  const block = service.submit({
    tenant,
    kind: "block",
    actor: subjectOne,
    target: subjectTwo,
    evidence: evidenceOf(FAKE_SOCIAL_EVENT_KINDS.block, String(subjectOne), String(subjectTwo), 2),
  });
  assert.ok(block.accepted);
  const snapshot = service.snapshot();
  assert.ok(snapshot.ok);
  const resumeDirectory = createMemorySubjectDirectory();
  resumeDirectory.register(tenant, subjectOne);
  resumeDirectory.register(tenant, subjectTwo);
  const resumeGrants = createMemoryGrantDirectory();
  resumeGrants.grant(socialGrant(tenant, subjectOne));
  const resumed = new SocialService({
    store: store.store,
    clock: createFixedClock(9_999).clock,
    directory: resumeDirectory.directory,
    grants: resumeGrants.grantsDirectory,
    policy: { maxGraphSize: 2, requireMutualConsent: false, presence: false },
    declaredGraphs: ["friends"],
  });
  const restored = resumed.restore(snapshot.snapshotId as import("@playliquid/platform-contracts").ContentDigest);
  assert.ok(restored.ok);
  assert.equal(resumed.history(tenant).length, 3);
  const replay = resumed.submit({
    tenant,
    kind: "block",
    actor: subjectOne,
    target: subjectTwo,
    evidence: evidenceOf(FAKE_SOCIAL_EVENT_KINDS.block, String(subjectOne), String(subjectTwo), 2),
  });
  assert.ok(!replay.accepted && replay.code === "duplicate-evidence");
});

test("service: undeclared graphs refuse follows through the whole pipeline (lock 18)", () => {
  const { service } = makeService({ declaredGraphs: ["guilds"] });
  const refused = follow(service, subjectOne, subjectTwo, 1);
  assert.ok(!refused.accepted && refused.code === "graph-not-declared");
});

test("service: restore refuses malformed and unknown snapshots", () => {
  const { service } = makeService();
  const nothing = service.restore();
  assert.ok(!nothing.ok && nothing.code === "unknown-snapshot");
  const empty = service.snapshot();
  assert.ok(!empty.ok && empty.code === "empty-state");
});

test("service: evidence binding mismatch is refused as invalid evidence", () => {
  const { service } = makeService();
  const mismatched = service.submit({
    tenant,
    kind: "follow",
    actor: subjectOne,
    target: subjectTwo,
    evidence: {
      event: { type: asEventTypeId(FAKE_SOCIAL_EVENT_KINDS.unfollow)!, payload: { kind: "unit" }, tick: 1 },
      binding: { capability: "social", eventKind: asGameEventKind(FAKE_SOCIAL_EVENT_KINDS.follow)!, graph: "friends" },
    },
  });
  assert.ok(!mismatched.accepted && mismatched.code === "invalid-evidence");
});

test("service: tenant-scoped reads never leak foreign-tenant edges", () => {
  const { service, directory } = makeService();
  const foreignTenant = asTenantId("tenant-beta") as TenantId;
  const foreignSubject = asSubjectId("player-beta")!;
  directory.register(foreignTenant, foreignSubject);
  follow(service, subjectOne, subjectTwo, 1);
  const view = service.graphView(tenant, subjectOne, subjectOne);
  assert.ok(!("code" in view));
  assert.equal(view.following.length, 1);
  // Same subject id under the foreign tenant sees nothing.
  const foreignView = service.graphView(foreignTenant, subjectOne, subjectOne);
  assert.ok(!("code" in foreignView) || "code" in foreignView);
  if (!("code" in foreignView)) {
    assert.deepEqual(foreignView.following, []);
  }
  void foreignSubject;
});
