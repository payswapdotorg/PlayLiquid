/**
 * @playliquid/platform-achievements — public surface (PL-015).
 *
 * The achievements service: condition evaluation as pure predicates
 * over event evidence, award-once semantics with evidence-keyed
 * idempotency, progress tracking and tenant isolation, implemented
 * over `@playliquid/platform-contracts` per spec/module-dependency-
 * matrix.md row `achievements | Platform | platform-contracts`.
 *
 * Module map:
 * - digest.ts      pure SHA-256 + byte-stable canonical JSON (E9)
 * - conditions.ts  event evidence, condition predicates, threshold folds
 * - progress.ts    progression state, award records, the application fold
 * - ports.ts       store, clock, grant directory ports
 * - service.ts     the achievements service (the mutable-state owner)
 * - fakes.ts       deterministic in-memory fakes for tests/harness
 *
 * Purity: the domain has no IO, no timers, no globals; every effect
 * lives behind a port. The service instance is the single
 * mutable-state owner.
 */

// Values
export { canonicalJson, sha256Hex, digestOf } from "./digest.ts";
export {
  isAchievementEventEvidence,
  predicateForBinding,
  predicatesForBindings,
  applicablePredicates,
  progressAfter,
  conditionSatisfied,
} from "./conditions.ts";
export {
  isSubjectProgressState,
  awardRecordId,
  authorityEventOfAward,
  applyEvidence,
} from "./progress.ts";
export { isAchievementsStateDocument } from "./ports.ts";
export { AchievementsService } from "./service.ts";
export {
  FAKE_ACHIEVEMENT_EVENT_KINDS,
  createMemoryAchievementsStore,
  createFixedClock,
  createMemoryGrantDirectory,
  achievementsAdminGrant,
  achievementsSubmitGrant,
} from "./fakes.ts";

// Types — conditions
export type {
  AchievementEventEvidence,
  TenantAchievementDefinition,
  ConditionPredicate,
} from "./conditions.ts";
// Types — progress
export type {
  SubjectProgressState,
  AchievementAwardRecord,
  ProgressApplication,
} from "./progress.ts";
// Types — ports
export type {
  DefinitionRow,
  BindingRow,
  ProgressRow,
  AchievementsStateDocument,
  StoredAchievementsSnapshot,
  AchievementsStore,
  ServiceClock,
  GrantDirectory,
} from "./ports.ts";
// Types — service
export type {
  AchievementsServiceOptions,
  AchievementOutcome,
  EvidenceSubmissionResult,
  AchievementsRefusal,
} from "./service.ts";
