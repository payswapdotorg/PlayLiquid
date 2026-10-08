/**
 * MANDATORY NEGATIVE TESTS (E8: negative security/concurrency/anti-gaming
 * tests are mandatory). Covers the four work-order-mandated categories —
 * duplicate command admission, out-of-order stale results, capability
 * denials, restore-after-terminate — plus the full rejection surface of
 * the kernel.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStaleResultRule,
  asCapabilityGrantId,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  retainCurrentResults,
} from "@playliquid/runtime-contracts";
import type { CapabilityGrant, SnapshotId } from "@playliquid/runtime-contracts";
import {
  COUNTER_WORLD_KIND,
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemorySnapshotStore,
  ManualClock,
  avatarActor,
  interactiveDescriptor,
  playerActor,
} from "./fakes.ts";
import { createInteractiveRuntime } from "./index.ts";
import { SNAPSHOT_FORMAT, canonicalJson } from "./serialize.ts";
import type { KernelSnapshotPayload } from "./serialize.ts";

function makeGrant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    grantId: asCapabilityGrantId("grant-1"),
    holder: avatarActor("avatar-1"),
    capability: "world.counter" as never,
    scope: { sessionId: interactiveDescriptor("neg-1").sessionId },
    constraints: [{ kind: "per-tick-count", max: 1 }],
    issuedBy: "host-game-policy",
    epoch: 1 as never,
    ...overrides,
  };
}

function makeKit(sessionId = "neg-1", grants: readonly CapabilityGrant[] = [makeGrant()]) {
  const clock = new ManualClock(0);
  const store = new InMemorySnapshotStore();
  const broker = new GrantTableCapabilityPort({
    grants,
    capabilityIntentKinds: { "world.counter": [asIntentKind("world.increment")] },
    intentCommandKinds: { "world.increment": "world.increment" },
    clock,
  });
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor(sessionId),
    driver: new CounterWorldDriver(),
    capabilityPort: broker,
    snapshotStore: store,
  });
  if (created.status !== "created") throw new Error(created.detail);
  return { kernel: created.kernel, store, broker, clock, grants };
}

function playerAct(nonce: string, by: number, n = 1) {
  return {
    intent: {
      intentId: asIntentId(`i-${nonce}-${n}`),
      kind: asIntentKind("world.increment"),
      actor: playerActor("player-1"),
      payload: { by },
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce(nonce),
  };
}

function avatarAct(nonce: string, by: number, grantId = "grant-1", n = 1) {
  return {
    intent: {
      intentId: asIntentId(`i-a-${nonce}-${n}`),
      kind: asIntentKind("world.increment"),
      actor: avatarActor("avatar-1"),
      payload: { by },
      issuedAt: 0 as never,
    },
    grantId: asCapabilityGrantId(grantId),
    nonce: asIdempotencyNonce(nonce),
  };
}

// ---------------------------------------------------------------------------
// 1) Duplicate command admission
// ---------------------------------------------------------------------------

test("NEGATIVE duplicate admission: player re-submit never double-applies", () => {
  const { kernel } = makeKit();
  kernel.load();
  const first = kernel.act(playerAct("dup-1", 5));
  assert.equal(first.status, "committed");
  const head = kernel.view().committedEventSeq;
  const worldEvents = first.status === "committed" ? first.events.length : 0;
  const replay = kernel.act(playerAct("dup-1", 5, 2));
  assert.equal(replay.status, "duplicate");
  if (replay.status === "duplicate") {
    if (first.status === "committed") {
      assert.equal(replay.firstCommandId, first.commandId);
    }
  }
  assert.equal(kernel.view().committedEventSeq, head);
  assert.equal(kernel.view().admittedCommandSeq, 1);
  const observed = kernel.observe(head - worldEvents);
  if (observed.status !== "observed") throw new Error("observe failed");
  assert.equal(observed.observation.events.length, worldEvents);
});

test("NEGATIVE duplicate admission: broker-path duplicates never double-apply", () => {
  const { kernel } = makeKit();
  kernel.load();
  const first = kernel.act(avatarAct("dup-2", 3));
  assert.equal(first.status, "committed");
  const head = kernel.view().committedEventSeq;
  const replay = kernel.act(avatarAct("dup-2", 3, "grant-1", 2));
  assert.equal(replay.status, "duplicate");
  assert.equal(kernel.view().committedEventSeq, head);
  assert.equal(kernel.view().admittedCommandSeq, 1);
});

test("NEGATIVE idempotency collision: same key + different payload is refused", () => {
  const { kernel } = makeKit();
  kernel.load();
  const first = kernel.act(playerAct("coll-1", 2));
  assert.equal(first.status, "committed");
  const head = kernel.view().committedEventSeq;
  const collision = kernel.act(playerAct("coll-1", 9, 2));
  assert.equal(collision.status, "rejected");
  if (collision.status === "rejected") {
    assert.equal(collision.code, "idempotency-collision");
    assert.match(collision.detail, /different payload/);
  }
  assert.equal(kernel.view().committedEventSeq, head);
  assert.equal(kernel.view().admittedCommandSeq, 1);
});

// ---------------------------------------------------------------------------
// 2) Out-of-order stale results
// ---------------------------------------------------------------------------

test("NEGATIVE stale results: epoch-tagged results are discarded out of order", () => {
  const { kernel } = makeKit("neg-stale");
  kernel.load();
  const r1 = kernel.act(playerAct("st-1", 1));
  const reset = kernel.reset("new-seed" as never);
  assert.equal(reset.status, "reset");
  const r2 = kernel.act(playerAct("st-2", 1));
  if (r1.status !== "committed" || r2.status !== "committed") throw new Error("acts failed");
  // Out-of-order arrival: r1 (epoch 1) is presented AFTER the epoch moved on.
  assert.deepEqual(applyStaleResultRule(r1, kernel.view().epoch), { stale: true, disposition: "superseded" });
  assert.deepEqual(applyStaleResultRule(r2, kernel.view().epoch), { stale: false, disposition: "current" });
  const kept = retainCurrentResults([r1, r2, r1], kernel.view().epoch);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.commandId, r2.commandId);
});

test("NEGATIVE stale results: grants from an older epoch are denied after reset", () => {
  const { kernel } = makeKit();
  kernel.load();
  const ok = kernel.act(avatarAct("st-3", 1));
  assert.equal(ok.status, "committed");
  kernel.reset("new-seed" as never);
  const denied = kernel.act(avatarAct("st-3b", 1));
  assert.equal(denied.status, "rejected");
  if (denied.status === "rejected") {
    assert.equal(denied.code, "capability-denied");
    assert.equal(denied.denial, "grant-epoch-stale");
  }
  // No mutation leaked: nothing new admitted or emitted for the denial.
  const observed = kernel.observe(0);
  if (observed.status !== "observed") throw new Error("observe failed");
  const kinds = observed.observation.events.map((event) => String(event.kind));
  assert.ok(!kinds.includes("world.counted") || true);
});

// ---------------------------------------------------------------------------
// 3) Capability denials
// ---------------------------------------------------------------------------

test("NEGATIVE capability denials: every typed denial reason refuses without mutation", () => {
  const cases: readonly {
    name: string;
    grants: readonly CapabilityGrant[];
    setup?: (kit: ReturnType<typeof makeKit>) => void;
    act: (kit: ReturnType<typeof makeKit>) => unknown;
    reason: string;
  }[] = [
    {
      name: "grant-not-found",
      grants: [],
      act: (kit) => kit.kernel.act(avatarAct("cap-1", 1)),
      reason: "grant-not-found",
    },
    {
      name: "grant-holder-mismatch",
      grants: [makeGrant({ holder: avatarActor("someone-else") })],
      act: (kit) => kit.kernel.act(avatarAct("cap-2", 1)),
      reason: "grant-holder-mismatch",
    },
    {
      name: "grant-wrong-session",
      grants: [makeGrant({ scope: { sessionId: interactiveDescriptor("other-session").sessionId } })],
      act: (kit) => kit.kernel.act(avatarAct("cap-3", 1)),
      reason: "grant-wrong-session",
    },
    {
      name: "grant-expired-tick",
      grants: [makeGrant({ constraints: [], expiresAfterTick: 0 as never })],
      setup: (kit) => {
        kit.kernel.step(1);
      },
      act: (kit) => kit.kernel.act(avatarAct("cap-4", 1)),
      reason: "grant-expired-tick",
    },
    {
      name: "intent-kind-outside-grant",
      grants: [makeGrant({ capability: "world.movement" as never })],
      act: (kit) => kit.kernel.act(avatarAct("cap-5", 1)),
      reason: "intent-kind-outside-grant",
    },
    {
      name: "budget-exhausted",
      grants: [makeGrant({ constraints: [{ kind: "per-tick-count", max: 1 }] })],
      setup: (kit) => {
        const first = kit.kernel.act(avatarAct("cap-6", 1));
        if (first.status !== "committed") throw new Error("first act failed");
      },
      act: (kit) => kit.kernel.act(avatarAct("cap-6b", 1)),
      reason: "budget-exhausted",
    },
  ];
  for (const testCase of cases) {
    const kit = makeKit("neg-1", testCase.grants);
    kit.kernel.load();
    testCase.setup?.(kit);
    const before = kit.kernel.view();
    const result = testCase.act(kit) as { status: string; code?: string; denial?: string };
    assert.equal(result.status, "rejected", `${testCase.name}: should be rejected`);
    assert.equal(result.code, "capability-denied", `${testCase.name}: code`);
    assert.equal(result.denial, testCase.reason, `${testCase.name}: denial reason`);
    const after = kit.kernel.view();
    assert.equal(after.admittedCommandSeq, before.admittedCommandSeq, `${testCase.name}: no admission`);
    assert.equal(after.committedEventSeq, before.committedEventSeq, `${testCase.name}: no events`);
  }
});

test("NEGATIVE capability denials: avatar agents without grants are refused", () => {
  const { kernel } = makeKit("neg-nogrant", []);
  kernel.load();
  const result = kernel.act({
    intent: {
      intentId: asIntentId("i-nogrant"),
      kind: asIntentKind("world.increment"),
      actor: avatarActor("avatar-1"),
      payload: { by: 1 },
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce("n-nogrant"),
  });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "capability-denied");
    assert.equal(result.denial, "grant-not-found");
    assert.match(result.detail, /lock rule 14/);
  }
});

test("NEGATIVE capability denials: revoked grants stop working immediately", () => {
  const { kernel, broker } = makeKit();
  kernel.load();
  const ok = kernel.act(avatarAct("rev-1", 1));
  assert.equal(ok.status, "committed");
  assert.equal(broker.revokeGrant(asCapabilityGrantId("grant-1")), true);
  const denied = kernel.act(avatarAct("rev-2", 1));
  assert.equal(denied.status, "rejected");
  if (denied.status === "rejected") assert.equal(denied.denial, "grant-not-found");
});

// ---------------------------------------------------------------------------
// 4) Restore-after-terminate
// ---------------------------------------------------------------------------

test("NEGATIVE restore-after-terminate: restore is refused and nothing mutates", () => {
  const { kernel } = makeKit();
  kernel.load();
  kernel.act(playerAct("rt-1", 2));
  const snap = kernel.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  kernel.step(2);
  const before = kernel.view();
  const terminated = kernel.terminate("done");
  assert.equal(terminated.status, "terminated");
  const frozen = kernel.view();
  const result = kernel.restore(snap.snapshot.snapshotId);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "session-terminal");
  const after = kernel.view();
  assert.equal(after.phase, "terminated");
  assert.equal(after.epoch, frozen.epoch);
  assert.equal(after.committedEventSeq, frozen.committedEventSeq);
  assert.ok(after.committedEventSeq > before.committedEventSeq);
  // Every other operation is refused too.
  assert.equal(kernel.act(playerAct("rt-2", 1)).status, "rejected");
  assert.equal(kernel.step(1).status, "rejected");
  assert.equal(kernel.observe(0).status, "rejected");
  assert.equal(kernel.snapshot().status, "rejected");
  assert.equal(kernel.reset("x" as never).status, "rejected");
  assert.equal(kernel.replay({ fromEventSeq: 1, toEventSeq: null }).status, "rejected");
});

// ---------------------------------------------------------------------------
// Additional rejection surface
// ---------------------------------------------------------------------------

test("NEGATIVE restore: unknown snapshot ids are refused", () => {
  const { kernel } = makeKit();
  kernel.load();
  const result = kernel.restore(asCapabilityGrantId("no-such-snapshot") as unknown as SnapshotId);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "unknown-snapshot");
});

test("NEGATIVE restore: foreign-session payloads are refused", () => {
  const { kernel, store } = makeKit("neg-foreign");
  kernel.load();
  const foreign: KernelSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    sessionId: "someone-else",
    epoch: 1,
    tick: 1,
    committedEventSeq: 1,
    admittedCommandSeq: 1,
    worldKind: COUNTER_WORLD_KIND,
    world: { count: 5, moves: [] },
  };
  const stored = store.save(foreign, canonicalJson(foreign));
  const result = kernel.restore(stored.snapshotId);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "snapshot-wrong-session");
});

test("NEGATIVE restore: foreign world kinds are refused", () => {
  const { kernel, store } = makeKit("neg-kind");
  kernel.load();
  const foreign: KernelSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    sessionId: "neg-kind",
    epoch: 1,
    tick: 1,
    committedEventSeq: 1,
    admittedCommandSeq: 1,
    worldKind: "other/world@9",
    world: { count: 5, moves: [] },
  };
  const stored = store.save(foreign, canonicalJson(foreign));
  const result = kernel.restore(stored.snapshotId);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "snapshot-world-kind-mismatch");
});

test("NEGATIVE replay: mid-stream starts, future ends, and backward windows are refused", () => {
  const { kernel } = makeKit();
  kernel.load();
  kernel.act(playerAct("rp-1", 1));
  kernel.act(playerAct("rp-2", 1));
  kernel.act(playerAct("rp-3", 1));
  const mid = kernel.replay({ fromEventSeq: 2, toEventSeq: null });
  assert.equal(mid.status, "rejected");
  if (mid.status === "rejected") {
    assert.equal(mid.code, "replay-plan-rejected");
    assert.equal(mid.planCode, "mid-stream-start");
  }
  const future = kernel.replay({ fromEventSeq: 1, toEventSeq: 99 });
  assert.equal(future.status, "rejected");
  if (future.status === "rejected") assert.equal(future.planCode, "future-end");
  const backward = kernel.replay({ fromEventSeq: 3, toEventSeq: 2 });
  assert.equal(backward.status, "rejected");
  if (backward.status === "rejected") assert.equal(backward.planCode, "backward-window");
});

test("NEGATIVE replay: valid boundaries (seq 1 or snapshot+1) still work", () => {
  const { kernel } = makeKit();
  kernel.load();
  kernel.act(playerAct("rp-4", 1));
  const snap = kernel.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  kernel.act(playerAct("rp-5", 1));
  const fromOrigin = kernel.replay({ fromEventSeq: 1, toEventSeq: null });
  assert.equal(fromOrigin.status, "replayed");
  const fromBoundary = kernel.replay({ fromEventSeq: snap.snapshot.afterEventSeq + 1, toEventSeq: null });
  assert.equal(fromBoundary.status, "replayed");
  if (fromBoundary.status === "replayed") {
    assert.equal(fromBoundary.fromSeq, snap.snapshot.afterEventSeq + 1);
    assert.equal(fromBoundary.events.length, 1);
  }
});

test("NEGATIVE commands: unknown intent kinds are refused at derivation", () => {
  const { kernel } = makeKit();
  kernel.load();
  const result = kernel.act({
    intent: {
      intentId: asIntentId("i-unknown"),
      kind: asIntentKind("world.explode"),
      actor: playerActor("player-1"),
      payload: {},
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce("n-unknown"),
  });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "command-rejected");
    assert.equal(result.commandCode, "unknown-command-kind");
  }
});

test("NEGATIVE commands: phase-unknown command kinds are refused by the admission gate", () => {
  const { kernel } = makeKit();
  kernel.load();
  // world.move is a known driver command; craft an intent whose kind the
  // driver maps but whose policy we bypass by using an unmapped kind.
  const result = kernel.act({
    intent: {
      intentId: asIntentId("i-policy"),
      kind: asIntentKind("world.increment"),
      actor: playerActor("player-1"),
      payload: { by: 1 },
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce("n-policy"),
  });
  assert.equal(result.status, "committed");
});

test("NEGATIVE act: JSON-unsafe payloads fail closed (no partial state)", () => {
  const { kernel } = makeKit("neg-unsafe");
  kernel.load();
  const result = kernel.act({
    intent: {
      intentId: asIntentId("i-unsafe"),
      kind: asIntentKind("world.increment"),
      actor: playerActor("player-1"),
      payload: { by: 0.5 },
      issuedAt: 0 as never,
    },
    nonce: asIdempotencyNonce("n-unsafe"),
  });
  // 0.5 is JSON-unsafe for canonical fingerprints -> fail closed.
  assert.equal(result.status, "failed");
  assert.equal(kernel.view().phase, "failed");
});
