/**
 * Runtime-host tests: binding coherence, the poll loop, restriction as
 * policy (R5), epoch monotonicity (E9), and history idempotency (E10).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAvatar } from "@playliquid/avatar-runtime";
import { demoAvatarDefinition } from "@playliquid/avatar-runtime";
import { asAgentId, asAvatarId } from "@playliquid/game-contracts";
import { asDigest, asSessionEpoch, asTick } from "@playliquid/runtime-contracts";
import { asTenantId } from "@playliquid/platform-contracts";
import { bindSensoryHost } from "./runtime.ts";
import { InMemorySensoryHistory, ManualClock, SeededProducer } from "./fakes.ts";
import type { ComposeAvatarInput } from "@playliquid/avatar-runtime";

const tenant = asTenantId("tenant-runtime")!;
const D = asDigest("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

function pkg(packageId: string): { packageId: string; version: string } {
  return { packageId, version: "1.0.0" };
}

/** A three-channel avatar (vision/audio/proprioception). */
function threeChannelAvatar(): ReturnType<typeof demoAvatarDefinition> {
  const input = {
    avatarId: asAvatarId("rt-avatar") as never,
    agent: asAgentId("rt-agent"),
    body: {
      subRecordVersion: { subRecord: "body" as const, version: 1, revisionDigest: D },
      geometry: pkg("b.geom"),
      skeleton: pkg("b.skel"),
      animation: pkg("b.anim"),
      physics: pkg("b.phys"),
      appearance: pkg("b.appear"),
    },
    sensors: {
      subRecordVersion: { subRecord: "sensors" as const, version: 1, revisionDigest: D },
      channels: [
        { capability: "vision" as const, channel: "vision.main" },
        { capability: "audio" as const, channel: "audio.main" },
        { capability: "proprioception" as const, channel: "proprio.main" },
      ],
    },
    actuators: {
      subRecordVersion: { subRecord: "actuators" as const, version: 1, revisionDigest: D },
      actuators: [{ capability: "movement" as const, serves: [{ kind: "move.to" } as never] }],
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

function wire(restriction?: { denied: readonly ["vision"]; approvalRequired: []; sandboxed: false }) {
  const history = new InMemorySensoryHistory();
  const clock = new ManualClock(100);
  const vision = new SeededProducer({ channel: "vision.main", capability: "vision", seed: 1 });
  const audio = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 2 });
  const proprio = new SeededProducer({ channel: "proprio.main", capability: "proprioception", seed: 3 });
  const binding = bindSensoryHost({
    definition: threeChannelAvatar(),
    ...(restriction === undefined ? {} : { restriction }),
    tenant,
    producers: [vision, audio, proprio],
    history,
    clock,
  });
  if (!binding.ok) throw new Error(binding.detail);
  return { host: binding.host, history, clock, vision, audio, proprio };
}

const E1 = asSessionEpoch(1);
const E2 = asSessionEpoch(2);

test("runtime: binding refuses a producer for a channel the avatar never declared", () => {
  const history = new InMemorySensoryHistory();
  const stranger = new SeededProducer({ channel: "smell.main", capability: "smell", seed: 9 });
  const binding = bindSensoryHost({
    definition: threeChannelAvatar(),
    tenant,
    producers: [stranger],
    history,
    clock: new ManualClock(0),
  });
  assert.ok(!binding.ok && binding.code === "unknown-producer-channel");
});

test("runtime: binding refuses a duplicate producer channel", () => {
  const history = new InMemorySensoryHistory();
  const a = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 1 });
  const b = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 2 });
  const binding = bindSensoryHost({
    definition: threeChannelAvatar(),
    tenant,
    producers: [a, b],
    history,
    clock: new ManualClock(0),
  });
  assert.ok(!binding.ok && binding.code === "duplicate-producer-channel");
});

test("runtime: binding refuses a producer capability that contradicts the declaration", () => {
  const history = new InMemorySensoryHistory();
  const liar = new SeededProducer({ channel: "audio.main", capability: "vision", seed: 9 });
  const binding = bindSensoryHost({
    definition: threeChannelAvatar(),
    tenant,
    producers: [liar],
    history,
    clock: new ManualClock(0),
  });
  assert.ok(!binding.ok && binding.code === "producer-capability-mismatch");
});

