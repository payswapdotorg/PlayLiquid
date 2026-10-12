/**
 * LUMEN RUN — the platform service rig (PL-037; R7).
 *
 * The composition root for the platform services the game CONSUMES:
 * identity, social, leaderboard, achievements, economy and competitive
 * integrity — each one the REAL service from its package, constructed
 * over that package's deterministic in-memory fakes (stores, clocks,
 * grant directories) and registered with the game's DECLARED policies
 * (platform-policy.ts — projections of the GameIR capability nodes).
 *
 * No duplicate authority exists in this example: the game never ranks,
 * never unlocks, never grants entitlements and never emits integrity
 * verdicts — it submits evidence and reads read models. The
 * economy→integrity seam is wired exactly as PL-017/PL-018 designed:
 * `createRewardIntegrityAdapter` over the integrity service (the port
 * target), so a recorded verdict OVERRIDES request-carried confidence
 * (evidence before self-declaration, R10/R11).
 *
 * Environment limitation (stated plainly): the ports are in-memory test
 * doubles; there is no durable persistence, no network and no real
 * authentication. The service contracts themselves are the production
 * surfaces.
 */

import { asTimestampMs } from "../../../packages/platform-contracts/src/index.ts";
import type { SubjectId, TimestampMs } from "../../../packages/platform-contracts/src/index.ts";
import { IdentityService } from "../../../packages/platform-identity/src/index.ts";
import { createMemoryIdentityStore } from "../../../packages/platform-identity/src/index.ts";
import { SocialService } from "../../../packages/platform-social/src/index.ts";
import {
  createMemoryGrantDirectory as createSocialGrants,
  createMemorySocialStore,
  createMemorySubjectDirectory,
  socialGrant,
} from "../../../packages/platform-social/src/index.ts";
import { LeaderboardService } from "../../../packages/platform-leaderboard/src/index.ts";
import {
  createMemoryGrantDirectory as createLeaderboardGrants,
  createMemoryLeaderboardStore,
  leaderboardAdminGrant,
  leaderboardSubmitGrant,
} from "../../../packages/platform-leaderboard/src/index.ts";
import { AchievementsService } from "../../../packages/platform-achievements/src/index.ts";
import {
  achievementsAdminGrant,
  achievementsSubmitGrant,
  createMemoryAchievementsStore,
  createMemoryGrantDirectory as createAchievementsGrants,
} from "../../../packages/platform-achievements/src/index.ts";
import { EconomyService } from "../../../packages/platform-economy/src/index.ts";
import {
  createMappingValueResolver,
  createMemoryEconomyStore,
  createMemoryGrantDirectory as createEconomyGrants,
  economyAdminGrant,
  economySubmitGrant,
} from "../../../packages/platform-economy/src/index.ts";
import { IntegrityService } from "../../../packages/platform-integrity/src/index.ts";
import {
  createMemoryGrantDirectory as createIntegrityGrants,
  createMemoryIntegrityStore,
  createRewardIntegrityAdapter,
  integritySubmitGrant,
} from "../../../packages/platform-integrity/src/index.ts";
import type { GameIRDocument } from "../../../packages/game-ir/src/index.ts";
import { OPERATOR, PLAYER_ONE, PLAYER_TWO, TENANT } from "./ids.ts";
import { LUMEN_ACHIEVEMENTS, LUMEN_BOARD, LUMEN_SETTLEMENT, LUMEN_SOCIAL_POLICY, SCORE_SHARD_VALUE_DIGEST, declaredIntegrityPosture } from "./platform-policy.ts";

/** A shared, manually-advanced fixed clock (deterministic, E9). */
export function sharedFixedClock(startMs = 1_000): { readonly now: () => TimestampMs; readonly advance: (ms: number) => void } {
  let current = startMs;
  return { now: () => asTimestampMs(current)!, advance: (ms) => { current += ms; } };
}

/** The wired platform rig. */
export interface PlatformRig {
  readonly identity: IdentityService;
  readonly social: SocialService;
  readonly leaderboard: LeaderboardService;
  readonly achievements: AchievementsService;
  readonly economy: EconomyService;
  readonly integrity: IntegrityService;
  readonly clock: { readonly now: () => TimestampMs; readonly advance: (ms: number) => void };
}

