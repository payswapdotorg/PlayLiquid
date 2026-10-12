/**
 * LATTICE — replay capture + deterministic re-execution (PL-039; R8,
 * lock rule 15: replay is a platform primitive).
 *
 * The streaming scenario's session is captured through
 * `@playliquid/replay`'s content-addressed artifacts (command stream +
 * event witness + replay record, sealed by the package's own
 * authorities — nothing here re-implements sealing or verification) and
 * RE-EXECUTED through the replay engine (`reExecuteReplay`) over a
 * launcher that starts fresh Simulation Runtime sessions. The recorded
 * trajectory replays deterministically over the STREAMED world: the
 * re-execution re-admits every command through the same canonical
 * admission gate, so chunks stream identically (E2/E9).
 *
 * R8 REUSE: the same sealed replay serves players (the artifact), QA
 * (the test suite's re-execution equality check — replay.test.ts) and
 * integrity (the reference verifier's probabilistic verdict).
 *
 * Environment limitation: the replay store is the package's in-memory
 * fake (a clearly-labeled test double — no durable storage here).
 */

import { createHash } from "node:crypto";
import { asTimestamp } from "../../../packages/runtime-contracts/src/index.ts";
import type { DeterminismSeed, RuntimeEventEnvelope, SessionId } from "../../../packages/runtime-contracts/src/index.ts";
import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { FixedClock, InMemorySnapshotStore, SimulationSession } from "../../../packages/simulation/src/index.ts";
import type { SimulationSnapshot } from "../../../packages/simulation/src/index.ts";
import {
  InMemoryReplayStore,
  createReferenceIntegrityVerifier,
  reExecuteReplay,
  sealCommandStream,
  sealEventWitness,
  sealReplayRecord,
} from "../../../packages/replay/src/index.ts";
import type {
  CommandStreamArtifact,
  EventWitnessArtifact,
  IntegrityVerdict,
  RecordedCommand,
  ReplayRecord,
  ReplaySource,
  ReplayTargetLauncher,
} from "../../../packages/replay/src/index.ts";
import { COMMAND_KINDS, VIEWPOINT_GRANT_ID, movePayload } from "./events.ts";
import { buildLatticeBinding } from "./binding.ts";
import type { LatticeComposition } from "./composition.ts";
import { SESSION_ID, VIEWPOINT_ACTOR } from "./ids.ts";
import type { Tick } from "../../../packages/runtime-contracts/src/index.ts";

/** What one canonical capture seals (all content-addressed, E9/E10). */
export interface SealedLatticeReplay {
  readonly record: ReplayRecord;
  readonly stream: CommandStreamArtifact;
  readonly witness: EventWitnessArtifact;
  readonly store: ReplaySource;
}

/** One scripted viewpoint move of the canonical journey. */
export interface ScriptedMove {
  readonly nonce: string;
  readonly dx: number;
  readonly dy: number;
  readonly dueTick: number;
}

/** The pre-boundary moves of the canonical journey (due ≤ 8). */
export const PRE_MOVES: readonly ScriptedMove[] = [
  { nonce: "mv-1", dx: 9.5, dy: 0, dueTick: 2 },
  { nonce: "mv-2", dx: 9.5, dy: 0, dueTick: 4 },
  { nonce: "mv-3", dx: 9.5, dy: 0, dueTick: 6 },
];

/** The post-boundary moves (due > 8; the replayed window). */
export const POST_MOVES: readonly ScriptedMove[] = [
  { nonce: "mv-4", dx: 9.5, dy: 0, dueTick: 9 },
  { nonce: "mv-5", dx: 0, dy: 12, dueTick: 11 },
  { nonce: "mv-6", dx: -15, dy: 0, dueTick: 14 },
  { nonce: "mv-7", dx: -25, dy: 0, dueTick: 17 },
  { nonce: "mv-8", dx: 0, dy: -12, dueTick: 20 },
];

/** The tick the boundary snapshot is taken at. */
export const BOUNDARY_TICK = 8;
/** The final tick of the canonical journey. */
export const FINAL_TICK = 24;

/** Builds one canonical broker-mediated viewpoint-move envelope (the E2 shape). */
export function viewpointMoveEnvelope(sessionId: string, nonce: string, dx: number, dy: number) {
  return {
    commandId: `cmd-${nonce}` as never,
    sessionId: sessionId as never,
    kind: COMMAND_KINDS.viewMove as never,
    epoch: 1 as never,
    actor: { actorClass: "avatar-agent" as const, actorId: VIEWPOINT_ACTOR },
    origin: { kind: "broker-mediated" as const, grantId: VIEWPOINT_GRANT_ID as never },
    idempotencyKey: { scope: "command" as const, actor: VIEWPOINT_ACTOR, nonce: nonce as never },
    issuedAt: asTimestamp(1),
    payload: movePayload(dx, dy),
  };
}

