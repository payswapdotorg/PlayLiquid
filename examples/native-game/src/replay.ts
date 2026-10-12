/**
 * LUMEN RUN — the replay capture + deterministic re-execution (PL-037; R8,
 * lock rule 15: replay is a platform primitive).
 *
 * The playthrough's own session is captured through @playliquid/replay's
 * content-addressed artifacts (command stream + event witness + replay
 * record, each sealed by the package's own authorities — nothing here
 * re-implements sealing or verification), and RE-EXECUTED through the
 * replay engine (`reExecuteReplay`) over a ReplayTargetSession ADAPTER
 * that re-admits every recorded command through the SAME Interactive
 * Runtime kernel the live run used (E2: one canonical command path —
 * the adapter derives intents from the recorded envelopes and lets the
 * kernel re-derive the commands; it never injects state).
 *
 * Determinism (E9): same seed + same recorded stream ⇒ byte-identical
 * event streams. The reference verifier (R11) compares recorded vs
 * re-executed canonical event bytes and reports the typed verdict with
 * its honest coverage confidence.
 *
 * Environment limitation: the replay store is the package's in-memory
 * fake (a test double from @playliquid/replay itself — no durable
 * artifact storage here).
 */

import type { GameIRDocument, GameIRValue } from "../../../packages/game-ir/src/index.ts";
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
  ReplayTargetSession,
} from "../../../packages/replay/src/index.ts";
import { asDeterminismSeed, asIntentId, asIntentKind, asSessionId, asTimestamp } from "../../../packages/runtime-contracts/src/index.ts";
import type { RuntimeEventEnvelope } from "../../../packages/runtime-contracts/src/index.ts";
import { companionGrant, createLumenSession, gameRefOf } from "./session.ts";
import type { LumenSession } from "./session.ts";
import { CANONICAL_SEED, SESSION_ID } from "./ids.ts";
import { toWire } from "./events.ts";

/** What one canonical capture seals (all content-addressed, E9/E10). */
export interface SealedReplay {
  readonly record: ReplayRecord;
  readonly stream: CommandStreamArtifact;
  readonly witness: EventWitnessArtifact;
  readonly store: ReplaySource;
}

/**
 * Seals the playthrough's capture: the post-boundary commands, the
 * post-boundary game events and the immutable record tying them to the
 * session's seed and snapshot boundary (R8). The record's game reference
 * is the digest-pinned GameRefSummary of the same document the session
 * ran (never a placeholder).
 */
export function sealCanonicalReplay(input: {
  readonly document: GameIRDocument;
  readonly events: readonly RuntimeEventEnvelope<GameIRValue>[];
  readonly commands: readonly RecordedCommand[];
  readonly boundary: { readonly afterEventSeq: number; readonly tick: number; readonly snapshotId: string; readonly formDigest: string; readonly artifact: unknown };
  readonly toEventSeq: number;
  readonly toTick: number;
}): SealedReplay {
  const stream = sealCommandStream(input.commands);
  const witness = sealEventWitness(input.events);
  const store = new InMemoryReplayStore();
  store.putCommandStream(stream);
  store.putEventWitness(witness);
  const record = sealReplayRecord({
    sessionId: asSessionId(SESSION_ID),
    game: gameRefOf(input.document),
    determinism: asDeterminismSeed(CANONICAL_SEED),
    capture: {
      fromEventSeq: input.boundary.afterEventSeq + 1,
      toEventSeq: input.toEventSeq,
      toTick: input.toTick,
      boundary: {
        snapshotId: input.boundary.snapshotId,
        formDigest: input.boundary.formDigest,
        afterEventSeq: input.boundary.afterEventSeq,
        tick: input.boundary.tick,
        artifact: input.boundary.artifact,
      },
    },
    commandStream: stream.streamDigest,
    eventWitness: witness.witnessDigest,
    provenance: {
      capturedBy: "examples/native-game lumen-run harness",
      capturedAt: asTimestamp(1_200),
      runtimeRole: "interactive",
      tool: "native-game/1.0",
      consumers: ["player", "qa", "integrity"],
    },
  });
  store.putReplay(record);
  return { record, stream, witness, store };
}

// ---------------------------------------------------------------------------
// The re-execution target (an Interactive Runtime session adapter)
// ---------------------------------------------------------------------------

/**
 * The replay target launcher: starts fresh re-execution sessions of this
 * game. `launchAtBoundary` re-executes the deterministic prologue the
 * boundary summarizes (load → reset under the record's seed → advance to
 * the boundary tick) and verifies the kernel's committed event seq
 * matches the recorded boundary before adopting it — an honest boundary,
 * never a forged one.
 */
