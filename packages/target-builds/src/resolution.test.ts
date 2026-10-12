/**
 * Target-set resolution tests: total adjudication against the four merged
 * engine adapters (PL-021..PL-024) — bindings by first consent, and every
 * typed refusal class of the frozen check order (E8).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefaultEngineCatalog } from "./catalog.ts";
import { createMemoryProfileSource } from "./fakes.ts";
import type { TargetProfileBundle } from "./profiles.ts";
import { verifyProfileBundle } from "./profiles.ts";
import { resolveTargetSet } from "./resolution.ts";
import type { TargetRefusal } from "./resolution.ts";
import { fixtureMultiTargetRequest, fixtureProfileBundle, fixtureVendorSdkEvidence, fixtureLock, fixtureRecords, fixtureDigest } from "./fixtures.ts";
import type { TargetId } from "@playliquid/target-profiles";

const ALL_TARGETS = ["web", "spark", "windows", "macos", "linux", "android", "ios", "steamdeck", "xr", "dedicated-server", "console"] as TargetId[];

function sourcesWith(bundles: ReadonlyArray<readonly [TargetId, TargetProfileBundle | null]>) {
  return { catalog: createDefaultEngineCatalog(), profiles: createMemoryProfileSource(bundles) };
}

function fullSources() {
  return sourcesWith(ALL_TARGETS.map((target) => [target, fixtureProfileBundle(target)] as const));
}

function requestOver(targets: readonly string[], evidence?: ReturnType<typeof fixtureVendorSdkEvidence>[]) {
  const lock = fixtureLock(fixtureRecords());
  return fixtureMultiTargetRequest(lock, { targets, ...(evidence === undefined ? {} : { evidence }) });
}

test("web-first targets bind the first consenting catalog engine (playcanvas)", () => {
  const { catalog, profiles } = fullSources();
  const resolution = resolveTargetSet(requestOver(["web", "spark"]), catalog, profiles);
  assert.deepEqual(
    resolution.bindings.map((binding) => [binding.target, binding.engineId]),
    [
      ["spark", "playcanvas"],
      ["web", "playcanvas"],
    ],
  );
  assert.equal(resolution.refusals.length, 0);
  assert.deepEqual(resolution.requested, ["spark", "web"]);
});

test("desktop-class targets bind unreal first; mobile-class targets bind unity", () => {
  const { catalog, profiles } = fullSources();
  const resolution = resolveTargetSet(requestOver(["windows", "macos", "linux", "android", "ios"]), catalog, profiles);
  assert.deepEqual(
    resolution.bindings.map((binding) => [binding.target, binding.engineId]),
    [
      ["android", "unity"],
      ["ios", "unity"],
      ["linux", "unreal"],
      ["macos", "unreal"],
      ["windows", "unreal"],
    ],
  );
});

test("a target outside the frozen taxonomy is refused unknown-target (R12)", () => {
  const { catalog, profiles } = fullSources();
  const resolution = resolveTargetSet(requestOver(["web", "television"]), catalog, profiles);
  assert.equal(resolution.bindings.length, 1);
  const refusal = resolution.refusals[0] as TargetRefusal;
  assert.equal(refusal.target, "television");
  assert.equal(refusal.code, "unknown-target");
});

test("console-class targets are refused sdk-gated with the truthful vendor answer (lock rule 24/E11)", () => {
  const { catalog, profiles } = fullSources();
  const withoutEvidence = resolveTargetSet(requestOver(["console"]), catalog, profiles);
  assert.equal(withoutEvidence.bindings.length, 0);
  const refusal = withoutEvidence.refusals[0] as TargetRefusal;
  assert.equal(refusal.code, "sdk-gated");
  assert.ok(refusal.message.includes("never simulates"));
  assert.ok(refusal.message.includes("vendor \"nintendo\""));
  assert.ok(refusal.message.includes("evidence was not presented"));
  // Vendor-SDK evidence presented still cannot substitute the authorized toolchain.
  const withEvidence = resolveTargetSet(requestOver(["console"]), catalog, profiles);
  const refusal2 = withEvidence.refusals[0] as TargetRefusal;
  assert.equal(refusal2.code, "sdk-gated");
});

test("targets no merged adapter declares are refused no-engine-for-target (E11 truthful gap)", () => {
  const { catalog, profiles } = fullSources();
  const resolution = resolveTargetSet(requestOver(["steamdeck", "xr", "dedicated-server"]), catalog, profiles);
  assert.equal(resolution.bindings.length, 0);
  for (const refusal of resolution.refusals) {
    assert.equal(refusal.code, "no-engine-for-target");
  }
  assert.deepEqual(resolution.refusals.map((refusal) => refusal.target), ["dedicated-server", "steamdeck", "xr"]);
});

test("an unpublished profile is refused profile-unavailable (fail closed)", () => {
  const { catalog, profiles } = sourcesWith([["web", fixtureProfileBundle("web")]]);
  const resolution = resolveTargetSet(requestOver(["web", "windows"]), catalog, profiles);
  assert.deepEqual(
    resolution.bindings.map((binding) => binding.target),
    ["web"],
  );
  const refusal = resolution.refusals[0] as TargetRefusal;
  assert.equal(refusal.code, "profile-unavailable");
  assert.ok(refusal.message.includes("no target profile is published"));
});

test("a tampered profile seal is refused profile-invalid (E8 tamper check)", () => {
  const tampered = fixtureProfileBundle("windows");
  const broken = { ...tampered, record: { ...tampered.record, version: "9.9.9" } };
  const { catalog, profiles } = sourcesWith([
    ["web", fixtureProfileBundle("web")],
    ["windows", broken as TargetProfileBundle],
  ]);
  const resolution = resolveTargetSet(requestOver(["web", "windows"]), catalog, profiles);
  assert.deepEqual(
    resolution.bindings.map((binding) => binding.target),
    ["web"],
  );
  const refusal = resolution.refusals[0] as TargetRefusal;
  assert.equal(refusal.code, "profile-invalid");
  assert.ok(refusal.message.includes("content-addressed seal"));
});

test("a bundle whose record names a different target is refused profile-invalid", () => {
  const misfiled = fixtureProfileBundle("web");
  const { catalog, profiles } = sourcesWith([["windows", misfiled]]);
  const resolution = resolveTargetSet(requestOver(["windows"]), catalog, profiles);
  const refusal = resolution.refusals[0] as TargetRefusal;
  assert.equal(refusal.code, "profile-invalid");
  assert.ok(refusal.message.includes("different target"));
});

test("a gated profile without passing vendor evidence is refused evidence-missing (lock rule 24)", () => {
  const gated = fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } });
  const { catalog, profiles } = sourcesWith([["web", gated]]);
  const refused = resolveTargetSet(requestOver(["web"]), catalog, profiles);
  const refusal = refused.refusals[0] as TargetRefusal;
  assert.equal(refusal.code, "evidence-missing");
  assert.ok(refusal.message.includes("vendor \"vendor-x\""));
});

test("a gated profile with passing vendor-SDK evidence binds (retryable by re-requesting)", () => {
  const gated = fixtureProfileBundle("web", { vendorGate: { vendorId: "vendor-x" } });
  const { catalog, profiles } = sourcesWith([["web", gated]]);
  const resolution = resolveTargetSet(requestOver(["web"], [fixtureVendorSdkEvidence("vendor-x")]), catalog, profiles);
  assert.equal(resolution.refusals.length, 0);
  assert.deepEqual(
    resolution.bindings.map((binding) => binding.target),
    ["web"],
  );
  // Evidence for a DIFFERENT vendor does not satisfy the gate.
  const wrongVendor = resolveTargetSet(requestOver(["web"], [fixtureVendorSdkEvidence("vendor-y")]), catalog, profiles);
  assert.equal((wrongVendor.refusals[0] as TargetRefusal).code, "evidence-missing");
});

test("a profile pinning digests that exclude the catalog binding refuses every engine", () => {
  const pinned = fixtureProfileBundle("web", { pinnedBindings: [fixtureDigest("some-other-binding")] });
  const { catalog, profiles } = sourcesWith([["web", pinned]]);
  const resolution = resolveTargetSet(requestOver(["web"]), catalog, profiles);
  const refusal = resolution.refusals[0] as TargetRefusal;
  assert.equal(refusal.code, "no-engine-for-target");
});

test("partial results accumulate typed rejections without voiding bindings (E8 isolation)", () => {
  const { catalog, profiles } = fullSources();
  const resolution = resolveTargetSet(requestOver(["console", "web", "television", "windows", "xr"]), catalog, profiles);
  assert.deepEqual(
    resolution.bindings.map((binding) => binding.target),
    ["web", "windows"],
  );
  assert.deepEqual(
    resolution.refusals.map((refusal) => [refusal.target, refusal.code]),
    [
      ["console", "sdk-gated"],
      ["television", "unknown-target"],
      ["xr", "no-engine-for-target"],
    ],
  );
});

test("resolution is deterministic across repeated calls (E9)", () => {
  const { catalog, profiles } = fullSources();
  const request = requestOver(["windows", "web", "console"]);
  const first = resolveTargetSet(request, catalog, profiles);
  const second = resolveTargetSet(request, catalog, profiles);
  assert.deepEqual(first.bindings, second.bindings);
  assert.deepEqual(first.refusals, second.refusals);
  assert.deepEqual(first.requested, second.requested);
});

test("verifyProfileBundle refuses a structurally invalid vendor gate (total; no throws)", () => {
  const bundle = fixtureProfileBundle("web");
  const broken = { record: bundle.record, vendorGate: { kind: "banana" } } as unknown as TargetProfileBundle;
  const verdict = verifyProfileBundle(broken, "web");
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.code, "profile-invalid");
  }
  assert.equal(verifyProfileBundle(null, "web").ok, false);
  assert.equal(verifyProfileBundle("junk" as never, "web").ok, false);
});
