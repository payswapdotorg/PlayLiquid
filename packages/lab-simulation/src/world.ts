/**
 * THE LAB EVALUATION WORLD (PL-028) — the in-memory "game" an evaluation
 * runs: work-item entities derived from project evidence (R17), two
 * deterministic systems over the @playliquid/simulation kernel, and the
 * broker grant table minted host-side from the organization's capability
 * allocations (R20 least privilege).
 *
 * World vocabulary (frozen, reviewable — R1):
 * - entities: one `work-item-<n>` per scenario work item. State fields:
 *   `evidenceId` (string), `difficulty` (int), `progress` (int),
 *   `defects` (int), `completed` (bool);
 * - system `execute`: applies `lab.work.execute` commands — payload
 *   `{target: entity-ref, units: int}` — advancing `progress` by `units`,
 *   sealing `completed` when `progress >= difficulty`, emitting
 *   `lab.work.completed` with the command as cause;
 * - system `friction`: per open item per tick, one seeded draw below the
 *   scenario's friction probability injects a defect (E9: the draw stream
 *   depends only on seed+tick+system id — never timing);
 * - commands: NO-OP on already-completed items (honest accounting: the
 *   command was admitted, the work was not).
 *
 * Pure module: systems are pure functions; no IO, no clocks.
 */

import { asSceneId, asWorldId, asEntityId } from "@playliquid/game-contracts";
import type { EntityRef } from "@playliquid/game-contracts";
import type { GameEvent, GameIRValue } from "@playliquid/game-ir";
import { asEventTypeId } from "@playliquid/game-ir";
import type { CapabilityGrant, SessionId } from "@playliquid/runtime-contracts";
import {
  asActorId,
  asCapabilityGrantId,
  asCapabilityId,
  asCommandId,
  asDigest,
  asGameIrDigest,
  asSessionEpoch,
  asSessionId,
} from "@playliquid/runtime-contracts";
import { entityStateOf, withEntityState } from "@playliquid/simulation";
import type { WorldBlueprint, WorldSystem } from "@playliquid/simulation";
import type { LabScenario, LabWorkItemSpec } from "./scenario.ts";
import { LAB_WORK_COMMAND_KIND } from "./records.ts";
import { labDigestOf } from "./digest.ts";

/** The single world/scene of the lab evaluation world. */
export const LAB_WORLD_ID = asWorldId("world-lab-eval")!;
export const LAB_SCENE_ID = asSceneId("scene-lab-eval")!;

/** Progress units one granted work command advances (world constant). */
export const WORK_UNITS_PER_COMMAND = 3;

const COMPLETED_EVENT = asEventTypeId("lab.work.completed")!;
const FRICTION_EVENT = asEventTypeId("lab.work.defect")!;

/** Canonical entity ref of scenario work item `entityId`. */
export function workItemEntityRef(entityId: string): EntityRef {
  return { world: LAB_WORLD_ID, scene: LAB_SCENE_ID, entity: asEntityId(entityId)! };
}

/** The runtime actor of an organization agent inside the lab world. */
export function labAgentActor(agent: string): { readonly actorClass: "avatar-agent"; readonly actorId: ReturnType<typeof asActorId> } {
  return { actorClass: "avatar-agent", actorId: asActorId(`actor-${agent}`) };
}

function workItemState(item: LabWorkItemSpec): GameIRValue {
  return {
    kind: "record",
    fields: {
      evidenceId: { kind: "string", value: item.evidenceId },
      difficulty: { kind: "int", value: BigInt(item.difficulty) },
      progress: { kind: "int", value: 0n },
      defects: { kind: "int", value: 0n },
      completed: { kind: "bool", value: false },
    },
  };
}

/** The world blueprint of a scenario: one entity per work item. */
export function labWorldBlueprint(scenario: LabScenario): WorldBlueprint {
  return {
    entities: scenario.workItems.map((item) => ({
      ref: workItemEntityRef(item.entityId),
      state: workItemState(item),
    })),
  };
}

interface WorkFields {
  readonly progress: bigint;
  readonly difficulty: bigint;
  readonly defects: bigint;
  readonly completed: boolean;
}

function readWorkFields(state: GameIRValue): WorkFields | undefined {
  if (state.kind !== "record") return undefined;
  const { progress, difficulty, defects, completed } = state.fields;
  if (progress === undefined || progress.kind !== "int") return undefined;
  if (difficulty === undefined || difficulty.kind !== "int") return undefined;
  if (defects === undefined || defects.kind !== "int") return undefined;
  if (completed === undefined || completed.kind !== "bool") return undefined;
  return { progress: progress.value, difficulty: difficulty.value, defects: defects.value, completed: completed.value };
}

interface WorkCommandPayload {
  readonly target?: EntityRef;
  readonly units?: bigint;
}

function readWorkCommandPayload(payload: GameIRValue): WorkCommandPayload {
  if (payload.kind !== "record") return {};
  const target = payload.fields.target;
  const units = payload.fields.units;
  return {
    target: target !== undefined && target.kind === "entity-ref" ? target.ref : undefined,
    units: units !== undefined && units.kind === "int" ? units.value : undefined,
  };
}

