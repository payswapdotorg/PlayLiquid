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

// ---------------------------------------------------------------------------
// ACR-001 (PLX-ARCH-003): the typed delivery-profile dimension — derived
// defaults (legacy digest stability), explicit pinning, the serve predicate
// and the kind-agnostic world-delivery dispatch view.
// ---------------------------------------------------------------------------

import {
  PLAYCANVAS_DELIVERY_BY_TARGET,
  PLAYCANVAS_DELIVERY_PROFILES,
  configurePlayCanvasDeliveryProfiles,
  playCanvasCanServeDeliveryProfile,
  playCanvasCanServeWorldDelivery,
} from "./engine-binding.ts";
import { contentDigestOf } from "./digest.ts";
import type { WorldKind } from "@playliquid/game-contracts";

test("ACR-001: the delivery mapping derives web→web and spark→spark_vertical", () => {
  assert.equal(PLAYCANVAS_DELIVERY_BY_TARGET.web, "web");
  assert.equal(PLAYCANVAS_DELIVERY_BY_TARGET.spark, "spark_vertical");
  assert.deepEqual([...PLAYCANVAS_DELIVERY_PROFILES], ["web", "spark_vertical"]);
});

test("ACR-001: the default binding carries the DERIVED delivery profiles and the EXACT legacy digest", () => {
  const binding = createPlayCanvasEngineBinding();
  assert.deepEqual([...binding.deliveryProfiles], ["web", "spark_vertical"]);
  // The digest keeps its exact pre-ACR input shape: derived delivery data
  // is a pure function of the digested fields (legacy bindings byte-identical).
  const legacyHex = contentDigestOf({
    kind: "playcanvas-engine-binding",
    engineId: PLAYCANVAS_ENGINE_ID,
    supportedTargets: [...PLAYCANVAS_SUPPORTED_TARGETS],
  });
  assert.equal(binding.bindingDigest, `sha256:${legacyHex}`);
});

test("ACR-001: explicit delivery profiles are PINNED into the digest (E9)", () => {
  const base = createPlayCanvasEngineBinding();
  const configured = configurePlayCanvasDeliveryProfiles(base, ["web", "spark_vertical", "mobile"]);
  assert.equal(configured.ok, true, JSON.stringify(configured));
  if (!configured.ok) return;
  assert.deepEqual([...configured.binding.deliveryProfiles], ["web", "spark_vertical", "mobile"]);
  assert.notEqual(configured.binding.bindingDigest, base.bindingDigest);
  const pinnedHex = contentDigestOf({
    kind: "playcanvas-engine-binding",
    engineId: PLAYCANVAS_ENGINE_ID,
    supportedTargets: [...configured.binding.supportedTargets],
    deliveryProfiles: [...configured.binding.deliveryProfiles],
  });
  assert.equal(configured.binding.bindingDigest, `sha256:${pinnedHex}`);
  // Determinism: same explicit declaration, same digest.
  const again = configurePlayCanvasDeliveryProfiles(base, ["web", "spark_vertical", "mobile"]);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.binding.bindingDigest, configured.binding.bindingDigest);
});

test("ACR-001: invalid explicit delivery declarations refuse (E8)", () => {
  const base = createPlayCanvasEngineBinding();
  for (const bad of [
    [],
    ["hologram"],
    ["web", "web"],
    ["web", 42],
    "web",
  ] as unknown as readonly string[][]) {
    const refused = configurePlayCanvasDeliveryProfiles(base, bad as never);
    assert.equal(refused.ok, false, JSON.stringify(bad));
    if (!refused.ok) {
      assert.equal(refused.code, "playcanvas-binding/invalid-delivery-profiles");
    }
  }
});

test("ACR-001: the serve predicate answers the delivery axis only", () => {
  const binding = createPlayCanvasEngineBinding();
  assert.deepEqual(playCanvasCanServeDeliveryProfile(binding, "web"), { serves: true, deliveryProfile: "web" });
  assert.deepEqual(playCanvasCanServeDeliveryProfile(binding, "spark_vertical"), {
    serves: true,
    deliveryProfile: "spark_vertical",
  });
  for (const delivery of ["desktop", "mobile", "xr", "dedicated_server", "simulation"] as const) {
    const refused = playCanvasCanServeDeliveryProfile(binding, delivery);
    assert.equal(refused.serves, false);
    if (!refused.serves) {
      assert.equal(refused.code, "playcanvas-binding/delivery-profile-unsupported");
      assert.equal(refused.deliveryProfile, delivery);
    }
  }
});

test("ACR-001: the world-delivery view is kind-AGNOSTIC (any kind, delivery decides)", () => {
  const binding = createPlayCanvasEngineBinding();
  // Undeclared → legacy: the build-target list decides (exactly as before).
  assert.deepEqual(playCanvasCanServeWorldDelivery(binding, undefined), { declared: false });
  assert.deepEqual(playCanvasCanServeWorldDelivery(binding, {}), { declared: false });
  // EVERY kind with a web or spark_vertical delivery is served.
  for (const kind of ["spark", "game", "experience", "digital_twin", "other"] as const) {
    const world: { kind: WorldKind; targetProfile: "web" | "spark_vertical" } = { kind, targetProfile: "spark_vertical" };
    const verdict = playCanvasCanServeWorldDelivery(binding, world);
    assert.deepEqual(verdict, { declared: true, serves: true, deliveryProfile: "spark_vertical" }, kind);
    assert.deepEqual(playCanvasCanServeWorldDelivery(binding, { ...world, targetProfile: "web" }), {
      declared: true,
      serves: true,
      deliveryProfile: "web",
    });
  }
  // A declared non-served delivery is a typed refusal, for any kind.
  const refused = playCanvasCanServeWorldDelivery(binding, { kind: "game", targetProfile: "desktop" });
  assert.equal(refused.declared, true);
  if (refused.declared && !refused.serves) {
    assert.equal(refused.code, "playcanvas-binding/delivery-profile-unsupported");
  }
});
