import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import {
  asAchievementId,
  isAchievementDefinition,
  isAchievementEventBinding,
  isAchievementProgress,
  evaluateUnlock,
  isAchievementQueryRequest,
} from "./achievements.ts";
import type { AchievementDefinition, AchievementProgress } from "./achievements.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const achievement = asAchievementId("ach-veteran")!;
const kind = asGameEventKind("match.completed")!;

test("achievements: definitions are game-declared with positive thresholds (lock 18)", () => {
  const definition: AchievementDefinition = {
    achievementId: achievement,
    metric: "matches-won",
    threshold: 10,
    visibility: "public",
    progression: "metric",
  };
  assert.ok(isAchievementDefinition(definition));
  assert.equal(isAchievementDefinition({ ...definition, threshold: 0 }), false);
  assert.equal(isAchievementDefinition({ ...definition, threshold: 2.5 }), false);
  assert.equal(isAchievementDefinition({ ...definition, visibility: "hidden" }), false);
});

test("achievements: event bindings increment declared achievements", () => {
  assert.ok(
    isAchievementEventBinding({
      capability: "achievements",
      eventKind: kind,
      achievement,
      increment: 1,
    }),
  );
  assert.equal(
    isAchievementEventBinding({ capability: "achievements", eventKind: kind, achievement, increment: 0 }),
    false,
  );
  assert.equal(
    isAchievementEventBinding({ capability: "achievements", eventKind: kind, achievement, increment: 1.5 }),
    false,
  );
});

test("achievements: progress records unlock only under the platform marker (E8)", () => {
  const locked: AchievementProgress = {
    tenant,
    subject,
    achievement,
    current: 3,
    unlocked: false,
  };
  assert.ok(isAchievementProgress(locked));
  const unlocked: AchievementProgress = {
    ...locked,
    current: 10,
    unlocked: true,
    unlockedBy: "platform-authority",
  };
  assert.ok(isAchievementProgress(unlocked));
  // A client-asserted unlock (no platform marker) is structurally invalid.
  assert.equal(isAchievementProgress({ ...unlocked, unlockedBy: undefined }), false);
  assert.equal(isAchievementProgress({ ...unlocked, unlockedBy: "game-declared" }), false);
  // A locked record may not carry a marker.
  assert.equal(isAchievementProgress({ ...locked, unlockedBy: "platform-authority" }), false);
});

test("achievements: the unlock oracle fires exactly at the threshold and never retracts", () => {
  const definition: AchievementDefinition = {
    achievementId: achievement,
    metric: "matches-won",
    threshold: 10,
    visibility: "public",
    progression: "metric",
  };
  assert.deepEqual(evaluateUnlock({ current: 9, unlocked: false }, definition), {
    unlocked: false,
    justUnlocked: false,
  });
  assert.deepEqual(evaluateUnlock({ current: 10, unlocked: false }, definition), {
    unlocked: true,
    justUnlocked: true,
  });
  assert.deepEqual(evaluateUnlock({ current: 42, unlocked: true }, definition), {
    unlocked: true,
    justUnlocked: false,
  });
});

test("achievements: queries are tenant-scoped and explicit", () => {
  assert.ok(isAchievementQueryRequest({ tenant, subject, unlockedOnly: false }));
  assert.equal(isAchievementQueryRequest({ tenant, subject, unlockedOnly: "yes" }), false);
  assert.equal(isAchievementQueryRequest({ tenant, subject: "", unlockedOnly: false }), false);
});
