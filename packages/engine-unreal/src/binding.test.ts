/**
 * THE E8 NEGATIVE BATTERY, part 4 (PL-022) — typed engine-binding
 * compatibility (the desktop-class predicate): determinism and content
 * addressing (E9), each typed refusal (engine-not-declared,
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
  UNREAL_ENGINE_ID,
  UNREAL_SUPPORTED_TARGETS,
  createUnrealEngineBinding,
  isProjectedEngineBindingRef,
  unrealCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
} from "./engine-binding.ts";

const digest = (char: string): string => char.repeat(64);

/** Minimal desktop-family profile record for the compatibility predicate. */
function profileOf(target: string, engines: readonly string[], pinned: readonly string[] | null): TargetProfileRecord {
  return {
    target,
    engineBindings: { engines: engines.map((engine) => asEngineId(engine)), pinnedBindings: pinned },
  } as unknown as TargetProfileRecord;
}

test("binding: the desktop-class binding declares exactly windows + macos + linux", () => {
  const binding = createUnrealEngineBinding();
  assert.equal(binding.kind, "unreal-engine-binding");
  assert.equal(binding.engineId, UNREAL_ENGINE_ID);
  assert.deepEqual(binding.supportedTargets, UNREAL_SUPPORTED_TARGETS);
  assert.deepEqual([...binding.supportedTargets], ["windows", "macos", "linux"]);
  assert.match(binding.bindingDigest, /^sha256:[0-9a-f]{64}$/);
});

test("binding: creation is deterministic and content-addressed (E9)", () => {
  assert.deepEqual(createUnrealEngineBinding(), createUnrealEngineBinding());
});

test("binding: a windows profile declaring unreal is compatible", () => {
  const binding = createUnrealEngineBinding();
  const verdict = unrealCanServeTargetProfile(binding, profileOf("windows", ["unreal", "native"], null));
  assert.deepEqual(verdict, { compatible: true, target: "windows" });
});

test("binding: macos and linux profiles declaring unreal are compatible", () => {
  const binding = createUnrealEngineBinding();
  const macos = unrealCanServeTargetProfile(binding, profileOf("macos", ["unreal"], null));
  assert.deepEqual(macos, { compatible: true, target: "macos" });
  const linux = unrealCanServeTargetProfile(binding, profileOf("linux", ["unreal"], null));
  assert.deepEqual(linux, { compatible: true, target: "linux" });
});

test("binding: a profile that does not declare unreal is a typed refusal", () => {
  const binding = createUnrealEngineBinding();
  const verdict = unrealCanServeTargetProfile(binding, profileOf("windows", ["native"], null));
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "unreal-binding/profile-engine-not-declared");
    assert.equal(verdict.target, "windows");
  }
});

test("binding: a pinned profile without this binding digest is a typed refusal", () => {
  const binding = createUnrealEngineBinding();
  const verdict = unrealCanServeTargetProfile(
    binding,
    profileOf("windows", ["unreal"], [`sha256:${digest("9")}`]),
  );
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "unreal-binding/profile-binding-not-pinned");
  }
  // And WITH the binding pinned it is compatible again.
  const pinnedOk = unrealCanServeTargetProfile(
    binding,
    profileOf("windows", ["unreal"], [binding.bindingDigest as unknown as string]),
  );
  assert.equal(pinnedOk.compatible, true);
});

test("binding: a non-desktop target is a typed refusal (E8 incompatibility)", () => {
  const binding = createUnrealEngineBinding();
  const verdict = unrealCanServeTargetProfile(binding, profileOf("web", ["unreal"], null));
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "unreal-binding/profile-target-unsupported");
    assert.equal(verdict.target, "web");
  }
});

test("binding: mobile/xr/console targets are refused honestly (no host SDK evidence)", () => {
  const binding = createUnrealEngineBinding();
  for (const target of ["android", "ios", "xr", "console", "spark", "steamdeck", "dedicated-server"]) {
    const verdict = unrealCanServeTargetProfile(binding, profileOf(target, ["unreal"], null));
    assert.equal(verdict.compatible, false, target);
    if (!verdict.compatible) {
      assert.equal(verdict.code, "unreal-binding/profile-target-unsupported", target);
    }
  }
});

test("binding: the build-contracts projection is structurally valid", () => {
  const binding = createUnrealEngineBinding();
  const projection = toBuildContractsEngineBindingRef(binding);
  assert.equal(isProjectedEngineBindingRef(projection), true);
  assert.equal(projection.engineId, "unreal");
  assert.deepEqual([...projection.supportedTargets], ["windows", "macos", "linux"]);
  assert.equal(isProjectedEngineBindingRef({ engineId: "not valid" }), false);
});
