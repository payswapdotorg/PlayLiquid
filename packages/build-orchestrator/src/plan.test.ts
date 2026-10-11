/**
 * Deterministic build planning tests (E9): plan digest determinism,
 * canonical call ids, the frozen operation→stage table and dedupe order.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asBuildId, asBuildTargetId, asToolOperationId, BUILD_STAGES } from "@playliquid/build-contracts";
import { computeBuildPlan, OPERATION_STAGE_TABLE, planOperations, planStepsForStage, stageForOperation } from "./plan.ts";

const BUILD = asBuildId("bld-planfixture");
const WEB = asBuildTargetId("web");

test("planning is deterministic: same build id, target and operation set ⇒ same plan", () => {
  const a = computeBuildPlan(BUILD, WEB, [asToolOperationId("build"), asToolOperationId("test"), asToolOperationId("package")]);
  const b = computeBuildPlan(BUILD, WEB, [asToolOperationId("package"), asToolOperationId("test"), asToolOperationId("build")]);
  assert.equal(a.planDigest, b.planDigest);
  assert.deepEqual(a.steps, b.steps);
  assert.equal(a.workflowClass, b.workflowClass);
});

test("a different build id yields a different plan digest (per-build seeding)", () => {
  const a = computeBuildPlan(BUILD, WEB, [asToolOperationId("build")]);
  const b = computeBuildPlan(asBuildId("bld-other"), WEB, [asToolOperationId("build")]);
  assert.notEqual(a.planDigest, b.planDigest);
  assert.notEqual(a.steps[0]?.callId, b.steps[0]?.callId);
});

test("cited operations are deduplicated; call ids are canonical and stable (E9)", () => {
  const plan = computeBuildPlan(BUILD, WEB, [asToolOperationId("build"), asToolOperationId("build"), asToolOperationId("test")]);
  assert.equal(plan.steps.length, 2);
  const build = plan.steps.find((step) => step.operation === "build");
  const verify = plan.steps.find((step) => step.operation === "test");
  assert.notEqual(build, undefined);
  assert.notEqual(verify, undefined);
  if (build !== undefined && verify !== undefined) {
    assert.equal(build.callId, `${BUILD}#emit#build`);
    assert.equal(build.idempotencyKey, build.callId);
    assert.equal(verify.callId, `${BUILD}#verify#test`);
    assert.equal(verify.idempotencyKey, verify.callId);
  }
});

test("the frozen operation→stage table assigns every house operation (R12 data)", () => {
  assert.equal(OPERATION_STAGE_TABLE.build, "emit");
  assert.equal(OPERATION_STAGE_TABLE.compile, "emit");
  assert.equal(OPERATION_STAGE_TABLE.cook, "emit");
  assert.equal(OPERATION_STAGE_TABLE.export, "emit");
  assert.equal(OPERATION_STAGE_TABLE.test, "verify");
  assert.equal(OPERATION_STAGE_TABLE.validate, "verify");
  assert.equal(OPERATION_STAGE_TABLE.verify, "verify");
  assert.equal(OPERATION_STAGE_TABLE.bundle, "package");
  assert.equal(OPERATION_STAGE_TABLE.package, "package");
  assert.equal(OPERATION_STAGE_TABLE.sign, "package");
  // Unknown operations default to emit (provider-neutral seam vocabulary).
  assert.equal(stageForOperation(asToolOperationId("future-op")), "emit");
});

test("steps follow the frozen stage order; stage filters are exact", () => {
  const plan = computeBuildPlan(BUILD, WEB, [
    asToolOperationId("test"),
    asToolOperationId("build"),
    asToolOperationId("package"),
    asToolOperationId("sign"),
  ]);
  const stagesOf = plan.steps.map((step) => step.stage);
  const expected = BUILD_STAGES.flatMap((stage) => stagesOf.filter((candidate) => candidate === stage));
  assert.deepEqual(stagesOf, expected);
  assert.deepEqual(planOperations(plan), ["build", "test", "package", "sign"]);
  assert.deepEqual(
    planStepsForStage(plan, "package").map((step) => step.operation),
    ["package", "sign"],
  );
  assert.deepEqual(planStepsForStage(plan, "resolve"), []);
});
