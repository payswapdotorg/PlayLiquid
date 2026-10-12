/**
 * LUMEN RUN — target profiles and builds (PL-037; R6/R12, §Build).
 *
 * The game composes TWO build targets over the SAME GameIR document and
 * the SAME package lock (§Build inputs: GameIR digest + package lock +
 * target profile + engine binding + toolchain profile):
 *
 * - **spark** (R6): the sealed spark target profile record (9:16
 *   portrait mobile-first) planned through runtime-spark's PURE planners
 *   (boot plan, progressive stream schedule, aggressive cache manifest —
 *   the minimal-critical-boot evidence), composed into a build document
 *   by the spark package and driven through the REAL build-orchestrator
 *   staged pipeline (intake → resolve → plan → emit → verify → package →
 *   succeeded). The engine binding cited is the PlayCanvas adapter's
 *   typed web-first binding (its declared supported targets include
 *   spark).
 * - **web** (R12): the PlayCanvas engine binding projected into the
 *   build-contracts wire shape and validated inside BuildInputs for the
 *   `web` target — the Build-input binding evidence for this example
 *   (running the full web pipeline is the same orchestrator path the
 *   spark drive demonstrates; recorded in the delivery notes).
 *
 * Determinism (E9): every digest in the chain is content-derived — the
 * same document + profile + binding + lock always yield the same
 * planning digests and the same build id.
 *
 * Environment limitation (stated plainly): the orchestrator runs over
 * its in-memory fakes (build source, tool fabric, store, clock) — the
 * tool fabric emits deterministic synthetic artifacts, NOT real
 * PlayCanvas bundles; no toolchain binaries are downloaded or executed.
 */

import type { GameIRDocument } from "../../../packages/game-ir/src/index.ts";
import type { PackageLock, PackageRecord } from "../../../packages/package-system/src/index.ts";
import { computeDigest, computeLockFingerprint } from "../../../packages/package-system/src/index.ts";
import { asProfileDigest, sealTargetProfileRecord } from "../../../packages/target-profiles/src/index.ts";
import type { SparkTargetProfileRecord, UnsealedTargetProfileRecord } from "../../../packages/target-profiles/src/index.ts";
import { asBuildTargetId, asProfileInputId, asToolOperationId, asToolchainProfileId, buildInputDigests, validateBuildInputs } from "../../../packages/build-contracts/src/index.ts";
import type { BuildInputs, EngineBindingRef, ToolchainProfileRef } from "../../../packages/build-contracts/src/index.ts";
import { BuildOrchestratorService } from "../../../packages/build-orchestrator/src/index.ts";
import { createFakeBuildSource, createFakeToolFabric, createManualClock, createMemoryBuildStore } from "../../../packages/build-orchestrator/src/index.ts";
import { asTenantId } from "../../../packages/build-orchestrator/src/index.ts";
import { createPlayCanvasEngineBinding, playCanvasCanServeTargetProfile, toBuildContractsEngineBindingRef } from "../../../packages/engine-playcanvas/src/index.ts";
import { buildSparkCacheManifest, planSparkBoot, scheduleSparkStreams } from "../../../packages/runtime-spark/src/index.ts";
import type { SparkBootPlan, SparkCacheManifest, SparkCostModel, SparkStreamSchedule } from "../../../packages/runtime-spark/src/index.ts";
import { composeSparkBuildDocument, runSparkBuild, sparkGameIrDigestOf } from "../../../packages/spark/src/index.ts";
import type { SparkBuildDocument, SparkBuildOutcome, SparkBuildRefusal, SparkBuildRequestIdentity } from "../../../packages/spark/src/index.ts";
import { asDigest, asSparkProfileId, asTargetProfileId, asTimestamp } from "../../../packages/runtime-contracts/src/index.ts";
import { bareDigest, TENANT } from "./ids.ts";

// ---------------------------------------------------------------------------
// The composed build inputs (profile record, engine binding, toolchain)
// ---------------------------------------------------------------------------

/** The boot-planning cost model (planning data, E9). */
export const LUMEN_COST_MODEL: SparkCostModel = { bytesPerMillisecond: 100 };

/** The typed PlayCanvas engine binding (the web-first adapter's own). */
export function lumenEngineBinding() {
  return createPlayCanvasEngineBinding();
}

