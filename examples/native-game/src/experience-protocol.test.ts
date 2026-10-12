/**
 * EXPERIENCE PROTOCOL TESTS (PL-037) — the full interactive loop, all nine
 * verbs (load, reset, observe, act, step, snapshot, restore, replay,
 * terminate), driven BOTH ways:
 *
 * 1. through the canonical scripted playthrough (`runCanonicalPlaythrough`,
 *    src/playthrough.ts — the seeded E9 script), asserting every verb's
 *    observable outcome on the shared run; and
 * 2. through a hand-driven session, asserting each verb's typed result
 *    directly, plus the replay determinism pair: snapshot/restore rewinds
 *    to an identical trajectory, and the sealed replay re-executes to a
 *    full-coverage match verdict (R8/R11).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";
import type { RuntimeEventEnvelope } from "../../../packages/runtime-contracts/src/index.ts";
import { asActorId, asDeterminismSeed, asSnapshotId } from "../../../packages/runtime-contracts/src/index.ts";
import { runCanonicalPlaythrough } from "./playthrough.ts";
import { compareSealedReplay } from "./replay.ts";
import { actInput, companionGrant, createLumenSession, playerIntent } from "./session.ts";
import { COMMAND_KINDS, movePayload } from "./events.ts";
import { intFieldOf } from "./outcomes.ts";
import { CANONICAL_SEED, COMPANION_ACTOR, PLAYER_ONE, SESSION_ID } from "./ids.ts";

const PLAYER_REF = { actorClass: "player", actorId: asActorId(String(PLAYER_ONE)) } as const;
const COMPANION_REF = { actorClass: "avatar-agent", actorId: asActorId(COMPANION_ACTOR) } as const;

const run = await runCanonicalPlaythrough();

test("experience protocol: every one of the nine verbs succeeded in the canonical playthrough", () => {
  const view = run.session.kernel.view();
  // load + reset + act + step + snapshot + restore + replay + terminate all
  // completed — the playthrough throws on any refusal, and it terminated.
  assert.equal(view.phase, "terminated");
  assert.equal(view.sessionId, SESSION_ID);
  // load(1) → reset(2) → restore(3): the run happened in epoch 2.
  assert.equal(view.epoch, 3);
  assert.equal(view.tick, 4);
  // observe: the authoritative log the submissions were derived from.
  assert.equal(run.events.length, 21);
  // 21 gameplay log events + restored + post-restore look + terminating +
  // terminated = the committed head at exit.
  assert.equal(view.committedEventSeq, 21 + 4);
});

test("experience protocol: act — eight recorded commands, unique ids, contiguous admission seqs", () => {
  assert.equal(run.commands.length, 8);
  assert.deepEqual(
    run.commands.map((command) => command.admissionSeq),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  const ids = run.commands.map((command) => String(command.envelope.commandId));
  assert.equal(new Set(ids).size, 8, "command ids are unique");
  // The companion's moves are grant-mediated (lock rule 14); the player's
  // moves and looks are player-input.
  const origins = run.commands.map((command) => command.envelope.origin.kind);
  assert.deepEqual(origins, [
    "player-input",
    "player-input",
    "broker-mediated",
    "player-input",
    "player-input",
    "player-input",
    "broker-mediated",
    "player-input",
  ]);
});

test("experience protocol: observe — the authoritative log is contiguous and carries the run outcome (R9)", () => {
  const seqs = run.events.map((event) => Number(event.seq));
  assert.deepEqual(seqs, seqs.map((_, index) => index + 1));
  const completed = run.events.find((event) => String(event.kind) === "run.completed");
  assert.ok(completed !== undefined, "the run completed");
  assert.equal(intFieldOf(completed.payload, "score"), 270);
  assert.equal(intFieldOf(completed.payload, "lumens"), 3);
});

test("experience protocol: snapshot + restore — boundaries are stored, loadable, and the world rewinds", () => {
  const boundary = run.session.snapshots.load(asSnapshotId(run.boundarySnapshotId));
  const final = run.session.snapshots.load(asSnapshotId(run.finalSnapshotId));
  assert.ok(boundary !== undefined, "the boundary snapshot is loadable");
  assert.ok(final !== undefined, "the final snapshot is loadable");
  assert.equal(boundary.tick, 0);
  assert.equal(final.tick, 4);
  // The restored render equals the completed render (the restore verb
  // rewound the world to the final snapshot's state).
  assert.equal(run.renders.restored, run.renders.complete);
});

test("experience protocol: replay — the recorded window equals the post-boundary event log", () => {
  const first = Number(run.replayWindow[0]?.seq);
  assert.ok(first > 1, "the window starts after a snapshot boundary");
  assert.deepEqual(
    run.replayWindow,
    run.events.slice(first - 1),
    "the replay verb returned exactly the recorded post-boundary events",
  );
  assert.equal(run.replayWindow.length, run.sealed.witness.events.length);
});

test("experience protocol: the sealed replay re-executes to a full-coverage match verdict (R8/R11)", () => {
  assert.equal(run.verdict.kind, "match");
  if (run.verdict.kind === "match") {
    assert.equal(run.verdict.confidence, 1);
    assert.equal(run.verdict.verifiedCount, run.verdict.totalEventCount);
    assert.equal(run.verdict.totalEventCount, run.sealed.witness.events.length);
  }
  // And the raw engine comparison agrees (recorded vs re-executed bytes).
  const comparison = compareSealedReplay(run.composition.document, run.sealed);
  assert.equal(comparison.status, "re-executed");
});

test("experience protocol: a hand-driven session exercises each verb with its typed result", () => {
  const session = createLumenSession({ document: run.composition.document, seed: CANONICAL_SEED, sessionId: "sess-nine-verbs" });
  const kernel = session.kernel;
  const statuses: Record<string, string> = {};

  statuses.load = kernel.load().status;
  const reset = kernel.reset(asDeterminismSeed(CANONICAL_SEED));
  statuses.reset = reset.status;
  if (reset.status !== "reset") throw new Error("reset refused");
  session.capabilityPort.issueGrant(companionGrant("sess-nine-verbs", reset.epoch));

  statuses.observe = kernel.observe(0).status;
  const look = kernel.act(actInput(playerIntent(PLAYER_REF, COMMAND_KINDS.heroLook, { kind: "unit" }, 100, 1), "nine-1"));
  statuses.act = look.status;
  const companion = kernel.act(
    actInput(playerIntent(COMPANION_REF, COMMAND_KINDS.companionMove, movePayload(2, 1), 140, 2), "nine-2", "grant-companion-move"),
  );
  assert.equal(companion.status, "committed", "the grant-mediated companion act committed");

  const step = kernel.step(2);
  statuses.step = step.status;
  if (step.status !== "stepped") throw new Error("step refused");
  assert.equal(step.fromTick, 0);
  assert.equal(step.toTick, 2);

  const snapshot = kernel.snapshot();
  statuses.snapshot = snapshot.status;
  if (snapshot.status !== "snapshotted") throw new Error("snapshot refused");

  const replayed = kernel.replay({ fromEventSeq: 1, toEventSeq: null });
  statuses.replay = replayed.status;
  if (replayed.status !== "replayed") throw new Error("replay refused");
  assert.equal(replayed.fromSeq, 1);
  assert.equal(replayed.toSeq, kernel.view().committedEventSeq);

  statuses.restore = kernel.restore(snapshot.snapshot.snapshotId).status;
  const terminated = kernel.terminate("nine verbs exercised");
  statuses.terminate = terminated.status;
  if (terminated.status !== "terminated") throw new Error("terminate refused");

  assert.deepEqual(statuses, {
    load: "loaded",
    reset: "reset",
    observe: "observed",
    act: "committed",
    step: "stepped",
    snapshot: "snapshotted",
    replay: "replayed",
    restore: "restored",
    terminate: "terminated",
  });
});

/**
 * Drives the canonical move script's first half (through tick 2) and
 * returns the session positioned at that point, plus the events so far.
 */
