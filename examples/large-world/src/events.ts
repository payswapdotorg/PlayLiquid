/**
 * LATTICE — the world's semantic event vocabulary (PL-039).
 *
 * ONE declaration site for the world-declared semantics (lock rule 18):
 * event types, the intent/command kind and payload shapes live here as
 * frozen data; the GameIR document's rule/event-declaration nodes, the
 * simulation binding's command policy and the payload builders are all
 * PROJECTIONS of this vocabulary.
 *
 * Payloads are GameIR values (R14: the engine-independent value
 * language). The vocabulary is intentionally small: the streaming
 * reference needs movement, chunk lifecycle and ecology events only.
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { asEventTypeId, asIntentTypeId } from "../../../packages/game-ir/src/index.ts";
import type { GameIRValue, ValueShape } from "../../../packages/game-ir/src/index.ts";

// ---------------------------------------------------------------------------
// Vocabulary (frozen)
// ---------------------------------------------------------------------------

/** The world-declared event types. */
export const EVENT_TYPES = {
  viewMoved: "lattice.view.moved",
  chunkLoaded: "lattice.chunk.loaded",
  chunkUnloaded: "lattice.chunk.unloaded",
  entityDrifted: "lattice.entity.drifted",
} as const;

/** The intent/command kind the viewpoint agent drives. */
export const COMMAND_KINDS = {
  viewMove: "lattice.view.move",
} as const;

/** Minted game-ir event type ids (document declaration inputs). */
export const EVENT_TYPE_IDS = {
  viewMoved: asEventTypeId(EVENT_TYPES.viewMoved)!,
  chunkLoaded: asEventTypeId(EVENT_TYPES.chunkLoaded)!,
  chunkUnloaded: asEventTypeId(EVENT_TYPES.chunkUnloaded)!,
  entityDrifted: asEventTypeId(EVENT_TYPES.entityDrifted)!,
} as const;

/** Minted intent type ids. */
export const INTENT_TYPE_IDS = {
  viewMove: asIntentTypeId(COMMAND_KINDS.viewMove)!,
} as const;

/** The capability the host game policy grants the viewpoint agent. */
export const VIEWPOINT_CAPABILITY = "lattice.view.locomotion" as const;

/** The grant id the host issues for that capability (epoch-scoped). */
export const VIEWPOINT_GRANT_ID = "grant-lattice-view-locomotion" as const;

// ---------------------------------------------------------------------------
// Payload shapes (the value-language descriptions of the events)
// ---------------------------------------------------------------------------

const tickShape: ValueShape = { kind: "int" };

/** The payload shapes, keyed by event type (declaration inputs). */
export const PAYLOAD_SHAPES: Readonly<Record<string, ValueShape>> = Object.freeze({
  [EVENT_TYPES.viewMoved]: { kind: "record", fields: { x: { kind: "float" }, y: { kind: "float" }, tick: tickShape } },
  [EVENT_TYPES.chunkLoaded]: {
    kind: "record",
    fields: { chunk: { kind: "string" }, region: { kind: "string" }, zone: { kind: "string" }, source: { kind: "string" }, tick: tickShape },
  },
  [EVENT_TYPES.chunkUnloaded]: { kind: "record", fields: { chunk: { kind: "string" }, checkpoint: { kind: "string" }, tick: tickShape } },
  [EVENT_TYPES.entityDrifted]: { kind: "record", fields: { entity: { kind: "string" }, x: { kind: "float" }, y: { kind: "float" }, tick: tickShape } },
});

// ---------------------------------------------------------------------------
// Payload builders (GameIR values only)
// ---------------------------------------------------------------------------

function int(value: number): GameIRValue {
  return { kind: "int", value: BigInt(value) };
}

function float(value: number): GameIRValue {
  return { kind: "float", value };
}

function str(value: string): GameIRValue {
  return { kind: "string", value };
}

/** A viewpoint move intent payload: the world-plane delta. */
export function movePayload(dx: number, dy: number): GameIRValue {
  return { kind: "record", fields: { dx: float(dx), dy: float(dy) } };
}

/** `lattice.view.moved` payload. */
export function viewMovedPayload(x: number, y: number, tick: number): GameIRValue {
  return { kind: "record", fields: { x: float(x), y: float(y), tick: int(tick) } };
}

/** `lattice.chunk.loaded` payload — `source` is `cas` or `checkpoint`. */
export function chunkLoadedPayload(chunk: string, region: string, zone: string, source: "cas" | "checkpoint", tick: number): GameIRValue {
  return {
    kind: "record",
    fields: { chunk: str(chunk), region: str(region), zone: str(zone), source: str(source), tick: int(tick) },
  };
}

/**
 * `lattice.chunk.unloaded` payload — `checkpoint` is the content digest of
 * the dormant checkpoint that now carries the chunk, or `discarded` when
 * the chunk's contract is not cacheable (dormant as static only).
 */
export function chunkUnloadedPayload(chunk: string, checkpoint: string, tick: number): GameIRValue {
  return { kind: "record", fields: { chunk: str(chunk), checkpoint: str(checkpoint), tick: int(tick) } };
}

/** `lattice.entity.drifted` payload. */
export function entityDriftedPayload(entity: string, x: number, y: number, tick: number): GameIRValue {
  return { kind: "record", fields: { entity: str(entity), x: float(x), y: float(y), tick: int(tick) } };
}

/** A 3-float position list value. */
export function positionValue(position: readonly [number, number, number]): GameIRValue {
  return { kind: "list", items: [float(position[0]), float(position[1]), float(position[2])] };
}

/** Reads a 3-float position field of a record value (fail closed). */
export function readPositionValue(value: GameIRValue): readonly [number, number, number] {
  if (value.kind !== "record") throw new Error("lattice: expected a record value");
  const position = value.fields.position;
  if (position === undefined || position.kind !== "list" || position.items.length !== 3) {
    throw new Error("lattice: expected a 3-float position field");
  }
  const coords = position.items.map((item) => {
    if (item.kind !== "float") throw new Error("lattice: position items must be floats");
    return item.value;
  });
  return [coords[0]!, coords[1]!, coords[2]!];
}
