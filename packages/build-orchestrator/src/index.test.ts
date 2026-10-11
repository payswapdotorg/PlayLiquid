/**
 * Public barrel tests — src/index.ts is the frozen module surface
 * (module.ts: publicEntrypoints), so the doors, engines and adapters
 * hosts depend on must be importable from the barrel exactly as
 * consumers will import them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILD_EVENT_TYPES,
  BUILD_ORCHESTRATOR_AUTHORITY,
  BuildOrchestratorService,
  adjudicateClosure,
  admitBuildToIntake,
  advanceOneArc,
  asTenantId,
  assembleManifest,
  assembleOutputs,
  closureModelProvenance,
  computeBuildPlan,
  createFakeBuildSource,
  createFakeToolFabric,
  createManualClock,
  createMemoryBuildStore,
  createRegistryBuildSource,
  createToolFabricAdapter,
  findEventLogCorruption,
  hasAuthorizedVendorEvidence,
  isBuildEvent,
  isVerificationEvidenceRecord,
  manifestDigestOf,
  nextSequence,
  packageStageDigest,
  parseToolOutput,
  planStepsForStage,
  runToolStage,
  snapshotOf,
  stageForOperation,
  stepRecord,
  tenantEncounterKey,
  verifySnapshot,
} from "./index.ts";

test("the barrel exports the frozen public surface (PL-020)", () => {
  const surface = {
    BuildOrchestratorService,
    adjudicateClosure,
    admitBuildToIntake,
    advanceOneArc,
    assembleManifest,
    assembleOutputs,
    closureModelProvenance,
    computeBuildPlan,
    createFakeBuildSource,
    createFakeToolFabric,
    createManualClock,
    createMemoryBuildStore,
    createRegistryBuildSource,
    createToolFabricAdapter,
    findEventLogCorruption,
    hasAuthorizedVendorEvidence,
    isBuildEvent,
    isVerificationEvidenceRecord,
    manifestDigestOf,
    nextSequence,
    packageStageDigest,
    parseToolOutput,
    planStepsForStage,
    runToolStage,
    snapshotOf,
    stageForOperation,
    stepRecord,
    tenantEncounterKey,
    verifySnapshot,
  };
  for (const [name, value] of Object.entries(surface)) {
    assert.equal(typeof value, "function", `${name} must be exported as a function`);
  }
});

test("the event vocabulary and authority stamp are the frozen public constants", () => {
  assert.equal(BUILD_ORCHESTRATOR_AUTHORITY, "build-orchestrator");
  assert.equal(BUILD_EVENT_TYPES.length, 7);
  assert.equal(BUILD_EVENT_TYPES.includes("admitted"), true);
});

test("the tenant encounter key format is part of the public seam (R20)", () => {
  const key = tenantEncounterKey(asTenantId("tenant-a"), "build-request", "builder-agent", "nonce-1");
  assert.equal(key, "tenant-a|build-request|builder-agent|nonce-1");
});
