/**
 * ACHIEVEMENT CONDITIONS — pure predicates over event evidence
 * (PL-015). "Condition evaluation as pure predicates over event
 * evidence" is this module, exactly.
 *
 * A game declares {@link AchievementDefinition}s and binds ITS semantic
 * events to them with {@link AchievementEventBinding}s (lock 18: the
 * platform-contracts declaration shapes). The platform derives one
 * {@link ConditionPredicate} per binding: a pure `matches` test over
 * the evidence's event kind, and a pure `incrementOf` carrier. Whether
 * a subject's condition is satisfied is a pure threshold comparison
 * (the platform-contracts `evaluateUnlock` oracle is bound in
 * progress.ts — never local re-derivation).
 *
 * Purity: predicates + guards + folds. No IO, no clock, no randomness.
 */

import { asContentDigest } from "@playliquid/platform-contracts";
import type {
  AchievementDefinition,
  AchievementEventBinding,
  AchievementId,
  ContentDigest,
  GameEventKind,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";


// ---------------------------------------------------------------------------
// Event evidence
// ---------------------------------------------------------------------------

/**
 * One piece of event evidence: a game-declared semantic event observed
 * for one subject, content-addressed by digest. Evidence is INPUT — it
 * carries zero authority (the service decides progression).
 */
export interface AchievementEventEvidence {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly eventKind: GameEventKind;
  readonly digest: ContentDigest;
  readonly observedAt: TimestampMs;
}

/** Returns true when `value` is a structurally valid {@link AchievementEventEvidence}. */
export function isAchievementEventEvidence(value: unknown): value is AchievementEventEvidence {
  if (typeof value !== "object" || value === null) return false;
  const evidence = value as Record<string, unknown>;
  return (
    typeof evidence.tenant === "string" &&
    evidence.tenant.length > 0 &&
    typeof evidence.subject === "string" &&
    evidence.subject.length > 0 &&
    typeof evidence.eventKind === "string" &&
    evidence.eventKind.length > 0 &&
    typeof evidence.digest === "string" &&
    asContentDigest(evidence.digest) !== undefined &&
    typeof evidence.observedAt === "number" &&
    Number.isSafeInteger(evidence.observedAt) &&
    evidence.observedAt >= 0
  );
}

// ---------------------------------------------------------------------------
// Tenant-scoped declarations
// ---------------------------------------------------------------------------

/**
 * A game-declared achievement definition as the platform registers it:
 * the platform-contracts shape, tenant-scoped at registration (R20).
 * Games declare the pure shape; the platform owns the scoping.
 */
export interface TenantAchievementDefinition extends AchievementDefinition {
  readonly tenant: TenantId;
}

// ---------------------------------------------------------------------------
// Condition predicates
// ---------------------------------------------------------------------------

/**
 * A pure predicate over event evidence: which achievement it advances
 * and by how much. Both members are pure functions; closures capture
 * only the (immutable) binding.
 */
export interface ConditionPredicate {
  readonly achievement: AchievementId;
  /** True when this evidence's event kind matches the binding. */
  readonly matches: (evidence: AchievementEventEvidence) => boolean;
  /** The increment this evidence contributes, when it matches. */
  readonly incrementOf: (evidence: AchievementEventEvidence) => number | undefined;
}

/** Derive the predicate for one game-declared event binding (lock 18). */
export function predicateForBinding(binding: AchievementEventBinding): ConditionPredicate {
  const kind = String(binding.eventKind);
  return {
    achievement: binding.achievement,
    matches: (evidence) => String(evidence.eventKind) === kind,
    incrementOf: (evidence) => (String(evidence.eventKind) === kind ? binding.increment : undefined),
  };
}

/** Derive the predicates for a whole binding set. */
export function predicatesForBindings(bindings: readonly AchievementEventBinding[]): readonly ConditionPredicate[] {
  return bindings.map(predicateForBinding);
}

/** Filter a predicate set down to the ones this evidence advances. */
export function applicablePredicates(
  predicates: readonly ConditionPredicate[],
  evidence: AchievementEventEvidence,
): readonly ConditionPredicate[] {
  return predicates.filter((predicate) => predicate.matches(evidence));
}

// ---------------------------------------------------------------------------
// Threshold folds
// ---------------------------------------------------------------------------

/** Pure monotonic accumulation: progress only ever grows. */
export function progressAfter(current: number, increment: number): number {
  return current + increment;
}

/** Pure threshold check against a definition (used for read models). */
export function conditionSatisfied(definition: Pick<AchievementDefinition, "threshold">, current: number): boolean {
  return current >= definition.threshold;
}
