/**
 * Deterministic fixture builders for tests and the harness.
 *
 * NOT exported from the package barrel (house pattern). All digests are
 * computed at runtime — no hand-written digest literals. Records are
 * returned SEALED (via `sealTargetProfileRecord`) so digest-integrity
 * tests exercise the real seal path.
 */

import { createHash } from "node:crypto";
import type { SparkBootEntry, SparkTargetProfile } from "@playliquid/runtime-contracts";
import { asDigest, asSparkProfileId, asTargetProfileId, asTimestamp } from "@playliquid/runtime-contracts";
import { asEngineBindingDigest, asEngineId, asProfileDigest, asVendorId } from "./primitives.ts";
import type { ProfileDigest } from "./primitives.ts";
import type { EngineBindingDescriptor } from "./engine-seam.ts";
import { sealTargetProfileRecord } from "./digest.ts";
import type {
  ConsoleTargetProfileRecord,
  PlainTargetProfileRecord,
  SparkTargetProfileRecord,
  UnsealedTargetProfileRecord,
} from "./records.ts";
import type { TargetCapabilities } from "./capabilities.ts";
import type { TargetId } from "./taxonomy.ts";

/** A stable, hash-derived profile digest for fixtures (no hand-written digests). */
export function fixtureDigest(seed: string): ProfileDigest {
  const hex = createHash("sha256").update(`fixture:${seed}`, "utf8").digest("hex");
  return asProfileDigest(`sha256:${hex}`);
}

function fixtureCapabilities(overrides?: Partial<TargetCapabilities>): TargetCapabilities {
  return {
    render: "webgpu",
    vramClass: "medium",
    inputModalities: ["keyboard", "mouse"],
    screen: { touch: false, refreshHz: 60 },
    ...overrides,
  };
}

const FIXTURE_POLICY = {
  runtimes: ["interactive" as const, "simulation" as const],
  policy: {
    policyId: "policy-default",
    revisionDigest: asDigest(createHash("sha256").update("fixture:policy", "utf8").digest("hex")),
  },
};

/** The canonical Spark properties: 9:16, mobile-first, minimal critical boot, aggressive caching (R6). */
export function fixtureSparkProperties(): SparkTargetProfile {
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
    maxConcurrentStreams: 4,
    pinnedAt: asTimestamp(1_700_000_000_000),
  };
}

/** A sealed, valid spark profile record (9:16 mobile-first, lock 16). */
export function fixtureSparkRecord(): SparkTargetProfileRecord {
  const unsealed: UnsealedTargetProfileRecord = {
    profileId: asTargetProfileId("spark"),
    target: "spark",
    version: "1.0.0",
    formFactor: "mobile-first",
    orientation: "portrait",
    aspectRatio: "9:16",
    capabilities: fixtureCapabilities({
      render: "webgpu",
      inputModalities: ["touch"],
      screen: { touch: true, refreshHz: 60 },
    }),
    runtimePolicy: FIXTURE_POLICY,
    engineBindings: { engines: [asEngineId("native")], pinnedBindings: null },
    evaluationSuites: [{ suiteId: "suite-spoke", suiteDigest: fixtureDigest("suite-spoke") }],
    supersedes: null,
    spark: fixtureSparkProperties(),
  };
  return sealTargetProfileRecord(unsealed) as SparkTargetProfileRecord;
}

/** A sealed, valid console profile record (vendor marker structurally present). */
export function fixtureConsoleRecord(vendorId = "nintendo"): ConsoleTargetProfileRecord {
  const unsealed: UnsealedTargetProfileRecord = {
    profileId: asTargetProfileId("console-vendor"),
    target: "console",
    version: "1.0.0",
    formFactor: "desktop-first",
    orientation: "landscape",
    aspectRatio: "16:9",
    capabilities: fixtureCapabilities({
      render: "vendor",
      vramClass: "high",
      inputModalities: ["gamepad"],
      screen: { touch: false, refreshHz: 120 },
    }),
    runtimePolicy: FIXTURE_POLICY,
    engineBindings: { engines: [asEngineId("vendor-engine")], pinnedBindings: null },
    evaluationSuites: [],
    supersedes: null,
    console: {
      vendorSdk: {
        vendorId: asVendorId(vendorId),
        sdkDigest: fixtureDigest("vendor-sdk"),
        authorizationDigest: fixtureDigest("vendor-authorization"),
      },
      vendorCapabilities: {
        kind: "record",
        fields: { "vendor-quirk-mode": { kind: "int", value: 2n } },
      },
    },
  };
  return sealTargetProfileRecord(unsealed) as ConsoleTargetProfileRecord;
}

/** A sealed, valid plain (non-spark, non-console) profile record. */
export function fixtureWebRecord(): PlainTargetProfileRecord {
  const unsealed: UnsealedTargetProfileRecord = {
    profileId: asTargetProfileId("web-default"),
    target: "web",
    version: "1.0.0",
    formFactor: "desktop-first",
    orientation: "landscape",
    aspectRatio: "16:9",
    capabilities: fixtureCapabilities(),
    runtimePolicy: FIXTURE_POLICY,
    engineBindings: { engines: [asEngineId("native"), asEngineId("playcanvas")], pinnedBindings: null },
    evaluationSuites: [{ suiteId: "suite-smoke", suiteDigest: fixtureDigest("suite-smoke") }],
    supersedes: null,
  };
  return sealTargetProfileRecord(unsealed) as PlainTargetProfileRecord;
}

/** A sealed, valid dedicated-server profile record (headless). */
export function fixtureDedicatedServerRecord(): PlainTargetProfileRecord {
  const unsealed: UnsealedTargetProfileRecord = {
    profileId: asTargetProfileId("server-authoritative"),
    target: "dedicated-server",
    version: "1.0.0",
    formFactor: "headless-server",
    orientation: "any",
    aspectRatio: "any",
    capabilities: fixtureCapabilities({ render: "none", vramClass: "none", inputModalities: ["none"], screen: { touch: false } }),
    runtimePolicy: { runtimes: ["simulation"], policy: FIXTURE_POLICY.policy },
    engineBindings: { engines: [asEngineId("native")], pinnedBindings: null },
    evaluationSuites: [],
    supersedes: null,
  };
  return sealTargetProfileRecord(unsealed);
}

/** An engine binding descriptor fixture declaring support for `targets`. */
export function fixtureBinding(engineId: string, targets: readonly TargetId[]): EngineBindingDescriptor {
  return {
    engineId: asEngineId(engineId),
    bindingDigest: asEngineBindingDigest(fixtureDigest(`binding-${engineId}`)),
    supportedTargets: [...targets],
  };
}
