/**
 * LUMEN RUN — the game's semantic event vocabulary (PL-037).
 *
 * ONE declaration site for the game-declared semantics (lock rule 18):
 * event types, intent types, command kinds and payload shapes live here
 * as frozen data; the GameIR document's rule/event-declaration nodes, the
 * WorldDriver's command policy and the platform-service bindings are all
 * PROJECTIONS of this vocabulary — the game never re-declares itself in
 * a second place.
 *
 * Payloads are GameIR values (R14: the engine-independent value
 * language): ints are bigint, records are unordered-but-canonical.
 * Platform event kinds are minted through platform-contracts'
 * `asGameEventKind` (the reserved `platform.` namespace is refused
 * there — games cannot mint platform authority kinds).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { asEventTypeId, asIntentTypeId } from "../../../packages/game-ir/src/index.ts";
import type { GameIRValue, ValueShape } from "../../../packages/game-ir/src/index.ts";
import { asGameEventKind } from "../../../packages/platform-contracts/src/index.ts";
import { decodeGameIRValue, encodeGameIRValue } from "../../../packages/replay/src/index.ts";
import type { JsonSafe } from "../../../packages/replay/src/index.ts";

// ---------------------------------------------------------------------------
// Vocabulary (frozen)
// ---------------------------------------------------------------------------

/** The game-declared event types (also the platform event-kind texts). */
export const EVENT_TYPES = {
  heroMoved: "run.hero.moved",
  heroLooked: "run.hero.looked",
  companionMoved: "run.companion.moved",
  moteDrifted: "run.mote.drifted",
  lumenCollected: "run.lumen.collected",
  runCompleted: "run.completed",
  socialEcho: "run.social.echo",
  vaultSealed: "run.vault.sealed",
} as const;

/** The intent/command kinds the game's driver admits. */
export const COMMAND_KINDS = {
  heroMove: "run.hero.move",
  heroLook: "run.hero.look",
  companionMove: "run.companion.move",
} as const;

/** Minted game-ir type ids (validation happens at document build). */
export const EVENT_TYPE_IDS = {
  heroMoved: asEventTypeId(EVENT_TYPES.heroMoved)!,
  heroLooked: asEventTypeId(EVENT_TYPES.heroLooked)!,
  companionMoved: asEventTypeId(EVENT_TYPES.companionMoved)!,
  moteDrifted: asEventTypeId(EVENT_TYPES.moteDrifted)!,
  lumenCollected: asEventTypeId(EVENT_TYPES.lumenCollected)!,
  runCompleted: asEventTypeId(EVENT_TYPES.runCompleted)!,
  socialEcho: asEventTypeId(EVENT_TYPES.socialEcho)!,
  vaultSealed: asEventTypeId(EVENT_TYPES.vaultSealed)!,
} as const;

/** Minted intent type ids. */
export const INTENT_TYPE_IDS = {
  heroMove: asIntentTypeId(COMMAND_KINDS.heroMove)!,
  heroLook: asIntentTypeId(COMMAND_KINDS.heroLook)!,
  companionMove: asIntentTypeId(COMMAND_KINDS.companionMove)!,
} as const;

/** The platform event kinds the game binds to platform capabilities. */
export const PLATFORM_EVENT_KINDS = {
  heroMoved: asGameEventKind(EVENT_TYPES.heroMoved)!,
  lumenCollected: asGameEventKind(EVENT_TYPES.lumenCollected)!,
  runCompleted: asGameEventKind(EVENT_TYPES.runCompleted)!,
  socialEcho: asGameEventKind(EVENT_TYPES.socialEcho)!,
} as const;

// ---------------------------------------------------------------------------
// Payload shapes (the value-language descriptions of the events)
// ---------------------------------------------------------------------------

const positionFields: Readonly<Record<string, ValueShape>> = {
  col: { kind: "int" },
  row: { kind: "int" },
  tick: { kind: "int" },
};

