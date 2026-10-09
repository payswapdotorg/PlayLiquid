/**
 * INJECTED PORTS of the Simulation Runtime (PL-014).
 *
 * The simulation kernel has NO wall-clock authority, NO ambient randomness
 * and NO IO (spec/architecture.md "Runtime": headless, reproducible,
 * resettable, snapshot-able, replayable, scalable). Everything the kernel
 * cannot own arrives through one of the ports defined here, each with an
 * in-memory deterministic fake (see fakes.ts):
 *
 * - {@link RngPort}         seeded, forkable deterministic randomness (E9);
 * - {@link ClockPort}       caller-supplied timestamps (never Date.now);
 * - {@link SnapshotStore}   content-addressed snapshot persistence;
 * - {@link PendingCommandQueue} the deterministic logical-time scheduler
 *   that owns which admitted commands are due at which tick.
 *
 * Async/stateful documentation (spec/worker-contract.md "Async/stateful
 * work"), binding for this package:
 *
 * - Mutable state owner: THE SIMULATION SESSION (session.ts) owns session
 *   phase, epoch, tick, the event log, the admitted-command table and the
 *   pending-command queue. Ports own only their own bookkeeping (the RNG
 *   stream position, the clock cursor, the snapshot table).
 * - Command admission: every state-mutating input enters through exactly
 *   one gate — `admitCommand` from @playliquid/runtime-contracts (E2).
 *   `act` (intent level) resolves through the capability boundary first
 *   (`resolveActionRequest`, lock 4/13/14); `submitRecordedCommand`
 *   (envelope level, the replay/QA re-execution entry) feeds the SAME gate
 *   with an envelope that was already broker-resolved when it was recorded.
 *   There is no second command channel.
 * - Event order: events are 1-based, gapless, per-session, with
 *   non-decreasing ticks (enforced by construction; checkable with the
 *   runtime-contracts order oracle via `checkEventStream`).
 * - Idempotency key: one act request = { scope: "action", actor, nonce:
 *   intentId }. Replays of the same key with the same payload fingerprint
 *   are duplicates; same key with a different fingerprint is a collision
 *   and is REFUSED (runtime-contracts classifyEncounter, E8).
 * - Stale-result rule: reset/restore advance the session epoch; anything
 *   produced under an older epoch is stale (runtime-contracts
 *   applyStaleResultRule).
 * - Replay/resume boundary: replay windows start at seq 1 or immediately
 *   after a persisted snapshot boundary (runtime-contracts
 *   validateReplayPlan) — enforced by `SimulationSession.replay` and by
 *   the replay record sealing in @playliquid/replay.
 * - Retry/cancellation semantics: out of scope for the pure kernel; the
 *   durable runner consumes runtime-contracts jobs.ts. The kernel's step
 *   is idempotent-free by construction: stepping is explicit and
 *   deterministic, so "retry" is "re-run the same deterministic inputs".
 */

import type { Digest, SessionId, SessionEpoch, SnapshotId, Tick, Timestamp } from "@playliquid/runtime-contracts";
import type { RuntimeCommandEnvelope } from "@playliquid/runtime-contracts";
import type { GameIRValue } from "@playliquid/game-ir";

/**
 * Serializable state of a seeded RNG stream. Hex-encoded so that snapshots
 * (which must be byte-stable) can carry it as plain data.
 */
export type RngState = string;

/**
 * The seeded randomness port (E9: reproducible seeds). Implementations MUST
 * be deterministic: the same seed (or the same restored state) always
 * produces the same stream. `fork` derives an independent sub-stream from
 * the CURRENT state plus a label WITHOUT advancing the parent — fork labels
 * must therefore be unique per derivation site (the kernel uses
 * `tick:<tick>` and `system:<systemId>` composition).
 */
export interface RngPort {
  /** Next raw draw as an unsigned 32-bit integer in [0, 2^32). */
  nextUint32(): number;
  /** Next draw mapped to a float64 in [0, 1), derived from nextUint32. */
  nextUniform(): number;
  /** Current stream position state (hex); capture for snapshots. */
  readonly state: RngState;
  /** Deterministic sub-stream derived from the current state + label. */
  fork(label: string): RngPort;
}

/**
 * The clock port. The simulation never reads a wall clock; timestamps used
 * on command envelopes are drawn from this port so that drivers (and tests)
 * control time completely.
 */
export interface ClockPort {
  now(): Timestamp;
}

/** One admitted command waiting for its due tick. */
export interface PendingCommand {
  readonly envelope: RuntimeCommandEnvelope<GameIRValue>;
  readonly assignedSeq: number;
  readonly dueTick: Tick;
}

/**
 * The deterministic logical-time scheduler port. Items become due at their
 * scheduled tick; `dueThrough` returns everything due at or before the given
 * tick in deterministic order (due tick, then admission sequence) and REMOVES
 * it from the queue; `snapshotPending` reads the full remaining table for
 * byte-stable snapshots. This is the "scheduler" of the no-wall-clock rule:
 * purely logical time, no timers.
 */
export interface PendingCommandQueue {
  schedule(command: PendingCommand): void;
  /** All commands with dueTick <= tick, removed from the queue. */
  dueThrough(tick: Tick): readonly PendingCommand[];
  /** Whether anything is scheduled at or before `tick`. */
  hasDueThrough(tick: Tick): boolean;
  /** The full remaining pending table, in deterministic order. */
  snapshotPending(): readonly PendingCommand[];
  /** Number of pending commands (any due tick). */
  readonly size: number;
}

/**
 * A persisted simulation snapshot artifact. This is the flat, structurally
 * portable shape consumed by restore, by replay records (packages/replay)
 * and by QA tooling: protocol metadata plus an opaque runtime payload.
 *
 * The {@link SimulationSnapshotPayload} carries the actual state; it is
 * kept `unknown` here so the platform replay primitive can move artifacts
 * without importing this package (structural compatibility).
 */
export interface SimulationSnapshot {
  readonly snapshotId: SnapshotId;
  readonly sessionId: SessionId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  /** Event log is complete and committed through this sequence. */
  readonly afterEventSeq: number;
  /** Digest of the canonical world-state form at this boundary. */
  readonly stateDigest: Digest;
  /** Byte-stable canonical form of the whole payload (the snapshot bytes). */
  readonly form: string;
  /** Runtime-specific structured payload (see snapshot.ts). */
  readonly payload: unknown;
}

/** Write/read port for content-addressed snapshots. */
export interface SnapshotStore {
  put(snapshot: SimulationSnapshot): void;
  get(snapshotId: string): SimulationSnapshot | undefined;
  list(sessionId: SessionId): readonly SimulationSnapshot[];
}

/**
 * The port bundle a simulation session needs — everything the session must
 * NOT own as ambient authority: the injected clock and the snapshot store.
 * (The RNG stream is seeded through `begin`/`load`/`reset` and restored from
 * snapshot state; the pending-command queue is internal session-owned
 * bookkeeping built on the deterministic scheduler port.)
 */
export interface SimulationSessionPorts {
  readonly clock: ClockPort;
  readonly snapshotStore: SnapshotStore;
}
