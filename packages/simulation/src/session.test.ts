/**
 * Session lifecycle and admission tests: the nine Experience Protocol
 * operations under simulation-role admission (lock 12), the canonical
 * command path (E2), capability-mediated acting (lock 4/13/14), idempotency
 * (E8) and negative misuse cases.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asEventSequence,
  asIntentId,
  asIntentKind,
  asSessionId,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import { SimulationSession } from "./session.ts";
import { FixedClock, InMemorySnapshotStore } from "./fakes.ts";
import {
  DEMO_ACTOR_ID,
  DEMO_COMMAND_KIND,
  demoEntityRefs,
  demoGameBinding,
  demoSeed,
  movePayload,
} from "./demo.ts";

function makeSession(id: string): SimulationSession {
  const sessionId = asSessionId(id);
  return new SimulationSession({
    sessionId,
    binding: demoGameBinding(id),
    ports: { clock: new FixedClock([1000, 1001, 1002, 1003]), snapshotStore: new InMemorySnapshotStore() },
  });
}

function actIntent(nonce: string, delta: readonly [number, number, number]) {
  return {
    intentId: asIntentId(nonce),
    kind: asIntentKind("world.move"),
    actor: { actorClass: "avatar-agent" as const, actorId: DEMO_ACTOR_ID },
    payload: movePayload(demoEntityRefs()[0]!, delta),
    issuedAt: asTimestamp(2000),
  };
}

test("session: load without a determinism seed is rejected (E9 admission)", () => {
  const session = makeSession("s-admission-1");
  const binding = demoGameBinding("s-admission-1");
  const result = session.load({
    op: "load",
    sessionId: session.sessionId,
    game: binding.game,
    role: "simulation",
  });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "determinism-required-for-simulation");
  }
});

test("session: load with a mismatched game composition is rejected", () => {
  const session = makeSession("s-admission-2");
  const binding = demoGameBinding("s-admission-2");
  const alienGame = { ...binding.game, gameDigest: "f".repeat(64) as never };
  const result = session.load({
    op: "load",
    sessionId: session.sessionId,
    game: alienGame,
    role: "simulation",
    determinism: demoSeed(),
  });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "game-mismatch");
});

test("session: seeded load moves provisioning -> ready", () => {
  const session = makeSession("s-admission-3");
  const binding = demoGameBinding("s-admission-3");
  const result = session.load({
    op: "load",
    sessionId: session.sessionId,
    game: binding.game,
    role: "simulation",
    determinism: demoSeed(),
  });
  assert.equal(result.status, "loaded");
  assert.equal(session.view().phase, "ready");
  assert.equal(session.view().epoch, 1);
  assert.equal(session.view().tick, 0);
});

test("session: act is admitted only while running (simulation role rule)", () => {
  const session = makeSession("s-admission-4");
  session.begin(demoSeed());
  // ready (not running) -> act rejected with the documented code.
  const early = session.act({ op: "act", sessionId: session.sessionId, intent: actIntent("i-1", [1, 0, 0]) });
  assert.equal(early.status, "rejected");
  if (early.status === "rejected") {
    assert.equal(early.code, "act-requires-running-in-simulation");
  }
  session.step({ op: "step", sessionId: session.sessionId, ticks: 1 });
  const admitted = session.act({ op: "act", sessionId: session.sessionId, intent: actIntent("i-2", [1, 0, 0]) });
  assert.equal(admitted.status, "submitted");
  if (admitted.status === "submitted") assert.equal(admitted.dueTick, 2);
});

test("session: act without a covering grant is denied at the capability boundary", () => {
  const sessionId = "s-admission-5";
  const binding = { ...demoGameBinding(sessionId), grants: [] };
  const session = new SimulationSession({
    sessionId: asSessionId(sessionId),
    binding,
    ports: { clock: new FixedClock([1]), snapshotStore: new InMemorySnapshotStore() },
  });
  session.begin(demoSeed());
  session.step({ op: "step", sessionId: session.sessionId, ticks: 1 });
  const denied = session.act({ op: "act", sessionId: session.sessionId, intent: actIntent("i-3", [1, 0, 0]) });
  assert.equal(denied.status, "rejected");
  if (denied.status === "rejected") assert.equal(denied.code, "grant-not-found");
});

test("session: stale-epoch grants are refused after a reset (stale-result rule)", () => {
  const sessionId = "s-admission-6";
  const session = new SimulationSession({
    sessionId: asSessionId(sessionId),
    binding: demoGameBinding(sessionId),
    ports: { clock: new FixedClock([1, 2]), snapshotStore: new InMemorySnapshotStore() },
  });
  session.begin(demoSeed());
  session.step({ op: "step", sessionId: session.sessionId, ticks: 1 });
  session.reset({ op: "reset", sessionId: session.sessionId, seed: demoSeed(2) });
  assert.equal(session.view().epoch, 2);
  const denied = session.act({ op: "act", sessionId: session.sessionId, intent: actIntent("i-4", [1, 0, 0]) });
  assert.equal(denied.status, "rejected");
  if (denied.status === "rejected") assert.equal(denied.code, "grant-epoch-stale");
});

test("session: duplicate intents are idempotent; fingerprint collisions are refused (E8)", () => {
  const session = makeSession("s-admission-7");
  session.begin(demoSeed());
  session.step({ op: "step", sessionId: session.sessionId, ticks: 1 });
  const first = session.act({ op: "act", sessionId: session.sessionId, intent: actIntent("i-5", [1, 0, 0]) });
  assert.equal(first.status, "submitted");
  // Same intent id (same key) + same payload -> duplicate.
  const duplicate = session.act({ op: "act", sessionId: session.sessionId, intent: actIntent("i-5", [1, 0, 0]) });
  assert.equal(duplicate.status, "rejected");
  if (duplicate.status === "rejected") assert.equal(duplicate.code, "duplicate-intent");
  // Same intent id + DIFFERENT payload -> collision (never re-executed).
  const collision = session.act({ op: "act", sessionId: session.sessionId, intent: actIntent("i-5", [9, 9, 9]) });
  assert.equal(collision.status, "rejected");
  if (collision.status === "rejected") assert.equal(collision.code, "idempotency-collision");
});

test("session: unknown command kinds never enter the canonical path (E2)", () => {
  const session = makeSession("s-admission-8");
  session.begin(demoSeed());
  const result = session.submitRecordedCommand(
    {
      commandId: "cmd-x" as never,
      sessionId: session.sessionId,
      kind: "world.explode" as never,
      epoch: 1 as never,
      actor: { actorClass: "avatar-agent" as const, actorId: DEMO_ACTOR_ID },
      origin: { kind: "broker-mediated" as const, grantId: "grant-demo-locomotion" as never },
      idempotencyKey: { scope: "command", actor: DEMO_ACTOR_ID, nonce: "n-x" as never },
      issuedAt: asTimestamp(1),
      payload: movePayload(demoEntityRefs()[0]!, [1, 0, 0]),
    },
    1,
  );
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "unknown-command-kind");
});

test("session: avatar-agent commands require broker mediation (lock 14)", () => {
  const session = makeSession("s-admission-9");
  session.begin(demoSeed());
  const result = session.submitRecordedCommand(
    {
      commandId: "cmd-y" as never,
      sessionId: session.sessionId,
      kind: DEMO_COMMAND_KIND as never,
      epoch: 1 as never,
      actor: { actorClass: "avatar-agent" as const, actorId: DEMO_ACTOR_ID },
      origin: { kind: "player-input" as const },
      idempotencyKey: { scope: "command", actor: DEMO_ACTOR_ID, nonce: "n-y" as never },
      issuedAt: asTimestamp(1),
      payload: movePayload(demoEntityRefs()[0]!, [1, 0, 0]),
    },
    1,
  );
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "avatar-agent-requires-broker-mediation");
  }
});

test("session: duplicate command ids are refused; due ticks must be in the future", () => {
  const session = makeSession("s-admission-10");
  session.begin(demoSeed());
  const envelope = {
    commandId: "cmd-d" as never,
    sessionId: session.sessionId,
    kind: DEMO_COMMAND_KIND as never,
    epoch: 1 as never,
    actor: { actorClass: "avatar-agent" as const, actorId: DEMO_ACTOR_ID },
    origin: { kind: "broker-mediated" as const, grantId: "grant-demo-locomotion" as never },
    idempotencyKey: { scope: "command" as const, actor: DEMO_ACTOR_ID, nonce: "n-d" as never },
    issuedAt: asTimestamp(1),
    payload: movePayload(demoEntityRefs()[0]!, [1, 0, 0]),
  };
  const first = session.submitRecordedCommand(envelope, 1);
  assert.equal(first.status, "submitted");
  const duplicate = session.submitRecordedCommand(envelope, 2);
  assert.equal(duplicate.status, "rejected");
  if (duplicate.status === "rejected") assert.equal(duplicate.code, "duplicate-command-id");
  // Due tick at/below the current tick (0) is refused.
  const past = session.submitRecordedCommand({ ...envelope, commandId: "cmd-e" as never }, 0);
  assert.equal(past.status, "rejected");
  if (past.status === "rejected") assert.equal(past.code, "due-tick-in-past");
});

test("session: stepping before load is rejected — an unseeded session can never become steppable (E9)", () => {
  const session = makeSession("s-admission-11");
  // A session that never loaded sits in `provisioning`; the admission gate
  // rejects `step` with wrong-phase. The seed guard inside step is
  // defense-in-depth: the ONLY public path to ready/running is
  // load/begin, both of which REQUIRE a determinism seed (E9), so an
  // unseeded steppable session is unrepresentable.
  const result = session.step({ op: "step", sessionId: session.sessionId, ticks: 1 });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "wrong-phase");
  }
  // And the loading path itself refuses to run without a seed:
  const binding = demoGameBinding("s-admission-11");
  const unseeded = session.load({
    op: "load",
    sessionId: session.sessionId,
    game: binding.game,
    role: "simulation",
  });
  assert.equal(unseeded.status, "rejected");
  if (unseeded.status === "rejected") {
    assert.equal(unseeded.code, "determinism-required-for-simulation");
  }
});

test("session: terminate is final; restore/step/act after it are rejected", () => {
  const session = makeSession("s-admission-12");
  session.begin(demoSeed());
  session.step({ op: "step", sessionId: session.sessionId, ticks: 2 });
  const snap = session.snapshot();
  assert.equal(snap.status, "snapshotted");
  const terminated = session.terminate({ op: "terminate", sessionId: session.sessionId, reason: "done" });
  assert.equal(terminated.status, "terminated");
  assert.equal(session.view().phase, "terminated");
  // A lifecycle audit event was emitted as the final event.
  assert.equal(session.eventLog[session.eventLog.length - 1]?.kind, "session.terminated");
  if (snap.status === "snapshotted") {
    const restored = session.restore({
      op: "restore",
      sessionId: session.sessionId,
      snapshotId: snap.snapshot.snapshotId,
    });
    assert.equal(restored.status, "rejected");
    if (restored.status === "rejected") assert.equal(restored.code, "wrong-phase");
  }
  const stepped = session.step({ op: "step", sessionId: session.sessionId, ticks: 1 });
  assert.equal(stepped.status, "rejected");
  const acted = session.act({ op: "act", sessionId: session.sessionId, intent: actIntent("i-6", [1, 0, 0]) });
  assert.equal(acted.status, "rejected");
});

test("session: observe returns events strictly after the cursor", () => {
  const session = makeSession("s-admission-13");
  session.begin(demoSeed());
  session.step({ op: "step", sessionId: session.sessionId, ticks: 2 });
  const all = session.observe({ op: "observe", sessionId: session.sessionId, afterEventSeq: asEventSequence(0) });
  assert.ok(all.events.length >= 6);
  const window = session.observe({ op: "observe", sessionId: session.sessionId, afterEventSeq: asEventSequence(3) });
  assert.equal(window.events.length, all.events.length - 3);
  assert.equal(window.nextCursor, all.nextCursor);
  assert.ok(window.events.every((event) => Number(event.seq) > 3));
});

test("session: the event log satisfies the runtime-contracts order oracle", () => {
  const session = makeSession("s-admission-14");
  session.begin(demoSeed());
  session.step({ op: "step", sessionId: session.sessionId, ticks: 1 });
  session.step({ op: "step", sessionId: session.sessionId, ticks: 2 });
  const validation = session.checkEventStream();
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(validation.span.firstSeq, 1);
    assert.equal(validation.span.lastSeq, session.eventLog.length);
    assert.equal(validation.span.count, session.eventLog.length);
  }
});

test("session: replay windows obey the boundary rule (lock 15)", () => {
  const session = makeSession("s-admission-15");
  session.begin(demoSeed());
  session.step({ op: "step", sessionId: session.sessionId, ticks: 3 });
  const head = session.view().committedEventSeq;
  // From seq 1 is legal.
  const origin = session.replay({ op: "replay", sessionId: session.sessionId, fromEventSeq: asEventSequence(1), toEventSeq: null });
  assert.equal(origin.status, "replayed");
  if (origin.status === "replayed") assert.equal(origin.events.length, head);
  // Mid-stream starts are refused.
  const mid = session.replay({ op: "replay", sessionId: session.sessionId, fromEventSeq: asEventSequence(2), toEventSeq: null });
  assert.equal(mid.status, "rejected");
  if (mid.status === "rejected") assert.equal(mid.code, "mid-stream-start");
  // After a snapshot boundary is legal.
  const snap = session.snapshot();
  if (snap.status === "snapshotted") {
    const boundary = session.replay({
      op: "replay",
      sessionId: session.sessionId,
      fromEventSeq: asEventSequence(snap.snapshot.afterEventSeq + 1),
      toEventSeq: null,
    });
    assert.equal(boundary.status, "replayed");
    if (boundary.status === "replayed") assert.equal(boundary.events.length, 0);
  }
});
