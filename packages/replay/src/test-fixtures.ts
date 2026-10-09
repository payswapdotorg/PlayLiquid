/**
 * TEST FIXTURES — the simulation-side glue for the replay package's tests
 * and harness (PL-014).
 *
 * These fixtures bind @playliquid/simulation (a DEV dependency — the
 * replay package never imports a runtime at runtime, per the module
 * dependency matrix; lock 12) to the replay target ports: they run a
 * scripted deterministic demo session, capture it into replay artifacts
 * (command stream + event witness + record), and provide the launcher that
 * starts fresh re-execution sessions through `begin`/`beginFromSnapshot`.
 *
 * The scripted scenario (mirrors the simulation harness): four recorded
 * `world.move` commands, a snapshot boundary at tick 5, continuation to
 * tick 10 — deterministic under the demo seed.
 */

import { asTimestamp } from "@playliquid/runtime-contracts";
import type { DeterminismSeed, RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import { createHash } from "node:crypto";
import {
  FixedClock,
  InMemorySnapshotStore,
  SimulationSession,
  demoEntityRefs,
  demoGameBinding,
  demoSeed,
  movePayload,
  DEMO_ACTOR_ID,
} from "@playliquid/simulation";
import type { SimulationSnapshot } from "@playliquid/simulation";
import { sealCommandStream } from "./command-stream.ts";
import type { RecordedCommand } from "./command-stream.ts";
import { sealEventWitness } from "./event-witness.ts";
import { sealReplayRecord } from "./record.ts";
import type { ReplayRecord } from "./record.ts";
import { InMemoryReplayStore } from "./fakes.ts";
import type { ReplayTargetLauncher } from "./reexecute.ts";

/** A recorded move command spec of the scripted scenario. */
export interface ScriptedMove {
  readonly nonce: string;
  readonly delta: readonly [number, number, number];
  readonly dueTick: number;
}

/** Pre-boundary moves (due at/before the boundary tick 5). */
export const PRE_MOVES: readonly ScriptedMove[] = [
  { nonce: "r-1", delta: [2, 0, 0], dueTick: 3 },
  { nonce: "r-2", delta: [0, 3, 0], dueTick: 5 },
];

/** Post-boundary moves (due after the boundary tick). */
export const POST_MOVES: readonly ScriptedMove[] = [
  { nonce: "r-3", delta: [-1, -1, 2], dueTick: 7 },
  { nonce: "r-4", delta: [1, 0, 0], dueTick: 8 },
];

/** Builds one canonical broker-mediated move envelope (the E2 shape). */
export function moveEnvelope(sessionId: string, nonce: string, delta: readonly [number, number, number]) {
  return {
    commandId: `cmd-${nonce}` as never,
    sessionId: sessionId as never,
    kind: "world.move" as never,
    epoch: 1 as never,
    actor: { actorClass: "avatar-agent" as const, actorId: DEMO_ACTOR_ID },
    origin: { kind: "broker-mediated" as const, grantId: "grant-demo-locomotion" as never },
    idempotencyKey: { scope: "command" as const, actor: DEMO_ACTOR_ID, nonce: nonce as never },
    issuedAt: asTimestamp(1),
    payload: movePayload(demoEntityRefs()[0]!, delta),
  };
}

/** Everything a captured scenario hands to the replay tests. */
export interface ScenarioCapture {
  readonly store: InMemoryReplayStore;
  readonly record: ReplayRecord;
  readonly seed: DeterminismSeed;
  /** The boundary snapshot artifact (undefined for origin captures). */
  readonly boundary?: SimulationSnapshot;
  readonly boundarySeq: number;
  /** The recorded post-boundary events (the witness's events). */
  readonly recordedEvents: readonly RuntimeEventEnvelope<never>[];
  /** The recorded post-boundary command entries (admission order). */
  readonly recordedCommands: readonly RecordedCommand[];
  readonly finalTick: number;
}

function makeSession(sessionId: string): SimulationSession {
  return new SimulationSession({
    sessionId: sessionId as never,
    binding: demoGameBinding(sessionId),
    ports: { clock: new FixedClock([1]), snapshotStore: new InMemorySnapshotStore() },
  });
}

/**
 * Runs the scripted scenario and captures it as a snapshot-boundary replay
 * (the hard case: the record continues from tick 5 / the boundary seq).
 */
export function captureBoundaryScenario(sessionId: string): ScenarioCapture {
  const seed = demoSeed(11);
  const session = makeSession(sessionId);
  session.begin(seed);
  let admissionSeq = 0;
  const submit = (moves: readonly ScriptedMove[]): readonly RecordedCommand[] =>
    moves.map((move) => {
      admissionSeq += 1;
      const submitted = session.submitRecordedCommand(moveEnvelope(sessionId, move.nonce, move.delta), move.dueTick);
      if (submitted.status !== "submitted") {
        throw new Error(`fixture: ${move.nonce} was not admitted: ${JSON.stringify(submitted)}`);
      }
      return { admissionSeq, dueTick: move.dueTick, envelope: moveEnvelope(sessionId, move.nonce, move.delta) };
    });
  submit(PRE_MOVES);
  session.advanceToTick(5);
  const snap = session.snapshot();
  if (snap.status !== "snapshotted") throw new Error("fixture: snapshot failed");
  const boundarySeq = snap.snapshot.afterEventSeq;
  const post = submit(POST_MOVES);
  session.advanceToTick(10);
  const events = session.readEvents(boundarySeq);
  const stream = sealCommandStream(post);
  const witness = sealEventWitness(events);
  const record = sealReplayRecord({
    sessionId: sessionId as never,
    game: demoGameBinding(sessionId).game,
    determinism: seed,
    capture: {
      fromEventSeq: boundarySeq + 1,
      toEventSeq: boundarySeq + events.length,
      toTick: 10,
      boundary: {
        snapshotId: snap.snapshot.snapshotId,
        formDigest: createHash("sha256").update(snap.snapshot.form, "utf8").digest("hex"),
        afterEventSeq: boundarySeq,
        tick: Number(snap.snapshot.tick),
        artifact: snap.snapshot,
      },
    },
    commandStream: stream.streamDigest,
    eventWitness: witness.witnessDigest,
    provenance: {
      capturedBy: "qa-harness",
      capturedAt: asTimestamp(12345),
      runtimeRole: "simulation",
      tool: "replay-test-fixtures/1.0",
      consumers: ["qa", "integrity"],
    },
  });
  const store = new InMemoryReplayStore();
  store.putCommandStream(stream);
  store.putEventWitness(witness);
  store.putReplay(record);
  return {
    store,
    record,
    seed,
    boundary: snap.snapshot,
    boundarySeq,
    recordedEvents: events as readonly RuntimeEventEnvelope<never>[],
    recordedCommands: post,
    finalTick: 10,
  };
}

/**
 * Runs the scripted scenario and captures it as an origin replay (the full
 * run from event seq 1 — no boundary).
 */
export function captureOriginScenario(sessionId: string): ScenarioCapture {
  const seed = demoSeed(13);
  const session = makeSession(sessionId);
  session.begin(seed);
  let admissionSeq = 0;
  const all: RecordedCommand[] = [];
  for (const move of [...PRE_MOVES, ...POST_MOVES]) {
    admissionSeq += 1;
    const submitted = session.submitRecordedCommand(moveEnvelope(sessionId, move.nonce, move.delta), move.dueTick);
    if (submitted.status !== "submitted") {
      throw new Error(`fixture: ${move.nonce} was not admitted: ${JSON.stringify(submitted)}`);
    }
    all.push({ admissionSeq, dueTick: move.dueTick, envelope: moveEnvelope(sessionId, move.nonce, move.delta) });
  }
  session.advanceToTick(10);
  const events = session.eventLog;
  const stream = sealCommandStream(all);
  const witness = sealEventWitness(events);
  const record = sealReplayRecord({
    sessionId: sessionId as never,
    game: demoGameBinding(sessionId).game,
    determinism: seed,
    capture: { fromEventSeq: 1, toEventSeq: events.length, toTick: 10 },
    commandStream: stream.streamDigest,
    eventWitness: witness.witnessDigest,
    provenance: {
      capturedBy: "qa-harness",
      capturedAt: asTimestamp(12346),
      runtimeRole: "simulation",
      tool: "replay-test-fixtures/1.0",
      consumers: ["player", "qa", "integrity"],
    },
  });
  const store = new InMemoryReplayStore();
  store.putCommandStream(stream);
  store.putEventWitness(witness);
  store.putReplay(record);
  return {
    store,
    record,
    seed,
    boundarySeq: 0,
    recordedEvents: events as readonly RuntimeEventEnvelope<never>[],
    recordedCommands: all,
    finalTick: 10,
  };
}

/**
 * The simulation-backed re-execution launcher: starts fresh sessions at the
 * origin or at a snapshot boundary (the replay target glue).
 */
export function makeSimulationLauncher(): { readonly launcher: ReplayTargetLauncher; readonly sessions: readonly SimulationSession[] } {
  const sessions: SimulationSession[] = [];
  const ports = () => ({ clock: new FixedClock([1]), snapshotStore: new InMemorySnapshotStore() });
  return {
    launcher: {
      launchAtOrigin({ sessionId, seed }) {
        const session = new SimulationSession({
          sessionId,
          binding: demoGameBinding(String(sessionId)),
          ports: ports(),
        });
        const begun = session.begin(seed);
        if (begun.status !== "begun") {
          return { status: "rejected", code: "begin-rejected", detail: "simulation session refused to begin" };
        }
        sessions.push(session);
        return { status: "launched", session, afterEventSeq: begun.afterEventSeq, tick: begun.tick };
      },
      launchAtBoundary({ sessionId, seed, boundary }) {
        const session = new SimulationSession({
          sessionId,
          binding: demoGameBinding(String(sessionId)),
          ports: ports(),
        });
        const begun = session.beginFromSnapshot(boundary.artifact as SimulationSnapshot, seed);
        if (begun.status !== "begun") {
          return { status: "rejected", code: "begin-from-snapshot-rejected", detail: `boundary ${boundary.snapshotId} refused` };
        }
        sessions.push(session);
        return { status: "launched", session, afterEventSeq: begun.afterEventSeq, tick: begun.tick };
      },
    },
    sessions,
  };
}
