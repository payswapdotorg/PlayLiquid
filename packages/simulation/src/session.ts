/**
 * THE SIMULATION SESSION — headless runtime implementing the Experience
 * Protocol (lock 12: shared contracts, DISTINCT execution path — this class
 * performs no rendering, no input handling and no networking; it is the
 * reproducible, resettable, snapshot-able, replayable authority).
 *
 * The nine protocol operations map onto session methods exactly as
 * @playliquid/runtime-contracts experience.ts admits them for the
 * simulation role: `load` requires a determinism seed (E9); `act` is
 * admitted only while `running` (injected inputs during a controlled run).
 * Phase transitions follow the frozen session lifecycle table.
 *
 * Determinism contract (E9): given one game binding, one seed and one
 * ordered command stream, the session produces byte-identical event
 * streams and world digests on every run, on every machine. All time is
 * logical (ticks); wall-clock stamps come only from the injected clock.
 *
 * Mutable state owner: THIS SESSION owns phase, epoch, tick, the event log
 * (log.ts), the admitted-command table, the idempotency table and the
 * pending command queue. Consumers receive read models and observations
 * only. Pure mechanics live in admission.ts (act path + command
 * scheduling), continuation.ts (boundary adoption) and kernel.ts (tick
 * execution); public result types live in session-types.ts.
 *
 * Event log semantics: the log holds the events of the CURRENT run
 * lineage. `restore` rewinds the live session to a snapshot boundary — the
 * events after the boundary are re-produced by the deterministic
 * continuation (identical bytes by E9), which is exactly the
 * restore-then-continue == never-interrupted guarantee. Downstream
 * evidence artifacts (replay records, derived artifacts) are immutable
 * (E10) and are never rewritten by this class.
 *
 * Replay/QA re-execution entry: `submitRecordedCommand` re-admits a
 * previously recorded command envelope through the SAME canonical
 * admission gate (E2 — no second command channel) and schedules it for its
 * recorded due tick. `begin` / `beginFromSnapshot` initialize fresh sessions
 * at the origin or at a snapshot boundary WITHOUT advancing an epoch
 * (nothing is superseded on a fresh session), which lets recorded command
 * envelopes — carrying the epoch they were admitted under — re-admit
 * deterministically.
 */

import { admitExperienceOperation, asEventSequence, asSessionId, asTick } from "@playliquid/runtime-contracts";
import type {
  BudgetLedger,
  CapabilityGrant,
  CommandId,
  DeterminismSeed,
  EventStreamValidation,
  ExperienceObservation,
  IdempotencyKey,
  LoadOperation,
  ObserveOperation,
  ResetOperation,
  RestoreOperation,
  ReplayOperation,
  RuntimeCommandEnvelope,
  RuntimeEventEnvelope,
  RuntimeRoleKind,
  RuntimeSessionPhase,
  RuntimeSessionSnapshotView,
  SessionEpoch,
  SessionId,
  StepOperation,
  TerminateOperation,
  Tick,
} from "@playliquid/runtime-contracts";
import { EMPTY_BUDGET_LEDGER } from "@playliquid/runtime-contracts";
import type { GameEvent, GameIRValue } from "@playliquid/game-ir";
import { runKernelTicks, validateWorldSystems } from "./kernel.ts";
import { makeRng } from "./rng.ts";
import { makePendingCommandQueue } from "./fakes.ts";
import type { ClockPort, RngPort, SimulationSnapshot, SnapshotStore } from "./ports.ts";
import type { SimulationSessionPorts } from "./ports.ts";
import type { IdempotencyRecord } from "./snapshot.ts";
import { verifySnapshotArtifact } from "./snapshot.ts";
import { initialWorldState, worldStateDigest } from "./world.ts";
import type { WorldState } from "./world.ts";
import { SessionEventLog, evaluateReplayWindow } from "./log.ts";
import { admitIntent, admitAndScheduleCommand, checkSimulationLoad, idempotencyKeyString, intentIdempotencyKey } from "./admission.ts";
import { adoptSessionBoundary, sealSessionBoundary } from "./continuation.ts";
import type {
  AdvanceResult,
  BeginResult,
  LoadResult,
  ReplayWindowResult,
  ResetResult,
  RestoreResult,
  SimulationActInput,
  SimulationGameBinding,
  StepResult,
  SubmitResult,
  TerminateResult,
} from "./session-types.ts";

