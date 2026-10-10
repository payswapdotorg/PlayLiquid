/**
 * Codec tests: per-capability admission, coherent channel-capability
 * binding (a vision channel cannot emit audio payloads), malformed
 * frame refusals, and the frozen binding totality.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { admitFrame, expectedPayloadKind } from "./codec.ts";
import { SENSOR_CAPABILITY_IDS } from "@playliquid/game-contracts";
import { asSessionEpoch, asTick } from "@playliquid/runtime-contracts";

const EPOCH = asSessionEpoch(3);
const context = { epoch: EPOCH, tick: asTick(11) };

test("codec: a well-formed frame per capability admits with a 64-hex digest", () => {
  const cases: readonly { capability: string; payload: unknown }[] = [
    { capability: "vision", payload: { kind: "visual-field", width: 1, height: 1, cells: [0.5] } },
    { capability: "audio", payload: { kind: "audio-frame", frame: 4, level: 0.25 } },
    { capability: "touch", payload: { kind: "tactile-array", rows: 1, columns: 2, pressures: [0, 1] } },
    { capability: "smell", payload: { kind: "olfactory-intensity", entries: [{ odorant: "rain", intensity: 0.9 }] } },
    { capability: "taste", payload: { kind: "gustatory-intensity", entries: [{ taste: "umami", intensity: 0.1 }] } },
    {
      capability: "proprioception",
      payload: { kind: "proprioceptive-state", joints: ["hip"], angles: [-15], positions: [0.5] },
    },
    {
      capability: "vestibular",
      payload: { kind: "vestibular-frame", linearAcceleration: [0, 0, 1], angularVelocity: [0, 0, 0] },
    },
  ];
  for (const testCase of cases) {
    const admission = admitFrame(
      { channel: "c.main", capability: testCase.capability, payload: testCase.payload, epoch: EPOCH, tick: 11 },
      context,
    );
    assert.ok(admission.ok, `${testCase.capability} should admit (${admission.ok ? "" : admission.detail})`);
    if (admission.ok) {
      assert.equal(admission.sample.capability, testCase.capability);
      assert.equal(admission.sample.channel, "c.main");
      assert.match(String(admission.sample.contentDigest), /^[0-9a-f]{64}$/);
      assert.equal(Number(admission.sample.epoch), 3);
    }
  }
});

test("codec: the capability-payload binding is total over the frozen vocabulary", () => {
  for (const capability of SENSOR_CAPABILITY_IDS) {
    assert.notEqual(expectedPayloadKind(capability), undefined, `${capability} must bind a payload kind`);
  }
  assert.equal(expectedPayloadKind("echo-location"), undefined, "unknown capabilities bind nothing");
  assert.equal(expectedPayloadKind("vision"), "visual-field");
});

test("codec E8: a vision capability channel emitting an audio payload is a typed refusal", () => {
  const admission = admitFrame(
    {
      channel: "vision.main",
      capability: "vision",
      payload: { kind: "audio-frame", frame: 1, level: 0.5 },
      epoch: EPOCH,
      tick: 11,
    },
    context,
  );
  assert.ok(!admission.ok);
  assert.equal(admission.code, "capability-payload-mismatch");
});

test("codec E8: a payload with no kind tag, or a foreign kind, is a mismatch refusal", () => {
  const noKind = admitFrame({ channel: "a.c", capability: "audio", payload: { frame: 1, level: 0.5 }, epoch: EPOCH, tick: 11 }, context);
  assert.ok(!noKind.ok && noKind.code === "capability-payload-mismatch");
  const foreign = admitFrame({ channel: "a.c", capability: "audio", payload: { kind: "echo-frame", ping: 1 }, epoch: EPOCH, tick: 11 }, context);
  assert.ok(!foreign.ok && foreign.code === "capability-payload-mismatch");
});

test("codec E8: malformed payloads are refused, never thrown", () => {
  const bad = admitFrame(
    { channel: "a.c", capability: "audio", payload: { kind: "audio-frame", frame: -3, level: 0.5 }, epoch: EPOCH, tick: 11 },
    context,
  );
  assert.ok(!bad.ok && bad.code === "malformed-payload");
  const nanLevel = admitFrame(
    { channel: "a.c", capability: "audio", payload: { kind: "audio-frame", frame: 1, level: Number.NaN }, epoch: EPOCH, tick: 11 },
    context,
  );
  assert.ok(!nanLevel.ok && nanLevel.code === "malformed-payload");
});

test("codec E8: invalid channel slugs, capabilities, ticks and epochs are typed refusals", () => {
  const channel = admitFrame({ channel: "BAD SLUG", capability: "audio", payload: { kind: "audio-frame", frame: 0, level: 0 }, epoch: EPOCH, tick: 11 }, context);
  assert.ok(!channel.ok && channel.code === "invalid-channel");
  const capability = admitFrame({ channel: "a.c", capability: "echo-location", payload: {}, epoch: EPOCH, tick: 11 }, context);
  assert.ok(!capability.ok && capability.code === "invalid-capability");
  const tick = admitFrame({ channel: "a.c", capability: "audio", payload: { kind: "audio-frame", frame: 0, level: 0 }, epoch: EPOCH, tick: -1 }, context);
  assert.ok(!tick.ok && tick.code === "invalid-tick");
  const epoch = admitFrame({ channel: "a.c", capability: "audio", payload: { kind: "audio-frame", frame: 0, level: 0 }, epoch: asSessionEpoch(9), tick: 11 }, context);
  assert.ok(!epoch.ok && epoch.code === "invalid-epoch");
});

test("codec: admission is total over garbage frames (no throw)", () => {
  for (const garbage of [null, undefined, 0, "frame", [], {}]) {
    const admission = admitFrame(garbage as never, context);
    assert.ok(!admission.ok);
  }
  const nullPayload = admitFrame({ channel: "a.c", capability: "audio", payload: null, epoch: EPOCH, tick: 11 }, context);
  assert.ok(!nullPayload.ok && nullPayload.code === "capability-payload-mismatch");
});
