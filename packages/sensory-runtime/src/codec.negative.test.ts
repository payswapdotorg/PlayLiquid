/**
 * E8 MANDATORY NEGATIVE TESTS for the sensory runtime codecs: every
 * capability's payload shape refuses malformed input with a typed
 * kebab-case code (never a throw, never partially-normalized data), and
 * the capability/channel coherence binding refuses mismatches.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { admitFrame, expectedPayloadKind } from "./codec.ts";
import type { RawProducerFrame } from "./codec.ts";
import { SENSOR_CAPABILITY_IDS } from "@playliquid/game-contracts";
import { asSessionEpoch, asTick } from "@playliquid/runtime-contracts";

const CTX = { epoch: asSessionEpoch(1), tick: asTick(1) };

function frame(over: Record<string, unknown>): RawProducerFrame {
  return { channel: "vision.main", capability: "vision", payload: {}, epoch: 1, tick: 1, ...over };
}

test("negative codec: vision refuses grid arity, NaN cells, zero dims, wrong tag", () => {
  const arity = admitFrame(frame({ payload: { kind: "visual-field", width: 2, height: 2, cells: [0.5, 0.5, 0.5] } }), CTX);
  assert.equal(arity.ok, false);
  if (!arity.ok) assert.equal(arity.code, "malformed-payload");

  const nan = admitFrame(frame({ payload: { kind: "visual-field", width: 1, height: 1, cells: [Number.NaN] } }), CTX);
  assert.equal(nan.ok, false);
  if (!nan.ok) assert.equal(nan.code, "malformed-payload");

  const zero = admitFrame(frame({ payload: { kind: "visual-field", width: 0, height: 1, cells: [] } }), CTX);
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.equal(zero.code, "malformed-payload");

  const range = admitFrame(frame({ payload: { kind: "visual-field", width: 1, height: 1, cells: [1.5] } }), CTX);
  assert.equal(range.ok, false);
  if (!range.ok) assert.equal(range.code, "malformed-payload");
});

test("negative codec: audio refuses negative frames, non-integer frames, out-of-range levels", () => {
  for (const payload of [
    { kind: "audio-frame", frame: -1, level: 0.5 },
    { kind: "audio-frame", frame: 1.5, level: 0.5 },
    { kind: "audio-frame", frame: 0, level: 1.5 },
    { kind: "audio-frame", frame: 0, level: Number.POSITIVE_INFINITY },
  ]) {
    const refused = admitFrame(frame({ capability: "audio", channel: "audio.main", payload }), CTX);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "malformed-payload");
  }
});

test("negative codec: touch refuses arity, rows/columns bounds, pressures range", () => {
  for (const payload of [
    { kind: "tactile-array", rows: 2, columns: 2, pressures: [0.1, 0.2, 0.3] },
    { kind: "tactile-array", rows: 0, columns: 2, pressures: [] },
    { kind: "tactile-array", rows: 2, columns: 2, pressures: [0, 0, 0, -0.5] },
    { kind: "tactile-array", rows: 2, columns: 2, pressures: [0, 0, 0, Number.NaN] },
  ]) {
    const refused = admitFrame(frame({ capability: "touch", channel: "touch.main", payload }), CTX);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "malformed-payload");
  }
});

test("negative codec: smell refuses empty/duplicate odorants, bad intensities, oversized vectors", () => {
  for (const payload of [
    { kind: "olfactory-intensity", entries: [] },
    { kind: "olfactory-intensity", entries: [{ odorant: "rain", intensity: 0.5 }, { odorant: "rain", intensity: 0.6 }] },
    { kind: "olfactory-intensity", entries: [{ odorant: "", intensity: 0.5 }] },
    { kind: "olfactory-intensity", entries: [{ odorant: "rain", intensity: 1.2 }] },
    {
      kind: "olfactory-intensity",
      entries: Array.from({ length: 257 }, (_, index) => ({ odorant: `o-${index}`, intensity: 0.5 })),
    },
  ]) {
    const refused = admitFrame(frame({ capability: "smell", channel: "smell.main", payload }), CTX);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "malformed-payload");
  }
});

test("negative codec: taste mirrors smell's refusals over tastes", () => {
  for (const payload of [
    { kind: "gustatory-intensity", entries: [] },
    { kind: "gustatory-intensity", entries: [{ taste: "sweet", intensity: 0.5 }, { taste: "sweet", intensity: 0.5 }] },
    { kind: "gustatory-intensity", entries: [{ taste: "sweet", intensity: -0.1 }] },
  ]) {
    const refused = admitFrame(frame({ capability: "taste", channel: "taste.main", payload }), CTX);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "malformed-payload");
  }
});

test("negative codec: proprioception refuses arity, duplicate joints, angle range, finite positions", () => {
  for (const payload of [
    { kind: "proprioceptive-state", joints: ["knee"], angles: [1], positions: [] },
    { kind: "proprioceptive-state", joints: ["knee", "knee"], angles: [0, 0], positions: [0, 0] },
    { kind: "proprioceptive-state", joints: [], angles: [], positions: [] },
    { kind: "proprioceptive-state", joints: ["knee"], angles: [400], positions: [0] },
    { kind: "proprioceptive-state", joints: ["knee"], angles: [0], positions: [Number.NaN] },
    { kind: "proprioceptive-state", joints: [""], angles: [0], positions: [0] },
  ]) {
    const refused = admitFrame(frame({ capability: "proprioception", channel: "proprio.main", payload }), CTX);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "malformed-payload");
  }
});

test("negative codec: vestibular refuses non-3-vectors and non-finite components", () => {
  for (const payload of [
    { kind: "vestibular-frame", linearAcceleration: [0, 0], angularVelocity: [0, 0, 0] },
    { kind: "vestibular-frame", linearAcceleration: [0, 0, 0], angularVelocity: [0, 0, 0, 0] },
    { kind: "vestibular-frame", linearAcceleration: [0, Number.NaN, 0], angularVelocity: [0, 0, 0] },
    { kind: "vestibular-frame", linearAcceleration: [0, 0, 0], angularVelocity: [Number.POSITIVE_INFINITY, 0, 0] },
  ]) {
    const refused = admitFrame(frame({ capability: "vestibular", channel: "vestib.main", payload }), CTX);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "malformed-payload");
  }
});

test("negative codec: every capability refuses every OTHER capability's payload kind", () => {
  // One well-formed payload per capability (validated shape).
  const wellFormed: Record<string, unknown> = {
    vision: { kind: "visual-field", width: 1, height: 1, cells: [0.5] },
    audio: { kind: "audio-frame", frame: 0, level: 0.5 },
    touch: { kind: "tactile-array", rows: 1, columns: 1, pressures: [0.5] },
    smell: { kind: "olfactory-intensity", entries: [{ odorant: "rain", intensity: 0.5 }] },
    taste: { kind: "gustatory-intensity", entries: [{ taste: "sweet", intensity: 0.5 }] },
    proprioception: { kind: "proprioceptive-state", joints: ["knee"], angles: [0], positions: [0] },
    vestibular: { kind: "vestibular-frame", linearAcceleration: [0, 0, 0], angularVelocity: [0, 0, 0] },
  };
  const channelOf: Record<string, string> = {
    vision: "vision.main",
    audio: "audio.main",
    touch: "touch.main",
    smell: "smell.main",
    taste: "taste.main",
    proprioception: "proprio.main",
    vestibular: "vestib.main",
  };
  for (const emitter of SENSOR_CAPABILITY_IDS) {
    for (const payloadKind of Object.keys(wellFormed)) {
      if (payloadKind === emitter) continue;
      const refused = admitFrame(
        frame({ capability: emitter, channel: channelOf[emitter], payload: wellFormed[payloadKind] }),
        CTX,
      );
      assert.equal(refused.ok, false, `${emitter} must refuse ${payloadKind} payload`);
      if (!refused.ok) assert.equal(refused.code, "capability-payload-mismatch");
    }
  }
});

test("negative codec: unknown capability, invalid channel slug, bad tick, wrong epoch", () => {
  const unknownCapability = admitFrame(frame({ capability: "esp" }), CTX);
  assert.equal(unknownCapability.ok, false);
  if (!unknownCapability.ok) assert.equal(unknownCapability.code, "invalid-capability");

  const badChannel = admitFrame(frame({ channel: "Not A Slug" }), CTX);
  assert.equal(badChannel.ok, false);
  if (!badChannel.ok) assert.equal(badChannel.code, "invalid-channel");

  const badTick = admitFrame(frame({ payload: wellFormedVision(), tick: -1 }), CTX);
  assert.equal(badTick.ok, false);
  if (!badTick.ok) assert.equal(badTick.code, "invalid-tick");

  const wrongEpoch = admitFrame(frame({ payload: wellFormedVision(), epoch: 2 }), CTX);
  assert.equal(wrongEpoch.ok, false);
  if (!wrongEpoch.ok) assert.equal(wrongEpoch.code, "invalid-epoch");

  const nullFrame = admitFrame(null, CTX);
  assert.equal(nullFrame.ok, false);
  if (!nullFrame.ok) assert.equal(nullFrame.code, "invalid-channel");
});

test("negative codec: expectedPayloadKind is total over the frozen vocabulary only", () => {
  assert.equal(expectedPayloadKind("vision"), "visual-field");
  assert.equal(expectedPayloadKind("esp"), undefined);
});

function wellFormedVision(): unknown {
  return { kind: "visual-field", width: 1, height: 1, cells: [0.5] };
}