/** The single event kind used for lifecycle audit events. */
export const SESSION_TERMINATED_EVENT_KIND = "session.terminated";

/** The shared rejection arm shape of every protocol result union. */
interface ProtocolRejection {
  readonly status: "rejected";
  readonly code: string;
  readonly detail: string;
}

/** Builds the typed rejection arm of any protocol result union. */
function opRejected(code: string, detail: string): ProtocolRejection {
  return { status: "rejected", code, detail };
}

/**
 * The headless simulation session. Construct it with a game binding and
 * injected ports; drive it through the protocol methods.
 */
export class SimulationSession {
  readonly sessionId: SessionId;
  readonly role: RuntimeRoleKind = "simulation";

  private readonly binding: SimulationGameBinding;
  private readonly clock: ClockPort;
  private readonly store: SnapshotStore;
  private readonly queue = makePendingCommandQueue();
  private readonly log: SessionEventLog;

  private phase: RuntimeSessionPhase = "provisioning";
  private epoch: SessionEpoch;
  private tick: Tick;
  private seed: DeterminismSeed | undefined;
  private world: WorldState | undefined;
  private rng: RngPort | undefined;
  private readonly admittedCommandIds = new Set<CommandId>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private grants: readonly CapabilityGrant[];
  private ledger: BudgetLedger = EMPTY_BUDGET_LEDGER;

  constructor(input: {
    readonly sessionId: string;
    readonly binding: SimulationGameBinding;
    readonly ports: SimulationSessionPorts;
    readonly initialEpoch?: number;
  }) {
    const violations = validateWorldSystems(input.binding.systems);
    if (violations.length > 0) {
      throw new RangeError(`invalid world systems: ${violations.join("; ")}`);
    }
    this.sessionId = asSessionId(input.sessionId);
    this.binding = input.binding;
    this.clock = input.ports.clock;
    this.store = input.ports.snapshotStore;
    this.epoch = (input.initialEpoch ?? 1) as SessionEpoch;
    this.tick = asTick(0);
    this.grants = input.binding.grants;
    this.log = new SessionEventLog(this.sessionId);
  }

  // -------------------------------------------------------------------------
  // Read models
  // -------------------------------------------------------------------------

  /** Authoritative read model (what experiences observe). */
  view(): RuntimeSessionSnapshotView {
    return {
      sessionId: this.sessionId,
      phase: this.phase,
      role: this.role,
      epoch: this.epoch,
      tick: this.tick,
      committedEventSeq: this.log.committedSeq,
      admittedCommandSeq: this.admittedCommandIds.size,
    };
  }

  /** Current world state (undefined before load). */
  get worldState(): WorldState | undefined {
    return this.world;
  }

  /** Current world state digest (throws before load). */
  get currentWorldDigest(): string {
    if (this.world === undefined) throw new Error("session not loaded");
    return worldStateDigest(this.world);
  }

  /** Events held by the current run lineage (see class doc: restore rewinds). */
  get eventLog(): readonly RuntimeEventEnvelope<GameIRValue>[] {
    return this.log.entriesView;
  }

  /** The session's determinism seed (set at load/begin; recorded by replay). */
  get determinismSeed(): DeterminismSeed | undefined {
    return this.seed;
  }

  /** Runs the runtime-contracts order oracle over the current log. */
  checkEventStream(): EventStreamValidation {
    return this.log.checkEventStream([...this.admittedCommandIds]);
  }

  /** Replaces the grant table (host re-issues epoch-scoped grants). */
  setGrants(grants: readonly CapabilityGrant[]): void {
    this.grants = grants;
  }

  // -------------------------------------------------------------------------
  // Experience Protocol operations
  // -------------------------------------------------------------------------

  /** `load` — requires a determinism seed for the simulation role (E9). */
  load(operation: LoadOperation): LoadResult {
    const admission = admitExperienceOperation(this.role, this.phase, operation);
    if (admission.status === "rejected") return opRejected(admission.code, admission.detail);
    const check = checkSimulationLoad(operation, this.binding.game.gameDigest);
    if (check.status === "rejected") return opRejected(check.code, check.detail);
    const begun = this.begin(check.seed);
    if (begun.status === "rejected") return opRejected(begun.code, begun.detail);
    return { status: "loaded", sessionId: this.sessionId, epoch: begun.epoch, tick: begun.tick };
  }

