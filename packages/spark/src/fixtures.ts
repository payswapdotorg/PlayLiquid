/**
 * Deterministic fixtures for the spark build surface's tests and harness
 * (house pattern; NOT exported from the package barrel).
 *
 * Everything is derived at runtime — no hand-written digest literals, no
 * randomness. The game-ir fixture document mirrors runtime-spark's
 * fixture family (a critical entry world/scene + deferred remainders) so
 * the spark digests exercised here are the same planning story the
 * runtime tests prove; the profile record is SEALED through
 * target-profiles' own seal discipline; the package records through
 * package-system's.
 */

import { asEventTypeId, asIntentTypeId, asNodeId } from "@playliquid/game-ir";
import type { GameIRDocument } from "@playliquid/game-ir";
import {
  asCommitSha,
  asEntityId,
  asGameId,
  asSceneId,
  asWorldId,
} from "@playliquid/game-contracts";
import { asBuildTargetId, asEngineId, asToolOperationId, asToolchainProfileId } from "@playliquid/build-contracts";
import type { EngineBindingRef, ToolchainProfileRef } from "@playliquid/build-contracts";
import { asDigest, asSparkProfileId, asTargetProfileId, asTimestamp } from "@playliquid/runtime-contracts";
import { computeDigest, computeLockFingerprint, sealPackageRecord } from "@playliquid/package-system";
import type { ContentDigest, PackageLock, PackageRecord, SemanticVersion, UnsealedPackageRecord } from "@playliquid/package-system";
import { asEngineBindingDigest, asProfileDigest, asEngineId as asProfileEngineId, sealTargetProfileRecord } from "@playliquid/target-profiles";
import type { SparkTargetProfileRecord, UnsealedTargetProfileRecord } from "@playliquid/target-profiles";

const FIXTURE_SHA = "b88e814755e9bd1efed6cb6f8e26f316bada1247";

/** A stable, digest-derived content digest for fixtures (no hand-written literals). */
export function fixtureDigest(seed: string): ContentDigest {
  return computeDigest({ fixture: seed });
}

const FIXTURE_SEMVER: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: [], build: [] };

/** A minimal gate-passing package record (license verified), sealed per package-system. */
export function fixturePackageRecord(id: string): PackageRecord {
  const unsealed: UnsealedPackageRecord = {
    identity: { kind: "assets", id, version: FIXTURE_SEMVER },
    metadata: {
      dependencies: [],
      providedCapabilities: [],
      requiredCapabilities: [],
      permissions: [],
      license: { spdxExpression: "Apache-2.0", status: "verified" },
      provenance: {
        origin: { type: "original" },
        sourceCommit: "0123456789abcdef0123456789abcdef01234567",
        transformationHistory: [{ kind: "author", description: "authored for spark fixtures" }],
        modelProvenance: [],
        generatedByAi: false,
      },
      lineage: { origin: null, parent: null },
      compatibility: { runtimes: ["interactive"], engines: ["native"], targets: [{ profileId: "spark", version: FIXTURE_SEMVER }] },
      resources: {},
      evaluationSuites: [],
      artifacts: [],
      extensionPoints: [],
      overlay: null,
    },
  };
  return sealPackageRecord(unsealed);
}

/** Two sealed, gate-passing fixture records (an assets pack and a logic pack). */
export function fixtureRecords(): readonly PackageRecord[] {
  return [fixturePackageRecord("spark-assets-pack"), fixturePackageRecord("spark-logic-pack")];
}

/** A lock pinning exactly `records` (fingerprint derived, never hand-written). */
export function fixtureLock(records: readonly PackageRecord[]): PackageLock {
  return {
    lockVersion: 1,
    packages: records.map((record) => ({
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
      contentDigest: record.identity.contentDigest,
    })),
    hostCapabilities: [],
  };
}

