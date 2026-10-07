/**
 * Build outputs composition validation: artifacts (E7 CAS discipline),
 * manifest integrity (steps, inputs digests, environment fingerprint) and
 * vendor-gate aggregation — all fail-closed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBuildOutputs } from "./validate.ts";
import { computeBuildManifestDigest } from "./outputs.ts";
import type { BuildOutputs } from "./outputs.ts";
import { fixtureAdmittedBuild, fixtureBuildRequest, fixtureConsoleInputs, fixtureVendorSdkEvidence, fixtureWebInputs, fakeBuildExecutor } from "./fixtures.ts";

function webOutputs(): BuildOutputs {
  const request = fixtureBuildRequest(fixtureWebInputs());
  const admitted = fixtureAdmittedBuild(request, "build-outputs-1");
  const executed = fakeBuildExecutor().execute({ request: admitted });
  assert.equal(executed.ok, true);
  if (!executed.ok) {
    throw new Error("fixture executor failed");
  }
  return executed.outputs;
}

test("fake executor outputs validate against their inputs (happy path)", () => {
  const inputs = fixtureWebInputs();
  const request = fixtureBuildRequest(inputs);
  const admitted = fixtureAdmittedBuild(request, "build-outputs-2");
  const executed = fakeBuildExecutor().execute({ request: admitted });
  assert.equal(executed.ok, true);
  if (executed.ok) {
    const validation = validateBuildOutputs(executed.outputs, inputs);
    assert.equal(validation.ok, true);
  }
});

test("zero artifacts are refused", () => {
  const outputs = webOutputs();
  const broken: BuildOutputs = { ...outputs, artifacts: [] };
  const validation = validateBuildOutputs(broken, fixtureWebInputs());
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "no-artifacts"), true);
  }
});

test("inline build artifacts are refused (E7: CAS only)", () => {
  const outputs = webOutputs();
  const broken: BuildOutputs = {
    ...outputs,
    artifacts: [
      {
        artifactKind: outputs.artifacts[0]!.artifactKind,
        target: outputs.artifacts[0]!.target,
        bytes: { storage: "inline", base64: "AAAA", mediaType: "application/octet-stream" },
      } as never,
    ],
  };
  const validation = validateBuildOutputs(broken, fixtureWebInputs());
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(
      validation.reasons.some((r) => r.code === "artifact-not-cas" || r.code === "invalid-artifact"),
      true,
    );
  }
});

test("artifacts targeting a different target than the request are refused", () => {
  const outputs = webOutputs();
  const wrongTarget = outputs.artifacts.map((artifact) => ({ ...artifact, target: "spark" as never }));
  const validation = validateBuildOutputs({ ...outputs, artifacts: wrongTarget }, fixtureWebInputs());
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "artifact-target-mismatch"), true);
  }
});

test("a manifest for different inputs is refused", () => {
  const outputs = webOutputs();
  const validation = validateBuildOutputs(outputs, fixtureConsoleInputs());
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "manifest-inputs-mismatch"), true);
    assert.equal(validation.reasons.some((r) => r.code === "manifest-inputs-summary-mismatch"), true);
  }
});

test("incomplete or reordered manifest steps are refused", () => {
  const outputs = webOutputs();
  const dropped = outputs.manifest.steps.slice(0, 4);
  const validation = validateBuildOutputs(
    { ...outputs, manifest: { ...outputs.manifest, steps: dropped } },
    fixtureWebInputs(),
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "manifest-steps-invalid"), true);
  }
});

test("an ambient environment fingerprint is refused (E9: environment must be pinned)", () => {
  const outputs = webOutputs();
  const validation = validateBuildOutputs(
    { ...outputs, manifest: { ...outputs.manifest, environmentFingerprint: "sha256:" + "0".repeat(64) } },
    fixtureWebInputs(),
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "environment-fingerprint-mismatch"), true);
  }
});

test("missing provenance transformation is refused (R19 shape)", () => {
  const outputs = webOutputs();
  const validation = validateBuildOutputs(
    { ...outputs, provenance: { ...outputs.provenance, buildTransformation: { kind: "author", description: "x" } } },
    fixtureWebInputs(),
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((r) => r.code === "provenance-transformation-missing"), true);
  }
});

test("console outputs without vendor evidence fail validation through the gate", () => {
  const inputs = fixtureConsoleInputs();
  const request = fixtureBuildRequest(inputs);
  const admitted = fixtureAdmittedBuild(request, "build-outputs-console");
  const executed = fakeBuildExecutor().execute({ request: admitted });
  assert.equal(executed.ok, false, "executor must refuse vendor-gated builds without evidence");
  if (!executed.ok) {
    assert.equal(executed.code, "vendor-evidence-required");
  }

  // Even if some other executor produced outputs, validation fails closed.
  const webLike = webOutputs();
  const consoleShaped: BuildOutputs = {
    ...webLike,
    manifest: { ...webLike.manifest, environmentFingerprint: inputs.toolchain.profileDigest },
    verification: [],
  };
  const validation = validateBuildOutputs(consoleShaped, inputs);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    const vendorFailure = validation.reasons.find((r) => r.code === "vendor-gate-failed");
    assert.notEqual(vendorFailure, undefined);
    assert.equal(vendorFailure!.vendorGateReasons?.some((r) => r.code === "vendor-sdk-evidence-missing"), true);
  }
});

test("manifest digest is deterministic (E9)", () => {
  const a = webOutputs();
  const b = webOutputs();
  assert.equal(computeBuildManifestDigest(a.manifest), computeBuildManifestDigest(b.manifest));
});

test("console outputs with authorized vendor evidence validate end to end", () => {
  const inputs = fixtureConsoleInputs();
  const request = fixtureBuildRequest(inputs);
  const admitted = fixtureAdmittedBuild(request, "build-outputs-console-ok");
  const executed = fakeBuildExecutor().execute({
    request: admitted,
    vendorEvidence: [fixtureVendorSdkEvidence(inputs)],
  });
  assert.equal(executed.ok, true);
  if (executed.ok) {
    const validation = validateBuildOutputs(executed.outputs, inputs);
    assert.equal(validation.ok, true);
  }
});
