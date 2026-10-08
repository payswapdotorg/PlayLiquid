/**
 * Host-side port fake tests: clock, renderer, input source, transport, and
 * the content-addressed snapshot store (real sha-256 digests, dedup, and
 * volatile-storage honesty).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { asIdempotencyNonce, asIntentId, asIntentKind, isValidDigest } from "@playliquid/runtime-contracts";
import {
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemoryInputSource,
  InMemoryRenderer,
  InMemorySnapshotStore,
  InMemoryTransport,
  ManualClock,
  avatarActor,
  interactiveDescriptor,
  playerActor,
} from "./fakes.ts";
import { createInteractiveRuntime } from "./index.ts";
import { SNAPSHOT_FORMAT, canonicalJson } from "./serialize.ts";
import type { KernelSnapshotPayload } from "./serialize.ts";

test("ManualClock: deterministic injected time authority", () => {
  const clock = new ManualClock(100);
  assert.equal(clock.now(), 100);
  clock.advance(50);
  assert.equal(clock.now(), 150);
  clock.advance(0);
  assert.equal(clock.now(), 150);
});

test("InMemoryRenderer: records presented frames in order", () => {
  const renderer = new InMemoryRenderer();
  renderer.present({ sessionId: "s" as never, tick: 0 as never, epoch: 1 as never, phase: "ready", events: [], committedEventSeq: 0 });
  renderer.present({ sessionId: "s" as never, tick: 1 as never, epoch: 1 as never, phase: "running", events: [], committedEventSeq: 1 });
  assert.equal(renderer.frames.length, 2);
  assert.equal(renderer.lastFrame?.phase, "running");
  assert.equal(renderer.frames[0]?.phase, "ready");
});

test("InMemoryInputSource: enqueue then drain; poll is destructive", () => {
  const source = new InMemoryInputSource();
  assert.equal(source.pending, 0);
  const sample = {
    intent: {
      intentId: asIntentId("i-1"),
      kind: asIntentKind("world.increment"),
      actor: playerActor("p-1"),
      payload: { by: 1 },
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce("n-1"),
  };
  source.enqueue(sample);
  source.enqueue(sample);
  assert.equal(source.pending, 2);
  const drained = source.poll();
  assert.equal(drained.length, 2);
  assert.equal(source.pending, 0);
  assert.equal(source.poll().length, 0);
});

test("InMemoryTransport: records every posted message", () => {
  const transport = new InMemoryTransport();
  transport.post({ kind: "receipt", receipt: { status: "committed", commandId: "c" as never, seq: 1 as never }, sessionId: "s" as never });
  assert.equal(transport.messages.length, 1);
  assert.equal(transport.messages[0]?.kind, "receipt");
});

test("InMemorySnapshotStore: computes REAL sha-256 digests", () => {
  const store = new InMemorySnapshotStore();
  const payload: KernelSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    sessionId: "s-1",
    epoch: 1,
    tick: 2,
    committedEventSeq: 3,
    admittedCommandSeq: 1,
    worldKind: "k@1",
    world: { count: 4, moves: [1] },
  };
  const bytes = canonicalJson(payload);
  const stored = store.save(payload, bytes);
  const expected = createHash("sha256").update(bytes, "utf8").digest("hex");
  assert.equal(stored.stateDigest, expected);
  assert.ok(isValidDigest(stored.stateDigest));
  assert.equal(String(stored.snapshotId), expected.slice(0, 16));
});

test("InMemorySnapshotStore: identical bytes deduplicate to one address", () => {
  const store = new InMemorySnapshotStore();
  const payload: KernelSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    sessionId: "s-1",
    epoch: 1,
    tick: 0,
    committedEventSeq: 0,
    admittedCommandSeq: 0,
    worldKind: "k@1",
    world: {},
  };
  const bytes = canonicalJson(payload);
  const first = store.save(payload, bytes);
  const second = store.save({ ...payload }, bytes);
  assert.deepEqual(first, second);
  assert.equal(store.entries.length, 1);
  // Different bytes -> different content address.
  const other = store.save({ ...payload, tick: 1 }, canonicalJson({ ...payload, tick: 1 }));
  assert.notEqual(other.snapshotId, first.snapshotId);
  assert.equal(store.entries.length, 2);
});

test("InMemorySnapshotStore: load returns the saved payload", () => {
  const store = new InMemorySnapshotStore();
  const payload: KernelSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    sessionId: "s-1",
    epoch: 1,
    tick: 9,
    committedEventSeq: 9,
    admittedCommandSeq: 9,
    worldKind: "k@1",
    world: { count: 9 },
  };
  const stored = store.save(payload, canonicalJson(payload));
  assert.deepEqual(store.load(stored.snapshotId), payload);
  assert.equal(store.load("nope" as never), undefined);
});

test("kernel + fakes end-to-end: input source drives acts through the ports", () => {
  const clock = new ManualClock(0);
  const store = new InMemorySnapshotStore();
  const renderer = new InMemoryRenderer();
  const transport = new InMemoryTransport();
  const input = new InMemoryInputSource();
  const broker = new GrantTableCapabilityPort({
    capabilityIntentKinds: {},
    intentCommandKinds: { "world.increment": "world.increment" },
    clock,
  });
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor("ports-e2e", "seed-1"),
    driver: new CounterWorldDriver(),
    capabilityPort: broker,
    snapshotStore: store,
    renderer,
    transport,
    inputSource: input,
  });
  if (created.status !== "created") throw new Error(created.detail);
  const kernel = created.kernel;
  kernel.load();
  input.enqueue({
    intent: {
      intentId: asIntentId("i-e2e"),
      kind: asIntentKind("world.increment"),
      actor: playerActor("p-1"),
      payload: { by: 2 },
      issuedAt: clock.now(),
    },
    nonce: asIdempotencyNonce("n-e2e"),
  });
  input.enqueue({
    intent: {
      intentId: asIntentId("i-e2e-2"),
      kind: asIntentKind("world.increment"),
      actor: avatarActor("a-1"),
      payload: { by: 5 },
      issuedAt: clock.now(),
    },
    grantId: "no-grant" as never,
    nonce: asIdempotencyNonce("n-e2e-2"),
  });
  const results = kernel.harvestInputs();
  assert.equal(results[0]?.status, "committed");
  assert.equal(results[1]?.status, "rejected");
  if (results[1]?.status === "rejected") assert.equal(results[1].code, "capability-denied");
  assert.equal(renderer.frames.length, 2);
  assert.equal(transport.messages.length, 1);
  assert.equal(kernel.view().admittedCommandSeq, 1);
});