  /**
   * `begin` — initialize at the origin (tick 0) with a seed. This is the
   * replay re-execution entry point; it emits NO events (the log contains
   * only game-semantic events plus the final termination audit event), so a
   * fresh re-execution reproduces the recorded stream exactly.
   */
  begin(seed: DeterminismSeed): BeginResult {
    if (this.phase !== "provisioning") {
      return {
        status: "rejected",
        code: "wrong-phase",
        detail: `begin admitted only in provisioning, session is ${this.phase}`,
      };
    }
    this.phase = "loading";
    this.seed = seed;
    this.rng = makeRng(seed);
    this.world = initialWorldState(this.binding.blueprint);
    this.tick = asTick(0);
    this.phase = "ready";
    return {
      status: "begun",
      epoch: this.epoch as number,
      tick: Number(this.tick),
      afterEventSeq: this.log.committedSeq,
      gameDigest: this.binding.game.gameDigest,
    };
  }

  /** `reset` — new world from the blueprint under a NEW seed; advances the epoch. */
  reset(operation: ResetOperation): ResetResult {
    const admission = admitExperienceOperation(this.role, this.phase, operation);
    if (admission.status === "rejected") return opRejected(admission.code, admission.detail);
    this.epoch = ((this.epoch as number) + 1) as SessionEpoch;
    this.seed = operation.seed;
    this.rng = makeRng(operation.seed);
    this.world = initialWorldState(this.binding.blueprint);
    this.tick = asTick(0);
    return { status: "reset", epoch: this.epoch as number };
  }

  /** `observe` — read model plus events after a cursor. */
  observe(operation: ObserveOperation): ExperienceObservation {
    const admission = admitExperienceOperation(this.role, this.phase, operation);
    if (admission.status === "rejected") {
      throw new Error(`observe rejected: ${admission.code} (${admission.detail})`);
    }
    return {
      sessionId: this.sessionId,
      role: this.role,
      phase: this.phase,
      epoch: this.epoch,
      tick: this.tick,
      events: this.log.readEvents(Number(operation.afterEventSeq)),
      nextCursor: asEventSequence(this.log.committedSeq),
    };
  }

  /** Convenience used by replay/QA: events after a cursor, envelopes only. */
  readEvents(afterEventSeq: number): readonly RuntimeEventEnvelope<GameIRValue>[] {
    return this.log.readEvents(afterEventSeq);
  }

  /** `act` — typed intent resolved through the capability boundary, then admitted. */
  act(operation: SimulationActInput, options?: { readonly grantId?: string }): SubmitResult {
    const admission = admitExperienceOperation(this.role, this.phase, operation);
    if (admission.status === "rejected") return opRejected(admission.code, admission.detail);
    if (this.phase !== "running") {
      return opRejected("act-requires-running-in-simulation", "simulation sessions inject inputs only while running");
    }
    const intent = operation.intent;
    const key: IdempotencyKey = intentIdempotencyKey(intent);
    const resolved = admitIntent({
      sessionId: this.sessionId,
      intent,
      grants: this.grants,
      capabilityIntentKinds: this.binding.capabilityIntentKinds,
      ledger: this.ledger,
      epoch: this.epoch,
      tick: this.tick,
      nextCommandSeq: this.admittedCommandIds.size + 1,
      clock: this.clock,
      grantId: options?.grantId,
      priorEncounter: this.idempotency.get(idempotencyKeyString(key)),
    });
    if (resolved.status === "rejected") return opRejected(resolved.code, resolved.detail);
    this.ledger = resolved.ledger;
    const submit = this.admitAndSchedule(resolved.command, asTick(Number(this.tick) + 1));
    if (submit.status === "rejected") {
      return submit;
    }
    this.idempotency.set(idempotencyKeyString(key), resolved.encounter);
    return submit;
  }

