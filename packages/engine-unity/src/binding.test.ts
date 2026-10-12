/**
 * THE E8 NEGATIVE BATTERY, part 4 (PL-023) — typed engine-binding
 * compatibility (the web/desktop/mobile predicate): determinism and
 * content addressing (E9), each typed refusal (engine-not-declared,
 * binding-not-pinned, target-unsupported) and the build-contracts
 * projection. Parts 1–3 (negative-capabilities /
 * negative-payload / negative-lifecycle) cover capability,
 * dispatch-shape, payload, trust, lifecycle, tenancy and
 * bridge-failure codes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asEngineId, type TargetProfileRecord } from "@playliquid/target-profiles";
import {
  UNITY_ENGINE_ID,
  UNITY_SUPPORTED_TARGETS,
  createUnityEngineBinding,
  isProjectedEngineBindingRef,
  unityCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
} from "./engine-binding.ts";

const digest = (char: string): string => char.repeat(64);

/** Minimal web/desktop/mobile-family profile record for the predicate. */
function profileOf(target: string, engines: readonly string[], pinned: readonly string[] | null): TargetProfileRecord {
  return {
    target,
    engineBindings: { engines: engines.map((engine) => asEngineId(engine)), pinnedBindings: pinned },
  } as unknown as TargetProfileRecord;
}

test("binding: the web/desktop/mobile binding declares exactly web + windows + macos + linux + android + ios", () => {
  const binding = createUnityEngineBinding();
  assert.equal(binding.kind, "unity-engine-binding");
  assert.equal(binding.engineId, UNITY_ENGINE_ID);
  assert.deepEqual(binding.supportedTargets, UNITY_SUPPORTED_TARGETS);
  assert.deepEqual([...binding.supportedTargets], ["web", "windows", "macos", "linux", "android", "ios"]);
  assert.match(binding.bindingDigest, /^sha256:[0-9a-f]{64}$/);
});

test("binding: creation is deterministic and content-addressed (E9)", () => {
  assert.deepEqual(createUnityEngineBinding(), createUnityEngineBinding());
});

test("binding: a web (WebGL) profile declaring unity is compatible", () => {
  const binding = createUnityEngineBinding();
  const verdict = unityCanServeTargetProfile(binding, profileOf("web", ["unity", "native"], null));
  assert.deepEqual(verdict, { compatible: true, target: "web" });
});

test("binding: desktop and mobile profiles declaring unity are compatible", () => {
  const binding = createUnityEngineBinding();
  for (const target of ["windows", "macos", "linux", "android", "ios"] as const) {
    const verdict = unityCanServeTargetProfile(binding, profileOf(target, ["unity"], null));
    assert.deepEqual(verdict, { compatible: true, target }, target);
  }
});

test("binding: a profile that does not declare unity is a typed refusal", () => {
  const binding = createUnityEngineBinding();
  const verdict = unityCanServeTargetProfile(binding, profileOf("windows", ["native"], null));
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "unity-binding/profile-engine-not-declared");
    assert.equal(verdict.target, "windows");
  }
});

test("binding: a pinned profile without this binding digest is a typed refusal", () => {
  const binding = createUnityEngineBinding();
  const verdict = unityCanServeTargetProfile(
    binding,
    profileOf("web", ["unity"], [`sha256:${digest("9")}`]),
  );
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "unity-binding/profile-binding-not-pinned");
  }
  // And WITH the binding pinned it is compatible again.
  const pinnedOk = unityCanServeTargetProfile(
    binding,
    profileOf("web", ["unity"], [binding.bindingDigest as unknown as string]),
  );
  assert.equal(pinnedOk.compatible, true);
});

test("binding: an undeclared target is a typed refusal (E8 incompatibility)", () => {
  const binding = createUnityEngineBinding();
  const verdict = unityCanServeTargetProfile(binding, profileOf("spark", ["unity"], null));
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "unity-binding/profile-target-unsupported");
    assert.equal(verdict.target, "spark");
  }
});

test("binding: spark/steamdeck/xr/console/dedicated-server targets are refused honestly", () => {
  const binding = createUnityEngineBinding();
  for (const target of ["spark", "steamdeck", "xr", "console", "dedicated-server"]) {
    const verdict = unityCanServeTargetProfile(binding, profileOf(target, ["unity"], null));
    assert.equal(verdict.compatible, false, target);
    if (!verdict.compatible) {
      assert.equal(verdict.code, "unity-binding/profile-target-unsupported", target);
    }
  }
});

test("binding: the build-contracts projection is structurally valid", () => {
  const binding = createUnityEngineBinding();
  const projection = toBuildContractsEngineBindingRef(binding);
  assert.equal(isProjectedEngineBindingRef(projection), true);
  assert.equal(projection.engineId, "unity");
  assert.deepEqual([...projection.supportedTargets], ["web", "windows", "macos", "linux", "android", "ios"]);
  assert.equal(isProjectedEngineBindingRef({ engineId: "not valid" }), false);
});
