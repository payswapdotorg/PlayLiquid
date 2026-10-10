/**
 * E8/E9 seeded fuzz: pseudo-random garbage frames must ALWAYS resolve to
 * a typed refusal or an admission — never a throw, never partial data —
 * and identical fuzz seeds must produce identical refusal-code traces
 * (determinism, no Math.random anywhere).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { admitFrame } from "./codec.ts";
import { SeededStream } from "./fakes.ts";
import { asSessionEpoch, asTick } from "@playliquid/runtime-contracts";

const CTX = { epoch: asSessionEpoch(1), tick: asTick(1) };

/** Deterministic garbage generator over the seeded stream (no Math.random). */
function garbage(stream: SeededStream): unknown {
  const shape = stream.nextUint32() % 12;
  const unit = () => stream.nextUnit();
  const text = () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz.-0123456789 ";
    const length = stream.nextUint32() % 12;
    let out = "";
    for (let index = 0; index < length; index += 1) {
      out += alphabet[stream.nextUint32() % alphabet.length];
    }
    return out;
  };
  switch (shape) {
    case 0:
      return null;
    case 1:
      return stream.nextUint32() % 2 === 0 ? Number.NaN : Number.POSITIVE_INFINITY;
    case 2:
      return text();
    case 3:
      return stream.nextUint32();
    case 4:
      return { kind: text() };
    case 5:
      return { kind: "visual-field", width: unit() * 3, height: unit() * 3, cells: [unit(), unit(), unit()] };
    case 6:
      return { kind: "audio-frame", frame: unit() * 10 - 2, level: unit() * 2 };
    case 7:
      return { kind: "tactile-array", rows: unit() * 3, columns: 1, pressures: [unit()] };
    case 8:
      return { kind: "olfactory-intensity", entries: [{ odorant: text(), intensity: unit() * 2 }] };
    case 9:
      return { kind: "proprioceptive-state", joints: [text()], angles: [unit() * 800 - 400], positions: [unit()] };
    case 10:
      return { kind: "vestibular-frame", linearAcceleration: [unit(), unit()], angularVelocity: [unit(), unit(), unit()] };
    default:
      return { kind: "gustatory-intensity", entries: [] };
  }
}

/** One fuzz pass: N garbage frames through the codec; returns the code trace. */
function fuzz(seed: number, iterations: number): string[] {
  const stream = new SeededStream(seed);
  const trace: string[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const payload = garbage(stream);
    const channel = index % 2 === 0 ? "audio.main" : 12345;
    const capability = index % 3 === 0 ? "audio" : index % 3 === 1 ? "esp" : 7;
    const epoch = index % 4 === 0 ? 1 : index % 4 === 1 ? 2 : index % 4 === 2 ? "x" : null;
    const tick = index % 5 === 0 ? 1 : index % 5 === 1 ? -1 : index % 5 === 2 ? 1.5 : null;
    const admission = admitFrame({ channel, capability, payload, epoch, tick }, CTX);
    if (admission.ok) {
      trace.push("ok");
    } else {
      trace.push(admission.code);
    }
  }
  return trace;
}

test("E8 fuzz: 10000 garbage frames never throw and always resolve to typed outcomes", () => {
  const trace = fuzz(0xC0FFEE, 10_000);
  assert.equal(trace.length, 10_000);
  const allowed = new Set([
    "ok",
    "invalid-channel",
    "invalid-capability",
    "invalid-tick",
    "invalid-epoch",
    "malformed-payload",
    "capability-payload-mismatch",
  ]);
  for (const code of trace) {
    assert.ok(allowed.has(code), `untyped outcome leaked out of the codec: ${code}`);
  }
  // The corpus is diverse enough to exercise several refusal classes.
  const distinct = new Set(trace);
  assert.ok(distinct.size >= 4, `expected a diverse refusal mix, got ${[...distinct].join(",")}`);
});

test("E9 fuzz: identical seeds produce identical refusal-code traces", () => {
  const one = fuzz(0x5EED, 2_000);
  const two = fuzz(0x5EED, 2_000);
  const other = fuzz(0x5EED + 1, 2_000);
  assert.deepEqual(one, two, "same seed, same trace");
  assert.notDeepEqual(one, other, "different seed, different trace (the stream is live)");
});

test("E8 fuzz: a frame that admits must be fully-formed (spot invariant check)", () => {
  const stream = new SeededStream(0xABCD);
  for (let index = 0; index < 5_000; index += 1) {
    const payload = garbage(stream);
    const admission = admitFrame(
      { channel: "vision.main", capability: "vision", payload, epoch: 1, tick: 1 },
      CTX,
    );
    if (admission.ok) {
      const sample = admission.sample;
      assert.equal(sample.channel, "vision.main");
      assert.equal(sample.capability, "vision");
      assert.equal(sample.payload.kind, "visual-field");
      assert.match(String(sample.contentDigest), /^[0-9a-f]{64}$/);
      assert.equal(sample.payload.cells.length, sample.payload.width * sample.payload.height);
    }
  }
});
