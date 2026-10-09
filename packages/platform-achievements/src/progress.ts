/**
 * ACHIEVEMENT PROGRESSION + AWARD-ONCE ORACLE (PL-015, E10).
 *
 * Progression bookkeeping is PLATFORM-owned (lock 18): an unlock is
 * only ever recorded with the platform authority marker
 * (`SubjectProgressState.unlockedBy`), and the unlock decision is THE
 * platform-contracts oracle (`evaluateUnlock`) — never local
 * re-derivation. Awards are append-only, evidence-keyed records: one
 * evidence digest can award one achievement to one subject EXACTLY
 * ONCE; re-application returns the recorded award, never a second
 * mutation (E10).
 *
 * Purity: types + pure application fold. No IO.
 */

import { evaluateUnlock } from "@playliquid/platform-contracts";
import type {
  AchievementDefinition,
  ContentDigest,
  PlatformAuthorityEvent,
  PlatformAuthorityMarker,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import type { AchievementId } from "@playliquid/platform-contracts";
import type { AchievementEventEvidence } from "./conditions.ts";

// ---------------------------------------------------------------------------
// Progress state
// ---------------------------------------------------------------------------

/** One subject's progression on one achievement (platform bookkeeping). */
export interface SubjectProgressState {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly achievement: AchievementId;
  readonly current: number;
  readonly unlocked: boolean;
  /** Mandatory platform marker when unlocked — clients cannot award (E8). */
  readonly unlockedBy?: PlatformAuthorityMarker;
  readonly unlockedAt?: TimestampMs;
  /** Idempotency registry: digests already applied to this progression. */
  readonly evidenceApplied: readonly ContentDigest[];
}

/** Returns true when `value` is a structurally valid {@link SubjectProgressState}. */
export function isSubjectProgressState(value: unknown): value is SubjectProgressState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  if (typeof state.tenant !== "string" || state.tenant.length === 0) return false;
  if (typeof state.subject !== "string" || state.subject.length === 0) return false;
  if (typeof state.achievement !== "string" || state.achievement.length === 0) return false;
  if (typeof state.current !== "number" || !Number.isSafeInteger(state.current) || state.current < 0) return false;
  if (typeof state.unlocked !== "boolean") return false;
  if (state.unlocked && state.unlockedBy !== "platform-authority") return false;
  if (!state.unlocked && state.unlockedBy !== undefined) return false;
  return Array.isArray(state.evidenceApplied);
}

// ---------------------------------------------------------------------------
// Award records (append-only, E10)
// ---------------------------------------------------------------------------

/** One immutable achievement award: awarded exactly once per key. */
export interface AchievementAwardRecord {
  /** Deterministic: `${digest}:${achievement}`. */
  readonly awardId: string;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly achievement: AchievementId;
  readonly awardedAt: TimestampMs;
  readonly evidence: ContentDigest;
  readonly currentAtAward: number;
  readonly decidedBy: PlatformAuthorityMarker;
}

/** Deterministic award id (see {@link AchievementAwardRecord}). */
export function awardRecordId(evidence: ContentDigest, achievement: AchievementId): string {
  return `${String(evidence)}:${String(achievement)}`;
}

/** The frozen platform authority event an award represents (lock 18). */
export function authorityEventOfAward(
  award: AchievementAwardRecord,
): PlatformAuthorityEvent<{ subject: string; achievement: string; currentAtAward: number }> {
  return {
    origin: "platform-authority",
    kind: "platform.achievement.unlocked",
    decidedBy: "platform-authority",
    payload: {
      subject: String(award.subject),
      achievement: String(award.achievement),
      currentAtAward: award.currentAtAward,
    },
  };
}

// ---------------------------------------------------------------------------
// The application fold (award-once oracle)
// ---------------------------------------------------------------------------

/** The result of applying one evidence to one achievement. */
export type ProgressApplication =
  | {
      readonly applied: true;
      readonly progress: SubjectProgressState;
      /** True only at the threshold-crossing boundary (award-once). */
      readonly justUnlocked: boolean;
      readonly award?: AchievementAwardRecord;
    }
  | {
      readonly applied: false;
      readonly code: "duplicate-evidence" | "invalid-increment";
      readonly detail: string;
    };

/** The identity scope one progression belongs to. */
export interface ProgressScope {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly achievement: AchievementId;
}

/**
 * THE pure application fold. Runs the platform-contracts unlock oracle
 * (`evaluateUnlock`) over the accumulated progress; an award record is
 * minted ONLY at the crossing boundary (`justUnlocked`), making the
 * award semantics exactly-once per (subject, achievement) — a later
 * application can never re-award, and unlocked progress never
 * retracts. Duplicate evidence digests are refused
 * (`duplicate-evidence`, E10). The identity scope is caller-supplied
 * (the state owner derives it from its own keys, never from the
 * evidence).
 */
export function applyEvidence(
  definition: Pick<AchievementDefinition, "threshold">,
  scope: ProgressScope,
  progress: SubjectProgressState | undefined,
  evidence: Pick<AchievementEventEvidence, "digest" | "observedAt">,
  increment: number,
): ProgressApplication {
  if (!Number.isSafeInteger(increment) || increment < 1) {
    return { applied: false, code: "invalid-increment", detail: "increment must be a safe integer >= 1" };
  }
  const applied = progress?.evidenceApplied ?? [];
  if (applied.some((digest) => digest === evidence.digest)) {
    return { applied: false, code: "duplicate-evidence", detail: "evidence digest was already applied to this progression (E10)" };
  }
  const current = (progress?.current ?? 0) + increment;
  const unlock = evaluateUnlock({ current: progress?.current ?? 0, unlocked: progress?.unlocked ?? false }, definition);
  const nextUnlocked = evaluateUnlock({ current, unlocked: progress?.unlocked ?? false }, definition).unlocked;
  const justUnlocked = nextUnlocked && !unlock.unlocked;
  const base: SubjectProgressState = {
    tenant: scope.tenant,
    subject: scope.subject,
    achievement: scope.achievement,
    current,
    unlocked: nextUnlocked,
    unlockedBy: nextUnlocked ? "platform-authority" : undefined,
    unlockedAt: nextUnlocked ? (progress?.unlockedAt ?? evidence.observedAt) : undefined,
    evidenceApplied: [...applied, evidence.digest],
  };
  if (!justUnlocked) {
    return { applied: true, progress: base, justUnlocked: false };
  }
  const award: AchievementAwardRecord = {
    awardId: awardRecordId(evidence.digest, base.achievement),
    tenant: base.tenant,
    subject: base.subject,
    achievement: base.achievement,
    awardedAt: evidence.observedAt,
    evidence: evidence.digest,
    currentAtAward: current,
    decidedBy: "platform-authority",
  };
  return { applied: true, progress: base, justUnlocked: true, award };
}
