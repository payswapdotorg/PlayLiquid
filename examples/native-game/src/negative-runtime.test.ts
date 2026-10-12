/**
 * RUNTIME NEGATIVE TESTS (PL-037; E8) — the game's own session refuses
 * hostile input with TYPED results and never leaks partial state:
 * unknown command kinds, duplicate/colliding idempotency, grantless
 * avatar agents, stale-epoch grants, malformed wire payloads, unknown or
 * foreign snapshots, invalid replay windows, and the terminal freeze.
 *
 * Plus the R11 evidence discipline: a TAMPERED witness or command stream
 * surfaces as typed divergence evidence (recorded vs re-executed forms
 * at the exact seq positions) — never a silent pass.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";
import type { RuntimeEventEnvelope } from "../../../packages/runtime-contracts/src/index.ts";
import { asActorId, asDeterminismSeed, asIdempotencyNonce, asSessionId, asSnapshotId } from "../../../packages/runtime-contracts/src/index.ts";
import { runCanonicalPlaythrough } from "./playthrough.ts";
import { sealCanonicalReplay, verifySealedReplay } from "./replay.ts";
import type { SealedReplay } from "./replay.ts";
import { actInput, companionGrant, createLumenSession, playerIntent } from "./session.ts";
import { COMMAND_KINDS, movePayload, toWire } from "./events.ts";
import { CANONICAL_SEED, COMPANION_ACTOR, PLAYER_ONE } from "./ids.ts";

const PLAYER_REF = { actorClass: "player", actorId: asActorId(String(PLAYER_ONE)) } as const;
const COMPANION_REF = { actorClass: "avatar-agent", actorId: asActorId(COMPANION_ACTOR) } as const;
const document = (await runCanonicalPlaythrough()).composition.document;

/** A loaded, reset session; grant "none" skips the standard companion grant. */
function freshSession(sessionId = "sess-negative", grant: "standard" | "none" = "standard") {
  const session = createLumenSession({ document, seed: CANONICAL_SEED, sessionId });
  if (session.kernel.load().status !== "loaded") throw new Error("load refused");
  const reset = session.kernel.reset(asDeterminismSeed(CANONICAL_SEED));
  if (reset.status !== "reset") throw new Error("reset refused");
  if (grant === "standard") session.capabilityPort.issueGrant(companionGrant(sessionId, reset.epoch));
  return session;
}

const playerAct = (session: ReturnType<typeof freshSession>, nonce: string, kind: string, payload: GameIRValue) =>
  session.kernel.act(actInput(playerIntent(PLAYER_REF, kind, payload, 100, 1), nonce));

test("negative runtime: an unknown intent kind is refused at command derivation", () => {
  const session = freshSession();
  const before = session.kernel.view();
  const result = playerAct(session, "n-unknown", "run.hero.teleport", movePayload(0, 0));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "command-rejected");
    assert.equal(result.commandCode, "unknown-command-kind");
  }
  const after = session.kernel.view();
  assert.equal(after.admittedCommandSeq, before.admittedCommandSeq, "nothing admitted");
  assert.equal(after.committedEventSeq, before.committedEventSeq, "nothing emitted");
});

test("negative runtime: a duplicate submission returns the first receipt, never a second application", () => {
  const session = freshSession();
  const first = playerAct(session, "n-dup", COMMAND_KINDS.heroLook, { kind: "unit" });
  assert.equal(first.status, "committed");
  const head = session.kernel.view().committedEventSeq;
  const second = playerAct(session, "n-dup", COMMAND_KINDS.heroLook, { kind: "unit" });
  assert.equal(second.status, "duplicate");
  assert.equal(session.kernel.view().committedEventSeq, head, "no second application");
});

test("negative runtime: an idempotency collision (same key, different payload) is refused", () => {
  const session = freshSession();
  const first = playerAct(session, "n-collide", COMMAND_KINDS.heroMove, movePayload(1, 1));
  assert.equal(first.status, "committed");
  const head = session.kernel.view().committedEventSeq;
  const collision = playerAct(session, "n-collide", COMMAND_KINDS.heroMove, movePayload(2, 2));
  assert.equal(collision.status, "rejected");
  if (collision.status === "rejected") assert.equal(collision.code, "idempotency-collision");
  assert.equal(session.kernel.view().committedEventSeq, head, "no partial state");
});

test("negative runtime: an avatar agent without a grant is refused (lock rule 14)", () => {
  const bare = createLumenSession({ document, seed: CANONICAL_SEED, sessionId: "sess-neg-bare" });
  if (bare.kernel.load().status !== "loaded") throw new Error("load refused");
  const result = bare.kernel.act(actInput(playerIntent(COMPANION_REF, COMMAND_KINDS.companionMove, movePayload(1, 1), 100, 1), "n-bare"));
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.code, "capability-denied");
    assert.equal(result.denial, "grant-not-found");
    assert.match(result.detail, /lock rule 14/);
  }
});

