/**
 * DETERMINISTIC IN-MEMORY FAKES for the five kernel ports plus the fake
 * game policy/schemas used by tests and the runtime-evidence harness.
 *
 * Everything here is deterministic and pure-in-memory: no IO, no timers,
 * no randomness (the simulator derives its drift from the determinism
 * seed's digest). These are TEST/HARNESS doubles — the real transport,
 * store, clock and scheduler adapters are app concerns; real simulation
 * engines are PL-014's world, adapting TO the AuthoritySimulator port.
 *
 * The fake game vocabulary (events + bindings + intent schemas) is one
 * coherent example of the platform-contracts declaration shapes:
 * - `match.moved`        — informational gameplay event
 * - `match.damage-dealt` — protected (grants "damage")
 * - `match.scored`       — protected (grants "score")
 */

import type {
  AuthorityClock,
  AuthoritySimulator,
  MultiplayerTransport,
  SessionStore,
  SimulationEffect,
  TickSchedulerPort,
  TransportDelivery,
} from "./ports.ts";
import type { NextTickDue, ParticipantView, StandingProposal } from "./ports.ts";
import type { StoredSnapshotRecord } from "./ports.ts";
import type {
  IntentAdmissionRule,
  IntentSchema,
} from "./intents.ts";
import type { PlatformPolicyDeclaration } from "@playliquid/platform-contracts";
import type { MultiplayerServicePolicy } from "@playliquid/platform-contracts";
import type { SessionId, SnapshotId } from "@playliquid/runtime-contracts";
import { asTimestamp } from "@playliquid/runtime-contracts";
import { asCommandKind, asIntentKind } from "@playliquid/runtime-contracts";
import { asGameEventKind } from "@playliquid/platform-contracts";
import { sha256Hex } from "./digest.ts";

// ---------------------------------------------------------------------------
// Fake game vocabulary
// ---------------------------------------------------------------------------

/** The fake game's declared event kinds. */
export const FAKE_EVENT_KINDS = {
  moved: "match.moved",
  damage: "match.damage-dealt",
  scored: "match.scored",
} as const;

/** A valid game platform policy declaration for the fake vocabulary. */
export function createFakeGamePolicy(topology: MultiplayerServicePolicy["topology"] = "authoritative-server"): PlatformPolicyDeclaration {
  const moved = asGameEventKind(FAKE_EVENT_KINDS.moved)!;
  const damage = asGameEventKind(FAKE_EVENT_KINDS.damage)!;
  const scored = asGameEventKind(FAKE_EVENT_KINDS.scored)!;
  return {
    game: "game-fake-royale" as PlatformPolicyDeclaration["game"],
    capabilities: [
      {
        capability: "multiplayer",
        required: true,
        policy: {
          topology,
          maxPlayersPerSession: 4,
          sessionModel: "ad-hoc",
        },
      },
    ],
    events: [
      { kind: moved, summary: "An actor moved in the match world." },
      { kind: damage, summary: "An actor dealt damage (protected outcome)." },
      { kind: scored, summary: "An actor scored points (protected outcome)." },
    ],
    bindings: [
      { capability: "multiplayer", eventKind: moved, outcomeClassification: "informational" },
      { capability: "multiplayer", eventKind: damage, outcomeClassification: "protected" },
      { capability: "multiplayer", eventKind: scored, outcomeClassification: "protected" },
    ],
    tenancy: { mode: "platform-shared" },
  };
}

/** Fake intent payload: a move on a 2D grid. */
export interface FakeMovePayload {
  readonly dx: number;
  readonly dy: number;
}

/** Fake intent payload: fire at a target. */
export interface FakeFirePayload {
  readonly target: string;
}

/** Fake intent payload: score one point. */
export interface FakeScorePayload {
  readonly points: number;
}

function isMovePayload(value: unknown): value is FakeMovePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.dx === "number" &&
    Number.isSafeInteger(payload.dx) &&
    payload.dx >= -10 &&
    payload.dx <= 10 &&
    typeof payload.dy === "number" &&
    Number.isSafeInteger(payload.dy) &&
    payload.dy >= -10 &&
    payload.dy <= 10
  );
}

function isFirePayload(value: unknown): value is FakeFirePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.target === "string" && payload.target.length > 0 && payload.target.length <= 64;
}

function isScorePayload(value: unknown): value is FakeScorePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.points === "number" &&
    Number.isSafeInteger(payload.points) &&
    payload.points >= 1 &&
    payload.points <= 10
  );
}

/** The fake intent schemas (1:1 with the rules below). */
export function createFakeIntentSchemas(): readonly IntentSchema[] {
  return [
    { intentKind: asIntentKind("match.move"), validate: isMovePayload },
    { intentKind: asIntentKind("match.fire"), validate: isFirePayload },
    { intentKind: asIntentKind("match.score"), validate: isScorePayload },
  ];
}

/** The fake intent admission rules (1:1 with the schemas above). */
export function createFakeIntentRules(): readonly IntentAdmissionRule[] {
  return [
    {
      intentKind: asIntentKind("match.move"),
      commandKind: asCommandKind("match.move"),
      admittedOrigins: ["player-input", "broker-mediated"],
      maxPerTickPerActor: 2,
    },
    {
      intentKind: asIntentKind("match.fire"),
      commandKind: asCommandKind("match.fire"),
      admittedOrigins: ["player-input", "broker-mediated"],
      maxPerTickPerActor: 2,
    },
    {
      intentKind: asIntentKind("match.score"),
      commandKind: asCommandKind("match.score"),
      admittedOrigins: ["player-input", "broker-mediated"],
      maxPerTickPerActor: 2,
    },
  ];
}

