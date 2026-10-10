/**
 * E8/R20 MANDATORY NEGATIVE TESTS for the sensory runtime: malformed
 * frame refusals per codec, capability/channel mismatch, restriction
 * filtering (restricted channel silent under policy, RECORDED),
 * cross-tenant isolation, duplicate content-key idempotency, and
 * clock-injected ordering violation detection. Every test asserts a
 * REFUSAL, a drop or a recorded policy event — never a silent pass.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAvatar } from "@playliquid/avatar-runtime";
import { asAgentId, asAvatarId } from "@playliquid/game-contracts";
import { asDigest, asSessionEpoch, asTick } from "@playliquid/runtime-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { bindSensoryHost } from "./runtime.ts";
import { admitFrame } from "./codec.ts";
import { SensorHistoryInput } from "./perception.ts";
import { SensoryService } from "./service.ts";
import { InMemorySensoryHistory, ManualClock, SeededProducer } from "./fakes.ts";
import { sampleContentKey } from "./digest.ts";
import { testContentDigest } from "./fakes.ts";
import type { ComposeAvatarInput } from "@playliquid/avatar-runtime";

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const subjectA = asSubjectId("subject-alpha")!;
const D = asDigest("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const E1 = asSessionEpoch(1);

function pkg(packageId: string): { packageId: string; version: string } {
  return { packageId, version: "1.0.0" };
}

function avatar() {
  const input = {
    avatarId: asAvatarId("neg-avatar") as never,
    agent: asAgentId("neg-agent"),
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

test("negative E8: every capability has a malformed-frame refusal case", () => {
  const malformed: readonly { capability: string; payload: unknown; why: string }[] = [
    { capability: "vision", payload: { kind: "visual-field", width: 0, height: 1, cells: [] }, why: "zero-width grid" },
    { capability: "vision", payload: { kind: "visual-field", width: 2, height: 1, cells: [0.1] }, why: "arity mismatch" },
    { capability: "audio", payload: { kind: "audio-frame", frame: 1.5, level: 0.5 }, why: "non-integer frame" },
    { capability: "touch", payload: { kind: "tactile-array", rows: 1, columns: 1, pressures: [1.5] }, why: "pressure > 1" },
    { capability: "smell", payload: { kind: "olfactory-intensity", entries: [] }, why: "empty vector" },
    { capability: "taste", payload: { kind: "gustatory-intensity", entries: [{ taste: "x", intensity: -1 }] }, why: "negative intensity" },
    {
      capability: "proprioception",
      payload: { kind: "proprioceptive-state", joints: ["a"], angles: [0], positions: [] },
      why: "position arity mismatch",
    },
    {
      capability: "vestibular",
      payload: { kind: "vestibular-frame", linearAcceleration: [Number.NaN, 0, 0], angularVelocity: [0, 0, 0] },
      why: "non-finite vector",
    },
  ];
  for (const testCase of malformed) {
    const admission = admitFrame(
      { channel: "c.main", capability: testCase.capability, payload: testCase.payload, epoch: E1, tick: 1 },
      { epoch: E1, tick: asTick(1) },
    );
    assert.ok(!admission.ok, `${testCase.why} must refuse`);
    assert.equal(admission.code, "malformed-payload", `${testCase.why} -> malformed-payload`);
  }
});

test("negative E8: capability/channel binding mismatches are typed refusals in both directions", () => {
  const audioPayloadOnVision = admitFrame(
    { channel: "vision.main", capability: "vision", payload: { kind: "audio-frame", frame: 0, level: 0 }, epoch: E1, tick: 1 },
    { epoch: E1, tick: asTick(1) },
  );
  assert.ok(!audioPayloadOnVision.ok && audioPayloadOnVision.code === "capability-payload-mismatch");
  const visionPayloadOnAudio = admitFrame(
    { channel: "audio.main", capability: "audio", payload: { kind: "visual-field", width: 1, height: 1, cells: [0] }, epoch: E1, tick: 1 },
    { epoch: E1, tick: asTick(1) },
  );
  assert.ok(!visionPayloadOnAudio.ok && visionPayloadOnAudio.code === "capability-payload-mismatch");
});

test("negative R5: a restricted channel is silent under policy — recorded, never a sample", () => {
  const history = new InMemorySensoryHistory();
  const vision = new SeededProducer({ channel: "vision.main", capability: "vision", seed: 5 });
  const binding = bindSensoryHost({
    definition: avatar(),
    restriction: { denied: ["vision"], approvalRequired: [], sandboxed: false },
    tenant: tenantA,
    producers: [vision],
    history,
    clock: new ManualClock(0),
  });
  assert.ok(binding.ok);
  vision.emit(E1, asTick(1));
  vision.emit(E1, asTick(2));
  const report = binding.ok ? binding.host.poll(E1, asTick(2)) : undefined;
  assert.ok(report);
  assert.equal(report.admitted, 0, "restricted channel produced nothing");
  assert.equal(history.read(tenantA).length, 0);
  const policy = report.policyEvents.filter((event) => event.kind === "channel-restricted");
  assert.equal(policy.length, 1, "the restriction is RECORDED as policy");
  assert.ok((policy[0]?.detail ?? "").includes("2 frame"), "the policy event counts the suppressed frames");
});

test("negative R20: cross-tenant history reads and key probes are typed refusals", () => {
  const service = new SensoryService({ history: new InMemorySensoryHistory(), clock: new ManualClock(0) });
  const registered = service.registerHost({ tenant: tenantA, subject: subjectA }, {
    tenant: tenantA,
    avatarKey: "neg-avatar",
    definition: avatar(),
    producers: [],
  });
  assert.ok(registered.ok);

  const crossRead = service.historyOf({ tenant: tenantB, subject: subjectA }, tenantA);
  assert.ok(!crossRead.ok && crossRead.code === "cross-tenant");
  const crossChannel = service.channelHistoryOf({ tenant: tenantB, subject: subjectA }, tenantA, "audio.main");
  assert.ok(!crossChannel.ok && crossChannel.code === "cross-tenant");
  const crossKey = service.findByKey({ tenant: tenantB, subject: subjectA }, tenantA, testContentDigest("x"));
  assert.ok(!crossKey.ok && crossKey.code === "cross-tenant");
  const crossPoll = service.poll({ tenant: tenantB, subject: subjectA }, E1, asTick(1));
  assert.ok(crossPoll.ok && crossPoll.reports.length === 0, "a tenant-B caller drives ZERO tenant-A hosts");
});

test("negative R20: invalid tenant/subject claims are refused before any access", () => {
  const service = new SensoryService({ history: new InMemorySensoryHistory(), clock: new ManualClock(0) });
  const badTenant = service.historyOf({ tenant: "NOT A VALID TENANT" as never, subject: subjectA }, tenantA);
  assert.ok(!badTenant.ok && badTenant.code === "invalid-tenant");
  const badSubject = service.historyOf({ tenant: tenantA, subject: "BAD SUBJECT!" as never }, tenantA);
  assert.ok(!badSubject.ok, "an invalid subject claim is refused before any access");
  assert.equal(badSubject.code, "invalid-subject");
});

test("negative E10: a duplicate content key never mutates — the recorded receipt returns", () => {
  const history = new InMemorySensoryHistory();
  const audio = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 11 });
  const binding = bindSensoryHost({
    definition: avatar(),
    tenant: tenantA,
    producers: [audio],
    history,
    clock: new ManualClock(0),
  });
  assert.ok(binding.ok);
  audio.emit(E1, asTick(1));
  const first = binding.ok ? binding.host.poll(E1, asTick(1)) : undefined;
  assert.ok(first && first.appended === 1);
  const records = history.read(tenantA);
  assert.equal(records.length, 1);
  // Re-append the SAME record: recorded receipt, size unchanged.
  const outcome = history.append(records[0]!);
  assert.equal(outcome.status, "recorded-receipt");
  assert.equal(history.size, 1);
  assert.equal(String(outcome.record.recordId), String(records[0]!.recordId));
  // A DIFFERENT record under the same key: still no second mutation.
  const forged = { ...records[0]!, recordId: testContentDigest("forged") };
  const conflict = history.append(forged);
  assert.equal(conflict.status, "recorded-receipt");
  assert.equal(history.read(tenantA).length, 1, "no second record under the same key");
  assert.equal(history.conflicts.length, 1, "the conflict is visible in the audit read model");
});

test("negative E9: a non-monotonic producer epoch is refused with a recorded policy event", () => {
  const history = new InMemorySensoryHistory();
  const audio = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 12 });
  const binding = bindSensoryHost({
    definition: avatar(),
    tenant: tenantA,
    producers: [audio],
    history,
    clock: new ManualClock(0),
  });
  assert.ok(binding.ok);
  audio.emit(asSessionEpoch(4), asTick(1));
  const first = binding.ok ? binding.host.poll(asSessionEpoch(4), asTick(1)) : undefined;
  assert.ok(first && first.appended === 1);
  audio.enqueueRaw({ channel: "audio.main", capability: "audio", epoch: asSessionEpoch(2), tick: asTick(2), payload: { kind: "audio-frame", frame: 8, level: 0.5 } });
  const second = binding.ok ? binding.host.poll(asSessionEpoch(4), asTick(2)) : undefined;
  assert.ok(second);
  assert.equal(second.admitted, 0, "the regressed frame never admits");
  const regression = second.policyEvents.find((event) => event.kind === "epoch-regression");
  assert.ok(regression && /regressed/.test(regression.detail));
});

test("negative: the seam never projects another tenant's records", () => {
  const history = new InMemorySensoryHistory();
  const key = sampleContentKey({
    tenant: tenantA,
    channel: "audio.main",
    capability: "audio",
    contentDigest: asDigest("a".repeat(64)),
    epoch: E1,
  });
  history.append({
    recordId: testContentDigest("record"),
    contentKey: key,
    tenant: tenantA,
    channel: "audio.main",
    capability: "audio",
    epoch: E1,
    tick: asTick(1),
    contentDigest: "a".repeat(64),
    payloadValueForm: "record",
    recordedAt: 0,
  });
  const tenantBSeam = new SensorHistoryInput({ tenant: tenantB, history });
  assert.deepEqual(tenantBSeam.poll(), [], "tenant B's seam sees none of tenant A's records");
  const tenantASeam = new SensorHistoryInput({ tenant: tenantA, history });
  assert.equal(tenantASeam.poll().length, 1);
});

test("negative service: duplicate host registration and unknown hosts are refused", () => {
  const service = new SensoryService({ history: new InMemorySensoryHistory(), clock: new ManualClock(0) });
  const first = service.registerHost({ tenant: tenantA, subject: subjectA }, {
    tenant: tenantA,
    avatarKey: "dup",
    definition: avatar(),
    producers: [],
  });
  assert.ok(first.ok);
  const second = service.registerHost({ tenant: tenantA, subject: subjectA }, {
    tenant: tenantA,
    avatarKey: "dup",
    definition: avatar(),
    producers: [],
  });
  assert.ok(!second.ok && second.code === "host-already-bound");
  const unknown = service.pollHost({ tenant: tenantA, subject: subjectA }, "ghost", E1, asTick(1));
  assert.ok(!unknown.ok && unknown.code === "host-unknown");
});
