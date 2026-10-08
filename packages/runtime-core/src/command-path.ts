/**
 * SESSION COMMAND PATH — the owner of the `act` pipeline and its state.
 *
 * Owns (E1):
 * - the idempotency table (key -> first receipt; epoch-scoped, cleared by
 *   reset/restore through `clearIdempotency`);
 * - the request counter for deterministic command/request id minting.
 *
 * The pipeline (in ORDER, one canonical path — E2):
 * 1. idempotency pre-check on the REQUEST fingerprint
 *    (`canonicalJson({kind, payload})` of the INTENT): a table hit is
 *    classified by `classifyEncounter` (contracts) BEFORE any broker
 *    consultation — retries return the first receipt and never consume
 *    budget twice; same key + different payload is a REFUSED collision
 *    (E8 anti-gaming); denials never consume keys;
 * 2. derive the command: avatar-agent intents MUST go through the
 *    CapabilityPort (lock rule 14 — grants are the only action authority);
 *    player / platform-system / host-authority actors submit direct-origin
 *    commands exactly as the frozen contracts demand (origin must match
 *    actor class — see commands.ts);
 * 3. admission through the contract gate `admitCommand` (phase policy,
 *    epoch freshness, origin/actor consistency);
 * 4. application through the WorldDriver, effects emitted on the canonical
 *    event path via the journal, receipt posted to the transport.
 *
 * All kernel state mutation happens through the {@link CommandPathHost}
 * closures the kernel supplies — this module never holds kernel fields.
 */

import {
  admitCommand,
  asActionRequestId,
  asCommandId,
  classifyEncounter,
} from "@playliquid/runtime-contracts";
import type {
  ActionRequest,
  CommandId,
  CommandOrigin,
  CommandReceipt,
  IdempotencyNonce,
  CapabilityGrantId,
  PayloadFingerprint,
  RuntimeCommandEnvelope,
  RuntimeEventEnvelope,
  RuntimeSessionSnapshotView,
  SessionEpoch,
  SessionId,
  Tick,
  TypedIntent,
} from "@playliquid/runtime-contracts";
import type { CapabilityPort } from "./capability-port.ts";
import type { SessionJournal } from "./journal.ts";
import type { ActResult, KernelFailure, KernelRejection } from "./results.ts";
import type { WorldDriver } from "./world.ts";
import { canonicalJson } from "./serialize.ts";

/**
 * One `act` request. `grantId` is REQUIRED for avatar-agent intents (lock
 * rule 14); other actor classes submit direct-origin commands.
 */
export interface ActInput {
  readonly intent: TypedIntent;
  readonly grantId?: CapabilityGrantId;
  readonly nonce: IdempotencyNonce;
}

/** Kernel surface the command path may use (closure-supplied). */
export interface CommandPathHost<W> {
  readonly sessionId: SessionId;
  epoch(): SessionEpoch;
  tick(): Tick;
  readonly driver: WorldDriver<W>;
  readonly capabilityPort: CapabilityPort;
  readonly journal: SessionJournal;
  readonly maxEventsPerCommand: number;
  sessionView(): RuntimeSessionSnapshotView;
  requireWorld(): W;
  setWorld(world: W): void;
  fail(error: unknown): KernelFailure;
  postReceipt(receipt: CommandReceipt): void;
  present(events: readonly RuntimeEventEnvelope[]): void;
}

interface IdempotencyRecord {
  readonly key: ActionRequest["idempotencyKey"];
  readonly commandId: CommandId;
  readonly fingerprint: PayloadFingerprint;
}

/** A first-encounter idempotency entry awaiting command execution. */
interface PendingRecord {
  readonly keyString: string;
  readonly key: ActionRequest["idempotencyKey"];
  readonly fingerprint: PayloadFingerprint;
}

/** The `act` pipeline owner. Constructed by the kernel per session. */
export class SessionCommandPath<W> {
  readonly #host: CommandPathHost<W>;
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  #requestCounter = 0;

  constructor(host: CommandPathHost<W>) {
    this.#host = host;
  }

  /** Epoch advance (reset/restore) invalidates the idempotency table. */
  clearIdempotency(): void {
    this.#idempotency.clear();
  }

  act(input: ActInput): ActResult {
    const precheck = this.#classifyRequest(input);
    if (precheck.status !== "first") return precheck.result;
    const command = this.#deriveCommand(input);
    if (command.status === "rejected") return command;
    return this.#executeCommand(command.command, precheck.record);
  }