  /**
   * Replay/QA re-execution entry: re-admits a recorded command envelope
   * through the SAME canonical admission gate and schedules it for its
   * recorded due tick. No second command channel (E2).
   */
  submitRecordedCommand(envelope: RuntimeCommandEnvelope<GameIRValue>, dueTick: number): SubmitResult {
    if (this.phase !== "ready" && this.phase !== "running") {
      return opRejected("wrong-phase", `submit admitted in ready/running, session is ${this.phase}`);
    }
    if (!Number.isInteger(dueTick) || dueTick <= Number(this.tick)) {
      return opRejected("due-tick-in-past", `due tick ${dueTick} is not after the current tick ${Number(this.tick)}`);
    }
    return this.admitAndSchedule(envelope, asTick(dueTick));
  }

  /** `step` — advance a fixed number of ticks (batched deterministically). */
  step(operation: StepOperation): StepResult {
    const admission = admitExperienceOperation(this.role, this.phase, operation);
    if (admission.status === "rejected") return opRejected(admission.code, admission.detail);
    if (!Number.isInteger(operation.ticks) || operation.ticks < 1) {
      return opRejected("invalid-tick-count", `ticks must be a positive integer, got ${operation.ticks}`);
    }
    if (this.seed === undefined || this.rng === undefined || this.world === undefined) {
      return opRejected("determinism-required-for-simulation", "cannot step an unseeded session (load with a determinism seed first)");
    }
    const fromTick = Number(this.tick);
    this.phase = "running";
    const run = runKernelTicks({
      fromTick,
      ticks: operation.ticks,
      state: this.world,
      rng: this.rng,
      systems: this.binding.systems,
      dueThrough: (tick) => this.queue.dueThrough(tick).map((entry) => entry.envelope),
    });
    this.tick = asTick(run.toTick);
    this.world = run.state;
    for (const event of run.events) {
      this.log.emit(event);
    }
    return { status: "stepped", fromTick, toTick: run.toTick, emittedEvents: run.events.length };
  }

  /** Advance to exactly `tick` (refused if backwards). */
  advanceToTick(tick: number): AdvanceResult {
    if (!Number.isInteger(tick) || tick < 0) {
      return opRejected("invalid-tick", `tick must be a non-negative integer, got ${tick}`);
    }
    if (tick < Number(this.tick)) {
      return opRejected("tick-regression", `cannot advance to ${tick} below current ${Number(this.tick)}`);
    }
    const ticks = tick - Number(this.tick);
    if (ticks === 0) return { status: "advanced", toTick: tick };
    const result = this.step({ op: "step", sessionId: this.sessionId, ticks });
    if (result.status === "rejected") return opRejected(result.code, result.detail);
    return { status: "advanced", toTick: tick };
  }

  /** `snapshot` — seal the continuation state, content-addressed, byte-stable. */
  snapshot():
    | { readonly status: "snapshotted"; readonly snapshot: SimulationSnapshot }
    | { readonly status: "rejected"; readonly code: string; readonly detail: string } {
    const admission = admitExperienceOperation(this.role, this.phase, {
      op: "snapshot",
      sessionId: this.sessionId,
    });
    if (admission.status === "rejected") return opRejected(admission.code, admission.detail);
    if (this.rng === undefined || this.world === undefined) {
      return { status: "rejected", code: "not-loaded", detail: "nothing to snapshot before load" };
    }
    const artifact = sealSessionBoundary({
      sessionId: this.sessionId,
      epoch: this.epoch,
      tick: this.tick,
      rng: this.rng,
      world: this.world,
      committedSeq: this.log.committedSeq,
      admittedCommandIds: [...this.admittedCommandIds],
      idempotency: [...this.idempotency.values()],
      pending: this.queue.snapshotPending(),
    });
    this.store.put(artifact);
    return { status: "snapshotted", snapshot: artifact };
  }

  /** `restore` — live-session restore; advances the epoch (stale-result rule). */
  restore(operation: RestoreOperation): RestoreResult {
    const admission = admitExperienceOperation(this.role, this.phase, operation);
    if (admission.status === "rejected") return opRejected(admission.code, admission.detail);
    const artifact = this.store.get(operation.snapshotId);
    if (artifact === undefined) {
      return opRejected("unknown-snapshot", `no snapshot ${operation.snapshotId}`);
    }
    const verification = verifySnapshotArtifact(artifact);
    if (!verification.ok) return opRejected(verification.code, verification.detail);
    if (artifact.sessionId !== this.sessionId) {
      return opRejected("snapshot-wrong-session", "snapshot belongs to another session");
    }
    this.applyContinuation(artifact, this.seed);
    this.epoch = ((this.epoch as number) + 1) as SessionEpoch;
    return { status: "restored", snapshotId: artifact.snapshotId, epoch: this.epoch as number, tick: Number(this.tick) };
  }