/**
 * Constructs the rig and registers the game's declared policies. The
 * registrations themselves are authoritative admissions — typed refusals
 * surface as thrown errors here (composition-time wiring failure, not a
 * runtime path).
 */
export function createPlatformRig(document: GameIRDocument): PlatformRig {
  const clock = sharedFixedClock();

  const identity = new IdentityService({ store: createMemoryIdentityStore().store, clock });
  const register = (subject: SubjectId, displayName: string, alias: string) => {
    const admission = identity.admit({ kind: "register", tenant: TENANT, subject, displayName, alias });
    if (!admission.accepted) throw new Error(`identity registration refused for ${subject}: ${admission.code}`);
  };
  register(PLAYER_ONE, "Player One", "player-one");
  register(PLAYER_TWO, "Player Two", "player-two");
  register(OPERATOR, "Lumen Operator", "operator");

  const directory = createMemorySubjectDirectory();
  directory.register(TENANT, PLAYER_ONE);
  directory.register(TENANT, PLAYER_TWO);
  directory.register(TENANT, OPERATOR);
  const socialGrants = createSocialGrants();
  socialGrants.grant(socialGrant(TENANT, PLAYER_ONE));
  const social = new SocialService({
    store: createMemorySocialStore().store,
    clock,
    directory: directory.directory,
    grants: socialGrants.grantsDirectory,
    policy: LUMEN_SOCIAL_POLICY.service,
    declaredGraphs: [...LUMEN_SOCIAL_POLICY.declaredGraphs],
  });

  const leaderboardGrants = createLeaderboardGrants();
  leaderboardGrants.grant(leaderboardAdminGrant(TENANT, OPERATOR));
  leaderboardGrants.grant(leaderboardSubmitGrant(TENANT, PLAYER_ONE));
  const leaderboard = new LeaderboardService({ store: createMemoryLeaderboardStore().store, clock, grants: leaderboardGrants.grantsDirectory });
  const boardRegistration = leaderboard.registerBoard(OPERATOR, LUMEN_BOARD);
  if (!boardRegistration.ok) throw new Error(`board registration refused: ${boardRegistration.code}`);

  const achievementsGrants = createAchievementsGrants();
  achievementsGrants.grant(achievementsAdminGrant(TENANT, OPERATOR));
  achievementsGrants.grant(achievementsSubmitGrant(TENANT, PLAYER_ONE));
  const achievements = new AchievementsService({ store: createMemoryAchievementsStore().store, clock, grants: achievementsGrants.grantsDirectory });
  for (const definition of LUMEN_ACHIEVEMENTS) {
    const registration = achievements.registerDefinition(OPERATOR, { ...definition, tenant: TENANT }, definition.bindings);
    if (!registration.ok) throw new Error(`achievement registration refused: ${registration.code}`);
  }

  const integrityGrants = createIntegrityGrants();
  integrityGrants.grant(integritySubmitGrant(TENANT, OPERATOR));
  // R11: the concerned subject can read their own probabilistic
  // competitive-integrity evidence (report-only posture) — the report
  // the verdict rests on is readable by the player it concerns.
  integrityGrants.grant({ tenant: TENANT, subject: PLAYER_ONE, capability: "integrity", permissions: ["read"] });
  const integrity = new IntegrityService({ store: createMemoryIntegrityStore().store, clock, grants: integrityGrants.grantsDirectory });

  const economyGrants = createEconomyGrants();
  economyGrants.grant(economyAdminGrant(TENANT, OPERATOR));
  economyGrants.grant(economySubmitGrant(TENANT, PLAYER_ONE));
  const economy = new EconomyService({
    store: createMemoryEconomyStore().store,
    clock,
    grants: economyGrants.grantsDirectory,
    integrity: createRewardIntegrityAdapter({ service: integrity, reader: OPERATOR }),
    values: createMappingValueResolver({ [SCORE_SHARD_VALUE_DIGEST]: 10 }, 1),
  });
  const settlementRegistration = economy.registerPolicy(OPERATOR, TENANT, LUMEN_SETTLEMENT);
  if (!settlementRegistration.ok) throw new Error(`settlement policy registration refused: ${settlementRegistration.code}`);

  // The declared enforcement posture rides the integrity document
  // declaration (report-only; enforcement composition is the host's).
  void declaredIntegrityPosture(document);

  return { identity, social, leaderboard, achievements, economy, integrity, clock };
}
