/**
 * LATTICE — the canonical streaming scenario (PL-039).
 *
 * End-to-end over the REAL authorities: compose the world (document →
 * model → 87 packages through the registry/CAS → verified lock), build
 * the Simulation Runtime binding, run one seeded session with the
 * scripted viewpoint journey (moves recorded as canonical command
 * envelopes), snapshot at the boundary tick, continue to the final tick,
 * then capture the post-boundary window as a sealed replay, re-execute
 * it through a fresh session and compare the event streams byte for
 * byte. The pure streaming schedule is derived over the SAME planned
 * path — the session and the schedule must agree (the R15 evidence).
 *
 * Everything is derived from the fixed seed (E9): running the scenario
 * twice produces identical evidence.
 */

import type { RuntimeEventEnvelope } from "../../../packages/runtime-contracts/src/index.ts";
import { asDeterminismSeed } from "../../../packages/runtime-contracts/src/index.ts";
import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { FixedClock, InMemorySnapshotStore, SimulationSession } from "../../../packages/simulation/src/index.ts";
import type { SimulationSnapshot } from "../../../packages/simulation/src/index.ts";
import { compareEventStreams } from "../../../packages/replay/src/index.ts";
import type { EventStreamEquality, IntegrityVerdict, RecordedCommand } from "../../../packages/replay/src/index.ts";
import { composeLatticeWorld } from "./composition.ts";
import type { LatticeComposition } from "./composition.ts";
import { buildLatticeBinding, gameRefSummaryOf } from "./binding.ts";
import { compareLatticeReplay, sealLatticeReplay, verifyLatticeReplay } from "./replay.ts";
import type { ScriptedMove, SealedLatticeReplay } from "./replay.ts";
import { BOUNDARY_TICK, FINAL_TICK, POST_MOVES, PRE_MOVES, viewpointMoveEnvelope } from "./replay.ts";
import { SPAWN } from "./layout.ts";
import { deriveStreamingSchedule, dormantChunkIds, readStreamingView } from "./streaming.ts";
import type { StreamingSchedule, StreamingView } from "./streaming.ts";
import { CANONICAL_SEED, SESSION_ID } from "./ids.ts";
import type { CompositionRefusal } from "./composition.ts";

/** Formats any composition refusal as one diagnostic line (typed, E8). */
export function refusalMessage(refusal: CompositionRefusal): string {
  if (refusal.code === "document-invalid") {
    return `document-invalid (${refusal.diagnostics.map((diagnostic) => diagnostic.code).join(", ")})`;
  }
  if (refusal.code === "world-model-invalid") {
    return `world-model-invalid (${refusal.detail})`;
  }
  if (refusal.code === "lock-unverified") {
    return `lock-unverified (${refusal.problems.map((problem) => problem.code).join(", ")})`;
  }
  return `publication ${String(refusal.stage)} of ${String(refusal.packageId)} (${refusal.detail})`;
}

/** The streaming evidence of one scenario run. */
export interface LatticeScenarioStats extends StreamingView {
  readonly finalResidentCount: number;
  readonly dormantCount: number;
  readonly tick: number;
}

/** Everything the canonical scenario run produces. */
export interface LatticeScenario {
  readonly composition: LatticeComposition;
  readonly session: SimulationSession;
  readonly commands: readonly RecordedCommand[];
  readonly boundary: { readonly snapshot: SimulationSnapshot; readonly afterEventSeq: number; readonly tick: number };
  readonly postBoundaryEvents: readonly RuntimeEventEnvelope<GameIRValue>[];
  readonly allEvents: readonly RuntimeEventEnvelope<GameIRValue>[];
  readonly sealed: SealedLatticeReplay;
  readonly comparison: EventStreamEquality;
  readonly verdict: IntegrityVerdict;
  readonly schedule: StreamingSchedule;
  readonly stats: LatticeScenarioStats;
}

function submitMoves(session: SimulationSession, moves: readonly ScriptedMove[], startSeq: number): RecordedCommand[] {
  const recorded: RecordedCommand[] = [];
  for (const move of moves) {
    const envelope = viewpointMoveEnvelope(SESSION_ID, move.nonce, move.dx, move.dy);
    const submitted = session.submitRecordedCommand(envelope, move.dueTick);
    if (submitted.status !== "submitted") {
      throw new Error(`scenario: move ${move.nonce} was not admitted: ${submitted.code} — ${submitted.detail}`);
    }
    recorded.push({ admissionSeq: startSeq + recorded.length, dueTick: move.dueTick, envelope });
  }
  return recorded;
}

/** The planned viewpoint positions at every tick 1..FINAL_TICK (pure). */
export function plannedWaypoints(): readonly { tick: number; x: number; y: number }[] {
  const waypoints: { tick: number; x: number; y: number }[] = [];
  let x = SPAWN[0];
  let y = SPAWN[1];
  for (let tick = 1; tick <= FINAL_TICK; tick += 1) {
    for (const move of [...PRE_MOVES, ...POST_MOVES]) {
      if (move.dueTick === tick) {
        x = Math.min(Math.max(x + move.dx, 0.5), 127.5);
        y = Math.min(Math.max(y + move.dy, 0.5), 127.5);
      }
    }
    waypoints.push({ tick, x, y });
  }
  return waypoints;
}