function drivePrefix(session: ReturnType<typeof createLumenSession>): readonly RuntimeEventEnvelope<GameIRValue>[] {
  const kernel = session.kernel;
  if (kernel.load().status !== "loaded") throw new Error("prefix load refused");
  const reset = kernel.reset(asDeterminismSeed(CANONICAL_SEED));
  if (reset.status !== "reset") throw new Error("prefix reset refused");
  session.capabilityPort.issueGrant(companionGrant(SESSION_ID, reset.epoch));
  const acts: readonly (readonly [string, GameIRValue])[] = [
    [COMMAND_KINDS.heroLook, { kind: "unit" }],
    [COMMAND_KINDS.heroMove, movePayload(1, 1)],
    [COMMAND_KINDS.companionMove, movePayload(2, 2)],
    [COMMAND_KINDS.heroLook, { kind: "unit" }],
  ];
  for (const [index, [kind, payload]] of acts.entries()) {
    const isCompanion = kind === COMMAND_KINDS.companionMove;
    const result = kernel.act(
      actInput(
        playerIntent(isCompanion ? COMPANION_REF : PLAYER_REF, kind, payload, 100 * (index + 1), index + 1),
        `prefix-${index + 1}`,
        isCompanion ? "grant-companion-move" : undefined,
      ),
    );
    if (result.status !== "committed") throw new Error(`prefix act ${kind} refused: ${result.status}`);
  }
  if (kernel.step(2).status !== "stepped") throw new Error("prefix step refused");
  const observed = kernel.observe(0);
  if (observed.status !== "observed") throw new Error("prefix observe refused");
  return observed.observation.events as readonly RuntimeEventEnvelope<GameIRValue>[];
}