/** Which protected kind each protected fake event grants. */
export const FAKE_PROTECTED_GRANT_KINDS: Readonly<Record<string, "damage" | "score">> = {
  [FAKE_EVENT_KINDS.damage]: "damage",
  [FAKE_EVENT_KINDS.scored]: "score",
};

// ---------------------------------------------------------------------------
// Fake simulator
// ---------------------------------------------------------------------------

/** The fake authority state (canonical-JSON round-trippable by contract). */
export interface FakeAuthorityState {
  readonly positions: Readonly<Record<string, readonly [number, number]>>;
  readonly scores: Readonly<Record<string, number>>;
  readonly steps: number;
  readonly drift: number;
}

function seedDrift(seed: string): number {
  return Number.parseInt(sha256Hex(seed).slice(0, 8), 16) % 97;
}

/**
 * A deterministic fake {@link AuthoritySimulator}: moves shift positions by
 * (dx + drift, dy) where the drift derives from the determinism seed; fire
 * emits a protected damage effect; score emits a protected score effect and
 * bumps the actor's score. Finalize proposes one standing per participant.
 */
export function createFakeSimulator(): AuthoritySimulator<FakeAuthorityState> {
  return {
    initial: (input) => ({
      positions: {},
      scores: {},
      steps: 0,
      drift: seedDrift(String(input.determinism)),
    }),
    step: (input) => {
      const positions: Record<string, readonly [number, number]> = { ...input.state.positions };
      const scores: Record<string, number> = { ...input.state.scores };
      const effects: SimulationEffect[] = [];
      const kinds = {
        moved: asGameEventKind(FAKE_EVENT_KINDS.moved)!,
        damage: asGameEventKind(FAKE_EVENT_KINDS.damage)!,
        scored: asGameEventKind(FAKE_EVENT_KINDS.scored)!,
      };
      for (const admitted of input.intents) {
        const actorId = String(admitted.intent.actor.actorId);
        const kind = String(admitted.intent.kind);
        if (kind === "match.move" && isMovePayload(admitted.intent.payload)) {
          const previous = positions[actorId] ?? [0, 0];
          const next: readonly [number, number] = [
            previous[0] + admitted.intent.payload.dx + input.state.drift,
            previous[1] + admitted.intent.payload.dy,
          ];
          positions[actorId] = next;
          effects.push({
            eventKind: kinds.moved,
            actor: admitted.intent.actor,
            causedByCommand: admitted.commandId,
            payload: { actor: actorId, to: next },
          });
        } else if (kind === "match.fire" && isFirePayload(admitted.intent.payload)) {
          effects.push({
            eventKind: kinds.damage,
            actor: admitted.intent.actor,
            causedByCommand: admitted.commandId,
            payload: { actor: actorId, target: admitted.intent.payload.target },
          });
        } else if (kind === "match.score" && isScorePayload(admitted.intent.payload)) {
          scores[actorId] = (scores[actorId] ?? 0) + admitted.intent.payload.points;
          effects.push({
            eventKind: kinds.scored,
            actor: admitted.intent.actor,
            causedByCommand: admitted.commandId,
            payload: { actor: actorId, points: admitted.intent.payload.points },
          });
        }
      }
      return {
        state: { positions, scores, steps: input.state.steps + 1, drift: input.state.drift },
        effects,
      };
    },
    finalize: (input) => {
      const standings: StandingProposal[] = input.participants.map((participant: ParticipantView) => ({
        actor: participant.actor,
        score: input.state.scores[String(participant.actor.actorId)] ?? 0,
      }));
      return { standings };
    },
  };
}

// ---------------------------------------------------------------------------
// Fake transport / store / clock / scheduler
// ---------------------------------------------------------------------------

/** A transport that records every delivery (readonly snapshot accessor). */
export function createRecordingTransport(): {
  readonly transport: MultiplayerTransport;
  readonly deliveries: () => readonly TransportDelivery[];
} {
  const log: TransportDelivery[] = [];
  return {
    transport: { deliver: (delivery) => { log.push(delivery); } },
    deliveries: () => [...log],
  };
}

/** An in-memory session store (content-addressed saves are idempotent). */
export function createMemorySessionStore(): {
  readonly store: SessionStore;
  readonly records: () => readonly StoredSnapshotRecord[];
} {
  const byKey = new Map<string, StoredSnapshotRecord>();
  const bySession = new Map<string, StoredSnapshotRecord[]>();
  return {
    store: {
      save: (record) => {
        const key = `${String(record.snapshot.sessionId)}:${String(record.snapshot.snapshotId)}`;
        if (!byKey.has(key)) {
          byKey.set(key, record);
          const sessionId = String(record.snapshot.sessionId);
          const list = bySession.get(sessionId) ?? [];
          list.push(record);
          bySession.set(sessionId, list);
        }
      },
      load: (sessionId: SessionId, snapshotId: SnapshotId) =>
        byKey.get(`${String(sessionId)}:${String(snapshotId)}`),
      list: (sessionId: SessionId) => [...(bySession.get(String(sessionId)) ?? [])],
    },
    records: () => [...byKey.values()],
  };
}

/** A caller-advanced clock — the kernel never advances time itself. */
export function createFixedClock(startMs = 1_000): {
  readonly clock: AuthorityClock;
  readonly advance: (ms: number) => void;
  readonly now: () => number;
} {
  let current = startMs;
  return {
    clock: { now: () => asTimestamp(current) },
    advance: (ms) => { current += ms; },
    now: () => current,
  };
}

/** A scheduler that records next-tick-due notifications. */
export function createRecordingScheduler(): {
  readonly scheduler: TickSchedulerPort;
  readonly dues: () => readonly NextTickDue[];
} {
  const log: NextTickDue[] = [];
  return {
    scheduler: { nextTickDue: (due) => { log.push(due); } },
    dues: () => [...log],
  };
}
