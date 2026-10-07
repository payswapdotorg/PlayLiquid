import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_REQUEST_KINDS,
  ARENA_REQUEST_REJECTION_REASONS,
  arenaSendIdempotencyKey,
  arenaSendIdempotencyKeyEquals,
  arenaSendIdempotencyKeyText,
  checkArenaRequestEnvelopeCoherence,
  isArenaRequestCycleContext,
  isArenaRequestEnvelope,
  isArenaRequestKind,
  requestKindArtifactClass,
} from "./request.ts";
import type { ArenaRequestEnvelope, ArenaRequestKind } from "./request.ts";
import { arenaAuthorizationScope } from "./authorization.ts";
import type { ArenaArtifactClass } from "./authorization.ts";
import type { ArenaContentDigest, ArenaEndpointRef } from "./primitives.ts";

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

function fixtureEndpoint(seed: string): ArenaEndpointRef {
  return { refKind: "arena-endpoint", endpointDigest: fixtureDigest(seed) };
}

function fixtureEnvelope(overrides: {
  requestKind?: ArenaRequestKind;
  artifactClasses?: readonly ArenaArtifactClass[];
  payloadSeed?: string;
  gapSeed?: string;
} = {}): ArenaRequestEnvelope {
  return {
    envelopeKind: "arena-request",
    requestKind: overrides.requestKind ?? "result",
    cycle: {
      requestPayload: fixtureDigest(overrides.payloadSeed ?? "a1"),
      gapSummary: fixtureDigest(overrides.gapSeed ?? "b1"),
      authorization: arenaAuthorizationScope(overrides.artifactClasses ?? []),
    },
    endpoint: fixtureEndpoint("e1"),
  };
}

test("request: kind vocabulary is frozen, closed and return-class derived", () => {
  assert.deepEqual([...ARENA_REQUEST_KINDS.values], [
    "result",
    "evidence",
    "artifact.capability",
    "artifact.tool",
    "artifact.skill",
    "artifact.knowledge",
  ]);
  assert.ok(isArenaRequestKind("result"));
  assert.ok(isArenaRequestKind("artifact.knowledge"));
  assert.equal(isArenaRequestKind("artifact"), false);
  assert.equal(isArenaRequestKind("Result"), false);
  assert.equal(isArenaRequestKind("money"), false); // no value-shaped kinds
  assert.equal(isArenaRequestKind(undefined), false);
  assert.deepEqual([...ARENA_REQUEST_REJECTION_REASONS.values], [
    "artifact-scope-missing",
    "payload-gap-summary-collision",
    "malformed-envelope",
  ]);
});

test("request: artifact kinds map to their artifact class", () => {
  assert.equal(requestKindArtifactClass("result"), undefined);
  assert.equal(requestKindArtifactClass("evidence"), undefined);
  assert.equal(requestKindArtifactClass("artifact.capability"), "capability");
  assert.equal(requestKindArtifactClass("artifact.tool"), "tool");
  assert.equal(requestKindArtifactClass("artifact.skill"), "skill");
  assert.equal(requestKindArtifactClass("artifact.knowledge"), "knowledge");
});

test("request: cycle context and envelope structural guards", () => {
  const envelope = fixtureEnvelope();
  assert.ok(isArenaRequestCycleContext(envelope.cycle));
  assert.ok(isArenaRequestEnvelope(envelope));

  assert.equal(isArenaRequestEnvelope({ ...envelope, envelopeKind: "arena-response" }), false);
  assert.equal(
    isArenaRequestEnvelope({ ...envelope, cycle: { ...envelope.cycle, requestPayload: "sha256:nope" } }),
    false,
  );
  assert.equal(
    isArenaRequestEnvelope({ ...envelope, cycle: { ...envelope.cycle, gapSummary: 42 as never } }),
    false,
  );
  assert.equal(isArenaRequestEnvelope({ ...envelope, requestKind: "artifact" }), false);
  assert.equal(isArenaRequestEnvelope({ ...envelope, endpoint: { refKind: "other" } }), false);
  assert.equal(isArenaRequestEnvelope(null), false);
});

test("request: coherence requires artifact kinds to carry matching scope", () => {
  // Positive: non-artifact kinds need no artifact scope.
  assert.deepEqual(checkArenaRequestEnvelopeCoherence(fixtureEnvelope({ requestKind: "result" })), { coherent: true });
  assert.deepEqual(checkArenaRequestEnvelopeCoherence(fixtureEnvelope({ requestKind: "evidence" })), { coherent: true });

  // Positive: artifact kind with the matching authorized class.
  const scoped = fixtureEnvelope({ requestKind: "artifact.skill", artifactClasses: ["skill", "tool"] });
  assert.deepEqual(checkArenaRequestEnvelopeCoherence(scoped), { coherent: true });

  // Negative: artifact kind WITHOUT the matching authorized class.
  const unscoped = fixtureEnvelope({ requestKind: "artifact.skill", artifactClasses: ["tool"] });
  const unscopedResult = checkArenaRequestEnvelopeCoherence(unscoped);
  assert.ok(unscopedResult.coherent === false);
  assert.deepEqual([...unscopedResult.reasons], ["artifact-scope-missing"]);

  // Negative: artifact kind with the empty default scope.
  const noScope = checkArenaRequestEnvelopeCoherence(fixtureEnvelope({ requestKind: "artifact.knowledge" }));
  assert.ok(noScope.coherent === false);
  assert.ok(noScope.coherent === false && noScope.reasons.includes("artifact-scope-missing"));
});

test("request: coherence refuses payload/gap-summary digest collisions", () => {
  const collision = fixtureEnvelope({ requestKind: "result", payloadSeed: "same", gapSeed: "same" });
  const result = checkArenaRequestEnvelopeCoherence(collision);
  assert.ok(result.coherent === false);
  assert.deepEqual([...result.reasons], ["payload-gap-summary-collision"]);
});

test("request: coherence refuses malformed envelopes", () => {
  const malformed = checkArenaRequestEnvelopeCoherence({ nope: true });
  assert.ok(malformed.coherent === false);
  assert.deepEqual([...malformed.reasons], ["malformed-envelope"]);
});

test("request: send idempotency key is derived from endpoint + payload", () => {
  const a = fixtureEnvelope();
  const b = fixtureEnvelope(); // same content
  const otherPayload = fixtureEnvelope({ payloadSeed: "p2" });
  const otherEndpoint = { ...fixtureEnvelope(), endpoint: fixtureEndpoint("e2") };

  const keyA = arenaSendIdempotencyKey(a);
  assert.ok(arenaSendIdempotencyKeyEquals(keyA, arenaSendIdempotencyKey(b)));
  assert.equal(arenaSendIdempotencyKeyEquals(keyA, arenaSendIdempotencyKey(otherPayload)), false);
  assert.equal(arenaSendIdempotencyKeyEquals(keyA, arenaSendIdempotencyKey(otherEndpoint)), false);
  assert.equal(arenaSendIdempotencyKeyText(keyA), `${a.endpoint.endpointDigest}:${a.cycle.requestPayload}`);
  // Same key, different KIND is a distinct envelope under the same key: the
  // settle oracle in lifecycle.ts must refuse it as a collision (E8).
  const sameKeyDifferentKind = fixtureEnvelope({ requestKind: "evidence" });
  assert.ok(
    arenaSendIdempotencyKeyEquals(keyA, arenaSendIdempotencyKey(sameKeyDifferentKind)),
  );
  assert.notEqual(a.requestKind, sameKeyDifferentKind.requestKind);
});