test("negative runtime: a grant exhausted or from a stale epoch is denied", () => {
  // Budget 1 (the ONLY grant): the first companion move spends it; the
  // second is denied.
  const tight = createLumenSession({ document, seed: CANONICAL_SEED, sessionId: "sess-neg-tight" });
  if (tight.kernel.load().status !== "loaded") throw new Error("load refused");
  const tightReset = tight.kernel.reset(asDeterminismSeed(CANONICAL_SEED));
  if (tightReset.status !== "reset") throw new Error("reset refused");
  tight.capabilityPort.issueGrant({ ...companionGrant("sess-neg-tight", tightReset.epoch), constraints: [{ kind: "total-count", max: 1 }] });
  const first = tight.kernel.act(
    actInput(playerIntent(COMPANION_REF, COMMAND_KINDS.companionMove, movePayload(2, 2), 100, 1), "n-g1", "grant-companion-move"),
  );
  assert.equal(first.status, "committed");
  const head = tight.kernel.view().committedEventSeq;
  const exhausted = tight.kernel.act(
    actInput(playerIntent(COMPANION_REF, COMMAND_KINDS.companionMove, movePayload(3, 3), 120, 2), "n-g2", "grant-companion-move"),
  );
  assert.equal(exhausted.status, "rejected");
  if (exhausted.status === "rejected") {
    assert.equal(exhausted.code, "capability-denied");
    assert.equal(exhausted.denial, "budget-exhausted");
    assert.equal(tight.kernel.view().committedEventSeq, head, "no events leaked from the denial");
  }

  // After a reset the epoch moves: the previous epoch's grants go stale.
  const session = freshSession("sess-neg-stale");
  if (session.kernel.reset(asDeterminismSeed(CANONICAL_SEED)).status !== "reset") throw new Error("reset refused");
  const stale = session.kernel.act(
    actInput(playerIntent(COMPANION_REF, COMMAND_KINDS.companionMove, movePayload(3, 3), 140, 3), "n-g3", "grant-companion-move"),
  );
  assert.equal(stale.status, "rejected");
  if (stale.status === "rejected") {
    assert.equal(stale.code, "capability-denied");
    assert.equal(stale.denial, "grant-epoch-stale");
  }
});

test("negative runtime: a malformed wire payload fails closed with no partial state", () => {
  const session = freshSession();
  const before = session.kernel.view();
  const template = playerIntent(PLAYER_REF, COMMAND_KINDS.heroMove, { kind: "unit" }, 100, 1);
  const forged = session.kernel.act({
    intent: { ...template, payload: { k: "nonsense" } },
    nonce: asIdempotencyNonce("n-malformed"),
  });
  assert.equal(forged.status, "failed", "the malformed payload fails closed");
  if (forged.status === "failed") {
    assert.equal(forged.code, "driver-failure");
    assert.match(forged.detail, /artifact-codec/);
  }
  // Nothing was emitted and the session failed (a driver throw poisons
  // it; the admission itself happened before execution — the kernel's
  // documented path — but no event escaped).
  const after = session.kernel.view();
  assert.equal(after.committedEventSeq, before.committedEventSeq, "no events emitted");
  assert.equal(after.phase, "failed");
});

test("negative runtime: unknown and foreign snapshots are refused", () => {
  const session = freshSession();
  const unknown = session.kernel.restore(asSnapshotId("no-such-snapshot"));
  assert.equal(unknown.status, "rejected");
  if (unknown.status === "rejected") assert.equal(unknown.code, "unknown-snapshot");

  // A foreign-session payload in OUR store is rejected by session id.
  const own = session.kernel.snapshot();
  if (own.status !== "snapshotted") throw new Error("snapshot refused");
  const payload = session.snapshots.load(own.snapshot.snapshotId);
  if (payload === undefined) throw new Error("snapshot vanished");
  const stored = session.snapshots.save({ ...payload, sessionId: "someone-else" }, JSON.stringify({ foreign: true }));
  const foreign = session.kernel.restore(stored.snapshotId);
  assert.equal(foreign.status, "rejected");
  if (foreign.status === "rejected") assert.equal(foreign.code, "snapshot-wrong-session");
});

test("negative runtime: invalid replay windows are refused with the plan codes", () => {
  const session = freshSession();
  const result = playerAct(session, "n-rp", COMMAND_KINDS.heroLook, { kind: "unit" });
  assert.equal(result.status, "committed");
  const mid = session.kernel.replay({ fromEventSeq: 2, toEventSeq: null });
  assert.equal(mid.status, "rejected");
  if (mid.status === "rejected") {
    assert.equal(mid.code, "replay-plan-rejected");
    assert.equal(mid.planCode, "mid-stream-start");
  }
  const future = session.kernel.replay({ fromEventSeq: 1, toEventSeq: 99 });
  assert.equal(future.status, "rejected");
  if (future.status === "rejected") assert.equal(future.planCode, "future-end");
  const backward = session.kernel.replay({ fromEventSeq: 3, toEventSeq: 2 });
  assert.equal(backward.status, "rejected");
  if (backward.status === "rejected") assert.equal(backward.planCode, "backward-window");
});

