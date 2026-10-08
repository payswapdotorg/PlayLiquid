/**
 * CapabilityPort seam tests: the GrantTableCapabilityPort fake (contract's
 * pure evaluator over caller-owned read models), grant dynamics, budgets,
 * deterministic command minting, and the denial surface of the seam.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_BUDGET_LEDGER,
  asActionRequestId,
  asCapabilityGrantId,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
  asTick,
} from "@playliquid/runtime-contracts";
import type { ActionRequest, CapabilityGrant } from "@playliquid/runtime-contracts";
import { GrantTableCapabilityPort, ManualClock, avatarActor, interactiveDescriptor, playerActor } from "./fakes.ts";

const SESSION = interactiveDescriptor("cap-port-1").sessionId;

function makeGrant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    grantId: asCapabilityGrantId("grant-1"),
    holder: avatarActor("avatar-1"),
    capability: "world.counter" as never,
    scope: { sessionId: SESSION },
    constraints: [{ kind: "per-tick-count", max: 2 }],
    issuedBy: "host-game-policy",
    epoch: asSessionEpoch(1),
    ...overrides,
  };
}

function makeRequest(payload: { by: number }, grantId = "grant-1"): ActionRequest<{ by: number }> {
  return {
    requestId: asActionRequestId("req-1"),
    sessionId: SESSION,
    actor: avatarActor("avatar-1"),
    intent: {
      intentId: asIntentId("i-1"),
      kind: asIntentKind("world.increment"),
      actor: avatarActor("avatar-1"),
      payload,
      issuedAt: 0 as never,
    },
    grantId: asCapabilityGrantId(grantId),
    idempotencyKey: { scope: "command", actor: avatarActor("avatar-1").actorId, nonce: asIdempotencyNonce("n-1") },
  };
}

function makePort(grants: readonly CapabilityGrant[] = [makeGrant()]) {
  const clock = new ManualClock(500);
  const port = new GrantTableCapabilityPort({
    grants,
    capabilityIntentKinds: { "world.counter": [asIntentKind("world.increment")] },
    intentCommandKinds: { "world.increment": "world.increment" },
    clock,
  });
  return { port, clock };
}

test("seam: granted requests derive broker-mediated canonical commands", () => {
  const { port } = makePort();
  const resolution = port.evaluate(makeRequest({ by: 3 }), { sessionId: SESSION, epoch: asSessionEpoch(1), tick: asTick(0) });
  assert.equal(resolution.status, "granted");
  if (resolution.status === "granted") {
    assert.equal(String(resolution.command.commandId), "cmd-1");
    assert.deepEqual(resolution.command.origin, { kind: "broker-mediated", grantId: asCapabilityGrantId("grant-1") });
    assert.equal(String(resolution.command.kind), "world.increment");
    assert.deepEqual(resolution.command.payload, { by: 3 });
    assert.equal(resolution.command.epoch, 1);
  }
});

test("seam: command ids are minted deterministically in sequence", () => {
  const { port } = makePort();
  const first = port.evaluate(makeRequest({ by: 1 }), { sessionId: SESSION, epoch: asSessionEpoch(1), tick: asTick(0) });
  const second = port.evaluate(
    { ...makeRequest({ by: 2 }), idempotencyKey: { scope: "command", actor: avatarActor("avatar-1").actorId, nonce: asIdempotencyNonce("n-2") } },
    { sessionId: SESSION, epoch: asSessionEpoch(1), tick: asTick(0) },
  );
  if (first.status === "granted" && second.status === "granted") {
    assert.equal(String(first.command.commandId), "cmd-1");
    assert.equal(String(second.command.commandId), "cmd-2");
  } else {
    assert.fail("both should be granted");
  }
});

test("seam: denied requests carry typed reasons and no command", () => {
  const { port } = makePort([]);
  const resolution = port.evaluate(makeRequest({ by: 1 }), { sessionId: SESSION, epoch: asSessionEpoch(1), tick: asTick(0) });
  assert.equal(resolution.status, "denied");
  if (resolution.status === "denied") {
    assert.equal(resolution.reason, "grant-not-found");
    assert.equal(typeof resolution.detail, "string");
  }
});

test("seam: budget consumption is broker-owned state, visible via ledger", () => {
  const { port } = makePort([makeGrant({ constraints: [{ kind: "per-tick-count", max: 2 }] })]);
  const ctx = { sessionId: SESSION, epoch: asSessionEpoch(1), tick: asTick(4) };
  assert.equal(port.evaluate(makeRequest({ by: 1 }), ctx).status, "granted");
  assert.equal(port.evaluate({ ...makeRequest({ by: 1 }), idempotencyKey: { scope: "command", actor: avatarActor("avatar-1").actorId, nonce: asIdempotencyNonce("n-2") } }, ctx).status, "granted");
  const third = port.evaluate({ ...makeRequest({ by: 1 }), idempotencyKey: { scope: "command", actor: avatarActor("avatar-1").actorId, nonce: asIdempotencyNonce("n-3") } }, ctx);
  assert.equal(third.status, "denied");
  if (third.status === "denied") assert.equal(third.reason, "budget-exhausted");
  // At a NEW tick the per-tick window re-opens.
  const nextTick = { sessionId: SESSION, epoch: asSessionEpoch(1), tick: asTick(5) };
  assert.equal(port.evaluate({ ...makeRequest({ by: 1 }), idempotencyKey: { scope: "command", actor: avatarActor("avatar-1").actorId, nonce: asIdempotencyNonce("n-4") } }, nextTick).status, "granted");
});

test("seam: issueGrant and revokeGrant manage the broker-owned table", () => {
  const { port } = makePort([]);
  const ctx = { sessionId: SESSION, epoch: asSessionEpoch(1), tick: asTick(0) };
  assert.equal(port.evaluate(makeRequest({ by: 1 }), ctx).status, "denied");
  port.issueGrant(makeGrant());
  assert.equal(port.evaluate(makeRequest({ by: 1 }), ctx).status, "granted");
  assert.equal(port.revokeGrant(asCapabilityGrantId("grant-1")), true);
  assert.equal(port.revokeGrant(asCapabilityGrantId("grant-1")), false);
  assert.equal(port.evaluate(makeRequest({ by: 1 }), ctx).status, "denied");
});

test("seam: the fresh ledger starts empty and player actors never need the port", () => {
  const { port } = makePort();
  assert.deepEqual(port.ledger, EMPTY_BUDGET_LEDGER);
  // The port only serves avatar-agent action requests; players submit
  // direct-origin commands through the kernel (commands.ts contract).
  const request = makeRequest({ by: 1 });
  assert.equal(request.intent.actor.actorClass, "avatar-agent");
  assert.notEqual(playerActor("p").actorClass, "avatar-agent");
});

test("seam: unmapped intent kinds are denied without state changes", () => {
  const { port } = makePort();
  const request: ActionRequest = {
    ...makeRequest({ by: 1 }),
    intent: { ...makeRequest({ by: 1 }).intent, kind: asIntentKind("world.teleport") },
  };
  const resolution = port.evaluate(request, { sessionId: SESSION, epoch: asSessionEpoch(1), tick: asTick(0) });
  assert.equal(resolution.status, "denied");
  if (resolution.status === "denied") assert.equal(resolution.reason, "intent-kind-outside-grant");
  assert.deepEqual(port.ledger, EMPTY_BUDGET_LEDGER);
});
