/**
 * IN-MEMORY FAKES for the avatar runtime ports + a demo avatar definition.
 *
 * STATUS: TEST SUPPORT ONLY (lock rule 44: no hidden mocks presented as
 * production). No real sensors, brains, memory stores or actuator sinks
 * ship in this work order — hosts (interactive/simulation runtimes) own
 * the real adapters.
 *
 * The fakes stay honest about trust: {@link ScriptedIntelligence} is an
 * UNTRUSTED brain double that replays scripted claims and records denial
 * feedback — it exists precisely so the negative tests can prove the
 * runtime refuses forged provenance, unavailable actuators and missing
 * grants.
 */

import { asAgentId, asAvatarId } from "@playliquid/game-contracts";
import type { AvatarId } from "@playliquid/game-contracts";
import {
  asCapabilityGrantId,
  asDigest,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import type {
  ActorId,
  IdempotencyNonce,
  IntentKind,
  RuntimeCommandEnvelope,
  Tick,
  TypedIntent,
} from "@playliquid/runtime-contracts";
import type {
  AvatarIntentClaim,
  AvatarIntelligencePort,
  AvatarMemoryPort,
  AvatarDenialFeedback,
  PerceptionRecord,
  SensorSample,
} from "./ports.ts";
import { composeAvatar } from "./composition.ts";
import type { ComposeAvatarResult } from "./composition.ts";
import type { AvatarDefinition, ComposeAvatarInput } from "./definition.ts";

/** Queued sensor input; `poll` drains the queue. */
export class InMemorySensorInput {
  readonly #queue: SensorSample[] = [];
  enqueue(sample: SensorSample): void {
    this.#queue.push(sample);
  }
  poll(): readonly SensorSample[] {
    return this.#queue.splice(0, this.#queue.length);
  }
  get pending(): number {
    return this.#queue.length;
  }
}

/** Append-only in-memory perception memory with channel/tick recall. */
export class InMemoryAvatarMemory implements AvatarMemoryPort {
  readonly #records: PerceptionRecord[] = [];
  append(record: PerceptionRecord): void {
    this.#records.push(record);
  }
  recall(channel?: string, sinceTick?: Tick): readonly PerceptionRecord[] {
    return this.#records.filter(
      (record) =>
        (channel === undefined || record.channel === channel) &&
        (sinceTick === undefined || Number(record.tick) >= Number(sinceTick)),
    );
  }
  get records(): readonly PerceptionRecord[] {
    return [...this.#records];
  }
}

/** Records every emitted canonical command (actuator sink fake). */
export class InMemoryActuatorOutput {
  readonly #commands: RuntimeCommandEnvelope[] = [];
  emit(command: RuntimeCommandEnvelope): void {
    this.#commands.push(command);
  }
  get commands(): readonly RuntimeCommandEnvelope[] {
    return [...this.#commands];
  }
  get last(): RuntimeCommandEnvelope | undefined {
    return this.#commands[this.#commands.length - 1];
  }
}

/** One scripted claim of the untrusted-brain fake. */
export interface ScriptedClaimSpec {
  readonly intentKind: string;
  readonly nonce: string;
  readonly grantId: string;
  /** Payload of the scripted intent (default `{}`). */
  readonly payload?: unknown;
  /** Override the intent's actor to attempt forgery (negative tests). */
  readonly forgedActorId?: string;
}

/**
 * UNTRUSTED intelligence double: replays scripted claims per cycle and
 * records every denial feedback it receives.
 */
export class ScriptedIntelligence implements AvatarIntelligencePort {
  readonly #script: readonly ScriptedClaimSpec[];
  readonly #actor: TypedIntent["actor"];
  readonly #denials: AvatarDenialFeedback[] = [];
  #cycle = 0;

  constructor(actor: TypedIntent["actor"], script: readonly ScriptedClaimSpec[]) {
    this.#actor = actor;
    this.#script = script;
  }

  decide(_perceptions: readonly PerceptionRecord[]): readonly AvatarIntentClaim[] {
    this.#cycle += 1;
    return this.#script.map((spec, index) => {
      const actor =
        spec.forgedActorId === undefined
          ? this.#actor
          : { ...this.#actor, actorId: spec.forgedActorId as ActorId };
      const intent: TypedIntent = {
        intentId: asIntentId(`i-c${this.#cycle}-${index}`),
        kind: asIntentKind(spec.intentKind),
        actor,
        payload: spec.payload ?? {},
        issuedAt: asTimestamp(0),
      };
      const nonce: IdempotencyNonce = asIdempotencyNonce(spec.nonce);
      return { intent, grantId: asCapabilityGrantId(spec.grantId), nonce };
    });
  }

  notifyDenial(feedback: AvatarDenialFeedback): void {
    this.#denials.push(feedback);
  }

  get denials(): readonly AvatarDenialFeedback[] {
    return [...this.#denials];
  }
}

// ---------------------------------------------------------------------------
// Demo avatar definition (valid; separately versioned sub-records)
// ---------------------------------------------------------------------------

const D = asDigest("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

/** Convenience: a package ref for the demo definition. */
function pkg(packageId: string): { packageId: string; version: string } {
  return { packageId, version: "1.0.0" };
}

/** Demo avatar id. */
export const DEMO_AVATAR_ID: AvatarId = asAvatarId("demo-avatar") as AvatarId;

/** Demo agent id bound to the avatar intelligence. */
export const DEMO_AGENT_ID = asAgentId("demo-agent");

/**
 * The demo avatar: vision+audio sensors, movement+speech actuators,
 * session memory, a cognitive substrate and two skills REFERENCED AS
 * PACKAGES (no skill engine).
 */
export function demoAvatarInput(): ComposeAvatarInput {
  return {
    avatarId: DEMO_AVATAR_ID,
    agent: DEMO_AGENT_ID,
    body: {
      subRecordVersion: { subRecord: "body", version: 3, revisionDigest: D },
      geometry: pkg("asset.body.geometry"),
      skeleton: pkg("asset.body.skeleton"),
      animation: pkg("asset.body.animation"),
      physics: pkg("asset.body.physics"),
      appearance: pkg("asset.body.appearance"),
    },
    sensors: {
      subRecordVersion: { subRecord: "sensors", version: 2, revisionDigest: D },
      channels: [
        { capability: "vision", channel: "vision.main" },
        { capability: "audio", channel: "audio.main" },
      ],
    },
    actuators: {
      subRecordVersion: { subRecord: "actuators", version: 4, revisionDigest: D },
      actuators: [
        { capability: "movement", serves: [asIntentKind("move.to")] },
        { capability: "speech", serves: [asIntentKind("speak.say")] },
      ],
    },
    memory: {
      subRecordVersion: { subRecord: "memory", version: 1, revisionDigest: D },
      topology: "local",
      persistence: "session",
    },
    intelligence: {
      subRecordVersion: { subRecord: "intelligence", version: 5, revisionDigest: D },
      cognitiveSubstrate: pkg("brain.substrate.cognitive"),
      skills: [pkg("skill.navigation"), pkg("skill.smalltalk")],
    },
  };
}

/** Composed demo definition (throws on invalid fixture — test bug). */
export function demoAvatarDefinition(): AvatarDefinition {
  const result: ComposeAvatarResult = composeAvatar(demoAvatarInput());
  if (!result.ok) {
    throw new Error(`demo avatar fixture invalid: ${result.detail}`);
  }
  return result.definition;
}

/** Intent kinds served by the demo body. */
export const DEMO_SERVED_INTENT_KINDS: readonly IntentKind[] = [
  asIntentKind("move.to"),
  asIntentKind("speak.say"),
];
