/**
 * THE DEMO GAME BINDING — in-memory fake systems and world fixture.
 *
 * A tiny deterministic "game" used by this package's tests/harness and by
 * the replay package's re-execution equality tests: three entities with
 * float positions and integer health, partitioned on a uniform grid, plus
 * three systems that exercise every determinism surface:
 *
 * - `motion`: applies `world.move` commands (payload carries an entity-ref
 *   target and a 3-float delta) and emits `world.entity.moved` with the
 *   command as cause;
 * - `drift`: every tick nudges every entity position by a seeded-RNG draw
 *   (the E9 reproducibility surface — same seed, same trajectories) and
 *   emits `world.entity.drifted`;
 * - `decay`: decrements health every tick and emits `world.entity.perished`
 *   exactly once per entity when health reaches zero.
 *
 * All fixtures use fragment-assembled digest strings (repeated short hex
 * fragments — no secret-shaped literals).
 *
 * Pure module: systems are pure functions; no IO, no clocks.
 */

import { asCapabilityGrantId, asCapabilityId, asActorId, asCommandId, asDeterminismSeed, asDigest, asSessionEpoch, asSessionId } from "@playliquid/runtime-contracts";
import type {
  CapabilityGrant,
  DeterminismSeed,
  IntentKind,
} from "@playliquid/runtime-contracts";
import { asGameIrDigest } from "@playliquid/runtime-contracts";
import {
  asAgentId,
  asAvatarId,
  asEntityId,
  asSceneId,
  asWorldId,
} from "@playliquid/game-contracts";
import type { EntityRef } from "@playliquid/game-contracts";
import type { CommandTypeId, GameEvent, GameIRValue } from "@playliquid/game-ir";
import { asEventTypeId } from "@playliquid/game-ir";
import type { WorldSystem } from "./kernel.ts";
import type { WorldBlueprint } from "./world.ts";
import { entityStateOf, withEntityState } from "./world.ts";
import type { SimulationGameBinding } from "./session-types.ts";

// Fragment-assembled digests (never secret-shaped literals).
const fragment = (char: string): string => char.repeat(64);
const GAME_DIGEST = asGameIrDigest(fragment("9"));
const WORLD_REVISION = asDigest(fragment("7"));
const POLICY_REVISION = asDigest(fragment("5"));

export const DEMO_WORLD_ID = asWorldId("world-primus")!;
export const DEMO_SCENE_ID = asSceneId("scene-overworld")!;
export const DEMO_ENTITY_HERO = asEntityId("entity-hero")!;
export const DEMO_ENTITY_COMPANION = asEntityId("entity-companion")!;
export const DEMO_ENTITY_BEACON = asEntityId("entity-beacon")!;
export const DEMO_AGENT_ID = asAgentId("agent-atlas")!;
export const DEMO_AVATAR_ID = asAvatarId("avatar-nova")!;
/** The actor id of the demo avatar agent inside the runtime actor space. */
export const DEMO_ACTOR_ID = asActorId("actor-avatar-nova");;

/** Canonical entity refs of the demo world. */
export function demoEntityRefs(): readonly EntityRef[] {
  return [
    { world: DEMO_WORLD_ID, scene: DEMO_SCENE_ID, entity: DEMO_ENTITY_HERO },
    { world: DEMO_WORLD_ID, scene: DEMO_SCENE_ID, entity: DEMO_ENTITY_COMPANION },
    { world: DEMO_WORLD_ID, scene: DEMO_SCENE_ID, entity: DEMO_ENTITY_BEACON },
  ];
}

function entityState(position: readonly [number, number, number], health: number): GameIRValue {
  return {
    kind: "record",
    fields: {
      position: {
        kind: "list",
        items: [
          { kind: "float", value: position[0] },
          { kind: "float", value: position[1] },
          { kind: "float", value: position[2] },
        ],
      },
      health: { kind: "int", value: BigInt(health) },
      perished: { kind: "bool", value: false },
    },
  };
}

/** The demo world blueprint (uniform-grid partitioned, R15). */
export function demoBlueprint(): WorldBlueprint {
  return {
    entities: [
      { ref: demoEntityRefs()[0]!, state: entityState([2, 2, 2], 12) },
      { ref: demoEntityRefs()[1]!, state: entityState([18, 2, 2], 30) },
      { ref: demoEntityRefs()[2]!, state: entityState([34, 18, 2], 6) },
    ],
    partitioning: {
      scheme: "uniform-grid",
      cellSize: [16, 16, 16],
      bounds: { min: [0, 0, 0], max: [64, 64, 64] },
    },
  };
}

