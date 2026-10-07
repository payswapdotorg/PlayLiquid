/**
 * Verification gates: console-without-vendor-evidence refusal (lock rule
 * 24), vendor gate matrix, and the R19 provenance gate over package-system
 * release-gate semantics.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asVendorId } from "./primitives.ts";
import { checkBuildProvenanceGate, checkVendorSdkGate, isVendorSdkAuthorization } from "./verification.ts";
import type { OnTargetEvidence, VendorSdkEvidence } from "./verification.ts";
import { fixtureDigest, fixturePackageRecord, fixtureVendorSdkEvidence, fixtureConsoleInputs } from "./fixtures.ts";

const manifestDigest = fixtureDigest("manifest-under-test");

function vendorPass(vendorId = "nintendo"): VendorSdkEvidence {
  return fixtureVendorSdkEvidence(fixtureConsoleInputs(vendorId));
}

function onTargetPass(verifiedDigest = manifestDigest): OnTargetEvidence {
  return {
    kind: "on-target",
    verdict: "pass",
    verifiedDigest,
    evidenceDigest: fixtureDigest("on-target-evidence"),
  };
}

test("a none gate passes vacuously (non-console targets)", () => {
  const result = checkVendorSdkGate({
    vendorGate: { kind: "none" },
    manifestDigest,
    evidence: [],
  });
  assert.equal(result.pass, true);
});

test("console gate without any evidence fails closed", () => {
  const result = checkVendorSdkGate({
    vendorGate: { kind: "authorized-vendor-sdk", vendorId: asVendorId("nintendo") },
    manifestDigest,
    evidence: [],
  });
  assert.equal(result.pass, false);
  const codes = result.reasons.map((reason) => reason.code);
  assert.equal(codes.includes("vendor-sdk-evidence-missing"), true);
  assert.equal(codes.includes("actual-verification-missing"), true);
});

test("console gate refuses evidence from the wrong vendor (not authorized)", () => {
  const result = checkVendorSdkGate({
    vendorGate: { kind: "authorized-vendor-sdk", vendorId: asVendorId("nintendo") },
    manifestDigest,
    evidence: [vendorPass("sony"), onTargetPass()],
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasons.some((reason) => reason.code === "vendor-sdk-not-authorized"), true);
});

test("console gate refuses a failing vendor verdict", () => {
  const failing = { ...vendorPass(), verdict: "fail" as const };
  const result = checkVendorSdkGate({
    vendorGate: { kind: "authorized-vendor-sdk", vendorId: asVendorId("nintendo") },
    manifestDigest,
    evidence: [failing, onTargetPass()],
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasons.some((reason) => reason.code === "vendor-sdk-not-authorized"), true);
});

test("console gate refuses when actual verification is missing", () => {
  const result = checkVendorSdkGate({
    vendorGate: { kind: "authorized-vendor-sdk", vendorId: asVendorId("nintendo") },
    manifestDigest,
    evidence: [vendorPass()],
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasons.some((reason) => reason.code === "actual-verification-missing"), true);
});

test("console gate refuses on-target evidence verifying a different manifest (unsigned artifacts)", () => {
  const result = checkVendorSdkGate({
    vendorGate: { kind: "authorized-vendor-sdk", vendorId: asVendorId("nintendo") },
    manifestDigest,
    evidence: [vendorPass(), onTargetPass(fixtureDigest("some-other-manifest"))],
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasons.some((reason) => reason.code === "actual-verification-target-mismatch"), true);
});

test("console gate refuses a failing on-target verdict", () => {
  const failing: OnTargetEvidence = { ...onTargetPass(), verdict: "fail" };
  const result = checkVendorSdkGate({
    vendorGate: { kind: "authorized-vendor-sdk", vendorId: asVendorId("nintendo") },
    manifestDigest,
    evidence: [vendorPass(), failing],
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasons.some((reason) => reason.code === "actual-verification-failed"), true);
});

test("console gate passes only with authorized vendor SDK AND matching on-target PASS", () => {
  const result = checkVendorSdkGate({
    vendorGate: { kind: "authorized-vendor-sdk", vendorId: asVendorId("nintendo") },
    manifestDigest,
    evidence: [vendorPass(), onTargetPass()],
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.reasons, []);
});

test("vendor SDK authorization marker is structural: no field may be missing", () => {
  assert.equal(isVendorSdkAuthorization(vendorPass().authorization), true);
  assert.equal(isVendorSdkAuthorization({ vendorId: "nintendo", authorizedSdkDigest: fixtureDigest("sdk") }), false);
  assert.equal(isVendorSdkAuthorization({ ...vendorPass().authorization, authorizationDigest: "unsigned" }), false);
  assert.equal(isVendorSdkAuthorization(null), false);
});

test("R19 provenance gate reuses package-system release gate verdicts (aggregation)", () => {
  const good = checkBuildProvenanceGate([
    fixturePackageRecord("@demo/assets"),
    fixturePackageRecord("@demo/world"),
  ]);
  assert.equal(good.pass, true);

  const bad = checkBuildProvenanceGate([
    fixturePackageRecord("@demo/assets"),
    fixturePackageRecord("@demo/unverified", "declared"),
  ]);
  assert.equal(bad.pass, false);
  assert.equal(
    bad.reasons.some((reason) => reason.packageId === "@demo/unverified" && reason.code === "license-unverified"),
    true,
  );
});

test("provenance gate over zero records passes (nothing to gate)", () => {
  assert.equal(checkBuildProvenanceGate([]).pass, true);
});