/** A sealed, valid spark target profile record (9:16 portrait mobile-first). */
export function fixtureSparkProfileRecord(): SparkTargetProfileRecord {
  const unsealed: UnsealedTargetProfileRecord = {
    profileId: asTargetProfileId("spark"),
    target: "spark",
    version: "1.0.0",
    formFactor: "mobile-first",
    orientation: "portrait",
    aspectRatio: "9:16",
    capabilities: {
      render: "webgpu",
      vramClass: "medium",
      inputModalities: ["touch"],
      screen: { touch: true, refreshHz: 60 },
    },
    runtimePolicy: {
      runtimes: ["interactive"],
      policy: { policyId: "policy-spark-build", revisionDigest: asDigest(fixtureDigest("spark-build-policy").slice("sha256:".length)) },
    },
    engineBindings: { engines: [asProfileEngineId("native")], pinnedBindings: null },
    evaluationSuites: [{ suiteId: "suite-spark-smoke", suiteDigest: asProfileDigest(fixtureDigest("suite-spark-smoke")) }],
    supersedes: null,
    spark: {
      profileId: asSparkProfileId("spark"),
      formFactor: "mobile-first",
      orientation: "portrait",
      aspectRatio: "9:16",
      boot: {
        entries: [
          { priority: 0, assetRef: "boot://shell", byteCeiling: 120_000, requiredFor: "first-paint" },
          { priority: 1, assetRef: "boot://input-shell", byteCeiling: 40_000, requiredFor: "first-interaction" },
        ],
        firstPaintTargetMs: 1_500,
        firstInteractionTargetMs: 2_500,
      },
      caching: "aggressive",
      streaming: "progressive",
      maxConcurrentStreams: 2,
      pinnedAt: asTimestamp(1_700_000_000_000),
    },
  };
  return sealTargetProfileRecord(unsealed) as SparkTargetProfileRecord;
}

/** A digest-pinned engine binding declaring the web-first targets (web + spark). */
export function fixtureEngineBinding(): EngineBindingRef {
  return {
    engineId: asEngineId("native"),
    bindingDigest: fixtureDigest("engine-binding-native-spark"),
    supportedTargets: [asBuildTargetId("web"), asBuildTargetId("spark")],
  };
}

/** A toolchain profile citing the operations the fake fabric provides. */
export function fixtureToolchain(operations: readonly string[] = ["build", "test", "package"]): ToolchainProfileRef {
  return {
    profileId: asToolchainProfileId("spark-toolchain"),
    profileDigest: fixtureDigest("toolchain-profile-spark"),
    citesToolOperations: operations.map((operation) => asToolOperationId(operation)),
  };
}

/** The pinned-binding variant of the profile record (pins the fixture binding digest). */
export function fixturePinnedSparkProfileRecord(): SparkTargetProfileRecord {
  const base = fixtureSparkProfileRecord();
  const unsealed: UnsealedTargetProfileRecord = { ...base, engineBindings: { engines: base.engineBindings.engines, pinnedBindings: [asEngineBindingDigest(fixtureEngineBinding().bindingDigest)] } };
  return sealTargetProfileRecord(unsealed) as SparkTargetProfileRecord;
}

function identity() {
  return {
    id: asGameId("game-spark-build")!,
    displayName: "Game Spark Build",
    kind: "game" as const,
    repository: { host: "github.com", owner: "payswapdotorg", repository: "game-spark-build" },
    revision: { kind: "commit" as const, commit: asCommitSha(FIXTURE_SHA)! },
    lineage: { head: asCommitSha(FIXTURE_SHA)!, ancestors: [] },
  };
}

/**
 * The canonical fixture game-ir document: a critical entry world/scene
 * (hero, rule, events) plus deferred remainders (a later scene of the
 * entry world and a second world with its own scene/entity/rule) — the
 * same planning shape runtime-spark's tests prove.
 */
export function fixtureSparkBuildDocument(options: { readonly heroHealth?: bigint } = {}): GameIRDocument {
  const heroHealth = options.heroHealth ?? 100n;
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
        streaming: { streamable: true, cacheable: true, independentlyBuilt: true },
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
            health: { kind: "int", value: heroHealth },
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
    ],
  };
}

/** The default deterministic cost model used by tests/harness (data, E9). */
export function fixtureCostModel(bytesPerMillisecond = 100): { bytesPerMillisecond: number } {
  return { bytesPerMillisecond };
}

/** Convenience: the fingerprint of a fixture lock (for rig wiring). */
export function fixtureLockFingerprint(lock: PackageLock): ContentDigest {
  return computeLockFingerprint(lock);
}
