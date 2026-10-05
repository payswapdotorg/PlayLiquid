/**
 * The CANONICAL COMMAND PATH (requirement E2: one canonical command/event
 * path per behavior).
 *
 * Every state-mutating behavior in a runtime session enters the authoritative
 * runtime as exactly one `RuntimeCommandEnvelope` on this path. There is no
 * second command channel, no side door, and no direct engine handle (lock
 * rule 14: avatar intelligence never receives arbitrary engine authority —
 * an avatar-agent command is only admitted when it was produced through the
 * Capability Broker, proven by its `origin`).
 *
 * Async/stateful documentation (worker-contract "Async/stateful work"):
 * - Command admission: `admitCommand` is the single admission gate. It
 *   checks (a) phase legality from the game-supplied policy, (b) epoch
 *   freshness, (c) origin/actor-class consistency, and (d) assigns the next
 *   per-session command sequence number. Rejected commands never receive a
 *   sequence number.
 * - Mutable state owner: the authoritative runtime owns admitted-command
 *   state and the sequencer. Callers pass the current read model in and
 *   receive a pure result; this function mutates nothing.
 * - Idempotency key: every command carries one (see idempotency.ts). The
 *   duplicate/collision classification is defined there; admission itself
 *   treats each envelope as a first encounter.
 */

import type {
  ActorRef,
  CapabilityGrantId,
  CommandId,
  CommandKind,
  CommandSequence,
  SessionEpoch,
  SessionId,
  Timestamp,
} from "./primitives.ts";
import type { IdempotencyKey } from "./idempotency.ts";
import type { RuntimeSessionPhase, RuntimeSessionSnapshotView } from "./session.ts";
import { isTerminalSessionPhase } from "./session.ts";

/**
 * How a command entered the canonical path. `avatar-agent` actors MUST use
 * the `broker-mediated` origin — this is how lock rule 14 (no raw engine
 * authority for avatar intelligence) is expressed structurally in the types.
 */
export type CommandOrigin =
  | { readonly kind: "player-input" }
  | { readonly kind: "platform-system" }
  | { readonly kind: "host-authority" }
  | {
      readonly kind: "broker-mediated";
      /** The grant under which the Capability Broker authorized this action. */
      readonly grantId: CapabilityGrantId;
    };

/**
 * The single command envelope type for the whole protocol. `payload` is the
 * game-defined, typed command body; the runtime and the simulation consume
 * the same envelope shape (lock rule 12).
 */
export interface RuntimeCommandEnvelope<P = unknown> {
  readonly commandId: CommandId;
  readonly sessionId: SessionId;
  readonly kind: CommandKind;
  /** Session epoch the issuer observed when creating the command. */
  readonly epoch: SessionEpoch;
  readonly actor: ActorRef;
  readonly origin: CommandOrigin;
  readonly idempotencyKey: IdempotencyKey;
  readonly issuedAt: Timestamp;
  readonly payload: P;
}

/**
 * Game-supplied admission policy: which session phases admit which command
 * kinds (keyed by the command kind string). Unknown kinds are rejected.
 */
export type CommandAdmissionPolicy = Readonly<
  Record<string, readonly RuntimeSessionPhase[]>
>;

/** Reason codes for command rejection at the admission gate. */
export type CommandRejectionCode =
  | "session-terminal"
  | "phase-not-allowed"
  | "unknown-command-kind"
  | "avatar-agent-requires-broker-mediation"
  | "stale-epoch"
  | "session-mismatch"
  | "origin-actor-mismatch";

/** Pure result of the admission gate. */
export type CommandAdmissionResult =
  | {
      readonly status: "admitted";
      readonly commandId: CommandId;
      readonly assignedSeq: CommandSequence;
      readonly kind: CommandKind;
    }
  | {
      readonly status: "rejected";
      readonly commandId: CommandId;
      readonly code: CommandRejectionCode;
      readonly detail: string;
    };

/**
 * The single admission gate for the canonical command path. Pure: takes the
 * current authoritative session read model, the game policy, and the
 * candidate envelope; returns admission with the next sequence number, or a
 * typed rejection. It never mutates its inputs.
 */
export function admitCommand(
  session: RuntimeSessionSnapshotView,
  policy: CommandAdmissionPolicy,
  command: RuntimeCommandEnvelope,
): CommandAdmissionResult {
  if (command.sessionId !== session.sessionId) {
    return {
      status: "rejected",
      commandId: command.commandId,
      code: "session-mismatch",
      detail: `command targets session ${String(command.sessionId)} but gate holds ${String(session.sessionId)}`,
    };
  }
  if (isTerminalSessionPhase(session.phase)) {
    return {
      status: "rejected",
      commandId: command.commandId,
      code: "session-terminal",
      detail: `session phase ${session.phase} is terminal`,
    };
  }
  const allowedPhases = policy[command.kind];
  if (allowedPhases === undefined) {
    return {
      status: "rejected",
      commandId: command.commandId,
      code: "unknown-command-kind",
      detail: `command kind ${String(command.kind)} is not in the admission policy`,
    };
  }
  if (!allowedPhases.includes(session.phase)) {
    return {
      status: "rejected",
      commandId: command.commandId,
      code: "phase-not-allowed",
      detail: `command kind ${String(command.kind)} not admitted in phase ${session.phase}`,
    };
  }
  if (command.epoch !== session.epoch) {
    return {
      status: "rejected",
      commandId: command.commandId,
      code: "stale-epoch",
      detail: `command issued under epoch ${String(command.epoch)} but session is at ${String(session.epoch)}`,
    };
  }
  if (command.actor.actorClass === "avatar-agent" && command.origin.kind !== "broker-mediated") {
    return {
      status: "rejected",
      commandId: command.commandId,
      code: "avatar-agent-requires-broker-mediation",
      detail: "avatar intelligence may only act through a Capability Broker grant (lock rule 14)",
    };
  }
  if (command.actor.actorClass === "player" && command.origin.kind !== "player-input") {
    return {
      status: "rejected",
      commandId: command.commandId,
      code: "origin-actor-mismatch",
      detail: `player actor must use player-input origin, got ${command.origin.kind}`,
    };
  }
  const next = session.admittedCommandSeq + 1;
  if (!Number.isSafeInteger(next)) {
    throw new RangeError("command sequence overflow");
  }
  return {
    status: "admitted",
    commandId: command.commandId,
    assignedSeq: next as CommandSequence,
    kind: command.kind,
  };
}

/**
 * Receipt handed back to the issuer once the authoritative runtime has
 * dispositioned a command. Rejection here reflects policy decisions AFTER
 * admission (e.g. idempotency collision); admission-level failures use
 * {@link CommandAdmissionResult}.
 */
export type CommandReceipt =
  | { readonly status: "committed"; readonly commandId: CommandId; readonly seq: CommandSequence }
  | { readonly status: "duplicate"; readonly commandId: CommandId; readonly firstReceipt: CommandId }
  | { readonly status: "superseded"; readonly commandId: CommandId; readonly code: CommandRejectionCode };
