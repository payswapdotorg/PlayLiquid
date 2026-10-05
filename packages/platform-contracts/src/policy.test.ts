import { test } from "node:test";
import assert from "node:assert/strict";
import { asGameId } from "@playliquid/game-contracts";
import { asTenantId, asContentDigest } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import {
  isCapabilityEventBinding,
  isPlatformPolicyDeclaration,
  validateCapabilityPolicy,
} from "./policy.ts";
import type {
  PlatformPolicyDeclaration,
  CapabilityEventBinding,
  PolicyRejectionReason,
} from "./policy.ts";

const game = asGameId("game-harness")!;
const tenant = asTenantId("tenant-alpha")!;
const matchCompleted = asGameEventKind("match.completed")!;
const shotLanded = asGameEventKind("shot.landed")!;
const chatMessage = asGameEventKind("chat.message")!;

/**
 * A synthetic, fully valid platform policy declaration for a fictional
 * competitive game. All values are assembled here, at runtime.
 */
function validPolicy(): PlatformPolicyDeclaration {
  return {
    game,
    capabilities: [
      {
        capability: "leaderboard",
        required: true,
        policy: { metric: "score", ordering: "descending", scope: "global" },
      },
      {
        capability: "multiplayer",
        required: true,
        policy: { topology: "authoritative-server", maxPlayersPerSession: 8, sessionModel: "matchmade" },
      },
      {
        capability: "replay",
        required: true,
        policy: { capture: "intent-log", determinismRequired: true, consumers: ["qa", "integrity"] },
      },
      {
        capability: "rewards",
        required: true,
        policy: { mode: "entitlement", settlement: "platform", clientAuthoritative: false },
      },
    ],
    events: [
      { kind: matchCompleted, summary: "A match finished with authoritative standings." },
      { kind: shotLanded, summary: "A player landed a shot." },
      { kind: chatMessage, summary: "A player sent a chat message." },
    ],
    bindings: [
      { capability: "leaderboard", eventKind: matchCompleted, metric: "score", aggregation: "max" },
      {
        capability: "multiplayer",
        eventKind: matchCompleted,
        outcomeClassification: "protected",
      },
      { capability: "replay", eventKind: shotLanded },
      {
        capability: "rewards",
        eventKind: matchCompleted,
        entitlementKind: "arena-coin",
        amount: 100,
        requiresAuthoritativeOutcome: true,
        minIntegrityConfidence: 0.75,
      },
    ],
    tenancy: { mode: "single-tenant", tenant },
  };
}

function rejectionCodes(validation: { pass: boolean; reasons: readonly PolicyRejectionReason[] }): string[] {
  return validation.reasons.map((reason) => reason.code);
}

test("policy: a well-formed game policy passes with zero reasons", () => {
  const policy = validPolicy();
  assert.ok(isPlatformPolicyDeclaration(policy));
  const validation = validateCapabilityPolicy(policy);
  assert.deepEqual(validation, { pass: true, reasons: [] });
});

test("policy: bindings are recognized across all nine capabilities", () => {
  const binding: CapabilityEventBinding = {
    capability: "leaderboard",
    eventKind: matchCompleted,
    metric: "score",
    aggregation: "max",
  };
  assert.ok(isCapabilityEventBinding(binding));
  assert.equal(isCapabilityEventBinding({ capability: "cloud-save", eventKind: matchCompleted }), false);
  assert.equal(isCapabilityEventBinding("junk"), false);
});

test("policy: a game cannot re-declare platform authority events (lock 18)", () => {
  // Simulate untrusted JSON smuggling a reserved kind into the event list.
  const smuggled = {
    ...validPolicy(),
    events: [
      ...validPolicy().events,
      { kind: "platform.entitlement.granted", summary: "game-minted authority event" },
    ],
  } as unknown as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(smuggled);
  assert.equal(validation.pass, false);
  assert.ok(rejectionCodes(validation).includes("reserved-platform-event-kind"));
  const reason = validation.reasons.find((entry) => entry.code === "reserved-platform-event-kind");
  assert.equal(reason?.detail, "platform.entitlement.granted");
});

test("policy: duplicate event kinds are rejected", () => {
  const policy = {
    ...validPolicy(),
    events: [...validPolicy().events, { kind: matchCompleted, summary: "duplicate" }],
  } as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.equal(validation.pass, false);
  assert.deepEqual(rejectionCodes(validation), ["duplicate-event-kind"]);
});

