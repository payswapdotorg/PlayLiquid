/**
 * INTENT ADMISSION HELPERS — the pure half of the session's `act` path.
 *
 * Everything here is a pure function over read models: the idempotency
 * encounter classification (runtime-contracts idempotency.ts), the grant
 * selection over the broker-owned grant table, the capability-boundary
 * resolution (runtime-contracts capability.ts, lock rules 4/13/14) and the
 * fingerprinting/decoding helpers the session and the snapshot continuation
 * share. No state is owned here; the session remains the single mutable
 * state owner (E1).
 *
 * One canonical command path (E2): {@link admitIntent} produces the same
 * broker-mediated `RuntimeCommandEnvelope` the envelope-level
 * `submitRecordedCommand` entry re-admits during replay re-execution —
 * there is no second command channel.
 */

import {
  admitCommand,
  asActionRequestId,
  asCapabilityGrantId,
  asCommandId,
  asCommandKind,
  asIdempotencyNonce,
  asSessionId,
  classifyEncounter,
  resolveActionRequest,
  validateLoadRequest,
} from "@playliquid/runtime-contracts";
import type {
  ActionDenialReason,
  ActorRef,
  BudgetLedger,
  CapabilityGrant,
  CommandAdmissionPolicy,
  CommandId,
  DeterminismSeed,
  GameIrDigest,
  IdempotencyKey,
  IntentKind,
  LoadOperation,
  RuntimeCommandEnvelope,
  RuntimeSessionSnapshotView,
  SessionEpoch,
  SessionId,
  Tick,
  Timestamp,
  TypedIntent,
} from "@playliquid/runtime-contracts";
import type { GameIRValue } from "@playliquid/game-ir";
import { canonicalValueForm } from "@playliquid/game-ir";
import { createHash } from "node:crypto";
import type { IdempotencyRecord, PendingCommandRecord } from "./snapshot.ts";
import type { JsonSafe } from "./codec.ts";
import { decodeGameIRValue } from "./codec.ts";
import type { PendingCommand, PendingCommandQueue } from "./ports.ts";
import type { SubmitResult } from "./session-types.ts";

/** The act-path idempotency key of an intent: { action, actor, intentId }. */
export function intentIdempotencyKey(intent: TypedIntent<GameIRValue>): IdempotencyKey {
  return {
    scope: "action",
    actor: intent.actor.actorId,
    nonce: asIdempotencyNonce(String(intent.intentId)),
  };
}

/** Deterministic sha256 fingerprint of an intent's semantic content. */
export function intentFingerprint(intent: TypedIntent<GameIRValue>): string {
  return createHash("sha256")
    .update(
      canonicalJsonOf({
        kind: String(intent.kind),
        actorClass: intent.actor.actorClass,
        actorId: intent.actor.actorId,
        payload: canonicalValueForm(intent.payload),
      }),
    )
    .digest("hex");
}

/** Stable string form of an idempotency key (the session table's map key). */
export function idempotencyKeyString(key: { scope: string; actor: string; nonce: string }): string {
  return canonicalJsonOf(key);
}

/** Rebuilds the typed key of a recorded idempotency encounter. */
export function idempotencyParse(record: IdempotencyRecord): IdempotencyKey {
  return {
    scope: record.scope as IdempotencyKey["scope"],
    actor: record.actor as IdempotencyKey["actor"],
    nonce: record.nonce as IdempotencyKey["nonce"],
  };
}

/** First grant whose holder and capability cover the intent, or undefined. */
export function firstGrantCovering(
  grants: readonly CapabilityGrant[],
  capabilityIntentKinds: Readonly<Record<string, readonly IntentKind[]>>,
  intent: TypedIntent<GameIRValue>,
): CapabilityGrant | undefined {
  for (const grant of grants) {
    if (grant.holder.actorId !== intent.actor.actorId || grant.holder.actorClass !== intent.actor.actorClass) {
      continue;
    }
    const covered = capabilityIntentKinds[grant.capability];
    if (covered !== undefined && covered.includes(intent.kind)) {
      return grant;
    }
  }
  return undefined;
}

