/**
 * Deterministic fixture builders for the Spark runtime's tests and
 * harness (house pattern; NOT exported from the package barrel).
 *
 * Everything is derived at runtime — no hand-written digest literals, no
 * randomness. The game-ir documents exercise BOTH halves of the boot
 * plan: a critical entry world/scene (hero, rule, events, declarations)
 * and deferred remainders (a second scene of the entry world; a second
 * world with its own scene/entity; a third world whose streaming policy
 * refuses caching — the must-revalidate negative case, R15).
 */

import {
  asEventTypeId,
  asIntentTypeId,
  asNodeId,
} from "@playliquid/game-ir";
import type { GameIRDocument } from "@playliquid/game-ir";
import {
  asCommitSha,
  asEntityId,
  asGameId,
  asSceneId,
  asWorldId,
} from "@playliquid/game-contracts";
import type { SparkBootEntry, SparkTargetProfile } from "@playliquid/runtime-contracts";
import { asSparkProfileId, asTimestamp } from "@playliquid/runtime-contracts";
import type { RuntimePolicyRef } from "@playliquid/runtime-contracts";
import { asDigest } from "@playliquid/runtime-contracts";
import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";

const FIXTURE_SHA = "b88e814755e9bd1efed6cb6f8e26f316bada1247";

/** A canonical 9:16 mobile-first spark profile (R6). */
export function fixtureSparkProfile(over: Partial<SparkTargetProfile> = {}): SparkTargetProfile {
  const entries: readonly SparkBootEntry[] = [
    { priority: 0, assetRef: "boot://shell", byteCeiling: 120_000, requiredFor: "first-paint" },
    { priority: 1, assetRef: "boot://input-shell", byteCeiling: 40_000, requiredFor: "first-interaction" },
  ];
  return {
    profileId: asSparkProfileId("spark"),
    formFactor: "mobile-first",
    orientation: "portrait",
    aspectRatio: "9:16",
    boot: { entries, firstPaintTargetMs: 1_500, firstInteractionTargetMs: 2_500 },
    caching: "aggressive",
    streaming: "progressive",
    maxConcurrentStreams: 2,
    pinnedAt: asTimestamp(1_700_000_000_000),
    ...over,
  };
}

/** A deterministic runtime policy reference (caller data). */
export function fixturePolicyRef(): RuntimePolicyRef {
  const hex = computeDigest({ fixture: "spark-policy" }).slice("sha256:".length);
  return { policyId: "policy-spark", revisionDigest: asDigest(hex) };
}

/** Digest helper for fixture assertions (no hand-written literals). */
export function fixtureDigest(seed: string): ContentDigest {
  return computeDigest({ fixture: seed });
}

function identity() {
  return {
    id: asGameId("game-spark")!,
    displayName: "Game Spark",
    kind: "game" as const,
    repository: { host: "github.com", owner: "payswapdotorg", repository: "game-spark" },
    revision: { kind: "commit" as const, commit: asCommitSha(FIXTURE_SHA)! },
    lineage: { head: asCommitSha(FIXTURE_SHA)!, ancestors: [] },
  };
}

/**
 * The canonical fixture document: critical entry content + deferred
 * remainders. `options.secondWorldCaching` controls the R15 streaming
 * policy of the second world (default: explicit cacheable streaming).
 */
export function fixtureSparkDocument(options: { readonly secondWorldCaching?: boolean } = {}): GameIRDocument {
  const caching = options.secondWorldCaching ?? true;
  return {
    irVersion: "1",
    identity: identity(),
    lifecycle: "active",
    entry: { world: asWorldId("world-spark")!, scene: asSceneId("scene-entry")! },
    nodes: [
      {
        id: asNodeId("world-spark-node")!,
        kind: "world",
        world: asWorldId("world-spark")!,
        scenes: [asSceneId("scene-entry")!, asSceneId("scene-later")!],
        streaming: { streamable: true, cacheable: true, independentlyBuilt: false },
      },
      {
        id: asNodeId("world-second-node")!,
        kind: "world",
        world: asWorldId("world-second")!,
        scenes: [asSceneId("scene-second")!],
        streaming: { streamable: true, cacheable: caching, independentlyBuilt: true },
      },
      {
        id: asNodeId("scene-entry-node")!,
        kind: "scene",
        world: asWorldId("world-spark")!,
        scene: asSceneId("scene-entry")!,
        entities: [asEntityId("entity-hero")!],
      },
      {
        id: asNodeId("scene-later-node")!,
        kind: "scene",
        world: asWorldId("world-spark")!,
        scene: asSceneId("scene-later")!,
        entities: [asEntityId("entity-later")!],
      },
      {
        id: asNodeId("scene-second-node")!,
        kind: "scene",
        world: asWorldId("world-second")!,
        scene: asSceneId("scene-second")!,
        entities: [asEntityId("entity-second")!],
      },
      {
        id: asNodeId("entity-hero-node")!,
        kind: "entity",
        scene: asSceneId("scene-entry")!,
        entity: asEntityId("entity-hero")!,
        state: {
          kind: "record",
          fields: {
            health: { kind: "int", value: 100n },
            title: { kind: "string", value: "hero" },
          },
        },
        behaviors: [asNodeId("rule-hero-motion")!],
      },
      {
        id: asNodeId("entity-later-node")!,
        kind: "entity",
        scene: asSceneId("scene-later")!,
        entity: asEntityId("entity-later")!,
        state: { kind: "record", fields: { ready: { kind: "bool", value: false } } },
        behaviors: [],
      },
      {
        id: asNodeId("entity-second-node")!,
        kind: "entity",
        scene: asSceneId("scene-second")!,
        entity: asEntityId("entity-second")!,
        state: { kind: "record", fields: { level: { kind: "int", value: 2n } } },
        behaviors: [asNodeId("rule-second")!],
      },
      {
        id: asNodeId("rule-hero-motion")!,
        kind: "rule",
        on: [asEventTypeId("world.entity.spawned")!],
        handles: [asIntentTypeId("avatar.movement.requested")!],
        emits: [asEventTypeId("world.entity.moved")!],
      },
      {
        id: asNodeId("rule-second")!,
        kind: "rule",
        on: [asEventTypeId("world.entity.spawned")!],
        handles: [],
        emits: [],
      },
      {
        id: asNodeId("event-spawned-node")!,
        kind: "event-declaration",
        eventType: asEventTypeId("world.entity.spawned")!,
        payload: { kind: "unit" },
      },
      {
        id: asNodeId("event-moved-node")!,
        kind: "event-declaration",
        eventType: asEventTypeId("world.entity.moved")!,
        payload: { kind: "record", fields: { position: { kind: "list", element: { kind: "float" } } } },
      },
      {
        id: asNodeId("capability-replay-node")!,
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
        restrictions: { denied: ["manipulation"], approvalRequired: ["speech"], sandboxed: false },
      },
    ],
  };
}

/** The default deterministic cost model used by tests/harness (data, E9). */
export function fixtureCostModel(bytesPerMillisecond = 100): { bytesPerMillisecond: number } {
  return { bytesPerMillisecond };
}