/** Builds the recorded-command entry of one scripted move. */
export function recordedMove(sessionId: string, move: ScriptedMove, admissionSeq: number): RecordedCommand {
  return {
    admissionSeq,
    dueTick: move.dueTick,
    envelope: viewpointMoveEnvelope(sessionId, move.nonce, move.dx, move.dy),
  };
}

/** Seals the canonical capture: stream + witness + the immutable record. */
export function sealLatticeReplay(input: {
  readonly sessionId: string;
  readonly game: Parameters<typeof sealReplayRecord>[0]["game"];
  readonly seed: DeterminismSeed;
  readonly commands: readonly RecordedCommand[];
  readonly events: readonly RuntimeEventEnvelope<GameIRValue>[];
  readonly boundary: { readonly snapshot: SimulationSnapshot; readonly afterEventSeq: number };
  readonly toTick: number;
}): SealedLatticeReplay {
  const stream = sealCommandStream(input.commands);
  const witness = sealEventWitness(input.events);
  const store = new InMemoryReplayStore();
  store.putCommandStream(stream);
  store.putEventWitness(witness);
  const record = sealReplayRecord({
    sessionId: input.sessionId as SessionId,
    game: input.game,
    determinism: input.seed,
    capture: {
      fromEventSeq: input.boundary.afterEventSeq + 1,
      toEventSeq: input.boundary.afterEventSeq + input.events.length,
      toTick: input.toTick,
      boundary: {
        snapshotId: input.boundary.snapshot.snapshotId,
        formDigest: createHash("sha256").update(input.boundary.snapshot.form, "utf8").digest("hex"),
        afterEventSeq: input.boundary.afterEventSeq,
        tick: Number(input.boundary.snapshot.tick),
        artifact: input.boundary.snapshot,
      },
    },
    commandStream: stream.streamDigest,
    eventWitness: witness.witnessDigest,
    provenance: {
      capturedBy: "examples/large-world lattice harness",
      capturedAt: asTimestamp(2_400),
      runtimeRole: "simulation",
      tool: "large-world/1.0",
      consumers: ["player", "qa", "integrity", "simulation"],
    },
  });
  store.putReplay(record);
  return { record, stream, witness, store };
}

/** Starts fresh sessions of the streamed world (the re-execution glue). */
export function createLatticeLauncher(composition: LatticeComposition): ReplayTargetLauncher {
  const ports = () => ({ clock: new FixedClock([1]), snapshotStore: new InMemorySnapshotStore() });
  const launch = (sessionId: string) => {
    const session = new SimulationSession({
      sessionId,
      binding: buildLatticeBinding(composition, { sessionId }),
      ports: ports(),
    });
    return session;
  };
  return {
    launchAtOrigin(input) {
      const session = launch(String(input.sessionId));
      const begun = session.begin(input.seed);
      if (begun.status !== "begun") {
        return { status: "rejected", code: "begin-rejected", detail: `simulation session refused to begin (${begun.status})` };
      }
      return { status: "launched", session, afterEventSeq: begun.afterEventSeq, tick: begun.tick };
    },
    launchAtBoundary(input) {
      const session = launch(String(input.sessionId));
      const begun = session.beginFromSnapshot(input.boundary.artifact as SimulationSnapshot, input.seed);
      if (begun.status !== "begun") {
        return { status: "rejected", code: "begin-from-snapshot-rejected", detail: `boundary ${input.boundary.snapshotId} refused (${begun.status})` };
      }
      return { status: "launched", session, afterEventSeq: begun.afterEventSeq, tick: begun.tick };
    },
  };
}

/** The raw re-execution comparison (recorded vs re-executed, typed result). */
export function compareLatticeReplay(composition: LatticeComposition, sealed: SealedLatticeReplay) {
  return reExecuteReplay({ replayId: sealed.record.replayId, source: sealed.store, launcher: createLatticeLauncher(composition) });
}

/**
 * Runs the reference integrity verifier (R8/R11 reuse) over a sealed
 * replay: re-executes the record and compares recorded vs re-executed
 * canonical event bytes at every sampled position. Pure over its inputs.
 */
export function verifyLatticeReplay(composition: LatticeComposition, sealed: SealedLatticeReplay): IntegrityVerdict {
  return createReferenceIntegrityVerifier().verify({
    replayId: sealed.record.replayId,
    source: sealed.store,
    launcher: createLatticeLauncher(composition),
  });
}

/** The canonical session id re-export (E9: fixed, never random). */
export const LATTICE_SESSION_ID = SESSION_ID;

/** Tick re-export for scenario consumers. */
export type { Tick as LatticeTick };