test("runtime: admitted samples land in the tenant history in recording order", () => {
  const world = wire();
  world.vision.emit(E1, asTick(1));
  world.audio.emit(E1, asTick(2));
  world.proprio.emit(E1, asTick(3));
  const report = world.host.poll(E1, asTick(3));
  assert.equal(report.admitted, 3);
  assert.equal(report.appended, 3);
  assert.deepEqual(world.history.read(tenant).map((record) => record.channel), [
    "vision.main",
    "audio.main",
    "proprio.main",
  ]);
});

test("runtime R5: a restricted channel produces NOTHING and is recorded as policy, not silence", () => {
  const world = wire({ denied: ["vision"], approvalRequired: [], sandboxed: false });
  assert.deepEqual(world.host.effectiveChannels, ["audio.main", "proprio.main"]);
  world.vision.emit(E1, asTick(1));
  world.audio.emit(E1, asTick(1));
  const report = world.host.poll(E1, asTick(1));
  assert.equal(report.framesSeen, 2);
  assert.equal(report.admitted, 1, "the restricted channel produced nothing");
  assert.deepEqual(report.restrictedChannels, ["vision.main"]);
  const policy = report.policyEvents.find((event) => event.kind === "channel-restricted");
  assert.ok(policy, "the suppression is RECORDED");
  assert.equal(world.history.readChannel(tenant, "vision.main").length, 0);
  assert.equal(world.history.readChannel(tenant, "audio.main").length, 1);
});

test("runtime E10: an identical re-polled frame returns the recorded receipt — no second mutation", () => {
  const world = wire();
  world.audio.enqueueRaw({ channel: "audio.main", capability: "audio", epoch: E1, tick: asTick(1), payload: { kind: "audio-frame", frame: 5, level: 0.5 } });
  const first = world.host.poll(E1, asTick(1));
  assert.equal(first.appended, 1);
  // The IDENTICAL frame content (same channel/capability/epoch/payload).
  world.audio.enqueueRaw({ channel: "audio.main", capability: "audio", epoch: E1, tick: asTick(2), payload: { kind: "audio-frame", frame: 5, level: 0.5 } });
  const second = world.host.poll(E1, asTick(2));
  assert.equal(second.admitted, 1, "the codec admits the well-formed duplicate");
  assert.equal(second.recordedReceipts, 1, "but the content key already exists — receipt returns");
  assert.equal(second.appended, 0);
  assert.equal(world.history.readChannel(tenant, "audio.main").length, 1);
  assert.ok(second.policyEvents.some((event) => event.kind === "duplicate-receipt"));
});

test("runtime E9: a regressing producer epoch is detected and refused", () => {
  const world = wire();
  world.audio.emit(E2, asTick(1));
  const first = world.host.poll(E2, asTick(1));
  assert.equal(first.appended, 1);
  world.audio.emit(E1, asTick(2)); // epoch went BACKWARD
  const second = world.host.poll(E2, asTick(2));
  assert.equal(second.admitted, 0);
  const regression = second.policyEvents.find((event) => event.kind === "epoch-regression");
  assert.ok(regression, "the ordering violation is recorded");
  assert.ok((regression?.detail ?? "").includes("regressed"));
});

test("runtime: codec refusals surface in the report (audit trail)", () => {
  const world = wire();
  world.audio.enqueueRaw({ channel: "audio.main", capability: "audio", epoch: E1, tick: 1, payload: { kind: "audio-frame", frame: 999, level: 2 } });
  const report = world.host.poll(E1, asTick(1));
  assert.equal(report.admitted, 0);
  assert.deepEqual(report.refusals.map((refusal) => refusal.code), ["malformed-payload"]);
  assert.ok(report.policyEvents.some((event) => event.kind === "codec-refusal"));
});

test("runtime: polls are deterministic across identically-wired worlds (E9)", () => {
  const a = wire();
  const b = wire();
  a.audio.emit(E1, asTick(5));
  b.audio.emit(E1, asTick(5));
  const reportA = a.host.poll(E1, asTick(5));
  const reportB = b.host.poll(E1, asTick(5));
  assert.deepEqual(reportA, reportB);
  assert.deepEqual(
    a.history.read(tenant).map((record) => String(record.recordId)),
    b.history.read(tenant).map((record) => String(record.recordId)),
  );
});
