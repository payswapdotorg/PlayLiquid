/**
 * RNG determinism tests (E9): identical seeds produce identical streams
 * across instances; forks are deterministic sub-streams; states round-trip.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, restoreRng, rngFingerprint, rngRange } from "./rng.ts";
import type { RngState } from "./ports.ts";
import { asDeterminismSeed } from "@playliquid/runtime-contracts";

const seedA = asDeterminismSeed("rng-seed-alpha");
const seedB = asDeterminismSeed("rng-seed-beta");

test("rng: same seed, same stream, across fresh instances", () => {
  const first = rngFingerprint(seedA, 128);
  const second = rngFingerprint(seedA, 128);
  assert.equal(first, second);
});

test("rng: different seeds produce different streams", () => {
  const first = rngFingerprint(seedA, 128);
  const second = rngFingerprint(seedB, 128);
  assert.notEqual(first, second);
});

test("rng: draws are unsigned 32-bit integers; uniform in [0, 1)", () => {
  const rng = makeRng(seedA);
  for (let i = 0; i < 1000; i += 1) {
    const draw = rng.nextUint32();
    assert.ok(Number.isInteger(draw));
    assert.ok(draw >= 0 && draw < 4294967296);
    const uniform = rng.nextUniform();
    assert.ok(uniform >= 0 && uniform < 1);
  }
});

test("rng: forked sub-streams are deterministic and label-sensitive", () => {
  const parent = makeRng(seedA);
  const fork1 = parent.fork("tick:1");
  const forkAgain = makeRng(seedA).fork("tick:1");
  const fork2 = parent.fork("tick:2");
  const values = (rng: ReturnType<typeof makeRng>): string =>
    Array.from({ length: 16 }, () => rng.nextUint32().toString(16)).join(",");
  // Same parent state + same label -> identical sub-stream.
  assert.equal(values(fork1), values(forkAgain));
  // Different label -> different sub-stream.
  assert.notEqual(values(fork1), values(fork2));
  // Forking does not advance the parent.
  const parentAgain = makeRng(seedA);
  assert.equal(parent.state, parentAgain.state);
});

test("rng: state capture and restore continue the same stream", () => {
  const rng = makeRng(seedA);
  for (let i = 0; i < 10; i += 1) rng.nextUint32();
  const captured: RngState = rng.state;
  const continued = restoreRng(captured);
  const a = Array.from({ length: 10 }, () => rng.nextUint32());
  const b = Array.from({ length: 10 }, () => continued.nextUint32());
  assert.deepEqual(a, b);
});

test("rng: restoreRng rejects malformed state (fail closed)", () => {
  assert.throws(() => restoreRng("not-hex!!"));
  assert.throws(() => restoreRng(""));
});

test("rng: rngRange maps uniforms into the requested range deterministically", () => {
  const rng = makeRng(seedA);
  const twin = makeRng(seedA);
  for (let i = 0; i < 64; i += 1) {
    const value = rngRange(rng, -2, 3);
    assert.ok(value >= -2 && value < 3);
    assert.equal(value, rngRange(twin, -2, 3));
  }
});
