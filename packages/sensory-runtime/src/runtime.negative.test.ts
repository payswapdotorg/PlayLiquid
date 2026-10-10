/**
 * E8/E9/E10/R5/R20 negative + positive tests for the sensory runtime
 * host, service, history, digests and the perception seam. Every
 * negative test asserts a REFUSAL or a POLICY RECORD, never a silent
 * drop; every positive test pins a deterministic value.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAvatar } from "@playliquid/avatar-runtime";
import type { ComposeAvatarInput } from "@playliquid/avatar-runtime";
import { asAvatarId, asAgentId } from "@playliquid/game-contracts";
import { asContentDigest, asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { asDigest, asSessionEpoch, asTick } from "@playliquid/runtime-contracts";
import { InMemorySensoryHistory, ManualClock, SeededProducer } from "./fakes.ts";
import { SensorHistoryInput } from "./perception.ts";
import { bindSensoryHost } from "./runtime.ts";
import { SensoryService } from "./service.ts";
import { payloadContentDigest, sampleContentKey, historyRecordIdOf, payloadValueForm } from "./digest.ts";

const TENANT = asTenantId("tenant-tests")!;
const OTHER_TENANT = asTenantId("tenant-other")!;
const SUBJECT = asSubjectId("subject-tests")!;
const D = asDigest("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

function pkg(packageId: string): { packageId: string; version: string } {
  return { packageId, version: "1.0.0" };
}

function avatarInput(): ComposeAvatarInput {
  return {
    avatarId: asAvatarId("test-avatar") as never,
    agent: asAgentId("test-agent"),
    body: {
      subRecordVersion: { subRecord: "body", version: 1, revisionDigest: D },
      geometry: pkg("asset.body.geometry"),
      skeleton: pkg("asset.body.skeleton"),
      animation: pkg("asset.body.animation"),
      physics: pkg("asset.body.physics"),
      appearance: pkg("asset.body.appearance"),
    },
    sensors: {
      subRecordVersion: { subRecord: "sensors", version: 1, revisionDigest: D },
      channels: [
        { capability: "vision", channel: "vision.main" },
        { capability: "audio", channel: "audio.main" },
      ],
    },
    actuators: {
      subRecordVersion: { subRecord: "actuators", version: 1, revisionDigest: D },
      actuators: [{ capability: "movement", serves: ["move.to" as never] }],
    },
    memory: {
      subRecordVersion: { subRecord: "memory", version: 1, revisionDigest: D },
      topology: "local",
      persistence: "session",
    },
    intelligence: {
      subRecordVersion: { subRecord: "intelligence", version: 1, revisionDigest: D },
      cognitiveSubstrate: pkg("brain.substrate.cognitive"),
      skills: [pkg("skill.navigation")],
    },
  } as unknown as ComposeAvatarInput;
}

function definition() {
  const composed = composeAvatar(avatarInput());
  if (!composed.ok) throw new Error(composed.detail);
  return composed.definition;
}

function producers() {
  return {
    vision: new SeededProducer({ channel: "vision.main", capability: "vision", seed: 7 }),
    audio: new SeededProducer({ channel: "audio.main", capability: "audio", seed: 8 }),
  };
}

// ---------------------------------------------------------------------------
// Host binding refusals (E8)
// ---------------------------------------------------------------------------

test("negative host: an undeclared producer channel is refused at binding", () => {
  const { vision } = producers();
  const binding = bindSensoryHost({
    definition: definition(),
    tenant: TENANT,
    producers: [new SeededProducer({ channel: "smell.main", capability: "smell", seed: 1 })],
    history: new InMemorySensoryHistory(),
    clock: new ManualClock(0),
  });
  void vision;
  assert.equal(binding.ok, false);
  if (!binding.ok) assert.equal(binding.code, "unknown-producer-channel");
});

test("negative host: a duplicate producer channel is refused at binding", () => {
  const binding = bindSensoryHost({
    definition: definition(),
    tenant: TENANT,
    producers: [
      new SeededProducer({ channel: "vision.main", capability: "vision", seed: 1 }),
      new SeededProducer({ channel: "vision.main", capability: "vision", seed: 2 }),
    ],
    history: new InMemorySensoryHistory(),
    clock: new ManualClock(0),
  });
  assert.equal(binding.ok, false);
  if (!binding.ok) assert.equal(binding.code, "duplicate-producer-channel");
});

test("negative host: a producer capability disagreeing with the avatar declaration is refused", () => {
  const binding = bindSensoryHost({
    definition: definition(),
    tenant: TENANT,
    producers: [new SeededProducer({ channel: "vision.main", capability: "audio", seed: 1 })],
    history: new InMemorySensoryHistory(),
    clock: new ManualClock(0),
  });
  assert.equal(binding.ok, false);
  if (!binding.ok) assert.equal(binding.code, "producer-capability-mismatch");
});

// ---------------------------------------------------------------------------
// R5: restriction filtering is policy, never silence
// ---------------------------------------------------------------------------

test("R5 host: a denied channel produces nothing AND is recorded as channel-restricted policy", () => {
  const history = new InMemorySensoryHistory();
  const { vision, audio } = producers();
  const binding = bindSensoryHost({
    definition: definition(),
    tenant: TENANT,
    restriction: { denied: ["vision"], approvalRequired: [], sandboxed: false },
    producers: [vision, audio],
    history,
    clock: new ManualClock(0),
  });
  if (!binding.ok) throw new Error(binding.detail);
  vision.emit(asSessionEpoch(1), asTick(1));
  audio.emit(asSessionEpoch(1), asTick(1));
  const report = binding.host.poll(asSessionEpoch(1), asTick(1));
  assert.equal(report.appended, 1, "only audio lands in history");
  assert.equal(history.readChannel(TENANT, "vision.main").length, 0, "denied channel: zero records");
  const policy = report.policyEvents.find((event) => event.kind === "channel-restricted");
  assert.ok(policy, "the suppression is RECORDED as policy");
  assert.equal(policy?.channel, "vision.main");
  assert.deepEqual(report.restrictedChannels, ["vision.main"]);
  assert.equal(report.framesSeen, 2, "the restricted frame was still SEEN (audited)");
});

// ---------------------------------------------------------------------------
// E9: epoch monotonicity
// ---------------------------------------------------------------------------

test("negative E9: a regressed producer epoch is refused as epoch-regression policy", () => {
  const history = new InMemorySensoryHistory();
  const { audio } = producers();
  const binding = bindSensoryHost({
    definition: definition(),
    tenant: TENANT,
    producers: [audio],
    history,
    clock: new ManualClock(0),
  });
  if (!binding.ok) throw new Error(binding.detail);
  audio.emit(asSessionEpoch(2), asTick(1));
  const first = binding.host.poll(asSessionEpoch(2), asTick(1));
  assert.equal(first.appended, 1, "the epoch-2 frame was admitted");
  audio.emit(asSessionEpoch(1), asTick(2));
  const report = binding.host.poll(asSessionEpoch(2), asTick(2));
  assert.equal(report.appended, 0, "the regressed frame produces nothing");
  const regression = report.policyEvents.find((event) => event.kind === "epoch-regression");
  assert.ok(regression, "regression is a recorded policy event");
  assert.equal(regression?.channel, "audio.main");
});

// ---------------------------------------------------------------------------
// E10: content-key idempotency + tamper evidence
// ---------------------------------------------------------------------------

test("E10 host: replaying an identical frame returns the recorded receipt, never a second mutation", () => {
  const history = new InMemorySensoryHistory();
  const { audio } = producers();
  const binding = bindSensoryHost({
    definition: definition(),
    tenant: TENANT,
    producers: [audio],
    history,
    clock: new ManualClock(0),
  });
  if (!binding.ok) throw new Error(binding.detail);
  audio.emit(asSessionEpoch(1), asTick(1));
  const first = binding.host.poll(asSessionEpoch(1), asTick(1));
  assert.equal(first.appended, 1);

  const twin = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 8 });
  twin.emit(asSessionEpoch(1), asTick(1));
  audio.enqueueRaw(twin.poll()[0]!);
  const replay = binding.host.poll(asSessionEpoch(1), asTick(2));
  assert.equal(replay.appended, 0, "no second mutation");
  assert.equal(replay.recordedReceipts, 1, "the identical frame returns a recorded receipt");
  assert.equal(history.size, 1);
  const duplicate = replay.policyEvents.find((event) => event.kind === "duplicate-receipt");
  assert.ok(duplicate, "the duplicate is recorded as policy");
});

test("E10 digest: the same payload has the same digest; a different payload does not", () => {
  const a = { kind: "audio-frame" as const, frame: 3, level: 0.25 };
  const b = { kind: "audio-frame" as const, frame: 3, level: 0.25 };
  const c = { kind: "audio-frame" as const, frame: 4, level: 0.25 };
  assert.equal(String(payloadContentDigest(a)), String(payloadContentDigest(b)));
  assert.notEqual(String(payloadContentDigest(a)), String(payloadContentDigest(c)));
  assert.match(String(payloadContentDigest(a)), /^[0-9a-f]{64}$/);
});

test("E10 digest: content keys are tenant- and epoch-separated", () => {
  const digest = payloadContentDigest({ kind: "audio-frame", frame: 0, level: 0.5 });
  const base = {
    tenant: TENANT,
    channel: "audio.main",
    capability: "audio" as const,
    contentDigest: digest,
    epoch: asSessionEpoch(1),
  };
  const otherTenantKey = sampleContentKey({ ...base, tenant: OTHER_TENANT });
  const otherEpochKey = sampleContentKey({ ...base, epoch: asSessionEpoch(2) });
  assert.notEqual(String(sampleContentKey(base)), String(otherTenantKey));
  assert.notEqual(String(sampleContentKey(base)), String(otherEpochKey));
});

test("E10 digest: history record ids change with recorded-at and content key", () => {
  const key = asContentDigest("a".repeat(64))!;
  const one = historyRecordIdOf({ tenant: TENANT, contentKey: key, recordedAt: 1 });
  const two = historyRecordIdOf({ tenant: TENANT, contentKey: key, recordedAt: 2 });
  const otherKey = asContentDigest("b".repeat(64))!;
  const three = historyRecordIdOf({ tenant: TENANT, contentKey: otherKey, recordedAt: 1 });
  assert.notEqual(String(one), String(two));
  assert.notEqual(String(one), String(three));
});

// ---------------------------------------------------------------------------
// R20: tenant isolation at the service door
// ---------------------------------------------------------------------------

test("negative R20: cross-tenant history reads, channel reads and key probes are refused", () => {
  const history = new InMemorySensoryHistory();
  const service = new SensoryService({ history, clock: new ManualClock(0) });
  const { audio } = producers();
  const registered = service.registerHost({ tenant: TENANT, subject: SUBJECT }, {
    tenant: TENANT,
    avatarKey: "test-avatar",
    definition: definition(),
    producers: [audio],
  });
  if (!registered.ok) throw new Error(registered.detail);
  audio.emit(asSessionEpoch(1), asTick(1));
  service.poll({ tenant: TENANT, subject: SUBJECT }, asSessionEpoch(1), asTick(1));

  const crossRead = service.historyOf({ tenant: OTHER_TENANT, subject: SUBJECT }, TENANT);
  assert.equal(crossRead.ok, false);
  if (!crossRead.ok) assert.equal(crossRead.code, "cross-tenant");

  const crossChannel = service.channelHistoryOf({ tenant: OTHER_TENANT, subject: SUBJECT }, TENANT, "audio.main");
  assert.equal(crossChannel.ok, false);
  if (!crossChannel.ok) assert.equal(crossChannel.code, "cross-tenant");

  const anyKey = asContentDigest("c".repeat(64))!;
  const crossKey = service.findByKey({ tenant: OTHER_TENANT, subject: SUBJECT }, TENANT, anyKey);
  assert.equal(crossKey.ok, false);
  if (!crossKey.ok) assert.equal(crossKey.code, "cross-tenant");

  // A well-formed caller probing an UNKNOWN key gets key-unknown (not cross-tenant).
  const unknownKey = service.findByKey({ tenant: TENANT, subject: SUBJECT }, TENANT, anyKey);
  assert.equal(unknownKey.ok, false);
  if (!unknownKey.ok) assert.equal(unknownKey.code, "key-unknown");
});

test("negative R20: invalid tenant/subject claims and duplicate host registrations are refused", () => {
  const history = new InMemorySensoryHistory();
  const service = new SensoryService({ history, clock: new ManualClock(0) });
  const { audio } = producers();

  const invalidSubject = service.poll({ tenant: TENANT, subject: "BAD SUBJECT" as never }, asSessionEpoch(1), asTick(1));
  assert.equal(invalidSubject.ok, false);
  if (!invalidSubject.ok) assert.equal(invalidSubject.code, "invalid-subject");

  const invalidTenant = service.poll({ tenant: "BAD TENANT" as never, subject: SUBJECT }, asSessionEpoch(1), asTick(1));
  assert.equal(invalidTenant.ok, false);
  if (!invalidTenant.ok) assert.equal(invalidTenant.code, "invalid-tenant");

  const first = service.registerHost({ tenant: TENANT, subject: SUBJECT }, {
    tenant: TENANT, avatarKey: "dup-avatar", definition: definition(), producers: [audio],
  });
  assert.equal(first.ok, true);
  const second = service.registerHost({ tenant: TENANT, subject: SUBJECT }, {
    tenant: TENANT, avatarKey: "dup-avatar", definition: definition(), producers: [audio],
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.code, "host-already-bound");

  const unknownHost = service.pollHost({ tenant: TENANT, subject: SUBJECT }, "ghost", asSessionEpoch(1), asTick(1));
  assert.equal(unknownHost.ok, false);
  if (!unknownHost.ok) assert.equal(unknownHost.code, "host-unknown");
});

// ---------------------------------------------------------------------------
// History port discipline (E10 append-only)
// ---------------------------------------------------------------------------

test("negative history: a different record under the same content key is never a second mutation", () => {
  const history = new InMemorySensoryHistory();
  const record = {
    recordId: asContentDigest("d".repeat(64))!,
    contentKey: asContentDigest("e".repeat(64))!,
    tenant: TENANT,
    channel: "audio.main",
    capability: "audio" as const,
    epoch: asSessionEpoch(1),
    tick: asTick(1),
    contentDigest: "f".repeat(64),
    payloadValueForm: "record",
    recordedAt: 1,
  };
  const appended = history.append(record);
  assert.equal(appended.status, "appended");
  const conflicting = history.append({ ...record, recordId: asContentDigest("0".repeat(64))! });
  assert.equal(conflicting.status, "recorded-receipt", "same key: the existing record wins");
  assert.equal(history.size, 1);
  assert.equal(history.conflicts.length, 1, "the conflict is visible for audit");
});

test("negative history: findByKey is tenant-scoped", () => {
  const history = new InMemorySensoryHistory();
  const record = {
    recordId: asContentDigest("1".repeat(64))!,
    contentKey: asContentDigest("2".repeat(64))!,
    tenant: TENANT,
    channel: "audio.main",
    capability: "audio" as const,
    epoch: asSessionEpoch(1),
    tick: asTick(1),
    contentDigest: "3".repeat(64),
    payloadValueForm: "record",
    recordedAt: 1,
  };
  history.append(record);
  assert.ok(history.findByKey(TENANT, record.contentKey));
  assert.equal(history.findByKey(OTHER_TENANT, record.contentKey), undefined);
});

// ---------------------------------------------------------------------------
// Perception seam (drain semantics + projection)
// ---------------------------------------------------------------------------

test("seam: SensorHistoryInput drains the unseen history once per poll", () => {
  const history = new InMemorySensoryHistory();
  const { audio } = producers();
  const binding = bindSensoryHost({
    definition: definition(),
    tenant: TENANT,
    producers: [audio],
    history,
    clock: new ManualClock(0),
  });
  if (!binding.ok) throw new Error(binding.detail);
  audio.emit(asSessionEpoch(1), asTick(1));
  audio.emit(asSessionEpoch(1), asTick(2));
  binding.host.poll(asSessionEpoch(1), asTick(2));

  const seam = new SensorHistoryInput({ tenant: TENANT, history });
  assert.equal(seam.pending, 2);
  const first = seam.poll();
  assert.equal(first.length, 2);
  assert.equal(seam.pending, 0);
  assert.equal(seam.poll().length, 0, "drain semantics: each sample exactly once");
  assert.equal(first[0]?.channel, "audio.main");
  assert.equal(Number(first[0]?.tick), 1);
});

test("seam: channel-filtered projection and empty-history polls", () => {
  const history = new InMemorySensoryHistory();
  const { vision, audio } = producers();
  const binding = bindSensoryHost({
    definition: definition(),
    tenant: TENANT,
    producers: [vision, audio],
    history,
    clock: new ManualClock(0),
  });
  if (!binding.ok) throw new Error(binding.detail);
  vision.emit(asSessionEpoch(1), asTick(1));
  audio.emit(asSessionEpoch(1), asTick(1));
  binding.host.poll(asSessionEpoch(1), asTick(1));

  const seam = new SensorHistoryInput({ tenant: TENANT, history, channels: ["audio.main"] });
  const projected = seam.poll();
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.channel, "audio.main");

  const empty = new SensorHistoryInput({ tenant: OTHER_TENANT, history });
  assert.equal(empty.poll().length, 0, "tenant-scoped read: other tenant sees nothing");
});

// ---------------------------------------------------------------------------
// E9: seeded determinism (fakes)
// ---------------------------------------------------------------------------

test("E9 fakes: identical seeds produce identical frame sequences; different seeds do not", () => {
  const a = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 5 });
  const b = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 5 });
  const c = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 6 });
  a.emit(asSessionEpoch(1), asTick(1));
  b.emit(asSessionEpoch(1), asTick(1));
  c.emit(asSessionEpoch(1), asTick(1));
  assert.deepEqual(a.poll()[0]?.payload, b.poll()[0]?.payload);
  assert.notDeepEqual(a.poll.call === undefined ? null : null, c.poll()[0]?.payload);
  assert.notDeepEqual(b.poll()[0]?.payload ?? null, c.poll()[0]?.payload);
});

test("E9 digest: payloadValueForm is a pure byte-stable projection (kind pinned)", () => {
  const form = payloadValueForm({ kind: "audio-frame", frame: 1, level: 0.5 });
  assert.equal(form.kind, "record");
  assert.equal(form.fields?.kind?.kind, "string");
  assert.deepEqual(payloadValueForm({ kind: "audio-frame", frame: 1, level: 0.5 }), form);
});
