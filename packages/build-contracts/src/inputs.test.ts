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
