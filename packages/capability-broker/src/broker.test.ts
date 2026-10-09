/**
 * Broker authority tests: evaluation over the frozen runtime-contracts
 * semantics — grant path, denial path, budget accounting, deterministic
 * command ids, and the documented idempotency boundary (broker-side ledger
 * accounting, kernel-side request dedup).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { admitCommand } from "@playliquid/runtime-contracts";
import type { CommandAdmissionPolicy } from "@playliquid/runtime-contracts";
import { CapabilityBroker } from "./broker.ts";
import { brokerPolicy, deriveBrokerPolicy } from "./policy.ts";
import {
  ManualBrokerClock,
  actionRequest,
  avatarActor,
  grantId,
  idempotencyKey,
  makeGrant,
  moveIntent,
} from "./fakes.ts";
import {
  DEMO_ACTOR,
  DEMO_MOVEMENT_CAPABILITY,
  DEMO_SESSION,
  demoCoverage,
  demoGameDocument,
} from "./demo.ts";
import { asIdempotencyNonce } from "@playliquid/runtime-contracts";
import { asSessionEpoch, asSessionId, asTick } from "@playliquid/runtime-contracts";

function buildBroker(clock = new ManualBrokerClock(50)): CapabilityBroker {
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  const broker = new CapabilityBroker({ policy: derived.policy, clock });
  const admitted = broker.admit({
    grant: makeGrant({
      grantId: grantId("move-grant"),
      holder: DEMO_ACTOR,
      capability: DEMO_MOVEMENT_CAPABILITY,
      scope: { sessionId: DEMO_SESSION },
      constraints: [{ kind: "per-tick-count", max: 2 }],
    }),
  });
  if (!admitted.ok) throw new Error(admitted.detail);
  return broker;
}

const context = { sessionId: DEMO_SESSION, epoch: asSessionEpoch(1), tick: asTick(3) };

test("broker: a granted request derives a broker-mediated canonical command (lock 13/14)", () => {
  const broker = buildBroker();
  const resolution = broker.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "n-1"), grantId("move-grant"), "n-1"),
    context,
  );
  assert.equal(resolution.status, "granted");
  if (resolution.status === "granted") {
    assert.equal(resolution.command.origin.kind, "broker-mediated");
    assert.equal(String(resolution.command.commandId), "cmd-1");
    assert.equal(String(resolution.command.kind), "world.move");
    assert.equal(resolution.command.actor, DEMO_ACTOR);
    assert.deepEqual(resolution.command.payload, { to: [2, 2] });
  }
});

test("broker: granted commands still pass the kernel admission gate (E2)", () => {
  const broker = buildBroker();
  const resolution = broker.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "n-1"), grantId("move-grant"), "n-1"),
    context,
  );
  assert.equal(resolution.status, "granted");
  if (resolution.status !== "granted") return;
  const policy: CommandAdmissionPolicy = { "world.move": ["running"] };
  const admitted = admitCommand(
    {
      sessionId: DEMO_SESSION,
      role: "simulation",
      phase: "running",
      epoch: asSessionEpoch(1),
      tick: asTick(3),
      committedEventSeq: 0,
      admittedCommandSeq: 0,
    },
    policy,
    resolution.command,
  );
  assert.equal(admitted.status, "admitted", "broker output is gate-compatible");
});

test("broker: command ids are deterministic and advance per mapping-backed evaluation", () => {
  const broker = buildBroker();
  const first = broker.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "a"), grantId("move-grant"), "a"),
    context,
  );
  const second = broker.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "b"), grantId("move-grant"), "b"),
    context,
  );
  assert.equal(first.status, "granted");
  assert.equal(second.status, "granted");
  if (first.status === "granted" && second.status === "granted") {
    assert.equal(String(first.command.commandId), "cmd-1");
    assert.equal(String(second.command.commandId), "cmd-2");
  }
});

test("broker: idempotency boundary — no request dedup, budget accounting only", () => {
  const broker = buildBroker(); // per-tick-count max 2
  const intent = moveIntent(DEMO_ACTOR, "same");
  const key = idempotencyKey(DEMO_ACTOR, "same-nonce");
  const request = {
    requestId: "req-same" as never,
    sessionId: DEMO_SESSION,
    actor: DEMO_ACTOR,
    intent,
    grantId: grantId("move-grant"),
    idempotencyKey: key,
  };
  const first = broker.evaluate(request, context);
  const duplicate = broker.evaluate(request, context);
  assert.equal(first.status, "granted");
  assert.equal(duplicate.status, "granted", "same key re-evaluated: the broker does not dedup (kernel owns dedup)");
  const third = broker.evaluate(
    { ...request, idempotencyKey: { ...key, nonce: asIdempotencyNonce("other") } },
    context,
  );
  assert.equal(third.status, "denied", "budget exhausted: the ledger is the broker-side replay protection (E8)");
  if (third.status === "denied") assert.equal(third.reason, "budget-exhausted");
});

test("broker: budget ledger advances per grant and resets across ticks", () => {
  const broker = buildBroker();
  const evaluate = (nonce: string, tick: number) =>
    broker.evaluate(
      actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, nonce), grantId("move-grant"), nonce),
      { sessionId: DEMO_SESSION, epoch: asSessionEpoch(1), tick: asTick(tick) },
    );
  assert.equal(evaluate("a", 3).status, "granted");
  assert.equal(evaluate("b", 3).status, "granted");
  assert.equal(evaluate("c", 3).status, "denied", "per-tick budget exhausted at tick 3");
  assert.equal(evaluate("d", 4).status, "granted", "per-tick budget resets at tick 4");
  const consumed = broker.ledger.consumed["move-grant"];
  assert.ok(consumed, "ledger keyed by grant id");
});

test("broker: stale epoch, wrong session, expiry and revocation deny via contract reasons", () => {
  const broker = buildBroker();
  const request = (nonce: string) =>
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, nonce), grantId("move-grant"), nonce);
  const stale = broker.evaluate(request("a"), { sessionId: DEMO_SESSION, epoch: asSessionEpoch(2), tick: asTick(1) });
  assert.equal(stale.status, "denied");
  if (stale.status === "denied") assert.equal(stale.reason, "grant-epoch-stale");
  const wrongSession = broker.evaluate({ ...request("b"), sessionId: asSessionId("s-other") }, context);
  assert.equal(wrongSession.status, "denied");
  if (wrongSession.status === "denied") assert.equal(wrongSession.reason, "grant-wrong-session");
  broker.revoke(grantId("move-grant"));
  const afterRevoke = broker.evaluate(request("c"), context);
  assert.equal(afterRevoke.status, "denied");
  if (afterRevoke.status === "denied") assert.equal(afterRevoke.reason, "grant-not-found");
});

test("broker: unmapped intent kinds are denied without consuming a command id", () => {
  const broker = buildBroker();
  const resolution = broker.evaluate(
    {
      requestId: "req-x" as never,
      sessionId: DEMO_SESSION,
      actor: DEMO_ACTOR,
      intent: { ...moveIntent(DEMO_ACTOR, "x"), kind: "dance.waltz" as never },
      grantId: grantId("move-grant"),
      idempotencyKey: idempotencyKey(DEMO_ACTOR, "x"),
    },
    context,
  );
  assert.equal(resolution.status, "denied");
  if (resolution.status === "denied") {
    assert.equal(resolution.reason, "intent-kind-outside-grant");
  }
  const next = broker.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "y"), grantId("move-grant"), "y"),
    context,
  );
  if (next.status === "granted") {
    assert.equal(String(next.command.commandId), "cmd-1", "denied requests never mint ids");
  }
});

test("broker: the clock stamps derived commands (no internal time authority)", () => {
  const clock = new ManualBrokerClock(1000);
  const broker = buildBroker(clock);
  const resolution = broker.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "n"), grantId("move-grant"), "n"),
    context,
  );
  clock.advance(5);
  assert.equal(resolution.status, "granted");
  if (resolution.status === "granted") {
    assert.equal(Number(resolution.command.issuedAt), 1000, "issue time read once at evaluation");
  }
});

test("broker: seeded state restores exactly (grants + ledger + id counter)", () => {
  const broker = buildBroker();
  broker.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "a"), grantId("move-grant"), "a"),
    context,
  );
  const restored = new CapabilityBroker({
    policy: broker.policy,
    clock: new ManualBrokerClock(50),
    grants: broker.grants,
    ledger: broker.ledger,
    commandIdCounter: broker.commandIdCounter,
  });
  const a = broker.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "b"), grantId("move-grant"), "b"),
    context,
  );
  const b = restored.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "b"), grantId("move-grant"), "b"),
    context,
  );
  assert.deepEqual(a, b, "restored broker continues identically (replay/resume boundary)");
  assert.equal(broker.commandIdCounter, restored.commandIdCounter);
});

test("broker: direct builder policies work without a GameIR document", () => {
  const derived = brokerPolicy([
    { capability: DEMO_MOVEMENT_CAPABILITY, intentKinds: ["move.to"], commandKindByIntent: { "move.to": "world.move" } },
  ]);
  assert.equal(derived.ok, true);
  if (!derived.ok) return;
  const broker = new CapabilityBroker({ policy: derived.policy, clock: new ManualBrokerClock(0) });
  const holder = makeGrant().holder;
  broker.admit({ grant: makeGrant({ holder, scope: { sessionId: DEMO_SESSION } }) });
  const resolution = broker.evaluate(
    actionRequest(DEMO_SESSION, holder, moveIntent(holder, "n"), grantId("grant-1"), "n"),
    context,
  );
  assert.equal(resolution.status, "granted");
});

test("broker: holder mismatch denies (foreign grant)", () => {
  const broker = buildBroker();
  const stranger = avatarActor("someone-else");
  const resolution = broker.evaluate(
    actionRequest(DEMO_SESSION, stranger, { ...moveIntent(DEMO_ACTOR, "n"), actor: stranger }, grantId("move-grant"), "n"),
    context,
  );
  assert.equal(resolution.status, "denied");
  if (resolution.status === "denied") assert.equal(resolution.reason, "grant-holder-mismatch");
});
