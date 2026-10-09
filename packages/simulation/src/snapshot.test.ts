/**
 * Snapshot/restore tests: byte-stable content-addressed snapshots,
 * restore-then-continue == never-interrupted (both directions), epoch
 * advancement, and negative misuse (unknown snapshot, malformed artifact,
 * cross-session restore).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSnapshotId, asTimestamp } from "@playliquid/runtime-contracts";
import { SimulationSession } from "./session.ts";
import { FixedClock, InMemorySnapshotStore } from "./fakes.ts";
import { DEMO_ACTOR_ID, demoEntityRefs, demoGameBinding, demoSeed, movePayload } from "./demo.ts";
import { verifySnapshotArtifact } from "./snapshot.ts";
import { createHash } from "node:crypto";
import { canonicalValueForm } from "@playliquid/game-ir";

function makeSession(id: string, store: InMemorySnapshotStore): SimulationSession {
  return new SimulationSession({
    sessionId: id as never,
    binding: demoGameBinding(id),
    ports: { clock: new FixedClock([10, 11, 12, 13, 14, 15, 16]), snapshotStore: store },
  });
}

function submittedEnvelope(sessionId: string, nonce: string, delta: readonly [number, number, number], epoch = 1) {
  return {
    commandId: `cmd-${nonce}` as never,
    sessionId: sessionId as never,
    kind: "world.move" as never,
    epoch: epoch as never,
    actor: { actorClass: "avatar-agent" as const, actorId: DEMO_ACTOR_ID },
    origin: { kind: "broker-mediated" as const, grantId: "grant-demo-locomotion" as never },
    idempotencyKey: { scope: "command" as const, actor: DEMO_ACTOR_ID, nonce: nonce as never },
    issuedAt: asTimestamp(1),
    payload: movePayload(demoEntityRefs()[0]!, delta),
  };
}

function streamFingerprint(session: SimulationSession, afterSeq: number): string {
  return createHash("sha256")
    .update(
      session
        .readEvents(afterSeq)
        .map((event) =>
          JSON.stringify({
            eventId: event.eventId,
            kind: event.kind,
            seq: event.seq,
            tick: event.tick,
            cause: event.cause,
            payload: canonicalValueForm(event.payload),
          }),
        )
        .join("|"),
    )
    .digest("hex");
}

test("snapshot: identical continuation state seals byte-identical snapshots", () => {
  const storeA = new InMemorySnapshotStore();
  const storeB = new InMemorySnapshotStore();
  const a = makeSession("s-snap-a", storeA);
  const b = makeSession("s-snap-b", storeB);
  // NOTE: snapshots are session-scoped; to compare bytes we use the SAME
  // session id so only the run state (not identity) differs... no — byte
  // stability must hold for the same session state; two different sessions
  // with the same state have different payload.sessionId. We therefore
  // verify byte stability WITHIN one session across two snapshots taken at
  // the same boundary, and cross-session equality of the WORLD form.
  a.begin(demoSeed());
  a.step({ op: "step", sessionId: a.sessionId, ticks: 4 });
  const first = a.snapshot();
  const second = a.snapshot();
  assert.equal(first.status, "snapshotted");
  assert.equal(second.status, "snapshotted");
  if (first.status === "snapshotted" && second.status === "snapshotted") {
    assert.equal(first.snapshot.form, second.snapshot.form);
    assert.equal(first.snapshot.snapshotId, second.snapshot.snapshotId);
    assert.equal(first.snapshot.stateDigest, second.snapshot.stateDigest);
    assert.equal(storeA.size, 1);
  }
  b.begin(demoSeed());
  b.step({ op: "step", sessionId: b.sessionId, ticks: 4 });
  const other = b.snapshot();
  if (first.status === "snapshotted" && other.status === "snapshotted") {
    // Same seed and same ticks: the WORLD digests match; full payload forms
    // differ only by session identity.
    assert.equal(first.snapshot.stateDigest, other.snapshot.stateDigest);
    assert.notEqual(first.snapshot.form, other.snapshot.form);
  }
});

test("snapshot: artifacts verify end-to-end (form, id, digest)", () => {
  const session = makeSession("s-snap-b2", new InMemorySnapshotStore());
  session.begin(demoSeed());
  session.step({ op: "step", sessionId: session.sessionId, ticks: 2 });
  const snap = session.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  assert.deepEqual(verifySnapshotArtifact(snap.snapshot), { ok: true, snapshotId: snap.snapshot.snapshotId });
  // Tampering with any observable field breaks verification.
  const tamperedState = { ...snap.snapshot, stateDigest: "0".repeat(64) as never };
  const verdict = verifySnapshotArtifact(tamperedState);
  assert.equal(verdict.ok, false);
});

test("snapshot: restore-then-continue equals never-interrupted (both directions)", () => {
  // Direction 1: interrupt at the boundary, restore, continue.
  const store = new InMemorySnapshotStore();
  const interrupted = makeSession("s-snap-c", store);
  interrupted.begin(demoSeed());
  interrupted.submitRecordedCommand(submittedEnvelope("s-snap-c", "pre", [1, 1, 0]), 3);
  interrupted.step({ op: "step", sessionId: interrupted.sessionId, ticks: 4 });
  const boundary = interrupted.snapshot();
  if (boundary.status !== "snapshotted") throw new Error("snapshot failed");
  const boundarySeq = boundary.snapshot.afterEventSeq;
  // Continue PAST the boundary first (these events will be rewound).
  interrupted.submitRecordedCommand(submittedEnvelope("s-snap-c", "post", [0, 2, 0]), 6);
  interrupted.step({ op: "step", sessionId: interrupted.sessionId, ticks: 3 });
  // Now restore to the boundary and re-run the SAME continuation. The
  // continuation commands are submitted under each run's CURRENT epoch
  // (the restored session is at epoch 2 — the stale-result rule demands
  // fresh commands after an epoch advance; epoch never enters event
  // content, so the emitted streams still compare byte-for-byte).
  const restored = interrupted.restore({
    op: "restore",
    sessionId: interrupted.sessionId,
    snapshotId: boundary.snapshot.snapshotId,
  });
  assert.equal(restored.status, "restored");
  if (restored.status === "restored") assert.equal(restored.epoch, 2);
  interrupted.submitRecordedCommand(submittedEnvelope("s-snap-c", "post", [0, 2, 0], 2), 6);
  interrupted.step({ op: "step", sessionId: interrupted.sessionId, ticks: 3 });

  // Direction 2: never-interrupted run of the identical script.
  const clean = makeSession("s-snap-d", new InMemorySnapshotStore());
  clean.begin(demoSeed());
  clean.submitRecordedCommand(submittedEnvelope("s-snap-d", "pre", [1, 1, 0]), 3);
  clean.step({ op: "step", sessionId: clean.sessionId, ticks: 4 });
  clean.submitRecordedCommand(submittedEnvelope("s-snap-d", "post", [0, 2, 0]), 6);
  clean.step({ op: "step", sessionId: clean.sessionId, ticks: 3 });

  // Equality: world digest, event count, and every post-boundary event byte.
  assert.equal(interrupted.currentWorldDigest, clean.currentWorldDigest);
  assert.equal(interrupted.eventLog.length, clean.eventLog.length);
  assert.equal(streamFingerprint(interrupted, boundarySeq), streamFingerprint(clean, boundarySeq));
  assert.equal(interrupted.view().committedEventSeq, clean.view().committedEventSeq);
  // The whole streams are identical too (the rewind reproduced the same
  // events the uninterrupted run produced).
  assert.equal(streamFingerprint(interrupted, 0), streamFingerprint(clean, 0));
});

test("snapshot: pending commands survive snapshot+restore (no double execution)", () => {
  const store = new InMemorySnapshotStore();
  const session = makeSession("s-snap-e", store);
  session.begin(demoSeed());
  session.submitRecordedCommand(submittedEnvelope("s-snap-e", "p1", [1, 0, 0]), 3);
  const snap = session.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  // Execute the pending command...
  session.step({ op: "step", sessionId: session.sessionId, ticks: 4 });
  const digestAfterExecution = session.currentWorldDigest;
  // ...restore to the boundary where p1 was still pending...
  const restored = session.restore({ op: "restore", sessionId: session.sessionId, snapshotId: snap.snapshot.snapshotId });
  assert.equal(restored.status, "restored");
  // ...and re-run: p1 executes EXACTLY ONCE per run, same final state.
  session.step({ op: "step", sessionId: session.sessionId, ticks: 4 });
  assert.equal(session.currentWorldDigest, digestAfterExecution);
});

test("snapshot: restore of an unknown snapshot is a typed rejection", () => {
  const session = makeSession("s-snap-f", new InMemorySnapshotStore());
  session.begin(demoSeed());
  const result = session.restore({ op: "restore", sessionId: session.sessionId, snapshotId: asSnapshotId("snap-ghost") });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "unknown-snapshot");
});

test("snapshot: restore refuses snapshots of another session", () => {
  const store = new InMemorySnapshotStore();
  const owner = makeSession("s-snap-g", store);
  owner.begin(demoSeed());
  owner.step({ op: "step", sessionId: owner.sessionId, ticks: 1 });
  const snap = owner.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  const intruder = makeSession("s-snap-h", store);
  intruder.begin(demoSeed());
  const result = intruder.restore({ op: "restore", sessionId: intruder.sessionId, snapshotId: snap.snapshot.snapshotId });
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.code, "snapshot-wrong-session");
});

test("snapshot: a malformed payload artifact fails verification (fail closed)", () => {
  const session = makeSession("s-snap-i", new InMemorySnapshotStore());
  session.begin(demoSeed());
  session.step({ op: "step", sessionId: session.sessionId, ticks: 1 });
  const snap = session.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  const broken = { ...snap.snapshot, payload: { garbage: true } };
  // A FRESH session (provisioning) is the beginFromSnapshot caller.
  const fresh = makeSession("s-snap-i2", new InMemorySnapshotStore());
  const begun = fresh.beginFromSnapshot(broken);
  assert.equal(begun.status, "rejected");
  // Artifact verification runs first and reports malformed-artifact.
  if (begun.status === "rejected") assert.equal(begun.code, "malformed-artifact");
});

test("snapshot: beginFromSnapshot continues a fresh session identically", () => {
  const store = new InMemorySnapshotStore();
  const original = makeSession("s-snap-j", store);
  original.begin(demoSeed());
  original.submitRecordedCommand(submittedEnvelope("s-snap-j", "q1", [2, 0, 0]), 3);
  original.step({ op: "step", sessionId: original.sessionId, ticks: 4 });
  const snap = original.snapshot();
  if (snap.status !== "snapshotted") throw new Error("snapshot failed");
  const boundarySeq = snap.snapshot.afterEventSeq;
  original.submitRecordedCommand(submittedEnvelope("s-snap-j", "q2", [0, 3, 0]), 6);
  original.step({ op: "step", sessionId: original.sessionId, ticks: 3 });

  // A FRESH session initialized at the snapshot boundary, fed the same
  // remaining commands, reproduces the post-boundary events byte-for-byte.
  const fresh = makeSession("s-snap-k", new InMemorySnapshotStore());
  const begun = fresh.beginFromSnapshot(snap.snapshot, demoSeed());
  assert.equal(begun.status, "begun");
  if (begun.status === "begun") assert.equal(begun.afterEventSeq, boundarySeq);
  fresh.submitRecordedCommand(submittedEnvelope("s-snap-k", "q2", [0, 3, 0]), 6);
  fresh.step({ op: "step", sessionId: fresh.sessionId, ticks: 3 });
  assert.equal(fresh.currentWorldDigest, original.currentWorldDigest);
  assert.equal(streamFingerprint(fresh, boundarySeq), streamFingerprint(original, boundarySeq));
});
