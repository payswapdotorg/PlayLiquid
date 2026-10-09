/**
 * REPLAY ARTIFACT CODEC — the platform artifact byte format (PL-014).
 *
 * Replay records, command streams and event witnesses must be byte-stable
 * and content-addressed (lock 9 / E7 / E9): identical artifacts serialize to
 * identical canonical bytes on every machine. GameIR values (the payload
 * language) are NOT directly JSON-safe — `int` is arbitrary-precision
 * bigint — so this module defines the tagged, JSON-safe encoding used by
 * EVERY replay artifact:
 *
 * - {@link encodeGameIRValue} / {@link decodeGameIRValue}: value ⇄ tagged
 *   JSON-safe form (floats round-trip through game-ir's frozen
 *   `canonicalFloatForm`; entity-refs validate through game-contracts'
 *   `isEntityRef` — game-ir remains the value-language authority, this is
 *   only its transport form);
 * - {@link encodeCommandEnvelope} / {@link decodeCommandEnvelope}: the
 *   canonical command envelope (E2's command side) as JSON-safe data;
 * - {@link encodeEventEnvelope} / {@link decodeEventEnvelope}: the canonical
 *   event envelope (E2's event side) as JSON-safe data.
 *
 * Canonical BYTES are produced by @playliquid/package-system's
 * `canonicalJson` (sorted keys, no whitespace) over these forms — never by
 * ad-hoc JSON.stringify. Decoding fails closed on malformed input.
 *
 * Pure module: no IO.
 */

import { canonicalFloatForm } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import { isEntityRef } from "@playliquid/game-contracts";
import type { EntityRef } from "@playliquid/game-contracts";
import type {
  EventCause,
  RuntimeCommandEnvelope,
  RuntimeEventEnvelope,
} from "@playliquid/runtime-contracts";
import {
  asCapabilityGrantId,
  asCommandId,
  asCommandKind,
  asEventId,
  asEventKind,
  asEventSequence,
  asIdempotencyNonce,
  asSessionId,
  asTick,
  asTimestamp,
} from "@playliquid/runtime-contracts";

/** A JSON-safe value (what the tagged encoding targets). */
export type JsonSafe = null | boolean | number | string | readonly JsonSafe[] | { readonly [key: string]: JsonSafe };

/** Encodes a GameIRValue into its tagged JSON-safe form. */
export function encodeGameIRValue(value: GameIRValue): JsonSafe {
  switch (value.kind) {
    case "unit":
      return { k: "unit" };
    case "bool":
      return { k: "bool", v: value.value };
    case "int":
      return { k: "int", v: value.value.toString(10) };
    case "float":
      return { k: "float", v: canonicalFloatForm(value.value) };
    case "string":
      return { k: "string", v: value.value };
    case "list":
      return { k: "list", i: value.items.map((item) => encodeGameIRValue(item)) };
    case "record": {
      const fields: { [key: string]: JsonSafe } = {};
      for (const key of Object.keys(value.fields).sort()) {
        fields[key] = encodeGameIRValue(value.fields[key] as GameIRValue);
      }
      return { k: "record", f: fields };
    }
    case "entity-ref":
      return { k: "eref", w: value.ref.world, s: value.ref.scene, e: value.ref.entity };
  }
}

function parseFloatForm(form: string): number {
  switch (form) {
    case "nan":
      return Number.NaN;
    case "inf":
      return Number.POSITIVE_INFINITY;
    case "-inf":
      return Number.NEGATIVE_INFINITY;
    default:
      return Number(form);
  }
}

/** Decodes the tagged form back into a GameIRValue. Throws on malformed input. */
export function decodeGameIRValue(json: JsonSafe): GameIRValue {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new TypeError("artifact-codec: expected a tagged object");
  }
  const node = json as { [key: string]: JsonSafe | undefined };
  switch (node.k) {
    case "unit":
      return { kind: "unit" };
    case "bool":
      if (typeof node.v !== "boolean") throw new TypeError("artifact-codec: bool payload missing");
      return { kind: "bool", value: node.v };
    case "int":
      if (typeof node.v !== "string" || !/^-?\d+$/.test(node.v)) {
        throw new TypeError("artifact-codec: int payload malformed");
      }
      return { kind: "int", value: BigInt(node.v) };
    case "float":
      if (typeof node.v !== "string") throw new TypeError("artifact-codec: float payload missing");
      return { kind: "float", value: parseFloatForm(node.v) };
    case "string":
      if (typeof node.v !== "string") throw new TypeError("artifact-codec: string payload missing");
      return { kind: "string", value: node.v };
    case "list": {
      if (!Array.isArray(node.i)) throw new TypeError("artifact-codec: list items missing");
      return { kind: "list", items: node.i.map((item) => decodeGameIRValue(item)) };
    }
    case "record": {
      const raw = node.f;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new TypeError("artifact-codec: record fields missing");
      }
      const fields: { [key: string]: GameIRValue } = {};
      for (const key of Object.keys(raw).sort()) {
        fields[key] = decodeGameIRValue((raw as { [key: string]: JsonSafe })[key] as JsonSafe);
      }
      return { kind: "record", fields };
    }
    case "eref": {
      const ref: Record<string, unknown> = { world: node.w, scene: node.s, entity: node.e };
      if (!isEntityRef(ref)) throw new TypeError("artifact-codec: entity-ref payload malformed");
      return { kind: "entity-ref", ref: ref as EntityRef };
    }
    default:
      throw new TypeError(`artifact-codec: unknown tag ${String(node.k)}`);
  }
}

