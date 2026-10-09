/**
 * THE AVATAR RUNTIME DRIVER: composes nothing new, owns no kernel — it
 * DRIVES one composed {@link AvatarDefinition} through its ports and
 * routes EVERY action through the Capability Broker (lock rules 13/14;
 * architecture.md §Avatar "All actions pass through Capability Broker and
 * game policy").
 *
 * One cycle (see ports.ts data-flow diagram):
 * 1. poll sensors; drop samples whose channel did not survive the host
 *    restriction (R5 — perception gating at composition projection);
 * 2. append surviving perceptions to memory and hand them to the
 *    intelligence;
 * 3. collect intent claims; for each claim, in order:
 *    a. provenance gate: the claim's intent actor MUST be this avatar's
 *       actor (an untrusted brain cannot act as someone else — E8);
 *    b. body gate: the intent kind must be served by a restriction-
 *       surviving actuator (a body without the actuator cannot act);
 *    c. broker gate: build the ActionRequest (request id from the
 *       deterministic counter; idempotency key from the claim nonce) and
 *       evaluate — granted commands are EMITTED to the actuator output
 *       (they still must pass kernel admission downstream, E2), denials
 *       are fed back to the intelligence.
 *
 * The avatar runtime NEVER constructs a state mutation itself and never
 * bypasses the broker: the only path from intent to command is
 * `broker.evaluate` (typed proof: emitted commands are exactly the
 * broker's derived envelopes).
 *
 * Async/stateful documentation (spec/worker-contract.md), this class:
 * - Mutable state owner: the avatar runtime owns ONLY its request-id
 *   counter and cycle history (read models). Ports own their state; the
 *   broker owns grants/budgets; the host kernel owns session state.
 * - Command admission: emitted commands are canonical envelopes still
 *   subject to `admitCommand` in the hosting kernel (E2).
 * - Event order: claims are processed in emission order; actuator
 *   receives commands in the same order.
 * - Idempotency: claim nonces become `IdempotencyKey {scope:"action",
 *   actor, nonce}`; dedup is kernel-owned (see ports.ts docs).
 * - Stale-result rule: the cycle's epoch travels into every broker
 *   evaluation; stale-epoch grants are denied by the broker.
 * - Replay/resume: a cycle is a pure function of (definition,
 *   restriction, port states, broker state, epoch, tick) modulo port
 *   side effects; deterministic request ids keep replays reproducible.
 * - Retry/cancellation: synchronous; retried claims reuse their nonce.
 */

import { asActionRequestId, asTimestamp } from "@playliquid/runtime-contracts";
import type {
  ActorRef,
  IdempotencyKey,
  SessionEpoch,
  SessionId,
  Tick,
  Timestamp,
} from "@playliquid/runtime-contracts";
import type { HostRestriction } from "@playliquid/game-contracts";
import type { AvatarDefinition } from "./definition.ts";
import { effectiveSensorChannels, servedIntentKinds } from "./composition.ts";
import type {
  ActuatorOutputPort,
  AvatarBrokerPort,
  AvatarIntentClaim,
  AvatarMemoryPort,
  AvatarIntelligencePort,
  PerceptionRecord,
  SensorInputPort,
} from "./ports.ts";
import type { AvatarDenialFeedback } from "./ports.ts";

/** Read-only cycle view handed to the driver. */
export interface AvatarCycleContext {
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  /** Caller-supplied memory-record timestamp (no clock IO here). */
  readonly recordedAt?: Timestamp;
}

/** Audit report of one cycle (pure read model). */
export interface AvatarCycleReport {
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  readonly sensorSamples: number;
  readonly perceived: number;
  readonly filtered: number;
  readonly claims: number;
  readonly granted: number;
  readonly denied: number;
  readonly unavailable: number;
  readonly denials: readonly AvatarDenialFeedback[];
  readonly emittedCommandKinds: readonly string[];
}

/** Construction options for {@link AvatarRuntime}. */
export interface AvatarRuntimeOptions {
  readonly definition: AvatarDefinition;
  /** Host restriction applied to the avatar (R5); default: unrestricted. */
  readonly restriction?: HostRestriction;
  readonly sessionId: SessionId;
  /** The avatar-agent actor this avatar acts as. */
  readonly actor: ActorRef;
  readonly broker: AvatarBrokerPort;
  readonly ports: {
    readonly sensors: SensorInputPort;
    readonly memory: AvatarMemoryPort;
    readonly intelligence: AvatarIntelligencePort;
    readonly actuators: ActuatorOutputPort;
  };
  /** Deterministic request-id prefix; default `"req"`. */
  readonly requestIdPrefix?: string;
}

/**
 * The driver. Wire the broker from capability-broker at composition time
 * (its `evaluate` satisfies {@link AvatarBrokerPort} structurally).
 */
