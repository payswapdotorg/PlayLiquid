/**
 * THE INTERACTIVE RUNTIME SESSION KERNEL (PL-013).
 *
 * Implements the Experience Protocol surface — load, reset, observe, act,
 * step, snapshot, restore, replay (seam), terminate — over
 * @playliquid/runtime-contracts as the SINGLE canonical command/event path
 * (E2, lock rule 12). The kernel is the one owner of all session state
 * (E1): phases, epochs, ticks, the world, and — through three focused
 * state-owner collaborators — the event journal (journal.ts), the command
 * path with its idempotency table (command-path.ts), and the snapshot
 * boundary registry (snapshots.ts).
 *
 * Async/stateful documentation (spec/worker-contract.md), kernel binding:
 *
 * - Mutable state owner: THIS KERNEL (+ its owned collaborators).
 *   Experiences receive read models (`view()`, `observe()`, result
 *   envelopes); they never mutate.
 * - Command admission: Experience-level admission via
 *   `admitExperienceOperation` (contracts), then the single command gate
 *   `admitCommand` inside the command path — after the CapabilityPort
 *   boundary for avatar-agent intents (lock 4/14).
 * - Event order: 1-based, gapless per session, globally append-only (E10).
 *   `reset`/`restore` advance the epoch and start a new log segment
 *   (logview.ts); each epoch segment satisfies the contract order oracle.
 * - Idempotency key: { scope: "command", actor, nonce }, classified by
 *   `classifyEncounter`. Duplicates return the first receipt; collisions
 *   are refused (E8). The table is epoch-scoped (cleared on reset/restore).
 * - Stale-result rule: every result carries its epoch; consumers apply
 *   `applyStaleResultRule`. Grants from an older epoch are denied by the
 *   broker (grant-epoch-stale) — least privilege after reset.
 * - Replay/resume boundary: replay starts at seq 1 or
 *   snapshot.afterEventSeq + 1 ONLY (`validateReplayPlan`), and returns
 *   RECORDED events — re-simulation is the Simulation Runtime (PL-014).
 *   Lock rule 15: replay is a platform primitive.
 * - Retry/cancellation: operations are synchronous and idempotent by key;
 *   retries re-submit the same nonce; no async work is retained.
 *
 * Determinism (E9): fixed-tick stepping, deterministic event ids, seeded
 * driver worlds, canonical byte-stable snapshots. No IO, no clock, no
 * timers, no engine SDKs — every host concern is an injected port.
 */

import {
  admitExperienceOperation,
  asEventSequence,
  asTick,
  checkSessionPhaseTransition,
  isTerminalSessionPhase,
  nextSessionEpoch,
  validateLoadRequest,
} from "@playliquid/runtime-contracts";
import type {
  CommandReceipt,
  DeterminismSeed,
  ExperienceOperation,
  RuntimeEventEnvelope,
  RuntimeSessionDescriptor,
  RuntimeSessionPhase,
  RuntimeSessionSnapshotView,
  SessionEpoch,
  SessionSnapshot,
  SnapshotId,
  Tick,
} from "@playliquid/runtime-contracts";
import type {
  InputSourcePort,
  RendererPort,
  TransportPort,
} from "./ports.ts";
import { SessionCommandPath } from "./command-path.ts";
import type { ActInput } from "./command-path.ts";
import { SessionJournal } from "./journal.ts";
import type {
  LoadResult,
  ObserveResult,
  ActResult,
  StepResult,
  ResetResult,
  SnapshotResult,
  RestoreResult,
  ReplayResult,
  TerminateResult,
  KernelFailure,
  KernelRejection,
} from "./results.ts";
import type { WorldDriver, WorldStep } from "./world.ts";
import { RUNTIME_EVENT_KINDS } from "./event-kinds.ts";
import type { JsonSafeValue } from "./serialize.ts";
import { SessionSnapshots } from "./snapshots.ts";
import { DEFAULT_KERNEL_LIMITS, type KernelLimits, type KernelOptions } from "./construction.ts";

/**
 * The Interactive Runtime kernel. Construct via
 * `createInteractiveRuntime` (construction.ts, role-guarded). All public
 * methods are synchronous, host-pure, and return typed results.
 */