// ---------------------------------------------------------------------------
// Command envelopes (the E2 command side)
// ---------------------------------------------------------------------------

function encodeOrigin(origin: RuntimeCommandEnvelope<GameIRValue>["origin"]): JsonSafe {
  if (origin.kind === "broker-mediated") {
    return { kind: "broker-mediated", grantId: origin.grantId };
  }
  return { kind: origin.kind };
}

function decodeOrigin(origin: JsonSafe): RuntimeCommandEnvelope<GameIRValue>["origin"] {
  if (typeof origin !== "object" || origin === null || Array.isArray(origin)) {
    throw new TypeError("artifact-codec: malformed command origin");
  }
  const node = origin as { [key: string]: JsonSafe | undefined };
  if (node.kind !== "player-input" && node.kind !== "platform-system" && node.kind !== "host-authority" && node.kind !== "broker-mediated") {
    throw new TypeError(`artifact-codec: unknown command origin ${String(node.kind)}`);
  }
  if (node.kind === "broker-mediated") {
    if (typeof node.grantId !== "string") throw new TypeError("artifact-codec: broker origin missing grantId");
    return { kind: "broker-mediated", grantId: asCapabilityGrantId(node.grantId) };
  }
  return { kind: node.kind };
}

/** Encodes a canonical command envelope into JSON-safe artifact data. */
export function encodeCommandEnvelope(envelope: RuntimeCommandEnvelope<GameIRValue>): JsonSafe {
  return {
    commandId: envelope.commandId,
    sessionId: envelope.sessionId,
    kind: envelope.kind,
    epoch: Number(envelope.epoch),
    actor: { actorClass: envelope.actor.actorClass, actorId: envelope.actor.actorId },
    origin: encodeOrigin(envelope.origin),
    idempotencyKey: {
      scope: envelope.idempotencyKey.scope,
      actor: envelope.idempotencyKey.actor,
      nonce: envelope.idempotencyKey.nonce,
    },
    issuedAt: Number(envelope.issuedAt),
    payload: encodeGameIRValue(envelope.payload),
  };
}

/** Decodes a command envelope from JSON-safe artifact data (fail closed). */
export function decodeCommandEnvelope(json: JsonSafe): RuntimeCommandEnvelope<GameIRValue> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new TypeError("artifact-codec: malformed command envelope");
  }
  const node = json as { [key: string]: JsonSafe | undefined };
  if (typeof node.commandId !== "string" || typeof node.sessionId !== "string" || typeof node.kind !== "string") {
    throw new TypeError("artifact-codec: command envelope identity missing");
  }
  if (typeof node.epoch !== "number" || !Number.isInteger(node.epoch) || node.epoch < 0) {
    throw new TypeError("artifact-codec: command envelope epoch malformed");
  }
  if (typeof node.issuedAt !== "number" || !Number.isInteger(node.issuedAt)) {
    throw new TypeError("artifact-codec: command envelope issuedAt malformed");
  }
  const actor = node.actor;
  if (typeof actor !== "object" || actor === null || Array.isArray(actor) || typeof (actor as { actorClass?: JsonSafe }).actorClass !== "string" || typeof (actor as { actorId?: JsonSafe }).actorId !== "string") {
    throw new TypeError("artifact-codec: command envelope actor malformed");
  }
  const actorNode = actor as { actorClass: string; actorId: string };
  const key = node.idempotencyKey;
  if (typeof key !== "object" || key === null || Array.isArray(key)) {
    throw new TypeError("artifact-codec: command envelope idempotency key missing");
  }
  const keyNode = key as { [key: string]: JsonSafe | undefined };
  if (typeof keyNode.scope !== "string" || typeof keyNode.actor !== "string" || typeof keyNode.nonce !== "string") {
    throw new TypeError("artifact-codec: command envelope idempotency key malformed");
  }
  if (keyNode.scope !== "command" && keyNode.scope !== "action" && keyNode.scope !== "job-enqueue" && keyNode.scope !== "job-checkpoint") {
    throw new TypeError(`artifact-codec: unknown idempotency scope ${String(keyNode.scope)}`);
  }
  if (node.payload === undefined) {
    throw new TypeError("artifact-codec: command envelope payload missing");
  }
  return {
    commandId: asCommandId(node.commandId),
    sessionId: asSessionId(node.sessionId),
    kind: asCommandKind(node.kind),
    epoch: node.epoch as RuntimeCommandEnvelope<GameIRValue>["epoch"],
    actor: {
      actorClass: actorNode.actorClass as RuntimeCommandEnvelope<GameIRValue>["actor"]["actorClass"],
      actorId: actorNode.actorId as RuntimeCommandEnvelope<GameIRValue>["actor"]["actorId"],
    },
    origin: decodeOrigin(node.origin as JsonSafe),
    idempotencyKey: {
      scope: keyNode.scope as RuntimeCommandEnvelope<GameIRValue>["idempotencyKey"]["scope"],
      actor: keyNode.actor as RuntimeCommandEnvelope<GameIRValue>["idempotencyKey"]["actor"],
      nonce: asIdempotencyNonce(keyNode.nonce),
    },
    issuedAt: asTimestamp(node.issuedAt),
    payload: decodeGameIRValue(node.payload),
  };
}

