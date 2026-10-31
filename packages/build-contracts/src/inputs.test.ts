/**
 * Build inputs: structural validation refusals and digest determinism (E9).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asBuildTargetId,
  asProfileInputId,
  asToolchainProfileId,
  asVendorId,
} from "./primitives.ts";
import { asEngineId, asToolOperationId } from "./adapter-seam.ts";
import type { BuildInputs } from "./inputs.ts";
import { computeBuildInputsDigest, isVendorGateRequirement, validateBuildInputs } from "./inputs.ts";
import { computeDigest } from "@playliquid/package-system";
import { fixtureConsoleInputs, fixtureDigest, fixtureWebInputs } from "./fixtures.ts";

test("fixture web inputs are structurally valid", () => {
  const validation = validateBuildInputs(fixtureWebInputs());
  assert.equal(validation.ok, true);
});

test("malformed GameIR digest is refused (input resolution shape)", () => {
  const inputs = fixtureWebInputs();
  const broken: BuildInputs = { ...inputs, gameIr: { digest: "not-a-digest" } };
  const validation = validateBuildInputs(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "invalid-game-ir-digest" && r.input === "gameIr"), true);
  }
});

test("malformed package lock reference is refused", () => {
  const inputs = fixtureWebInputs();
  const broken: BuildInputs = {
    ...inputs,
    packageLock: { lockFingerprint: "sha256:short", pinnedPackageCount: -1 },
  };
  const validation = validateBuildInputs(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "invalid-package-lock" && r.input === "packageLock"), true);
  }
});

test("malformed target profile reference is refused", () => {
  const inputs = fixtureWebInputs();
  const broken: BuildInputs = {
    ...inputs,
    targetProfile: {
      profileId: asProfileInputId(""),
      profileDigest: fixtureDigest("profile"),
      target: asBuildTargetId("web"),
      vendorGate: { kind: "none" },
    },
  };
  const validation = validateBuildInputs(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "invalid-target-profile"), true);
  }
});

test("malformed engine binding is refused", () => {
  const inputs = fixtureWebInputs();
  const broken: BuildInputs = {
    ...inputs,
    engineBinding: {
      engineId: asEngineId("Native!"),
      bindingDigest: fixtureDigest("binding"),
      supportedTargets: [asBuildTargetId("web")],
    },
  };
  const validation = validateBuildInputs(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "invalid-engine-binding"), true);
  }
});

test("malformed toolchain profile is refused (bad tool-operation id)", () => {
  const inputs = fixtureWebInputs();
  const broken: BuildInputs = {
    ...inputs,
    toolchain: {
      profileId: asToolchainProfileId("web-toolchain"),
      profileDigest: fixtureDigest("toolchain"),
      citesToolOperations: [asToolOperationId("Build")],
    },
  };
  const validation = validateBuildInputs(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "invalid-toolchain"), true);
  }
});

test("vendor gate requirement guards both variants", () => {
  assert.equal(isVendorGateRequirement({ kind: "none" }), true);
  assert.equal(
    isVendorGateRequirement({ kind: "authorized-vendor-sdk", vendorId: asVendorId("nintendo") }),
    true,
  );
  assert.equal(isVendorGateRequirement({ kind: "authorized-vendor-sdk" }), false);
  assert.equal(isVendorGateRequirement({ kind: "maybe" }), false);
  assert.equal(isVendorGateRequirement(null), false);
});

test("input-set digest is declaration-order invariant (E9)", () => {
  const a = fixtureWebInputs();
  const b: BuildInputs = {
    ...a,
    engineBinding: {
      ...a.engineBinding,
      supportedTargets: [...a.engineBinding.supportedTargets].reverse(),
    },
    toolchain: {
      ...a.toolchain,
      citesToolOperations: [...a.toolchain.citesToolOperations].reverse(),
    },
  };
  assert.equal(computeBuildInputsDigest(a), computeBuildInputsDigest(b));
});

test("input-set digest distinguishes different inputs", () => {
  const a = fixtureWebInputs();
  const b = fixtureConsoleInputs();
  assert.notEqual(computeBuildInputsDigest(a), computeBuildInputsDigest(b));

  const bumped: BuildInputs = {
    ...a,
    packageLock: { ...a.packageLock, pinnedPackageCount: a.packageLock.pinnedPackageCount + 1 },
  };
  assert.notEqual(computeBuildInputsDigest(a), computeBuildInputsDigest(bumped));
});

// ---------------------------------------------------------------------------
// ACR-001 (PLX-ARCH-003): the typed deliveryProfile dimension — optional,
// independent of the build-target axis, additive-only.
// ---------------------------------------------------------------------------

test("ACR-001: a typed deliveryProfile is a valid target-profile input", () => {
  const inputs = fixtureWebInputs();
  const declared: BuildInputs = {
    ...inputs,
    targetProfile: { ...inputs.targetProfile, deliveryProfile: "web" },
  };
  const validation = validateBuildInputs(declared);
  assert.equal(validation.ok, true);
});

test("ACR-001: an unknown deliveryProfile is refused as an invalid target profile", () => {
  const inputs = fixtureWebInputs();
  const broken = {
    ...inputs,
    targetProfile: { ...inputs.targetProfile, deliveryProfile: "hologram" },
  } as unknown as BuildInputs;
  const validation = validateBuildInputs(broken);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "invalid-target-profile" && r.input === "targetProfile"), true);
  }
});

test("ACR-001: absent deliveryProfile keeps the EXACT legacy digest (additive-only)", () => {
  const inputs = fixtureWebInputs();
  assert.equal(inputs.targetProfile.deliveryProfile, undefined);
  // The pre-ACR digest shape: the delivery key is absent, never undefined.
  const legacyDigest = computeDigest({
    gameIr: inputs.gameIr.digest,
    packageLock: {
      lockFingerprint: inputs.packageLock.lockFingerprint,
      pinnedPackageCount: inputs.packageLock.pinnedPackageCount,
    },
    targetProfile: {
      profileId: inputs.targetProfile.profileId,
      profileDigest: inputs.targetProfile.profileDigest,
      target: inputs.targetProfile.target,
      vendorGate: inputs.targetProfile.vendorGate.kind,
    },
    engineBinding: {
      engineId: inputs.engineBinding.engineId,
      bindingDigest: inputs.engineBinding.bindingDigest,
      supportedTargets: [...inputs.engineBinding.supportedTargets].sort(),
    },
    toolchain: {
      profileId: inputs.toolchain.profileId,
      profileDigest: inputs.toolchain.profileDigest,
      citesToolOperations: [...inputs.toolchain.citesToolOperations].sort(),
    },
  });
  assert.equal(computeBuildInputsDigest(inputs), legacyDigest);
});

test("ACR-001: a declared deliveryProfile changes the digest, deterministically (E9)", () => {
  const legacy = fixtureWebInputs();
  const declared: BuildInputs = {
    ...legacy,
    targetProfile: { ...legacy.targetProfile, deliveryProfile: "spark_vertical" },
  };
  assert.notEqual(computeBuildInputsDigest(declared), computeBuildInputsDigest(legacy));
  const again: BuildInputs = {
    ...legacy,
    targetProfile: { ...legacy.targetProfile, deliveryProfile: "spark_vertical" },
  };
  assert.equal(computeBuildInputsDigest(declared), computeBuildInputsDigest(again));
  const otherDelivery: BuildInputs = {
    ...legacy,
    targetProfile: { ...legacy.targetProfile, deliveryProfile: "web" },
  };
  assert.notEqual(computeBuildInputsDigest(declared), computeBuildInputsDigest(otherDelivery));
});

test("ACR-001: deliveryProfile is independent of the build-target axis", () => {
  const inputs = fixtureWebInputs();
  // A game-kind build targeting the spark BUILD target may deliver
  // spark_vertical; the two axes are declared independently (ACR-001 §2).
  const cross: BuildInputs = {
    ...inputs,
    targetProfile: {
      ...inputs.targetProfile,
      target: asBuildTargetId("spark"),
      deliveryProfile: "spark_vertical",
    },
  };
  const validation = validateBuildInputs(cross);
  assert.equal(validation.ok, true);
});
