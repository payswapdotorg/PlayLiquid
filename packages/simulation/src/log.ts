/**
 * THE SESSION EVENT LOG AUTHORITY (E2 event side, E10 discipline).
 *
 * The event log is the session's canonical observable history: 1-based,
 * gapless, per-session sequence numbers with non-decreasing ticks and
 * explicit causal provenance. THIS class is its single owner inside a
 * simulation session — events are appended via {@link emit} and are never
 * rewritten or reordered (requirement E10 applies downstream; there is
 * deliberately no mutation API beyond the restore-boundary rewind, which
 * rewinds the LIVE lineage only — historical artifacts are immutable).
 *
 * The restore rewind semantics: `restore`/`beginFromSnapshot` adopt a
 * snapshot boundary — the sequence counter jumps to the boundary's
 * `afterEventSeq` and the in-memory entries are truncated to that boundary.
 * The deterministic continuation then re-produces the post-boundary events
 * with identical sequence numbers and bytes (E9), which is exactly the
 * restore-then-continue == never-interrupted guarantee the session asserts.
 *
 * Pure bookkeeping: no IO, no clocks, no randomness.
 */

import { asEventId, asEventKind, asEventSequence, asSnapshotId, asTick, validateEventStream, validateReplayPlan } from "@playliquid/runtime-contracts";
import type {
  CommandId,
  DeterminismSeed,
  EventSequence,
  EventStreamValidation,
  ReplayPlanValidation,
  RuntimeEventEnvelope,
  RuntimeRoleKind,
  SessionEpoch,
  SessionId,
} from "@playliquid/runtime-contracts";
import type { GameIRValue } from "@playliquid/game-ir";
import type { EmittedEvent } from "./kernel.ts";
import type { SimulationSnapshot } from "./ports.ts";

/** The per-session event log owned by one {@link SimulationSession}. */
export class SessionEventLog {
  private readonly entries: RuntimeEventEnvelope<GameIRValue>[] = [];
  private committed = 0;

  private readonly sessionId: SessionId;

  constructor(sessionId: SessionId) {
    this.sessionId = sessionId;
  }

  /**
   * Appends one event envelope: assigns the next gapless sequence number,
   * derives the deterministic event id (`evt-<seq>`) and stamps the session
   * identity. The input carries the game-semantic event plus its cause.
   */
  emit(emitted: EmittedEvent): void {
    this.committed += 1;
    const envelope: RuntimeEventEnvelope<GameIRValue> = {
      eventId: asEventId(`evt-${this.committed}`),
      sessionId: this.sessionId,
      kind: asEventKind(String(emitted.event.type)),
      seq: asEventSequence(this.committed),
      tick: asTick(emitted.event.tick),
      cause: emitted.cause,
      payload: emitted.event.payload,
    };
    this.entries.push(envelope);
  }

  /** Events with sequence number strictly greater than `afterEventSeq`. */
  readEvents(afterEventSeq: number): readonly RuntimeEventEnvelope<GameIRValue>[] {
    return this.entries.filter((event) => Number(event.seq) > afterEventSeq);
  }

  /**
   * The [fromSeq, toSeq] window (inclusive bounds, absolute sequence
   * numbers). On a fresh session begun from a snapshot boundary the log's
   * first entry starts AFTER the boundary; the base offset arithmetic keeps
   * absolute windows correct in both the origin and boundary cases.
   */
  window(fromSeq: number, toSeq: number): readonly RuntimeEventEnvelope<GameIRValue>[] {
    const logBase = this.committed - this.entries.length;
    return this.entries.slice(fromSeq - 1 - logBase, toSeq - logBase);
  }

  /**
   * Adopts a snapshot boundary: the sequence counter continues from
   * `afterEventSeq` and any entries past the boundary are dropped (they
   * belong to a superseded lineage segment; the deterministic continuation
   * re-produces them identically).
   */
  rewindTo(afterEventSeq: number): void {
    this.committed = afterEventSeq;
    this.entries.length = Math.min(this.entries.length, afterEventSeq);
  }

  /** Runs the runtime-contracts order oracle over the current entries. */
  checkEventStream(admittedCommandIds: readonly CommandId[]): EventStreamValidation {
    if (this.entries.length === 0) {
      return { ok: false, code: "empty-stream", index: 0, detail: "no events committed yet" };
    }
    return validateEventStream(this.entries, { admittedCommandIds: [...admittedCommandIds] });
  }

  /** Number of events currently held by this (live-lineage) log. */
  get length(): number {
    return this.entries.length;
  }

  /** Last committed sequence number (0 before any event; a boundary value
   * after a rewind/begin-from-snapshot). */
  get committedSeq(): number {
    return this.committed;
  }

  /** Read-only view of the current entries (the session's `eventLog`). */
  get entriesView(): readonly RuntimeEventEnvelope<GameIRValue>[] {
    return this.entries;
  }
}

/** Inputs of {@link evaluateReplayWindow}: the session's replay posture. */
export interface ReplayWindowInput {
  readonly sessionId: SessionId;
  readonly role: RuntimeRoleKind;
  readonly epoch: SessionEpoch;
  readonly seed: DeterminismSeed;
  readonly fromEventSeq: EventSequence;
  readonly toEventSeq: EventSequence | null;
  readonly committedHeadSeq: number;
  /** Persisted snapshot boundaries of this session (read model). */
  readonly snapshots: readonly SimulationSnapshot[];
}

/**
 * Pure replay-plan evaluation over the runtime-contracts boundary oracle
 * (lock 15): a window is legal only from seq 1 or immediately after a
 * persisted snapshot boundary, and the seed must be the session's own.
 */
export function evaluateReplayWindow(input: ReplayWindowInput): ReplayPlanValidation {
  return validateReplayPlan(
    {
      sessionId: input.sessionId,
      fromEventSeq: input.fromEventSeq,
      toEventSeq: input.toEventSeq,
      determinism: input.seed,
    },
    {
      snapshots: input.snapshots.map((snapshot) => ({
        snapshotId: asSnapshotId(snapshot.snapshotId),
        sessionId: snapshot.sessionId,
        epoch: snapshot.epoch,
        tick: snapshot.tick,
        afterEventSeq: asEventSequence(snapshot.afterEventSeq),
        stateDigest: snapshot.stateDigest,
      })),
      role: input.role,
      sessionDeterminism: input.seed,
      committedHeadSeq: asEventSequence(input.committedHeadSeq),
      sessionEpoch: input.epoch,
    },
  );
}
