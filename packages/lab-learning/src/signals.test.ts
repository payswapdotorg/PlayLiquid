/**
 * SIGNAL TESTS (PL-030) — the deterministic learning-signal fold (E9):
 * content-derived enumeration order, dimension-level outcome affinities,
 * the empty state, and the PINNED alignment of the frozen dimension
 * vocabulary with lab-organization's real computed candidate-space axes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asAgentRoleId, asCapabilityId, asZCodeModelRouteId } from "@playliquid/lab-contracts";
import { canonicalizeBounds, computeSpace } from "@playliquid/lab-organization";
import { admitLearningCycle } from "./intake.ts";
import { LAB_DIMENSIONS, blueprintDimensions, deriveLabLearningSignals, isLabDimension } from "./signals.ts";
import { secondSubmission, testBlueprint, testSubmission } from "./testkit.ts";

function recordOf(submission: ReturnType<typeof testSubmission>) {
  const admitted = admitLearningCycle(submission, { records: [] });
  assert.ok(admitted.ok);
  return admitted.record;
}

test("signals: the empty state is a typed empty fold, never an exception", () => {
  const signals = deriveLabLearningSignals([], testSubmission().tenant);
  assert.equal(signals.recordCount, 0);
  assert.equal(signals.cycleIds.length, 0);
  assert.equal(signals.firstSequence, 0);
  assert.equal(signals.lastSequence, 0);
  assert.equal(signals.observationCount, 0);
  assert.equal(signals.affinities.length, 0);
  assert.equal(signals.gaps.length, 0);
  assert.match(signals.stateDigest, /^[0-9a-f]{64}$/);
});

test("signals: one cycle derives one affinity per blueprint dimension", () => {
  const record = recordOf(testSubmission());
  const signals = deriveLabLearningSignals([record], record.tenant);
  assert.equal(signals.recordCount, 1);
  assert.equal(signals.cycleIds.length, 1);
  assert.equal(signals.observationCount, 1);
  assert.equal(signals.conclusionCount, 1);
  assert.equal(signals.evaluationCount, 1);
  assert.equal(signals.searchResultCount, 1);
  assert.equal(signals.baselineResultCount, 0);
  assert.equal(signals.affinities.length, LAB_DIMENSIONS.length);
  for (const affinity of signals.affinities) {
    assert.equal(affinity.coOccurrences, 1);
    assert.deepEqual(affinity.observationIds, ["observation-test-1"]);
    assert.equal(affinity.outcomeDigests.length, 1);
    assert.deepEqual(affinity.cycleIds, [String(record.cycleId)]);
  }
});

test("signals: affinities enumerate in (dimension, value) content order (E9)", () => {
  const record = recordOf(testSubmission());
  const signals = deriveLabLearningSignals([record], record.tenant);
  const keys = signals.affinities.map((affinity) => `${affinity.dimension}:${affinity.value}`);
  const sorted = [...keys].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(keys, sorted);
  // The blueprint's own values are the folded ones.
  const expected = blueprintDimensions(testBlueprint()).map(({ dimension, value }) => `${dimension}:${value}`).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(keys, expected);
});

test("signals: identical records derive byte-identical signals (E9 determinism)", () => {
  const first = recordOf(testSubmission());
  const second = recordOf(secondSubmission());
  const a = deriveLabLearningSignals([first, second], first.tenant);
  const b = deriveLabLearningSignals([first, second], first.tenant);
  assert.equal(String(a.stateDigest), String(b.stateDigest));
  assert.deepEqual(a, b);
});

test("signals: input order never changes the fold (content-derived enumeration, E9)", () => {
  const first = recordOf(testSubmission());
  const second = recordOf(secondSubmission());
  const forward = deriveLabLearningSignals([first, second], first.tenant);
  const reversed = deriveLabLearningSignals([second, first], first.tenant);
  assert.equal(String(forward.stateDigest), String(reversed.stateDigest));
  assert.deepEqual(forward.affinities, reversed.affinities);
});

test("signals: co-occurrences accumulate across cycles and candidates", () => {
  const first = recordOf(testSubmission());
  const second = recordOf(secondSubmission());
  const signals = deriveLabLearningSignals([first, second], first.tenant);
  assert.equal(signals.recordCount, 2);
  assert.equal(signals.cycleIds.length, 2);
  // Unique observation ids across the two cycles (both cycles share the
  // fixture id sequence: 1 + 2 distinct ids).
  assert.equal(signals.observationCount, 2);
  // Cycle 2 has one candidate (agentCount 2) x two outcomes -> co 2; the
  // agents dimension therefore carries both values with distinct counts.
  const agents = signals.affinities.filter((affinity) => affinity.dimension === "agents");
  const byValue = new Map(agents.map((affinity) => [affinity.value, affinity.coOccurrences]));
  assert.equal(byValue.get("3"), 1);
  assert.equal(byValue.get("2"), 2);
  assert.equal(signals.lastSequence, 2);
  assert.equal(signals.firstSequence, 1);
});

test("signals: baseline search results count but never gain affinities", () => {
  const admitted = admitLearningCycle(
    testSubmission({ searchResults: [{ ...testSubmission().searchResults[0]!, isBaseline: true, blueprint: undefined, position: 0, spaceIndex: 0 }] }),
    { records: [] },
  );
  assert.ok(admitted.ok);
  const signals = deriveLabLearningSignals([admitted.record], admitted.record.tenant);
  assert.equal(signals.baselineResultCount, 1);
  assert.equal(signals.affinities.length, 0);
});

test("signals: evaluation estimates never contribute to observed affinities (E11)", () => {
  const base = testSubmission();
  const extra = { ...base.evaluations[0]!, evaluationId: base.evaluations[0]!.evaluationId };
  const record = recordOf(testSubmission({ evaluations: [base.evaluations[0]!, extra] }));
  assert.equal(record.evaluations.length, 2);
  const signals = deriveLabLearningSignals([record], record.tenant);
  // Two evaluation estimates folded, yet the affinity mass stays exactly
  // dimensions x outcomes x candidates — estimates never feed the observed
  // signal (they live on the guidance module's estimate side, E11).
  assert.equal(signals.evaluationCount, 2);
  assert.equal(signals.affinities.reduce((total, affinity) => total + affinity.coOccurrences, 0), LAB_DIMENSIONS.length);
});

test("signals: LAB_DIMENSIONS is exactly lab-organization's real computed space axes (pinning)", () => {
  const bounds = canonicalizeBounds(
    {
      maxAgents: 2,
      roleVocabulary: [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!],
      bodyCatalog: [],
      modelCatalog: [{ authority: "zcode-model-routing", route: asZCodeModelRouteId("route-signals-a")! }],
      toolCatalog: [],
      capabilityVocabulary: [asCapabilityId("lab-cap-engineering")!],
    },
    () => undefined,
  );
  assert.ok(bounds.ok);
  const space = computeSpace(bounds.bounds);
  assert.ok(space.ok);
  assert.deepEqual(
    space.space.axes.map((axis) => axis.dimension),
    [...LAB_DIMENSIONS],
  );
  assert.equal(LAB_DIMENSIONS.length, 12);
});

test("signals: the state digest changes when the fold content changes", () => {
  const first = recordOf(testSubmission());
  const second = recordOf(secondSubmission());
  const one = deriveLabLearningSignals([first], first.tenant);
  const two = deriveLabLearningSignals([first, second], first.tenant);
  assert.notEqual(String(one.stateDigest), String(two.stateDigest));
});

test("signals: isLabDimension guards the frozen vocabulary", () => {
  assert.equal(isLabDimension("agents"), true);
  assert.equal(isLabDimension("review-structure"), true);
  assert.equal(isLabDimension("Agents"), false);
  assert.equal(isLabDimension("unknown-dimension"), false);
  assert.equal(isLabDimension(42), false);
  assert.equal(isLabDimension(undefined), false);
});
