/**
 * LUMEN RUN — the game's platform policy declarations (PL-037; R7,
 * lock rule 18: "games declare semantic events and policies; they do not
 * duplicate platform authorities").
 *
 * ONE source of truth: the GameIR document's capability-declaration
 * nodes. The service-side registrations (board definition, achievement
 * definitions and event bindings, settlement eligibility, social graph
 * declarations, integrity posture) are PROJECTIONS of those nodes plus
 * the event vocabulary — derived here once, consumed by the service rig
 * (platform-services.ts). Nothing in this example re-implements a
 * platform behavior: every rule, ranking, unlock, grant or verdict is
 * computed by the platform service that owns it.
 *
 * Pure module: frozen data + derivation helpers; no IO, no clocks.
 */

import type { GameIRDocument } from "../../../packages/game-ir/src/index.ts";
import { computeDigest } from "../../../packages/package-system/src/index.ts";
import { asAchievementId, asLeaderboardId } from "../../../packages/platform-contracts/src/index.ts";
import type {
  AchievementDefinition,
  AchievementEventBinding,
  ContentDigest,
  IntegrityEnforcement,
  LeaderboardEventBinding,
  SettlementEligibilityDeclaration,
  SocialEventBinding,
} from "../../../packages/platform-contracts/src/index.ts";
import type { MultiplayerPolicy, ReplayPolicy, RewardsPolicy } from "../../../packages/game-contracts/src/index.ts";
import type { LeaderboardBoardDefinition } from "../../../packages/platform-leaderboard/src/index.ts";
import { bareDigest, TENANT } from "./ids.ts";
import { EVENT_TYPES, PAYLOAD_SHAPES, PLATFORM_EVENT_KINDS } from "./events.ts";

// ---------------------------------------------------------------------------
// Projections of the document's capability-declaration nodes
// ---------------------------------------------------------------------------

type CapabilityNode = Extract<GameIRDocument["nodes"][number], { kind: "capability-declaration" }>;

function isCapabilityNode(node: GameIRDocument["nodes"][number]): node is CapabilityNode {
  return node.kind === "capability-declaration";
}

/** Reads one capability declaration's policy off the document (typed). */
function requiredCapability<T>(document: GameIRDocument, capability: string): T {
  const node = document.nodes.find(
    (entry) => isCapabilityNode(entry) && entry.requirement.capability === capability,
  );
  if (node === undefined || !isCapabilityNode(node)) {
    throw new Error(`lumen-run: document declares no ${capability} capability`);
  }
  return node.requirement.policy as T;
}

/** The declared multiplayer topology (R9: authoritative-server). */
export function declaredMultiplayerPolicy(document: GameIRDocument): MultiplayerPolicy {
  return requiredCapability<MultiplayerPolicy>(document, "multiplayer");
}

/** The declared replay policy (R8/R11 consumers). */
export function declaredReplayPolicy(document: GameIRDocument): ReplayPolicy {
  return requiredCapability<ReplayPolicy>(document, "replay");
}

/** The declared rewards policy (R10: platform settlement, never client). */
export function declaredRewardsPolicy(document: GameIRDocument): RewardsPolicy {
  return requiredCapability<RewardsPolicy>(document, "rewards");
}

/** The declared integrity posture (R11: report-only evidence). */
export function declaredIntegrityPosture(document: GameIRDocument): IntegrityEnforcement {
  return requiredCapability<{ enforcement: IntegrityEnforcement }>(document, "integrity").enforcement;
}

// ---------------------------------------------------------------------------
// Service-side registration shapes (projections + game policy data)
// ---------------------------------------------------------------------------

/** The leaderboard this game declares (metric from the capability node). */
export const LUMEN_BOARD: LeaderboardBoardDefinition = {
  tenant: TENANT,
  leaderboard: asLeaderboardId("lumen-score-board")!,
  metric: "run.score",
  aggregation: "latest",
  ordering: "descending",
  policy: { tieBreaking: "first-achieved", resetCadence: "never", entryVisibility: "public", minIntegrityConfidence: 0.5 },
};

/** How the game binds its run-completion event to the board (lock 18). */
export const LUMEN_BOARD_BINDING: LeaderboardEventBinding = {
  capability: "leaderboard",
  eventKind: PLATFORM_EVENT_KINDS.runCompleted,
  metric: "run.score",
  aggregation: "latest",
};

/** The achievement definitions the game declares (lock 18). */
export const LUMEN_ACHIEVEMENTS: readonly (AchievementDefinition & { readonly bindings: readonly AchievementEventBinding[] })[] = [
  {
    achievementId: asAchievementId("ach-lumen-hoarder")!,
    metric: "run.lumens",
    threshold: 3,
    visibility: "public",
    progression: "metric",
    bindings: [{ capability: "achievements", eventKind: PLATFORM_EVENT_KINDS.lumenCollected, achievement: asAchievementId("ach-lumen-hoarder")!, increment: 1 }],
  },
  {
    achievementId: asAchievementId("ach-run-finisher")!,
    metric: "run.completions",
    threshold: 1,
    visibility: "public",
    progression: "event",
    bindings: [{ capability: "achievements", eventKind: PLATFORM_EVENT_KINDS.runCompleted, achievement: asAchievementId("ach-run-finisher")!, increment: 1 }],
  },
];

/**
 * The settlement eligibility declaration (R10): `run.completed` settles a
 * `score-shard` entitlement, requires an authoritative outcome, needs
 * integrity confidence ≥ 0.5 and pins the event payload's value shape by
 * digest.
 */
export const LUMEN_SETTLEMENT: SettlementEligibilityDeclaration = {
  capability: "rewards",
  eventKind: PLATFORM_EVENT_KINDS.runCompleted,
  entitlementKind: "score-shard",
  requiresAuthoritativeOutcome: true,
  minIntegrityConfidence: 0.5,
  valueShapeDigest: shapeDigestOf(EVENT_TYPES.runCompleted),
};

/** The social service policy + the game's social event binding. */
export const LUMEN_SOCIAL_POLICY = {
  service: { maxGraphSize: 50, requireMutualConsent: false, presence: true },
  declaredGraphs: ["friends"] as const,
  binding: { capability: "social", eventKind: PLATFORM_EVENT_KINDS.socialEcho, graph: "friends" } as const satisfies SocialEventBinding,
};

/**
 * The game's declared economy value: one `score-shard` is worth 10
 * points, pinned by payload digest (zero numeric authority at the
 * contract layer — the magnitude resolves in the economy service).
 * Bare platform-contracts digest form (the economy value wire).
 */
export const SCORE_SHARD_VALUE_DIGEST: ContentDigest = bareDigest(computeDigest({ valueKind: "int", magnitude: 10 }))!;

/** The digest of an event payload's declared shape (settlement pin). */
export function shapeDigestOf(eventType: string): ContentDigest {
  const shape = PAYLOAD_SHAPES[eventType];
  if (shape === undefined) throw new Error(`no payload shape declared for ${eventType}`);
  const digest = bareDigest(computeDigest(shape));
  if (digest === null) throw new Error("shape digest projection failed");
  return digest;
}
