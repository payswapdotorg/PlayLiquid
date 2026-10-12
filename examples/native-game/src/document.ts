/**
 * LUMEN RUN — the GameIR document (PL-037).
 *
 * The whole game content as engine-independent semantic data (§Game
 * model): world topology (world → scenes → entities), mechanics (rule
 * nodes), event declarations with payload shapes, platform capability
 * declarations (lock 18 — the game DECLARES platform needs; the platform
 * services own the behavior) and the avatar binding with its host
 * restrictions (R5). Entity states are GameIR values (R14).
 *
 * This is the demonstration surface for "GameOS-native projects use
 * GameIR directly" (§Engine strategy): no engine envelope, no project
 * file, no engine-specific type — the document IS the game content.
 *
 * Pure module: frozen data derived from the vocabulary modules.
 */

import { asNodeId } from "../../../packages/game-ir/src/index.ts";
import type { GameIRDocument, GameIRNode } from "../../../packages/game-ir/src/index.ts";
import { asEntityId, asSceneId, asWorldId } from "../../../packages/game-contracts/src/index.ts";
import { LUMEN_RUN_COMMIT, LUMEN_RUN_ID, LUMEN_RUN_REPO } from "./ids.ts";
import { EVENT_TYPE_IDS, INTENT_TYPE_IDS, PAYLOAD_SHAPES } from "./events.ts";

/** Entry world of the run. */
export const WORLD_RUN = asWorldId("world-run")!;
/** The arena the hero runs in (critical for spark boot). */
export const SCENE_ARENA = asSceneId("scene-arena")!;
/** The vault (deferred content: streams after the arena, R15). */
export const SCENE_VAULT = asSceneId("scene-vault")!;

/** Entity ids the driver resolves the initial world from. */
export const HERO_ENTITY = asEntityId("entity-hero")!;
export const COMPANION_ENTITY = asEntityId("entity-companion")!;
export const MOTE_ENTITIES = [
  asEntityId("entity-mote-1")!,
  asEntityId("entity-mote-2")!,
  asEntityId("entity-mote-3")!,
] as const;

const node = asNodeId;

/**
 * The Lumen Run document. Node order is authored (and preserved by every
 * digest derived from it — see packages/spark's `sparkGameIrDigestOf`).
 */