/** The `world.move` intent/command payload shape (game-defined). */
export function movePayload(ref: EntityRef, delta: readonly [number, number, number]): GameIRValue {
  return {
    kind: "record",
    fields: {
      target: { kind: "entity-ref", ref },
      delta: {
        kind: "list",
        items: [
          { kind: "float", value: delta[0] },
          { kind: "float", value: delta[1] },
          { kind: "float", value: delta[2] },
        ],
      },
    },
  };
}

const MOVED_EVENT = asEventTypeId("world.entity.moved")!;
const DRIFTED_EVENT = asEventTypeId("world.entity.drifted")!;
const PERISHED_EVENT = asEventTypeId("world.entity.perished")!;
const MOVE_COMMAND_TYPE = "world.move" as CommandTypeId;

interface MovePayloadShape {
  readonly target?: EntityRef;
  readonly delta?: readonly GameIRValue[];
}

function readMovePayload(payload: GameIRValue): MovePayloadShape {
  if (payload.kind !== "record") return {};
  const target = payload.fields.target;
  const delta = payload.fields.delta;
  return {
    target: target !== undefined && target.kind === "entity-ref" ? target.ref : undefined,
    delta: delta !== undefined && delta.kind === "list" ? delta.items : undefined,
  };
}

function floatOf(item: GameIRValue | undefined, fallback: number): number {
  return item !== undefined && item.kind === "float" ? item.value : fallback;
}

function positionRecord(position: readonly [number, number, number]): GameIRValue {
  return {
    kind: "list",
    items: [
      { kind: "float", value: position[0] },
      { kind: "float", value: position[1] },
      { kind: "float", value: position[2] },
    ],
  };
}

function readPosition(state: GameIRValue): readonly [number, number, number] {
  if (state.kind !== "record") return [0, 0, 0];
  const position = state.fields.position;
  if (position === undefined || position.kind !== "list" || position.items.length !== 3) {
    return [0, 0, 0];
  }
  return [
    floatOf(position.items[0], 0),
    floatOf(position.items[1], 0),
    floatOf(position.items[2], 0),
  ];
}

function eventOf(type: GameEvent["type"], payload: GameIRValue, tick: number, source?: EntityRef): GameEvent {
  return source !== undefined ? { type, payload, tick, source } : { type, payload, tick };
}