/** The digest-pinned build-contracts projection of the binding. */
export function lumenEngineBindingRef(): EngineBindingRef {
  return toBuildContractsEngineBindingRef(lumenEngineBinding());
}

/** The toolchain profile the build cites (fake-fabric operations). */
export function lumenToolchain(): ToolchainProfileRef {
  return {
    profileId: asToolchainProfileId("lumen-run-toolchain")!,
    profileDigest: asProfileDigest(computeDigest({ toolchain: "lumen-run", operations: ["build", "test", "package"] })),
    citesToolOperations: ["build", "test", "package"].map((operation) => asToolOperationId(operation)),
  };
}

/**
 * The sealed spark target profile record (R6): 9:16 portrait
 * mobile-first, minimal critical boot budgets, aggressive caching,
 * progressive streaming — with the PlayCanvas engine family accepted and
 * the exact binding digest PINNED (mutual consent between the profile
 * and the binding).
 */
export function lumenSparkProfileRecord(options: { readonly firstPaintTargetMs?: number; readonly firstInteractionTargetMs?: number } = {}): SparkTargetProfileRecord {
  const binding = lumenEngineBinding();
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
      policy: { policyId: "policy-lumen-run", revisionDigest: asDigest(bareDigest(computeDigest({ policy: "lumen-run-runtime" }))!) },
    },
    engineBindings: { engines: [binding.engineId], pinnedBindings: [binding.bindingDigest] },
      evaluationSuites: [{ suiteId: "suite-lumen-smoke", suiteDigest: asProfileDigest(computeDigest({ suite: "lumen-smoke" })) }],
    supersedes: null,
    spark: {
      profileId: asSparkProfileId("spark"),
      formFactor: "mobile-first",
      orientation: "portrait",
      aspectRatio: "9:16",
      boot: {
        entries: [
          { priority: 0, assetRef: "boot://arena", byteCeiling: 120_000, requiredFor: "first-paint" },
          { priority: 1, assetRef: "boot://input-shell", byteCeiling: 40_000, requiredFor: "first-interaction" },
        ],
        firstPaintTargetMs: options.firstPaintTargetMs ?? 1_500,
        firstInteractionTargetMs: options.firstInteractionTargetMs ?? 2_500,
      },
      caching: "aggressive",
      streaming: "progressive",
      maxConcurrentStreams: 2,
      pinnedAt: asTimestamp(1_700_000_000_000),
    },
  };
  return sealTargetProfileRecord(unsealed) as SparkTargetProfileRecord;
}

// ---------------------------------------------------------------------------
// Spark planning (R6: the fast-start budget evidence)
// ---------------------------------------------------------------------------

/** The typed spark planning refusal (the planners' own codes, aggregated). */
export interface SparkPlanningRefusal {
  readonly ok: false;
  readonly code: "spark-planning-refused";
  readonly rejections: readonly { readonly code: string; readonly message: string }[];
}

/** The typed spark planning payload over the game's own document. */
export interface SparkPlanning {
  readonly ok: true;
  readonly plan: SparkBootPlan;
  readonly schedule: SparkStreamSchedule;
  readonly manifest: SparkCacheManifest;
  readonly gameIrDigest: string;
}

/** Typed spark planning result (E8: refusals aggregate the planners' own codes). */
export type SparkPlanningResult = SparkPlanning | SparkPlanningRefusal;

export function planLumenSpark(
  document: GameIRDocument,
  profile: SparkTargetProfileRecord,
  cost: SparkCostModel = LUMEN_COST_MODEL,
): SparkPlanningResult {
  const plan = planSparkBoot(document, profile.spark, cost);
  if (!plan.ok) return { ok: false, code: "spark-planning-refused", rejections: plan.rejections.map((r) => ({ code: r.code, message: r.message })) };
  const schedule = scheduleSparkStreams(plan.plan, profile.spark);
  if (!schedule.ok) return { ok: false, code: "spark-planning-refused", rejections: [{ code: schedule.code, message: schedule.message }] };
  const manifest = buildSparkCacheManifest(plan.plan);
  if (!manifest.ok) return { ok: false, code: "spark-planning-refused", rejections: [{ code: manifest.code, message: manifest.message }] };
  return {
    ok: true as const,
    plan: plan.plan,
    schedule,
    manifest,
    gameIrDigest: sparkGameIrDigestOf(document),
  };
}

