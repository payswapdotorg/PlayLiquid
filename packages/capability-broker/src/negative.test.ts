/**
 * E8 MANDATORY NEGATIVE TESTS: anti-gaming, privilege escalation and
 * fail-closed behavior of the broker boundary. Every test asserts a
 * REFUSAL, never a silent success.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityBroker } from "./broker.ts";
import { brokerPolicy, deriveBrokerPolicy } from "./policy.ts";
import { ManualBrokerClock, actionRequest, makeGrant, moveIntent } from "./fakes.ts";
import { capId, grantId } from "./fakes.ts";
import {
  DEMO_ACTOR,
  DEMO_MANIPULATION_CAPABILITY,
  DEMO_MOVEMENT_CAPABILITY,
  DEMO_SENSORY_OUTPUT_CAPABILITY,
  DEMO_SESSION,
  demoCoverage,
  demoGameDocument,
} from "./demo.ts";
import { asSessionEpoch, asSessionId, asTick } from "@playliquid/runtime-contracts";

function broker(): CapabilityBroker {
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  return new CapabilityBroker({ policy: derived.policy, clock: new ManualBrokerClock(0) });
}

test("negative: a grant id cannot be minted twice (grant forgery by replay)", () => {
  const b = broker();
  const grant = makeGrant({ holder: DEMO_ACTOR, scope: { sessionId: DEMO_SESSION } });
  assert.equal(b.admit({ grant }).ok, true);
  const replay = b.admit({ grant });
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.code, "duplicate-grant-id");
});

test("negative: expired grants deny at evaluation AND are swept by the bookkeeping path", () => {
  const b = broker();
  b.admit({
    grant: makeGrant({
      grantId: grantId("short-lived"),
      holder: DEMO_ACTOR,
      expiresAfterTick: asTick(5),
      scope: { sessionId: DEMO_SESSION },
    }),
  });
  const atFive = b.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "a"), grantId("short-lived"), "a"),
    { sessionId: DEMO_SESSION, epoch: asSessionEpoch(1), tick: asTick(5) },
  );
  assert.equal(atFive.status, "granted", "void only strictly AFTER tick 5");
  const atSix = b.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "b"), grantId("short-lived"), "b"),
    { sessionId: DEMO_SESSION, epoch: asSessionEpoch(1), tick: asTick(6) },
  );
  assert.equal(atSix.status, "denied");
  if (atSix.status === "denied") assert.equal(atSix.reason, "grant-expired-tick");
  const swept = b.sweep(asTick(6));
  assert.deepEqual(swept.map(String), ["short-lived"]);
});

test("negative: total-count budget cannot be reset by tick regression (E8)", () => {
  const b = broker();
  b.admit({
    grant: makeGrant({
      grantId: grantId("limited"),
      holder: DEMO_ACTOR,
      constraints: [{ kind: "total-count", max: 1 }],
      scope: { sessionId: DEMO_SESSION },
    }),
  });
  const first = b.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "a"), grantId("limited"), "a"),
    { sessionId: DEMO_SESSION, epoch: asSessionEpoch(1), tick: asTick(10) },
  );
  assert.equal(first.status, "granted");
  // Replaying the SAME idempotency key at an EARLIER tick is a probe for
  // counter reset; the ledger refuses time regression outright.
  const replayedBackwards = b.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "a"), grantId("limited"), "a"),
    { sessionId: DEMO_SESSION, epoch: asSessionEpoch(1), tick: asTick(9) },
  );
  assert.equal(replayedBackwards.status, "denied");
  if (replayedBackwards.status === "denied") {
    assert.equal(replayedBackwards.reason, "budget-exhausted", "tick-regression folds into a refusal");
  }
});

test("negative: rate windows cannot be outrun by burst submission (E8)", () => {
  const b = broker();
  b.admit({
    grant: makeGrant({
      grantId: grantId("paced"),
      holder: DEMO_ACTOR,
      constraints: [{ kind: "rate-per-ticks", max: 1, windowTicks: 10 }],
      scope: { sessionId: DEMO_SESSION },
    }),
  });
  const at = (tick: number, nonce: string) =>
    b.evaluate(
      actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, nonce), grantId("paced"), nonce),
      { sessionId: DEMO_SESSION, epoch: asSessionEpoch(1), tick: asTick(tick) },
    );
  assert.equal(at(5, "a").status, "granted");
  assert.equal(at(7, "b").status, "denied", "same window is capped");
  assert.equal(at(7, "c").status, "denied");
  assert.equal(at(15, "d").status, "granted", "window rolls only at anchor+10");
});

test("negative: cross-session grant reuse is refused (session scoping)", () => {
  const b = broker();
  b.admit({ grant: makeGrant({ holder: DEMO_ACTOR, scope: { sessionId: DEMO_SESSION } }) });
  const foreign = b.evaluate(
    actionRequest(asSessionId("attacker-session"), DEMO_ACTOR, moveIntent(DEMO_ACTOR, "x"), grantId("grant-1"), "x"),
    { sessionId: asSessionId("attacker-session"), epoch: asSessionEpoch(1), tick: asTick(1) },
  );
  assert.equal(foreign.status, "denied");
  if (foreign.status === "denied") assert.equal(foreign.reason, "grant-wrong-session");
});

test("negative: grants from a stale epoch never act after a reset/restore (stale-result rule)", () => {
  const b = broker();
  b.admit({ grant: makeGrant({ holder: DEMO_ACTOR, scope: { sessionId: DEMO_SESSION } }) });
  const nextEpoch = b.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "x"), grantId("grant-1"), "x"),
    { sessionId: DEMO_SESSION, epoch: asSessionEpoch(2), tick: asTick(1) },
  );
  assert.equal(nextEpoch.status, "denied");
  if (nextEpoch.status === "denied") assert.equal(nextEpoch.reason, "grant-epoch-stale");
});

test("negative: least privilege — denied capability admits no grant even with approval", () => {
  const b = broker();
  const result = b.admit({
    grant: makeGrant({ capability: DEMO_SENSORY_OUTPUT_CAPABILITY, scope: { sessionId: DEMO_SESSION } }),
    approvedByHost: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "capability-denied");
});

test("negative: unknown capability grants are refused (no policy = no authority)", () => {
  const b = broker();
  const result = b.admit({
    grant: makeGrant({ capability: capId("avatar.time-travel"), scope: { sessionId: DEMO_SESSION } }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "unknown-capability");
});

test("negative: approval-required capability refuses unmarked admission", () => {
  const b = broker();
  const result = b.admit({
    grant: makeGrant({ capability: DEMO_MANIPULATION_CAPABILITY, scope: { sessionId: DEMO_SESSION } }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "approval-required");
});

test("negative: failed admission leaves the table unchanged (no partial writes)", () => {
  const b = broker();
  const before = b.grants.length;
  b.admit({ grant: makeGrant({ capability: capId("avatar.telepathy"), scope: { sessionId: DEMO_SESSION } }) });
  b.admit({ grant: makeGrant({ capability: DEMO_SENSORY_OUTPUT_CAPABILITY, scope: { sessionId: DEMO_SESSION } }) });
  assert.equal(b.grants.length, before, "refusals never mutate the authoritative table");
});

test("negative: policy derivation is fail-closed on unadjudicatable intents", () => {
  const result = deriveBrokerPolicy(demoGameDocument(), [
    { capability: DEMO_MOVEMENT_CAPABILITY, intentKinds: ["move.to", "wish.impossible"], commandKindByIntent: { "move.to": "world.move", "wish.impossible": "world.wish" } },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "intent-not-handled-by-rules");
});

test("negative: direct builder refuses gaps between coverage and command mapping", () => {
  const result = brokerPolicy([
    { capability: DEMO_MOVEMENT_CAPABILITY, intentKinds: ["move.to"], commandKindByIntent: {} },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "intent-without-command-kind");
});
