/**
 * THE EXPERIENCE PROTOCOL (lock rule 12).
 *
 * The Interactive Runtime and the Simulation Runtime are distinct execution
 * paths that consume the SAME protocol defined here: load, reset, observe,
 * act, step, snapshot, restore, replay, terminate (spec/architecture.md,
 * "Runtime"). The shared contract shapes are identical; where the two roles
 * legitimately differ, the difference is expressed as explicit, typed
 * admission data (never as a second protocol):
 *
 * - simulation sessions MUST load with a determinism seed (E9); interactive
 *   sessions may load unseeded (live play);
 * - `act` is admitted in `ready` only for interactive sessions (a player can
 *   act as soon as the world is up), while simulation sessions admit `act`
 *   only in `running` (injected inputs during a controlled run).
 *
 * Lock rule 13 (AI emits typed intents; authoritative systems own state
 * mutation): the `act` operation carries a {@link TypedIntent}, which is a
 * PROPOSAL. It is not a command and carries no mutation authority; it only
 * becomes a canonical command through the Capability Broker
 * (capability.ts) and the admission gate (commands.ts).
 */

import type {
  ActorRef,
  DeterminismSeed,
  EventSequence,
  IntentId,
  IntentKind,
  SessionEpoch,
  SessionId,
  SnapshotId,
  TargetProfileId,
  Tick,
  Timestamp,
} from "./primitives.ts";
import type { RuntimeEventEnvelope } from "./events.ts";
import type { GameIrDigest, GameRefSummary } from "./game-ir-seam.ts";
import type { RuntimeRoleKind, RuntimeSessionPhase } from "./session.ts";

/** A typed, authority-free proposal emitted by an intelligence (lock 13). */
export interface TypedIntent<P = unknown> {
  readonly intentId: IntentId;
  readonly kind: IntentKind;
  readonly actor: ActorRef;
  readonly payload: P;
  readonly issuedAt: Timestamp;
}

/** Discriminator union of the nine Experience Protocol operations. */
export type ExperienceOperationKind =
  | "load"
  | "reset"
  | "observe"
  | "act"
  | "step"
  | "snapshot"
  | "restore"
  | "replay"
  | "terminate";

/** Load a pinned game composition into the session. */
export interface LoadOperation {
  readonly op: "load";
  readonly sessionId: SessionId;
  readonly game: GameRefSummary;
  readonly role: RuntimeRoleKind;
  readonly determinism?: DeterminismSeed;
  readonly targetProfile?: TargetProfileId;
}

/** Reset the session world; advances the session epoch. */
export interface ResetOperation {
  readonly op: "reset";
  readonly sessionId: SessionId;
  readonly seed: DeterminismSeed;
}

/** Request the current observation (read model + new events). */
export interface ObserveOperation {
  readonly op: "observe";
  readonly sessionId: SessionId;
  /** Only events with seq > afterEventSeq are returned. */
  readonly afterEventSeq: EventSequence;
}

/** Submit a typed intent for capability-mediated evaluation. */
export interface ActOperation {
  readonly op: "act";
  readonly sessionId: SessionId;
  readonly intent: TypedIntent;
}

/** Advance simulation time (both roles step; semantics per runtime). */
export interface StepOperation {
  readonly op: "step";
  readonly sessionId: SessionId;
  readonly ticks: number;
}

/** Persist a content-addressed snapshot at the current boundary. */
export interface SnapshotOperation {
  readonly op: "snapshot";
  readonly sessionId: SessionId;
}

/** Restore from a snapshot; advances the session epoch. */
export interface RestoreOperation {
  readonly op: "restore";
  readonly sessionId: SessionId;
  readonly snapshotId: SnapshotId;
}

/** Replay a validated window of the immutable event log (see replay.ts). */
export interface ReplayOperation {
  readonly op: "replay";
  readonly sessionId: SessionId;
  readonly fromEventSeq: EventSequence;
  readonly toEventSeq: EventSequence | null;
}