// ---------------------------------------------------------------------------
// Event envelopes (the E2 event side)
// ---------------------------------------------------------------------------

function encodeCause(cause: EventCause): JsonSafe {
  if (cause.kind === "command") {
    return { kind: "command", commandId: cause.commandId };
  }
  if (cause.kind === "event") {
    return { kind: "event", causedByEventId: cause.causedByEventId };
  }
  return { kind: "system" };
}

function decodeCause(cause: JsonSafe): EventCause {
  if (typeof cause !== "object" || cause === null || Array.isArray(cause)) {
    throw new TypeError("artifact-codec: malformed event cause");
  }
  const node = cause as { [key: string]: JsonSafe | undefined };
  if (node.kind === "system") return { kind: "system" };
  if (node.kind === "command") {
    if (typeof node.commandId !== "string") throw new TypeError("artifact-codec: command cause missing commandId");
    return { kind: "command", commandId: asCommandId(node.commandId) };
  }
  if (node.kind === "event") {
    if (typeof node.causedByEventId !== "string") throw new TypeError("artifact-codec: event cause missing causedByEventId");
    return { kind: "event", causedByEventId: asEventId(node.causedByEventId) };
  }
  throw new TypeError(`artifact-codec: unknown event cause ${String(node.kind)}`);
}

/** Encodes a canonical event envelope into JSON-safe artifact data. */
export function encodeEventEnvelope(envelope: RuntimeEventEnvelope<GameIRValue>): JsonSafe {
  return {
    eventId: envelope.eventId,
    sessionId: envelope.sessionId,
    kind: envelope.kind,
    seq: Number(envelope.seq),
    tick: Number(envelope.tick),
    cause: encodeCause(envelope.cause),
    payload: encodeGameIRValue(envelope.payload),
  };
}

/** Decodes an event envelope from JSON-safe artifact data (fail closed). */
export function decodeEventEnvelope(json: JsonSafe): RuntimeEventEnvelope<GameIRValue> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new TypeError("artifact-codec: malformed event envelope");
  }
  const node = json as { [key: string]: JsonSafe | undefined };
  if (typeof node.eventId !== "string" || typeof node.sessionId !== "string" || typeof node.kind !== "string") {
    throw new TypeError("artifact-codec: event envelope identity missing");
  }
  if (typeof node.seq !== "number" || !Number.isInteger(node.seq) || node.seq < 1) {
    throw new TypeError("artifact-codec: event envelope seq malformed");
  }
  if (typeof node.tick !== "number" || !Number.isInteger(node.tick) || node.tick < 0) {
    throw new TypeError("artifact-codec: event envelope tick malformed");
  }
  if (node.payload === undefined || node.cause === undefined) {
    throw new TypeError("artifact-codec: event envelope payload or cause missing");
  }
  return {
    eventId: asEventId(node.eventId),
    sessionId: asSessionId(node.sessionId),
    kind: asEventKind(node.kind),
    seq: asEventSequence(node.seq),
    tick: asTick(node.tick),
    cause: decodeCause(node.cause),
    payload: decodeGameIRValue(node.payload),
  };
}
