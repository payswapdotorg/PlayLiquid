/**
 * IN-MEMORY FAKES for the host-side ports + a reference world driver.
 *
 * STATUS: TEST SUPPORT ONLY. These fakes exist so the kernel can be
 * exercised end-to-end without any real host adapter (renderer, device
 * input, network, durable snapshot storage, or the real Capability Broker
 * of PL-026). They are explicitly NOT production integrations (lock rule
 * 44: no hidden mocks presented as production).
 *
 * No parallel authority is built here:
 * - `GrantTableCapabilityPort` implements the CapabilityPort SEAM by
 *   delegating to `resolveActionRequest` — the PURE evaluator from
 *   @playliquid/runtime-contracts — over caller-supplied read models
 *   (grants, capability coverage, budget ledger). The broker-owned state
 *   stays in the fake; the real broker (PL-026) will own it
 *   authoritatively with the same contract types.
 * - `InMemorySnapshotStore` computes REAL SHA-256 digests (node:crypto) so
 *   content addressing and byte-stability are honestly observable; it is
 *   still volatile (no persistence) and says so.
 *
 * node:crypto is the ONLY node builtin used anywhere in this package, and
 * only in this TEST-SUPPORT module (domain modules stay pure).
 */

import { createHash } from "node:crypto";
import {
  EMPTY_BUDGET_LEDGER,
  asActorId,
  asCommandId,
  asDeterminismSeed,
  asDigest,
  asEventKind,
  asGameIrDigest,
  asSessionEpoch,
  asSessionId,
  asSnapshotId,
  asTargetProfileId,
  asTimestamp,
  resolveActionRequest,
} from "@playliquid/runtime-contracts";
import type {
  ActionRequest,
  ActionResolution,
  ActorRef,
  BudgetLedger,
  CapabilityGrant,
  CapabilityGrantId,
  CapabilityId,
  CommandKind,
  DeterminismSeed,
  Digest,
  GameRefSummary,
  IntentKind,
  RuntimeCommandEnvelope,
  RuntimeSessionDescriptor,
  SnapshotId,
  Tick,
  Timestamp,
} from "@playliquid/runtime-contracts";
import type { CapabilityPort, CapabilityPortContext } from "./capability-port.ts";
import type {
  ClockPort,
  InputSample,
  InputSourcePort,
  RendererFrame,
  RendererPort,
  SnapshotStorePort,
  StoredSnapshot,
  TransportMessage,
  TransportPort,
} from "./ports.ts";
import type { WorldDriver, WorldEventEffect, WorldStep } from "./world.ts";
import type { KernelSnapshotPayload } from "./serialize.ts";

/** Deterministic, manually advanced clock (the injected time authority). */
export class ManualClock implements ClockPort {
  #now: Timestamp;
  constructor(startMs: number = 0) {
    this.#now = asTimestamp(startMs);
  }
  now(): Timestamp {
    return this.#now;
  }
  advance(ms: number): void {
    this.#now = asTimestamp(this.#now + ms);
  }
}

/** Records every presented frame (renderer surface fake). */
export class InMemoryRenderer implements RendererPort {
  readonly #frames: RendererFrame[] = [];
  present(frame: RendererFrame): void {
    this.#frames.push(frame);
  }
  get frames(): readonly RendererFrame[] {
    return this.#frames;
  }
  get lastFrame(): RendererFrame | undefined {
    return this.#frames[this.#frames.length - 1];
  }
}

/** Queued input source fake; `poll` drains the queue. */
export class InMemoryInputSource implements InputSourcePort {
  readonly #queue: InputSample[] = [];
  enqueue(sample: InputSample): void {
    this.#queue.push(sample);
  }
  poll(): readonly InputSample[] {
    return this.#queue.splice(0, this.#queue.length);
  }
  get pending(): number {
    return this.#queue.length;
  }
}

/** Records every posted outbound message (transport fake). */
export class InMemoryTransport implements TransportPort {
  readonly #messages: TransportMessage[] = [];
  post(message: TransportMessage): void {
    this.#messages.push(message);
  }
  get messages(): readonly TransportMessage[] {
    return this.#messages;
  }
}

/**
 * Volatile, content-addressed snapshot store. Computes REAL sha-256
 * digests over the canonical bytes; identical bytes deduplicate to the
 * same snapshot id. NOT durable — data lives in memory only.
 */
