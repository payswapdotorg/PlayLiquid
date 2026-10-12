/**
 * Outcome + verdict tests: the typed per-target outcome views and the honest
 * overall verdict computation (failure isolation, E8).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asEngineId } from "@playliquid/build-contracts";
import type { TargetBuildResult, DurableTargetOutcome } from "./outcomes.ts";
import { computeVerdict, outcomeOfResult, skipOutcomeOf } from "./outcomes.ts";
import { fixtureDigest } from "./fixtures.ts";

const playcanvas = asEngineId("playcanvas");
const unreal = asEngineId("unreal");
const digest = fixtureDigest("some-document");

function succeeded(): TargetBuildResult {
  return {
    admitted: true,
    phase: "succeeded",
    buildId: "bld-1",
    documentDigest: digest,
    manifestDigest: digest,
    artifacts: [],
    stageDigests: [{ stage: "package", stageDigest: digest }],
    evidence: [],
    failure: null,
    awaitingEvidence: false,
  };
}

test("an admitted succeeded result projects the succeeded outcome", () => {
  const outcome = outcomeOfResult("web", playcanvas, succeeded());
  assert.equal(outcome.outcome, "succeeded");
  assert.equal(outcome.target, "web");
  assert.equal(outcome.engineId, playcanvas);
  assert.equal(outcome.buildId, "bld-1");
  assert.equal(outcome.documentDigest, digest);
  assert.equal(outcome.manifestDigest, digest);
});

test("the retryable vendor wait projects the awaiting-evidence outcome (lock rule 24)", () => {
  const outcome = outcomeOfResult("web", playcanvas, {
    admitted: true,
    phase: "verify",
    buildId: "bld-1",
    documentDigest: digest,
    manifestDigest: digest,
    artifacts: [],
    stageDigests: [],
    evidence: [],
    failure: { code: "vendor-evidence-required", message: "awaiting out-of-band evidence" },
    awaitingEvidence: true,
  });
  assert.equal(outcome.outcome, "awaiting-evidence");
});

test("a failed phase projects the failed outcome with the build's failure", () => {
  const outcome = outcomeOfResult("web", playcanvas, {
    admitted: true,
    phase: "failed",
    buildId: "bld-1",
    documentDigest: digest,
    manifestDigest: null,
    artifacts: [],
    stageDigests: [],
    evidence: [],
    failure: { code: "toolchain-unavailable", message: "missing toolchain" },
    awaitingEvidence: false,
  });
  assert.equal(outcome.outcome, "failed");
  if (outcome.outcome === "failed") {
    assert.equal(outcome.failure.code, "toolchain-unavailable");
    assert.equal(outcome.buildId, "bld-1");
    assert.equal(outcome.documentDigest, digest);
  }
});

test("a non-terminal phase without a failure still yields an honest typed failure", () => {
  const outcome = outcomeOfResult("web", playcanvas, {
    admitted: true,
    phase: "verify",
    buildId: "bld-1",
    documentDigest: digest,
    manifestDigest: null,
    artifacts: [],
    stageDigests: [],
    evidence: [],
    failure: null,
    awaitingEvidence: false,
  });
  assert.equal(outcome.outcome, "failed");
  if (outcome.outcome === "failed") {
    assert.equal(outcome.failure.code, "phase-verify");
  }
});

test("an intake refusal projects the failed outcome with the intake code (never admitted)", () => {
  const outcome = outcomeOfResult("web", playcanvas, {
    admitted: false,
    intakeRefusal: { code: "unresolvable-input", message: "gameIr digest not found" },
  });
  assert.equal(outcome.outcome, "failed");
  if (outcome.outcome === "failed") {
    assert.equal(outcome.failure.code, "intake-unresolvable-input");
    assert.equal(outcome.buildId, null);
    assert.equal(outcome.documentDigest, null);
  }
});

function durable(result: TargetBuildResult): DurableTargetOutcome {
  return {
    kind: "durable-target-outcome",
    planKey: "plan|web",
    storeKey: "record#web",
    originRecordId: "mtb-origin",
    target: "web",
    engineId: playcanvas,
    result,
    snapshot: null,
    recordedAt: 1,
  };
}

test("skipOutcomeOf carries the prior build's truth and names the originating record (E6)", () => {
  const outcome = skipOutcomeOf(durable(succeeded()));
  assert.equal(outcome.outcome, "skipped");
  if (outcome.outcome === "skipped") {
    assert.equal(outcome.buildId, "bld-1");
    assert.equal(outcome.documentDigest, digest);
    assert.equal(outcome.resumedFromRecordId, "mtb-origin");
  }
});

test("skipOutcomeOf refuses a never-admitted prior (internal invariant, honest)", () => {
  const outcome = skipOutcomeOf(durable({ admitted: false, intakeRefusal: { code: "invalid-command", message: "x" } }));
  assert.equal(outcome.outcome, "failed");
});

test("computeVerdict is total and honest (failure isolation)", () => {
  const ok = outcomeOfResult("web", playcanvas, succeeded());
  const bad = outcomeOfResult("windows", unreal, { admitted: false, intakeRefusal: { code: "unresolvable-input", message: "x" } });
  const awaiting = outcomeOfResult("macos", unreal, {
    admitted: true,
    phase: "verify",
    buildId: "bld-1",
    documentDigest: digest,
    manifestDigest: digest,
    artifacts: [],
    stageDigests: [],
    evidence: [],
    failure: { code: "vendor-evidence-required", message: "x" },
    awaitingEvidence: true,
  });
  assert.equal(computeVerdict([], 1), "refused");
  assert.equal(computeVerdict([ok], 0), "succeeded");
  // One refusal voids nothing: satisfied + refused ⇒ partial.
  assert.equal(computeVerdict([ok], 1), "partial");
  // A mixed fan-out is partial, never failed-when-something-succeeded.
  assert.equal(computeVerdict([ok, bad], 0), "partial");
  assert.equal(computeVerdict([bad], 0), "failed");
  // An out-of-band wait is a retryable pending state, never a hard failure.
  assert.equal(computeVerdict([awaiting], 0), "partial");
  assert.equal(computeVerdict([awaiting, ok], 0), "partial");
  assert.equal(computeVerdict([awaiting, bad], 0), "partial");
});
