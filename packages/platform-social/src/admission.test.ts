/**
 * Social admission oracle tests: every refusal code (E8 negative
 * coverage), the platform-contracts oracle binding (self-relation,
 * graph-not-declared, mutual consent, capacity) and the follow/block
 * specific rules.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adjudicateSocialGraphCommand } from "./admission.ts";
import type { SocialGraphCommand, SocialGraphFactsInput } from "./admission.ts";
import { asContentDigest, asGameEventKind, asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { SocialServicePolicy } from "@playliquid/platform-contracts";
import { asEventTypeId } from "@playliquid/game-ir";

const tenant = asTenantId("tenant-alpha")!;
const actor = asSubjectId("player-one")!;
const target = asSubjectId("player-two")!;
const digest = asContentDigest("a".repeat(64))!;
const followKind = asGameEventKind("social.follow.requested")!;

const policy: SocialServicePolicy = { maxGraphSize: 3, requireMutualConsent: false, presence: false };

function command(over: Partial<SocialGraphCommand> = {}): SocialGraphCommand {
  return {
    tenant,
    kind: "follow",
    actor,
    target,
    evidence: {
      event: { type: asEventTypeId("social.follow.requested")!, payload: { kind: "unit" }, tick: 1 },
      binding: { capability: "social", eventKind: followKind, graph: "friends" },
    },
    ...over,
  };
}

function facts(over: Partial<SocialGraphFactsInput> = {}): SocialGraphFactsInput {
  return {
    declaredGraphs: ["friends"],
    targetExists: true,
    targetTenant: undefined,
    evidenceDigest: digest,
    evidenceSeen: false,
    actorFollowsTarget: false,
    actorBlocksTarget: false,
    targetBlocksActor: false,
    actorFollowingCount: 0,
    ...over,
  };
}

test("admission: a well-formed follow is accepted", () => {
  assert.deepEqual(adjudicateSocialGraphCommand(command(), policy, facts()), { accepted: true });
});

test("admission: id text validity is checked first", () => {
  const badTenant = adjudicateSocialGraphCommand(command({ tenant: "" as never }), policy, facts());
  assert.ok(!badTenant.accepted && badTenant.code === "invalid-tenant");
  const badActor = adjudicateSocialGraphCommand(command({ actor: "" as never }), policy, facts());
  assert.ok(!badActor.accepted && badActor.code === "invalid-actor");
  const badTarget = adjudicateSocialGraphCommand(command({ target: "" as never }), policy, facts());
  assert.ok(!badTarget.accepted && badTarget.code === "invalid-target");
});

test("admission: malformed and replayed evidence are refused (E10)", () => {
  const invalid = adjudicateSocialGraphCommand(command(), policy, facts({ evidenceDigest: undefined }));
  assert.ok(!invalid.accepted && invalid.code === "invalid-evidence");
  const seen = adjudicateSocialGraphCommand(command(), policy, facts({ evidenceSeen: true }));
  assert.ok(!seen.accepted && seen.code === "duplicate-evidence");
});

test("admission: self-follow is refused through the contracts oracle (self-relation)", () => {
  const decision = adjudicateSocialGraphCommand(command({ target: actor }), policy, facts());
  assert.ok(!decision.accepted && decision.code === "self-relation");
});

test("admission: self-block is refused too", () => {
  const decision = adjudicateSocialGraphCommand(command({ kind: "block", target: actor }), policy, facts());
  assert.ok(!decision.accepted && decision.code === "self-relation");
});

test("admission: follows on an undeclared graph are refused (lock 18)", () => {
  const decision = adjudicateSocialGraphCommand(command(), policy, facts({ declaredGraphs: ["guilds"] }));
  assert.ok(!decision.accepted && decision.code === "graph-not-declared");
});

test("admission: consent-requiring games refuse unconsented follows", () => {
  const consentPolicy: SocialServicePolicy = { ...policy, requireMutualConsent: true };
  const decision = adjudicateSocialGraphCommand(command(), consentPolicy, facts());
  assert.ok(!decision.accepted && decision.code === "mutual-consent-required");
});

test("admission: follow capacity is enforced (graph-full)", () => {
  const decision = adjudicateSocialGraphCommand(command(), policy, facts({ actorFollowingCount: 3 }));
  assert.ok(!decision.accepted && decision.code === "graph-full");
});

test("admission: block beats follow in BOTH directions (E8)", () => {
  const blocking = adjudicateSocialGraphCommand(command(), policy, facts({ actorBlocksTarget: true }));
  assert.ok(!blocking.accepted && blocking.code === "blocking-target");
  const blocked = adjudicateSocialGraphCommand(command(), policy, facts({ targetBlocksActor: true }));
  assert.ok(!blocked.accepted && blocked.code === "blocked-by-target");
});

test("admission: duplicate follow and missing follow are refused", () => {
  const duplicate = adjudicateSocialGraphCommand(command(), policy, facts({ actorFollowsTarget: true }));
  assert.ok(!duplicate.accepted && duplicate.code === "duplicate-relation");
  const unfollow = adjudicateSocialGraphCommand(command({ kind: "unfollow" }), policy, facts());
  assert.ok(!unfollow.accepted && unfollow.code === "not-following");
});

test("admission: block and unblock relation states are enforced", () => {
  const duplicateBlock = adjudicateSocialGraphCommand(command({ kind: "block" }), policy, facts({ actorBlocksTarget: true }));
  assert.ok(!duplicateBlock.accepted && duplicateBlock.code === "duplicate-relation");
  const unblock = adjudicateSocialGraphCommand(command({ kind: "unblock" }), policy, facts());
  assert.ok(!unblock.accepted && unblock.code === "not-blocking");
  assert.deepEqual(adjudicateSocialGraphCommand(command({ kind: "unblock" }), policy, facts({ actorBlocksTarget: true })), { accepted: true });
});

test("admission: cross-tenant targets are a typed violation (R20)", () => {
  const decision = adjudicateSocialGraphCommand(
    command(),
    policy,
    facts({ targetTenant: asTenantId("tenant-beta")! }),
  );
  assert.ok(!decision.accepted && decision.code === "cross-tenant-access");
});

test("admission: unknown targets are refused", () => {
  const decision = adjudicateSocialGraphCommand(command(), policy, facts({ targetExists: false }));
  assert.ok(!decision.accepted && decision.code === "unknown-target");
});

test("admission: unfollow runs through the contracts oracle too", () => {
  const undeclared = adjudicateSocialGraphCommand(
    command({ kind: "unfollow" }),
    policy,
    facts({ actorFollowsTarget: true, declaredGraphs: [] }),
  );
  assert.ok(!undeclared.accepted && undeclared.code === "graph-not-declared");
  assert.deepEqual(
    adjudicateSocialGraphCommand(command({ kind: "unfollow" }), policy, facts({ actorFollowsTarget: true })),
    { accepted: true },
  );
});
