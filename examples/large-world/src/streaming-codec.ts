/**
 * LARGE WORLD — the streaming value codec (PL-039).
 *
 * The GameIR-value read/write helpers for the streaming carriers and
 * the dormant-checkpoint ledger, plus their decoded read models.
 * Extracted from streaming.ts at promotion (wave 20) to hold the
 * 400-raw-line architecture limit — the codec is the leaf, streaming
 * state-machine logic imports from here (one-way, cycle-free).
 *
 * Pure module: no IO, no clock (E9).
 */

import { asEntityId } from "../../../packages/game-contracts/src/index.ts";
import type { GameIRValue } from "../../../packages/game-ir/src/index.ts";

// ---------------------------------------------------------------------------
// Carrier pseudo-entity ids (canonical, model-relative)
// ---------------------------------------------------------------------------

export const STREAMING_STATE_ENTITY = asEntityId("streaming-state")!;
export const STREAMING_DORMANT_ENTITY = asEntityId("streaming-dormant")!;

// ---------------------------------------------------------------------------
// Value-language read/write helpers (fail closed)
// ---------------------------------------------------------------------------

export function fieldsOf(value: GameIRValue): { [key: string]: GameIRValue } {
  if (value.kind !== "record") throw new Error("lattice: world state must be a record value");
  return { ...value.fields };
}

export function readField(value: GameIRValue, field: string): GameIRValue {
  if (value.kind !== "record" || value.fields[field] === undefined) {
    throw new Error(`lattice: expected field ${field}`);
  }
  return value.fields[field]!;
}

/**
 * Reads one carrier record out of a world state by its pseudo-entity id
 * (fail closed: exactly one canonical path must end in the carrier id).
 */
export function carrierField(state: GameIRValue, entity: string): GameIRValue {
  if (state.kind !== "record") throw new Error("lattice: world state must be a record value");
  const matches = Object.keys(state.fields).filter((key) => key.endsWith(`/entity/${entity}`));
  if (matches.length !== 1) {
    throw new Error(`lattice: expected exactly one ${entity} carrier record, found ${String(matches.length)}`);
  }
  return state.fields[matches[0]!]!;
}

export function readInt(value: GameIRValue, field: string): number {
  const item = readField(value, field);
  if (item.kind !== "int") throw new Error(`lattice: field ${field} must be an int`);
  return Number(item.value);
}

export function readStringList(value: GameIRValue, field: string): readonly string[] {
  const item = readField(value, field);
  if (item.kind !== "list" || !item.items.every((entry) => entry.kind === "string")) {
    throw new Error(`lattice: field ${field} must be a list of strings`);
  }
  return item.items.map((entry) => (entry.kind === "string" ? entry.value : ""));
}

export function stringValue(value: string): GameIRValue {
  return { kind: "string", value };
}

export function intValue(value: number): GameIRValue {
  return { kind: "int", value: BigInt(value) };
}

// ---------------------------------------------------------------------------
// Runtime streaming state (§World: positions/residency are RUNTIME state)
// ---------------------------------------------------------------------------

/** The decoded streaming runtime state. */
export interface StreamingView {
  readonly resident: readonly string[];
  readonly loads: number;
  readonly unloads: number;
  readonly casFetches: number;
  readonly checkpointReloads: number;
}

/** Reads the streaming view out of a world-state record. */
export function readStreamingView(state: GameIRValue): StreamingView {
  const field = carrierField(state, STREAMING_STATE_ENTITY);
  return {
    resident: readStringList(field, "resident"),
    loads: readInt(field, "loads"),
    unloads: readInt(field, "unloads"),
    casFetches: readInt(field, "casFetches"),
    checkpointReloads: readInt(field, "checkpointReloads"),
  };
}

export function streamingStateValue(resident: readonly string[], view: StreamingView): GameIRValue {
  return {
    kind: "record",
    fields: {
      resident: { kind: "list", items: [...resident].sort().map(stringValue) },
      loads: intValue(view.loads),
      unloads: intValue(view.unloads),
      casFetches: intValue(view.casFetches),
      checkpointReloads: intValue(view.checkpointReloads),
    },
  };
}

// ---------------------------------------------------------------------------
// Dormant checkpoints (dormant chunks carried as static + checkpoints)
// ---------------------------------------------------------------------------

/** One dormant-chunk checkpoint (the chunk's last live entity states). */
export interface DormantCheckpoint {
  readonly digest: string;
  readonly entities: readonly { readonly key: string; readonly state: GameIRValue }[];
}

export function readDormantLedger(state: GameIRValue): Map<string, DormantCheckpoint> {
  const ledger = new Map<string, DormantCheckpoint>();
  const field = carrierField(state, STREAMING_DORMANT_ENTITY);
  if (field.kind !== "record") throw new Error("lattice: dormant ledger must be a record");
  for (const [chunkId, entry] of Object.entries(field.fields)) {
    if (entry === undefined || entry.kind !== "record") continue;
    const digest = readField(entry, "digest");
    const entities = readField(entry, "entities");
    if (digest.kind !== "string" || entities.kind !== "record") continue;
    ledger.set(chunkId, {
      digest: digest.value,
      entities: Object.entries(entities.fields).flatMap(([key, value]) => (value === undefined ? [] : [{ key, state: value }])),
    });
  }
  return ledger;
}

export function dormantLedgerValue(ledger: ReadonlyMap<string, DormantCheckpoint>): GameIRValue {
  const fields: { [key: string]: GameIRValue } = {};
  for (const chunkId of [...ledger.keys()].sort()) {
    const checkpoint = ledger.get(chunkId)!;
    const entityFields: { [key: string]: GameIRValue } = {};
    for (const entity of checkpoint.entities) {
      entityFields[entity.key] = entity.state;
    }
    fields[chunkId] = {
      kind: "record",
      fields: { digest: stringValue(checkpoint.digest), entities: { kind: "record", fields: entityFields } },
    };
  }
  return { kind: "record", fields };
}

/** The dormant (checkpoint-carrying) chunk ids of a world state (sorted). */
export function dormantChunkIds(state: GameIRValue): readonly string[] {
  return [...readDormantLedger(state).keys()].sort();
}