/** Everything {@link admitIntent} needs, as pure read models. */
export interface IntentAdmissionInput {
  readonly sessionId: SessionId;
  readonly intent: TypedIntent<GameIRValue>;
  readonly grants: readonly CapabilityGrant[];
  readonly capabilityIntentKinds: Readonly<Record<string, readonly IntentKind[]>>;
  readonly ledger: BudgetLedger;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  /** Next per-session command sequence number (admission numbering). */
  readonly nextCommandSeq: number;
  /** The injected clock port — read exactly once, only on a grant. */
  readonly clock: { now(): Timestamp };
  /** Explicit grant id (option mode) or undefined (auto-selection). */
  readonly grantId?: string;
  /** The recorded first encounter for this intent's key, if any. */
  readonly priorEncounter: IdempotencyRecord | undefined;
}

/** Typed outcome of the pure act-path admission. */
export type IntentAdmission =
  | { readonly status: "granted"; readonly command: RuntimeCommandEnvelope<GameIRValue>; readonly ledger: BudgetLedger; readonly encounter: IdempotencyRecord }
  | { readonly status: "rejected"; readonly code: "duplicate-intent" | "idempotency-collision" | "grant-not-found" | ActionDenialReason; readonly detail: string };

/**
 * The pure act-path gate: idempotency encounter classification first
 * (duplicate/collision are refused, never re-executed — E8), then grant
 * selection, then the capability-boundary resolution producing the canonical
 * broker-mediated command envelope (which still has to pass the command
 * admission gate inside the session — E2). The clock is read only when a
 * command is actually derived, exactly once.
 */
export function admitIntent(input: IntentAdmissionInput): IntentAdmission {
  const key = intentIdempotencyKey(input.intent);
  const fingerprint = intentFingerprint(input.intent);
  if (input.priorEncounter !== undefined) {
    const encounter = classifyEncounter(
      { key: idempotencyParse(input.priorEncounter), fingerprint: input.priorEncounter.fingerprint },
      { key, fingerprint },
    );
    if (encounter.classification === "duplicate") {
      return {
        status: "rejected",
        code: "duplicate-intent",
        detail: "idempotent re-submission of an already-applied intent",
      };
    }
    if (encounter.classification === "collision") {
      return {
        status: "rejected",
        code: "idempotency-collision",
        detail: "same idempotency key with a different payload fingerprint",
      };
    }
  }
  const grant = input.grantId !== undefined
    ? input.grants.find((candidate) => candidate.grantId === input.grantId)
    : firstGrantCovering(input.grants, input.capabilityIntentKinds, input.intent);
  if (grant === undefined) {
    return {
      status: "rejected",
      code: "grant-not-found",
      detail: "no capability grant covers this intent for this actor",
    };
  }
  const resolution = resolveActionRequest(
    {
      requestId: asActionRequestId(`act-${input.nextCommandSeq}`),
      sessionId: input.sessionId,
      actor: input.intent.actor,
      intent: input.intent,
      grantId: grant.grantId,
      idempotencyKey: key,
    },
    {
      grants: input.grants,
      epoch: input.epoch,
      tick: input.tick,
      capabilityIntentKinds: input.capabilityIntentKinds,
      ledger: input.ledger,
    },
    asCommandId(`cmd-${input.nextCommandSeq}`),
    asCommandKind(String(input.intent.kind)),
    input.clock.now(),
  );
  if (resolution.resolution.status === "denied") {
    return { status: "rejected", code: resolution.resolution.reason, detail: resolution.resolution.detail };
  }
  return {
    status: "granted",
    command: resolution.resolution.command,
    ledger: resolution.ledger,
    encounter: { scope: key.scope, actor: key.actor, nonce: key.nonce, fingerprint },
  };
}