export function lumenRunDocument(): GameIRDocument {
  const nodes: GameIRNode[] = [
    // -- world topology ----------------------------------------------------
    {
      id: node("world-run-node")!,
      kind: "world",
      world: WORLD_RUN,
      scenes: [SCENE_ARENA, SCENE_VAULT],
      partitioning: { scheme: "uniform-grid", cellSize: [1, 1, 1], bounds: { min: [0, 0, 0], max: [6, 6, 1] } },
      streaming: { streamable: true, cacheable: true, independentlyBuilt: false },
    },
    {
      id: node("scene-arena-node")!,
      kind: "scene",
      world: WORLD_RUN,
      scene: SCENE_ARENA,
      entities: [HERO_ENTITY, COMPANION_ENTITY, ...MOTE_ENTITIES],
    },
    {
      id: node("scene-vault-node")!,
      kind: "scene",
      world: WORLD_RUN,
      scene: SCENE_VAULT,
      entities: [asEntityId("entity-archives")!],
    },
    // -- entities (initial state in the value language) ---------------------
    {
      id: node("entity-hero-node")!,
      kind: "entity",
      scene: SCENE_ARENA,
      entity: HERO_ENTITY,
      state: { kind: "record", fields: { col: { kind: "int", value: 0n }, row: { kind: "int", value: 0n }, lumens: { kind: "int", value: 0n }, title: { kind: "string", value: "hero" } } },
      behaviors: [node("rule-hero-motion")!, node("rule-hero-look")!],
    },
    {
      id: node("entity-companion-node")!,
      kind: "entity",
      scene: SCENE_ARENA,
      entity: COMPANION_ENTITY,
      state: { kind: "record", fields: { col: { kind: "int", value: 1n }, row: { kind: "int", value: 0n }, title: { kind: "string", value: "companion" } } },
      behaviors: [node("rule-companion-motion")!],
    },
    {
      id: node("entity-mote-1-node")!,
      kind: "entity",
      scene: SCENE_ARENA,
      entity: MOTE_ENTITIES[0]!,
      state: { kind: "record", fields: { col: { kind: "int", value: 2n }, row: { kind: "int", value: 1n }, collected: { kind: "bool", value: false }, title: { kind: "string", value: "mote" } } },
      behaviors: [node("rule-mote-drift")!],
    },
    {
      id: node("entity-mote-2-node")!,
      kind: "entity",
      scene: SCENE_ARENA,
      entity: MOTE_ENTITIES[1]!,
      state: { kind: "record", fields: { col: { kind: "int", value: 4n }, row: { kind: "int", value: 3n }, collected: { kind: "bool", value: false }, title: { kind: "string", value: "mote" } } },
      behaviors: [node("rule-mote-drift")!],
    },
    {
      id: node("entity-mote-3-node")!,
      kind: "entity",
      scene: SCENE_ARENA,
      entity: MOTE_ENTITIES[2]!,
      state: { kind: "record", fields: { col: { kind: "int", value: 5n }, row: { kind: "int", value: 5n }, collected: { kind: "bool", value: false }, title: { kind: "string", value: "mote" } } },
      behaviors: [node("rule-mote-drift")!],
    },
    {
      id: node("entity-archives-node")!,
      kind: "entity",
      scene: SCENE_VAULT,
      entity: asEntityId("entity-archives")!,
      state: { kind: "record", fields: { sealed: { kind: "bool", value: false }, title: { kind: "string", value: "archives" } } },
      behaviors: [node("rule-archivist")!],
    },
    // -- mechanics -----------------------------------------------------------
    {
      id: node("rule-hero-motion")!,
      kind: "rule",
      on: [EVENT_TYPE_IDS.lumenCollected],
      handles: [INTENT_TYPE_IDS.heroMove],
      emits: [EVENT_TYPE_IDS.heroMoved],
    },
    {
      id: node("rule-hero-look")!,
      kind: "rule",
      on: [EVENT_TYPE_IDS.heroMoved],
      handles: [INTENT_TYPE_IDS.heroLook],
      emits: [EVENT_TYPE_IDS.heroLooked],
    },
    {
      id: node("rule-companion-motion")!,
      kind: "rule",
      on: [EVENT_TYPE_IDS.heroMoved],
      handles: [INTENT_TYPE_IDS.companionMove],
      emits: [EVENT_TYPE_IDS.companionMoved],
    },
    {
      id: node("rule-mote-drift")!,
      kind: "rule",
      on: [EVENT_TYPE_IDS.heroMoved],
      handles: [],
      emits: [EVENT_TYPE_IDS.moteDrifted],
    },
    {
      id: node("rule-archivist")!,
      kind: "rule",
      on: [EVENT_TYPE_IDS.vaultSealed],
      handles: [],
      emits: [EVENT_TYPE_IDS.runCompleted],
    },
    {
      id: node("rule-social-echo")!,
      kind: "rule",
      on: [EVENT_TYPE_IDS.socialEcho],
      handles: [],
      emits: [],
    },
    // -- event declarations (payload shapes are declaration data) ------------
    { id: node("event-hero-moved")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.heroMoved, payload: PAYLOAD_SHAPES["run.hero.moved"]! },
    { id: node("event-hero-looked")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.heroLooked, payload: PAYLOAD_SHAPES["run.hero.looked"]! },
    { id: node("event-companion-moved")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.companionMoved, payload: PAYLOAD_SHAPES["run.companion.moved"]! },
    { id: node("event-mote-drifted")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.moteDrifted, payload: PAYLOAD_SHAPES["run.mote.drifted"]! },
    { id: node("event-lumen-collected")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.lumenCollected, payload: PAYLOAD_SHAPES["run.lumen.collected"]! },
    { id: node("event-run-completed")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.runCompleted, payload: PAYLOAD_SHAPES["run.completed"]! },
    { id: node("event-social-echo")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.socialEcho, payload: PAYLOAD_SHAPES["run.social.echo"]! },
    { id: node("event-vault-sealed")!, kind: "event-declaration", eventType: EVENT_TYPE_IDS.vaultSealed, payload: PAYLOAD_SHAPES["run.vault.sealed"]! },
    // -- platform declarations (lock 18: the game DECLARES, never owns) -----
    {
      id: node("capability-leaderboard")!,
      kind: "capability-declaration",
      requirement: { capability: "leaderboard", required: true, policy: { metric: "run.score", ordering: "descending", scope: "global" } },
    },
    {
      id: node("capability-multiplayer")!,
      kind: "capability-declaration",
      requirement: { capability: "multiplayer", required: true, policy: { topology: "authoritative-server", maxPlayersPerSession: 4, sessionModel: "ad-hoc" } },
    },
    {
      id: node("capability-replay")!,
      kind: "capability-declaration",
      requirement: { capability: "replay", required: true, policy: { capture: "intent-log", determinismRequired: true, consumers: ["player", "qa", "integrity"] } },
    },
    {
      id: node("capability-rewards")!,
      kind: "capability-declaration",
      requirement: { capability: "rewards", required: true, policy: { mode: "points", settlement: "platform", clientAuthoritative: false } },
    },
    {
      id: node("capability-social")!,
      kind: "capability-declaration",
      requirement: { capability: "social", required: true, policy: { graphs: ["friends"], presence: true } },
    },
    {
      id: node("capability-achievements")!,
      kind: "capability-declaration",
      requirement: { capability: "achievements", required: true, policy: { visibility: "public", progression: "metric" } },
    },
    {
      id: node("capability-integrity")!,
      kind: "capability-declaration",
      requirement: { capability: "integrity", required: true, policy: { signals: ["behavioral", "timing", "trajectory", "outcome"], enforcement: "report-only" } },
    },
    // -- avatar binding (R5: host restrictions on imported avatars) ----------
    {
      id: node("avatar-binding-companion")!,
      kind: "avatar-binding",
      role: "hero-companion",
      restrictions: { denied: ["manipulation", "speech"], approvalRequired: ["gaze"], sandboxed: true },
    },
  ];
  return {
    irVersion: "1",
    identity: {
      id: LUMEN_RUN_ID,
      displayName: "Lumen Run",
      kind: "demo",
      repository: { ...LUMEN_RUN_REPO },
      revision: { kind: "commit", commit: LUMEN_RUN_COMMIT },
      lineage: { head: LUMEN_RUN_COMMIT, ancestors: [] },
    },
    lifecycle: "active",
    entry: { world: WORLD_RUN, scene: SCENE_ARENA },
    nodes,
  };
}
