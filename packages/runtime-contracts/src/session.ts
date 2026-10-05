/**
 * Runtime session contract: lifecycle, phases and epoch semantics.
 *
 * Async/stateful documentation (spec/worker-contract.md "Async/stateful
 * work"), binding for this module:
 *
 * - Mutable state owner: THE AUTHORITATIVE RUNTIME owns all session state
 *   (phase, epoch, sequences). Experiences (clients, UIs, simulation drivers)
 *   receive read models and observations; they never own session state.
 * - Command admission: see commands.ts (`admitCommand`); admission is the
 *   only door into the canonical command path.
 * - Event order: see events.ts (`validateEventStream`); events are 1-based,
 *   gapless, per-session.
 * - Replay/resume boundary: see replay.ts.
 *
 * Purity: transition validation is a pure function over a frozen transition
 * table. This module never mutates anything and performs no IO.
 */

import type {
  SessionEpoch,
  SessionId,
  TargetProfileId,
  Tick,
  Timestamp,
} from "./primitives.ts";
import { asSessionEpoch } from "./primitives.ts";
import type { DeterminismSeed } from "./primitives.ts";
import type { GameRefSummary } from "./game-ir-seam.ts";

/**
 * Lifecycle phases of a runtime session. Both the Interactive Runtime and
 * the Simulation Runtime implement the SAME phase machine (lock rule 12:
 * shared semantic contracts, distinct execution paths).
 */
export type RuntimeSessionPhase =
  | "provisioning" // descriptor admitted; world not yet loaded
  | "loading" // load operation in flight
  | "ready" // loaded; not stepping; accepts observe/snapshot/act(interactive)
  | "running" // stepping / live; accepts act/step/observe/snapshot
  | "suspended" // paused; resumable via restore/step; keeps snapshot
  | "terminating" // graceful termination in flight (drain events)
  | "terminated" // final: normal end
  | "failed"; // final: unrecoverable error

/** Phases from which no further transition is possible. */
export const TERMINAL_SESSION_PHASES: readonly RuntimeSessionPhase[] = [
  "terminated",
  "failed",
] as const;

/** Whether `phase` admits no further transitions. */
export function isTerminalSessionPhase(phase: RuntimeSessionPhase): boolean {
  return TERMINAL_SESSION_PHASES.includes(phase);
}

/**
 * Frozen lifecycle transition table.
 * Key: from-phase. Value: set of legal to-phases.
 * `load` moves provisioning -> loading; the runtime itself reports
 * loading -> ready (or loading -> failed). `reset`/`restore` return a live
 * session to `ready` and advance the session epoch.
 */
const SESSION_PHASE_TRANSITIONS: Readonly<
  Record<RuntimeSessionPhase, readonly RuntimeSessionPhase[]>
> = {
  provisioning: ["loading", "failed", "terminated"],
  loading: ["ready", "failed", "terminated"],
  ready: ["running", "suspended", "ready", "terminating", "terminated", "failed"],
  running: ["ready", "suspended", "terminating", "terminated", "failed"],
  suspended: ["ready", "running", "terminating", "terminated", "failed"],
  terminating: ["terminated", "failed"],
  terminated: [],
  failed: [],
};

/** Result of a pure phase-transition check. */
export type PhaseTransitionResult =
  | { readonly ok: true; readonly from: RuntimeSessionPhase; readonly to: RuntimeSessionPhase }
  | {
      readonly ok: false;
      readonly code: "illegal-phase-transition";
      readonly from: RuntimeSessionPhase;
      readonly to: RuntimeSessionPhase;
      readonly reason: string;
    };

/** Pure check: is `from -> to` a legal session lifecycle transition? */
export function checkSessionPhaseTransition(
  from: RuntimeSessionPhase,
  to: RuntimeSessionPhase,
): PhaseTransitionResult {
  const legal = SESSION_PHASE_TRANSITIONS[from];
  if (legal !== undefined && legal.includes(to)) {
    return { ok: true, from, to };
  }
  return {
    ok: false,
    code: "illegal-phase-transition",
    from,
    to,
    reason: `session lifecycle forbids ${from} -> ${to}`,
  };
}

/**
 * Which runtime implementation executes this session. Lock rule 12: the two
 * runtimes are DISTINCT execution paths that consume the SAME Experience
 * Protocol (see experience.ts). The kind affects admission details only,
 * never the shape of the shared contracts.
 */
export type RuntimeRoleKind = "interactive" | "simulation";

/**
 * Declarative description of one runtime session. Immutable data; the
 * authoritative runtime instantiates session state from it.
 */
export interface RuntimeSessionDescriptor {
  readonly sessionId: SessionId;
  readonly game: GameRefSummary;
  readonly role: RuntimeRoleKind;
  /**
   * Reproducibility seed (requirement E9). REQUIRED for simulation sessions
   * (validated by experience.ts `validateLoadRequest`); interactive sessions
   * may run unseeded (live play) — a difference in admission, not in the
   * shared contract shapes.
   */
  readonly determinism?: DeterminismSeed;
  /** Target profile the experience renders through (e.g. `spark`). */
  readonly targetProfile?: TargetProfileId;
  /** When the session was provisioned (caller-supplied; no clock IO here). */
  readonly provisionedAt: Timestamp;
  /** Initial epoch; always 1 in practice. */
  readonly initialEpoch: SessionEpoch;
}

/** Convenience constructor enforcing the invariant epoch >= 1. */
export function makeSessionDescriptor(
  input: Omit<RuntimeSessionDescriptor, "initialEpoch"> & { initialEpoch?: number },
): RuntimeSessionDescriptor {
  const epoch = input.initialEpoch === undefined ? 1 : input.initialEpoch;
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new RangeError("initialEpoch must be a safe integer >= 1");
  }
  return { ...input, initialEpoch: asSessionEpoch(epoch) };
}

/**
 * Authoritative session state READ MODEL (what experiences observe). The
 * authoritative runtime is the single owner and mutator of this state.
 */
export interface RuntimeSessionSnapshotView {
  readonly sessionId: SessionId;
  readonly phase: RuntimeSessionPhase;
  readonly role: RuntimeRoleKind;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  /** Last committed event sequence number (0 before any event). */
  readonly committedEventSeq: number;
  /** Last admitted command sequence number (0 before any command). */
  readonly admittedCommandSeq: number;
}

/**
 * Epoch semantics: `reset` and `restore` advance the session epoch. Anything
 * produced (or in flight) under an older epoch becomes stale — see
 * idempotency.ts `applyStaleResultRule`. Pure helper used by validators.
 */
export function nextSessionEpoch(current: SessionEpoch): SessionEpoch {
  const n = current + 1;
  if (!Number.isSafeInteger(n)) {
    throw new RangeError("session epoch overflow");
  }
  return asSessionEpoch(n);
}
