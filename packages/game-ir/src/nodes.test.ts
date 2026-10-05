import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_IR_NODE_KINDS, asNodeId, isGameIRNodeKind } from "./nodes.ts";
import type { AvatarBindingNode, CapabilityDeclarationNode, EventDeclarationNode, GameIRNode, RuleNode, SceneNode, WorldNode, EntityNode } from "./nodes.ts";
import { asEntityId, asSceneId, asWorldId } from "@playliquid/game-contracts";
import { asEventTypeId } from "./semantics.ts";


test("nodes: every node kind has a compile-and-run consumer", () => {
  const world: WorldNode = {
    id: asNodeId("world-primus-node")!,
    kind: "world",
    world: asWorldId("world-primus")!,
    scenes: [asSceneId("scene-overworld")!],
    partitioning: { scheme: "uniform-grid", cellSize: [8, 8, 8], bounds: { min: [0, 0, 0], max: [64, 64, 64] } },
    streaming: { streamable: true, cacheable: true, independentlyBuilt: false },
  };
  const scene: SceneNode = {
    id: asNodeId("scene-overworld-node")!,
    kind: "scene",
    world: asWorldId("world-primus")!,
    scene: asSceneId("scene-overworld")!,
    entities: [asEntityId("entity-hero")!],
  };
  const entity: EntityNode = {
    id: asNodeId("entity-hero-node")!,
    kind: "entity",
    scene: asSceneId("scene-overworld")!,
    entity: asEntityId("entity-hero")!,
    state: { kind: "record", fields: { health: { kind: "int", value: 100n } } },
    behaviors: [asNodeId("rule-hero-motion")!],
  };
  const rule: RuleNode = {
    id: asNodeId("rule-hero-motion")!,
    kind: "rule",
    on: [],
    handles: [],
    emits: [],
  };
  const eventDeclaration: EventDeclarationNode = {
    id: asNodeId("event-node")!,
    kind: "event-declaration",
    eventType: asEventTypeId("world.entity.moved")!,
    payload: { kind: "unit" },
  };
  const capabilityDeclaration: CapabilityDeclarationNode = {
    id: asNodeId("capability-node")!,
    kind: "capability-declaration",
    requirement: {
      capability: "replay",
      required: true,
      policy: { capture: "intent-log", determinismRequired: true, consumers: ["qa"] },
    },
  };
  const avatarBinding: AvatarBindingNode = {
    id: asNodeId("avatar-binding-node")!,
    kind: "avatar-binding",
    role: "hero",
    restrictions: { denied: [], approvalRequired: [], sandboxed: false },
  };
  const nodes: readonly GameIRNode[] = [
    world,
    scene,
    entity,
    rule,
    eventDeclaration,
    capabilityDeclaration,
    avatarBinding,
  ];
  assert.equal(nodes.length, GAME_IR_NODE_KINDS.length);
  for (const node of nodes) {
    assert.ok(isGameIRNodeKind(node.kind));
  }
});

test("nodes: node ids are canonical slugs", () => {
  assert.notEqual(asNodeId("entity-hero-node"), undefined);
  assert.equal(asNodeId("NOT-A-SLUG"), undefined);
  assert.equal(asNodeId(""), undefined);
});

test("nodes: unknown kinds are compile-time errors", () => {
  // @ts-expect-error — "quantum" is not a NodeKind
  const bad: GameIRNode = { id: asNodeId("bad-node")!, kind: "quantum" };
  assert.equal(isGameIRNodeKind(bad.kind), false);
});