export class AvatarRuntime {
  readonly #definition: AvatarDefinition;
  readonly #restriction: HostRestriction;
  readonly #sessionId: SessionId;
  readonly #actor: ActorRef;
  readonly #broker: AvatarBrokerPort;
  readonly #ports: AvatarRuntimeOptions["ports"];
  readonly #prefix: string;
  readonly #sensorChannels: ReadonlySet<string>;
  readonly #servedIntentKinds: ReadonlySet<string>;
  #counter = 0;

  constructor(options: AvatarRuntimeOptions) {
    this.#definition = options.definition;
    this.#restriction = options.restriction ?? { denied: [], approvalRequired: [], sandboxed: false };
    this.#sessionId = options.sessionId;
    this.#actor = options.actor;
    this.#broker = options.broker;
    this.#ports = options.ports;
    this.#prefix = options.requestIdPrefix ?? "req";
    this.#sensorChannels = effectiveSensorChannels(options.definition, this.#restriction);
    this.#servedIntentKinds = servedIntentKinds(options.definition, this.#restriction);
  }

  /** Read model: the composed definition being driven. */
  get definition(): AvatarDefinition {
    return this.#definition;
  }

  /** Read model: the host restriction in force. */
  get restriction(): HostRestriction {
    return this.#restriction;
  }

  /** Read model: sensor channels that survive the restriction. */
  get effectiveSensorChannels(): readonly string[] {
    return [...this.#sensorChannels];
  }

  /** Read model: intent kinds the (restricted) body can serve. */
  get servedIntentKinds(): readonly string[] {
    return [...this.#servedIntentKinds];
  }

  /** Read model: request ids minted so far (replay bookkeeping). */
  get requestCounter(): number {
    return this.#counter;
  }

  /** Drive exactly one perception → decision → action cycle. */
  cycle(context: AvatarCycleContext): AvatarCycleReport {
    const samples = this.#ports.sensors.poll();
    const perceived: PerceptionRecord[] = [];
    let filtered = 0;
    for (const sample of samples) {
      if (!this.#sensorChannels.has(sample.channel)) {
        filtered += 1;
        continue;
      }
      const record: PerceptionRecord = {
        channel: sample.channel,
        tick: sample.tick,
        payload: sample.payload,
        recordedAt: context.recordedAt ?? asTimestamp(Number(context.tick)),
      };
      this.#ports.memory.append(record);
      perceived.push(record);
    }

    const claims = this.#ports.intelligence.decide(perceived);
    const denials: AvatarDenialFeedback[] = [];
    const emittedKinds: string[] = [];
    let granted = 0;
    let unavailable = 0;

    for (const claim of claims) {
      const local = this.#localRefusal(claim);
      if (local !== undefined) {
        unavailable += 1;
        denials.push(local);
        this.#ports.intelligence.notifyDenial(local);
        continue;
      }
      const resolution = this.#broker.evaluate(this.#actionRequest(claim), {
        sessionId: this.#sessionId,
        epoch: context.epoch,
        tick: context.tick,
      });
      if (resolution.status === "granted") {
        granted += 1;
        emittedKinds.push(String(resolution.command.kind));
        this.#ports.actuators.emit(resolution.command);
      } else {
        const feedback: AvatarDenialFeedback = {
          intentId: claim.intent.intentId,
          intentKind: claim.intent.kind,
          source: "broker",
          reason: resolution.reason,
        };
        denials.push(feedback);
        this.#ports.intelligence.notifyDenial(feedback);
      }
    }

    return {
      epoch: context.epoch,
      tick: context.tick,
      sensorSamples: samples.length,
      perceived: perceived.length,
      filtered,
      claims: claims.length,
      granted,
      denied: denials.length - unavailable,
      unavailable,
      denials,
      emittedCommandKinds: emittedKinds,
    };
  }

  /** Provenance + body gates (see class docs, steps 3a and 3b). */
  #localRefusal(claim: AvatarIntentClaim): AvatarDenialFeedback | undefined {
    if (claim.intent.actor.actorId !== this.#actor.actorId || claim.intent.actor.actorClass !== this.#actor.actorClass) {
      return {
        intentId: claim.intent.intentId,
        intentKind: claim.intent.kind,
        source: "body",
        reason: "foreign-actor",
      };
    }
    if (!this.#servedIntentKinds.has(String(claim.intent.kind))) {
      return {
        intentId: claim.intent.intentId,
        intentKind: claim.intent.kind,
        source: "body",
        reason: "actuator-unavailable",
      };
    }
    return undefined;
  }

  #actionRequest(claim: AvatarIntentClaim): Parameters<AvatarBrokerPort["evaluate"]>[0] {
    this.#counter += 1;
    const key: IdempotencyKey = {
      scope: "action",
      actor: claim.intent.actor.actorId,
      nonce: claim.nonce,
    };
    return {
      requestId: asActionRequestId(`${this.#prefix}-${this.#counter}`),
      sessionId: this.#sessionId,
      actor: this.#actor,
      intent: claim.intent,
      grantId: claim.grantId,
      idempotencyKey: key,
    };
  }
}
