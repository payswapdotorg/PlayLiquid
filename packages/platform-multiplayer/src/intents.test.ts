/**
 * Typed intent admission tests: schema violations, unknown kinds, origin
 * policy (intent rule + topology), origin/actor consistency, and the
 * derived canonical command admission policy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCommandAdmissionPolicy,
  intentKindsAligned,
  validateIntentSubmission,
} from "./intents.ts";
import type { IntentSubmission } from "./intents.ts";
import {
  createFakeIntentRules,
  createFakeIntentSchemas,
  createFakeSimulator,
  FAKE_EVENT_KINDS,
} from "./fakes.ts";
import { topologyRules } from "./topology.ts";
import {
  asActorId,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import { asGameEventKind } from "@playliquid/platform-contracts";

const schemas = createFakeIntentSchemas();
const rules = createFakeIntentRules();
const dedicated = topologyRules("dedicated-server");
const playerActor = { actorClass: "player" as const, actorId: asActorId("player:player-one") };
const hostActor = { actorClass: "host-authority" as const, actorId: asActorId("host-1") };
const systemActor = { actorClass: "platform-system" as const, actorId: asActorId("sys-1") };

function submission(over: Record<string, unknown> = {}): IntentSubmission {
  return {
    intent: {
      intentId: asIntentId("intent-1"),
      kind: asIntentKind("match.move"),
      actor: playerActor,
      payload: { dx: 1, dy: 2 },
      issuedAt: asTimestamp(0),
    },
    origin: { kind: "player-input" },
    observedEpoch: asSessionEpoch(1),
    idempotencyKey: { scope: "command", actor: playerActor.actorId, nonce: asIdempotencyNonce("n-1") },
    ...over,
  } as IntentSubmission;
}

test("intents: a well-formed player submission validates", () => {
  assert.deepEqual(validateIntentSubmission(submission(), schemas, rules, dedicated), { ok: true });
});

test("intents: unknown intent kinds are refused before anything else", () => {
  const result = validateIntentSubmission(
    submission({ intent: { ...submission().intent, kind: asIntentKind("match.teleport") } }),
    schemas,
    rules,
    dedicated,
  );
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "unknown-intent-kind");
});

test("intents: payload schema violations are refused (typed admission)", () => {
  for (const badPayload of [{ dx: 999, dy: 0 }, { dx: 1 }, "not-an-object", { dx: 1.5, dy: 0 }]) {
    const result = validateIntentSubmission(
      submission({ intent: { ...submission().intent, payload: badPayload } }),
      schemas,
      rules,
      dedicated,
    );
    assert.ok(!result.ok, `payload ${JSON.stringify(badPayload)} must fail the schema`);
    assert.equal(result.failure.code, "payload-schema-violation");
  }
});

test("intents: origins not admitted by the intent rule are refused", () => {
  const result = validateIntentSubmission(
    submission({ origin: { kind: "platform-system" } }),
    schemas,
    rules,
    dedicated,
  );
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "origin-not-admitted-by-intent-rule");
});

test("intents: origins not admitted by the TOPOLOGY are refused even if the rule allows them", () => {
  const hostRule = {
    intentKind: asIntentKind("match.move"),
    commandKind: asIntentKind("match.move") as never,
    admittedOrigins: ["player-input", "host-authority"] as const,
    maxPerTickPerActor: 2,
  };
  const p2p = topologyRules("peer-to-peer");
  const result = validateIntentSubmission(
    submission({ origin: { kind: "host-authority" }, intent: { ...submission().intent, actor: hostActor } }),
    schemas,
    [hostRule],
    p2p,
  );
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "origin-not-admitted-by-topology", "P2P admits no host authority");
});

test("intents: dedicated-server refuses host-authority gameplay input too", () => {
  const hostRule = {
    intentKind: asIntentKind("match.move"),
    commandKind: asIntentKind("match.move") as never,
    admittedOrigins: ["host-authority"] as const,
    maxPerTickPerActor: 2,
  };
  const result = validateIntentSubmission(
    submission({ origin: { kind: "host-authority" }, intent: { ...submission().intent, actor: hostActor } }),
    schemas,
    [hostRule],
    dedicated,
  );
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "origin-not-admitted-by-topology");
});

test("intents: platform-system origin requires a platform-system actor", () => {
  const systemRule = {
    intentKind: asIntentKind("match.move"),
    commandKind: asIntentKind("match.move") as never,
    admittedOrigins: ["platform-system"] as const,
    maxPerTickPerActor: 2,
  };
  const result = validateIntentSubmission(
    submission({ origin: { kind: "platform-system" } }),
    schemas,
    [systemRule],
    dedicated,
  );
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "origin-actor-inconsistent");

  const honest = validateIntentSubmission(
    submission({
      origin: { kind: "platform-system" },
      intent: { ...submission().intent, actor: systemActor },
    }),
    schemas,
    [systemRule],
    dedicated,
  );
  assert.deepEqual(honest, { ok: true });
});

test("intents: schemas and rules must be 1:1 aligned", () => {
  assert.equal(intentKindsAligned(schemas, rules), true);
  assert.equal(intentKindsAligned(schemas, rules.slice(0, 1)), false);
  assert.equal(intentKindsAligned(schemas.slice(0, 1), rules), false);
});

test("intents: command admission policy maps kinds onto ready+running (E2)", () => {
  const policy = deriveCommandAdmissionPolicy(rules);
  assert.deepEqual(policy["match.move"], ["ready", "running"]);
  assert.deepEqual(policy["match.fire"], ["ready", "running"]);
  assert.equal(policy["match.unknown"], undefined);
});

test("intents: fake vocabulary stays internally consistent", () => {
  const simulator = createFakeSimulator();
  const boot = simulator.initial({
    sessionId: "s" as never,
    determinism: "seed" as never,
  });
  assert.deepEqual(boot.positions, {});
  assert.equal(boot.steps, 0);
  assert.ok(Number.isSafeInteger(boot.drift));
  assert.notEqual(asGameEventKind(FAKE_EVENT_KINDS.moved), undefined);
});
