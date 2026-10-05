import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_CAPABILITY_IDS,
  REPLAY_CONSUMERS,
  findPlatformCapability,
  isAchievementsPolicy,
  isAnalyticsPolicy,
  isIntegrityPolicy,
  isLeaderboardPolicy,
  isModerationPolicy,
  isMultiplayerPolicy,
  isPlatformCapabilityDescriptor,
  isPlatformCapabilityId,
  isPlatformCapabilitySet,
  isReplayPolicy,
  isRewardsPolicy,
  isSocialPolicy,
} from "./capabilities.ts";
import type {
  PlatformCapabilityDescriptor,
  PlatformCapabilityId,
  PlatformCapabilitySet,
  ReplayPolicy,
  RewardsPolicy,
} from "./capabilities.ts";

test("capabilities: platform vocabulary is the frozen nine (R7 / lock 17)", () => {
  assert.deepEqual([...PLATFORM_CAPABILITY_IDS], [
    "leaderboard",
    "multiplayer",
    "replay",
    "rewards",
    "social",
    "achievements",
    "analytics",
    "moderation",
    "integrity",
  ]);
  assert.ok(isPlatformCapabilityId("leaderboard"));
  assert.equal(isPlatformCapabilityId("cloud-save"), false);
});

test("capabilities: every policy shape has a working guard", () => {
  assert.ok(isLeaderboardPolicy({ metric: "score", ordering: "descending", scope: "global" }));
  assert.equal(isLeaderboardPolicy({ metric: "", ordering: "descending", scope: "global" }), false);
  assert.ok(
    isMultiplayerPolicy({ topology: "authoritative-server", maxPlayersPerSession: 32, sessionModel: "matchmade" }),
  );
  assert.equal(
    isMultiplayerPolicy({ topology: "authoritative-server", maxPlayersPerSession: 0, sessionModel: "ad-hoc" }),
    false,
  );
  assert.ok(isReplayPolicy({ capture: "intent-log", determinismRequired: true, consumers: ["qa", "integrity"] }));
  assert.equal(isReplayPolicy({ capture: "intent-log", determinismRequired: true, consumers: ["cheaters"] }), false);
  assert.ok(isRewardsPolicy({ mode: "entitlement", settlement: "platform", clientAuthoritative: false }));
  assert.equal(isRewardsPolicy({ mode: "points", settlement: "platform", clientAuthoritative: true }), false);
  assert.ok(isSocialPolicy({ graphs: ["friends", "guilds"], presence: true }));
  assert.ok(isAchievementsPolicy({ visibility: "public", progression: "metric" }));
  assert.ok(isAnalyticsPolicy({ events: ["session.start"], identity: "pseudonymous", retentionDays: 90 }));
  assert.equal(isAnalyticsPolicy({ events: [], identity: "pseudonymous", retentionDays: 90 }), false);
  assert.ok(isModerationPolicy({ surfaces: ["chat", "behavior"], appealable: true }));
  assert.ok(isIntegrityPolicy({ signals: ["behavioral", "timing"], enforcement: "report-only" }));
  assert.equal(isIntegrityPolicy({ signals: ["psychic"], enforcement: "report-only" }), false);
});

test("capabilities: descriptors are discriminated by capability id", () => {
  const leaderboard: PlatformCapabilityDescriptor = {
    capability: "leaderboard",
    required: true,
    policy: { metric: "score", ordering: "descending", scope: "global" },
  };
  const replay: PlatformCapabilityDescriptor = {
    capability: "replay",
    required: false,
    policy: { capture: "intent-log", determinismRequired: true, consumers: [...REPLAY_CONSUMERS] },
  };
  assert.ok(isPlatformCapabilityDescriptor(leaderboard));
  assert.ok(isPlatformCapabilityDescriptor(replay));
  assert.equal(isPlatformCapabilityDescriptor({ capability: "cloud-save", required: true, policy: {} }), false);
  assert.equal(
    isPlatformCapabilityDescriptor({ capability: "leaderboard", required: true, policy: { topology: "peer-to-peer" } }),
    false,
  );
});

test("capabilities: replay policy consumes the full R8 consumer list", () => {
  const policy: ReplayPolicy = {
    capture: "state-delta",
    determinismRequired: true,
    consumers: ["player", "qa", "integrity", "simulation", "lab"],
  };
  assert.equal(policy.consumers.length, 5);
});

test("capabilities: sets reject duplicate capability declarations", () => {
  const set: PlatformCapabilitySet = [
    { capability: "replay", required: true, policy: { capture: "intent-log", determinismRequired: true, consumers: [] } },
    { capability: "replay", required: false, policy: { capture: "full-state", determinismRequired: false, consumers: [] } },
  ];
  assert.equal(isPlatformCapabilitySet(set), false);
  const single: PlatformCapabilitySet = [set[0]!];
  assert.ok(isPlatformCapabilitySet(single));
  assert.equal(findPlatformCapability(single, "replay")?.required, true);
  assert.equal(findPlatformCapability(single, "moderation"), undefined);
});

test("capabilities: rewards can never be client-authoritative (lock 41, compile-time)", () => {
  const rewards: RewardsPolicy = { mode: "points", settlement: "platform", clientAuthoritative: false };
  assert.ok(isRewardsPolicy(rewards));
  // @ts-expect-error — clientAuthoritative is the literal type false
  const rigged: RewardsPolicy = { mode: "points", settlement: "platform", clientAuthoritative: true };
  assert.equal(isRewardsPolicy(rigged), false);
});

test("capabilities: capability ids are not interchangeable strings (compile-time misuse)", () => {
  // @ts-expect-error — a plain string is not a PlatformCapabilityId
  const id: PlatformCapabilityId = "cloud-save";
  assert.equal(isPlatformCapabilityId(id), false);
});
