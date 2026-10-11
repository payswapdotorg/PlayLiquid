/**
 * Tool-stage execution tests (E10 pipeline): tool output parsing
 * (fail-closed), evidence record shapes, the vendor authorization check,
 * stage runs over the fake fabric, plan-derived package digests and
 * manifest assembly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asBuildId, asBuildTargetId, asToolOperationId, asVendorId } from "@playliquid/build-contracts";
import { computeBuildManifestDigest } from "@playliquid/build-contracts";
import type { VendorGateRequirement } from "@playliquid/build-contracts";
import { computeBuildInputsDigest } from "@playliquid/build-contracts";
import type { BuildInputs } from "@playliquid/build-contracts";
import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import { computeBuildPlan } from "./plan.ts";
import {
  assembleManifest,
  hasAuthorizedVendorEvidence,
  isVerificationEvidenceRecord,
  packageStageDigest,
  parseToolOutput,
  runToolStage,
} from "./stages.ts";
import { createFakeToolFabric } from "./fakes.ts";
import {
  fixtureDigest,
  fixtureEvaluationEvidence,
  fixtureLock,
  fixtureOnTargetEvidence,
  fixtureRecords,
  fixtureVendorSdkEvidence,
  fixtureWebBuildInputs,
} from "./fixtures.ts";

const BUILD = asBuildId("bld-stagefixture");
const WEB = asBuildTargetId("web");

function fabric(): ReturnType<typeof createFakeToolFabric> {
  return createFakeToolFabric({ operations: ["build", "test", "package"].map((operation) => asToolOperationId(operation)) });
}

// ---------------------------------------------------------------------------
// parseToolOutput (fail-closed tool output contract)
// ---------------------------------------------------------------------------

test("a well-formed tool output with artifacts and evidence parses", () => {
  const parsed = parseToolOutput({
    artifacts: [{ artifactKind: "game.bundle", digest: fixtureDigest("artifact"), sizeBytes: 1_024, mediaType: "application/octet-stream" }],
    evidence: [fixtureEvaluationEvidence()],
  });
  assert.notEqual(parsed, null);
  if (parsed !== null) {
    assert.equal(parsed.artifacts?.length, 1);
    assert.equal(parsed.evidence?.length, 1);
  }
});

test("an empty object is a valid (artifact-less, evidence-less) output", () => {
  const parsed = parseToolOutput({});
  assert.notEqual(parsed, null);
  if (parsed !== null) {
    assert.equal(parsed.artifacts, undefined);
    assert.equal(parsed.evidence, undefined);
  }
});

test("non-object and non-array shapes are refused", () => {
  assert.equal(parseToolOutput(null), null);
  assert.equal(parseToolOutput("ok"), null);
  assert.equal(parseToolOutput([1, 2]), null);
  assert.equal(parseToolOutput({ artifacts: "nope" }), null);
  assert.equal(parseToolOutput({ evidence: 7 }), null);
});

test("malformed artifact records are refused (kind, digest, size, media type)", () => {
  const wellFormed = { artifactKind: "game.bundle", digest: fixtureDigest("artifact"), sizeBytes: 1_024, mediaType: "application/octet-stream" };
  // Artifact kinds are namespaced+dotted by contract (build-contracts'
  // pattern guard), not a frozen vocabulary: an unknown-but-well-formed
  // dotted kind is LEGAL; an un-namespaced kind is malformed.
  assert.notEqual(parseToolOutput({ artifacts: [{ ...wellFormed, artifactKind: "assets.pack" }] }), null);
  assert.equal(parseToolOutput({ artifacts: [{ ...wellFormed, artifactKind: "gamebundle" }] }), null);
  assert.equal(parseToolOutput({ artifacts: [{ ...wellFormed, digest: "not-a-digest" }] }), null);
  assert.equal(parseToolOutput({ artifacts: [{ ...wellFormed, sizeBytes: 0 }] }), null);
  assert.equal(parseToolOutput({ artifacts: [{ ...wellFormed, sizeBytes: 1.5 }] }), null);
  assert.equal(parseToolOutput({ artifacts: [{ ...wellFormed, mediaType: 42 }] }), null);
});

test("malformed evidence records are refused inside tool outputs", () => {
  assert.equal(parseToolOutput({ evidence: [{ kind: "made-up", verdict: "pass" }] }), null);
  assert.equal(parseToolOutput({ evidence: [fixtureEvaluationEvidence(), { kind: "evaluation-suite", verdict: "pass" }] }), null);
});

// ---------------------------------------------------------------------------
// isVerificationEvidenceRecord (typed evidence shapes)
// ---------------------------------------------------------------------------

test("evaluation-suite, vendor-sdk and on-target records validate; junk refuses", () => {
  assert.equal(isVerificationEvidenceRecord(fixtureEvaluationEvidence()), true);
  const vendor = { kind: "vendor-sdk", verdict: "pass", authorization: { vendorId: asVendorId("nintendo"), authorizedSdkDigest: fixtureDigest("sdk"), authorizationDigest: fixtureDigest("auth") }, evidenceDigest: fixtureDigest("evidence") };
  assert.equal(isVerificationEvidenceRecord(vendor), true);
  assert.equal(isVerificationEvidenceRecord(fixtureOnTargetEvidence(fixtureDigest("manifest"))), true);
  assert.equal(isVerificationEvidenceRecord(null), false);
  assert.equal(isVerificationEvidenceRecord({}), false);
  assert.equal(isVerificationEvidenceRecord({ kind: "evaluation-suite", verdict: "maybe" }), false);
  assert.equal(isVerificationEvidenceRecord({ ...vendor, authorization: { vendorId: "nintendo" } }), false);
});

// ---------------------------------------------------------------------------
// hasAuthorizedVendorEvidence (lock rule 24)
// ---------------------------------------------------------------------------

test("authorization requires a PASSING record naming the gate's exact vendor", () => {
  const gate: VendorGateRequirement = { kind: "authorized-vendor-sdk", vendorId: asVendorId("nintendo") };
  const inputs = fixtureWebBuildInputs(fixtureLock(fixtureRecords()));
  const pass = fixtureVendorSdkEvidence(inputs);
  const wrongVendor = { ...pass, authorization: { ...pass.authorization, vendorId: asVendorId("someone-else") } };
  const failing = fixtureVendorSdkEvidence(inputs, "fail");
  assert.equal(hasAuthorizedVendorEvidence(gate, [pass]), true);
  assert.equal(hasAuthorizedVendorEvidence(gate, [wrongVendor]), false);
  assert.equal(hasAuthorizedVendorEvidence(gate, [failing]), false);
  assert.equal(hasAuthorizedVendorEvidence(gate, []), false);
  // A non-gated target authorizes trivially (no vendor requirement).
  assert.equal(hasAuthorizedVendorEvidence({ kind: "none" }, []), true);
});

// ---------------------------------------------------------------------------
// runToolStage over the fake fabric
// ---------------------------------------------------------------------------

test("a stage runs its planned steps and records a deterministic digest", async () => {
  const plan = computeBuildPlan(BUILD, WEB, [asToolOperationId("build"), asToolOperationId("test")]);
  const tool = fabric();
  const first = await runToolStage(tool, BUILD, "emit", plan, { buildId: BUILD });
  assert.equal("code" in first, false);
  if (!("code" in first)) {
    assert.deepEqual(first.operations, [asToolOperationId("build")]);
    assert.equal(first.artifacts.length, 1); // emit-stage steps emit one bundle artifact
    assert.equal(first.evidence.length, 0);
  }
  // Same plan + build ⇒ same stage digest (E9), even on a fresh fabric.
  const second = await runToolStage(fabric(), BUILD, "emit", plan, { buildId: BUILD });
  assert.equal("code" in second, false);
  if (!("code" in first) && !("code" in second)) {
    assert.equal(first.stageDigest, second.stageDigest);
  }
  // Every step was invoked through the seam with its canonical call id.
  assert.deepEqual(
    tool.calls.map((call) => call.callId),
    [`${BUILD}#emit#build`],
  );
});

test("a stage with no planned steps is legal and empty", async () => {
  const plan = computeBuildPlan(BUILD, WEB, [asToolOperationId("build")]);
  const outcome = await runToolStage(fabric(), BUILD, "verify", plan, { buildId: BUILD });
  assert.equal("code" in outcome, false);
  if (!("code" in outcome)) {
    assert.deepEqual(outcome.operations, []);
    assert.deepEqual(outcome.artifacts, []);
    assert.deepEqual(outcome.evidence, []);
  }
});

test("a failed tool step is a typed tool-step-failed stage failure", async () => {
  const tool = fabric();
  tool.failOperation(asToolOperationId("build"), { code: "compiler-crash", message: "scripted fault" });
  const plan = computeBuildPlan(BUILD, WEB, [asToolOperationId("build")]);
  const outcome = await runToolStage(tool, BUILD, "emit", plan, { buildId: BUILD });
  assert.equal("code" in outcome, true);
  if ("code" in outcome) {
    assert.equal(outcome.code, "tool-step-failed");
    assert.match(outcome.message, /compiler-crash/);
  }
});

test("a malformed tool output is a typed tool-output-invalid stage failure", async () => {
  const tool = fabric();
  tool.scriptNextOutput({ artifacts: [{ artifactKind: "game.bundle", digest: "not-a-digest", sizeBytes: 1, mediaType: "application/octet-stream" }] });
  const plan = computeBuildPlan(BUILD, WEB, [asToolOperationId("build")]);
  const outcome = await runToolStage(tool, BUILD, "emit", plan, { buildId: BUILD });
  assert.equal("code" in outcome, true);
  if ("code" in outcome) {
    assert.equal(outcome.code, "tool-output-invalid");
    assert.match(outcome.message, /build contract rejects/);
  }
});

// ---------------------------------------------------------------------------
// packageStageDigest + assembleManifest
// ---------------------------------------------------------------------------

test("the package stage digest is plan-derived and knowable BEFORE packaging", () => {
  const plan = computeBuildPlan(BUILD, WEB, [asToolOperationId("build"), asToolOperationId("package"), asToolOperationId("sign")]);
  const other = computeBuildPlan(BUILD, WEB, [asToolOperationId("build"), asToolOperationId("package")]);
  const digest = packageStageDigest(plan);
  assert.equal(digest, packageStageDigest(computeBuildPlan(BUILD, WEB, [asToolOperationId("package"), asToolOperationId("build"), asToolOperationId("sign")])));
  assert.notEqual(digest, packageStageDigest(other));
  // It never touches the fabric: compute it twice with no tool at all.
  assert.equal(typeof digest, "string");
  assert.match(digest, /^sha256:/);
});

test("assembleManifest is faithful to the pinned inputs and recorded steps", () => {
  const inputs: BuildInputs = fixtureWebBuildInputs(fixtureLock(fixtureRecords()));
  const plan = computeBuildPlan(BUILD, inputs.targetProfile.target, inputs.toolchain.citesToolOperations);
  const steps = [
    { stage: "resolve" as const, stageDigest: fixtureDigest("resolve") },
    { stage: "plan" as const, stageDigest: fixtureDigest("plan") },
    { stage: "emit" as const, stageDigest: fixtureDigest("emit") },
    { stage: "verify" as const, stageDigest: fixtureDigest("verify") },
    { stage: "package" as const, stageDigest: packageStageDigest(plan) },
  ];
  const manifest = assembleManifest(BUILD, inputs, steps);
  assert.equal(manifest.buildId, BUILD);
  assert.equal(manifest.inputsDigest, computeBuildInputsDigest(inputs));
  assert.equal(manifest.inputs.gameIr, inputs.gameIr.digest);
  assert.equal(manifest.inputs.packageLock, inputs.packageLock.lockFingerprint);
  assert.equal(manifest.inputs.targetProfile, inputs.targetProfile.profileDigest);
  assert.equal(manifest.inputs.engineBinding, inputs.engineBinding.bindingDigest);
  assert.equal(manifest.inputs.toolchain, inputs.toolchain.profileDigest);
  assert.equal(manifest.environmentFingerprint, inputs.toolchain.profileDigest);
  assert.deepEqual(manifest.steps, steps);
  // The manifest digest is deterministic over the same material.
  assert.equal(computeBuildManifestDigest(manifest), computeBuildManifestDigest(assembleManifest(BUILD, inputs, steps)));
  const derived: ContentDigest = computeDigest({ manifest: manifest.buildId });
  assert.match(derived, /^sha256:/);
});