export class InMemorySnapshotStore implements SnapshotStorePort {
  readonly #byId = new Map<SnapshotId, KernelSnapshotPayload>();
  readonly #byDigest = new Map<Digest, StoredSnapshot>();

  save(payload: KernelSnapshotPayload, canonicalBytes: string): StoredSnapshot {
    const digest = createHash("sha256").update(canonicalBytes, "utf8").digest("hex");
    const existing = this.#byDigest.get(digest as Digest);
    if (existing !== undefined) {
      return existing;
    }
    const stored: StoredSnapshot = {
      snapshotId: asSnapshotId(digest.slice(0, 16)),
      stateDigest: digest as Digest,
    };
    this.#byDigest.set(digest as Digest, stored);
    this.#byId.set(stored.snapshotId, payload);
    return stored;
  }

  load(snapshotId: SnapshotId): KernelSnapshotPayload | undefined {
    return this.#byId.get(snapshotId);
  }

  get entries(): readonly StoredSnapshot[] {
    return [...this.#byDigest.values()];
  }
}

/** Configuration for {@link GrantTableCapabilityPort}. */
export interface GrantTableOptions {
  /** Grant read model (broker-owned state; tests may issue/revoke). */
  readonly grants?: readonly CapabilityGrant[];
  /** capabilityId -> intent kinds it authorizes. */
  readonly capabilityIntentKinds: Readonly<Record<string, readonly IntentKind[]>>;
  /** intent kind -> command kind the derived command carries. */
  readonly intentCommandKinds: Readonly<Record<string, string>>;
  readonly clock: ClockPort;
}

/**
 * CapabilityPort fake: the PL-026 seam implemented with the contract's own
 * pure evaluator over caller-owned grant/ledger state. Deterministic
 * command ids (`cmd-<n>`) and clock-supplied issue times keep runs
 * reproducible.
 */
export class GrantTableCapabilityPort implements CapabilityPort {
  #grants: CapabilityGrant[];
  readonly #capabilityIntentKinds: Readonly<Record<string, readonly IntentKind[]>>;
  readonly #intentCommandKinds: Readonly<Record<string, string>>;
  readonly #clock: ClockPort;
  #ledger: BudgetLedger = EMPTY_BUDGET_LEDGER;
  #counter = 0;

  constructor(options: GrantTableOptions) {
    this.#grants = [...(options.grants ?? [])];
    this.#capabilityIntentKinds = options.capabilityIntentKinds;
    this.#intentCommandKinds = options.intentCommandKinds;
    this.#clock = options.clock;
  }

  evaluate<P>(request: ActionRequest<P>, context: CapabilityPortContext): ActionResolution<P> {
    const commandKindText = this.#intentCommandKinds[String(request.intent.kind)];
    if (commandKindText === undefined) {
      return {
        status: "denied",
        requestId: request.requestId,
        reason: "intent-kind-outside-grant",
        detail: `fake broker has no command mapping for intent kind ${String(request.intent.kind)}`,
      };
    }
    this.#counter += 1;
    const { resolution, ledger } = resolveActionRequest(
      request,
      {
        grants: this.#grants,
        epoch: context.epoch,
        tick: context.tick,
        capabilityIntentKinds: this.#capabilityIntentKinds,
        ledger: this.#ledger,
      },
      asCommandId(`cmd-${this.#counter}`),
      commandKindText as CommandKind,
      this.#clock.now(),
    );
    this.#ledger = ledger;
    return resolution;
  }

  /** Issue a grant into the fake's broker-owned table. */
  issueGrant(grant: CapabilityGrant): void {
    this.#grants.push(grant);
  }

  /** Revoke (remove) a grant; returns whether it existed. */
  revokeGrant(grantId: CapabilityGrantId): boolean {
    const before = this.#grants.length;
    this.#grants = this.#grants.filter((grant) => grant.grantId !== grantId);
    return this.#grants.length !== before;
  }

  get ledger(): BudgetLedger {
    return this.#ledger;
  }
}

// ---------------------------------------------------------------------------
// Reference world driver (deterministic, JSON-safe, seeded)
// ---------------------------------------------------------------------------

/** World label of the reference driver. */
export const COUNTER_WORLD_KIND = "runtime-core.test/counter@1";

/** Reference world state: JSON-safe by construction (type alias so it
 * structurally satisfies the JsonSafeValue record variant). */
export type CounterWorld = {
  readonly count: number;
  readonly moves: readonly number[];
};

/** Deterministic pure offset derived from a seed string (E9). */
export function seededOffset(seed: DeterminismSeed | undefined): number {
  if (seed === undefined) return 0;
  let acc = 0;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    acc = (acc + text.charCodeAt(i) * (i + 1)) % 97;
  }
  return acc;
}