/** The demo systems, in declared execution order. */
export function demoSystems(): readonly WorldSystem[] {
  const motion: WorldSystem = {
    systemId: "motion",
    tick: (input) => {
      let state = input.state;
      const events: { event: GameEvent; cause: { kind: "command"; commandId: ReturnType<typeof asCommandId> } }[] = [];
      for (const command of input.commands) {
        if (String(command.kind) !== MOVE_COMMAND_TYPE) continue;
        const payload = readMovePayload(command.payload);
        if (payload.target === undefined || payload.delta === undefined || payload.delta.length !== 3) {
          continue;
        }
        const current = entityStateOf(state, payload.target);
        if (current === undefined || current.kind !== "record") continue;
        const position = readPosition(current);
        const next: readonly [number, number, number] = [
          position[0] + floatOf(payload.delta[0], 0),
          position[1] + floatOf(payload.delta[1], 0),
          position[2] + floatOf(payload.delta[2], 0),
        ];
        state = withEntityState(state, payload.target, {
          kind: "record",
          fields: { ...current.fields, position: positionRecord(next) },
        });
        events.push({
          event: eventOf(MOVED_EVENT, { kind: "record", fields: { position: positionRecord(next) } }, input.tick, payload.target),
          cause: { kind: "command", commandId: asCommandId(command.commandId) },
        });
      }
      return { state, events };
    },
  };

  const drift: WorldSystem = {
    systemId: "drift",
    tick: (input) => {
      let state = input.state;
      const events: { event: GameEvent; cause: { kind: "system" } }[] = [];
      // Keys are computed once: systems only replace field VALUES, never
      // add or remove entities, so the key set is stable across mutations.
      const keys = state.kind === "record" ? Object.keys(state.fields).sort() : [];
      for (const key of keys) {
        const ref = keyToRef(key);
        if (ref === undefined) continue;
        if (state.kind !== "record") break;
        const current = state.fields[key];
        if (current === undefined || current.kind !== "record") continue;
        const position = readPosition(current);
        const next: readonly [number, number, number] = [
          position[0] + (input.rng.nextUniform() - 0.5) * 0.2,
          position[1] + (input.rng.nextUniform() - 0.5) * 0.2,
          position[2] + (input.rng.nextUniform() - 0.5) * 0.2,
        ];
        state = withEntityState(state, ref, {
          kind: "record",
          fields: { ...current.fields, position: positionRecord(next) },
        });
        events.push({
          event: eventOf(DRIFTED_EVENT, { kind: "record", fields: { position: positionRecord(next) } }, input.tick, ref),
          cause: { kind: "system" },
        });
      }
      return { state, events };
    },
  };

  const decay: WorldSystem = {
    systemId: "decay",
    tick: (input) => {
      let state = input.state;
      const events: { event: GameEvent; cause: { kind: "system" } }[] = [];
      const keys = state.kind === "record" ? Object.keys(state.fields).sort() : [];
      for (const key of keys) {
        const ref = keyToRef(key);
        if (ref === undefined) continue;
        if (state.kind !== "record") break;
        const current = state.fields[key];
        if (current === undefined || current.kind !== "record") continue;
        const health = current.fields.health;
        const perished = current.fields.perished;
        if (health === undefined || health.kind !== "int") continue;
        const nextHealth = health.value > 0n ? health.value - 1n : 0n;
        const alreadyPerished = perished !== undefined && perished.kind === "bool" && perished.value;
        state = withEntityState(state, ref, {
          kind: "record",
          fields: {
            ...current.fields,
            health: { kind: "int", value: nextHealth },
            perished: { kind: "bool", value: alreadyPerished || nextHealth === 0n },
          },
        });
        if (!alreadyPerished && nextHealth === 0n) {
          events.push({
            event: eventOf(PERISHED_EVENT, { kind: "record", fields: { atTick: { kind: "int", value: BigInt(input.tick) } } }, input.tick, ref),
            cause: { kind: "system" },
          });
        }
      }
      return { state, events };
    },
  };

  return [motion, drift, decay];
}

function keyToRef(key: string): EntityRef | undefined {
  const parts = key.split("/");
  if (parts.length !== 6 || parts[0] !== "world" || parts[2] !== "scene" || parts[4] !== "entity") {
    return undefined;
  }
  const world = asWorldId(parts[1]!);
  const scene = asSceneId(parts[3]!);
  const entity = asEntityId(parts[5]!);
  if (world === undefined || scene === undefined || entity === undefined) return undefined;
  return { world, scene, entity };
}

/** Demo capability: locomotion, authorized for the `world.move` intent kind. */
export const DEMO_CAPABILITY = asCapabilityId("world.locomotion")!;
export const DEMO_INTENT_KIND = "world.move" as IntentKind;
export const DEMO_COMMAND_KIND = "world.move";

/** Mints the demo capability grant for the avatar agent under an epoch. */
export function demoGrant(sessionId: string, epoch: number): CapabilityGrant {
  return {
    grantId: asCapabilityGrantId("grant-demo-locomotion"),
    holder: { actorClass: "avatar-agent", actorId: DEMO_ACTOR_ID },
    capability: DEMO_CAPABILITY,
    scope: { sessionId: asSessionId(sessionId) },
    constraints: [],
    issuedBy: "host-game-policy",
    epoch: asSessionEpoch(epoch),
  };
}

/** The full demo game binding (deterministic; safe to re-instantiate). */
export function demoGameBinding(sessionId: string): SimulationGameBinding {
  return {
    game: {
      gameDigest: GAME_DIGEST,
      world: {
        worldId: "world-primus",
        revisionDigest: WORLD_REVISION,
      },
      policy: {
        policyId: "policy-demo",
        revisionDigest: POLICY_REVISION,
      },
    },
    blueprint: demoBlueprint(),
    systems: demoSystems(),
    commandPolicy: { [DEMO_COMMAND_KIND]: ["ready", "running"] },
    capabilityIntentKinds: { [String(DEMO_CAPABILITY)]: [DEMO_INTENT_KIND] },
    grants: [demoGrant(sessionId, 1)],
  };
}

/** A well-known demo seed (fragment-assembled; not secret-shaped). */
export function demoSeed(variant = 1): DeterminismSeed {
  return asDeterminismSeed(`demo-seed-${variant}`);
}
