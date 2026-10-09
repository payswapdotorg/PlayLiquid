/**
 * THE SIMULATION WORLD MODEL.
 *
 * Static world definition and mutable runtime state are distinct
 * (spec/architecture.md "World"). The static side is the
 * {@link WorldBlueprint}: entity initial states keyed by canonical entity
 * reference path, plus the optional GameIR spatial partitioning descriptor.
 * The mutable side is the {@link WorldState}: a GameIR record value whose
 * fields are keyed by the same canonical entity path — so the whole world
 * state is ONE GameIR value, and game-ir's canonicalization and hashing
 * (evaluate.ts) give it byte-stable digests for free.
 *
 * Scalability-by-construction: the partitioning descriptor is projected by
 * planning.ts into partition-aware step plans (World → Region → Zone →
 * Chunk hierarchy via game-contracts spatial types, R15) — a pure
 * query/planning layer; no threading happens here.
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import { canonicalRefPath } from "@playliquid/game-contracts";
import type { EntityRef, SpatialPartitionDescriptor } from "@playliquid/game-contracts";
import { hashGameIRValue } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import type { Digest } from "@playliquid/runtime-contracts";
import { asDigest } from "@playliquid/runtime-contracts";

/** Canonical, stable key of an entity inside the world state record. */
export function entityKey(ref: EntityRef): string {
  return canonicalRefPath(ref);
}

/** The static definition of one simulated entity. */
export interface WorldEntityBlueprint {
  readonly ref: EntityRef;
  /** Initial mutable state (a GameIR record value, game-defined). */
  readonly state: GameIRValue;
}

/**
 * The static world definition a simulation session loads. Partitioning is
 * the GameIR spatial partition descriptor (uniform-grid / quadtree /
 * octree / explicit) attached to world nodes.
 */
export interface WorldBlueprint {
  readonly entities: readonly WorldEntityBlueprint[];
  readonly partitioning?: SpatialPartitionDescriptor;
}

/**
 * The mutable world runtime state: a GameIR record value mapping canonical
 * entity paths to per-entity GameIR state values.
 */
export type WorldState = GameIRValue;

/** Builds the initial world state from a blueprint (deterministic). */
export function initialWorldState(blueprint: WorldBlueprint): WorldState {
  const fields: { [key: string]: GameIRValue } = {};
  for (const entity of blueprint.entities) {
    const key = entityKey(entity.ref);
    if (fields[key] !== undefined) {
      throw new RangeError(`duplicate entity key in blueprint: ${key}`);
    }
    fields[key] = entity.state;
  }
  return { kind: "record", fields };
}

/** Digest (sha256 hex) of the canonical world-state form — byte-stable. */
export function worldStateDigest(state: WorldState): Digest {
  return asDigest(hashGameIRValue(state));
}

/** Reads one entity's state out of the world record (or undefined). */
export function entityStateOf(state: WorldState, ref: EntityRef): GameIRValue | undefined {
  if (state.kind !== "record") return undefined;
  return state.fields[entityKey(ref)];
}

/** Returns a new world record with one entity's state replaced (pure). */
export function withEntityState(state: WorldState, ref: EntityRef, next: GameIRValue): WorldState {
  if (state.kind !== "record") {
    throw new TypeError("world: expected a record world state");
  }
  const key = entityKey(ref);
  if (state.fields[key] === undefined) {
    throw new RangeError(`world: no such entity ${key}`);
  }
  return { kind: "record", fields: { ...state.fields, [key]: next } };
}

/** All entity keys in sorted order (deterministic iteration). */
export function entityKeys(state: WorldState): readonly string[] {
  if (state.kind !== "record") return [];
  return Object.keys(state.fields).sort();
}

/**
 * A convenience read of a 3-float `position` field of an entity state, as
 * used by the demo systems and by partition planning. Returns undefined
 * when the entity or its position is not a 3-item float list.
 */
export function entityPosition(state: WorldState, ref: EntityRef): readonly [number, number, number] | undefined {
  const entity = entityStateOf(state, ref);
  if (entity === undefined || entity.kind !== "record") return undefined;
  const position = entity.fields.position;
  if (
    position === undefined ||
    position.kind !== "list" ||
    position.items.length !== 3 ||
    !position.items.every((item) => item.kind === "float")
  ) {
    return undefined;
  }
  const first = position.items[0];
  const second = position.items[1];
  const third = position.items[2];
  if (first === undefined || second === undefined || third === undefined) return undefined;
  return [first.value, second.value, third.value];
}
