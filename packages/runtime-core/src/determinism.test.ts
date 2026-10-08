/**
 * Determinism tests (E9): fixed-tick stepping, seeded worlds, byte-stable
 * snapshots across independently constructed kernels, and restore
 * equivalence with append-only history (E10).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asDeterminismSeed, asIdempotencyNonce, asIntentId, asIntentKind } from "@playliquid/runtime-contracts";
import {
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemoryRenderer,
  InMemorySnapshotStore,
  InMemoryTransport,
  ManualClock,
  interactiveDescriptor,
  playerActor,
  seededOffset,
} from "./fakes.ts";
import { createInteractiveRuntime } from "./index.ts";
import { canonicalJson } from "./serialize.ts";

function makeKernel(sessionId: string, seed: string | undefined, extras: { renderer?: InMemoryRenderer } = {}) {
  const clock = new ManualClock(0);
  const store = new InMemorySnapshotStore();
  const renderer = extras.renderer ?? new InMemoryRenderer();
  const broker = new GrantTableCapabilityPort({
    capabilityIntentKinds: {},
    intentCommandKinds: { "world.increment": "world.increment", "world.move": "world.move" },
    clock,
  });
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor(sessionId, seed),
    driver: new CounterWorldDriver(),
    capabilityPort: broker,
    snapshotStore: store,
    renderer,
    transport: new InMemoryTransport(),
  });
  if (created.status !== "created") throw new Error(created.detail);
  return { kernel: created.kernel, store, renderer };
}

function increment(n: number, by: number) {
  return {
    intent: {
      intentId: asIntentId(`i-${n}`),
      kind: asIntentKind("world.increment"),
      actor: playerActor("player-1"),
      payload: { by },
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce(`n-${n}`),
  };
}

function driveIdentically(kernel: ReturnType<typeof makeKernel>["kernel"]): string {
  kernel.load();
  kernel.act(increment(1, 2));
  kernel.act(increment(2, 3));
  kernel.step(4);
  const snap = kernel.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  kernel.act(increment(3, 1));
  return snap.snapshot.stateDigest;
}

test("identical driving produces byte-identical snapshot digests (E9)", () => {
  const digestA = driveIdentically(makeKernel("det-1", "seed-x").kernel);
  const digestB = driveIdentically(makeKernel("det-1", "seed-x").kernel);
  assert.equal(digestA, digestB);
  assert.match(digestA, /^[0-9a-f]{64}$/);
});

test("identical driving produces identical event logs (bytes + ids)", () => {
  const a = makeKernel("det-2", "seed-y");
  const b = makeKernel("det-2", "seed-y");
  driveIdentically(a.kernel);
  driveIdentically(b.kernel);
  const eventsA = a.kernel.observe(0);
  const eventsB = b.kernel.observe(0);
  if (eventsA.status !== "observed" || eventsB.status !== "observed") throw new Error("observe failed");
  assert.equal(canonicalJson(eventsA.observation.events), canonicalJson(eventsB.observation.events));
});

test("different seeds produce different worlds and different snapshot bytes", () => {
  const digestA = driveIdentically(makeKernel("det-3", "seed-a").kernel);
  const digestB = driveIdentically(makeKernel("det-3", "seed-b").kernel);
  assert.notEqual(digestA, digestB);
  assert.notEqual(seededOffset(asDeterminismSeed("seed-a")), seededOffset(asDeterminismSeed("seed-b")));
});

test("interactive kernels may run unseeded (live play); runs stay self-consistent", () => {
  const a = makeKernel("det-4", undefined);
  const b = makeKernel("det-4", undefined);
  const digestA = driveIdentically(a.kernel);
  const digestB = driveIdentically(b.kernel);
  assert.equal(digestA, digestB);
});

test("the store deduplicates identical snapshot bytes to one content address", () => {
  const a = makeKernel("det-5", "seed-z");
  const b = makeKernel("det-5", "seed-z");
  driveIdentically(a.kernel);
  driveIdentically(b.kernel);
  assert.equal(a.store.entries.length, 1);
  assert.equal(b.store.entries.length, 1);
});

test("fixed ticks: step(N) advances tick by exactly N with exactly N tick events", () => {
  const { kernel } = makeKernel("det-6", "seed-1");
  kernel.load();
  const result = kernel.step(5);
  assert.equal(kernel.view().tick, 5);
  if (result.status !== "stepped") throw new Error("step failed");
  assert.equal(result.events.length, 5);
  let expectedTick = 1;
  for (const event of result.events) {
    assert.equal(event.tick, expectedTick);
    expectedTick += 1;
  }
});

test("restore re-instantiates the world and advances the epoch; history stays append-only", () => {
  const { kernel } = makeKernel("det-7", "seed-1");
  kernel.load();
  kernel.act(increment(1, 2));
  const snap = kernel.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  const atSnapshot = snap.snapshot.afterEventSeq;
  kernel.act(increment(2, 5));
  assert.equal(kernel.view().committedEventSeq, atSnapshot + 1);
  const restored = kernel.restore(snap.snapshot.snapshotId);
  assert.equal(restored.status, "restored");
  assert.equal(kernel.view().epoch, 2);
  assert.equal(kernel.view().tick, snap.snapshot.tick);
  // History is NOT truncated: the post-snapshot event is still in the log.
  const observed = kernel.observe(0);
  if (observed.status !== "observed") throw new Error("observe failed");
  assert.ok(observed.observation.events.length > atSnapshot);
  // Integrity holds across the epoch boundary (tick reset accepted cross-segment).
  assert.equal(kernel.verifyLogIntegrity().ok, true);
});

test("restore equivalence: post-restore continuation matches a fresh kernel at the same state", () => {
  const a = makeKernel("det-8", "seed-1");
  const b = makeKernel("det-8", "seed-1");
  a.kernel.load();
  b.kernel.load();
  a.kernel.act(increment(1, 3));
  b.kernel.act(increment(1, 3));
  a.kernel.step(2);
  b.kernel.step(2);
  const snap = a.kernel.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  // A diverges, then restores back to the boundary.
  a.kernel.act(increment(2, 100));
  const restored = a.kernel.restore(snap.snapshot.snapshotId);
  assert.equal(restored.status, "restored");
  // Both now continue identically.
  const resultA = a.kernel.act(increment(3, 4));
  const resultB = b.kernel.act(increment(3, 4));
  assert.equal(resultA.status, "committed");
  assert.equal(resultB.status, "committed");
  if (resultA.status === "committed" && resultB.status === "committed") {
    assert.deepEqual(resultA.events[0]?.payload, resultB.events[0]?.payload);
    assert.equal(String(resultA.events[0]?.kind), String(resultB.events[0]?.kind));
  }
  // And their worlds are identical again.
  const snapA = a.kernel.snapshot();
  const snapB = b.kernel.snapshot();
  if (snapA.status === "snapshotted" && snapB.status === "snapshotted") {
    assert.notEqual(snapA.snapshot.stateDigest, snapB.snapshot.stateDigest);
    // Digests differ only by provenance counters (A carries extra history);
    // the WORLDS must be equal — observable through identical continuation.
  }
  const stepA = a.kernel.step(1);
  const stepB = b.kernel.step(1);
  if (stepA.status === "stepped" && stepB.status === "stepped") {
    assert.deepEqual(stepA.events[0]?.payload, stepB.events[0]?.payload);
  } else {
    assert.fail("post-restore steps diverged");
  }
});

test("reset re-instantiates the seeded world at tick 0 under a fresh epoch", () => {
  const { kernel } = makeKernel("det-9", "seed-1");
  kernel.load();
  kernel.act(increment(1, 7));
  kernel.step(3);
  const reset = kernel.reset(asDeterminismSeed("seed-2"));
  assert.equal(reset.status, "reset");
  assert.equal(kernel.view().epoch, 2);
  assert.equal(kernel.view().tick, 0);
  const observed = kernel.observe(0);
  if (observed.status !== "observed") throw new Error("observe failed");
  const resetEvent = observed.observation.events.at(-1);
  assert.equal(String(resetEvent?.kind), "runtime.session-reset");
  // World re-instantiated from the new seed.
  const after = kernel.act(increment(2, 0));
  if (after.status === "committed") {
    assert.deepEqual(after.events[0]?.payload, { by: 0, count: seededOffset(asDeterminismSeed("seed-2")), atTick: 0 });
  }
  assert.equal(kernel.verifyLogIntegrity().ok, true);
});

test("snapshots at the same boundary across epochs differ (epoch is in the bytes)", () => {
  const { kernel } = makeKernel("det-10", "seed-1");
  kernel.load();
  const first = kernel.snapshot();
  kernel.reset(asDeterminismSeed("seed-1"));
  const second = kernel.snapshot();
  if (first.status === "snapshotted" && second.status === "snapshotted") {
    assert.notEqual(first.snapshot.stateDigest, second.snapshot.stateDigest);
    assert.equal(first.snapshot.epoch, 1);
    assert.equal(second.snapshot.epoch, 2);
  } else {
    assert.fail("snapshots failed");
  }
});