  /**
   * Idempotency pre-check on the request fingerprint
   * (`canonicalJson({kind, payload})` of the INTENT). A table hit is
   * classified BEFORE any broker consultation: retries return the first
   * receipt without consuming budget twice, and key/payload mismatches
   * are refused as collisions. First encounters return the record to be
   * committed after successful execution.
   */
  #classifyRequest(
    input: ActInput,
  ):
    | { readonly status: "duplicate" | "rejected" | "failed"; readonly result: ActResult }
    | { readonly status: "first"; readonly record: PendingRecord } {
    let fingerprint: PayloadFingerprint;
    try {
      fingerprint = canonicalJson({ kind: input.intent.kind, payload: input.intent.payload });
    } catch (error) {
      return { status: "failed", result: this.#host.fail(error) };
    }
    const key = {
      scope: "command" as const,
      actor: input.intent.actor.actorId,
      nonce: input.nonce,
    };
    const keyString = `${key.scope}|${key.actor}|${key.nonce}`;
    const recorded = this.#idempotency.get(keyString);
    if (recorded === undefined) {
      return { status: "first", record: { keyString, key, fingerprint } };
    }
    const encounter = classifyEncounter(
      { key: recorded.key, fingerprint: recorded.fingerprint },
      { key, fingerprint },
    );
    if (encounter.classification === "collision") {
      return {
        status: "rejected",
        result: {
          status: "rejected",
          epoch: this.#host.epoch(),
          code: "idempotency-collision",
          detail: `idempotency key reused with a different payload (first ${encounter.firstFingerprint}, repeated ${encounter.repeatedFingerprint})`,
        },
      };
    }
    if (encounter.classification === "duplicate") {
      return {
        status: "duplicate",
        result: {
          status: "duplicate",
          epoch: this.#host.epoch(),
          commandId: recorded.commandId,
          firstCommandId: recorded.commandId,
        },
      };
    }
    // "first" is unreachable: a table hit guarantees key equality.
    return {
      status: "rejected",
      result: {
        status: "rejected",
        epoch: this.#host.epoch(),
        code: "idempotency-collision",
        detail: "unreachable: idempotency table hit with unequal keys",
      },
    };
  }

  #deriveCommand(input: ActInput):
    | { readonly status: "derived"; readonly command: RuntimeCommandEnvelope }
    | KernelRejection {
    const actor = input.intent.actor;
    const idempotencyKey = { scope: "command" as const, actor: actor.actorId, nonce: input.nonce };
    this.#requestCounter += 1;
    if (actor.actorClass === "avatar-agent") {
      if (input.grantId === undefined) {
        return {
          status: "rejected",
          epoch: this.#host.epoch(),
          code: "capability-denied",
          detail: "avatar-agent intents require a capability grant (lock rule 14)",
          denial: "grant-not-found",
        };
      }
      const request: ActionRequest = {
        requestId: asActionRequestId(`${this.#host.sessionId}#a${this.#requestCounter}`),
        sessionId: this.#host.sessionId,
        actor,
        intent: input.intent,
        grantId: input.grantId,
        idempotencyKey,
      };
      const resolution = this.#host.capabilityPort.evaluate(request, {
        sessionId: this.#host.sessionId,
        epoch: this.#host.epoch(),
        tick: this.#host.tick(),
      });
      if (resolution.status === "denied") {
        return {
          status: "rejected",
          epoch: this.#host.epoch(),
          code: "capability-denied",
          detail: resolution.detail,
          denial: resolution.reason,
        };
      }
      return { status: "derived", command: resolution.command };
    }
    const commandKind = this.#host.driver.intentToCommandKind(String(input.intent.kind));
    if (commandKind === undefined) {
      return {
        status: "rejected",
        epoch: this.#host.epoch(),
        code: "command-rejected",
        detail: `driver declares no command kind for intent kind ${String(input.intent.kind)}`,
        commandCode: "unknown-command-kind",
      };
    }
    const origin: CommandOrigin =
      actor.actorClass === "player"
        ? { kind: "player-input" }
        : actor.actorClass === "platform-system"
          ? { kind: "platform-system" }
          : { kind: "host-authority" };
    const command: RuntimeCommandEnvelope = {
      commandId: asCommandId(`${this.#host.sessionId}#c${this.#requestCounter}`),
      sessionId: this.#host.sessionId,
      kind: commandKind,
      epoch: this.#host.epoch(),
      actor,
      origin,
      idempotencyKey,
      issuedAt: input.intent.issuedAt,
      payload: input.intent.payload,
    };
    return { status: "derived", command };
  }

  #executeCommand(command: RuntimeCommandEnvelope, record: PendingRecord): ActResult {
    const admission = admitCommand(
      this.#host.sessionView(),
      this.#host.driver.commandPolicy,
      command,
    );
    if (admission.status === "rejected") {
      return {
        status: "rejected",
        epoch: this.#host.epoch(),
        code: "command-rejected",
        detail: admission.detail,
        commandCode: admission.code,
      };
    }
    this.#host.journal.recordAdmission(command.commandId, admission.assignedSeq);
    let step;
    try {
      step = this.#host.driver.applyCommand(this.#host.requireWorld(), command, this.#host.tick());
    } catch (error) {
      return this.#host.fail(error);
    }
    const batch = this.#host.journal.emitEffects(
      step.effects,
      this.#host.tick(),
      { kind: "command", commandId: command.commandId },
      this.#host.maxEventsPerCommand,
    );
    if (batch.flood) {
      return this.#host.fail(
        new Error(`driver effect flood: more than ${String(this.#host.maxEventsPerCommand)} events for one command`),
      );
    }
    this.#host.setWorld(step.world);
    this.#host.present(batch.events);
    this.#idempotency.set(record.keyString, {
      key: record.key,
      commandId: command.commandId,
      fingerprint: record.fingerprint,
    });
    const receipt: CommandReceipt = {
      status: "committed",
      commandId: command.commandId,
      seq: admission.assignedSeq,
    };
    this.#host.postReceipt(receipt);
    return {
      status: "committed",
      epoch: this.#host.epoch(),
      commandId: command.commandId,
      commandSeq: admission.assignedSeq,
      events: batch.events,
    };
  }
}
