/**
 * FORGE — the game composition (PL-038).
 *
 * A small but REAL GameIR document (the engine-independent game content,
 * §Game model): a world with one scene, two entities (whose initial state
 * cites the assets the Blender authoring stage sealed), one rule, one
 * event declaration and one platform capability declaration. This is the
 * content the staged builds pin as their GameIR input — the
 * engine-native thesis is that this document stays untouched while the
 * engine adapters adjudicate targets and the build-orchestrator stages
 * the builds around it (no engine envelope; that is native-game's path).
 *
 * Pure module: frozen data; no IO, no clocks, no randomness.
 */

import { asEventTypeId, asIntentTypeId, asNodeId } from "../../../packages/game-ir/src/index.ts";
import type { GameIRDocument, GameIRNode } from "../../../packages/game-ir/src/index.ts";
import { canonicalJson } from "../../../packages/package-system/src/index.ts";
import { canonicalValueForm } from "../../../packages/game-ir/src/index.ts";
import { asEntityId, asSceneId, asWorldId } from "../../../packages/game-contracts/src/index.ts";
import { FORGE_COMMIT, FORGE_GAME_ID, FORGE_REPO } from "./ids.ts";

/** The world of the forge. */
export const WORLD_FORGE = asWorldId("world-forge")!;
/** The foundry scene (where the authored assets live). */
export const SCENE_FOUNDRY = asSceneId("scene-foundry")!;
/** The entity ids the composition cites. */
export const PRESS_ENTITY = asEntityId("entity-forge-press")!;
export const ANVIL_ENTITY = asEntityId("entity-anvil")!;

const node = asNodeId;
const event = asEventTypeId;
const intent = asIntentTypeId;

/** The forge's declared event and intent ids (branded ids, never bare strings). */
export const PRESS_HEATED = event("forge.press.heated")!;
export const PRESS_QUENCH = intent("forge.press.quench")!;
export const PRESS_QUENCHED = event("forge.press.quenched")!;

/** A JSON-safe projection of one node (entity states via game-ir's canonical form). */
function jsonSafeNode(candidate: GameIRNode): unknown {
  return candidate.kind === "entity" ? { ...candidate, state: canonicalValueForm(candidate.state) } : candidate;
}

/** The forge game composition (GameIR-direct; no engine envelope). */
export function forgeGameDocument(): GameIRDocument {
  const nodes: readonly GameIRNode[] = [
    {
      id: node("world-forge-node")!,
      kind: "world",
      world: WORLD_FORGE,
      scenes: [SCENE_FOUNDRY],
      partitioning: { scheme: "uniform-grid", cellSize: [4, 4, 4], bounds: { min: [0, 0, 0], max: [32, 32, 8] } },
      streaming: { streamable: false, cacheable: true, independentlyBuilt: false },
    },
    {
      id: node("scene-foundry-node")!,
      kind: "scene",
      world: WORLD_FORGE,
      scene: SCENE_FOUNDRY,
      entities: [PRESS_ENTITY, ANVIL_ENTITY],
    },
    {
      id: node("entity-forge-press-node")!,
      kind: "entity",
      scene: SCENE_FOUNDRY,
      entity: PRESS_ENTITY,
      state: { kind: "record", fields: { asset: { kind: "string", value: "SM_ForgePress" }, heat: { kind: "int", value: 0n } } },
      behaviors: [node("rule-press-quench")!],
    },
    {
      id: node("entity-anvil-node")!,
      kind: "entity",
      scene: SCENE_FOUNDRY,
      entity: ANVIL_ENTITY,
      state: { kind: "record", fields: { asset: { kind: "string", value: "SM_Anvil" }, strikes: { kind: "int", value: 0n } } },
      behaviors: [node("rule-press-quench")!],
    },
    {
      id: node("rule-press-quench")!,
      kind: "rule",
      on: [PRESS_HEATED],
      handles: [PRESS_QUENCH],
      emits: [PRESS_QUENCHED],
    },
    {
      id: node("event-press-heated")!,
      kind: "event-declaration",
      eventType: PRESS_HEATED,
      payload: { kind: "record", fields: { heat: { kind: "int" } } },
    },
    {
      id: node("capability-replay")!,
      kind: "capability-declaration",
      requirement: {
        capability: "replay",
        required: true,
        policy: { capture: "intent-log", determinismRequired: true, consumers: ["qa"] },
      },
    },
  ];
  return {
    irVersion: "1",
    identity: {
      id: FORGE_GAME_ID,
      displayName: "Forge",
      kind: "demo",
      repository: { ...FORGE_REPO },
      revision: { kind: "commit", commit: FORGE_COMMIT },
      lineage: { head: FORGE_COMMIT, ancestors: [] },
    },
    lifecycle: "active",
    entry: { world: WORLD_FORGE, scene: SCENE_FOUNDRY },
    nodes,
  };
}

/** The plain canonical projection of the composition (the gameIr build input value). */
export function gameDocumentValue(document: GameIRDocument): Record<string, unknown> {
  return {
    irVersion: document.irVersion,
    identity: document.identity,
    lifecycle: document.lifecycle ?? "active",
    entry: document.entry,
    nodes: document.nodes.map(jsonSafeNode),
  };
}

/** The canonical CAS content bytes of the composition (the gameIr build input). */
export function gameDocumentBytes(document: GameIRDocument): Uint8Array {
  return new TextEncoder().encode(canonicalJson(gameDocumentValue(document)));
}
