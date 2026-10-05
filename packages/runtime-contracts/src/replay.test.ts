/**
 * Replay/resume boundary tests (lock rule 15): replay windows must start at
 * seq 1 or immediately after a persisted snapshot; simulation replays must
 * present the original seed; resumes must land on snapshot boundaries.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateReplayPlan,
  validateResumeBoundary,
  type ReplayContext,
  type SessionSnapshot,
} from "./replay.ts";
import {
  asDeterminismSeed,
  asEventSequence,
  asSessionEpoch,
  asSessionId,
  asSnapshotId,
  asTick,
} from "./primitives.ts";
import type { Digest } from "./primitives.ts";

const sessionId = asSessionId("s-replay");
const digest = "f".repeat(64) as Digest;

const snapshot = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  snapshotId: asSnapshotId("snap-1"),
  sessionId,
  epoch: asSessionEpoch(1),
  tick: asTick(10),
  afterEventSeq: asEventSequence(5),
  stateDigest: digest,
  ...over,
});

const context = (over: Partial<ReplayContext> = {}): ReplayContext => ({
  snapshots: [snapshot()],
  role: "interactive",
  committedHeadSeq: asEventSequence(9),
  sessionEpoch: asSessionEpoch(1),
  ...over,
});

test("replay from seq 1 is always boundary-legal", () => {
  const result = validateReplayPlan(
    { sessionId, fromEventSeq: asEventSequence(1), toEventSeq: null },
    context(),
  );
  assert.deepEqual(result, { ok: true, fromSeq: 1, toSeq: null });
});

test("replay may start immediately after a snapshot boundary", () => {
  const result = validateReplayPlan(
    { sessionId, fromEventSeq: asEventSequence(6), toEventSeq: asEventSequence(9) },
    context(),
  );
  assert.deepEqual(result, { ok: true, fromSeq: 6, toSeq: 9 });
});

test("replay may NOT start mid-stream (the boundary rule)", () => {
  for (const from of [2, 3, 4, 5, 7, 8]) {
    const result = validateReplayPlan(
      { sessionId, fromEventSeq: asEventSequence(from), toEventSeq: null },
      context(),
    );
    assert.equal(result.ok, false, `from seq ${from}`);
    if (!result.ok) {
      assert.equal(result.code, "mid-stream-start");
    }
  }
});

test("replay windows cannot run backwards or into the future", () => {
  const backward = validateReplayPlan(
    { sessionId, fromEventSeq: asEventSequence(6), toEventSeq: asEventSequence(5) },
    context(),
  );
  assert.equal(backward.ok, false);
  if (!backward.ok) {
    assert.equal(backward.code, "backward-window");
  }
  const future = validateReplayPlan(
    { sessionId, fromEventSeq: asEventSequence(1), toEventSeq: asEventSequence(10) },
    context(),
  );
  assert.equal(future.ok, false);
  if (!future.ok) {
    assert.equal(future.code, "future-end");
  }
});

test("simulation replays must present the original determinism seed", () => {
  const seed = asDeterminismSeed("seed-1");
  const simContext = context({
    role: "simulation",
    sessionDeterminism: seed,
  });
  const missing = validateReplayPlan(
    { sessionId, fromEventSeq: asEventSequence(1), toEventSeq: null },
    simContext,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, "seed-mismatch");
  }
  const wrong = validateReplayPlan(
    { sessionId, fromEventSeq: asEventSequence(1), toEventSeq: null, determinism: asDeterminismSeed("seed-2") },
    simContext,
  );
  assert.equal(wrong.ok, false);
  if (!wrong.ok) {
    assert.equal(wrong.code, "seed-mismatch");
  }
  const right = validateReplayPlan(
    { sessionId, fromEventSeq: asEventSequence(1), toEventSeq: null, determinism: seed },
    simContext,
  );
  assert.equal(right.ok, true);
});

test("resume boundary: checkpoint must coincide with a snapshot of the same coverage", () => {
  const ok = validateResumeBoundary(
    { afterEventSeq: 5, atEpoch: asSessionEpoch(1), snapshotId: asSnapshotId("snap-1") },
    context(),
  );
  assert.deepEqual(ok, { ok: true, snapshotId: asSnapshotId("snap-1") });

  const mismatched = validateResumeBoundary(
    { afterEventSeq: 4, atEpoch: asSessionEpoch(1), snapshotId: asSnapshotId("snap-1") },
    context(),
  );
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) {
    assert.equal(mismatched.code, "checkpoint-not-on-snapshot");
  }

  const unknown = validateResumeBoundary(
    { afterEventSeq: 5, atEpoch: asSessionEpoch(1), snapshotId: asSnapshotId("snap-ghost") },
    context(),
  );
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.code, "checkpoint-not-on-snapshot");
  }
});

test("resume boundary: epoch-stale checkpoints are refused (stale-result rule)", () => {
  const result = validateResumeBoundary(
    { afterEventSeq: 5, atEpoch: asSessionEpoch(1), snapshotId: asSnapshotId("snap-1") },
    context({ sessionEpoch: asSessionEpoch(2) }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "epoch-stale");
  }
});

test("resume boundary: no durable checkpoint is an explicit, typed outcome", () => {
  const result = validateResumeBoundary(undefined, context());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "no-durable-checkpoint");
  }
});