  /**
   * Fresh-session initialization at a snapshot boundary (re-execution
   * entry): adopts the snapshot's epoch/tick/state/counters WITHOUT
   * advancing an epoch (nothing is superseded on a fresh session), so
   * recorded command envelopes re-admit under their original epoch. The
   * original determinism seed is supplied by the caller (from the replay
   * record's provenance) so `replay` windows and audits stay seed-checkable.
   */
  beginFromSnapshot(artifact: SimulationSnapshot, seed?: DeterminismSeed): BeginResult {
    if (this.phase !== "provisioning") {
      return opRejected("wrong-phase", `beginFromSnapshot admitted only in provisioning, session is ${this.phase}`);
    }
    const verification = verifySnapshotArtifact(artifact);
    if (!verification.ok) return opRejected(verification.code, verification.detail);
    this.applyContinuation(artifact, seed);
    return {
      status: "begun",
      epoch: this.epoch as number,
      tick: Number(this.tick),
      afterEventSeq: this.log.committedSeq,
      gameDigest: this.binding.game.gameDigest,
    };
  }

  /** `replay` — a validated window of the current run lineage's log. */
  replay(operation: ReplayOperation): ReplayWindowResult {
    const admission = admitExperienceOperation(this.role, this.phase, operation);
    if (admission.status === "rejected") return opRejected(admission.code, admission.detail);
    if (this.seed === undefined) {
      return opRejected("seed-mismatch", "session has no determinism seed");
    }
    const plan = evaluateReplayWindow({
      sessionId: this.sessionId,
      role: this.role,
      epoch: this.epoch,
      seed: this.seed,
      fromEventSeq: operation.fromEventSeq,
      toEventSeq: operation.toEventSeq,
      committedHeadSeq: this.log.committedSeq,
      snapshots: this.store.list(this.sessionId),
    });
    if (!plan.ok) return opRejected(plan.code, plan.detail);
    const from = plan.fromSeq;
    const to = plan.toSeq ?? this.log.committedSeq;
    return {
      status: "replayed",
      events: this.log.window(from, to),
      fromSeq: from,
      toSeq: plan.toSeq,
    };
  }

  /** `terminate` — graceful termination; emits the final audit event. */
  terminate(operation: TerminateOperation): TerminateResult {
    const admission = admitExperienceOperation(this.role, this.phase, operation);
    if (admission.status === "rejected") return opRejected(admission.code, admission.detail);
    this.phase = "terminating";
    this.log.emit({
      event: {
        type: SESSION_TERMINATED_EVENT_KIND as GameEvent["type"],
        payload: { kind: "record", fields: { reason: { kind: "string", value: operation.reason } } },
        tick: this.tick,
      },
      cause: { kind: "system" },
    });
    this.phase = "terminated";
    return { status: "terminated", finalEventSeq: this.log.committedSeq };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private admitAndSchedule(envelope: RuntimeCommandEnvelope<GameIRValue>, dueTick: Tick): SubmitResult {
    return admitAndScheduleCommand({
      view: this.view(),
      policy: this.binding.commandPolicy,
      envelope,
      dueTick,
      queue: this.queue,
      admittedCommandIds: this.admittedCommandIds,
    });
  }

  /** Adopts a verified artifact: phase transition + continuation fields. */
  private applyContinuation(artifact: SimulationSnapshot, seed: DeterminismSeed | undefined): void {
    this.phase = "loading";
    const adopted = adoptSessionBoundary(artifact, seed, {
      log: this.log,
      queue: this.queue,
      admittedCommandIds: this.admittedCommandIds,
      idempotency: this.idempotency,
    });
    this.epoch = adopted.epoch;
    this.tick = adopted.tick;
    this.rng = adopted.rng;
    this.world = adopted.world;
    if (adopted.seed !== undefined) {
      this.seed = adopted.seed;
    }
    this.phase = "ready";
  }
}
