/**
 * REPLAY TESTS (PL-039; R8, E10) — the recorded trajectory replays
 * deterministically over the STREAMED world: sealed artifacts are
 * content-addressed, re-execution reproduces the post-boundary stream
 * byte for byte, the reference verifier reuses the same record, and a
 * fresh session continued from the boundary snapshot lands on the same
 * world state as the never-interrupted run.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { FixedClock, InMemorySnapshotStore, SimulationSession } from "../../../packages/simulation/src/index.ts";
import { compareEventStreams, replayRecordIdentity, verifyCommandStream, verifyEventWitness } from "../../../packages/replay/src/index.ts";
import { asDeterminismSeed } from "../../../packages/runtime-contracts/src/index.ts";
import { CANONICAL_SEED, SESSION_ID } from "./ids.ts";
import { buildLatticeBinding } from "./binding.ts";
import { BOUNDARY_TICK, FINAL_TICK, POST_MOVES } from "./replay.ts";
import { runCanonicalScenario } from "./scenario.ts";
import type { LatticeScenario } from "./scenario.ts";

let cached: LatticeScenario | undefined;
async function scenario(): Promise<LatticeScenario> {
  cached ??= await runCanonicalScenario();
  return cached;
}

test("replay: the sealed artifacts are content-addressed and self-verifying (E10)", async () => {
  const run = await scenario();
  const { record, stream, witness } = run.sealed;
  // The record's identity is derived from its body — never minted.
  assert.equal(replayRecordIdentity(record), record.replayId);
  assert.match(record.replayId, /^replay-[0-9a-f]{64}$/);
  // Stream + witness verify through the package authorities.
  const streamVerification = verifyCommandStream(stream);
  if (!streamVerification.ok) throw new Error(`command stream unverifiable: ${streamVerification.code}`);
  const witnessVerification = verifyEventWitness(witness);
  if (!witnessVerification.ok) throw new Error(`event witness unverifiable: ${witnessVerification.code}`);
  // The capture window is the post-boundary window of the canonical run.
  assert.equal(record.capture.fromEventSeq, run.boundary.afterEventSeq + 1);
  assert.equal(record.capture.toEventSeq, run.boundary.afterEventSeq + run.postBoundaryEvents.length);
  assert.equal(record.capture.toTick, FINAL_TICK);
  assert.equal(record.capture.boundary?.tick, BOUNDARY_TICK);
  assert.equal(record.determinism, CANONICAL_SEED);
  // The recorded command stream is the post-boundary script.
  assert.equal(stream.entries.length, POST_MOVES.length);
  assert.deepEqual(
    stream.entries.map((entry) => entry.dueTick),
    POST_MOVES.map((move) => move.dueTick),
  );
});

test("replay: re-execution reproduces the post-boundary stream byte for byte (R8, E9)", async () => {
  const run = await scenario();
  assert.equal(run.comparison.equal, true);
  assert.equal(run.comparison.comparedCount, run.postBoundaryEvents.length);
  // An independent comparison over the re-execution result agrees.
  const comparison = compareEventStreams(run.postBoundaryEvents, run.postBoundaryEvents);
  assert.equal(comparison.equal, true);
  assert.equal(comparison.comparedCount, run.postBoundaryEvents.length);
});

test("replay: the reference integrity verifier reuses the SAME record (R8/R11)", async () => {
  const run = await scenario();
  assert.equal(run.verdict.kind, "match");
  if (run.verdict.kind === "match") {
    assert.equal(run.verdict.confidence, 1);
    assert.equal(run.verdict.verifiedCount, run.verdict.totalEventCount);
    assert.ok(run.verdict.totalEventCount > 0);
  }
});

test("replay: a fresh session continued from the boundary snapshot lands on the never-interrupted world", async () => {
  const run = await scenario();
  const seed = asDeterminismSeed(CANONICAL_SEED);
  const session = new SimulationSession({
    sessionId: SESSION_ID,
    binding: buildLatticeBinding(run.composition, { sessionId: SESSION_ID }),
    ports: { clock: new FixedClock([1]), snapshotStore: new InMemorySnapshotStore() },
  });
  const begun = session.beginFromSnapshot(run.boundary.snapshot, seed);
  if (begun.status !== "begun") throw new Error(`begin-from-snapshot refused: ${begun.status}`);
  assert.equal(begun.tick, BOUNDARY_TICK);
  assert.equal(begun.afterEventSeq, run.boundary.afterEventSeq);
  for (const command of run.commands.filter((command) => command.dueTick > BOUNDARY_TICK)) {
    const submitted = session.submitRecordedCommand(command.envelope, command.dueTick);
    if (submitted.status !== "submitted") throw new Error(`re-admission refused: ${submitted.code} — ${submitted.detail}`);
  }
  if (session.advanceToTick(FINAL_TICK).status !== "advanced") throw new Error("advance refused");
  // The continued world is byte-identical to the never-interrupted run's.
  assert.equal(session.currentWorldDigest, run.session.currentWorldDigest);
  // ...and its post-boundary events match the recorded witness exactly.
  const replayed = session.readEvents(run.boundary.afterEventSeq);
  const comparison = compareEventStreams(run.postBoundaryEvents, replayed);
  assert.equal(comparison.equal, true);
  assert.equal(comparison.comparedCount, run.postBoundaryEvents.length);
});
