/**
 * Target profile records: spark-profile shape (lock 16), the structural
 * console vendor marker (R12/lock 24), and structural validation
 * refusals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SparkTargetProfile } from "@playliquid/runtime-contracts";
import { asSparkProfileId, asTargetProfileId } from "@playliquid/runtime-contracts";
import { asEngineBindingDigest, asEngineId, asVendorId } from "./primitives.ts";
import type { TargetProfileRecord } from "./records.ts";
import { isAuthorizedVendorSdkMarker, isEvaluationSuiteRef, validateTargetProfileRecord } from "./records.ts";
import {
  fixtureConsoleRecord,
  fixtureDedicatedServerRecord,
  fixtureDigest,
  fixtureSparkProperties,
  fixtureSparkRecord,
  fixtureWebRecord,
} from "./fixtures.ts";

test("the fixture corpus validates", () => {
  for (const record of [fixtureSparkRecord(), fixtureConsoleRecord(), fixtureWebRecord(), fixtureDedicatedServerRecord()]) {
    const validation = validateTargetProfileRecord(record);
    assert.equal(validation.ok, true, JSON.stringify(validation.ok ? "" : validation.reasons));
  }
});

test("spark carries its properties as a distinct typed record, not a second content model", () => {
  const record = fixtureSparkRecord();
  assert.equal(record.target, "spark");
  // The spark properties are the runtime-contracts SparkTargetProfile.
  const spark: SparkTargetProfile = record.spark;
  assert.equal(spark.profileId, "spark");
  assert.equal(spark.aspectRatio, "9:16");
  assert.equal(spark.formFactor, "mobile-first");
  assert.equal(spark.orientation, "portrait");
  assert.equal(spark.caching, "aggressive");
  assert.equal(spark.streaming, "progressive");
  assert.equal(spark.boot.entries.length > 0, true);
  // The record core agrees with the spark properties.
  assert.equal(record.formFactor, "mobile-first");
  assert.equal(record.orientation, "portrait");
  assert.equal(record.aspectRatio, "9:16");
  // A target profile never carries game content (lock 16): the record has
  // no world/assets/avatar/rules fields — the type is targeting-only.
  const keys = Object.keys(record as unknown as Record<string, unknown>);
  for (const forbidden of ["world", "assets", "avatars", "rules", "nodes"]) {
    assert.equal(keys.includes(forbidden), false, forbidden);
  }
});

test("a spark record with mismatched core properties is refused", () => {
  const record = fixtureSparkRecord();
  const broken = { ...record, orientation: "landscape" } as unknown as TargetProfileRecord;
  const validation = validateTargetProfileRecord(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "spark-properties-mismatch"), true);
  }
});

test("a spark record with an invalid boot manifest is refused (delegated to runtime-contracts)", () => {
  const record = fixtureSparkRecord();
  const broken = {
    ...record,
    spark: { ...fixtureSparkProperties(), boot: { entries: [], firstPaintTargetMs: 100, firstInteractionTargetMs: 200 } },
  } as unknown as TargetProfileRecord;
  const validation = validateTargetProfileRecord(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "spark-boot-invalid"), true);
  }
});

test("a spark record whose spark profile id does not match is refused", () => {
  const record = fixtureSparkRecord();
  const mismatched = {
    ...record,
    profileId: asTargetProfileId("spark-variant"),
    spark: { ...fixtureSparkProperties(), profileId: asSparkProfileId("spark") },
  } as unknown as TargetProfileRecord;
  const validation = validateTargetProfileRecord(mismatched);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "spark-properties-mismatch"), true);
  }
});

test("console records require the authorized-vendor-SDK marker structurally", () => {
  const record = fixtureConsoleRecord();
  assert.equal(record.target, "console");
  // Structurally present on every console record:
  assert.equal(isAuthorizedVendorSdkMarker(record.console.vendorSdk), true);
  assert.equal(record.console.vendorSdk.vendorId, "nintendo");
});

test("a console record with a broken vendor marker is refused", () => {
  const record = fixtureConsoleRecord();
  const broken = {
    ...record,
    console: {
      vendorSdk: { vendorId: asVendorId("nintendo"), sdkDigest: fixtureDigest("sdk") },
    },
  } as unknown as TargetProfileRecord;
  const validation = validateTargetProfileRecord(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "console-vendor-marker-missing"), true);
  }
});

test("a console record with non-record vendor capability data is refused", () => {
  const record = fixtureConsoleRecord();
  const broken = {
    ...record,
    console: { ...record.console, vendorCapabilities: { kind: "bool", value: true } },
  } as unknown as TargetProfileRecord;
  const validation = validateTargetProfileRecord(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "console-vendor-capabilities-invalid"), true);
  }
});

test("an xr profile must use the xr form factor", () => {
  const record = fixtureWebRecord();
  const broken = { ...record, target: "xr", formFactor: "desktop-first" } as unknown as TargetProfileRecord;
  const validation = validateTargetProfileRecord(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "xr-form-factor-mismatch"), true);
  }
});

test("a dedicated-server profile must be headless with no render API", () => {
  const headless = fixtureDedicatedServerRecord();
  assert.equal(validateTargetProfileRecord(headless).ok, true);
  const rendering = { ...headless, capabilities: { ...headless.capabilities, render: "vulkan" } } as unknown as TargetProfileRecord;
  const validation = validateTargetProfileRecord(rendering);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "dedicated-server-not-headless"), true);
  }
});

test("profiles with empty engine declarations are refused (fail closed)", () => {
  const record = fixtureWebRecord();
  const broken = { ...record, engineBindings: { engines: [], pinnedBindings: null } } as TargetProfileRecord;
  const validation = validateTargetProfileRecord(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "invalid-engine-bindings"), true);
  }
});

test("evaluation-suite references are validated structurally", () => {
  assert.equal(isEvaluationSuiteRef({ suiteId: "suite-smoke", suiteDigest: fixtureDigest("s") }), true);
  assert.equal(isEvaluationSuiteRef({ suiteId: "", suiteDigest: fixtureDigest("s") }), false);
  assert.equal(isEvaluationSuiteRef({ suiteId: "suite-smoke", suiteDigest: "sha256:bad" }), false);
  assert.equal(isEvaluationSuiteRef(null), false);

  const record = fixtureWebRecord();
  const broken = {
    ...record,
    evaluationSuites: [{ suiteId: "suite-smoke", suiteDigest: "not-a-digest" }],
  } as unknown as TargetProfileRecord;
  const validation = validateTargetProfileRecord(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "invalid-evaluation-suites"), true);
  }
});

test("a profile may not supersede itself", () => {
  const record = fixtureWebRecord();
  const broken = { ...record, supersedes: record.profileDigest } as TargetProfileRecord;
  const validation = validateTargetProfileRecord(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "invalid-supersedes"), true);
  }
});

test("malformed runtime policy bindings are refused", () => {
  const record = fixtureWebRecord();
  const broken = {
    ...record,
    runtimePolicy: { runtimes: [], policy: record.runtimePolicy.policy },
  } as TargetProfileRecord;
  const validation = validateTargetProfileRecord(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "invalid-runtime-policy"), true);
  }
});

test("pinned engine bindings use the engine id vocabulary", () => {
  const record = fixtureWebRecord();
  const pinned = {
    ...record,
    engineBindings: { engines: [asEngineId("native")], pinnedBindings: [asEngineBindingDigest(fixtureDigest("binding"))] },
  } as unknown as TargetProfileRecord;
  assert.equal(validateTargetProfileRecord(pinned).ok, true);
});
