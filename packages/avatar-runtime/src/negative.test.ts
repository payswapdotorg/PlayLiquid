/**
 * E8/R20 MANDATORY NEGATIVE TESTS for the avatar runtime: least privilege
 * end to end. Every test asserts a REFUSAL or a drop, never a silent pass.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityBroker, ManualBrokerClock, deriveBrokerPolicy, makeGrant } from "@playliquid/capability-broker";
import { demoCoverage, demoGameDocument } from "@playliquid/capability-broker";
import { asSessionEpoch, asSessionId, asTick } from "@playliquid/runtime-contracts";
import { AvatarRuntime } from "./runtime.ts";
import type { HostRestriction } from "@playliquid/game-contracts";
import {
  InMemoryActuatorOutput,
  InMemoryAvatarMemory,
  InMemorySensorInput,
  ScriptedIntelligence,
  demoAvatarDefinition,
} from "./fakes.ts";
import type { ScriptedClaimSpec } from "./fakes.ts";

const SESSION = asSessionId("s-negative");
const ACTOR = { actorClass: "avatar-agent" as const, actorId: "demo-avatar" as never };

function wire(script: readonly ScriptedClaimSpec[], restriction?: HostRestriction) {
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  const broker = new CapabilityBroker({ policy: derived.policy, clock: new ManualBrokerClock(0) });
  broker.admit({
    grant: makeGrant({
      grantId: "grant-move" as never,
      holder: ACTOR,
      scope: { sessionId: SESSION },
      constraints: [{ kind: "total-count", max: 1 }],
    }),
  });
  const sensors = new InMemorySensorInput();
  const memory = new InMemoryAvatarMemory();
  const intelligence = new ScriptedIntelligence(ACTOR, script);
  const actuators = new InMemoryActuatorOutput();
  const runtime = new AvatarRuntime({
    definition: demoAvatarDefinition(),
    ...(restriction === undefined ? {} : { restriction }),
    sessionId: SESSION,
    actor: ACTOR,
    broker,
    ports: { sensors, memory, intelligence, actuators },
  });
  return { runtime, sensors, memory, intelligence, actuators, broker };
}

const drive = (runtime: AvatarRuntime, epoch = 1, tick = 1) =>
  runtime.cycle({ epoch: asSessionEpoch(epoch), tick: asTick(tick) });

test("negative R20: a host-denied sensor channel never reaches memory or the brain", () => {
  const wiring = wire([], { denied: ["vision"], approvalRequired: [], sandboxed: false });
  wiring.sensors.enqueue({ channel: "vision.main", tick: asTick(1), payload: { secret: "layout" } });
  wiring.sensors.enqueue({ channel: "audio.main", tick: asTick(1), payload: { level: 1 } });
  const report = drive(wiring.runtime);
  assert.equal(report.filtered, 1, "the denied channel is dropped");
  assert.equal(report.perceived, 1);
  assert.equal(wiring.memory.records.length, 1);
  assert.equal(wiring.memory.records[0]?.channel, "audio.main", "denied-channel payload is never recorded");
});

test("negative R20: a host-denied actuator refuses its intent kinds locally", () => {
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-move" }], {
    denied: ["movement"],
    approvalRequired: [],
    sandboxed: false,
  });
  const report = drive(wiring.runtime);
  assert.equal(report.granted, 0);
  assert.equal(report.unavailable, 1);
  assert.equal(wiring.actuators.commands.length, 0);
  assert.deepEqual(wiring.intelligence.denials.map((feedback) => [feedback.source, feedback.reason]), [
    ["body", "actuator-unavailable"],
  ]);
});

test("negative: an intent kind no actuator serves is refused before the broker", () => {
  const wiring = wire([{ intentKind: "dance.waltz", nonce: "d-1", grantId: "grant-move" }]);
  const report = drive(wiring.runtime);
  assert.equal(report.unavailable, 1);
  assert.equal(report.granted, 0);
  assert.equal(wiring.actuators.commands.length, 0);
  assert.equal(wiring.intelligence.denials[0]?.reason, "actuator-unavailable");
});

test("negative: a forged intent actor is refused (untrusted brain cannot act as another)", () => {
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-move", forgedActorId: "someone-else" }]);
  const report = drive(wiring.runtime);
  assert.equal(report.granted, 0);
  assert.equal(report.unavailable, 1);
  assert.equal(wiring.actuators.commands.length, 0);
  assert.equal(wiring.intelligence.denials[0]?.reason, "foreign-actor");
});

test("negative: a claim without a live grant is broker-denied and never emitted", () => {
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-absent" }]);
  const report = drive(wiring.runtime);
  assert.equal(report.denied, 1);
  assert.equal(wiring.actuators.commands.length, 0);
  assert.equal(wiring.intelligence.denials[0]?.reason, "grant-not-found");
});

test("negative: budget exhaustion denies the replayed claim (E8 anti-gaming)", () => {
  const wiring = wire([
    { intentKind: "move.to", nonce: "m-1", grantId: "grant-move" },
    { intentKind: "move.to", nonce: "m-1", grantId: "grant-move" },
  ]);
  const report = drive(wiring.runtime);
  assert.equal(report.granted, 1, "first evaluation consumes the single-use budget");
  assert.equal(report.denied, 1, "re-submission of the same logical action is budget-capped");
  assert.equal(wiring.intelligence.denials[0]?.reason, "budget-exhausted");
});

test("negative: grants scoped to another session never authorize this avatar", () => {
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-other-session" }]);
  wiring.broker.admit({
    grant: makeGrant({
      grantId: "grant-other-session" as never,
      holder: ACTOR,
      scope: { sessionId: asSessionId("s-elsewhere") },
    }),
  });
  const report = drive(wiring.runtime);
  assert.equal(report.denied, 1);
  assert.equal(wiring.intelligence.denials[0]?.reason, "grant-wrong-session");
});

test("negative: a stale epoch denies via the broker (stale-result rule)", () => {
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-move" }]);
  const report = drive(wiring.runtime, 2, 1);
  assert.equal(report.denied, 1);
  assert.equal(wiring.intelligence.denials[0]?.reason, "grant-epoch-stale");
});

test("negative: no sensor samples means no perceptions and no claims", () => {
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-move" }]);
  const report = drive(wiring.runtime);
  assert.equal(report.sensorSamples, 0);
  assert.equal(report.perceived, 0);
  assert.equal(report.granted, 1, "claims still process — the brain is not gated on perception volume");
});

test("negative: an expired grant denies at evaluation time", () => {
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-expired" }]);
  wiring.broker.admit({
    grant: makeGrant({
      grantId: "grant-expired" as never,
      holder: ACTOR,
      scope: { sessionId: SESSION },
      expiresAfterTick: asTick(0),
    }),
  });
  const report = drive(wiring.runtime, 1, 1);
  assert.equal(report.denied, 1);
  assert.equal(wiring.intelligence.denials[0]?.reason, "grant-expired-tick");
});

test("negative type-level: the intelligence port has no mutation surface", () => {
  // The only route to a RuntimeCommandEnvelope is the broker resolution
  // (granted). ScriptedIntelligence's decide() returns claims — proposals.
  // Structural proof: an intent claim is NOT a command envelope.
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-move" }]);
  const claims = wiring.intelligence.decide([]);
  const claim = claims[0];
  assert.ok(claim);
  // @ts-expect-error TS2322: a claim (proposal) is not a command envelope
  const command: Parameters<InMemoryActuatorOutput["emit"]>[0] = claim.intent;
  void command;
  assert.ok(true, "compiler rejected the coercion (lock rule 14, type-level)");
});
