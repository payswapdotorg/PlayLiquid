/**
 * THE AUTHORITY SESSION KERNEL — the multiplayer authority service
 * (PL-016; matrix row `multiplayer | Platform | platform-contracts,
 * runtime-contracts`; architecture "Multiplayer": "Client sends
 * input/intent. Server validates/simulates and emits state/events").
 *
 * The kernel is the server-side BINDING of the two contract packages:
 * every command enters through runtime-contracts' canonical path
 * (`admitCommand`), every observable effect leaves as a canonical
 * `RuntimeEventEnvelope` validated by `validateEventStream`, admission is
 * platform-contracts' `decideAdmission` over kernel-derived facts, and
 * protected outcomes are decided ONLY here (R9 / lock 19).
 *
 * Module split (for the repository's 400-line ceiling): typed contracts
 * in kernel-types.ts; shared context/helpers in kernel-ops.ts; session
 * operations in kernel-session.ts; settlement operations in
 * kernel-settlement.ts. THIS file is the façade — the class instance is
 * the single mutable-state owner (E1) and the public identity.
 *
 * Async/stateful discipline (spec/worker-contract.md "Async/stateful
 * work") — every item owned and tested:
 *
 * - MUTABLE STATE OWNER: this kernel instance owns ALL session state
 *   (phase, epoch, tick, simulator state, event log, roster, idempotency
 *   table, protected-grant accounting, refusal log). Clients and
 *   transports receive read models and typed deliveries only.
 * - COMMAND ADMISSION: `submitIntent` is the single door; it runs the
 *   pure pipeline (schema + policy + origin consistency + idempotency +
 *   rate + the bound `admitCommand` gate). Rejected submissions never
 *   receive a sequence number.
 * - EVENT ORDER: 1-based, gapless, per session. Every tick's new segment
 *   is re-validated with `validateEventStream` before publication; a
 *   violation fails the session closed (`failed`).
 * - IDEMPOTENCY KEY: `{scope, actor, nonce}`. Admitted commands record
 *   `key -> {fingerprint, commandId}`. Same key + same fingerprint ->
 *   `duplicate` with the FIRST receipt (E6). Same key + different
 *   fingerprint -> `idempotency-collision` refusal (E8).
 * - STALE-RESULT RULE: receipts carry the session epoch; `restore`
 *   advances the epoch beyond both the current and the snapshot's epoch,
 *   so pre-restore results are superseded (`applyStaleResultRule`).
 * - REPLAY/RESUME BOUNDARY: `replay()` validates plans with
 *   `validateReplayPlan` (start at seq 1 or immediately after a snapshot
 *   boundary); `restore()` resumes from a stored snapshot.
 * - RETRY SEMANTICS: a retry re-submits the SAME key + SAME payload and
 *   receives the first receipt. Rejected submissions are not recorded,
 *   so a corrected retry (e.g. after a stale epoch) is a fresh encounter.
 * - CANCELLATION SEMANTICS: cooperative — `terminate()` stops admissions,
 *   drops the pending queue (their would-be results are superseded), lets
 *   the in-flight tick finish, then settles a competitive outcome if the
 *   topology may decide one. There is no hard kill.
 *
 * Determinism (E9): fixed-tick stepping only via `advanceTicks`; the
 * simulator seed is mandatory; command/event ids derive from session
 * identity + sequences; snapshots are byte-stable (snapshot.ts).
 */

import { deriveCommandAdmissionPolicy } from "./intents.ts";
import type { IntentSubmission } from "./intents.ts";
import type { ParticipantView } from "./ports.ts";
import type { RefusalRecord } from "./snapshot.ts";
import type { CommandOrigin, RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import type { SnapshotId } from "@playliquid/runtime-contracts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import {
  admitParticipantOp,
  advanceTicksOp,
  openSession,
  sessionViewOf,
  submitIntentOp,
} from "./kernel-session.ts";
import {
  decideOutcomeOp,
  replayOp,
  restoreOp,
  snapshotOp,
  submitClaimOp,
  submitPlayResultOp,
  terminateOp,
} from "./kernel-settlement.ts";
import type { KernelOperationContext } from "./kernel-ops.ts";
import {
  initialAuthoritySessionState,
  type AuthoritySessionKernelOptions,
  type AuthoritySessionState,
  type ClientClaimResult,
  type IntentSubmitResult,
  type OpenResult,
  type OutcomeDecisionResult,
  type RestoreResult,
  type ReplayResult,
  type SnapshotResult,
  type TerminateResult,
  type TickResult,
} from "./kernel-types.ts";
import type { ParticipantAdmissionResult } from "./admission.ts";

/**
 * One authoritative multiplayer session. Construct, then `open()`. The
 * instance is the single mutable-state owner (E1); all effects flow
 * through the injected ports. The simulator state `S` must be
 * canonical-JSON round-trippable for byte-stable snapshots.
 */