/** Decodes a serialized pending command back into a canonical envelope. */
export function decodePendingCommand(record: PendingCommandRecord): RuntimeCommandEnvelope<GameIRValue> {
  const origin = record.command.origin as { kind?: unknown; grantId?: unknown };
  if (typeof origin !== "object" || origin === null || typeof origin.kind !== "string") {
    throw new TypeError("snapshot: malformed command origin");
  }
  const key = record.command.idempotencyKey as { scope?: unknown; actor?: unknown; nonce?: unknown };
  if (
    typeof key !== "object" ||
    key === null ||
    typeof key.scope !== "string" ||
    typeof key.actor !== "string" ||
    typeof key.nonce !== "string"
  ) {
    throw new TypeError("snapshot: malformed idempotency key");
  }
  return {
    commandId: asCommandId(record.command.commandId),
    sessionId: asSessionId(record.command.sessionId),
    kind: asCommandKind(record.command.kind),
    epoch: record.command.epoch as unknown as SessionEpoch,
    actor: {
      actorClass: record.command.actor.actorClass as ActorRef["actorClass"],
      actorId: record.command.actor.actorId as ActorRef["actorId"],
    },
    origin:
      origin.kind === "broker-mediated" && typeof origin.grantId === "string"
        ? { kind: "broker-mediated", grantId: asCapabilityGrantId(origin.grantId) }
        : { kind: origin.kind as "player-input" | "platform-system" | "host-authority" },
    idempotencyKey: {
      scope: key.scope as IdempotencyKey["scope"],
      actor: key.actor as IdempotencyKey["actor"],
      nonce: key.nonce as IdempotencyKey["nonce"],
    },
    issuedAt: record.command.issuedAt as unknown as Timestamp,
    payload: decodeGameIRValue(record.command.payload as JsonSafe),
  };
}

/** Canonical JSON over JSON-safe values: sorted keys, no whitespace. */
export function canonicalJsonOf(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`);
  return `{${parts.join(",")}}`;
}

/** Everything {@link admitAndScheduleCommand} needs (session read models + tables). */
export interface CommandSchedulingInput {
  readonly view: RuntimeSessionSnapshotView;
  readonly policy: CommandAdmissionPolicy;
  readonly envelope: RuntimeCommandEnvelope<GameIRValue>;
  readonly dueTick: Tick;
  readonly queue: PendingCommandQueue;
  readonly admittedCommandIds: Set<CommandId>;
}

/**
 * The canonical admission gate + deterministic scheduler hookup (E2):
 * duplicate command ids are refused, the envelope passes `admitCommand`
 * against the game policy and the current session view, and the admitted
 * command is scheduled for its due tick. Mutates only the two session-owned
 * tables passed in (queue + admitted ids).
 */
export function admitAndScheduleCommand(input: CommandSchedulingInput): SubmitResult {
  if (input.admittedCommandIds.has(input.envelope.commandId)) {
    return {
      status: "rejected",
      code: "duplicate-command-id",
      detail: `command ${input.envelope.commandId} already admitted`,
    };
  }
  const admission = admitCommand(input.view, input.policy, input.envelope);
  if (admission.status === "rejected") {
    return { status: "rejected", code: admission.code, detail: admission.detail };
  }
  const pending: PendingCommand = {
    envelope: input.envelope,
    assignedSeq: Number(admission.assignedSeq),
    dueTick: input.dueTick,
  };
  input.queue.schedule(pending);
  input.admittedCommandIds.add(input.envelope.commandId);
  return { status: "submitted", commandId: input.envelope.commandId, dueTick: Number(input.dueTick) };
}

/** Typed outcome of {@link checkSimulationLoad}. */
export type SimulationLoadCheck =
  | { readonly status: "ok"; readonly seed: DeterminismSeed }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

/**
 * The pure simulation-role load checks: the shared load-request validation,
 * the binding's pinned game composition match, and the mandatory determinism
 * seed (E9).
 */
export function checkSimulationLoad(operation: LoadOperation, bindingGameDigest: GameIrDigest): SimulationLoadCheck {
  const validation = validateLoadRequest(operation);
  if (!validation.ok) {
    return { status: "rejected", code: validation.code, detail: "load request refused" };
  }
  if (operation.game.gameDigest !== bindingGameDigest) {
    return {
      status: "rejected",
      code: "game-mismatch",
      detail: "load request targets a different game composition than this session's binding",
    };
  }
  const seed = operation.determinism;
  if (seed === undefined) {
    return { status: "rejected", code: "determinism-required-for-simulation", detail: "seed missing" };
  }
  return { status: "ok", seed };
}
