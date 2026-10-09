/**
 * Condition predicate + evidence tests: the structural guard, binding
 * predicates (match + increment), and the threshold folds.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applicablePredicates,
  conditionSatisfied,
  isAchievementEventEvidence,
  predicateForBinding,
  predicatesForBindings,
  progressAfter,
} from "./conditions.ts";
import type { AchievementEventEvidence } from "./conditions.ts";
import { asAchievementId, asContentDigest, asGameEventKind, asSubjectId, asTenantId, asTimestampMs } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const achievement = asAchievementId("wins-ten")!;
const wonKind = asGameEventKind("match.won")!;
const playedKind = asGameEventKind("match.played")!;

function evidence(over: Partial<AchievementEventEvidence> = {}): AchievementEventEvidence {
  return {
    tenant,
    subject,
    eventKind: wonKind,
    digest: asContentDigest("a".repeat(64))!,
    observedAt: asTimestampMs(1_000)!,
    ...over,
  };
}

test("conditions: the structural guard validates evidence", () => {
  assert.ok(isAchievementEventEvidence(evidence()));
  assert.ok(!isAchievementEventEvidence(evidence({ digest: "not-a-digest" as never })));
  assert.ok(!isAchievementEventEvidence(evidence({ observedAt: -1 as never })));
  assert.ok(!isAchievementEventEvidence(evidence({ observedAt: 1.5 as never })));
  assert.ok(!isAchievementEventEvidence(evidence({ subject: "" as never })));
  assert.ok(!isAchievementEventEvidence(null));
  assert.ok(!isAchievementEventEvidence("nope"));
});

test("conditions: a binding predicate matches its event kind and carries its increment", () => {
  const predicate = predicateForBinding({ capability: "achievements", eventKind: wonKind, achievement, increment: 2 });
  assert.equal(predicate.achievement, achievement);
  assert.ok(predicate.matches(evidence()));
  assert.equal(predicate.incrementOf(evidence()), 2);
  const other = evidence({ eventKind: playedKind });
  assert.ok(!predicate.matches(other));
  assert.equal(predicate.incrementOf(other), undefined);
});

test("conditions: predicate sets filter down to the applicable ones", () => {
  const predicates = predicatesForBindings([
    { capability: "achievements", eventKind: wonKind, achievement, increment: 1 },
    { capability: "achievements", eventKind: playedKind, achievement: asAchievementId("played-hundred")!, increment: 1 },
  ]);
  const applicable = applicablePredicates(predicates, evidence());
  assert.equal(applicable.length, 1);
  assert.equal(applicable[0]!.achievement, achievement);
  assert.equal(applicablePredicates(predicates, evidence({ eventKind: playedKind })).length, 1);
});

test("conditions: progress folds are monotonic and thresholds are pure comparisons", () => {
  assert.equal(progressAfter(0, 3), 3);
  assert.equal(progressAfter(3, 4), 7);
  assert.ok(!conditionSatisfied({ threshold: 10 }, 9));
  assert.ok(conditionSatisfied({ threshold: 10 }, 10));
  assert.ok(conditionSatisfied({ threshold: 10 }, 11));
});
