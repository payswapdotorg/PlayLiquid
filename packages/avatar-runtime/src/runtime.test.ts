/**
 * Avatar runtime driver tests over the REAL capability broker (sibling
 * package): perception flow, broker-mediated command emission, denial
 * feedback, cycle reports, structural wiring and replay determinism.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityBroker, ManualBrokerClock, deriveBrokerPolicy, makeGrant } from "@playliquid/capability-broker";
import { demoCoverage, demoGameDocument } from "@playliquid/capability-broker";
import { asSessionEpoch, asSessionId, asTick, asTimestamp } from "@playliquid/runtime-contracts";
import type { RuntimeCommandEnvelope } from "@playliquid/runtime-contracts";
import type { AvatarBrokerPort } from "./ports.ts";
import { AvatarRuntime } from "./runtime.ts";
import type { AvatarCycleReport } from "./runtime.ts";
import {
  InMemoryActuatorOutput,
  InMemoryAvatarMemory,
  InMemorySensorInput,
  ScriptedIntelligence,
  demoAvatarDefinition,
} from "./fakes.ts";
import type { ScriptedClaimSpec } from "./fakes.ts";
import type { HostRestriction } from "@playliquid/game-contracts";

const SESSION = asSessionId("s-avatar");
const ACTOR = { actorClass: "avatar-agent" as const, actorId: "demo-avatar" as never };

interface Wiring {
  readonly runtime: AvatarRuntime;
  readonly sensors: InMemorySensorInput;
  readonly memory: InMemoryAvatarMemory;
  readonly intelligence: ScriptedIntelligence;
  readonly actuators: InMemoryActuatorOutput;
  readonly broker: CapabilityBroker;
}

function wire(
  script: readonly ScriptedClaimSpec[],
  options: { restriction?: HostRestriction } = {},
): Wiring {
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  const broker = new CapabilityBroker({ policy: derived.policy, clock: new ManualBrokerClock(10) });
  broker.admit({
    grant: makeGrant({
      grantId: "grant-move" as never,
      holder: ACTOR,
      scope: { sessionId: SESSION },
      constraints: [{ kind: "total-count", max: 10 }],
    }),
  });
  const sensors = new InMemorySensorInput();
  const memory = new InMemoryAvatarMemory();
  const intelligence = new ScriptedIntelligence(ACTOR, script);
  const actuators = new InMemoryActuatorOutput();
  const runtime = new AvatarRuntime({
    definition: demoAvatarDefinition(),
    ...(options.restriction === undefined ? {} : { restriction: options.restriction }),
    sessionId: SESSION,
    actor: ACTOR,
    broker,
    ports: { sensors, memory, intelligence, actuators },
  });
  return { runtime, sensors, memory, intelligence, actuators, broker };
}

const cycle = (runtime: AvatarRuntime, tick = 1): AvatarCycleReport =>
  runtime.cycle({ epoch: asSessionEpoch(1), tick: asTick(tick), recordedAt: asTimestamp(100) });

test("runtime: the real capability broker satisfies the AvatarBrokerPort seam", () => {
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  const broker = new CapabilityBroker({ policy: derived.policy, clock: new ManualBrokerClock(0) });
  const port: AvatarBrokerPort = broker;
  assert.equal(typeof port.evaluate, "function", "structural wiring at composition time");
});

test("runtime: perceptions flow sensor → memory → intelligence", () => {
  const wiring = wire([]);
  wiring.sensors.enqueue({ channel: "vision.main", tick: asTick(1), payload: { light: 0.5 } });
  wiring.sensors.enqueue({ channel: "audio.main", tick: asTick(1), payload: { level: 3 } });
  const report = cycle(wiring.runtime);
  assert.equal(report.sensorSamples, 2);
  assert.equal(report.perceived, 2);
  assert.equal(report.filtered, 0);
  assert.equal(wiring.memory.records.length, 2);
  assert.equal(wiring.memory.recall("audio.main").length, 1);
  assert.equal(wiring.memory.recall("audio.main", asTick(2)).length, 0, "sinceTick recall filters");
});

test("runtime: a granted claim emits a broker-mediated canonical command (lock 13/14)", () => {
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-move", payload: { to: [4, 4] } }]);
  wiring.sensors.enqueue({ channel: "audio.main", tick: asTick(1), payload: { level: 1 } });
  const report = cycle(wiring.runtime);
  assert.equal(report.granted, 1);
  assert.equal(report.denied, 0);
  const command: RuntimeCommandEnvelope | undefined = wiring.actuators.last;
  assert.ok(command, "the command landed on the actuator output");
  assert.equal(command.origin.kind, "broker-mediated");
  assert.equal(String(command.kind), "world.move");
  assert.deepEqual(command.payload, { to: [4, 4] });
  assert.equal(command.sessionId, SESSION);
  assert.equal(command.actor, ACTOR);
});

test("runtime: claim nonces become action-scope idempotency keys", () => {
  const wiring = wire([{ intentKind: "move.to", nonce: "m-77", grantId: "grant-move" }]);
  cycle(wiring.runtime);
  const command = wiring.actuators.last;
  assert.ok(command);
  assert.deepEqual(command.idempotencyKey, {
    scope: "action",
    actor: ACTOR.actorId,
    nonce: "m-77" as never,
  });
});

test("runtime: broker denials are fed back to the intelligence with typed reasons", () => {
  const wiring = wire([
    { intentKind: "move.to", nonce: "m-1", grantId: "grant-absent" },
    { intentKind: "speak.say", nonce: "s-1", grantId: "grant-move" },
  ]);
  const report = cycle(wiring.runtime);
  assert.equal(report.granted, 0);
  assert.equal(report.denied, 2);
  assert.equal(wiring.actuators.commands.length, 0, "nothing is emitted on denial");
  assert.deepEqual(
    wiring.intelligence.denials.map((feedback) => [feedback.source, feedback.reason]),
    [
      ["broker", "grant-not-found"],
      ["broker", "intent-kind-outside-grant"],
    ],
  );
});

test("runtime: cycle reports count every stage (audit read model)", () => {
  const wiring = wire([
    { intentKind: "move.to", nonce: "m-1", grantId: "grant-move" },
    { intentKind: "move.to", nonce: "m-2", grantId: "grant-move" },
  ]);
  wiring.sensors.enqueue({ channel: "vision.main", tick: asTick(1), payload: 1 });
  wiring.sensors.enqueue({ channel: "audio.main", tick: asTick(1), payload: 2 });
  wiring.sensors.enqueue({ channel: "audio.main", tick: asTick(1), payload: 3 });
  const report = cycle(wiring.runtime);
  assert.equal(report.sensorSamples, 3);
  assert.equal(report.perceived, 3);
  assert.equal(report.claims, 2);
  assert.equal(report.granted, 2);
  assert.deepEqual(report.emittedCommandKinds, ["world.move", "world.move"]);
});

test("runtime: budget exhaustion surfaces as broker denial feedback", () => {
  const wiring = wire([
    { intentKind: "move.to", nonce: "m-1", grantId: "grant-move" },
    { intentKind: "move.to", nonce: "m-2", grantId: "grant-move" },
    { intentKind: "move.to", nonce: "m-3", grantId: "grant-move" },
  ]);
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  wiring.broker.revoke("grant-move" as never);
  wiring.broker.admit({
    grant: makeGrant({
      grantId: "grant-move" as never,
      holder: ACTOR,
      scope: { sessionId: SESSION },
      constraints: [{ kind: "total-count", max: 2 }],
    }),
  });
  const report = cycle(wiring.runtime);
  assert.equal(report.granted, 2);
  assert.equal(report.denied, 1);
  assert.equal(wiring.intelligence.denials.at(-1)?.reason, "budget-exhausted");
});

test("runtime: revoking the grant mid-flight denies subsequent claims", () => {
  const wiring = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-move" }]);
  wiring.broker.revoke("grant-move" as never);
  const report = cycle(wiring.runtime);
  assert.equal(report.granted, 0);
  assert.equal(report.denied, 1);
  assert.equal(wiring.intelligence.denials[0]?.reason, "grant-not-found");
});

test("runtime: request ids are deterministic across identically-wired avatars", () => {
  const first = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-move" }]);
  const second = wire([{ intentKind: "move.to", nonce: "m-1", grantId: "grant-move" }]);
  const a = cycle(first.runtime);
  const b = cycle(second.runtime);
  assert.deepEqual(a, b);
  assert.deepEqual(
    first.actuators.commands.map((command) => String(command.commandId)),
    second.actuators.commands.map((command) => String(command.commandId)),
  );
});

test("runtime: the definition and restriction are readable read models", () => {
  const wiring = wire([]);
  assert.equal(String(wiring.runtime.definition.avatarId), "demo-avatar");
  assert.deepEqual(wiring.runtime.restriction, { denied: [], approvalRequired: [], sandboxed: false });
  assert.deepEqual([...wiring.runtime.effectiveSensorChannels].sort(), ["audio.main", "vision.main"]);
  assert.deepEqual([...wiring.runtime.servedIntentKinds].sort(), ["move.to", "speak.say"]);
});
