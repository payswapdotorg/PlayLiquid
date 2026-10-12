/**
 * SPARK CONTENT ANALYSIS — the game-ir walk behind the boot plan.
 *
 * ONE content model: game-ir (lock rule 16 — Spark is a target profile,
 * never a second content model). This module derives, deterministically
 * and in ONE pass, the typed content units of a GameIR document split
 * into the MINIMAL critical set (the entry world/scene, its entities,
 * their rules/events, and the policy declarations) and the deferred
 * remainder (other worlds/scenes/entities/rules/events) with the
 * content-derived stream ordering and after-dependencies.
 *
 * Every unit is digest-pinned (package-system computeDigest over the
 * node's JSON-safe canonical projection; E7/E9) and byte-costed (UTF-8
 * length of the same canonical form). The walk is TOTAL: every dangling
 * reference is a typed kebab-case rejection, aggregated — no partial
 * analyses (E8).
 *
 * Pure module: no IO, no clocks, no globals.
 */

import { validate } from "@playliquid/game-ir";
import { canonicalValueForm } from "@playliquid/game-ir";
import type {
  GameIRDocument,
  GameIRNode,
  WorldNode,
  SceneNode,
  RuleNode,
} from "@playliquid/game-ir";
import type { SceneRef, StreamingPolicy } from "@playliquid/game-contracts";
import { canonicalJson, computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";

/** One analyzed content unit (a game-ir node, digest-pinned). */
export interface SparkContentUnit {
  readonly unitId: string;
  readonly kind: GameIRNode["kind"];
  readonly bytes: number;
  readonly contentDigest: ContentDigest;
  /** Streams/caches permitted by the unit's WORLD streaming policy (R15). */
  readonly streamable: boolean;
  readonly cacheable: boolean;
}

/** A deferred unit with its content-derived stream ordering. */
export interface SparkDeferredUnit extends SparkContentUnit {
  /** The unit this streams after (its owning scene/rule); null for worlds. */
  readonly after: string | null;
  /** Content-derived stream priority; strictly increasing across the plan. */
  readonly streamPriority: number;
}

/** The one-pass analysis result. */
export interface SparkContentAnalysis {
  readonly entry: SceneRef;
  readonly criticalUnits: readonly SparkContentUnit[];
  readonly deferredUnits: readonly SparkDeferredUnit[];
  readonly totalBytes: number;
}

/** One aggregated content-walk rejection (kebab-case code, E8). */
export interface SparkContentRejection {
  readonly code: string;
  readonly message: string;
}

/** The spark default streaming policy (progressive + aggressive, R6). */
export const SPARK_DEFAULT_STREAMING: Readonly<StreamingPolicy> = Object.freeze({
  streamable: true,
  cacheable: true,
  independentlyBuilt: false,
});

/** JSON-safe canonical projection of a node (entity state via game-ir forms). */
function nodeForm(node: GameIRNode): Record<string, unknown> {
  const base: Record<string, unknown> = { kind: node.kind, id: node.id };
  switch (node.kind) {
    case "world":
      return {
        ...base,
        world: node.world,
        scenes: [...node.scenes],
        ...(node.partitioning === undefined ? {} : { partitioning: node.partitioning }),
        ...(node.streaming === undefined ? {} : { streaming: { ...node.streaming } }),
      };
    case "scene":
      return {
        ...base,
        world: node.world,
        scene: node.scene,
        entities: [...node.entities],
        ...(node.partitioning === undefined ? {} : { partitioning: node.partitioning }),
      };
    case "entity":
      return {
        ...base,
        scene: node.scene,
        entity: node.entity,
        state: canonicalValueForm(node.state),
        behaviors: [...node.behaviors],
      };
    case "rule":
      return { ...base, on: [...node.on], handles: [...node.handles], emits: [...node.emits] };
    case "event-declaration":
      return { ...base, eventType: node.eventType, payload: node.payload };
    case "capability-declaration":
      return { ...base, requirement: node.requirement };
    case "avatar-binding":
      return { ...base, role: node.role, restrictions: node.restrictions };
  }
}

function unitOf(node: GameIRNode, policy: StreamingPolicy): SparkContentUnit {
  const form = nodeForm(node);
  const canonical = canonicalJson(form);
  return {
    unitId: node.id,
    kind: node.kind,
    bytes: Buffer.byteLength(canonical, "utf8"),
    contentDigest: computeDigest(form),
    streamable: policy.streamable,
    cacheable: policy.cacheable,
  };
}

/** A rule node type guard (the behaviors of an entity cite rule nodes). */
function isRuleNode(node: GameIRNode): node is RuleNode {
  return node.kind === "rule";
}

/** Analyzes the document in ONE total pass. Fail-closed, aggregated. */
export function analyzeSparkContent(document: GameIRDocument):
  { ok: true; analysis: SparkContentAnalysis } | { ok: false; rejections: readonly SparkContentRejection[] } {
  const rejections: SparkContentRejection[] = [];
  const validation = validate(document);
  if (!validation.ok) {
    rejections.push({
      code: "game-ir-invalid",
      message: `game-ir document failed kernel validation: ${validation.diagnostics
        .map((diagnostic) => `${diagnostic.code} at ${diagnostic.path}`)
        .join("; ")}`,
    });
  }
  const nodes = Array.isArray(document?.nodes) ? document.nodes : [];
  const byId = new Map<string, GameIRNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      rejections.push({ code: "duplicate-node-id", message: `node id "${node.id}" appears more than once` });
      continue;
    }
    byId.set(node.id, node);
  }
  const sceneNodes = nodes.filter((node): node is SceneNode => node.kind === "scene");
  const entryScene = sceneNodes.find(
    (node) => node.world === document.entry?.world && node.scene === document.entry?.scene,
  );
  if (entryScene === undefined) {
    rejections.push({
      code: "entry-scene-missing",
      message: `entry scene ${String(document.entry?.world)}/${String(document.entry?.scene)} has no scene node`,
    });
    return { ok: false, rejections };
  }
  const worldNodes = nodes.filter((node): node is WorldNode => node.kind === "world");
  const entryWorld = worldNodes.find((node) => node.world === entryScene.world);
  if (entryWorld === undefined) {
    rejections.push({ code: "entry-world-missing", message: `entry world ${entryScene.world} has no world node` });
    return { ok: false, rejections };
  }
  if (rejections.length > 0) return { ok: false, rejections };

  const worldsStreaming = new Map<string, StreamingPolicy>();
  for (const world of worldNodes) {
    worldsStreaming.set(
      world.world,
      world.streaming === undefined ? SPARK_DEFAULT_STREAMING : world.streaming,
    );
  }
  const policyOf = (world: string): StreamingPolicy =>
    worldsStreaming.get(world) ?? SPARK_DEFAULT_STREAMING;

  const criticalIds = new Set<string>();
  const deferredIds = new Set<string>();
  const criticalUnits: SparkContentUnit[] = [];
  const deferredUnits: SparkDeferredUnit[] = [];
  let priority = 0;

  const addCritical = (node: GameIRNode, world: string): void => {
    if (criticalIds.has(node.id)) return;
    criticalIds.add(node.id);
    criticalUnits.push(unitOf(node, policyOf(world)));
  };
  const addDeferred = (node: GameIRNode, world: string, after: string | null): void => {
    if (criticalIds.has(node.id) || deferredIds.has(node.id)) return;
    deferredIds.add(node.id);
    deferredUnits.push({ ...unitOf(node, policyOf(world)), after, streamPriority: priority });
    priority += 1;
  };

  addCritical(entryWorld, entryWorld.world);
  addCritical(entryScene, entryScene.world);
  for (const entityId of entryScene.entities) {
    const entity = nodes.find((node) => node.kind === "entity" && node.entity === entityId && node.scene === entryScene.scene);
    if (entity === undefined) {
      rejections.push({ code: "scene-entity-unknown", message: `scene ${entryScene.scene} lists unknown entity ${entityId}` });
      continue;
    }
    addCritical(entity, entryScene.world);
    const ruleIds = entity.behaviors;
    for (const ruleId of ruleIds) {
      const rule = byId.get(ruleId);
      if (rule === undefined) {
        rejections.push({ code: "entity-behavior-unknown", message: `entity ${entityId} cites unknown behavior node ${ruleId}` });
        continue;
      }
      if (!isRuleNode(rule)) {
        rejections.push({ code: "entity-behavior-not-rule", message: `entity ${entityId} behavior ${ruleId} is a ${rule.kind} node, not a rule` });
        continue;
      }
      addCritical(rule, entryScene.world);
      for (const eventType of [...rule.on, ...rule.emits]) {
        const declaration = nodes.find((node) => node.kind === "event-declaration" && node.eventType === eventType);
        if (declaration === undefined) {
          rejections.push({ code: "rule-event-unknown", message: `rule ${rule.id} cites undeclared event type ${eventType}` });
          continue;
        }
        addCritical(declaration, entryScene.world);
      }
    }
  }
  for (const node of nodes) {
    if (node.kind === "capability-declaration" || node.kind === "avatar-binding") {
      addCritical(node, entryWorld.world);
    }
  }

  for (const world of worldNodes) {
    const isEntryWorld = world.id === entryWorld.id;
    if (!isEntryWorld) {
      addDeferred(world, world.world, null);
    }
    for (const sceneId of world.scenes) {
      const scene = sceneNodes.find((node) => node.scene === sceneId && node.world === world.world);
      if (scene === undefined) {
        rejections.push({ code: "world-scene-unknown", message: `world ${world.world} lists unknown scene ${sceneId}` });
        continue;
      }
      if (isEntryWorld && scene.id === entryScene.id) continue;
      addDeferred(scene, world.world, world.id);
      for (const entityId of scene.entities) {
        const entity = nodes.find((node) => node.kind === "entity" && node.entity === entityId && node.scene === scene.scene);
        if (entity === undefined) {
          rejections.push({ code: "scene-entity-unknown", message: `scene ${scene.scene} lists unknown entity ${entityId}` });
          continue;
        }
        addDeferred(entity, world.world, scene.id);
        for (const ruleId of entity.behaviors) {
          const rule = byId.get(ruleId);
          if (rule === undefined) {
            rejections.push({ code: "entity-behavior-unknown", message: `entity ${entityId} cites unknown behavior node ${ruleId}` });
            continue;
          }
          if (!isRuleNode(rule)) {
            rejections.push({ code: "entity-behavior-not-rule", message: `entity ${entityId} behavior ${ruleId} is a ${rule.kind} node, not a rule` });
            continue;
          }
          addDeferred(rule, world.world, entity.id);
          for (const eventType of [...rule.on, ...rule.emits]) {
            const declaration = nodes.find((node) => node.kind === "event-declaration" && node.eventType === eventType);
            if (declaration === undefined) {
              rejections.push({ code: "rule-event-unknown", message: `rule ${rule.id} cites undeclared event type ${eventType}` });
              continue;
            }
            addDeferred(declaration, world.world, rule.id);
          }
        }
      }
    }
  }

  if (rejections.length > 0) return { ok: false, rejections };
  const totalBytes = [...criticalUnits, ...deferredUnits].reduce((sum, unit) => sum + unit.bytes, 0);
  return {
    ok: true,
    analysis: { entry: document.entry, criticalUnits, deferredUnits, totalBytes },
  };
}
