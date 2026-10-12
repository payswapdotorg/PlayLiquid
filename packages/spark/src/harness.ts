/**
 * BUILD EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives the full PL-035 spark build story over the REAL build-orchestrator
 * pipeline (PL-020 — this package drives stages, it never re-implements
 * them), printing machine-readable JSON; exits non-zero on any unexpected
 * outcome. No IO beyond stdout; no clock reads (the orchestrator's injected
 * manual clock is the only time source); no randomness (every digest is
 * content-derived, E9).
 *
 * Story:
 *  1. compose the spark build document — typed digests over the boot plan +
 *     stream schedule + cache manifest composed from runtime-spark's pure
 *     planners over the SAME game-ir content (E9);
 *  2. drive the staged pipeline to SUCCEEDED with the typed build result
 *     (build id, manifest digest, result digest, artifact count);
 *  3. E6 idempotent replay serves the recorded build (no re-drive);
 *  4. E8 refusals: a non-spark profile record, budget inversion, oversized
 *     critical boot, a forged (unresolvable) game-ir input digest;
 *  5. E11 truthfulness: a missing toolchain operation fails the build with a
 *     recorded limitation, never a simulated success;
 *  6. R20 tenant isolation: cross-tenant drives are typed refusals;
 *  7. E9 determinism: two identically-wired services produce identical
 *     build ids and identical result digests;
 *  8. E10 evidence discipline: per-build event sequences are exactly 1..n.
 */

import { asToolOperationId, buildInputDigests } from "@playliquid/build-contracts";
import { BuildOrchestratorService } from "@playliquid/build-orchestrator";
import { createFakeBuildSource, createFakeToolFabric, createManualClock, createMemoryBuildStore } from "@playliquid/build-orchestrator";
import { asTenantId } from "@playliquid/build-orchestrator";
import type { TenantId } from "@playliquid/build-orchestrator";
import type { SparkTargetProfileRecord, UnsealedTargetProfileRecord } from "@playliquid/target-profiles";
import { sealTargetProfileRecord } from "@playliquid/target-profiles";
import { composeSparkBuildDocument } from "./document.ts";
import type { SparkBuildDocument } from "./document.ts";
import { runSparkBuild } from "./build.ts";
import type { SparkBuildOutcome, SparkBuildResult } from "./build.ts";
import {
  fixtureCostModel,
  fixtureDigest,
  fixtureEngineBinding,
  fixtureLock,
  fixtureRecords,
  fixtureSparkBuildDocument,
  fixtureSparkProfileRecord,
  fixtureToolchain,
} from "./fixtures.ts";

const TENANT = asTenantId("tenant-spark-harness")!;
const OTHER_TENANT = asTenantId("tenant-spark-other")!;
const OPERATIONS = ["build", "test", "package"] as const;

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
const failures: string[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
  if (expected !== actual) {
    failures.push(`${name}: expected ${expected}, got ${actual}`);
  }
}

interface Rig {
  readonly service: BuildOrchestratorService;
  readonly document: SparkBuildDocument;
}

function makeRig(options: { readonly fabricOperations?: readonly string[] } = {}): Rig {
  const fabricOperations = options.fabricOperations ?? OPERATIONS;
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const composed = composeSparkBuildDocument(TENANT, {
    document: fixtureSparkBuildDocument(),
    profileRecord: fixtureSparkProfileRecord(),
    engineBinding: fixtureEngineBinding(),
    toolchain: fixtureToolchain(),
    lock,
    costModel: fixtureCostModel(),
  });
  if (!composed.ok) throw new Error(composed.message);
  const service = new BuildOrchestratorService({
    sources: createFakeBuildSource({
      records,
      locks: new Map([[composed.inputs.packageLock.lockFingerprint, lock]]),
      resolvableContent: new Set(buildInputDigests(composed.inputs).map((entry) => entry.digest)),
    }),
    fabric: createFakeToolFabric({ operations: fabricOperations.map((operation) => asToolOperationId(operation)) }),
    clock: createManualClock().clock,
    store: createMemoryBuildStore(),
  });
  return { service, document: composed };
}

function identity(nonce: string) {
  return { requester: "builder-agent", nonce, requestedAt: 1_700_000_000_000 };
}

function phaseOf(outcome: SparkBuildOutcome): string {
  return outcome.ok ? `${outcome.phase}:${outcome.classification}` : `refused:${outcome.code}`;
}

