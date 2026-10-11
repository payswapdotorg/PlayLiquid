/**
 * THE E8 NEGATIVE BATTERY, part 4 (PL-024) — typed engine-binding
 * compatibility (the web + desktop-class predicate): determinism and
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
  GODOT_ENGINE_ID,
  GODOT_SUPPORTED_TARGETS,
  createGodotEngineBinding,
  isProjectedEngineBindingRef,
  godotCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
} from "./engine-binding.ts";

const digest = (char: string): string => char.repeat(64);

/** Minimal profile fixture for the compatibility predicate. */
function profileOf(target: string, engines: readonly string[], pinned: readonly string[] | null): TargetProfileRecord {
  return {
    target,
    engineBindings: { engines: engines.map((engine) => asEngineId(engine)), pinnedBindings: pinned },
  } as unknown as TargetProfileRecord;
}

test("binding: the web + desktop-class binding declares exactly web + windows + macos + linux", () => {
  const binding = createGodotEngineBinding();
  assert.equal(binding.kind, "godot-engine-binding");
  assert.equal(binding.engineId, GODOT_ENGINE_ID);
  assert.deepEqual(binding.supportedTargets, GODOT_SUPPORTED_TARGETS);
  assert.deepEqual([...binding.supportedTargets], ["web", "windows", "macos", "linux"]);
  assert.match(binding.bindingDigest, /^sha256:[0-9a-f]{64}$/);
});

test("binding: creation is deterministic and content-addressed (E9)", () => {
  assert.deepEqual(createGodotEngineBinding(), createGodotEngineBinding());
});

test("binding: a web profile declaring godot is compatible (the HTML5 export target)", () => {
  const binding = createGodotEngineBinding();
  const verdict = godotCanServeTargetProfile(binding, profileOf("web", ["godot", "native"], null));
  assert.deepEqual(verdict, { compatible: true, target: "web" });
});

test("binding: windows, macos and linux profiles declaring godot are compatible", () => {
  const binding = createGodotEngineBinding();
  const windows = godotCanServeTargetProfile(binding, profileOf("windows", ["godot"], null));
  assert.deepEqual(windows, { compatible: true, target: "windows" });
  const macos = godotCanServeTargetProfile(binding, profileOf("macos", ["godot"], null));
  assert.deepEqual(macos, { compatible: true, target: "macos" });
  const linux = godotCanServeTargetProfile(binding, profileOf("linux", ["godot"], null));
  assert.deepEqual(linux, { compatible: true, target: "linux" });
});

test("binding: a profile that does not declare godot is a typed refusal", () => {
  const binding = createGodotEngineBinding();
  const verdict = godotCanServeTargetProfile(binding, profileOf("web", ["native"], null));
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "godot-binding/profile-engine-not-declared");
    assert.equal(verdict.target, "web");
  }
});

test("binding: a pinned profile without this binding digest is a typed refusal", () => {
  const binding = createGodotEngineBinding();
  const verdict = godotCanServeTargetProfile(
    binding,
    profileOf("web", ["godot"], [`sha256:${digest("9")}`]),
  );
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "godot-binding/profile-binding-not-pinned");
  }
  // And WITH the binding pinned it is compatible again.
  const pinnedOk = godotCanServeTargetProfile(
    binding,
    profileOf("web", ["godot"], [binding.bindingDigest as unknown as string]),
  );
  assert.equal(pinnedOk.compatible, true);
});

test("binding: a profile declaring a foreign engine family is a typed refusal", () => {
  const binding = createGodotEngineBinding();
  const verdict = godotCanServeTargetProfile(binding, profileOf("windows", ["unreal"], null));
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "godot-binding/profile-engine-not-declared");
    assert.equal(verdict.target, "windows");
  }
});

test("binding: an undeclared target is a typed refusal (E8 incompatibility)", () => {
  const binding = createGodotEngineBinding();
  const verdict = godotCanServeTargetProfile(binding, profileOf("android", ["godot"], null));
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "godot-binding/profile-target-unsupported");
    assert.equal(verdict.target, "android");
  }
});

test("binding: mobile/xr/steamdeck/server/console targets are refused honestly (no host SDK evidence)", () => {
  const binding = createGodotEngineBinding();
  for (const target of ["android", "ios", "spark", "xr", "steamdeck", "dedicated-server", "console"]) {
    const verdict = godotCanServeTargetProfile(binding, profileOf(target, ["godot"], null));
    assert.equal(verdict.compatible, false, target);
    if (!verdict.compatible) {
      assert.equal(verdict.code, "godot-binding/profile-target-unsupported", target);
    }
  }
});

test("binding: the build-contracts projection is structurally valid", () => {
  const binding = createGodotEngineBinding();
  const projection = toBuildContractsEngineBindingRef(binding);
  assert.equal(isProjectedEngineBindingRef(projection), true);
  assert.equal(projection.engineId, "godot");
  assert.deepEqual([...projection.supportedTargets], ["web", "windows", "macos", "linux"]);
  assert.equal(isProjectedEngineBindingRef({ engineId: "not valid" }), false);
});
