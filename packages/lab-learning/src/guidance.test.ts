/**
 * GUIDANCE TESTS (PL-030) — the top-level product and the E11 marker
 * discipline: observed-evidence vs labeled-estimate structural
 * disjointness, marker honesty (the marker reflects the inputs actually
 * consumed), the typed empty/baseline state, deterministic ranking and
 * seed hints, and the stripped/forged-marker refusals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { admitLearningCycle } from "./intake.ts";
import {
  asLabeledEstimateGuidance,
  asObservedEvidenceGuidance,
  deriveSearchGuidance,
  verifySearchGuidanceMarker,
} from "./guidance.ts";
import type { LabeledEstimateGuidance, ObservedEvidenceGuidance } from "./guidance.ts";
import { guidanceBasisDigestOf } from "./digest.ts";
import { labFixtureGeneralistOrganization } from "@playliquid/lab-simulation";
import {
  cycleSubmission,
  secondSubmission,
  testBlueprint,
  testRun,
  testSearchResult,
  testSubmission,
} from "./testkit.ts";

function recordOf(submission: ReturnType<typeof testSubmission>) {
  const admitted = admitLearningCycle(submission, { records: [] });
  assert.ok(admitted.ok);
  return admitted.record;
}

test("guidance: the empty state is the typed baseline, never an exception", () => {
  const result = deriveSearchGuidance({ records: [], tenant: testSubmission().tenant, mode: "observed-only" });
  assert.ok(result.ok);
  assert.equal(result.guidance.epistemic, "observed-evidence");
  assert.equal(result.guidance.cycleCount, 0);
  assert.equal(result.guidance.observationCount, 0);
  assert.deepEqual(result.guidance.dimensionAdjustments, []);
  assert.equal(result.guidance.baseline.direction, "insufficient-evidence");
  assert.match(result.guidance.seedHint, /^lab-seed-[0-9a-f]{40}$/);
  assert.ok(verifySearchGuidanceMarker(result.guidance).ok);
});

test("guidance: with-estimates over an empty state stays honest observed-evidence", () => {
  const result = deriveSearchGuidance({ records: [], tenant: testSubmission().tenant, mode: "with-estimates" });
  assert.ok(result.ok);
  assert.equal(result.guidance.epistemic, "observed-evidence");
});

test("guidance: observed-only mode never consumes the folded estimates (marker honesty)", () => {
  const record = recordOf(testSubmission());
  const result = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  assert.ok(result.ok);
  const guidance = result.guidance as ObservedEvidenceGuidance;
  assert.equal(guidance.epistemic, "observed-evidence");
  assert.equal("method" in guidance, false);
  assert.equal("basis" in guidance, false);
  assert.equal("estimateSupport" in guidance, false);
});

test("guidance: with-estimates over estimate-bearing records is labeled-estimate", () => {
  const record = recordOf(testSubmission());
  const result = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "with-estimates" });
  assert.ok(result.ok);
  const guidance = result.guidance as LabeledEstimateGuidance;
  assert.equal(guidance.epistemic, "labeled-estimate");
  assert.equal(guidance.method, "simulation");
  assert.equal(guidance.basis, String(guidanceBasisDigestOf(record.evaluations)));
  assert.ok(guidance.estimateSupport.length > 0);
  assert.ok(guidance.estimateSupport.every((support) => support.estimatedCompletedWork > 0));
});

test("guidance: the two epistemic classes are structurally disjoint (E11)", () => {
  const record = recordOf(testSubmission());
  const observed = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  const estimate = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "with-estimates" });
  assert.ok(observed.ok && estimate.ok);
  const observedGuidance = observed.guidance as ObservedEvidenceGuidance;
  const estimateGuidance = estimate.guidance as LabeledEstimateGuidance;
  // @ts-expect-error — a labeled-estimate guidance is NOT assignable to the
  // observed-evidence class (disjoint marker literals, estimate-only fields).
  const forged: ObservedEvidenceGuidance = estimateGuidance;
  // @ts-expect-error — and vice versa.
  const inverse: LabeledEstimateGuidance = observedGuidance;
  assert.equal(forged.epistemic, "labeled-estimate");
  assert.equal(inverse.epistemic, "observed-evidence");
  assert.notEqual(String(observedGuidance.digest), String(estimateGuidance.digest));
});

test("guidance: preferred values rank by observed affinity, ties by value asc", () => {
  const first = recordOf(testSubmission());
  const second = recordOf(secondSubmission());
  const result = deriveSearchGuidance({ records: [first, second], tenant: first.tenant, mode: "observed-only" });
  assert.ok(result.ok);
  const agents = result.guidance.dimensionAdjustments.find((adjustment) => adjustment.dimension === "agents");
  assert.ok(agents);
  // Cycle 2's agentCount=2 co-occurred with 2 outcomes; test cycle's =3 with 1.
  assert.deepEqual(agents.preferredValues, ["2", "3"]);
  assert.ok(agents.observationIds.length > 0);
  assert.ok(agents.recordIds.length === 2);
});

test("guidance: estimate support re-ranks equal-count values by estimated work", () => {
  const base = testSubmission();
  // Two candidates of one cycle, one outcome each: EQUAL observed affinity
  // for agents=3 (team org) and agents=2 (generalist org); only their
  // estimated completed work differs (9 vs 3).
  const teamCandidate = testSearchResult({ blueprint: testBlueprint({ agentCount: 3 }) });
  const generalistCandidate = testSearchResult({
    position: 2,
    spaceIndex: 2,
    organization: labFixtureGeneralistOrganization(),
    blueprint: testBlueprint({ agentCount: 2 }),
  });
  const submission = {
    ...base,
    searchResults: [teamCandidate, generalistCandidate],
    evaluations: [
      testRun({ completedWork: 9, evaluationId: "lab-eval-team-1" }),
      testRun({ completedWork: 3, evaluationId: "lab-eval-generalist-1", organization: String(labFixtureGeneralistOrganization().id) }),
    ],
  };
  const record = recordOf(submission);
  const observed = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  const estimate = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "with-estimates" });
  assert.ok(observed.ok && estimate.ok);
  const observedAgents = observed.guidance.dimensionAdjustments.find((adjustment) => adjustment.dimension === "agents")!;
  const estimateAgents = (estimate.guidance as LabeledEstimateGuidance).dimensionAdjustments.find((adjustment) => adjustment.dimension === "agents")!;
  // Observed tie -> value asc; estimate tie-break -> estimated work desc.
  assert.deepEqual(observedAgents.preferredValues, ["2", "3"]);
  assert.deepEqual(estimateAgents.preferredValues, ["3", "2"]);
  const support = (estimate.guidance as LabeledEstimateGuidance).estimateSupport.find((entry) => entry.dimension === "agents" && entry.value === "3");
  assert.ok(support);
  assert.equal(support.estimatedCompletedWork, 9);
});

test("guidance: the baseline note promotes the generalist when it carries at least as much evidence", () => {
  const base = testSubmission();
  const baselineOnly = { ...base, searchResults: [{ ...testSearchResult(), isBaseline: true, blueprint: undefined, position: 0, spaceIndex: 0 }] };
  const record = recordOf(baselineOnly);
  const result = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  assert.ok(result.ok);
  assert.equal(result.guidance.baseline.direction, "promote-baseline");
  assert.deepEqual(result.guidance.baseline.evidence, [record.recordId]);
});

test("guidance: the baseline note explores beyond the baseline when others carry more", () => {
  const record = recordOf(testSubmission());
  const result = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  assert.ok(result.ok);
  assert.equal(result.guidance.baseline.direction, "explore-beyond-baseline");
});

test("guidance: mixed estimate methods are a typed refusal (incoherent basis, E11)", () => {
  const base = testSubmission();
  const record = recordOf({ ...base, evaluations: [testRun(), testRun({ method: "analytical-model", evaluationId: "lab-eval-mixed-2" })] });
  const result = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "with-estimates" });
  assert.ok(!result.ok);
  assert.equal(result.code, "estimate-method-mixed");
  assert.ok(result.detail.includes("analytical-model"));
});

test("guidance: an invalid mode is a typed refusal", () => {
  const result = deriveSearchGuidance({ records: [], tenant: testSubmission().tenant, mode: "sometimes" as never });
  assert.ok(!result.ok);
  assert.equal(result.code, "invalid-mode");
});

test("guidance: the seed hint is a deterministic function of the state (E9)", () => {
  const record = recordOf(testSubmission());
  const first = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  const again = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  assert.ok(first.ok && again.ok);
  assert.equal(first.guidance.seedHint, again.guidance.seedHint);
  const grown = deriveSearchGuidance({
    records: [record, recordOf(secondSubmission())],
    tenant: record.tenant,
    mode: "observed-only",
  });
  assert.ok(grown.ok);
  assert.notEqual(grown.guidance.seedHint, first.guidance.seedHint);
});

test("guidance: verify accepts freshly derived guidance of both classes", () => {
  const record = recordOf(testSubmission());
  for (const mode of ["observed-only", "with-estimates"] as const) {
    const derived = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode });
    assert.ok(derived.ok);
    const verification = verifySearchGuidanceMarker(derived.guidance);
    assert.ok(verification.ok);
  }
});

test("guidance: a stripped marker (estimate re-labeled observed) is refused (E11)", () => {
  const record = recordOf(testSubmission());
  const derived = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "with-estimates" });
  assert.ok(derived.ok);
  const stripped = { ...derived.guidance, epistemic: "observed-evidence" as const };
  const verification = verifySearchGuidanceMarker(stripped);
  assert.ok(!verification.ok);
  assert.equal(verification.code, "guidance-marker-forged");
});

test("guidance: a forged marker (observed re-labeled estimate) is refused (E11)", () => {
  const record = recordOf(testSubmission());
  const derived = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  assert.ok(derived.ok);
  const forged = { ...derived.guidance, epistemic: "labeled-estimate" as const };
  const verification = verifySearchGuidanceMarker(forged);
  assert.ok(!verification.ok);
  assert.equal(verification.code, "guidance-marker-forged");
  assert.ok(verification.detail.includes("estimate method") || verification.detail.includes("digest"));
});

test("guidance: tampered guidance content breaks the digest (E8)", () => {
  const record = recordOf(testSubmission());
  const derived = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  assert.ok(derived.ok);
  const tampered = { ...derived.guidance, cycleCount: 99 };
  const verification = verifySearchGuidanceMarker(tampered);
  assert.ok(!verification.ok);
  assert.equal(verification.code, "guidance-marker-forged");
  assert.ok(verification.detail.includes("digest"));
});

test("guidance: estimate fields on observed guidance are refused; unknown markers are refused", () => {
  const record = recordOf(testSubmission());
  const derived = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  assert.ok(derived.ok);
  const carrying = { ...derived.guidance, method: "simulation" as const };
  const withMethod = verifySearchGuidanceMarker(carrying);
  assert.ok(!withMethod.ok && withMethod.code === "guidance-marker-forged");
  assert.ok(withMethod.detail.includes("estimate fields"));
  const unknown = verifySearchGuidanceMarker({ ...derived.guidance, epistemic: "wild-guess" as never });
  assert.ok(!unknown.ok && unknown.code === "guidance-marker-forged");
  assert.ok(unknown.detail.includes("unknown epistemic marker"));
});

test("guidance: the structural guards accept only their own class", () => {
  const record = recordOf(testSubmission());
  const observed = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  const estimate = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "with-estimates" });
  assert.ok(observed.ok && estimate.ok);
  assert.ok(asObservedEvidenceGuidance(observed.guidance));
  assert.equal(asObservedEvidenceGuidance(estimate.guidance), undefined);
  assert.ok(asLabeledEstimateGuidance(estimate.guidance));
  assert.equal(asLabeledEstimateGuidance(observed.guidance), undefined);
  assert.equal(asObservedEvidenceGuidance({}), undefined);
  assert.equal(asLabeledEstimateGuidance(null), undefined);
});

test("guidance: guidance derives only from the learning state (no artifacts leak)", () => {
  const record = recordOf(cycleSubmission("cycle-lab-learning-guidance-1", 1));
  const other = recordOf(cycleSubmission("cycle-lab-learning-guidance-2", 2));
  const only = deriveSearchGuidance({ records: [record], tenant: record.tenant, mode: "observed-only" });
  const both = deriveSearchGuidance({ records: [record, other], tenant: record.tenant, mode: "observed-only" });
  assert.ok(only.ok && both.ok);
  assert.deepEqual(only.guidance.derivedFromRecords, [record.recordId]);
  assert.deepEqual(both.guidance.derivedFromRecords, [record.recordId, other.recordId]);
  assert.notEqual(only.guidance.digest, both.guidance.digest);
});