/** A JSON-deep-comparable projection of one scenario run (the determinism oracle). */
export function scenarioEvidenceOf(scenario: LatticeScenario) {
  const envelope = (event: RuntimeEventEnvelope<GameIRValue>) => ({
    id: String(event.eventId),
    kind: String(event.kind),
    tick: Number(event.tick),
    seq: Number(event.seq),
    payload: event.payload,
  });
  return {
    composition: {
      gameIrDigest: scenario.composition.gameIrDigest,
      lockFingerprint: scenario.composition.lockFingerprint,
      compositionDigest: scenario.composition.compositionDigest,
      packageCount: scenario.composition.packageCount,
      chunkCount: scenario.composition.chunkCount,
    },
    commands: scenario.commands.map((command) => ({
      admissionSeq: command.admissionSeq,
      dueTick: command.dueTick,
      commandId: String(command.envelope.commandId),
    })),
    boundary: { afterEventSeq: scenario.boundary.afterEventSeq, tick: scenario.boundary.tick, snapshotId: scenario.boundary.snapshot.snapshotId },
    postBoundaryEvents: scenario.postBoundaryEvents.map(envelope),
    allEventCount: scenario.allEvents.length,
    sealed: {
      record: scenario.sealed.record.replayId,
      stream: scenario.sealed.stream.streamDigest,
      witness: scenario.sealed.witness.witnessDigest,
    },
    comparison: scenario.comparison,
    verdict: scenario.verdict,
    schedule: {
      totalLoads: scenario.schedule.totalLoads,
      totalUnloads: scenario.schedule.totalUnloads,
      totalCasFetches: scenario.schedule.totalCasFetches,
      totalCheckpointReloads: scenario.schedule.totalCheckpointReloads,
      steps: scenario.schedule.steps.map((step) => ({
        tick: step.tick,
        position: step.position,
        effects: step.effects,
        refusals: step.refusals,
      })),
    },
    stats: scenario.stats,
  };
}

/**
 * Runs the canonical streaming scenario. Throws on any refusal (the
 * canonical world is well-formed by construction; refusals are exercised
 * by the negative tests).
 */
export async function runCanonicalScenario(options: { readonly seed?: string; readonly sessionId?: string } = {}): Promise<LatticeScenario> {
  const seed = options.seed ?? CANONICAL_SEED;
  const sessionId = options.sessionId ?? SESSION_ID;
  const composed = await composeLatticeWorld();
  if (!composed.ok) {
    throw new Error(`scenario: composition refused: ${refusalMessage(composed)}`);
  }
  const composition = composed;

  const session = new SimulationSession({
    sessionId,
    binding: buildLatticeBinding(composition, { sessionId }),
    ports: { clock: new FixedClock([1]), snapshotStore: new InMemorySnapshotStore() },
  });
  const begun = session.begin(asDeterminismSeed(seed));
  if (begun.status !== "begun") throw new Error(`scenario: session refused to begin (${begun.status})`);

  const pre = submitMoves(session, PRE_MOVES, 1);
  if (session.advanceToTick(BOUNDARY_TICK).status !== "advanced") throw new Error("scenario: advance to boundary refused");
  const snap = session.snapshot();
  if (snap.status !== "snapshotted") throw new Error("scenario: boundary snapshot refused");
  const boundary = { snapshot: snap.snapshot, afterEventSeq: snap.snapshot.afterEventSeq, tick: Number(snap.snapshot.tick) };

  const post = submitMoves(session, POST_MOVES, pre.length + 1);
  if (session.advanceToTick(FINAL_TICK).status !== "advanced") throw new Error("scenario: advance to final tick refused");

  const postBoundaryEvents = session.readEvents(boundary.afterEventSeq);
  const allEvents = session.eventLog;
  const world = session.worldState;
  if (world === undefined) throw new Error("scenario: no world state after the run");

  const sealed = sealLatticeReplay({
    sessionId,
    game: gameRefSummaryOf(composition),
    seed: asDeterminismSeed(seed),
    commands: post,
    events: postBoundaryEvents,
    boundary,
    toTick: FINAL_TICK,
  });
  const reexecuted = compareLatticeReplay(composition, sealed);
  if (reexecuted.status !== "re-executed") {
    throw new Error(`scenario: replay re-execution refused: ${reexecuted.code} — ${reexecuted.detail}`);
  }
  const comparison = compareEventStreams(postBoundaryEvents, reexecuted.events);
  if (!comparison.equal) {
    throw new Error(`scenario: replay diverged (${comparison.divergences.length} divergence(s))`);
  }
  const verdict = verifyLatticeReplay(composition, sealed);

  const schedule = deriveStreamingSchedule(composition.model, plannedWaypoints(), composition.graph.resolver);
  const view = readStreamingView(world);
  const stats: LatticeScenarioStats = {
    ...view,
    finalResidentCount: view.resident.length,
    dormantCount: dormantChunkIds(world).length,
    tick: Number(session.view().tick),
  };
  return {
    composition,
    session,
    commands: [...pre, ...post],
    boundary,
    postBoundaryEvents,
    allEvents,
    sealed,
    comparison,
    verdict,
    schedule,
    stats,
  };
}
