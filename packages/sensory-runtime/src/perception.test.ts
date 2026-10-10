/**
 * Perception-seam tests: the history feeds avatar-runtime's
 * SensorInputPort.poll() so the PL-026 perception → decision → action
 * driver consumes this runtime WITHOUT modification — end to end over
 * the REAL capability broker.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAvatar } from "@playliquid/avatar-runtime";
import { AvatarRuntime } from "@playliquid/avatar-runtime";
import {
  InMemoryActuatorOutput,
  InMemoryAvatarMemory,
  ScriptedIntelligence,
} from "@playliquid/avatar-runtime";
import type { ComposeAvatarInput } from "@playliquid/avatar-runtime";
import { CapabilityBroker, ManualBrokerClock, makeGrant } from "@playliquid/capability-broker";
import { deriveBrokerPolicy } from "@playliquid/capability-broker";
import { demoCoverage, demoGameDocument } from "@playliquid/capability-broker";
import { asAgentId, asAvatarId } from "@playliquid/game-contracts";
import { asDigest, asSessionEpoch, asSessionId, asTick } from "@playliquid/runtime-contracts";
import { asTenantId } from "@playliquid/platform-contracts";
import { bindSensoryHost } from "./runtime.ts";
import { SensorHistoryInput, projectSample } from "./perception.ts";
import { InMemorySensoryHistory, ManualClock, SeededProducer } from "./fakes.ts";
import { admitFrame } from "./codec.ts";

const tenant = asTenantId("tenant-seam")!;
const SESSION = asSessionId("seam-session");
const ACTOR = { actorClass: "avatar-agent" as const, actorId: "seam-avatar" as never };
const D = asDigest("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

function pkg(packageId: string): { packageId: string; version: string } {
  return { packageId, version: "1.0.0" };
}

function seamAvatar() {
  const input = {
    avatarId: asAvatarId("seam-avatar") as never,
    agent: asAgentId("seam-agent"),
    body: {
      subRecordVersion: { subRecord: "body" as const, version: 1, revisionDigest: D },
      geometry: pkg("b.g"),
      skeleton: pkg("b.s"),
      animation: pkg("b.a"),
      physics: pkg("b.p"),
      appearance: pkg("b.ap"),
    },
    sensors: {
      subRecordVersion: { subRecord: "sensors" as const, version: 1, revisionDigest: D },
      channels: [
        { capability: "vision" as const, channel: "vision.main" },
        { capability: "audio" as const, channel: "audio.main" },
      ],
    },
    actuators: {
      subRecordVersion: { subRecord: "actuators" as const, version: 1, revisionDigest: D },
      actuators: [{ capability: "movement" as const, serves: ["move.to" as never] }],
    },
    memory: {
      subRecordVersion: { subRecord: "memory" as const, version: 1, revisionDigest: D },
      topology: "local" as const,
      persistence: "session" as const,
    },
    intelligence: {
      subRecordVersion: { subRecord: "intelligence" as const, version: 1, revisionDigest: D },
      cognitiveSubstrate: pkg("brain.substrate"),
      skills: [pkg("skill.nav")],
    },
  } as unknown as ComposeAvatarInput;
  const composed = composeAvatar(input);
  if (!composed.ok) throw new Error(composed.detail);
  return composed.definition;
}

function wireSeam(restriction: { denied: readonly ["vision"]; approvalRequired: []; sandboxed: false } | undefined) {
  const history = new InMemorySensoryHistory();
  const clock = new ManualClock(50);
  const vision = new SeededProducer({ channel: "vision.main", capability: "vision", seed: 7 });
  const audio = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 8 });
  const binding = bindSensoryHost({
    definition: seamAvatar(),
    ...(restriction === undefined ? {} : { restriction }),
    tenant,
    producers: [vision, audio],
    history,
    clock,
  });
  if (!binding.ok) throw new Error(binding.detail);

  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  const broker = new CapabilityBroker({ policy: derived.policy, clock: new ManualBrokerClock(10) });
  broker.admit({
    grant: makeGrant({
      grantId: "grant-move" as never,
      holder: ACTOR,
      scope: { sessionId: SESSION },
      constraints: [{ kind: "total-count", max: 1 }],
    }),
  });
  const sensors = new SensorHistoryInput({ tenant, history });
  const memory = new InMemoryAvatarMemory();
  const intelligence = new ScriptedIntelligence(ACTOR, [
    { intentKind: "move.to", nonce: "m-1", grantId: "grant-move", payload: { to: [2, 2] } },
  ]);
  const actuators = new InMemoryActuatorOutput();
  const driver = new AvatarRuntime({
    definition: seamAvatar(),
    ...(restriction === undefined ? {} : { restriction }),
    sessionId: SESSION,
    actor: ACTOR,
    broker,
    ports: { sensors, memory, intelligence, actuators },
  });
  return { host: binding.host, history, vision, audio, sensors, memory, intelligence, actuators, driver };
}

const E1 = asSessionEpoch(1);

test("perception: the seam structurally satisfies avatar-runtime's SensorInputPort", () => {
  const history = new InMemorySensoryHistory();
  const seam = new SensorHistoryInput({ tenant, history });
  // Type-level: SensorHistoryInput implements SensorInputPort (poll()).
  const port: { poll(): readonly unknown[] } = seam;
  assert.deepEqual(port.poll(), []);
  assert.deepEqual(seam.cursor, { tenant, nextIndex: 0 });
});

test("perception: the PL-026 driver consumes the sensory history end to end", () => {
  const world = wireSeam(undefined);
  world.vision.emit(E1, asTick(1));
  world.audio.emit(E1, asTick(1));
  const pollReport = world.host.poll(E1, asTick(1));
  assert.equal(pollReport.appended, 2);
  const report = world.driver.cycle({ epoch: E1, tick: asTick(1) });
  assert.equal(report.sensorSamples, 2, "both channels projected through the seam");
  assert.equal(report.perceived, 2);
  assert.equal(report.filtered, 0);
  assert.equal(report.granted, 1, "the scripted claim became a broker-mediated command");
  assert.equal(world.actuators.commands.length, 1);
  assert.equal(String(world.actuators.commands[0]?.kind), "world.move");
  // The seam drained: nothing pending.
  assert.equal(world.sensors.pending, 0);
});

test("perception: the driver's own R5 gate filters a vision-restricted avatar", () => {
  const world = wireSeam({ denied: ["vision"], approvalRequired: [], sandboxed: false });
  world.vision.emit(E1, asTick(1));
  world.audio.emit(E1, asTick(1));
  const pollReport = world.host.poll(E1, asTick(1));
  assert.equal(pollReport.appended, 1, "the host admitted only audio (restriction as policy)");
  const report = world.driver.cycle({ epoch: E1, tick: asTick(1) });
  assert.equal(report.sensorSamples, 1);
  assert.equal(report.perceived, 1);
  assert.equal(report.filtered, 0, "nothing to filter — the host already projected the restriction");
  assert.equal(world.memory.records.length, 1);
  assert.equal(world.memory.records[0]?.channel, "audio.main");
});

test("perception: poll drains — each record is projected exactly once", () => {
  const world = wireSeam(undefined);
  world.audio.emit(E1, asTick(1));
  world.host.poll(E1, asTick(1));
  const first = world.sensors.poll();
  assert.equal(first.length, 1);
  const second = world.sensors.poll();
  assert.equal(second.length, 0);
  assert.deepEqual(world.sensors.cursor, { tenant, nextIndex: 1 });
  world.audio.enqueueRaw({ channel: "audio.main", capability: "audio", epoch: E1, tick: 2, payload: { kind: "audio-frame", frame: 99, level: 0.5 } });
  world.host.poll(E1, asTick(2));
  const third = world.sensors.poll();
  assert.equal(third.length, 1);
  assert.deepEqual(world.sensors.cursor, { tenant, nextIndex: 2 });
});

test("perception: channel-filtered projection narrows the seam without touching the history", () => {
  const world = wireSeam(undefined);
  world.vision.emit(E1, asTick(1));
  world.audio.emit(E1, asTick(1));
  world.host.poll(E1, asTick(1));
  const audioOnly = new SensorHistoryInput({ tenant, history: world.history, channels: ["audio.main"] });
  const samples = audioOnly.poll();
  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.channel, "audio.main");
  assert.equal(world.history.read(tenant).length, 2, "the history itself is untouched by projections");
});

test("perception: projectSample carries the typed payload through the untyped seam", () => {
  const admission = admitFrame(
    { channel: "audio.main", capability: "audio", payload: { kind: "audio-frame", frame: 3, level: 0.5 }, epoch: E1, tick: 9 },
    { epoch: E1, tick: asTick(9) },
  );
  assert.ok(admission.ok);
  if (admission.ok) {
    const projected = projectSample(admission.sample);
    assert.equal(projected.channel, "audio.main");
    assert.equal(Number(projected.tick), 9);
    const payload = projected.payload as { kind: string; frame: number; level: number };
    assert.equal(payload.kind, "audio-frame");
    assert.equal(payload.frame, 3);
    assert.equal(payload.level, 0.5);
  }
});
