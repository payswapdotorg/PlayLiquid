/**
 * GAP TESTS (PL-030, R18) — recurring capability-gap summaries classified
 * by the FROZEN lab-contracts ladder rung: recurrence counts across
 * cycles, reached rungs in ladder order, resolved/blocked terminal
 * markers, and the never-silently-skipped / never-auto-escalated
 * discipline (the fold only records and types).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { GAP_LADDER_RUNGS } from "@playliquid/lab-contracts";
import { admitLearningCycle } from "./intake.ts";
import { deriveGapLadderSummaries } from "./gaps.ts";
import { cycleSubmission, secondSubmission, testGapRecord, testSubmission } from "./testkit.ts";

function recordOf(submission: ReturnType<typeof testSubmission>) {
  const admitted = admitLearningCycle(submission, { records: [] });
  assert.ok(admitted.ok);
  return admitted.record;
}

test("gaps: one cycle yields one summary per missing capability", () => {
  const record = recordOf(testSubmission());
  const summaries = deriveGapLadderSummaries([record]);
  assert.equal(summaries.length, 1);
  const summary = summaries[0]!;
  assert.equal(summary.missingCapability, "lab-cap-engineering");
  assert.equal(summary.currentRung, "existing-organization");
  assert.deepEqual(summary.reachedRungs, ["existing-organization"]);
  assert.deepEqual(summary.rungAttemptCounts, [{ rung: "existing-organization", attempts: 1 }]);
  assert.equal(summary.recurrenceCount, 1);
  assert.equal(summary.recurring, false);
  assert.equal(summary.resolved, false);
  assert.equal(summary.blocked, false);
  assert.equal(summary.gapIds.length, 1);
  assert.deepEqual(summary.cycleIds, [String(record.cycleId)]);
});

test("gaps: recurrence across distinct cycles is counted, never silently skipped (R18)", () => {
  const first = recordOf(testSubmission());
  const second = recordOf(secondSubmission());
  const summaries = deriveGapLadderSummaries([first, second]);
  // Different missingCapability per cycle? No — the testkit pins the same
  // capability, so the gap recurs across the two cycles.
  const summary = summaries.find((entry) => entry.missingCapability === "lab-cap-engineering");
  assert.ok(summary);
  assert.equal(summary.recurrenceCount, 2);
  assert.equal(summary.recurring, true);
  assert.equal(summary.gapIds.length, 2);
  assert.equal(summary.cycleIds.length, 2);
});

test("gaps: rung advancement across cycles aggregates into the furthest rung", () => {
  const walked = [
    { rung: "existing-organization" as const, disposition: "attempted" as const, outcome: "unresolved" as const },
    { rung: "alternate-organization" as const, disposition: "unavailable" as const, outcome: "unresolved" as const },
    { rung: "package-platform-capability" as const, disposition: "attempted" as const, outcome: "unresolved" as const },
  ];
  const first = recordOf(testSubmission());
  const later = recordOf(cycleSubmission("cycle-lab-learning-test-2", 2));
  const advanced: typeof later = { ...later, gaps: [testGapRecord("gap-advanced", later.cycleId, walked)] };
  const summaries = deriveGapLadderSummaries([first, advanced]);
  const summary = summaries.find((entry) => entry.missingCapability === "lab-cap-engineering");
  assert.ok(summary);
  assert.equal(summary.currentRung, "package-platform-capability");
  assert.deepEqual(summary.reachedRungs, ["existing-organization", "alternate-organization", "package-platform-capability"]);
  assert.deepEqual(summary.rungAttemptCounts, [
    { rung: "existing-organization", attempts: 2 },
    { rung: "alternate-organization", attempts: 1 },
    { rung: "package-platform-capability", attempts: 1 },
  ]);
});

test("gaps: a resolved attempt marks the summary resolved", () => {
  const resolved = [{ rung: "existing-organization" as const, disposition: "attempted" as const, outcome: "resolved" as const }];
  const record = recordOf(testSubmission({ gaps: [testGapRecord("gap-resolved", undefined, resolved)] }));
  const summaries = deriveGapLadderSummaries([record]);
  assert.equal(summaries[0]!.resolved, true);
  assert.equal(summaries[0]!.blocked, false);
});

test("gaps: the blocked terminal rung is typed, terminal and never escalated past", () => {
  const blocked = [
    { rung: "existing-organization" as const, disposition: "attempted" as const, outcome: "unresolved" as const },
    { rung: "alternate-organization" as const, disposition: "unavailable" as const, outcome: "unresolved" as const },
    { rung: "package-platform-capability" as const, disposition: "unavailable" as const, outcome: "unresolved" as const },
    { rung: "user-community-contribution" as const, disposition: "declined" as const },
    { rung: "arena-escalation" as const, disposition: "declined" as const },
    { rung: "blocked" as const, reason: "no resolution path within the current budget" },
  ];
  const record = recordOf(testSubmission({ gaps: [testGapRecord("gap-blocked", undefined, blocked)] }));
  const summaries = deriveGapLadderSummaries([record]);
  const summary = summaries[0]!;
  assert.equal(summary.blocked, true);
  assert.equal(summary.currentRung, "blocked");
  assert.deepEqual(summary.reachedRungs, [...GAP_LADDER_RUNGS]);
  assert.equal(summary.recurring, false);
});

test("gaps: distinct capabilities aggregate into distinct summaries (asc order)", () => {
  const first = recordOf(testSubmission());
  const other = recordOf(cycleSubmission("cycle-lab-learning-test-2", 2));
  const withOther: typeof other = { ...other, gaps: [{ ...testGapRecord("gap-other", other.cycleId), missingCapability: "lab-cap-aaa-other" }] };
  const summaries = deriveGapLadderSummaries([first, withOther]);
  assert.equal(summaries.length, 2);
  assert.deepEqual(
    summaries.map((summary) => summary.missingCapability),
    ["lab-cap-aaa-other", "lab-cap-engineering"],
  );
});

test("gaps: the fold never mutates the input records (pure aggregation)", () => {
  const first = recordOf(testSubmission());
  const frozenGaps = first.gaps;
  deriveGapLadderSummaries([first]);
  assert.equal(frozenGaps.length, 1);
  assert.ok(Object.isFrozen(frozenGaps));
});

test("gaps: the empty record set yields the empty summary list", () => {
  assert.deepEqual(deriveGapLadderSummaries([]), []);
});
