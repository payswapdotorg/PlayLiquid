/**
 * BYTE-STABLE SNAPSHOT CODEC.
 *
 * Snapshots must be byte-stable (PL-014): identical session state must
 * serialize to identical bytes on every machine, and restore must round-trip
 * exactly. GameIR values (the world-state language, see
 * @playliquid/game-ir values.ts) are NOT directly JSON-safe — their `int`
 * kind is arbitrary-precision bigint — so this module defines:
 *
 * - {@link encodeGameIRValue}: a tagged, JSON-safe encoding of any
 *   GameIRValue (deterministic: record fields encoded in sorted key order);
 * - {@link decodeGameIRValue}: the exact inverse (throws on malformed
 *   input — restore fails closed);
 * - {@link canonicalJsonString}: canonical JSON over the JSON-safe encoding
 *   (sorted object keys, no insignificant whitespace) — THE snapshot byte
 *   form.
 *
 * Floats round-trip through game-ir's frozen canonical float form
 * (`canonicalFloatForm`, imported — never duplicated), which ECMAScript
 * guarantees to be the shortest round-trip decimal.
 *
 * This codec is a transport concern of the runtime, NOT a second value
 * language: digests and value equality still use game-ir's
 * `canonicalValueForm` / `hashGameIRValue` directly.
 *
 * Pure module: no IO.
 */

import { canonicalFloatForm } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import type { EntityRef } from "@playliquid/game-contracts";
import { isEntityRef } from "@playliquid/game-contracts";

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
    throw new TypeError("codec: expected a tagged object");
  }
  const node = json as { [key: string]: JsonSafe | undefined };
  switch (node.k) {
    case "unit":
      return { kind: "unit" };
    case "bool":
      if (typeof node.v !== "boolean") throw new TypeError("codec: bool payload missing");
      return { kind: "bool", value: node.v };
    case "int":
      if (typeof node.v !== "string" || !/^-?\d+$/.test(node.v)) {
        throw new TypeError("codec: int payload malformed");
      }
      return { kind: "int", value: BigInt(node.v) };
    case "float":
      if (typeof node.v !== "string") throw new TypeError("codec: float payload missing");
      return { kind: "float", value: parseFloatForm(node.v) };
    case "string":
      if (typeof node.v !== "string") throw new TypeError("codec: string payload missing");
      return { kind: "string", value: node.v };
    case "list": {
      if (!Array.isArray(node.i)) throw new TypeError("codec: list items missing");
      return { kind: "list", items: node.i.map((item) => decodeGameIRValue(item)) };
    }
    case "record": {
      const raw = node.f;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new TypeError("codec: record fields missing");
      }
      const fields: { [key: string]: GameIRValue } = {};
      for (const key of Object.keys(raw).sort()) {
        fields[key] = decodeGameIRValue((raw as { [key: string]: JsonSafe })[key] as JsonSafe);
      }
      return { kind: "record", fields };
    }
    case "eref": {
      const ref: Record<string, unknown> = {
        world: node.w,
        scene: node.s,
        entity: node.e,
      };
      if (!isEntityRef(ref)) throw new TypeError("codec: entity-ref payload malformed");
      return { kind: "entity-ref", ref: ref as EntityRef };
    }
    default:
      throw new TypeError(`codec: unknown tag ${String(node.k)}`);
  }
}

/** Canonical JSON over JSON-safe values: sorted keys, no whitespace. */
export function canonicalJsonString(value: JsonSafe): string {
  return serialize(value);
}

function serialize(value: JsonSafe): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("codec: non-finite number is not canonicalizable");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => serialize(item)).join(",")}]`;
  const record = value as { readonly [key: string]: JsonSafe };
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key] as JsonSafe)}`);
  return `{${parts.join(",")}}`;
}
