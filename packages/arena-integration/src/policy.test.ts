import { test } from "node:test";
import assert from "node:assert/strict";
import { allowAllArenaPolicy, denyAllArenaPolicy, scopeLimitArenaPolicy } from "./policy.ts";
import { arenaAuthorizationScope } from "./authorization.ts";
import type { ArenaRequestEnvelope, ArenaRequestKind } from "./request.ts";
import type { ArenaContentDigest, ArenaEndpointRef } from "./primitives.ts";

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

function fixtureEndpoint(seed: string): ArenaEndpointRef {
  return { refKind: "arena-endpoint", endpointDigest: fixtureDigest(seed) };
}

function fixtureCandidate(
  overrides: { requestKind?: ArenaRequestKind; endpointSeed?: string } = {},
): ArenaRequestEnvelope {
  const requestKind = overrides.requestKind ?? "result";
  return {
    envelopeKind: "arena-request",
    requestKind,
    cycle: {
      requestPayload: fixtureDigest("a1"),
      gapSummary: fixtureDigest("b1"),
      authorization: arenaAuthorizationScope(requestKind === "artifact.skill" ? ["skill"] : []),
    },
    endpoint: fixtureEndpoint(overrides.endpointSeed ?? "e1"),
  };
}

test("policy: allow-all and deny-all fakes are deterministic", () => {
  const allow = allowAllArenaPolicy("fake-allow-all");
  const deny = denyAllArenaPolicy("fake-deny-all", "endpoint-not-permitted");
  const candidate = fixtureCandidate();

  assert.deepEqual(allow.decide(candidate), { allowed: true });
  assert.deepEqual(allow.decide(candidate), { allowed: true });
  assert.deepEqual(deny.decide(candidate), { allowed: false, reason: "endpoint-not-permitted" });
  assert.equal(String(allow.policyId), "fake-allow-all");
});

test("policy: fake constructors reject malformed policy ids", () => {
  assert.throws(() => allowAllArenaPolicy("Not A Slug"), /invalid Arena policy id/);
  assert.throws(() => denyAllArenaPolicy("", "endpoint-not-permitted"), /invalid Arena policy id/);
});

test("policy: scope-limit policy enforces kinds, artifact classes and endpoints", () => {
  const policy = scopeLimitArenaPolicy("fake-scope-limit", {
    allowedKinds: ["result", "artifact.skill"],
    allowedArtifactClasses: ["skill"],
    allowedEndpoints: [fixtureEndpoint("e1")],
  });

  // In-config candidate: allowed.
  assert.deepEqual(policy.decide(fixtureCandidate({ requestKind: "result" })), { allowed: true });
  assert.deepEqual(policy.decide(fixtureCandidate({ requestKind: "artifact.skill" })), { allowed: true });

  // Out-of-config kind: refused.
  assert.deepEqual(policy.decide(fixtureCandidate({ requestKind: "evidence" })), {
    allowed: false,
    reason: "request-kind-not-permitted",
  });

  // Artifact class outside the allowed set: refused.
  const toolPolicy = scopeLimitArenaPolicy("fake-tool-limit", { allowedArtifactClasses: ["tool"] });
  assert.deepEqual(toolPolicy.decide(fixtureCandidate({ requestKind: "artifact.skill" })), {
    allowed: false,
    reason: "artifact-class-not-permitted",
  });

  // Endpoint outside the allowed set: refused.
  assert.deepEqual(policy.decide(fixtureCandidate({ endpointSeed: "e2" })), {
    allowed: false,
    reason: "endpoint-not-permitted",
  });
});

test("policy: undefined config lists mean unrestricted", () => {
  const policy = scopeLimitArenaPolicy("fake-open", {});
  assert.deepEqual(policy.decide(fixtureCandidate()), { allowed: true });
  assert.deepEqual(policy.decide(fixtureCandidate({ requestKind: "evidence" })), { allowed: true });
  assert.deepEqual(policy.decide(fixtureCandidate({ endpointSeed: "e9" })), { allowed: true });
});

test("policy: decisions are pure folds of the candidate (no state, no drift)", () => {
  const policy = scopeLimitArenaPolicy("fake-stable", { allowedKinds: ["result"] });
  const candidate = fixtureCandidate();
  const first = policy.decide(candidate);
  const second = policy.decide(candidate);
  const third = policy.decide(structuredClone(candidate));
  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
});