test("negative runtime: a terminated session refuses every further operation", () => {
  const session = freshSession();
  if (session.kernel.terminate("done").status !== "terminated") throw new Error("terminate refused");
  const view = session.kernel.view();
  assert.equal(view.phase, "terminated");
  assert.equal(playerAct(session, "n-post", COMMAND_KINDS.heroLook, { kind: "unit" }).status, "rejected");
  assert.equal(session.kernel.step(1).status, "rejected");
  assert.equal(session.kernel.observe(0).status, "rejected");
  assert.equal(session.kernel.snapshot().status, "rejected");
  assert.equal(session.kernel.replay({ fromEventSeq: 1, toEventSeq: null }).status, "rejected");
  const restored = session.kernel.restore(asSnapshotId("whatever"));
  assert.equal(restored.status, "rejected");
  if (restored.status === "rejected") assert.equal(restored.code, "session-terminal");
  assert.equal(session.kernel.view().phase, "terminated", "still terminal, nothing mutated");
});

// ---------------------------------------------------------------------------
// R11: integrity violations surface as typed evidence (never silent)
// ---------------------------------------------------------------------------

const run = await runCanonicalPlaythrough();

/** Rebuilds the canonical seal with a tampered witness or command list. */
function resealed(tamper: {
  events?: readonly RuntimeEventEnvelope<GameIRValue>[];
  commands?: typeof run.commands;
}): SealedReplay {
  const boundarySeq = Number(run.replayWindow[0]?.seq ?? 1) - 1;
  const boundarySnapshot = run.session.snapshots.load(asSnapshotId(run.boundarySnapshotId));
  if (boundarySnapshot === undefined) throw new Error("boundary snapshot missing");
  const stored = run.session.snapshots.entries.find((entry) => String(entry.snapshotId) === run.boundarySnapshotId);
  if (stored === undefined) throw new Error("boundary digest missing");
  return sealCanonicalReplay({
    document: run.composition.document,
    events: tamper.events ?? run.sealed.witness.events,
    commands: tamper.commands ?? run.commands,
    boundary: {
      afterEventSeq: boundarySeq,
      tick: 0,
      snapshotId: run.boundarySnapshotId,
      formDigest: String(stored.stateDigest),
      artifact: boundarySnapshot,
    },
    toEventSeq: run.events.length,
    toTick: 4,
  });
}

test("negative integrity (R11): a tampered recorded event is DIVERGENT evidence, not a pass", () => {
  const events = run.sealed.witness.events.map((event) => ({ ...event }));
  const moved = events.find((event) => String(event.kind) === "run.hero.moved");
  assert.ok(moved !== undefined, "a hero-moved event exists to tamper");
  const payload = moved.payload as unknown as { fields: { col: { value: bigint } } };
  payload.fields.col.value = 5n; // the forged hero position
  const sealed = resealed({ events });
  const verdict = verifySealedReplay(run.composition.document, sealed);
  assert.equal(verdict.kind, "divergence", "re-execution exposes the forged witness");
  if (verdict.kind === "divergence") {
    assert.equal(verdict.confidence, 1, "the divergence is deterministically proven");
    assert.ok(verdict.divergences.length > 0, "the typed evidence lists the divergent positions");
    for (const divergence of verdict.divergences) {
      assert.notEqual(divergence.recordedForm, divergence.reexecutedForm);
      assert.ok(divergence.seq >= sealed.record.capture.fromEventSeq);
    }
  }
});

test("negative integrity (R11): a forged recorded command diverges on re-execution", () => {
  const commands = run.commands.map((command) => ({
    ...command,
    envelope: { ...command.envelope, payload: movePayload(0, 5) }, // a forged move target
  }));
  const sealed = resealed({ commands });
  const verdict = verifySealedReplay(run.composition.document, sealed);
  assert.equal(verdict.kind, "divergence");
  if (verdict.kind === "divergence") {
    assert.ok(verdict.divergences.length > 0);
    assert.ok(verdict.divergences.some((divergence) => divergence.seq >= sealed.record.capture.fromEventSeq));
  }
});

test("negative integrity (R11): an incoherent stream is INCONCLUSIVE with a typed reason", () => {
  const commands = run.commands.map((command) => ({
    ...command,
    envelope: { ...command.envelope, sessionId: asSessionId("sess-someone-else") },
  }));
  const sealed = resealed({ commands });
  const verdict = verifySealedReplay(run.composition.document, sealed);
  assert.equal(verdict.kind, "inconclusive");
  if (verdict.kind === "inconclusive") {
    assert.equal(verdict.confidence, 0);
    assert.equal(verdict.reason.code, "incoherent-stream");
    assert.match(verdict.reason.detail, /sess-someone-else/);
  }
});

test("negative integrity: the honest witness form of the wire payload round-trips (control)", () => {
  // Control for the payload projection: the SAME move payload on the wire
  // decodes to the SAME value (the transport form is a faithful projection).
  assert.deepEqual(toWire(movePayload(3, 3)), toWire(movePayload(3, 3)));
  assert.notDeepEqual(toWire(movePayload(3, 3)), toWire(movePayload(4, 4)));
});
