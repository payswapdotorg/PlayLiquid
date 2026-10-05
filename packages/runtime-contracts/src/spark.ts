/**
 * SPARK TARGET PROFILE TYPES (requirement R6, lock rule 16).
 *
 * Spark is a TARGET PROFILE — a deployment/rendering/budget profile a build
 * and runtime target — NOT a second game model. Consequences encoded in the
 * types:
 *
 * - {@link SparkTargetProfile} extends {@link TargetProfile}, which contains
 *   ONLY targeting data (aspect, form factor, boot/streaming budgets).
 *   There is deliberately no `world`, `assets`, `avatars`, `rules` or any
 *   game-content field — a target profile composes WITH a game, it never
 *   defines one. The colocated test proves `"world"` is not even a valid
 *   key of the profile type.
 * - The Spark properties from spec/architecture.md are literal types:
 *   `9:16` aspect, `mobile-first` form factor, minimal critical boot,
 *   aggressive caching, progressive streaming, first-interaction
 *   optimization.
 * - Budgets are DATA (millisecond and byte ceilings supplied by game
 *   policy); {@link validateSparkProfile} checks structural consistency
 *   only — it never invents platform policy numbers.
 */

import type { TargetProfileId, Timestamp } from "./primitives.ts";

/** Literal id of the canonical Spark target profile. */
export type SparkProfileId = "spark";

/**
 * Base target profile. Target profiles shape HOW a game is delivered to a
 * target (web, desktop, mobile, XR, dedicated server, console — R12); they
 * never carry game content.
 */
export interface TargetProfile {
  readonly profileId: TargetProfileId;
  readonly formFactor: "mobile-first" | "desktop-first" | "headless-server" | "xr";
  readonly orientation: "portrait" | "landscape" | "any";
  readonly aspectRatio: string;
}

/** One entry of the minimal critical boot manifest (load order matters). */
export interface SparkBootEntry {
  /** 0 first: strictly increasing priorities define the boot order. */
  readonly priority: number;
  /** Content-addressed asset reference (opaque string; CAS-resolved). */
  readonly assetRef: string;
  readonly byteCeiling: number;
  readonly requiredFor: "first-paint" | "first-interaction";
}

/** Minimal critical boot + first-interaction budgets (all caller data). */
export interface SparkBootBudget {
  readonly entries: readonly SparkBootEntry[];
  /** Wall-clock target from launch to first paint (ms), caller policy. */
  readonly firstPaintTargetMs: number;
  /** Wall-clock target from launch to first interaction (ms), caller policy. */
  readonly firstInteractionTargetMs: number;
}

/**
 * The Spark target profile: 9:16, mobile-first, fast-start. A profile, not
 * a game model (lock rule 16).
 */
export interface SparkTargetProfile extends TargetProfile {
  readonly profileId: TargetProfileId & SparkProfileId;
  readonly formFactor: "mobile-first";
  readonly orientation: "portrait";
  readonly aspectRatio: "9:16";
  readonly boot: SparkBootBudget;
  readonly caching: "aggressive";
  readonly streaming: "progressive";
  /** How many asset streams may be in flight during progressive streaming. */
  readonly maxConcurrentStreams: number;
  /** When this profile revision was pinned (caller-supplied; no clock IO). */
  readonly pinnedAt: Timestamp;
}

/**
 * The only way to mint the Spark profile id: the parameter type IS the
 * literal "spark", so no other profile id can inhabit a Spark profile.
 */
export function asSparkProfileId(value: "spark"): SparkTargetProfile["profileId"] {
  return value as SparkTargetProfile["profileId"];
}

/** Structural validation result for a Spark profile. */
export type SparkProfileValidation =
  | { readonly ok: true; readonly entries: number }
  | {
      readonly ok: false;
      readonly code:
        | "not-spark-profile"
        | "empty-boot-manifest"
        | "boot-priority-not-strictly-increasing"
        | "negative-budget"
        | "first-interaction-before-first-paint"
        | "bad-concurrency";
    };

/** Pure structural validator. Checks shape/consistency, never policy numbers. */
export function validateSparkProfile(profile: SparkTargetProfile): SparkProfileValidation {
  if (
    profile.profileId !== "spark" ||
    profile.aspectRatio !== "9:16" ||
    profile.formFactor !== "mobile-first" ||
    profile.orientation !== "portrait" ||
    profile.caching !== "aggressive" ||
    profile.streaming !== "progressive"
  ) {
    return { ok: false, code: "not-spark-profile" };
  }
  if (profile.boot.entries.length === 0) {
    return { ok: false, code: "empty-boot-manifest" };
  }
  let lastPriority = Number.NEGATIVE_INFINITY;
  for (const entry of profile.boot.entries) {
    if (entry.priority <= lastPriority) {
      return { ok: false, code: "boot-priority-not-strictly-increasing" };
    }
    lastPriority = entry.priority;
    if (entry.byteCeiling < 0 || !Number.isSafeInteger(entry.byteCeiling)) {
      return { ok: false, code: "negative-budget" };
    }
  }
  if (
    profile.boot.firstPaintTargetMs < 0 ||
    profile.boot.firstInteractionTargetMs < 0 ||
    profile.boot.firstInteractionTargetMs < profile.boot.firstPaintTargetMs
  ) {
    return { ok: false, code: "first-interaction-before-first-paint" };
  }
  if (!Number.isSafeInteger(profile.maxConcurrentStreams) || profile.maxConcurrentStreams < 1) {
    return { ok: false, code: "bad-concurrency" };
  }
  return { ok: true, entries: profile.boot.entries.length };
}
