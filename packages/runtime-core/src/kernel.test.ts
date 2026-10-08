/**
 * Kernel lifecycle and protocol-surface tests: phase machine, load,
 * observe, act (both origins), step, terminate, host ports, and the
 * session read model. Determinism-focused and negative cases live in
 * determinism.test.ts / negative.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStaleResultRule, asIdempotencyNonce, asIntentId, asIntentKind, asEventKind, asSessionEpoch } from "@playliquid/runtime-contracts";
import type { CommandKind } from "@playliquid/runtime-contracts";
import type { WorldDriver, WorldStep } from "./world.ts";
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
import { createInteractiveRuntime, RUNTIME_EVENT_KINDS } from "./index.ts";

function makeGrant(epoch = 1) {
  return {
    grantId: "grant-1" as never,
    holder: avatarActor("avatar-1"),
    capability: "world.counter" as never,
    scope: { sessionId: interactiveDescriptor("k-1").sessionId },
    constraints: [{ kind: "per-tick-count" as const, max: 10 }],
    issuedBy: "host-game-policy" as const,
    epoch: epoch as never,
  };
}

function makeKit(sessionId = "k-1", seed?: string) {
  const clock = new ManualClock(0);
  const store = new InMemorySnapshotStore();
  const renderer = new InMemoryRenderer();
  const transport = new InMemoryTransport();
  const input = new InMemoryInputSource();
  const grants = [makeGrant()];
  const broker = new GrantTableCapabilityPort({
    grants,
    capabilityIntentKinds: { "world.counter": [asIntentKind("world.increment")] },
    intentCommandKinds: { "world.increment": "world.increment", "world.move": "world.move" },
    clock,
  });
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor(sessionId, seed),
    driver: new CounterWorldDriver(),
    capabilityPort: broker,
    snapshotStore: store,
    renderer,
    transport,
    inputSource: input,
  });
  if (created.status !== "created") throw new Error(created.detail);
  return { kernel: created.kernel, clock, store, renderer, transport, input, broker, grants };
}

function playerIntent(n: number, kind = "world.increment", payload: unknown = { by: 1 }) {
  return {
    intent: {
      intentId: asIntentId(`i-p-${n}`),
      kind: asIntentKind(kind),
      actor: playerActor("player-1"),
      payload,
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce(`n-p-${n}`),
  };
}

function avatarIntent(n: number, payload: unknown = { by: 1 }) {
  return {
    intent: {
      intentId: asIntentId(`i-a-${n}`),
      kind: asIntentKind("world.increment"),
      actor: avatarActor("avatar-1"),
      payload,
      issuedAt: 0 as never,
    },
    grantId: "grant-1" as never,
    nonce: asIdempotencyNonce(`n-a-${n}`),
  };
}

test("construction refuses simulation descriptors (PL-014 owns that role)", () => {
  const created = createInteractiveRuntime({
    descriptor: { ...interactiveDescriptor("k-sim"), role: "simulation" },
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({
      capabilityIntentKinds: {},
      intentCommandKinds: {},
      clock: new ManualClock(),
    }),
    snapshotStore: new InMemorySnapshotStore(),
  });
  assert.equal(created.status, "rejected");
  if (created.status === "rejected") {
    assert.equal(created.code, "wrong-role");
    assert.match(created.detail, /PL-014/);
  }
});

test("construction rejects invalid limits", () => {
  assert.throws(() =>
    createInteractiveRuntime({
      descriptor: interactiveDescriptor("k-lim"),
      driver: new CounterWorldDriver(),
      capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: {}, clock: new ManualClock() }),
      snapshotStore: new InMemorySnapshotStore(),
      limits: { maxTicksPerStep: 0 },
    }),
  RangeError);
});

test("load: provisioning -> loading -> ready with a lifecycle event", () => {
  const { kernel } = makeKit();
  assert.equal(kernel.view().phase, "provisioning");
  const loaded = kernel.load();
  assert.equal(loaded.status, "loaded");
  assert.equal(kernel.view().phase, "ready");
  assert.equal(kernel.view().tick, 0);
  assert.equal(kernel.view().epoch, 1);
  if (loaded.status === "loaded") {
    assert.equal(loaded.events.length, 1);
    assert.equal(String(loaded.events[0]?.kind), RUNTIME_EVENT_KINDS.loaded);
    assert.deepEqual(loaded.events[0]?.cause, { kind: "system" });
    assert.equal(loaded.events[0]?.seq, 1);
  }
});

test("load: a second load is refused (wrong-phase)", () => {
  const { kernel } = makeKit();
  kernel.load();
  const again = kernel.load();
  assert.equal(again.status, "rejected");
  if (again.status === "rejected") assert.equal(again.code, "wrong-phase");
});

test("load: invalid world reference is refused", () => {
  const { kernel } = makeKit();
  const descriptor = kernel.descriptor;
  const broken = createInteractiveRuntime({
    descriptor: {
      ...descriptor,
      game: { ...descriptor.game, world: { worldId: "w", revisionDigest: "short" as never } },
    },
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: {}, clock: new ManualClock() }),
    snapshotStore: new InMemorySnapshotStore(),
  });
  if (broken.status !== "created") throw new Error("unreachable");
  const result = broken.kernel.load();
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "invalid-load");
});

test("act (player origin): commits through the canonical command path", () => {
  const { kernel } = makeKit();
  kernel.load();
  const result = kernel.act(playerIntent(1, "world.increment", { by: 3 }));
  assert.equal(result.status, "committed");
  assert.equal(kernel.view().admittedCommandSeq, 1);
  if (result.status === "committed") {
    assert.equal(result.events.length, 1);
    assert.deepEqual(result.events[0]?.cause, { kind: "command", commandId: result.commandId });
    assert.deepEqual(result.events[0]?.payload, { by: 3, count: 3, atTick: 0 });
  }
});

test("act (avatar-agent origin): commits through the CapabilityPort seam", () => {
  const { kernel } = makeKit();
  kernel.load();
  const result = kernel.act(avatarIntent(1, { by: 2 }));
  assert.equal(result.status, "committed");
  if (result.status === "committed") {
    assert.match(String(result.commandId), /^cmd-/);
    assert.deepEqual(result.events[0]?.cause, { kind: "command", commandId: result.commandId });
  }
});

test("act before load is refused (wrong-phase)", () => {
  const { kernel } = makeKit();
  const result = kernel.act(playerIntent(1));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "wrong-phase");
});

test("step: advances exactly N fixed ticks and moves ready -> running", () => {
  const { kernel } = makeKit();
  kernel.load();
  kernel.act(playerIntent(1, "world.increment", { by: 0 }));
  const before = kernel.view().tick;
  const result = kernel.step(3);
  assert.equal(result.status, "stepped");
  assert.equal(kernel.view().phase, "running");
  assert.equal(kernel.view().tick, before + 3);
  if (result.status === "stepped") {
    assert.equal(result.fromTick, 0);
    assert.equal(result.toTick, 3);
    assert.equal(result.events.length, 3);
    for (const event of result.events) {
      assert.deepEqual(event.cause, { kind: "system" });
    }
  }
});

test("step: refuses zero, negative, fractional, and oversized tick counts", () => {
  const { kernel } = makeKit();
  kernel.load();
  for (const ticks of [0, -1, 1.5, 1025]) {
    const result = kernel.step(ticks);
    assert.equal(result.status, "rejected", `ticks=${String(ticks)}`);
    if (result.status === "rejected") assert.equal(result.code, "invalid-ticks");
  }
  assert.equal(kernel.view().tick, 0);
});

test("observe: cursor semantics over the immutable log", () => {
  const { kernel } = makeKit();
  kernel.load();
  kernel.act(playerIntent(1, "world.increment", { by: 1 }));
  kernel.step(2);
  const all = kernel.observe(0);
  assert.equal(all.status, "observed");
  if (all.status === "observed") {
    assert.equal(all.observation.events.length, 4);
    assert.equal(all.observation.nextCursor, 4);
    assert.equal(all.observation.phase, "running");
    assert.equal(all.observation.epoch, 1);
    const tail = kernel.observe(3);
    if (tail.status === "observed") {
      assert.equal(tail.observation.events.length, 1);
      assert.equal(tail.observation.nextCursor, 4);
    } else {
      assert.fail("tail observe failed");
    }
  } else {
    assert.fail("observe failed");
  }
});

test("observe: refuses cursors outside [0, head]", () => {
  const { kernel } = makeKit();
  kernel.load();
  for (const cursor of [-1, 2, 99, 0.5]) {
    const result = kernel.observe(cursor);
    assert.equal(result.status, "rejected", `cursor=${String(cursor)}`);
    if (result.status === "rejected") assert.equal(result.code, "invalid-cursor");
  }
});

test("terminate: graceful stop emits both events and closes the session", () => {
  const { kernel } = makeKit();
  kernel.load();
  const result = kernel.terminate("done");
  assert.equal(result.status, "terminated");
  assert.equal(kernel.view().phase, "terminated");
  if (result.status === "terminated") {
    assert.equal(result.events.length, 2);
    assert.equal(String(result.events[0]?.kind), RUNTIME_EVENT_KINDS.terminating);
    assert.equal(String(result.events[1]?.kind), RUNTIME_EVENT_KINDS.terminated);
  }
  const after = kernel.observe(0);
  assert.equal(after.status, "rejected");
  if (after.status === "rejected") assert.equal(after.code, "session-terminal");
});

test("event ids are deterministic and sequences are gapless", () => {
  const { kernel } = makeKit("k-ids");
  kernel.load();
  kernel.act(playerIntent(1, "world.increment", { by: 1 }));
  kernel.step(2);
  const observed = kernel.observe(0);
  if (observed.status !== "observed") throw new Error("observe failed");
  let expected = 1;
  for (const event of observed.observation.events) {
    assert.equal(String(event.eventId), `k-ids#e${String(expected)}`);
    assert.equal(event.seq, expected);
    expected += 1;
  }
  assert.equal(kernel.verifyLogIntegrity().ok, true);
});

test("renderer receives a frame per committed event batch", () => {
  const { kernel, renderer } = makeKit();
  kernel.load();
  kernel.act(playerIntent(1, "world.increment", { by: 1 }));
  kernel.step(1);
  kernel.terminate("bye");
  assert.equal(renderer.frames.length, 4);
  const last = renderer.frames[renderer.frames.length - 1];
  assert.ok(last !== undefined);
  assert.equal(last.phase, "terminated");
  assert.equal(last.events.length, 2);
  assert.equal(last.committedEventSeq, 5);
});

test("transport receives receipts and observations, one-way", () => {
  const { kernel, transport } = makeKit();
  kernel.load();
  kernel.act(playerIntent(1, "world.increment", { by: 1 }));
  kernel.observe(0);
  assert.equal(transport.messages.length, 2);
  assert.deepEqual(transport.messages[0]?.kind, "receipt");
  assert.deepEqual(transport.messages[1]?.kind, "observation");
  const receipt = transport.messages[0];
  if (receipt?.kind === "receipt") {
    assert.equal(receipt.receipt.status, "committed");
    assert.equal(receipt.receipt.seq, 1);
  }
});

test("harvestInputs routes polled samples through the full act path", () => {
  const { kernel, input } = makeKit();
  kernel.load();
  input.enqueue(playerIntent(1, "world.increment", { by: 2 }));
  input.enqueue(avatarIntent(1, { by: 5 }));
  const results = kernel.harvestInputs();
  assert.equal(results.length, 2);
  assert.equal(results[0]?.status, "committed");
  assert.equal(results[1]?.status, "committed");
  assert.equal(input.pending, 0);
  assert.equal(kernel.harvestInputs().length, 0);
});

test("harvestInputs without an input source is a no-op", () => {
  const clock = new ManualClock();
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor("k-noinput"),
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: {}, clock }),
    snapshotStore: new InMemorySnapshotStore(),
  });
  if (created.status !== "created") throw new Error(created.detail);
  created.kernel.load();
  assert.deepEqual(created.kernel.harvestInputs(), []);
});

test("driver flood fails the session (deterministic guard)", () => {
  const clock = new ManualClock();
  const floodDriver: WorldDriver<{ readonly count: number }> = {
    worldKind: "test/flood@1",
    commandPolicy: { "flood.go": ["ready", "running"] as const },
    initialWorld: () => ({ count: 0 }),
    applyCommand: (world): WorldStep<{ readonly count: number }> => ({
      world: { count: world.count + 1 },
      effects: [
        { kind: asEventKind("flood.event"), payload: { n: 1 } },
        { kind: asEventKind("flood.event"), payload: { n: 2 } },
      ],
    }),
    tickWorld: (world): WorldStep<{ readonly count: number }> => ({
      world: { count: world.count + 1 },
      effects: [{ kind: asEventKind("flood.tick"), payload: { n: 1 } }],
    }),
    intentToCommandKind: (kind: string): CommandKind | undefined => kind as CommandKind,
  };
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor("k-flood"),
    driver: floodDriver,
    capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: {}, clock }),
    snapshotStore: new InMemorySnapshotStore(),
    limits: { maxEventsPerCommand: 1, maxEventsPerTick: 1 },
  });
  if (created.status !== "created") throw new Error(created.detail);
  const kernel = created.kernel;
  kernel.load();
  const result = kernel.act({
    intent: {
      intentId: asIntentId("i-flood"),
      kind: asIntentKind("flood.go"),
      actor: playerActor("p"),
      payload: {},
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce("n-flood"),
  });
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.code, "driver-failure");
    assert.match(result.detail, /flood/);
  }
  assert.equal(kernel.view().phase, "failed");
  const after = kernel.step(1);
  assert.equal(after.status, "rejected");
  if (after.status === "rejected") assert.equal(after.code, "session-terminal");
});

test("driver exception fails the session (one owner, fail closed)", () => {
  const clock = new ManualClock();
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor("k-throw"),
    driver: new CounterWorldDriver(),
    capabilityPort: new GrantTableCapabilityPort({ capabilityIntentKinds: {}, intentCommandKinds: {}, clock }),
    snapshotStore: new InMemorySnapshotStore(),
  });
  if (created.status !== "created") throw new Error(created.detail);
  const kernel = created.kernel;
  kernel.load();
  const result = kernel.act(playerIntent(1, "world.increment", { by: 0.5 }));
  assert.equal(result.status, "failed");
  assert.equal(kernel.view().phase, "failed");
  const final = kernel.verifyLogIntegrity();
  assert.equal(final.ok, true);
});

test("results are epoch-tagged for the stale-result rule", () => {
  const { kernel } = makeKit();
  kernel.load();
  const result = kernel.act(playerIntent(1, "world.increment", { by: 1 }));
  if (result.status !== "committed") throw new Error("act failed");
  assert.deepEqual(applyStaleResultRule(result, asSessionEpoch(1)), { stale: false, disposition: "current" });
  assert.deepEqual(applyStaleResultRule(result, asSessionEpoch(2)), { stale: true, disposition: "superseded" });
});

test("view() reflects the authoritative read model after each op", () => {
  const { kernel } = makeKit("k-view");
  const zero = kernel.view();
  assert.deepEqual(
    { phase: zero.phase, epoch: zero.epoch, tick: zero.tick, committedEventSeq: zero.committedEventSeq, admittedCommandSeq: zero.admittedCommandSeq },
    { phase: "provisioning", epoch: 1, tick: 0, committedEventSeq: 0, admittedCommandSeq: 0 },
  );
  kernel.load();
  kernel.act(playerIntent(1, "world.increment", { by: 1 }));
  kernel.step(1);
  const now = kernel.view();
  assert.equal(now.phase, "running");
  assert.equal(now.committedEventSeq, 3);
  assert.equal(now.admittedCommandSeq, 1);
  assert.equal(String(now.sessionId), "k-view");
});