test("replay determinism: snapshot/restore rewinds to an identical trajectory (E9)", () => {
  const session = createLumenSession({ document: run.composition.document, seed: CANONICAL_SEED, sessionId: SESSION_ID });
  drivePrefix(session);

  // The boundary snapshot at the prefix end.
  const snapshot = session.kernel.snapshot();
  if (snapshot.status !== "snapshotted") throw new Error("boundary snapshot refused");
  const prefixHead = Number(session.kernel.view().committedEventSeq);

  const tail: readonly (readonly [string, GameIRValue])[] = [
    [COMMAND_KINDS.heroMove, movePayload(3, 3)],
    [COMMAND_KINDS.heroLook, { kind: "unit" }],
    [COMMAND_KINDS.heroMove, movePayload(5, 4)],
  ];
  const driveTail = (nonceTag: string): readonly RuntimeEventEnvelope<GameIRValue>[] => {
    for (const [index, [kind, payload]] of tail.entries()) {
      const result = session.kernel.act(
        actInput(playerIntent(PLAYER_REF, kind, payload, 2_000 + 100 * index, 10 + index), `${nonceTag}-${index + 1}`),
      );
      if (result.status !== "committed") throw new Error(`tail act ${kind} refused: ${result.status}`);
    }
    if (session.kernel.step(1).status !== "stepped") throw new Error("tail step refused");
    const observed = session.kernel.observe(0);
    if (observed.status !== "observed") throw new Error("tail observe refused");
    return observed.observation.events as readonly RuntimeEventEnvelope<GameIRValue>[];
  };

  // First pass: the tail straight through.
  const firstTail = driveTail("tail");
  const worldAfterFirst = snapshotWorldOf(session);

  // Rewind: restore the boundary snapshot and re-drive the SAME tail.
  const restore = session.kernel.restore(snapshot.snapshot.snapshotId);
  if (restore.status !== "restored") throw new Error(`restore refused: ${String(restore.status)}`);
  const restoreSeq = Number(session.kernel.view().committedEventSeq); // the restored system event
  const secondTail = driveTail("retail");
  const worldAfterSecond = snapshotWorldOf(session);

  // Gameplay comparison (kind + tick + payload): the re-driven tail after
  // the restore event is identical to the first pass's tail.
  const shape = (events: readonly RuntimeEventEnvelope<GameIRValue>[], afterSeq: number) =>
    events
      .filter((event) => Number(event.seq) > afterSeq)
      .map((event) => ({ kind: String(event.kind), tick: Number(event.tick), payload: event.payload }));
  assert.deepEqual(shape(secondTail, restoreSeq), shape(firstTail, prefixHead), "the restored session re-drove the identical tail");
  assert.deepEqual(worldAfterSecond, worldAfterFirst, "the restored run ends in the same world state");
});

/** Snapshots the session's current world (JSON-deep-comparable). */
function snapshotWorldOf(session: ReturnType<typeof createLumenSession>): unknown {
  const snapshot = session.kernel.snapshot();
  if (snapshot.status !== "snapshotted") throw new Error("snapshot refused");
  return session.snapshots.load(snapshot.snapshot.snapshotId)?.world;
}