/**
 * Reference driver: counts (incremented by commands and by every tick) and
 * a move log. Command kinds: `world.increment` {by}, `world.move` {to};
 * intent kinds match command kinds. Pure and deterministic.
 */
export class CounterWorldDriver implements WorldDriver<CounterWorld> {
  readonly worldKind = COUNTER_WORLD_KIND;
  readonly commandPolicy = {
    "world.increment": ["ready", "running"] as const,
    "world.move": ["ready", "running"] as const,
  };

  initialWorld(_descriptor: RuntimeSessionDescriptor, seed: DeterminismSeed | undefined): CounterWorld {
    return { count: seededOffset(seed), moves: [] };
  }

  applyCommand(
    world: CounterWorld,
    command: RuntimeCommandEnvelope,
    tick: Tick,
  ): WorldStep<CounterWorld> {
    if (command.kind === "world.increment") {
      const by = readIntegerField(command.payload, "by");
      const next: CounterWorld = { count: world.count + by, moves: world.moves };
      return {
        world: next,
        effects: [countedEffect({ by, count: next.count, atTick: tick })],
      };
    }
    if (command.kind === "world.move") {
      const to = readIntegerField(command.payload, "to");
      const next: CounterWorld = { count: world.count, moves: [...world.moves, to] };
      return {
        world: next,
        effects: [
          {
            kind: asEventKind("world.moved"),
            payload: { to, totalMoves: next.moves.length, atTick: tick },
          },
        ],
      };
    }
    throw new Error(`counter driver cannot apply command kind ${String(command.kind)}`);
  }

  tickWorld(world: CounterWorld, tick: Tick, _seed: DeterminismSeed | undefined): WorldStep<CounterWorld> {
    const next: CounterWorld = { count: world.count + 1, moves: world.moves };
    return { world: next, effects: [countedEffect({ perTick: true, count: next.count, atTick: tick })] };
  }

  intentToCommandKind(intentKind: string): CommandKind | undefined {
    if (intentKind === "world.increment" || intentKind === "world.move") {
      return intentKind as CommandKind;
    }
    return undefined;
  }
}

function countedEffect(payload: Record<string, number | boolean>): WorldEventEffect {
  return { kind: asEventKind("world.counted"), payload };
}

function readIntegerField(payload: unknown, field: string): number {
  if (typeof payload === "object" && payload !== null && field in payload) {
    const value = (payload as Record<string, unknown>)[field];
    if (Number.isSafeInteger(value)) {
      return value as number;
    }
  }
  throw new Error(`payload field ${field} must be a safe integer`);
}

// ---------------------------------------------------------------------------
// Shared fixtures (64-char digests required by validateLoadRequest)
// ---------------------------------------------------------------------------

/** A digest-pinned game reference usable by kernel tests and the harness. */
export function testGameRef(worldId = "world-1"): GameRefSummary {
  return {
    gameDigest: asGameIrDigest("f".repeat(64)),
    world: { worldId, revisionDigest: asDigest("a".repeat(64)) },
    policy: { policyId: "policy-1", revisionDigest: asDigest("b".repeat(64)) },
  };
}

/** Convenience descriptor builder for interactive sessions. */
export function interactiveDescriptor(sessionId: string, seed?: string): RuntimeSessionDescriptor {
  return {
    sessionId: asSessionId(sessionId),
    game: testGameRef(),
    role: "interactive",
    determinism: seed === undefined ? undefined : asDeterminismSeed(seed),
    targetProfile: asTargetProfileId("spark"),
    provisionedAt: asTimestamp(0),
    initialEpoch: asSessionEpoch(1),
  };
}

/** Convenience avatar-agent actor reference. */
export function avatarActor(actorId: string): ActorRef {
  return { actorClass: "avatar-agent", actorId: asActorId(actorId) };
}

/** Convenience player actor reference. */
export function playerActor(actorId: string): ActorRef {
  return { actorClass: "player", actorId: asActorId(actorId) };
}

/** Capability id helper. */
export function capId(value: string): CapabilityId {
  return value as CapabilityId;
}