/** The `lab.work.execute` command payload for target `entityId`. */
export function workCommandPayload(target: EntityRef, units: number): GameIRValue {
  return {
    kind: "record",
    fields: {
      target: { kind: "entity-ref", ref: target },
      units: { kind: "int", value: BigInt(units) },
    },
  };
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

/** The lab evaluation systems, in declared execution order. */
export function labWorldSystems(frictionProbability: number): readonly WorldSystem[] {
  const execute: WorldSystem = {
    systemId: "execute",
    tick: (input) => {
      let state = input.state;
      const events: { readonly event: GameEvent; readonly cause: { readonly kind: "command"; readonly commandId: ReturnType<typeof asCommandId> } }[] = [];
      for (const command of input.commands) {
        if (String(command.kind) !== LAB_WORK_COMMAND_KIND) continue;
        const payload = readWorkCommandPayload(command.payload);
        if (payload.target === undefined || payload.units === undefined || payload.units <= 0n) continue;
        const current = entityStateOf(state, payload.target);
        if (current === undefined || current.kind !== "record") continue;
        const fields = readWorkFields(current);
        if (fields === undefined || fields.completed) continue;
        const progress = fields.progress + payload.units;
        const completed = progress >= fields.difficulty;
        state = withEntityState(state, payload.target, {
          kind: "record",
          fields: {
            ...current.fields,
            progress: { kind: "int", value: progress },
            completed: { kind: "bool", value: completed },
          },
        });
        if (completed) {
          const evidenceId = current.fields.evidenceId;
          if (evidenceId !== undefined) {
            events.push({
              event: {
                type: COMPLETED_EVENT,
                payload: {
                  kind: "record",
                  fields: {
                    evidenceId,
                    atTick: { kind: "int", value: BigInt(Number(input.tick)) },
                  },
                },
                tick: input.tick,
                source: payload.target,
              },
              cause: { kind: "command", commandId: asCommandId(command.commandId) },
            });
          }
        }
      }
      return { state, events };
    },
  };

  const friction: WorldSystem = {
    systemId: "friction",
    tick: (input) => {
      let state = input.state;
      const events: { readonly event: GameEvent; readonly cause: { readonly kind: "system" } }[] = [];
      const keys = state.kind === "record" ? Object.keys(state.fields).sort() : [];
      for (const key of keys) {
        const ref = keyToRef(key);
        if (ref === undefined || state.kind !== "record") continue;
        const current = state.fields[key];
        if (current === undefined || current.kind !== "record") continue;
        const fields = readWorkFields(current);
        if (fields === undefined || fields.completed) continue;
        if (input.rng.nextUniform() >= frictionProbability) continue;
        state = withEntityState(state, ref, {
          kind: "record",
          fields: { ...current.fields, defects: { kind: "int", value: fields.defects + 1n } },
        });
        events.push({
          event: {
            type: FRICTION_EVENT,
            payload: { kind: "record", fields: { atTick: { kind: "int", value: BigInt(Number(input.tick)) } } },
            tick: input.tick,
            source: ref,
          },
          cause: { kind: "system" },
        });
      }
      return { state, events };
    },
  };

  return [execute, friction];
}

/**
 * Host-side grant minting (the ONLY minting path, R20): one grant per
 * (agent, capability) pair the scenario allocates, deterministic ids. The
 * evaluation harness IS the host game policy of the simulated world.
 */
export function labAgentGrants(sessionId: SessionId, epoch: number, scenario: LabScenario): readonly CapabilityGrant[] {
  const grants: CapabilityGrant[] = [];
  let index = 0;
  for (const agent of scenario.agents) {
    for (const capability of agent.workCapabilities) {
      index += 1;
      grants.push({
        grantId: asCapabilityGrantId(`grant-lab-${index}`),
        holder: labAgentActor(String(agent.agent)),
        capability: asCapabilityId(capability),
        scope: { sessionId: asSessionId(String(sessionId)) },
        constraints: [],
        issuedBy: "host-game-policy",
        epoch: asSessionEpoch(epoch),
      });
    }
  }
  return grants;
}

/** The deterministic game identity of a scenario (content-addressed). */
export function labGameRefOf(scenario: LabScenario, sessionId: SessionId): {
  readonly gameDigest: ReturnType<typeof asGameIrDigest>;
  readonly world: { readonly worldId: string; readonly revisionDigest: ReturnType<typeof asDigest> };
  readonly policy: { readonly policyId: string; readonly revisionDigest: ReturnType<typeof asDigest> };
} {
  const scenarioDigest = labDigestOf({
    sessionId: String(sessionId),
    workItems: scenario.workItems,
    agents: scenario.agents.map((agent) => ({ agent: String(agent.agent), workCapabilities: agent.workCapabilities })),
    frictionProbability: scenario.frictionProbability,
    tickBudget: scenario.tickBudget,
  });
  const worldDigest = labDigestOf(scenario.workItems);
  const policyDigest = labDigestOf(scenario.capabilityCoverage);
  return {
    gameDigest: asGameIrDigest(String(scenarioDigest)),
    world: { worldId: String(LAB_WORLD_ID), revisionDigest: asDigest(String(worldDigest)) },
    policy: { policyId: "policy-lab-eval", revisionDigest: asDigest(String(policyDigest)) },
  };
}
