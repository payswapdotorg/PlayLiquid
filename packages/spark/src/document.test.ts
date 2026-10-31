/**
 * Build-document tests (PL-035): composition of build-contracts-shaped
 * inputs for the spark target, spark planning digests over the same
 * game-ir content (E9), and the E8 negative matrix of the composer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeSparkBuildDocument, sparkBuildRequestOf, sparkGameIrDigestOf } from "./document.ts";
import type { SparkBuildComposition } from "./document.ts";
import type { SparkTargetProfileRecord, UnsealedTargetProfileRecord } from "@playliquid/target-profiles";
import { sealTargetProfileRecord } from "@playliquid/target-profiles";
import {
  fixtureCostModel,
  fixtureEngineBinding,
  fixtureLock,
  fixtureRecords,
  fixtureSparkBuildDocument,
  fixtureSparkProfileRecord,
  fixtureToolchain,
} from "./fixtures.ts";
import { asTenantId } from "@playliquid/build-orchestrator";

const TENANT = asTenantId("tenant-spark-build")!;

function baseComposition(over: Partial<SparkBuildComposition> = {}): SparkBuildComposition {
  const records = fixtureRecords();
  return {
    document: fixtureSparkBuildDocument(),
    profileRecord: fixtureSparkProfileRecord(),
    engineBinding: fixtureEngineBinding(),
    toolchain: fixtureToolchain(),
    lock: fixtureLock(records),
    costModel: fixtureCostModel(),
    ...over,
  };
}

test("a valid composition produces the spark build document with every digest", () => {
  const composed = composeSparkBuildDocument(TENANT, baseComposition());
  assert.equal(composed.ok, true, JSON.stringify(composed));
  const document = composed;
  assert.equal(document.kind, "spark-build-document");
  assert.equal(document.target, "spark");
  assert.equal(document.tenant, TENANT);
  assert.equal(document.inputs.targetProfile.target, "spark");
  assert.equal(document.inputs.targetProfile.vendorGate.kind, "none");
  assert.equal(document.inputs.gameIr.digest, sparkGameIrDigestOf(fixtureSparkBuildDocument()));
  assert.equal(document.inputs.packageLock.pinnedPackageCount, 2);
  for (const digest of [
    document.spark.profileDigest,
    document.spark.gameIrDigest,
    document.spark.planDigest,
    document.spark.scheduleDigest,
    document.spark.cacheManifestDigest,
    document.documentDigest,
  ]) {
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  }
  assert.equal(document.spark.profileDigest, fixtureSparkProfileRecord().profileDigest);
  assert.ok(document.spark.deferredUnitCount > 0);
  assert.ok(document.spark.streamBatchCount > 0);
  assert.ok(document.spark.criticalBytes > 0);
  assert.ok(document.spark.plannedFirstPaintMs <= 1_500);
  assert.ok(document.spark.plannedFirstInteractionMs <= 2_500);
});

test("the document digest is deterministic and content-sensitive (E9)", () => {
  const first = composeSparkBuildDocument(TENANT, baseComposition());
  const second = composeSparkBuildDocument(TENANT, baseComposition());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) throw new Error("unreachable");
  assert.equal(first.documentDigest, second.documentDigest);
  assert.deepEqual(first.spark, second.spark);
  // Different game-ir content moves the game-ir digest, the plan digests
  // and the document digest — never the profile digest.
  const mutated = composeSparkBuildDocument(TENANT, baseComposition({ document: fixtureSparkBuildDocument({ heroHealth: 50n }) }));
  assert.equal(mutated.ok, true);
  assert.notEqual(mutated.spark.gameIrDigest, first.spark.gameIrDigest);
  assert.notEqual(mutated.spark.planDigest, first.spark.planDigest);
  assert.notEqual(mutated.spark.cacheManifestDigest, first.spark.cacheManifestDigest);
  assert.notEqual(mutated.documentDigest, first.documentDigest);
  assert.equal(mutated.spark.profileDigest, first.spark.profileDigest);
  // A different cost model moves the planning figures + document digest.
  const rethought = composeSparkBuildDocument(TENANT, baseComposition({ costModel: fixtureCostModel(50) }));
  assert.equal(rethought.ok, true);
  assert.equal(rethought.spark.bytesPerMillisecond, 50);
  assert.notEqual(rethought.spark.plannedFirstInteractionMs, first.spark.plannedFirstInteractionMs);
  assert.notEqual(rethought.documentDigest, first.documentDigest);
});

test("the build request pins the planning inputs in its parameters (E9)", () => {
  const composed = composeSparkBuildDocument(TENANT, baseComposition());
  assert.equal(composed.ok, true);
  const request = sparkBuildRequestOf(composed, { requester: "builder-agent", nonce: "nonce-1", requestedAt: 1_700_000_000_000 });
  assert.equal(request.kind, "request-build");
  assert.equal(request.idempotency.scope, "build-request");
  assert.equal(request.idempotency.requester, "builder-agent");
  assert.equal(request.idempotency.nonce, "nonce-1");
  assert.equal(request.inputs, composed.inputs);
  assert.equal(request.parameters.kind, "record");
  assert.deepEqual(request.parameters.fields["target-profile"], { kind: "string", value: "spark" });
  assert.deepEqual(request.parameters.fields["bytes-per-millisecond"], { kind: "float", value: 100 });
});

test("an invalid tenant is refused at composition (E8)", () => {
  const refusal = composeSparkBuildDocument("Not A Tenant" as never, baseComposition());
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "invalid-tenant");
  }
});

test("a non-spark target profile record is refused (lock rule 16, E8)", () => {
  const webRecord = sealTargetProfileRecord({
    ...fixtureSparkProfileRecord(),
    target: "web",
    formFactor: "desktop-first",
    orientation: "landscape",
    aspectRatio: "16:9",
    spark: undefined,
  } as never as UnsealedTargetProfileRecord) as never as SparkTargetProfileRecord;
  const refusal = composeSparkBuildDocument(TENANT, baseComposition({ profileRecord: webRecord }));
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "profile-not-spark");
  }
});

test("a structurally invalid spark profile record is refused with reasons (E8)", () => {
  const broken = { ...fixtureSparkProfileRecord(), aspectRatio: "16:9" as never } as SparkTargetProfileRecord;
  const refusal = composeSparkBuildDocument(TENANT, baseComposition({ profileRecord: broken }));
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "profile-invalid");
    assert.ok(refusal.reasons?.some((reason) => reason.code === "spark-properties-mismatch"));
  }
  const inverted = {
    ...fixtureSparkProfileRecord(),
    spark: {
      ...fixtureSparkProfileRecord().spark,
      boot: { ...fixtureSparkProfileRecord().spark.boot, firstPaintTargetMs: 2_500, firstInteractionTargetMs: 1_500 },
    },
  } as SparkTargetProfileRecord;
  const inversion = composeSparkBuildDocument(TENANT, baseComposition({ profileRecord: inverted }));
  assert.equal(inversion.ok, false);
  if (!inversion.ok) {
    // Budget inversion (E8): the target-profiles oracle reports it first
    // (spark-boot-invalid) with the runtime-contracts code in the message.
    const reason = inversion.reasons?.find((entry) => entry.code === "spark-boot-invalid");
    assert.ok(reason !== undefined, JSON.stringify(inversion.reasons));
    assert.match(reason.message, /first-interaction-before-first-paint/);
  }
});

test("an engine binding that does not declare the spark target is refused (E8)", () => {
  const refusal = composeSparkBuildDocument(TENANT, baseComposition({
    engineBinding: { ...fixtureEngineBinding(), supportedTargets: [] },
  }));
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "engine-binding-unsupported");
  }
});

test("an engine family the profile does not accept is refused (mutual consent, E8)", () => {
  const strict = sealTargetProfileRecord({
    ...fixtureSparkProfileRecord(),
    engineBindings: { engines: ["playcanvas" as never], pinnedBindings: null },
  } as never as UnsealedTargetProfileRecord) as SparkTargetProfileRecord;
  const refusal = composeSparkBuildDocument(TENANT, baseComposition({ profileRecord: strict }));
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "engine-binding-not-declared");
  }
});

test("an unpinned binding digest is refused when the profile pins bindings (E8)", () => {
  const pinned = sealTargetProfileRecord({
    ...fixtureSparkProfileRecord(),
    engineBindings: { engines: fixtureSparkProfileRecord().engineBindings.engines, pinnedBindings: ["sha256:" + "ab".repeat(32) as never] },
  } as never as UnsealedTargetProfileRecord) as SparkTargetProfileRecord;
  const refusal = composeSparkBuildDocument(TENANT, baseComposition({ profileRecord: pinned }));
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "engine-binding-not-pinned");
  }
});

test("refused boot planning is a typed refusal with aggregated reasons (E8)", () => {
  // Oversized critical boot: a starved cost model busts both budgets.
  const oversized = composeSparkBuildDocument(TENANT, baseComposition({ costModel: fixtureCostModel(0.001) }));
  assert.equal(oversized.ok, false);
  if (!oversized.ok) {
    assert.equal(oversized.code, "planning-refused");
    const codes = oversized.reasons?.map((reason) => reason.code) ?? [];
    assert.ok(codes.includes("first-paint-oversized"), JSON.stringify(codes));
    assert.ok(codes.includes("critical-boot-oversized"), JSON.stringify(codes));
  }
  // Invalid game-ir: a duplicated node id is refused by the kernel walk.
  const document = fixtureSparkBuildDocument();
  const duplicated = composeSparkBuildDocument(TENANT, baseComposition({
    document: { ...document, nodes: [...document.nodes, document.nodes[0]!] },
  }));
  assert.equal(duplicated.ok, false);
  if (!duplicated.ok) {
    assert.equal(duplicated.code, "planning-refused");
    const codes = duplicated.reasons?.map((reason) => reason.code) ?? [];
    assert.ok(codes.includes("game-ir-invalid") || codes.includes("duplicate-node-id"), JSON.stringify(codes));
  }
});

test("structurally invalid composed inputs are refused (E8)", () => {
  const refusal = composeSparkBuildDocument(TENANT, baseComposition({
    toolchain: { ...fixtureToolchain(), profileDigest: "not-a-digest" as never },
  }));
  assert.equal(refusal.ok, false);
  if (!refusal.ok) {
    assert.equal(refusal.code, "inputs-invalid");
    assert.ok(refusal.reasons?.some((reason) => reason.code === "invalid-toolchain"));
  }
});

// ---------------------------------------------------------------------------
// ACR-001 (PLX-ARCH-003): the (worldKind, targetProfile)-aware composition.
// ---------------------------------------------------------------------------

test("ACR-001: a declared spark_vertical delivery composes with the typed delivery on the wire input", () => {
  const composed = composeSparkBuildDocument(TENANT, baseComposition({
    document: { ...fixtureSparkBuildDocument(), world: { kind: "experience", targetProfile: "spark_vertical" } },
  }));
  assert.equal(composed.ok, true, JSON.stringify(composed));
  if (!composed.ok) return;
  assert.equal(composed.inputs.targetProfile.deliveryProfile, "spark_vertical");
  assert.equal(composed.spark.worldKind, "experience");
  assert.deepEqual(composed.world, {
    worldKind: "experience",
    deliveryProfile: "spark_vertical",
    routing: "declared-spark-vertical",
  });
});

test("ACR-001: EVERY world kind composes when the delivery is spark_vertical (the kind never gates)", () => {
  for (const kind of ["spark", "game", "experience", "digital_twin", "other"] as const) {
    const composed = composeSparkBuildDocument(TENANT, baseComposition({
      document: { ...fixtureSparkBuildDocument(), world: { kind, targetProfile: "spark_vertical" } },
    }));
    assert.equal(composed.ok, true, `${kind}: ${composed.ok ? "" : composed.message}`);
  }
});

test("ACR-001: a declared non-spark delivery refuses world-delivery-not-spark", () => {
  for (const delivery of ["web", "desktop", "mobile", "xr", "dedicated_server", "simulation"] as const) {
    const refusal = composeSparkBuildDocument(TENANT, baseComposition({
      document: { ...fixtureSparkBuildDocument(), world: { kind: "game", targetProfile: delivery } },
    }));
    assert.equal(refusal.ok, false, `${delivery} must refuse`);
    if (!refusal.ok) {
      assert.equal(refusal.code, "world-delivery-not-spark");
      assert.match(refusal.message, new RegExp(`targetProfile "${delivery}"`));
    }
  }
});

test("ACR-001: a legacy composition keeps the exact pre-ACR shapes (additive-only)", () => {
  const legacy = composeSparkBuildDocument(TENANT, baseComposition());
  assert.equal(legacy.ok, true);
  if (!legacy.ok) return;
  // No new keys anywhere: the payload, the wire input and the digest input
  // are byte-identical to the pre-ACR composition.
  assert.equal("worldKind" in legacy.spark, false);
  assert.equal("deliveryProfile" in legacy.inputs.targetProfile, false);
  assert.deepEqual(legacy.world, {
    worldKind: "game",
    deliveryProfile: null,
    routing: "legacy-undeclared",
  });
});

test("ACR-001: the declaration moves the document digest, never the content digest (E9)", () => {
  const legacy = composeSparkBuildDocument(TENANT, baseComposition());
  const declared = composeSparkBuildDocument(TENANT, baseComposition({
    document: { ...fixtureSparkBuildDocument(), world: { kind: "game", targetProfile: "spark_vertical" } },
  }));
  assert.equal(legacy.ok, true);
  assert.equal(declared.ok, true);
  if (!legacy.ok || !declared.ok) return;
  // Same game-ir CONTENT (nodes/identity/entry unchanged — the world
  // declaration is not content), so the content digest is stable...
  assert.equal(declared.spark.gameIrDigest, legacy.spark.gameIrDigest);
  // ...but the document digest pins the declared delivery + kind.
  assert.notEqual(declared.documentDigest, legacy.documentDigest);
  // Determinism: the same declaration composes to the same digest.
  const again = composeSparkBuildDocument(TENANT, baseComposition({
    document: { ...fixtureSparkBuildDocument(), world: { kind: "game", targetProfile: "spark_vertical" } },
  }));
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.documentDigest, declared.documentDigest);
});

test("ACR-001: a kind-only declaration composes as legacy delivery (dimensions are independent)", () => {
  const composed = composeSparkBuildDocument(TENANT, baseComposition({
    document: { ...fixtureSparkBuildDocument(), world: { kind: "digital_twin" } },
  }));
  assert.equal(composed.ok, true, JSON.stringify(composed));
  if (!composed.ok) return;
  assert.equal(composed.spark.worldKind, "digital_twin");
  assert.equal("deliveryProfile" in composed.inputs.targetProfile, false);
  assert.deepEqual(composed.world, {
    worldKind: "digital_twin",
    deliveryProfile: null,
    routing: "legacy-undeclared",
  });
});