/** Graceful termination; session enters `terminating` then `terminated`. */
export interface TerminateOperation {
  readonly op: "terminate";
  readonly sessionId: SessionId;
  readonly reason: string;
}

export type ExperienceOperation =
  | LoadOperation
  | ResetOperation
  | ObserveOperation
  | ActOperation
  | StepOperation
  | SnapshotOperation
  | RestoreOperation
  | ReplayOperation
  | TerminateOperation;

/** What an experience receives: read models and events, never authority. */
export interface ExperienceObservation {
  readonly sessionId: SessionId;
  readonly role: RuntimeRoleKind;
  readonly phase: RuntimeSessionPhase;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  readonly events: readonly RuntimeEventEnvelope[];
  readonly nextCursor: EventSequence;
}

/** Per-role, per-phase admission table for the nine operations. */
type PhaseSet = readonly RuntimeSessionPhase[];

const LIVE_PHASES: PhaseSet = ["ready", "running", "suspended"];

const OP_PHASES: Readonly<Record<ExperienceOperationKind, PhaseSet>> = {
  load: ["provisioning"],
  reset: LIVE_PHASES,
  observe: LIVE_PHASES,
  act: ["ready", "running"],
  step: ["ready", "running"],
  snapshot: LIVE_PHASES,
  restore: ["ready", "running", "suspended"],
  replay: LIVE_PHASES,
  terminate: ["provisioning", "loading", "ready", "running", "suspended", "terminating"],
};

/** Reason an experience operation was not admitted. */
export type ExperienceRejectionCode =
  | "wrong-phase"
  | "act-requires-running-in-simulation"
  | "determinism-required-for-simulation"
  | "unknown-operation";

/** Pure admission result for experience operations. */
export type ExperienceAdmissionResult =
  | { readonly status: "admitted"; readonly op: ExperienceOperationKind }
  | { readonly status: "rejected"; readonly code: ExperienceRejectionCode; readonly detail: string };

/**
 * Pure operation admission, shared by both runtimes with the two documented
 * role differences (see module doc). Lock rule 12 in action: same semantics,
 * distinct execution — encoded as typed admission data, not as a forked
 * protocol.
 */
export function admitExperienceOperation(
  role: RuntimeRoleKind,
  phase: RuntimeSessionPhase,
  operation: ExperienceOperation,
): ExperienceAdmissionResult {
  const allowed = OP_PHASES[operation.op];
  if (allowed === undefined) {
    return { status: "rejected", code: "unknown-operation", detail: `unknown op ${String(operation.op)}` };
  }
  if (!allowed.includes(phase)) {
    return {
      status: "rejected",
      code: "wrong-phase",
      detail: `op ${operation.op} not admitted in phase ${phase}`,
    };
  }
  if (operation.op === "act" && role === "simulation" && phase !== "running") {
    return {
      status: "rejected",
      code: "act-requires-running-in-simulation",
      detail: "simulation sessions inject inputs only while running",
    };
  }
  return { status: "admitted", op: operation.op };
}

/** Pure load-request validation (E9 determinism for simulation role). */
export type LoadValidationResult =
  | { readonly ok: true; readonly role: RuntimeRoleKind; readonly gameDigest: GameIrDigest }
  | { readonly ok: false; readonly code: "determinism-required-for-simulation" | "invalid-world-ref" };

export function validateLoadRequest(operation: LoadOperation): LoadValidationResult {
  if (operation.role === "simulation" && operation.determinism === undefined) {
    return {
      ok: false,
      code: "determinism-required-for-simulation",
    };
  }
  if (operation.game.world.revisionDigest.length !== 64) {
    return { ok: false, code: "invalid-world-ref" };
  }
  return {
    ok: true,
    role: operation.role,
    gameDigest: operation.game.gameDigest,
  };
}

