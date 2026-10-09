/**
 * Achievements service tests: the full pipeline over fakes — definition
 * registration, evidence application through predicates, award-once
 * semantics with recorded receipts (E10), progression queries, and
 * snapshot/restore.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { AchievementsService } from "./service.ts";
import {
  FAKE_ACHIEVEMENT_EVENT_KINDS,
  achievementsAdminGrant,
  achievementsSubmitGrant,
  createFixedClock,
  createMemoryAchievementsStore,
  createMemoryGrantDirectory,
} from "./fakes.ts";
import {
  asAchievementId,
  asContentDigest,
  asGameEventKind,
  asSubjectId,
  asTenantId,
  asTimestampMs,
} from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const admin = asSubjectId("admin-service")!;
const subject = asSubjectId("player-one")!;
const winsAchievement = asAchievementId("wins-ten")!;
const playedAchievement = asAchievementId("played-hundred")!;
const wonKind = asGameEventKind(FAKE_ACHIEVEMENT_EVENT_KINDS.matchWon)!;
const playedKind = asGameEventKind(FAKE_ACHIEVEMENT_EVENT_KINDS.matchPlayed)!;

function makeService() {
  const store = createMemoryAchievementsStore();
  const clock = createFixedClock();
  const grants = createMemoryGrantDirectory();
  grants.grant(achievementsAdminGrant(tenant, admin));
  const service = new AchievementsService({ store: store.store, clock: clock.clock, grants: grants.grantsDirectory });
  const registeredWins = service.registerDefinition(
    admin,
    { tenant, achievementId: winsAchievement, metric: "wins", threshold: 3, visibility: "public", progression: "event" },
    [{ capability: "achievements", eventKind: wonKind, achievement: winsAchievement, increment: 1 }],
  );
  assert.ok(registeredWins.ok);
  const registeredPlayed = service.registerDefinition(
    admin,
    { tenant, achievementId: playedAchievement, metric: "matches", threshold: 100, visibility: "social", progression: "metric" },
    [{ capability: "achievements", eventKind: playedKind, achievement: playedAchievement, increment: 5 }],
  );
  assert.ok(registeredPlayed.ok);
  return { store, clock, grants, service };
}

function evidence(digestText: string, observedAt: number, kind = wonKind) {
  return {
    tenant,
    subject,
    eventKind: kind,
    digest: asContentDigest(digestText)!,
    observedAt: asTimestampMs(observedAt)!,
  };
}

test("service: evidence advances the achievement its event kind is bound to", () => {
  const { service } = makeService();
  const wins = service.applyEvidence(admin, evidence("a".repeat(64), 1_000));
  assert.ok(wins.accepted);
  assert.equal(wins.outcomes.length, 1);
  const winsOutcome = wins.outcomes[0]!;
  assert.ok(winsOutcome.applied && winsOutcome.progress.current === 1);
  const played = service.applyEvidence(admin, evidence("b".repeat(64), 2_000, playedKind));
  assert.ok(played.accepted);
  const playedOutcome = played.outcomes[0]!;
  assert.ok(playedOutcome.applied && playedOutcome.progress.current === 5);
  assert.equal(String(playedOutcome.achievement), "played-hundred");
});

test("service: unbound events apply to nothing", () => {
  const { service } = makeService();
  const other = asGameEventKind("match.abandoned")!;
  const result = service.applyEvidence(admin, evidence("a".repeat(64), 1_000, other));
  assert.ok(!result.accepted);
  assert.equal(result.outcomes.length, 0);
});

test("service: the award fires once at the boundary; replays return the recorded award (E10)", () => {
  const { service } = makeService();
  for (const digestText of ["a", "b"]) {
    service.applyEvidence(admin, evidence(digestText.repeat(64), 1_000));
  }
  const crossing = service.applyEvidence(admin, evidence("c".repeat(64), 3_000));
  const awardOutcome = crossing.outcomes.find((outcome) => String(outcome.achievement) === "wins-ten");
  const award = awardOutcome !== undefined && awardOutcome.applied ? awardOutcome.award : undefined;
  assert.ok(award !== undefined);
  assert.equal(service.awardsOf(tenant, subject).length, 1);
  const replay = service.applyEvidence(admin, evidence("c".repeat(64), 3_000));
  const replayOutcome = replay.outcomes.find((outcome) => String(outcome.achievement) === "wins-ten");
  assert.ok(replayOutcome !== undefined && !replayOutcome.applied);
  assert.equal(replayOutcome.code, "duplicate-evidence");
  assert.ok(replayOutcome.recorded !== undefined);
  assert.equal(replayOutcome.recorded.awardId, award.awardId);
  // Exactly one award ever: no second mutation.
  assert.equal(service.awardsOf(tenant, subject).length, 1);
});

test("service: unlocked progression stays unlocked under later evidence", () => {
  const { service } = makeService();
  for (const digestText of ["a", "b", "c"]) {
    service.applyEvidence(admin, evidence(digestText.repeat(64), 1_000));
  }
  const later = service.applyEvidence(admin, evidence("d".repeat(64), 4_000));
  const wins = later.outcomes.find((outcome) => String(outcome.achievement) === "wins-ten");
  assert.ok(wins && wins.applied);
  assert.ok(wins.progress.unlocked && !wins.justUnlocked);
  assert.equal(wins.award, undefined);
});

test("service: the query page uses the platform-contracts shapes", () => {
  const { service } = makeService();
  for (const digestText of ["a", "b", "c"]) {
    service.applyEvidence(admin, evidence(digestText.repeat(64), 1_000));
  }
  service.applyEvidence(admin, evidence("d".repeat(64), 2_000, playedKind));
  const all = service.query(admin, { tenant, subject, unlockedOnly: false });
  assert.ok("progress" in all);
  assert.equal(all.progress.length, 2);
  assert.deepEqual(
    all.progress.map((record) => String(record.achievement)).sort(),
    ["played-hundred", "wins-ten"],
  );
  const unlockedOnly = service.query(admin, { tenant, subject, unlockedOnly: true });
  assert.ok("progress" in unlockedOnly);
  assert.equal(unlockedOnly.progress.length, 1);
  const record = unlockedOnly.progress[0]!;
  assert.equal(record.unlockedBy, "platform-authority");
  assert.equal(record.subject, subject);
});

test("service: bindings must target the registered achievement", () => {
  const { service } = makeService();
  const mismatched = service.registerDefinition(
    admin,
    { tenant, achievementId: asAchievementId("another-one")!, metric: "wins", threshold: 1, visibility: "public", progression: "event" },
    [{ capability: "achievements", eventKind: wonKind, achievement: winsAchievement, increment: 1 }],
  );
  assert.ok(!mismatched.ok && mismatched.code === "binding-achievement-mismatch");
});

test("service: submit grants are required to apply evidence (R20)", () => {
  const { grants, service } = makeService();
  const submitter = asSubjectId("game-service")!;
  grants.grant(achievementsSubmitGrant(tenant, submitter));
  assert.ok(service.applyEvidence(submitter, evidence("a".repeat(64), 1_000)).accepted);
  grants.revokeAll();
  const refused = service.applyEvidence(submitter, evidence("b".repeat(64), 2_000));
  assert.ok(!refused.accepted && refused.code === "capability-not-granted");
});

test("service: snapshot and restore round-trip definitions, progress and awards", () => {
  const { store, service } = makeService();
  for (const digestText of ["a", "b", "c"]) {
    service.applyEvidence(admin, evidence(digestText.repeat(64), 1_000));
  }
  const snapshot = service.snapshot();
  assert.ok(snapshot.ok);
  const grants = createMemoryGrantDirectory();
  grants.grant(achievementsAdminGrant(tenant, admin));
  const resumed = new AchievementsService({ store: store.store, clock: createFixedClock(9_999).clock, grants: grants.grantsDirectory });
  const restored = resumed.restore();
  assert.ok(restored.ok);
  assert.equal(resumed.awardsOf(tenant, subject).length, 1);
  const replay = resumed.applyEvidence(admin, evidence("c".repeat(64), 3_000));
  const replayOutcome = replay.outcomes.find((outcome) => String(outcome.achievement) === "wins-ten");
  assert.ok(replayOutcome !== undefined && !replayOutcome.applied && replayOutcome.code === "duplicate-evidence");
  assert.ok(replayOutcome.recorded !== undefined);
});

test("service: malformed evidence is refused structurally", () => {
  const { service } = makeService();
  const malformed = service.applyEvidence(admin, { tenant, subject, eventKind: wonKind, digest: "nope" as never, observedAt: asTimestampMs(1_000)! });
  assert.ok(!malformed.accepted && malformed.code === "malformed-evidence");
  const empty = service.restore();
  const snap = service.snapshot();
  assert.ok(snap.ok);
  assert.ok(empty.ok === false && empty.code === "unknown-snapshot");
});

test("service: awards log is append-only and returns copies (E10)", () => {
  const { service } = makeService();
  for (const digestText of ["a", "b", "c"]) {
    service.applyEvidence(admin, evidence(digestText.repeat(64), 1_000));
  }
  const awards = service.awardsOf(tenant, subject);
  assert.equal(awards.length, 1);
  (awards[0]! as { decidedBy: string }).decidedBy = "tampered";
  assert.equal(service.awardsOf(tenant, subject)[0]!.decidedBy, "platform-authority");
});
