/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full achievements journey over the in-memory fakes:
 * register a definition + bindings -> apply evidence (progress grows,
 * award at the threshold boundary) -> replay evidence returns the
 * recorded award (E10) -> further progress never retracts the unlock
 * -> query the progression page (platform-contracts shapes) ->
 * snapshot/restore -> cross-tenant evidence refused (R20). Prints
 * deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no clock, no randomness,
 * no network.
 */

import { AchievementsService } from "./service.ts";
import {
  FAKE_ACHIEVEMENT_EVENT_KINDS,
  achievementsAdminGrant,
  createFixedClock,
  createMemoryAchievementsStore,
  createMemoryGrantDirectory,
} from "./fakes.ts";
import { authorityEventOfAward } from "./progress.ts";
import {
  asAchievementId,
  asContentDigest,
  asGameEventKind,
  asSubjectId,
  asTenantId,
  asTimestampMs,
} from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-harness")!;
const admin = asSubjectId("admin-service")!;
const subject = asSubjectId("player-one")!;
const winsAchievement = asAchievementId("wins-ten")!;
const wonKind = asGameEventKind(FAKE_ACHIEVEMENT_EVENT_KINDS.matchWon)!;

const grants = createMemoryGrantDirectory();
grants.grant(achievementsAdminGrant(tenant, admin));
const store = createMemoryAchievementsStore();
const service = new AchievementsService({ store: store.store, clock: createFixedClock().clock, grants: grants.grantsDirectory });

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

// 1. Register the definition + bindings.
const registered = service.registerDefinition(
  admin,
  {
    tenant,
    achievementId: winsAchievement,
    metric: "wins",
    threshold: 3,
    visibility: "public",
    progression: "event",
  },
  [{ capability: "achievements", eventKind: wonKind, achievement: winsAchievement, increment: 1 }],
);
record("register", "ok", registered.ok ? "ok" : `failed:${registered.code}`);

function evidence(digestText: string, observedAt: number) {
  return {
    tenant,
    subject,
    eventKind: wonKind,
    digest: asContentDigest(digestText)!,
    observedAt: asTimestampMs(observedAt)!,
  };
}

// 2. Evidence grows progress; the third application crosses the threshold.
const first = service.applyEvidence(admin, evidence("a".repeat(64), 1_000));
record("apply-1", "1,unlocked:false", first.outcomes.map((o) => o.applied ? `${o.progress.current},${o.progress.unlocked ? "unlocked" : "unlocked:false"}` : "not-applied").join(",") || "none");
const second = service.applyEvidence(admin, evidence("b".repeat(64), 2_000));
record("apply-2", "2", second.outcomes.map((o) => (o.applied ? String(o.progress.current) : "not-applied")).join(",") || "none");
const third = service.applyEvidence(admin, evidence("c".repeat(64), 3_000));
record("apply-3", "just-unlocked+award", third.outcomes.map((o) => (o.applied && o.justUnlocked ? "just-unlocked+award" : `applied:${o.applied}`)).join(","));

// 3. The award carries the authority marker and the frozen event kind.
const awardOutcome = third.outcomes.find((o) => o.applied && o.award !== undefined);
const award = awardOutcome && awardOutcome.applied ? awardOutcome.award : undefined;
record("award-marker", "platform-authority", award ? String(award.decidedBy) : "missing");
record("authority-event", "platform.achievement.unlocked", award ? authorityEventOfAward(award).kind : "missing");

// 4. Replay returns the recorded award (E10).
const replay = service.applyEvidence(admin, evidence("c".repeat(64), 3_000));
const replayOutcome = replay.outcomes[0];
record(
  "replay",
  "duplicate-evidence+recorded-award",
  replayOutcome && !replayOutcome.applied
    ? `${replayOutcome.code}${replayOutcome.recorded !== undefined ? "+recorded-award" : ""}`
    : "applied",
);

// 5. Further progress never retracts the unlock (award-once).
const fourth = service.applyEvidence(admin, evidence("d".repeat(64), 4_000));
record(
  "post-unlock",
  "4,unlocked,no-new-award",
  fourth.outcomes
    .map((o) => (o.applied ? `${o.progress.current},${o.progress.unlocked ? "unlocked" : "locked"},${o.award !== undefined ? "new-award" : "no-new-award"}` : "not-applied"))
    .join(","),
);

// 6. Query page (platform-contracts shapes).
const page = service.query(admin, { tenant, subject, unlockedOnly: true });
record("query", "1", "progress" in page ? String(page.progress.length) : `refused:${page.code}`);

// 7. Snapshot / restore round-trip.
const snapshot = service.snapshot();
const resumed = new AchievementsService({ store: store.store, clock: createFixedClock(9_999).clock, grants: grants.grantsDirectory });
const restored = resumed.restore();
record("snapshot", "ok", snapshot.ok ? "ok" : `failed:${snapshot.code}`);
record("restore", "ok", restored.ok ? "ok" : `failed:${restored.code}`);
const replayAfterRestore = resumed.applyEvidence(admin, evidence("c".repeat(64), 3_000));
const replayOutcomeAfterRestore = replayAfterRestore.outcomes[0];
record(
  "replay-after-restore",
  "duplicate-evidence+recorded-award",
  replayOutcomeAfterRestore && !replayOutcomeAfterRestore.applied
    ? `${replayOutcomeAfterRestore.code}${replayOutcomeAfterRestore.recorded !== undefined ? "+recorded-award" : ""}`
    : "applied",
);

// 8. Cross-tenant evidence refused (R20).
const foreign = asTenantId("tenant-foreign")!;
const crossTenant = service.applyEvidence(admin, { tenant: foreign, subject, eventKind: wonKind, digest: asContentDigest("e".repeat(64))!, observedAt: asTimestampMs(5_000)! });
record("cross-tenant", "refused:tenant-mismatch", crossTenant.accepted ? "accepted" : `refused:${crossTenant.code}`);

const failures = steps.filter((item) => item.expected !== item.actual);
console.log(JSON.stringify({ harness: "platform-achievements", ok: failures.length === 0, steps, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
