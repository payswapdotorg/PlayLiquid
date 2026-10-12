/**
 * Deterministic fixtures for the multi-target build service's tests and
 * harness (house pattern; NOT exported from the package barrel).
 *
 * Every digest is derived at runtime through the owning package's own
 * authorities — package records are sealed through package-system's
 * `sealPackageRecord`, target profiles through target-profiles'
 * `sealTargetProfileRecord` — never hand-written literals. Vendor evidence
 * records are shape-only test doubles, clearly labeled: authorization is
 * NEVER simulated as real (lock rule 24, E11).
 */

import { asBuildNonce, asRequesterId, asToolOperationId, asToolchainProfileId, asVendorId } from "@playliquid/build-contracts";
import type { BuildNonce, RequesterId, ToolOperationId, VerificationEvidence, VendorSdkEvidence, OnTargetEvidence } from "@playliquid/build-contracts";
import { computeDigest, computeLockFingerprint, sealPackageRecord } from "@playliquid/package-system";
import type { ContentDigest, PackageLock, PackageRecord, SemanticVersion, UnsealedPackageRecord } from "@playliquid/package-system";
import type { SparkTargetProfile } from "@playliquid/runtime-contracts";
import { asDigest, asSparkProfileId, asTargetProfileId, asTimestamp } from "@playliquid/runtime-contracts";
import { asEngineBindingDigest, asEngineId, asProfileDigest, asVendorId as asProfileVendorId, sealTargetProfileRecord } from "@playliquid/target-profiles";
import type { EngineId, TargetCapabilities, TargetId, TargetProfileRecord, UnsealedTargetProfileRecord } from "@playliquid/target-profiles";
import { createFakeBuildSource, createFakeToolFabric, createManualClock } from "@playliquid/build-orchestrator";
import type { FakeToolFabric, ManualClock } from "@playliquid/build-orchestrator";
import { MultiTargetBuildService, createDefaultEngineCatalog } from "./index.ts";
import type { EngineCatalog } from "./catalog.ts";
import { createMemoryFanoutStores, createMemoryProfileSource } from "./fakes.ts";
import type { MemoryFanoutStores, MemoryProfileSource } from "./fakes.ts";
import type { MultiTargetBuildRequest } from "./request.ts";
import type { TargetProfileBundle } from "./profiles.ts";

/** A stable, digest-derived content digest for fixtures (no hand-written digests). */
export function fixtureDigest(seed: string): ContentDigest {
  return computeDigest({ fixture: seed });
}

const FIXTURE_SEMVER: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: [], build: [] };

/** Options of {@link fixturePackageRecord}. */
export interface FixtureRecordOptions {
  /** `declared` (unverified) license status fails the R19 build gate on purpose. */
  readonly licenseStatus?: "verified" | "declared";
}

/** A minimal gate-passing package record, sealed via package-system's seal discipline. */
export function fixturePackageRecord(id: string, options: FixtureRecordOptions = {}): PackageRecord {
  const unsealed: UnsealedPackageRecord = {
    identity: { kind: "assets", id, version: FIXTURE_SEMVER },
    metadata: {
      dependencies: [],
      providedCapabilities: [],
      requiredCapabilities: [],
      permissions: [],
      license: { spdxExpression: "Apache-2.0", status: options.licenseStatus ?? "verified" },
      provenance: {
        origin: { type: "original" },
        sourceCommit: "0123456789abcdef0123456789abcdef01234567",
        transformationHistory: [{ kind: "author", description: "authored for fixtures" }],
        modelProvenance: [],
        generatedByAi: false,
      },
      lineage: { origin: null, parent: null },
      compatibility: { runtimes: ["interactive"], engines: ["native"], targets: [] },
      resources: {},
      evaluationSuites: [],
      artifacts: [],
      extensionPoints: [],
      overlay: null,
    },
  };
  return sealPackageRecord(unsealed);
}

