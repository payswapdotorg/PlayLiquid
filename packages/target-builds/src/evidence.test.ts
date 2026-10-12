/**
 * R19 evidence aggregation tests: per-target provenance (source pins +
 * adapter identity + stage digests) and verification (gate results recorded
 * by the build), both content-addressed (E7/E9).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDigest } from "@playliquid/package-system";
import { asEngineId } from "@playliquid/build-contracts";
import { aggregateProvenance, aggregateVerification, evidenceListDigest, sourcePinsOf } from "./evidence.ts";
import type { TargetBuildResult } from "./outcomes.ts";
import { fixtureDigest } from "./fixtures.ts";

const playcanvas = asEngineId("playcanvas");
const unity = asEngineId("unity");

const gameIr = fixtureDigest("game-ir-composition");
const lock = fixtureDigest("package-lock");
const toolchain = fixtureDigest("toolchain-profile");
const profile = fixtureDigest("target-profile");
const binding = fixtureDigest("engine-binding");
const stage = fixtureDigest("stage");

function admitted(result: Partial<Extract<TargetBuildResult, { admitted: true }>>): TargetBuildResult {
  return {
    admitted: true,
    phase: "succeeded",
    buildId: "bld-1",
    documentDigest: fixtureDigest("document"),
    manifestDigest: fixtureDigest("manifest"),
    artifacts: [],
    stageDigests: [{ stage: "package", stageDigest: stage }],
    evidence: [{ kind: "evaluation-suite", verdict: "pass", suite: { suiteId: "suite-smoke", suiteDigest: stage }, evidenceDigest: stage }],
    failure: null,
    awaitingEvidence: false,
    ...result,
  };
}

test("sourcePinsOf cites the request pins plus the target's profile digest", () => {
  const pins = sourcePinsOf(
    { gameIr, packageLock: { lockFingerprint: lock, pinnedPackageCount: 2 }, toolchain: { profileId: "t" as never, profileDigest: toolchain, citesToolOperations: [] } },
    profile,
  );
  assert.deepEqual(pins, { gameIr, packageLock: lock, targetProfile: profile, toolchain });
});

test("aggregateProvenance carries pins, adapter identity and stage digests (R19)", () => {
  const evidence = aggregateProvenance("web", playcanvas, binding, { gameIr, packageLock: lock, targetProfile: profile, toolchain }, admitted({}));
  assert.equal(evidence.target, "web");
  assert.equal(evidence.engineId, playcanvas);
  assert.equal(evidence.bindingDigest, binding);
  assert.deepEqual(evidence.stageDigests, [{ stage: "package", stageDigest: stage }]);
  assert.deepEqual(evidence.sourcePins, { gameIr, packageLock: lock, targetProfile: profile, toolchain });
  assert.equal(evidence.provenanceDigest, computeDigest({
    target: "web",
    engineId: playcanvas,
    bindingDigest: binding,
    sourcePins: { gameIr, packageLock: lock, targetProfile: profile, toolchain },
    stageDigests: [{ stage: "package", stageDigest: stage }],
  }));
  // Deterministic over identical inputs (E9).
  const twin = aggregateProvenance("web", playcanvas, binding, { gameIr, packageLock: lock, targetProfile: profile, toolchain }, admitted({}));
  assert.equal(evidence.provenanceDigest, twin.provenanceDigest);
  // Sensitive to every provenance material.
  assert.notEqual(
    aggregateProvenance("web", unity, binding, { gameIr, packageLock: lock, targetProfile: profile, toolchain }, admitted({})).provenanceDigest,
    evidence.provenanceDigest,
  );
});

test("a non-admitted result aggregates empty stage digests (nothing was driven)", () => {
  const evidence = aggregateProvenance(
    "web",
    playcanvas,
    binding,
    { gameIr, packageLock: lock, targetProfile: profile, toolchain },
    { admitted: false, intakeRefusal: { code: "unresolvable-input", message: "x" } },
  );
  assert.deepEqual(evidence.stageDigests, []);
});

test("aggregateVerification reads the build's own gate results (R19; counterfeit-free)", () => {
  const pass = aggregateVerification("web", admitted({}));
  assert.equal(pass.verdict, "pass");
  assert.equal(pass.failure, null);
  assert.equal(pass.gateResults.length, 1);
  assert.equal(pass.gateResults[0]?.kind, "evaluation-suite");

  const awaiting = aggregateVerification("web", admitted({ phase: "verify", awaitingEvidence: true, failure: { code: "vendor-evidence-required", message: "x" } }));
  assert.equal(awaiting.verdict, "awaiting");

  const failed = aggregateVerification("web", admitted({ phase: "failed", failure: { code: "toolchain-unavailable", message: "x" } }));
  assert.equal(failed.verdict, "fail");
  assert.equal(failed.failure?.code, "toolchain-unavailable");

  const intake = aggregateVerification("web", { admitted: false, intakeRefusal: { code: "unresolvable-input", message: "x" } });
  assert.equal(intake.verdict, "fail");
  assert.equal(intake.failure?.code, "intake-unresolvable-input");
});

test("evidenceListDigest is order-insensitive and content-sensitive (aggregation digest)", () => {
  const a = fixtureDigest("a");
  const b = fixtureDigest("b");
  assert.equal(evidenceListDigest([a, b]), evidenceListDigest([b, a]));
  assert.notEqual(evidenceListDigest([a, b]), evidenceListDigest([a]));
  assert.notEqual(evidenceListDigest([a, b]), evidenceListDigest([a, a]));
});