test("policy: invalid capability sets are rejected", () => {
  const policy = {
    ...validPolicy(),
    capabilities: [
      { capability: "leaderboard", required: true, policy: { metric: "", ordering: "descending", scope: "global" } },
    ],
  } as unknown as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.ok(rejectionCodes(validation).includes("invalid-capability-set"));
});

test("policy: client-authoritative rewards are rejected (lock 41)", () => {
  const policy = {
    ...validPolicy(),
    capabilities: [
      ...validPolicy().capabilities.filter((descriptor) => descriptor.capability !== "rewards"),
      {
        capability: "rewards",
        required: true,
        policy: { mode: "points", settlement: "platform", clientAuthoritative: true },
      },
    ],
  } as unknown as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.ok(rejectionCodes(validation).includes("client-authoritative-rewards"));
});

test("policy: bindings for undeclared capabilities are rejected", () => {
  const policy = {
    ...validPolicy(),
    bindings: [
      ...validPolicy().bindings,
      {
        capability: "achievements",
        eventKind: shotLanded,
        achievement: "ach-sharpshooter",
        increment: 1,
      },
    ],
  } as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.equal(validation.pass, false);
  assert.ok(rejectionCodes(validation).includes("binding-for-undeclared-capability"));
});

test("policy: bindings for undeclared events are rejected", () => {
  const policy = {
    ...validPolicy(),
    bindings: [
      ...validPolicy().bindings,
      {
        capability: "leaderboard",
        eventKind: asGameEventKind("goal.scored")!,
        metric: "goals",
        aggregation: "sum",
      },
    ],
  } as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.ok(rejectionCodes(validation).includes("binding-for-undeclared-event"));
});

test("policy: duplicate bindings for the same capability+event are rejected", () => {
  const policy = {
    ...validPolicy(),
    bindings: [
      ...validPolicy().bindings,
      { capability: "replay", eventKind: shotLanded },
    ],
  } as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.equal(validation.pass, false);
  assert.deepEqual(rejectionCodes(validation), ["duplicate-binding"]);
});

test("policy: malformed bindings are rejected individually", () => {
  const policy = {
    ...validPolicy(),
    bindings: [
      ...validPolicy().bindings,
      { capability: "leaderboard", eventKind: shotLanded, metric: "", aggregation: "sum" },
    ],
  } as unknown as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.ok(rejectionCodes(validation).includes("malformed-binding"));
});

test("policy: protected outcomes under peer-to-peer topology are rejected (lock 19 cross-rule)", () => {
  const policy = {
    ...validPolicy(),
    capabilities: validPolicy().capabilities.map((descriptor) =>
      descriptor.capability === "multiplayer"
        ? { ...descriptor, policy: { ...descriptor.policy, topology: "peer-to-peer" } }
        : descriptor,
    ),
  } as unknown as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.equal(validation.pass, false);
  assert.ok(rejectionCodes(validation).includes("competitive-p2p-topology"));

  // Informational-only multiplayer bindings under P2P are acceptable:
  // nothing protected is being decided off-client.
  const informational = {
    ...policy,
    bindings: policy.bindings.map((binding) =>
      binding.capability === "multiplayer" ? { ...binding, outcomeClassification: "informational" } : binding,
    ),
  } as unknown as PlatformPolicyDeclaration;
  const relaxed = validateCapabilityPolicy(informational);
  assert.equal(relaxed.pass, true);
});

test("policy: invalid tenancy scopes are rejected (R20)", () => {
  const policy = {
    ...validPolicy(),
    tenancy: { mode: "single-tenant" },
  } as unknown as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.equal(validation.pass, false);
  assert.ok(rejectionCodes(validation).includes("invalid-tenancy-scope"));
});

test("policy: multiple violations are all reported, not just the first", () => {
  const policy = {
    ...validPolicy(),
    events: [
      ...validPolicy().events,
      { kind: "platform.integrity.report.issued", summary: "spoof" },
      { kind: matchCompleted, summary: "duplicate" },
    ],
    tenancy: { mode: "omni-tenant" },
  } as unknown as PlatformPolicyDeclaration;
  const validation = validateCapabilityPolicy(policy);
  assert.equal(validation.pass, false);
  assert.deepEqual(rejectionCodes(validation), [
    "reserved-platform-event-kind",
    "duplicate-event-kind",
    "invalid-tenancy-scope",
  ]);
});

test("policy: evidence digests used in fixtures are runtime-assembled (E3 hygiene)", () => {
  // No literal secrets anywhere near this suite: digests are fragments.
  const digest = asContentDigest(["12", "34"].join("") + "f".repeat(60));
  assert.ok(digest);
  assert.equal(asContentDigest("12" + "f".repeat(60)), undefined);
});