async function main(): Promise<void> {
  // --- 1/2. compose + drive the happy path -------------------------------
  const rig = makeRig();
  const document = rig.document;
  record("composition", "ok", document.ok ? "ok" : "refused");
  record(
    "planning-digests",
    "sha256 x5",
    [document.spark.profileDigest, document.spark.gameIrDigest, document.spark.planDigest, document.spark.scheduleDigest, document.spark.cacheManifestDigest].every((digest) => /^sha256:[0-9a-f]{64}$/.test(digest)) ? "sha256 x5" : "malformed",
  );
  record("deferred-units", "6", String(document.spark.deferredUnitCount));
  record("stream-batches", "3", String(document.spark.streamBatchCount));
  const outcome = await runSparkBuild(TENANT, rig.service, document, identity("spark-harness-1"));
  record("happy-path", "succeeded:first", phaseOf(outcome));
  const result = outcome as SparkBuildResult;
  record("result-digest", "sha256", /^sha256:[0-9a-f]{64}$/.test(result.resultDigest) ? "sha256" : "malformed");
  record("artifacts", "2", String(result.artifactCount));

  // --- 3. E6 idempotent replay --------------------------------------------
  const replay = await runSparkBuild(TENANT, rig.service, document, identity("spark-harness-1"));
  record("replay", `duplicate:${String(result.buildId)}`, replay.ok ? `${replay.classification}:${String(replay.buildId)}` : `refused:${replay.code}`);

  // --- 4. E8 refusals -------------------------------------------------------
  const base = {
    document: fixtureSparkBuildDocument(),
    profileRecord: fixtureSparkProfileRecord(),
    engineBinding: fixtureEngineBinding(),
    toolchain: fixtureToolchain(),
    lock: fixtureLock(fixtureRecords()),
    costModel: fixtureCostModel(),
  };
  const webRecord = sealTargetProfileRecord({
    ...fixtureSparkProfileRecord(),
    target: "web",
    formFactor: "desktop-first",
    orientation: "landscape",
    aspectRatio: "16:9",
    spark: undefined,
  } as never as UnsealedTargetProfileRecord) as never as SparkTargetProfileRecord;
  const nonSpark = composeSparkBuildDocument(TENANT, { ...base, profileRecord: webRecord });
  record("non-spark-profile", "refused:profile-not-spark", nonSpark.ok ? "composed" : `refused:${nonSpark.code}`);
  const inverted = {
    ...fixtureSparkProfileRecord(),
    spark: {
      ...fixtureSparkProfileRecord().spark,
      boot: { ...fixtureSparkProfileRecord().spark.boot, firstPaintTargetMs: 2_500, firstInteractionTargetMs: 1_500 },
    },
  } as SparkTargetProfileRecord;
  const inversion = composeSparkBuildDocument(TENANT, { ...base, profileRecord: inverted });
  // The target-profiles oracle reports budget inversion at profile
  // validation (spark-boot-invalid, first-interaction-before-first-paint).
  record("budget-inversion", "refused:profile-invalid", inversion.ok ? "composed" : `refused:${inversion.code}`);
  record(
    "inversion-reason",
    "first-interaction-before-first-paint",
    inversion.ok === false && inversion.reasons !== undefined && inversion.reasons.some((reason) => reason.message.includes("first-interaction-before-first-paint")) ? "first-interaction-before-first-paint" : "missing",
  );
  const oversized = composeSparkBuildDocument(TENANT, { ...base, costModel: fixtureCostModel(0.001) });
  record("oversized-critical-boot", "refused:planning-refused", oversized.ok ? "composed" : `refused:${oversized.code}`);
  const forged: SparkBuildDocument = {
    ...document,
    inputs: { ...document.inputs, gameIr: { digest: fixtureDigest("forged-game-ir") } },
  };
  const unresolvable = await runSparkBuild(TENANT, rig.service, forged, identity("spark-harness-forged"));
  record("forged-input", "refused:intake-refused", phaseOf(unresolvable));

  // --- 5. E11 truthful toolchain failure ------------------------------------
  const missing = makeRig({ fabricOperations: ["build", "package"] });
  const toolchainOutcome = await runSparkBuild(TENANT, missing.service, missing.document, identity("spark-harness-toolchain"));
  record("toolchain-unavailable", "refused:build-failed", phaseOf(toolchainOutcome));
  record("toolchain-limitation", "toolchain-unavailable", missing.service.limitations(TENANT).find((entry) => entry.code === "toolchain-unavailable") !== undefined ? "toolchain-unavailable" : "none");

  // --- 6. R20 tenant isolation ----------------------------------------------
  const cross = await runSparkBuild(OTHER_TENANT, rig.service, document, identity("spark-harness-cross"));
  record("cross-tenant-drive", "refused:cross-tenant", phaseOf(cross));
  const invalid = await runSparkBuild("Not A Tenant" as never as TenantId, rig.service, document, identity("spark-harness-invalid"));
  record("invalid-tenant", "refused:invalid-tenant", phaseOf(invalid));

  // --- 7. E9 determinism ------------------------------------------------------
  const twinA = makeRig();
  const twinB = makeRig();
  const first = await runSparkBuild(TENANT, twinA.service, twinA.document, identity("spark-harness-twin"));
  const second = await runSparkBuild(TENANT, twinB.service, twinB.document, identity("spark-harness-twin"));
  record(
    "determinism",
    "identical",
    first.ok && second.ok && first.buildId === second.buildId && first.resultDigest === second.resultDigest && first.eventCount === second.eventCount ? "identical" : "diverged",
  );

  // --- 8. E10 event log discipline -------------------------------------------
  const log = twinA.service.events(TENANT, (first as SparkBuildResult).buildId);
  const sequences = log.ok ? log.events.map((event) => event.sequence) : [];
  record(
    "event-sequences",
    "1..n-increasing",
    sequences.length > 0 && sequences.every((sequence, index) => sequence === index + 1) ? "1..n-increasing" : sequences.join(","),
  );

  process.stdout.write(`${JSON.stringify({ harness: "spark", ok: failures.length === 0, steps, failures }, null, 2)}\n`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
