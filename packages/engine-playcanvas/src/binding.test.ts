/**
 * THE E8 NEGATIVE BATTERY, part 3 (PL-021) — typed engine-binding
 * compatibility (the web-first predicate): determinism and content
 * addressing (E9), each typed refusal (engine-not-declared,
 * binding-not-pinned, target-unsupported) and the build-contracts
 * projection. Parts 1–2 (negative-capabilities / negative-lifecycle)
 * cover capability, dispatch-shape, payload, trust, lifecycle, tenancy
 * and bridge-failure codes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asEngineId, type TargetProfileRecord } from "@playliquid/target-profiles";
import {
  PLAYCANVAS_ENGINE_ID,
  PLAYCANVAS_SUPPORTED_TARGETS,
  createPlayCanvasEngineBinding,
  isProjectedEngineBindingRef,
  playCanvasCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
} from "./engine-binding.ts";

const digest = (char: string): string => char.repeat(64);

/** Minimal web-family profile record for the compatibility predicate. */
function profileOf(target: string, engines: readonly string[], pinned: readonly string[] | null): TargetProfileRecord {
  return {
    target,
    engineBindings: { engines: engines.map((engine) => asEngineId(engine)), pinnedBindings: pinned },
  } as unknown as TargetProfileRecord;
}

test("binding: the web-first binding declares exactly web + spark", () => {
  const binding = createPlayCanvasEngineBinding();
  assert.equal(binding.kind, "playcanvas-engine-binding");
  assert.equal(binding.engineId, PLAYCANVAS_ENGINE_ID);
  assert.deepEqual(binding.supportedTargets, PLAYCANVAS_SUPPORTED_TARGETS);
  assert.deepEqual([...binding.supportedTargets], ["web", "spark"]);
  assert.match(binding.bindingDigest, /^sha256:[0-9a-f]{64}$/);
});

test("binding: creation is deterministic and content-addressed (E9)", () => {
  assert.deepEqual(createPlayCanvasEngineBinding(), createPlayCanvasEngineBinding());
});

test("binding: a web profile declaring playcanvas is compatible", () => {
  const binding = createPlayCanvasEngineBinding();
  const verdict = playCanvasCanServeTargetProfile(binding, profileOf("web", ["playcanvas", "native"], null));
  assert.deepEqual(verdict, { compatible: true, target: "web" });
});

test("binding: a spark profile declaring playcanvas is compatible (web-delivered)", () => {
  const binding = createPlayCanvasEngineBinding();
  const verdict = playCanvasCanServeTargetProfile(binding, profileOf("spark", ["playcanvas"], null));
  assert.deepEqual(verdict, { compatible: true, target: "spark" });
});

test("binding: a profile that does not declare playcanvas is a typed refusal", () => {
  const binding = createPlayCanvasEngineBinding();
  const verdict = playCanvasCanServeTargetProfile(binding, profileOf("web", ["native"], null));
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "playcanvas-binding/profile-engine-not-declared");
    assert.equal(verdict.target, "web");
  }
});

test("binding: a pinned profile without this binding digest is a typed refusal", () => {
  const binding = createPlayCanvasEngineBinding();
  const verdict = playCanvasCanServeTargetProfile(
    binding,
    profileOf("web", ["playcanvas"], [`sha256:${digest("9")}`]),
  );
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "playcanvas-binding/profile-binding-not-pinned");
  }
  // And WITH the binding pinned it is compatible again.
  const pinnedOk = playCanvasCanServeTargetProfile(
    binding,
    profileOf("web", ["playcanvas"], [binding.bindingDigest as unknown as string]),
  );
  assert.equal(pinnedOk.compatible, true);
});

test("binding: a non-web-first target is a typed refusal (E8 incompatibility)", () => {
  const binding = createPlayCanvasEngineBinding();
  const verdict = playCanvasCanServeTargetProfile(binding, profileOf("windows", ["playcanvas"], null));
  assert.equal(verdict.compatible, false);
  if (!verdict.compatible) {
    assert.equal(verdict.code, "playcanvas-binding/profile-target-unsupported");
    assert.equal(verdict.target, "windows");
  }
});

test("binding: the build-contracts projection is structurally valid", () => {
  const binding = createPlayCanvasEngineBinding();
  const projection = toBuildContractsEngineBindingRef(binding);
  assert.equal(isProjectedEngineBindingRef(projection), true);
  assert.equal(projection.engineId, "playcanvas");
  assert.deepEqual([...projection.supportedTargets], ["web", "spark"]);
  assert.equal(isProjectedEngineBindingRef({ engineId: "not valid" }), false);
});
