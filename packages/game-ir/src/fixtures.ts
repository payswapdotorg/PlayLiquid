/**
 * Shared fixture builder for tests and the selfcheck harness.
 * Builds a structurally valid GameIR document.
 */

import {
  asAgentId,
  asAvatarId,
  asCommitSha,
  asEntityId,
  asGameId,
  asSceneId,
  asWorldId,
} from "@playliquid/game-contracts";
import type { GameIRDocument } from "./document.ts";
import { asEventTypeId, asIntentTypeId } from "./semantics.ts";
import { asNodeId } from "./nodes.ts";

export const FIXTURE_SHA = "b88e814755e9bd1efed6cb6f8e26f316bada1247";

export function fixtureDocument(): GameIRDocument {
  return {
    irVersion: "1",
    identity: {
      id: asGameId("game-alpha")!,
      displayName: "Game Alpha",
      kind: "game",
      repository: { host: "github.com", owner: "payswapdotorg", repository: "game-alpha" },
      revision: { kind: "commit", commit: asCommitSha(FIXTURE_SHA)! },
      lineage: { head: asCommitSha(FIXTURE_SHA)!, ancestors: [] },
    },
    lifecycle: "active",
    entry: { world: asWorldId("world-primus")!, scene: asSceneId("scene-overworld")! },
    nodes: [
      {
        id: asNodeId("world-primus-node")!,
        kind: "world",
        world: asWorldId("world-primus")!,
        scenes: [asSceneId("scene-overworld")!],
        partitioning: { scheme: "uniform-grid", cellSize: [8, 8, 8], bounds: { min: [0, 0, 0], max: [64, 64, 64] } },
        streaming: { streamable: true, cacheable: true, independentlyBuilt: false },
      },
      {
        id: asNodeId("scene-overworld-node")!,
        kind: "scene",
        world: asWorldId("world-primus")!,
        scene: asSceneId("scene-overworld")!,
        entities: [asEntityId("entity-hero")!],
      },
      {
        id: asNodeId("entity-hero-node")!,
        kind: "entity",
        scene: asSceneId("scene-overworld")!,
        entity: asEntityId("entity-hero")!,
        state: {
          kind: "record",
          fields: {
            health: { kind: "int", value: 100n },
            position: { kind: "list", items: [{ kind: "float", value: 1.5 }, { kind: "float", value: 2 }] },
            title: { kind: "string", value: "hero" },
          },
        },
        behaviors: [asNodeId("rule-hero-motion")!],
      },
      {
        id: asNodeId("rule-hero-motion")!,
        kind: "rule",
        on: [asEventTypeId("world.entity.spawned")!],
        handles: [asIntentTypeId("avatar.movement.requested")!],
        emits: [asEventTypeId("world.entity.moved")!],
      },
      {
        id: asNodeId("event-world-entity-moved")!,
        kind: "event-declaration",
        eventType: asEventTypeId("world.entity.moved")!,
        payload: {
          kind: "record",
          fields: {
            position: { kind: "list", element: { kind: "float" } },
          },
        },
      },
      {
        id: asNodeId("event-world-entity-spawned")!,
        kind: "event-declaration",
        eventType: asEventTypeId("world.entity.spawned")!,
        payload: { kind: "unit" },
      },
      {
        id: asNodeId("capability-replay")!,
        kind: "capability-declaration",
        requirement: {
          capability: "replay",
          required: true,
          policy: { capture: "intent-log", determinismRequired: true, consumers: ["qa", "simulation"] },
        },
      },
      {
        id: asNodeId("avatar-binding-hero")!,
        kind: "avatar-binding",
        role: "hero",
        restrictions: {
          denied: ["manipulation"],
          approvalRequired: ["speech"],
          sandboxed: false,
        },
      },
    ],
  };
}

export const FIXTURE_AGENT = asAgentId("agent-atlas")!;
export const FIXTURE_AVATAR = asAvatarId("avatar-nova")!;
