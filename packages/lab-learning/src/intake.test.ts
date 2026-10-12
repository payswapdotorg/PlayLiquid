/**
 * INTAKE TESTS (PL-030) — the learning-cycle admission oracle: structural
 * folds, the E10 content-addressed identity, duplicate receipts,
 * conflicting re-learns, forward-only sequencing and the E11 estimate-label
 * discipline at the trust boundary.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObservedOutcomeRecord } from "@playliquid/lab-contracts";
import { asLabCycleId, asObservationId, asTimestampMs } from "@playliquid/lab-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { labFixtureTeamOrganization } from "@playliquid/lab-simulation";
import type { LabEvaluationRunRecord } from "@playliquid/lab-simulation";
import { admitLearningCycle, foldSubmission } from "./intake.ts";
import type { LearningIntakeKnownState } from "./intake.ts";
import {
  cycleSubmission,
  secondSubmission,
  testBlueprint,
  testGapRecord,
  testLedger,
  testRun,
  testSearchResult,
  testSubmission,
} from "./testkit.ts";

function admit(submission: ReturnType<typeof testSubmission>, known: LearningIntakeKnownState = { records: [] }) {
  return admitLearningCycle(submission, known);
}

test("intake: a valid submission folds into a sealed, content-addressed record", () => {
  const result = admit(testSubmission());
  assert.ok(result.ok);
  assert.equal(result.duplicate, false);
  assert.ok(result.record.recordId.startsWith("lab-learn-"));
  assert.match(result.record.identityDigest, /^[0-9a-f]{64}$/);
  assert.equal(result.record.outcomes.length, 1);
  assert.equal(result.record.conclusions.length, 1);
  assert.equal(result.record.evaluations.length, 1);
  assert.equal(result.record.searchResults.length, 1);
  assert.equal(result.record.gaps.length, 1);
  assert.ok(Object.isFrozen(result.record));
  assert.ok(Object.isFrozen(result.record.outcomes));
});

test("intake: identical content derives the identical record id (E10 receipt, never a second copy)", () => {
  const first = admit(testSubmission());
  const second = admit(testSubmission(), { records: first.ok ? [first.record] : [] });
  assert.ok(first.ok && second.ok);
  assert.equal(second.duplicate, true);
  assert.equal(second.record.recordId, first.record.recordId);
  assert.equal(second.record, first.record);
});

test("intake: bookkeeping (owner, learnedAt) is excluded from the identity", () => {
  const first = admit(testSubmission());
  const otherOwner = testSubmission({ owner: asSubjectId("subject-lab-learning-other")!, learnedAt: asTimestampMs(9_999)! });
  const second = admit(otherOwner, { records: first.ok ? [first.record] : [] });
  assert.ok(first.ok && second.ok);
  assert.equal(second.duplicate, true);
  assert.equal(second.record.recordId, first.record.recordId);
});

test("intake: a different owner of a different tenant is different content (and both are valid)", () => {
  const mine = admit(testSubmission());
  const otherTenant = asTenantId("tenant-lab-learning-other")!;
  const theirs = admit(testSubmission({
    tenant: otherTenant,
    evaluations: [testRun({ tenant: otherTenant })],
  }));
  assert.ok(mine.ok && theirs.ok);
  assert.notEqual(theirs.record.recordId, mine.record.recordId);
});

test("intake: the same cycle re-learned with different content is refused (E10: no rewrite)", () => {
  const first = admit(testSubmission());
  assert.ok(first.ok);
  const conflicting = admit(testSubmission({ searchResults: [] }), { records: [first.record] });
  assert.ok(!conflicting.ok && conflicting.code === "conflicting-cycle-content");
  assert.ok(conflicting.detail.includes("immutable"));
});

test("intake: sequences only move forward (non-monotonic refusal, E8)", () => {
  const first = admit(testSubmission());
  assert.ok(first.ok);
  const stalled = admit(cycleSubmission("cycle-lab-learning-test-2", 1), { records: [first.record] });
  assert.ok(!stalled.ok && stalled.code === "non-monotonic-cycle-order");
  const second = admit(secondSubmission(), { records: [first.record] });
  assert.ok(second.ok);
  const regressed = admit(cycleSubmission("cycle-lab-learning-test-3", 2), {
    records: [first.record, second.record],
  });
  assert.ok(!regressed.ok && regressed.code === "non-monotonic-cycle-order");
});

test("intake: a submission without artifacts is refused (nothing to learn)", () => {
  const empty = admit(
    testSubmission({ observations: { observations: [], conclusions: [] }, evaluations: [], searchResults: [], gaps: [] }),
  );
  assert.ok(!empty.ok && empty.code === "empty-cycle-fold");
});

test("intake: observations must carry the observed-evidence marker (E11)", () => {
  const forged: ObservedOutcomeRecord = {
    ...testLedger().ledger().observations[0]!,
    epistemic: "labeled-estimate" as never,
  };
  const result = admit(testSubmission({ observations: { observations: [forged], conclusions: [] } }));
  assert.ok(!result.ok && result.code === "observation-not-observed-evidence");
});

test("intake: malformed observations are refused (E8)", () => {
  const observation = testLedger().ledger().observations[0]!;
  for (const broken of [
    { ...observation, contentDigest: "not-hex" as never },
    { ...observation, summary: "" },
    { ...observation, observedAt: -1 as never },
    { ...observation, observationId: "bad id!" as never },
  ]) {
    const result = admit(testSubmission({ observations: { observations: [broken as ObservedOutcomeRecord], conclusions: [] } }));
    assert.ok(!result.ok && result.code === "invalid-observation", JSON.stringify(broken));
  }
});

test("intake: conclusions citing un-folded observations are refused", () => {
  const ledger = testLedger().ledger();
  const conclusion = {
    ...ledger.conclusions[0]!,
    derivedFrom: Object.freeze([asObservationId("observation-never-recorded")!]),
  };
  const result = admit(testSubmission({ observations: { observations: [...ledger.observations], conclusions: [conclusion] } }));
  assert.ok(!result.ok && result.code === "unknown-observation-reference");
});

test("intake: only the submitted cycle's observations and conclusions fold", () => {
  const mine = testLedger();
  const other = testLedger(asLabCycleId("cycle-lab-learning-test-other")!);
  const submission = testSubmission({
    observations: {
      observations: [...mine.ledger().observations, ...other.ledger().observations],
      conclusions: [...mine.ledger().conclusions, ...other.ledger().conclusions],
    },
  });
  const result = admit(submission);
  assert.ok(result.ok);
  assert.equal(result.record.outcomes.length, 1);
  assert.equal(result.record.conclusions.length, 1);
});

test("intake: a stripped estimate label is refused (E11, lock 28/29)", () => {
  const run = testRun();
  const stripped = { ...run, result: { ...run.result, epistemic: undefined } } as unknown as LabEvaluationRunRecord;
  const result = admit(testSubmission({ evaluations: [stripped] }));
  assert.ok(!result.ok && result.code === "estimate-label-missing");
  assert.ok(result.detail.includes("E11"));
});

test("intake: an observation-marked (forged) estimate is refused (E11)", () => {
  const run = testRun();
  const forged = { ...run, result: { ...run.result, epistemic: "observed-evidence" as never } } as LabEvaluationRunRecord;
  const result = admit(testSubmission({ evaluations: [forged] }));
  assert.ok(!result.ok && result.code === "estimate-label-missing");
});

test("intake: evaluations of another tenant are refused (R20 smuggling)", () => {
  const foreignRun = testRun();
  const foreign = { ...foreignRun, tenant: asTenantId("tenant-lab-learning-other")! } as LabEvaluationRunRecord;
  const result = admit(testSubmission({ evaluations: [foreign] }));
  assert.ok(!result.ok && result.code === "cross-tenant");
});

test("intake: evaluations of another cycle are refused", () => {
  const foreign = testRun({ cycleId: "cycle-lab-learning-test-other" });
  const result = admit(testSubmission({ evaluations: [foreign] }));
  assert.ok(!result.ok && result.code === "evaluation-cycle-mismatch");
});

test("intake: malformed search results are refused (E8)", () => {
  const candidate = testSearchResult();
  for (const broken of [
    { ...candidate, contentDigest: "nope" as never },
    { ...candidate, position: -1 },
    { ...candidate, organization: { broken: true } as never },
    { ...candidate, blueprint: { agentCount: "three" } as never },
  ]) {
    const result = admit(testSubmission({ searchResults: [broken as never] }));
    assert.ok(!result.ok && result.code === "invalid-search-result");
  }
});

test("intake: gap records failing the lab-contracts validator are refused", () => {
  const skipped = testGapRecord("gap-test-skip", undefined, [
    { rung: "arena-escalation", disposition: "attempted", outcome: "unresolved" } as never,
  ]);
  const result = admit(testSubmission({ gaps: [skipped] }));
  assert.ok(!result.ok && result.code === "gap-record-invalid");
});

test("intake: identity is over folded content — blueprint variety changes the id", () => {
  const first = admit(testSubmission());
  const varied = admit(
    testSubmission({ searchResults: [testSearchResult({ blueprint: testBlueprint({ agentCount: 1 }) })] }),
  );
  assert.ok(first.ok && varied.ok);
  assert.notEqual(varied.record.recordId, first.record.recordId);
});

test("intake: the caller's ledger is never referenced (deep fold, E10)", () => {
  const ledger = testLedger();
  const submission = testSubmission({ observations: ledger.ledger() });
  const result = admit(submission);
  assert.ok(result.ok);
  const extra: ObservedOutcomeRecord = {
    ...ledger.ledger().observations[0]!,
    observationId: "observation-late-1" as never,
    cycleId: asLabCycleId("cycle-lab-learning-test-late")!,
  };
  ledger.appendObservation(extra);
  assert.equal(result.record.outcomes.length, 1);
  const second = foldSubmission({
    ...submission,
    observations: { observations: ledger.ledger().observations, conclusions: ledger.ledger().conclusions },
  });
  assert.ok(second.ok);
  assert.equal(second.content.outcomes.length, 1);
});

test("intake: statistics are folded as the plain-number read model", () => {
  const result = admit(testSubmission({ evaluations: [testRun({ completedWork: 7 })] }));
  assert.ok(result.ok);
  assert.equal(result.record.evaluations[0]!.statistics.completedWork, 7);
  assert.equal(result.record.evaluations[0]!.method, "simulation");
  assert.deepEqual(result.record.evaluations[0]!.metricKinds, [
    { metricId: "lab-metric-completed-work", kind: "int" },
  ]);
  assert.ok(Object.isFrozen(result.record.evaluations[0]!.metricKinds));
});

test("intake: the generalist-baseline search result folds without a blueprint", () => {
  const baseline = testSearchResult({ isBaseline: true, blueprint: undefined, position: 0, spaceIndex: 0, organization: labFixtureTeamOrganization() });
  const result = admit(testSubmission({ searchResults: [baseline] }));
  assert.ok(result.ok);
  assert.equal(result.record.searchResults[0]!.isBaseline, true);
});