export class InteractiveRuntimeKernel<W extends JsonSafeValue> {
  readonly #descriptor: RuntimeSessionDescriptor;
  readonly #driver: WorldDriver<W>;
  readonly #renderer: RendererPort | undefined;
  readonly #inputSource: InputSourcePort | undefined;
  readonly #transport: TransportPort | undefined;
  readonly #limits: KernelLimits;
  #phase: RuntimeSessionPhase = "provisioning";
  #epoch: SessionEpoch;
  #tick: Tick = asTick(0);
  #world: W | undefined;
  readonly #journal: SessionJournal;
  readonly #commands: SessionCommandPath<W>;
  readonly #snapshots: SessionSnapshots<W>;

  constructor(options: KernelOptions<W>) {
    this.#descriptor = options.descriptor;
    this.#driver = options.driver;
    this.#renderer = options.renderer;
    this.#inputSource = options.inputSource;
    this.#transport = options.transport;
    this.#epoch = options.descriptor.initialEpoch;
    const limits = { ...DEFAULT_KERNEL_LIMITS, ...options.limits };
    for (const value of [limits.maxTicksPerStep, limits.maxEventsPerTick, limits.maxEventsPerCommand]) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError("kernel limits must be safe integers >= 1");
      }
    }
    this.#limits = limits;
    this.#journal = new SessionJournal(options.descriptor.sessionId);
    this.#commands = new SessionCommandPath({
      sessionId: options.descriptor.sessionId,
      epoch: () => this.#epoch,
      tick: () => this.#tick,
      driver: options.driver,
      capabilityPort: options.capabilityPort,
      journal: this.#journal,
      maxEventsPerCommand: limits.maxEventsPerCommand,
      sessionView: () => this.view(),
      requireWorld: () => this.#requireWorld(),
      setWorld: (world) => {
        this.#world = world;
      },
      fail: (error) => this.#fail(error),
      postReceipt: (receipt) => this.#postReceipt(receipt),
      present: (events) => this.#present(events),
    });
    this.#snapshots = new SessionSnapshots({
      sessionId: options.descriptor.sessionId,
      worldKind: options.driver.worldKind,
      store: options.snapshotStore,
      epoch: () => this.#epoch,
      tick: () => this.#tick,
      world: () => this.#requireWorld(),
      committedEventSeq: () => this.#journal.committedEventSeq,
      admittedCommandSeq: () => this.#journal.admittedCommandSeq,
      determinism: () => options.descriptor.determinism,
    });
  }

  /** Immutable session descriptor (provenance). */
  get descriptor(): RuntimeSessionDescriptor {
    return this.#descriptor;
  }

  /** Snapshot boundary registry (read model for replay/resume). */
  get snapshotBoundaries(): readonly SessionSnapshot[] {
    return this.#snapshots.boundaries;
  }

  /** Authoritative session read model (contracts type). */
  view(): RuntimeSessionSnapshotView {
    return {
      sessionId: this.#descriptor.sessionId,
      phase: this.#phase,
      role: this.#descriptor.role,
      epoch: this.#epoch,
      tick: this.#tick,
      committedEventSeq: this.#journal.committedEventSeq,
      admittedCommandSeq: this.#journal.admittedCommandSeq,
    };
  }

  /** Whole-log order/causality check via the contract oracle (segments). */
  verifyLogIntegrity() {
    return this.#journal.validate();
  }

  load(): LoadResult {
    const operation = {
      op: "load" as const,
      sessionId: this.#descriptor.sessionId,
      game: this.#descriptor.game,
      role: this.#descriptor.role,
      determinism: this.#descriptor.determinism,
      targetProfile: this.#descriptor.targetProfile,
    };
    const denied = this.#admitOp(operation);
    if (denied !== undefined) return denied;
    const validation = validateLoadRequest(operation);
    if (!validation.ok) {
      return this.#reject("invalid-load", `load request refused: ${validation.code}`);
    }
    try {
      this.#transition("loading");
      this.#world = this.#driver.initialWorld(this.#descriptor, this.#descriptor.determinism);
      this.#transition("ready");
    } catch (error) {
      return this.#fail(error);
    }
    const events = [
      this.#journal.emit(
        RUNTIME_EVENT_KINDS.loaded,
        this.#tick,
        { kind: "system" },
        {
          gameDigest: String(this.#descriptor.game.gameDigest),
          worldId: this.#descriptor.game.world.worldId,
          seeded: this.#descriptor.determinism !== undefined,
        },
      ),
    ];
    this.#present(events);
    return { status: "loaded", epoch: this.#epoch, events };
  }

  observe(afterEventSeq: number): ObserveResult {
    const denied = this.#admitOp({
      op: "observe",
      sessionId: this.#descriptor.sessionId,
      afterEventSeq: asEventSequence(afterEventSeq),
    });
    if (denied !== undefined) return denied;
    if (!Number.isSafeInteger(afterEventSeq) || afterEventSeq < 0 || afterEventSeq > this.#journal.committedEventSeq) {
      return this.#reject(
        "invalid-cursor",
        `afterEventSeq ${String(afterEventSeq)} outside [0, ${String(this.#journal.committedEventSeq)}]`,
      );
    }
    const observation = {
      sessionId: this.#descriptor.sessionId,
      role: this.#descriptor.role,
      phase: this.#phase,
      epoch: this.#epoch,
      tick: this.#tick,
      events: this.#journal.eventsAfter(afterEventSeq),
      nextCursor: asEventSequence(this.#journal.committedEventSeq),
    };
    this.#transport?.post({ kind: "observation", observation });
    return { status: "observed", observation };
  }

  act(input: ActInput): ActResult {
    const denied = this.#admitOp({
      op: "act",
      sessionId: this.#descriptor.sessionId,
      intent: input.intent,
    });
    if (denied !== undefined) return denied;
    return this.#commands.act(input);
  }

  step(ticks: number): StepResult {
    const denied = this.#admitOp({ op: "step", sessionId: this.#descriptor.sessionId, ticks });
    if (denied !== undefined) return denied;
    if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > this.#limits.maxTicksPerStep) {
      return this.#reject(
        "invalid-ticks",
        `ticks must be an integer in [1, ${String(this.#limits.maxTicksPerStep)}], got ${String(ticks)}`,
      );
    }
    if (this.#phase === "ready") this.#transition("running");
    const fromTick = this.#tick;
    const events: RuntimeEventEnvelope[] = [];
    for (let i = 0; i < ticks; i += 1) {
      this.#tick = asTick(this.#tick + 1);
      let step: WorldStep<W>;
      try {
        step = this.#driver.tickWorld(this.#requireWorld(), this.#tick, this.#descriptor.determinism);
      } catch (error) {
        return this.#fail(error);
      }
      const batch = this.#journal.emitEffects(
        step.effects,
        this.#tick,
        { kind: "system" },
        this.#limits.maxEventsPerTick,
      );
      if (batch.flood) {
        return this.#fail(
          new Error(`driver effect flood: more than ${String(this.#limits.maxEventsPerTick)} events for one tick`),
        );
      }
      events.push(...batch.events);
      this.#world = step.world;
    }
    this.#present(events);
    return { status: "stepped", epoch: this.#epoch, fromTick, toTick: this.#tick, events };
  }

  reset(seed: DeterminismSeed): ResetResult {
    const denied = this.#admitOp({ op: "reset", sessionId: this.#descriptor.sessionId, seed });
    if (denied !== undefined) return denied;
    let world: W;
    try {
      world = this.#driver.initialWorld(this.#descriptor, seed);
    } catch (error) {
      return this.#fail(error);
    }
    this.#epoch = nextSessionEpoch(this.#epoch);
    this.#transition("ready");
    this.#tick = asTick(0);
    this.#world = world;
    this.#commands.clearIdempotency();
    const events = [
      this.#journal.emit(RUNTIME_EVENT_KINDS.reset, this.#tick, { kind: "system" }, {
        epoch: this.#epoch,
        seeded: true,
      }),
    ];
    this.#present(events);
    return { status: "reset", epoch: this.#epoch, events };
  }

  snapshot(): SnapshotResult {
    const denied = this.#admitOp({ op: "snapshot", sessionId: this.#descriptor.sessionId });
    if (denied !== undefined) return denied;
    return this.#snapshots.snapshot();
  }

  restore(snapshotId: SnapshotId): RestoreResult {
    const denied = this.#admitOp({
      op: "restore",
      sessionId: this.#descriptor.sessionId,
      snapshotId,
    });
    if (denied !== undefined) return denied;
    const plan = this.#snapshots.restore(snapshotId);
    if (plan.status === "rejected") {
      return this.#reject(plan.code, plan.detail);
    }
    const payload = plan.payload;
    this.#epoch = nextSessionEpoch(this.#epoch);
    this.#tick = asTick(payload.tick);
    this.#world = payload.world as W;
    this.#transition("ready");
    this.#commands.clearIdempotency();
    const events = [
      this.#journal.emit(RUNTIME_EVENT_KINDS.restored, this.#tick, { kind: "system" }, {
        snapshotId: String(snapshotId),
        restoredTick: payload.tick,
        epoch: this.#epoch,
      }),
    ];
    this.#present(events);
    return { status: "restored", epoch: this.#epoch, restoredTick: payload.tick, events };
  }

  replay(query: { readonly fromEventSeq: number; readonly toEventSeq: number | null }): ReplayResult {
    const denied = this.#admitOp({
      op: "replay",
      sessionId: this.#descriptor.sessionId,
      fromEventSeq: asEventSequence(query.fromEventSeq),
      toEventSeq: query.toEventSeq === null ? null : asEventSequence(query.toEventSeq),
    });
    if (denied !== undefined) return denied;
    const window = this.#journal.replayWindow(query, {
      snapshots: this.#snapshots.boundaries,
      role: this.#descriptor.role,
      sessionDeterminism: this.#descriptor.determinism,
      sessionEpoch: this.#epoch,
    });
    if (!window.ok) {
      return {
        status: "rejected",
        epoch: this.#epoch,
        code: "replay-plan-rejected",
        detail: window.detail,
        planCode: window.code,
      };
    }
    return {
      status: "replayed",
      epoch: this.#epoch,
      fromSeq: window.fromSeq,
      toSeq: window.toSeq,
      events: window.events,
    };
  }

  terminate(reason: string): TerminateResult {
    const denied = this.#admitOp({
      op: "terminate",
      sessionId: this.#descriptor.sessionId,
      reason,
    });
    if (denied !== undefined) return denied;
    const events: RuntimeEventEnvelope[] = [];
    this.#transition("terminating");
    events.push(this.#journal.emit(RUNTIME_EVENT_KINDS.terminating, this.#tick, { kind: "system" }, { reason }));
    this.#transition("terminated");
    events.push(this.#journal.emit(RUNTIME_EVENT_KINDS.terminated, this.#tick, { kind: "system" }, { reason }));
    this.#present(events);
    return { status: "terminated", epoch: this.#epoch, events };
  }

  /** Poll the input source and route every sample through `act`. */
  harvestInputs(): readonly ActResult[] {
    if (this.#inputSource === undefined) return [];
    const samples = this.#inputSource.poll();
    const results: ActResult[] = [];
    for (const sample of samples) {
      results.push(this.act({ intent: sample.intent, grantId: sample.grantId, nonce: sample.nonce }));
    }
    return results;
  }

  // -- internals ----------------------------------------------------------

  #admitOp(operation: ExperienceOperation): KernelRejection | undefined {
    if (isTerminalSessionPhase(this.#phase)) {
      return {
        status: "rejected",
        epoch: this.#epoch,
        code: "session-terminal",
        detail: `session is ${this.#phase}; no further operations are admitted`,
      };
    }
    const admission = admitExperienceOperation(this.#descriptor.role, this.#phase, operation);
    if (admission.status === "rejected") {
      return this.#reject("wrong-phase", admission.detail);
    }
    return undefined;
  }

  #reject(code: KernelRejection["code"], detail: string): KernelRejection {
    return { status: "rejected", epoch: this.#epoch, code, detail };
  }

  #fail(error: unknown): KernelFailure {
    const detail = error instanceof Error ? error.message : String(error);
    if (!isTerminalSessionPhase(this.#phase) && checkSessionPhaseTransition(this.#phase, "failed").ok) {
      this.#transition("failed");
    }
    if (!isTerminalSessionPhase(this.#phase)) {
      const events = [this.#journal.emit(RUNTIME_EVENT_KINDS.failed, this.#tick, { kind: "system" }, { detail })];
      this.#present(events);
    }
    return { status: "failed", epoch: this.#epoch, code: "driver-failure", detail };
  }

  #transition(to: RuntimeSessionPhase): void {
    const check = checkSessionPhaseTransition(this.#phase, to);
    if (!check.ok) {
      throw new Error(`kernel invariant violated: ${check.reason}`);
    }
    this.#phase = to;
  }

  #requireWorld(): W {
    if (this.#world === undefined) {
      throw new Error("kernel invariant: world accessed before load");
    }
    return this.#world;
  }

  #postReceipt(receipt: CommandReceipt): void {
    this.#transport?.post({ kind: "receipt", receipt, sessionId: this.#descriptor.sessionId });
  }

  #present(events: readonly RuntimeEventEnvelope[]): void {
    this.#renderer?.present({
      sessionId: this.#descriptor.sessionId,
      tick: this.#tick,
      epoch: this.#epoch,
      phase: this.#phase,
      events,
      committedEventSeq: this.#journal.committedEventSeq,
    });
  }
}