/** Two sealed, gate-passing fixture records. */
export function fixtureRecords(): readonly PackageRecord[] {
  return [fixturePackageRecord("fixture-assets-pack"), fixturePackageRecord("fixture-logic-pack")];
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

function desktopCapabilities(overrides: Partial<TargetCapabilities> = {}): TargetCapabilities {
  return { render: "webgpu", vramClass: "medium", inputModalities: ["keyboard", "mouse"], screen: { touch: false, refreshHz: 60 }, ...overrides };
}

const FIXTURE_POLICY = {
  runtimes: ["interactive" as const, "simulation" as const],
  policy: {
    policyId: "policy-default",
    revisionDigest: asDigest(computeDigest({ fixture: "runtime-policy" }).slice("sha256:".length)),
  },
};

/** The canonical Spark properties: 9:16, mobile-first, minimal critical boot, aggressive caching (R6). */
function fixtureSparkProperties(): SparkTargetProfile {
  return {
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
    maxConcurrentStreams: 4,
    pinnedAt: asTimestamp(1_700_000_000_000),
  };
}

/** Options of {@link fixtureProfileBundle}. */
export interface FixtureProfileOptions {
  /** The engines the profile's compatibility declaration accepts. */
  readonly engines?: readonly string[];
  /** Pins exact engine binding digests (defaults: none). */
  readonly pinnedBindings?: readonly string[];
  /** Declares an authorized-vendor-SDK gate on the BUNDLE (evidence-missing tests). */
  readonly vendorGate?: "none" | { readonly vendorId: string };
  /** Override the profile's version label. */
  readonly version?: string;
}

/**
 * A sealed, valid profile bundle for one taxonomy target. The engine
 * declaration defaults mirror the merged adapter family's honest coverage
 * (per the engine packages' own supported-target declarations).
 */
export function fixtureProfileBundle(target: TargetId, options: FixtureProfileOptions = {}): TargetProfileBundle {
  const defaults: Record<TargetId, readonly string[]> = {
    web: ["playcanvas", "unity", "godot"],
    spark: ["playcanvas"],
    windows: ["unreal", "unity", "godot"],
    macos: ["unreal", "unity", "godot"],
    linux: ["unreal", "unity", "godot"],
    android: ["unity"],
    ios: ["unity"],
    steamdeck: ["unreal"],
    xr: ["native"],
    "dedicated-server": ["native"],
    console: ["vendor-engine"],
  };
  const engines = options.engines ?? defaults[target];
  const profileId = target === "spark" ? "spark" : `${target}-default`;
  const base = {
    profileId: asTargetProfileId(profileId),
    target,
    version: options.version ?? "1.0.0",
    runtimePolicy: FIXTURE_POLICY,
    engineBindings: {
      engines: engines.map((engine) => asEngineId(engine)),
      pinnedBindings: options.pinnedBindings === undefined ? null : options.pinnedBindings.map((digest) => asEngineBindingDigest(digest)),
    },
    evaluationSuites: [{ suiteId: "suite-smoke", suiteDigest: asProfileDigest(fixtureDigest("suite-smoke")) }],
    supersedes: null,
  };
  const unsealed: UnsealedTargetProfileRecord = buildShapeFor(target, base);
  const record = sealTargetProfileRecord(unsealed) as TargetProfileRecord;
  return {
    record,
    vendorGate: options.vendorGate === undefined || options.vendorGate === "none"
      ? { kind: "none" as const }
      : { kind: "authorized-vendor-sdk" as const, vendorId: asVendorId(options.vendorGate.vendorId) },
  };
}

/** Composes the per-target record shape the union enforces (spark/console/dedicated-server/xr rules). */
function buildShapeFor(target: TargetId, base: Record<string, unknown>): UnsealedTargetProfileRecord {
  if (target === "spark") {
    return {
      ...base,
      formFactor: "mobile-first",
      orientation: "portrait",
      aspectRatio: "9:16",
      capabilities: desktopCapabilities({ inputModalities: ["touch"], screen: { touch: true, refreshHz: 60 } }),
      spark: fixtureSparkProperties(),
    } as UnsealedTargetProfileRecord;
  }
  if (target === "console") {
    return {
      ...base,
      formFactor: "desktop-first",
      orientation: "landscape",
      aspectRatio: "16:9",
      capabilities: desktopCapabilities({ render: "vendor", vramClass: "high", inputModalities: ["gamepad"], screen: { touch: false, refreshHz: 120 } }),
      console: {
        vendorSdk: {
          vendorId: asProfileVendorId("nintendo"),
          sdkDigest: asProfileDigest(fixtureDigest("vendor-sdk")),
          authorizationDigest: asProfileDigest(fixtureDigest("vendor-authorization")),
        },
      },
    } as UnsealedTargetProfileRecord;
  }
  if (target === "xr") {
    return {
      ...base,
      formFactor: "xr",
      orientation: "landscape",
      aspectRatio: "2:1",
      capabilities: desktopCapabilities({ inputModalities: ["hand-tracking", "motion"], screen: { touch: false, refreshHz: 90 } }),
    } as UnsealedTargetProfileRecord;
  }
  if (target === "dedicated-server") {
    return {
      ...base,
      formFactor: "headless-server",
      orientation: "any",
      aspectRatio: "any",
      capabilities: desktopCapabilities({ render: "none", vramClass: "none", inputModalities: ["none"], screen: { touch: false } }),
    } as UnsealedTargetProfileRecord;
  }
  const shape: Record<TargetId, { formFactor: "mobile-first" | "desktop-first" | "headless-server" | "xr"; orientation: "portrait" | "landscape" | "any"; touch: boolean }> = {
    web: { formFactor: "desktop-first", orientation: "landscape", touch: false },
    spark: { formFactor: "mobile-first", orientation: "portrait", touch: true },
    windows: { formFactor: "desktop-first", orientation: "landscape", touch: false },
    macos: { formFactor: "desktop-first", orientation: "landscape", touch: false },
    linux: { formFactor: "desktop-first", orientation: "landscape", touch: false },
    android: { formFactor: "mobile-first", orientation: "portrait", touch: true },
    ios: { formFactor: "mobile-first", orientation: "portrait", touch: true },
    steamdeck: { formFactor: "desktop-first", orientation: "landscape", touch: true },
    xr: { formFactor: "xr", orientation: "landscape", touch: false },
    "dedicated-server": { formFactor: "headless-server", orientation: "any", touch: false },
    console: { formFactor: "desktop-first", orientation: "landscape", touch: false },
  };
  const form = shape[target];
  return {
    ...base,
    formFactor: form.formFactor,
    orientation: form.orientation,
    aspectRatio: form.orientation === "portrait" ? "9:16" : "16:9",
    capabilities: desktopCapabilities({
      inputModalities: form.touch ? ["touch"] : ["keyboard", "mouse"],
      screen: { touch: form.touch, refreshHz: 60 },
    }),
  } as UnsealedTargetProfileRecord;
}

/** The tool operations every fixture toolchain cites. */
export const FIXTURE_OPERATIONS: readonly ToolOperationId[] = ["build", "test", "package"].map((operation) => asToolOperationId(operation));

/** Options of {@link fixtureMultiTargetRequest}. */
export interface FixtureRequestOptions {
  readonly requester?: RequesterId;
  readonly nonce?: BuildNonce;
  readonly targets?: readonly string[];
  readonly gameIrDigest?: ContentDigest;
  readonly evidence?: readonly VerificationEvidence[];
  readonly requestedAt?: number;
}

/** A well-formed multi-target build request over the given lock (deterministic). */
export function fixtureMultiTargetRequest(lock: PackageLock, options: FixtureRequestOptions = {}): MultiTargetBuildRequest {
  return {
    kind: "multi-target-build-request",
    requester: options.requester ?? asRequesterId("builder-agent"),
    nonce: options.nonce ?? asBuildNonce("mtb-nonce-0001"),
    pins: {
      gameIr: options.gameIrDigest ?? fixtureDigest("game-ir-composition"),
      packageLock: { lockFingerprint: computeLockFingerprint(lock), pinnedPackageCount: lock.packages.length },
      toolchain: {
        profileId: asToolchainProfileId("multi-target-toolchain"),
        profileDigest: fixtureDigest("toolchain-profile"),
        citesToolOperations: FIXTURE_OPERATIONS,
      },
    },
    targets: options.targets ?? ["web", "windows"],
    ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
    parameters: { kind: "record", fields: { "include-debug": { kind: "bool", value: false } } },
    requestedAt: options.requestedAt ?? 1_700_000_000_000,
  };
}

/** The content digests the build source must resolve for `request`'s pins (host content: game-ir, toolchain, the catalog's engine bindings, target profiles). */
export function requestContentDigests(
  request: MultiTargetBuildRequest,
  catalog: readonly { readonly binding: { readonly bindingDigest: ContentDigest } }[],
  ...extraProfiles: readonly ContentDigest[]
): readonly ContentDigest[] {
  return [
    request.pins.gameIr,
    request.pins.toolchain.profileDigest,
    ...catalog.map((entry) => entry.binding.bindingDigest),
    ...extraProfiles,
  ];
}

/** A shape-only vendor-SDK PASS record for `vendorId` (test double; authorization is never real — E11). */
export function fixtureVendorSdkEvidence(vendorId: string): VendorSdkEvidence {
  return {
    kind: "vendor-sdk",
    verdict: "pass",
    authorization: {
      vendorId: asVendorId(vendorId),
      authorizedSdkDigest: fixtureDigest("vendor-authorized-sdk"),
      authorizationDigest: fixtureDigest("vendor-authorization"),
    },
    evidenceDigest: fixtureDigest("vendor-sdk-evidence"),
  };
}

/** A shape-only on-target PASS record verifying exactly `manifestDigest` (out-of-band vendor pipeline double). */
export function fixtureOnTargetEvidence(manifestDigest: ContentDigest): OnTargetEvidence {
  return {
    kind: "on-target",
    verdict: "pass",
    verifiedDigest: manifestDigest,
    evidenceDigest: computeDigest({ onTarget: manifestDigest }),
  };
}

/** The engine ids of the default catalog, for assertions. */
export const DEFAULT_CATALOG_ENGINES: readonly EngineId[] = ["playcanvas", "unreal", "unity", "godot"].map((id) => id as EngineId);

/** The full-service test rig assembled from the in-memory doubles (tests/harness only). */
export interface ServiceRig {
  readonly service: MultiTargetBuildService;
  readonly profiles: MemoryProfileSource;
  readonly sources: ReturnType<typeof createFakeBuildSource>;
  readonly fabric: FakeToolFabric;
  readonly clock: ManualClock;
  readonly stores: MemoryFanoutStores;
  readonly lock: PackageLock;
  readonly catalog: EngineCatalog;
}

/** Options of {@link createServiceRig}. */
export interface RigOptions {
  readonly targets?: readonly TargetId[];
  readonly operations?: readonly string[];
  readonly records?: readonly PackageRecord[];
}

/**
 * Assembles a multi-target service over the in-memory doubles: a profile
 * source publishing one sealed bundle per taxonomy target, a fake build
 * source (package-system's REAL resolve), a fake Tool Fabric and a keyed
 * map of in-memory stores. Deterministic (fixed clock start, no
 * randomness). TEST SUPPORT ONLY.
 */
export function createServiceRig(options: RigOptions = {}): ServiceRig {
  const records = options.records ?? fixtureRecords();
  const lock = fixtureLock(records);
  const catalog = createDefaultEngineCatalog();
  const targets = options.targets ?? (["web", "spark", "windows", "macos", "linux", "android", "ios", "steamdeck", "xr", "dedicated-server", "console"] as TargetId[]);
  const bundles = targets.map((target) => [target, fixtureProfileBundle(target)] as const);
  const profiles = createMemoryProfileSource(bundles);
  const sources = createFakeBuildSource({
    records,
    locks: new Map([[computeLockFingerprint(lock), lock]]),
    resolvableContent: new Set(requestContentDigests(fixtureMultiTargetRequest(lock), catalog, ...bundles.map(([, bundle]) => bundle.record.profileDigest))),
  });
  const fabric = createFakeToolFabric({ operations: (options.operations ?? ["build", "test", "package"]).map((operation) => asToolOperationId(operation)) });
  const clock = createManualClock();
  const stores = createMemoryFanoutStores();
  const service = new MultiTargetBuildService({
    catalog,
    profiles,
    sources,
    fabric,
    clock,
    stores,
  });
  return { service, profiles, sources, fabric, clock, stores, lock, catalog };
}
