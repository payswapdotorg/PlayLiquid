/**
 * Progression fold tests: the platform-contracts `evaluateUnlock`
 * binding, award-once boundary semantics, duplicate-evidence
 * idempotency (E10), and the award record/authority-event shapes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEvidence, awardRecordId, authorityEventOfAward, isSubjectProgressState } from "./progress.ts";
import type { SubjectProgressState } from "./progress.ts";
import { asAchievementId, asContentDigest, asSubjectId, asTenantId, asTimestampMs } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const achievement = asAchievementId("wins-ten")!;
const digestA = asContentDigest("a".repeat(64))!;
const digestB = asContentDigest("b".repeat(64))!;
const digestC = asContentDigest("c".repeat(64))!;
const definition = { threshold: 3 };

function progress(over: Partial<SubjectProgressState> = {}): SubjectProgressState {
  return { tenant, subject, achievement, current: 0, unlocked: false, evidenceApplied: [], ...over };
}

test("progress: evidence accumulates and the unlock fires exactly at the boundary", () => {
  const first = applyEvidence(definition, { tenant, subject, achievement }, undefined, { digest: digestA, observedAt: asTimestampMs(1_000)! }, 1);
  assert.ok(first.applied);
  assert.equal(first.progress.current, 1);
  assert.ok(!first.justUnlocked && first.award === undefined);
  const second = applyEvidence(definition, { tenant, subject, achievement }, first.progress, { digest: digestB, observedAt: asTimestampMs(2_000)! }, 1);
  assert.ok(second.applied && !second.justUnlocked);
  const third = applyEvidence(definition, { tenant, subject, achievement }, second.progress, { digest: digestC, observedAt: asTimestampMs(3_000)! }, 1);
  assert.ok(third.applied && third.justUnlocked);
  assert.ok(third.award !== undefined);
  assert.equal(third.award.currentAtAward, 3);
  assert.equal(third.award.decidedBy, "platform-authority");
});

test("progress: a single large increment crosses the boundary once", () => {
  const result = applyEvidence(definition, { tenant, subject, achievement }, undefined, { digest: digestA, observedAt: asTimestampMs(1_000)! }, 5);
  assert.ok(result.applied && result.justUnlocked);
  assert.equal(result.progress.current, 5);
  assert.equal(result.progress.unlockedBy, "platform-authority");
  assert.equal(result.progress.unlockedAt, 1_000);
});

test("progress: unlocks never retract; later evidence never re-awards", () => {
  const unlocked = progress({ current: 3, unlocked: true, unlockedBy: "platform-authority", unlockedAt: asTimestampMs(1_000)!, evidenceApplied: [digestA] });
  const later = applyEvidence(definition, { tenant, subject, achievement }, unlocked, { digest: digestB, observedAt: asTimestampMs(2_000)! }, 1);
  assert.ok(later.applied);
  assert.ok(later.progress.unlocked);
  assert.ok(!later.justUnlocked && later.award === undefined);
  assert.equal(later.progress.current, 4);
});

test("progress: duplicate evidence digests are refused (E10)", () => {
  const first = applyEvidence(definition, { tenant, subject, achievement }, undefined, { digest: digestA, observedAt: asTimestampMs(1_000)! }, 1);
  assert.ok(first.applied);
  const replay = applyEvidence(definition, { tenant, subject, achievement }, first.progress, { digest: digestA, observedAt: asTimestampMs(9_000)! }, 1);
  assert.ok(!replay.applied && replay.code === "duplicate-evidence");
});

test("progress: invalid increments are refused", () => {
  const zero = applyEvidence(definition, { tenant, subject, achievement }, undefined, { digest: digestA, observedAt: asTimestampMs(1_000)! }, 0);
  assert.ok(!zero.applied && zero.code === "invalid-increment");
  const fractional = applyEvidence(definition, { tenant, subject, achievement }, undefined, { digest: digestA, observedAt: asTimestampMs(1_000)! }, 1.5);
  assert.ok(!fractional.applied && fractional.code === "invalid-increment");
});

test("progress: the structural guard enforces the authority marker (E8)", () => {
  const unlocked = progress({ unlocked: true, unlockedBy: "platform-authority" });
  assert.ok(isSubjectProgressState(unlocked));
  assert.ok(!isSubjectProgressState(progress({ unlocked: true, unlockedBy: undefined })));
  assert.ok(!isSubjectProgressState(progress({ unlocked: false, unlockedBy: "platform-authority" })));
  assert.ok(!isSubjectProgressState(progress({ current: -1 })));
  assert.ok(!isSubjectProgressState(progress({ current: 1.5 })));
});

test("progress: award ids are deterministic and authority events carry the frozen kind", () => {
  const id = awardRecordId(digestA, achievement);
  assert.equal(id, `${"a".repeat(64)}:wins-ten`);
  assert.equal(awardRecordId(digestB, achievement) === id, false);
  const event = authorityEventOfAward({
    awardId: id,
    tenant,
    subject,
    achievement,
    awardedAt: asTimestampMs(1_000)!,
    evidence: digestA,
    currentAtAward: 3,
    decidedBy: "platform-authority",
  });
  assert.equal(event.origin, "platform-authority");
  assert.equal(event.kind, "platform.achievement.unlocked");
  assert.equal(event.decidedBy, "platform-authority");
  assert.deepEqual(event.payload, { subject: "player-one", achievement: "wins-ten", currentAtAward: 3 });
});