export class AuthoritySessionKernel<S> {
  private readonly context: KernelOperationContext<S>;

  constructor(options: AuthoritySessionKernelOptions<S>) {
    this.context = {
      options,
      state: initialAuthoritySessionState<S>(),
      bindings: new Map<string, "protected" | "informational">(),
      commandPolicy: deriveCommandAdmissionPolicy(options.intentRules),
      configuration: undefined,
    };
  }

  /** Open the session: resolve configuration, initialize the seam, emit. */
  open(): OpenResult {
    return openSession(this.context);
  }

  /** Authoritative read model (runtime-contracts shape). */
  sessionView(): ReturnType<typeof sessionViewOf<S>> {
    return sessionViewOf(this.context);
  }

  /** Read-only view of the simulator state (the authority's world). */
  authorityState(): S | undefined {
    return this.context.state.simulatorState;
  }

  /** The committed event log — the replayable authority stream (R8). */
  eventLog(): readonly RuntimeEventEnvelope[] {
    return [...this.context.state.events];
  }

  /** The refusal log (audit trail; deterministic, tick/epoch-stamped). */
  refusalLog(): readonly RefusalRecord[] {
    return [...this.context.state.refusals];
  }

  /** Enrolled participants (read model). */
  roster(): readonly ParticipantView[] {
    return [...this.context.state.participants];
  }

  /** The kernel-owned session state (read model; E1 owner). */
  sessionState(): Readonly<AuthoritySessionState<S>> {
    return this.context.state;
  }

  /** Admit one participant via the bound platform admission oracle. */
  admitParticipant(request: {
    readonly tenant: TenantId;
    readonly subject: SubjectId;
  }): ParticipantAdmissionResult {
    return admitParticipantOp(this.context, request);
  }

  /** Submit one intent through the full admission pipeline. */
  submitIntent<P>(submission: IntentSubmission<P>): IntentSubmitResult {
    return submitIntentOp(this.context, submission);
  }

  /** Advance `count` fixed ticks through the authoritative seam. */
  advanceTicks(count: number): TickResult {
    return advanceTicksOp(this.context, count);
  }

  /**
   * Submit an untrusted client claim. The ONLY possible outcome is a typed
   * refusal plus the lossy advisory record (R9 / lock 19). Never an event,
   * never an outcome, never a state mutation.
   */
  submitClientClaim(claim: Parameters<typeof submitClaimOp<S>>[1]): ClientClaimResult {
    return submitClaimOp(this.context, claim);
  }

  /**
   * Submit an untrusted platform-shape play-result claim. Same rule: typed
   * refusal, advisory only (binds `validatePlatformOutcome`).
   */
  submitClientPlayResult(claim: Parameters<typeof submitPlayResultOp<S>>[1]): ClientClaimResult {
    return submitPlayResultOp(this.context, claim);
  }

  /**
   * THE platform-authority outcome decision. Only `platform-system` actors
   * through `platform-system` origin may request it; standings come from
   * the simulator seam over committed evidence (outcomes.ts).
   */
  decideOutcome(request: {
    readonly actorClass: string;
    readonly origin: CommandOrigin;
  }): OutcomeDecisionResult {
    return decideOutcomeOp(this.context, request.actorClass, request.origin);
  }

  /** Persist a byte-stable, content-addressed snapshot of the session. */
  snapshot(): SnapshotResult {
    return snapshotOp(this.context);
  }

  /**
   * Restore from a stored snapshot: resume the recorded state and advance
   * the session epoch beyond both the current and the snapshot's epoch
   * (stale-result rule). Refuses terminal sessions and foreign snapshots.
   */
  restore(snapshotId: SnapshotId): RestoreResult {
    return restoreOp(this.context, snapshotId);
  }

  /**
   * Replay the committed event stream (R8 seam). `fromSnapshotId` starts
   * immediately after that snapshot boundary; without it, replay starts
   * at seq 1 — the only two legal boundaries per `validateReplayPlan`.
   */
  replay(fromSnapshotId?: SnapshotId): ReplayResult {
    return replayOp(this.context, fromSnapshotId);
  }

  /** Cooperatively terminate: settle (if competitive), drain, close. */
  terminate(reason: string): TerminateResult {
    return terminateOp(this.context, reason);
  }
}

// Public re-exports: the kernel module remains the import identity for
// its typed contracts (split into kernel-types.ts for the line ceiling).
export type {
  AuthoritySessionKernelOptions,
  AuthoritySessionState,
  PendingCommand,
  OpenResult,
  IntentSubmitResult,
  TickResult,
  OutcomeDecisionResult,
  SnapshotResult,
  RestoreResult,
  TerminateResult,
  ReplayResult,
  ClientClaimResult,
} from "./kernel-types.ts";