export function createLumenReplayLauncher(document: GameIRDocument): ReplayTargetLauncher {
  const launch = (sessionId: string, seed: string): LumenSession => {
    const session = createLumenSession({ document, seed, sessionId });
    const load = session.kernel.load();
    if (load.status !== "loaded") throw new Error(`replay target: load refused: ${String(load.status)}`);
    return session;
  };
  return {
    launchAtOrigin(input) {
      const session = launch(String(input.sessionId), String(input.seed));
      return {
        status: "launched",
        session: lumenTarget(session),
        afterEventSeq: session.kernel.view().committedEventSeq,
        tick: Number(session.kernel.view().tick),
      };
    },
    launchAtBoundary(input) {
      const session = launch(String(input.sessionId), String(input.seed));
      const reset = session.kernel.reset(input.seed);
      if (reset.status !== "reset") {
        return { status: "rejected", code: "boundary-reset-refused", detail: `replay target could not adopt the boundary epoch (${String(reset.status)})` };
      }
      session.capabilityPort.issueGrant(companionGrant(String(input.sessionId), reset.epoch));
      const boundaryTick = input.boundary.tick;
      if (boundaryTick > 0) {
        const advance = session.kernel.step(boundaryTick);
        if (advance.status !== "stepped") {
          return { status: "rejected", code: "boundary-advance-refused", detail: `replay target could not advance to boundary tick ${String(boundaryTick)}` };
        }
      }
      const committed = session.kernel.view().committedEventSeq;
      if (committed !== input.boundary.afterEventSeq) {
        return {
          status: "rejected",
          code: "boundary-seq-mismatch",
          detail: `replay target committed seq ${String(committed)} does not match the recorded boundary ${String(input.boundary.afterEventSeq)}`,
        };
      }
      return { status: "launched", session: lumenTarget(session), afterEventSeq: committed, tick: boundaryTick };
    },
  };
}

/**
 * Adapts one interactive session to the replay engine's target port: every
 * recorded command re-enters through `act` (the kernel re-derives the
 * canonical command; the adapter refuses any divergence between the
 * re-derived command id and the recorded one — E2/E9 discipline).
 */
function lumenTarget(session: LumenSession): ReplayTargetSession {
  return {
    sessionId: session.descriptor.sessionId,
    submitRecordedCommand(envelope, dueTick) {
      const view = session.kernel.view();
      if (dueTick < Number(view.tick)) {
        return { status: "rejected", code: "due-tick-in-past", detail: `command ${String(envelope.commandId)} due at tick ${String(dueTick)} but the session is at ${String(view.tick)}` };
      }
      if (dueTick > Number(view.tick)) {
        const advance = session.kernel.step(dueTick - Number(view.tick));
        if (advance.status !== "stepped") {
          return { status: "rejected", code: "advance-refused", detail: `could not advance to due tick ${String(dueTick)}` };
        }
      }
      const result = session.kernel.act({
        intent: {
          intentId: asIntentId(String(envelope.commandId)),
          kind: asIntentKind(String(envelope.kind)),
          actor: envelope.actor,
          payload: toWire(envelope.payload),
          issuedAt: envelope.issuedAt,
        },
        nonce: envelope.idempotencyKey.nonce,
        ...(envelope.origin.kind === "broker-mediated" ? { grantId: envelope.origin.grantId } : {}),
      });
      if (result.status !== "committed") {
        return { status: "rejected", code: `act-${result.status}`, detail: `command ${String(envelope.commandId)} was not re-committed (${result.status})` };
      }
      if (result.commandId !== envelope.commandId) {
        return {
          status: "rejected",
          code: "command-id-divergence",
          detail: `re-derived command id ${String(result.commandId)} differs from the recorded ${String(envelope.commandId)}`,
        };
      }
      return { status: "submitted" };
    },
    advanceToTick(tick) {
      const view = session.kernel.view();
      if (tick < Number(view.tick)) {
        return { status: "rejected", code: "tick-regression", detail: `cannot advance backwards from ${String(view.tick)} to ${String(tick)}` };
      }
      if (tick === Number(view.tick)) return { status: "advanced" };
      const advance = session.kernel.step(tick - Number(view.tick));
      if (advance.status !== "stepped") {
        return { status: "rejected", code: "advance-refused", detail: `could not advance to tick ${String(tick)}` };
      }
      return { status: "advanced" };
    },
    readEvents(afterEventSeq) {
      const observation = session.kernel.observe(afterEventSeq);
      if (observation.status !== "observed") {
        throw new Error(`replay target: observe refused: ${String(observation.status)}`);
      }
      return observation.observation.events as readonly RuntimeEventEnvelope<GameIRValue>[];
    },
  };
}

/**
 * Runs the reference integrity verifier (R11) over a sealed replay:
 * re-executes the record and compares recorded vs re-executed canonical
 * event bytes at every sampled position. Pure over its inputs.
 */
export function verifySealedReplay(document: GameIRDocument, sealed: SealedReplay): IntegrityVerdict {
  return createReferenceIntegrityVerifier().verify({
    replayId: sealed.record.replayId,
    source: sealed.store,
    launcher: createLumenReplayLauncher(document),
  });
}

/** The raw engine comparison view (recorded vs re-executed, typed result). */
export function compareSealedReplay(document: GameIRDocument, sealed: SealedReplay) {
  return reExecuteReplay({ replayId: sealed.record.replayId, source: sealed.store, launcher: createLumenReplayLauncher(document) });
}