/** The payload shapes, keyed by event type (declaration inputs). */
export const PAYLOAD_SHAPES: Readonly<Record<string, ValueShape>> = Object.freeze({
  [EVENT_TYPES.heroMoved]: { kind: "record", fields: { ...positionFields } },
  [EVENT_TYPES.heroLooked]: { kind: "record", fields: { visible: { kind: "int" }, tick: { kind: "int" } } },
  [EVENT_TYPES.companionMoved]: { kind: "record", fields: { ...positionFields } },
  [EVENT_TYPES.moteDrifted]: { kind: "record", fields: { mote: { kind: "string" }, ...positionFields } },
  [EVENT_TYPES.lumenCollected]: { kind: "record", fields: { mote: { kind: "string" }, lumens: { kind: "int" }, tick: { kind: "int" } } },
  [EVENT_TYPES.runCompleted]: { kind: "record", fields: { score: { kind: "int" }, lumens: { kind: "int" }, tick: { kind: "int" } } },
  [EVENT_TYPES.socialEcho]: { kind: "record", fields: { actor: { kind: "string" }, target: { kind: "string" } } },
  [EVENT_TYPES.vaultSealed]: { kind: "unit" },
});

// ---------------------------------------------------------------------------
// Payload builders (GameIR values only)
// ---------------------------------------------------------------------------

function int(value: number): GameIRValue {
  return { kind: "int", value: BigInt(value) };
}

function str(value: string): GameIRValue {
  return { kind: "string", value };
}

/** A movement intent payload: the target cell. */
export function movePayload(col: number, row: number): GameIRValue {
  return { kind: "record", fields: { col: int(col), row: int(row) } };
}

/** `run.hero.moved` / `run.companion.moved` payload. */
export function movedPayload(col: number, row: number, tick: number): GameIRValue {
  return { kind: "record", fields: { col: int(col), row: int(row), tick: int(tick) } };
}

/** `run.hero.looked` payload — the arena scan result. */
export function heroLookedPayload(visible: number, tick: number): GameIRValue {
  return { kind: "record", fields: { visible: int(visible), tick: int(tick) } };
}

/** `run.mote.drifted` payload. */
export function moteDriftedPayload(mote: string, col: number, row: number, tick: number): GameIRValue {
  return { kind: "record", fields: { mote: str(mote), col: int(col), row: int(row), tick: int(tick) } };
}

/** `run.lumen.collected` payload. */
export function lumenCollectedPayload(mote: string, lumens: number, tick: number): GameIRValue {
  return { kind: "record", fields: { mote: str(mote), lumens: int(lumens), tick: int(tick) } };
}

/** `run.completed` payload — the authoritative run outcome. */
export function runCompletedPayload(score: number, lumens: number, tick: number): GameIRValue {
  return { kind: "record", fields: { score: int(score), lumens: int(lumens), tick: int(tick) } };
}

/** `run.social.echo` payload — the social evidence event's content. */
export function socialEchoPayload(actor: string, target: string): GameIRValue {
  return { kind: "record", fields: { actor: str(actor), target: str(target) } };
}

// ---------------------------------------------------------------------------
// Intent-payload transport form (the kernel's JSON-safe command wire)
// ---------------------------------------------------------------------------

/**
 * The JSON-safe tagged transport form of a GameIR value — the platform's
 * own wire encoding (@playliquid/replay's artifact codec: "the tagged,
 * JSON-safe encoding used by EVERY replay artifact").
 *
 * The Interactive Runtime fingerprints every intent payload with
 * `canonicalJson` (idempotency, E10), so the payload on the `act` wire
 * must be JSON-safe — bigint-backed GameIR ints are not. The tagged form
 * is a PROJECTION of the value language (game-ir stays the authority);
 * the driver decodes it back through {@link fromWire} before reading.
 */
export function toWire(payload: GameIRValue): JsonSafe {
  return encodeGameIRValue(payload);
}

/**
 * Decodes the tagged transport form back into the value language.
 * Fail-closed: malformed wire payloads throw (the kernel turns a driver
 * throw into a typed `failed` result — no partial state, E8).
 */
export function fromWire(payload: unknown): GameIRValue {
  return decodeGameIRValue(payload as JsonSafe);
}
