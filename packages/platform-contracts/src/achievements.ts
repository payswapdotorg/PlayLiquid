/**
 * ACHIEVEMENTS PLATFORM SERVICE CONTRACTS (R7 / lock rule 17).
 *
 * Achievements are a platform capability. Games declare achievement
 * DEFINITIONS and bind their semantic events to them (lock 18); the
 * platform owns progression bookkeeping and unlock issuance. An unlock is
 * only ever recorded with the platform authority marker
 * ({@link AchievementProgress.unlockedBy}) — games and clients can never
 * award achievements themselves (E8 negative coverage on the guard).
 *
 * Purity: pure types + pure guards + a pure unlock oracle. No IO.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { SubjectId, TenantId, PlatformAuthorityMarker } from "./primitives.ts";
import type { GameEventKind } from "./events.ts";

/** Identifier of one achievement definition. */
export type AchievementId = Brand<string, "AchievementId">;

/** Parses and validates `text` as an {@link AchievementId}. */
export function asAchievementId(text: string): AchievementId | undefined {
  return isValidIdText(text) ? (text as AchievementId) : undefined;
}

// ---------------------------------------------------------------------------
// Game-side declaration (lock 18)
// ---------------------------------------------------------------------------

/** An achievement definition as a game declares it. */
export interface AchievementDefinition {
  readonly achievementId: AchievementId;
  readonly metric: string;
  readonly threshold: number;
  readonly visibility: "public" | "private" | "social";
  readonly progression: "metric" | "event";
}

/** Returns true when `value` is a structurally valid {@link AchievementDefinition}. */
export function isAchievementDefinition(value: unknown): value is AchievementDefinition {
  if (typeof value !== "object" || value === null) return false;
  const definition = value as Record<string, unknown>;
  return (
    typeof definition.achievementId === "string" &&
    definition.achievementId.length > 0 &&
    typeof definition.metric === "string" &&
    definition.metric.length > 0 &&
    typeof definition.threshold === "number" &&
    Number.isSafeInteger(definition.threshold) &&
    definition.threshold >= 1 &&
    (definition.visibility === "public" || definition.visibility === "private" || definition.visibility === "social") &&
    (definition.progression === "metric" || definition.progression === "event")
  );
}

/**
 * How a game binds one of ITS events to achievement progression
 * (lock 18): the event increments an achievement's metric.
 */
export interface AchievementEventBinding {
  readonly capability: "achievements";
  readonly eventKind: GameEventKind;
  readonly achievement: AchievementId;
  readonly increment: number;
}

/** Returns true when `value` is a structurally valid {@link AchievementEventBinding}. */
export function isAchievementEventBinding(value: unknown): value is AchievementEventBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return (
    binding.capability === "achievements" &&
    typeof binding.eventKind === "string" &&
    binding.eventKind.length > 0 &&
    typeof binding.achievement === "string" &&
    binding.achievement.length > 0 &&
    typeof binding.increment === "number" &&
    Number.isSafeInteger(binding.increment) &&
    binding.increment >= 1
  );
}

// ---------------------------------------------------------------------------
// Platform-owned progression
// ---------------------------------------------------------------------------

/** One subject's progression on one achievement (platform bookkeeping). */
export interface AchievementProgress {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly achievement: AchievementId;
  readonly current: number;
  readonly unlocked: boolean;
  /** Mandatory platform marker when unlocked — clients cannot award. */
  readonly unlockedBy?: PlatformAuthorityMarker;
}

/** Returns true when `value` is a structurally valid {@link AchievementProgress}. */
export function isAchievementProgress(value: unknown): value is AchievementProgress {
  if (typeof value !== "object" || value === null) return false;
  const progress = value as Record<string, unknown>;
  if (typeof progress.subject !== "string" || progress.subject.length === 0) return false;
  if (typeof progress.achievement !== "string" || progress.achievement.length === 0) return false;
  if (typeof progress.current !== "number" || !Number.isSafeInteger(progress.current) || progress.current < 0) {
    return false;
  }
  if (typeof progress.unlocked !== "boolean") return false;
  // E8: an unlocked progress record without the platform marker is invalid.
  if (progress.unlocked && progress.unlockedBy !== "platform-authority") return false;
  if (!progress.unlocked && progress.unlockedBy !== undefined) return false;
  return true;
}

/** Result of the pure unlock oracle. */
export interface UnlockEvaluation {
  readonly unlocked: boolean;
  readonly justUnlocked: boolean;
}

/**
 * Pure unlock oracle against a definition's threshold. `justUnlocked` is
 * true only at the crossing boundary; already-unlocked progress stays
 * unlocked (unlocks are never retracted by later progress).
 */
export function evaluateUnlock(
  progress: Pick<AchievementProgress, "current" | "unlocked">,
  definition: Pick<AchievementDefinition, "threshold">,
): UnlockEvaluation {
  const unlocked = progress.unlocked || progress.current >= definition.threshold;
  return { unlocked, justUnlocked: unlocked && !progress.unlocked };
}

// ---------------------------------------------------------------------------
// Queries (request/response)
// ---------------------------------------------------------------------------

/** A progression query, always tenant-scoped (R20). */
export interface AchievementQueryRequest {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly unlockedOnly: boolean;
}

/** Returns true when `value` is a structurally valid {@link AchievementQueryRequest}. */
export function isAchievementQueryRequest(value: unknown): value is AchievementQueryRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.subject === "string" &&
    request.subject.length > 0 &&
    typeof request.unlockedOnly === "boolean"
  );
}

/** One page of progression records. */
export interface AchievementProgressPage {
  readonly subject: SubjectId;
  readonly progress: readonly AchievementProgress[];
}
