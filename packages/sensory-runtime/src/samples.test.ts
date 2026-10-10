/**
 * Sample-model tests: typed payload shapes, structural guards, and the
 * digest discipline (E9 determinism, 64-hex digests over the game-ir
 * canonical value form).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isVisualFieldSample,
  isAudioFrameSample,
  isTactileArraySample,
  isOlfactoryIntensitySample,
  isGustatoryIntensitySample,
  isProprioceptiveStateSample,
  isVestibularFrameSample,
  isSensoryPayload,
  SENSORY_PAYLOAD_KINDS,
  isFiniteNumber,
  isIntegerInRange,
} from "./samples.ts";
import { payloadContentDigest, payloadValueForm, sampleContentKey, historyRecordIdOf } from "./digest.ts";
import { asTenantId } from "@playliquid/platform-contracts";
import { asSessionEpoch } from "@playliquid/runtime-contracts";

const tenant = asTenantId("tenant-samples")!;

test("samples: every frozen capability payload shape validates its well-formed case", () => {
  assert.ok(isVisualFieldSample({ kind: "visual-field", width: 2, height: 2, cells: [0, 0.5, 1, 0.25] }));
  assert.ok(isAudioFrameSample({ kind: "audio-frame", frame: 7, level: 0.5 }));
  assert.ok(isTactileArraySample({ kind: "tactile-array", rows: 2, columns: 3, pressures: [0, 0.1, 0.2, 0.3, 0.4, 0.5] }));
  assert.ok(isOlfactoryIntensitySample({ kind: "olfactory-intensity", entries: [{ odorant: "rain", intensity: 0.5 }] }));
  assert.ok(isGustatoryIntensitySample({ kind: "gustatory-intensity", entries: [{ taste: "sweet", intensity: 0.5 }] }));
  assert.ok(
    isProprioceptiveStateSample({
      kind: "proprioceptive-state",
      joints: ["knee", "elbow"],
      angles: [-90, 90],
      positions: [1.5, -2.5],
    }),
  );
  assert.ok(
    isVestibularFrameSample({ kind: "vestibular-frame", linearAcceleration: [0, 0, 9.8], angularVelocity: [0, 0, 0] }),
  );
  assert.equal(SENSORY_PAYLOAD_KINDS.length, 7, "one shape per frozen capability");
});

test("samples: grid arity violations are refused (never throw)", () => {
  assert.equal(isVisualFieldSample({ kind: "visual-field", width: 2, height: 2, cells: [0, 0.5, 1] }), false);
  assert.equal(isTactileArraySample({ kind: "tactile-array", rows: 2, columns: 2, pressures: [0, 1, 1] }), false);
});

test("samples: out-of-range and non-finite values are refused", () => {
  assert.equal(isVisualFieldSample({ kind: "visual-field", width: 1, height: 1, cells: [1.5] }), false);
  assert.equal(isVisualFieldSample({ kind: "visual-field", width: 1, height: 1, cells: [Number.NaN] }), false);
  assert.equal(isAudioFrameSample({ kind: "audio-frame", frame: 0, level: Number.POSITIVE_INFINITY }), false);
  assert.equal(isAudioFrameSample({ kind: "audio-frame", frame: -1, level: 0.5 }), false);
  assert.equal(isOlfactoryIntensitySample({ kind: "olfactory-intensity", entries: [{ odorant: "x", intensity: -0.1 }] }), false);
  assert.equal(isProprioceptiveStateSample({ kind: "proprioceptive-state", joints: ["a"], angles: [400], positions: [0] }), false);
  assert.equal(isVestibularFrameSample({ kind: "vestibular-frame", linearAcceleration: [0, 0], angularVelocity: [0, 0, 0] }), false);
  assert.equal(isFiniteNumber(Number.NaN), false);
  assert.equal(isIntegerInRange(1.5, 0, 10), false);
});

test("samples: duplicate keys are refused (olfactory/gustatory/joints)", () => {
  assert.equal(
    isOlfactoryIntensitySample({ kind: "olfactory-intensity", entries: [{ odorant: "a", intensity: 0 }, { odorant: "a", intensity: 1 }] }),
    false,
  );
  assert.equal(
    isGustatoryIntensitySample({ kind: "gustatory-intensity", entries: [{ taste: "b", intensity: 0 }, { taste: "b", intensity: 1 }] }),
    false,
  );
  assert.equal(
    isProprioceptiveStateSample({ kind: "proprioceptive-state", joints: ["j", "j"], angles: [0, 0], positions: [0, 0] }),
    false,
  );
});

test("samples: guards are total over garbage inputs (no throw, no any)", () => {
  for (const garbage of [null, undefined, 0, "x", [], {}, { kind: "nope" }, Number.NaN]) {
    assert.equal(isSensoryPayload(garbage), false);
  }
});

test("digest: identical payloads hash identically; byte-level changes rehash (E9)", () => {
  const a = { kind: "audio-frame" as const, frame: 1, level: 0.5 };
  const b = { kind: "audio-frame" as const, frame: 1, level: 0.5 };
  const c = { kind: "audio-frame" as const, frame: 2, level: 0.5 };
  const digestA = payloadContentDigest(a);
  assert.match(String(digestA), /^[0-9a-f]{64}$/);
  assert.equal(String(payloadContentDigest(b)), String(digestA));
  assert.notEqual(String(payloadContentDigest(c)), String(digestA));
});

test("digest: record field order never matters (canonical value form)", () => {
  const ordered = { kind: "vestibular-frame" as const, linearAcceleration: [1, 2, 3] as const, angularVelocity: [4, 5, 6] as const };
  const shuffled = { angularVelocity: [4, 5, 6] as const, linearAcceleration: [1, 2, 3] as const, kind: "vestibular-frame" as const };
  assert.equal(String(payloadContentDigest(shuffled)), String(payloadContentDigest(ordered)));
  assert.equal(payloadValueForm(ordered).kind, "record");
});

test("digest: content keys are tenant/channel/epoch-scoped (E10)", () => {
  const other = asTenantId("tenant-other")!;
  const base = {
    tenant,
    channel: "audio.main",
    capability: "audio" as const,
    contentDigest: "a".repeat(64) as never,
    epoch: asSessionEpoch(1),
  };
  const key = sampleContentKey(base);
  assert.match(String(key), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(String(sampleContentKey({ ...base, tenant: other })), String(key));
  assert.notEqual(String(sampleContentKey({ ...base, epoch: asSessionEpoch(2) })), String(key));
  assert.notEqual(String(sampleContentKey({ ...base, channel: "audio.aux" })), String(key));
  const record = historyRecordIdOf({ tenant, contentKey: key, recordedAt: 5 });
  assert.notEqual(String(historyRecordIdOf({ tenant, contentKey: key, recordedAt: 6 })), String(record));
});