// ---------------------------------------------------------------------------
// Spark build drive (the REAL staged pipeline over in-memory ports)
// ---------------------------------------------------------------------------

/** The spark build document for the game (typed refusal or document). */
export function composeLumenSparkBuild(input: {
  readonly document: GameIRDocument;
  readonly lock: PackageLock;
  readonly records: readonly PackageRecord[];
  readonly profile?: SparkTargetProfileRecord;
}): SparkBuildDocument | SparkBuildRefusal {
  const profile = input.profile ?? lumenSparkProfileRecord();
  const binding = lumenEngineBinding();
  const compatibility = playCanvasCanServeTargetProfile(binding, profile);
  if (!compatibility.compatible) {
    throw new Error(`playcanvas binding cannot serve the spark profile: ${compatibility.code}`);
  }
  return composeSparkBuildDocument(asTenantId(TENANT), {
    document: input.document,
    profileRecord: profile,
    engineBinding: lumenEngineBindingRef(),
    toolchain: lumenToolchain(),
    lock: input.lock,
    costModel: LUMEN_COST_MODEL,
  });
}

/**
 * Runs the game's spark build end to end over the build-orchestrator
 * staged pipeline. The source resolves MY package records and lock; the
 * fabric is the orchestrator's deterministic fake (synthetic artifacts,
 * E11 limitation recorded above).
 */
export async function runLumenSparkBuild(input: {
  readonly document: GameIRDocument;
  readonly lock: PackageLock;
  readonly records: readonly PackageRecord[];
  readonly profile?: SparkTargetProfileRecord;
  readonly identity?: SparkBuildRequestIdentity;
}): Promise<SparkBuildOutcome | SparkBuildRefusal> {
  const composed = composeLumenSparkBuild(input);
  if (!composed.ok) return composed;
  const orchestrator = new BuildOrchestratorService({
    sources: createFakeBuildSource({
      records: input.records,
      locks: new Map([[composed.inputs.packageLock.lockFingerprint, input.lock]]),
      resolvableContent: new Set(buildInputDigests(composed.inputs).map((entry) => entry.digest)),
    }),
    fabric: createFakeToolFabric({ operations: lumenToolchain().citesToolOperations }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });
  return runSparkBuild(asTenantId(TENANT), orchestrator, composed, input.identity ?? {
    requester: "lumen-run-builder",
    nonce: "lumen-spark-build-1",
    requestedAt: 1_700_000_000_000,
  });
}

// ---------------------------------------------------------------------------
// Web target (R12: the Build-input engine binding)
// ---------------------------------------------------------------------------

/** The typed result of composing the web-target build inputs. */
export type WebBuildInputsResult =
  | { readonly ok: true; readonly inputs: BuildInputs; readonly gameIrDigest: string }
  | { readonly ok: false; readonly reasons: readonly { readonly code: string; readonly message: string }[] };

/** Composes and validates the web-target BuildInputs with the PlayCanvas binding. */
export function composeLumenWebInputs(input: { readonly document: GameIRDocument; readonly lock: PackageLock }): WebBuildInputsResult {
  const gameIrDigest = sparkGameIrDigestOf(input.document);
  const inputs: BuildInputs = {
    gameIr: { digest: gameIrDigest },
    packageLock: {
      lockFingerprint: computeLockFingerprint(input.lock),
      pinnedPackageCount: input.lock.packages.length,
    },
    targetProfile: {
      profileId: asProfileInputId("web"),
      profileDigest: asProfileDigest(computeDigest({ target: "web", game: "lumen-run" })),
      target: asBuildTargetId("web"),
      vendorGate: { kind: "none" },
    },
    engineBinding: lumenEngineBindingRef(),
    toolchain: lumenToolchain(),
  };
  const validation = validateBuildInputs(inputs);
  if (!validation.ok) {
    return { ok: false, reasons: validation.reasons.map((reason) => ({ code: reason.code, message: reason.message })) };
  }
  return { ok: true, inputs, gameIrDigest };
}
