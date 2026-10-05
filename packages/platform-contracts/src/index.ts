/**
 * Public barrel of `@playliquid/platform-contracts` (PL-004).
 *
 * The typed capability surface of every GameOS platform service (R7,
 * lock rule 17): per-capability request/response contracts, the
 * game-declared semantic event vocabulary (lock 18), entitlement/economy
 * idempotency (R10), probabilistic integrity evidence (R11/E11), tenant
 * isolation and least privilege (R20), and pure cross-capability policy
 * validators. Pure types and pure functions only — no IO, no storage, no
 * service implementations (those are PL-015..PL-018).
 *
 * Imports `@playliquid/game-contracts` only, per
 * spec/module-dependency-matrix.md (platform-contracts | game-contracts).
 */

// Primitives
export {
  asTenantId,
  asSubjectId,
  asContentDigest,
  asTimestampMs,
  isValidContentDigest,
  PLATFORM_AUTHORITY,
  isPlatformAuthorityMarker,
} from "./primitives.ts";
export type {
  TenantId,
  SubjectId,
  ContentDigest,
  TimestampMs,
  PlatformAuthorityMarker,
} from "./primitives.ts";

// Semantic event vocabulary (lock 18)
export {
  PLATFORM_EVENT_KIND_PREFIX,
  EVENT_KIND_PATTERN,
  isValidEventKindText,
  isReservedPlatformEventKind,
  asGameEventKind,
  PLATFORM_AUTHORITY_EVENT_KINDS,
  isPlatformAuthorityEventKind,
  isGameDeclaredEvent,
  isPlatformAuthorityEvent,
  isGameSemanticEventDeclaration,
} from "./events.ts";
export type {
  GameEventKind,
  PlatformAuthorityEventKind,
  UntrustedClientInput,
  GameDeclaredEvent,
  PlatformAuthorityEvent,
  GameSemanticEventDeclaration,
} from "./events.ts";

// Tenant isolation + least privilege (R20)
export {
  asNamedTenantId,
  isTenantScopeDeclaration,
  isIsolationBoundaryDescriptor,
  checkTenantIsolation,
  isCapabilityPermission,
  isScopedCapabilityGrant,
  checkLeastPrivilege,
  CAPABILITY_PERMISSIONS,
} from "./tenancy.ts";
export type {
  NamedTenantId,
  TenantScoped,
  TenantScopedFor,
  TenantScopeDeclaration,
  IsolationBoundaryDescriptor,
  TenantIsolationCheck,
  CapabilityPermission,
  ScopedCapabilityGrant,
  CapabilityUseRequest,
  PrivilegeCheck,
} from "./tenancy.ts";

// Leaderboard (R7)
export {
  asLeaderboardId,
  isLeaderboardServicePolicy,
  isLeaderboardEventBinding,
  validateScoreRecord,
  isLeaderboardQueryRequest,
  rankLeaderboardEntries,
} from "./leaderboard.ts";
export type {
  LeaderboardId,
  LeaderboardServicePolicy,
  LeaderboardEventBinding,
  AuthoritativeScoreRecord,
  ClientScoreClaim,
  ScoreRecordValidation,
  LeaderboardQueryRequest,
  LeaderboardEntry,
  LeaderboardPage,
  LeaderboardOrdering,
} from "./leaderboard.ts";

// Multiplayer (R7, R9 / lock 19)
export {
  asMatchSessionId,
  asMatchmakingTicketId,
  isMultiplayerServicePolicy,
  isMultiplayerEventBinding,
  isMatchmakingRequest,
  decideAdmission,
  validatePlatformOutcome,
} from "./multiplayer.ts";
export type {
  MatchSessionId,
  MatchmakingTicketId,
  MultiplayerServicePolicy,
  ProtectedOutcomeKind,
  MultiplayerEventBinding,
  MatchmakingRequest,
  MatchmakingTicketStatus,
  MatchmakingTicket,
  SessionAdmissionRequest,
  SessionAdmissionFacts,
  SessionAdmissionDecision,
  MatchStanding,
  PlatformOutcomeRecord,
  ClientPlayResultClaim,
  OutcomeRecordValidation,
} from "./multiplayer.ts";

// Replay (R7, R8 / lock 15)
export {
  asReplayId,
  isReplayServicePolicy,
  isReplayEventBinding,
  isReplayArtifactDescriptor,
  isReplayQueryRequest,
  authorizeReplayAccess,
} from "./replay.ts";
export type {
  ReplayId,
  ReplayServicePolicy,
  ReplayEventBinding,
  ReplayArtifactDescriptor,
  ReplayQueryRequest,
  ReplayCatalogPage,
  ReplayAccessDecision,
} from "./replay.ts";

// Entitlements / economy (R10, lock 41)
export {
  asEntitlementGrantId,
  asLedgerEntryId,
  grantIdempotencyKeyEquals,
  isEntitlementGrant,
  settleGrant,
  settleLedgerEntry,
  isRewardRuleBinding,
  issueRewards,
} from "./entitlements.ts";
export type {
  EntitlementGrantId,
  LedgerEntryId,
  GrantIdempotencyKey,
  GrantCausation,
  EntitlementGrant,
  GrantDisposition,
  GrantRefusalCode,
  LedgerReason,
  LedgerEntry,
  LedgerSettlement,
  RewardRuleBinding,
  RewardIssuanceRequest,
  RewardIssuanceResult,
} from "./entitlements.ts";

// Achievements (R7)
export {
  asAchievementId,
  isAchievementDefinition,
  isAchievementEventBinding,
  isAchievementProgress,
  evaluateUnlock,
  isAchievementQueryRequest,
} from "./achievements.ts";
export type {
  AchievementId,
  AchievementDefinition,
  AchievementEventBinding,
  AchievementProgress,
  UnlockEvaluation,
  AchievementQueryRequest,
  AchievementProgressPage,
} from "./achievements.ts";

// Social (R7)
export {
  SOCIAL_GRAPH_KINDS,
  isSocialGraphKind,
  isSocialServicePolicy,
  isSocialEventBinding,
  SOCIAL_ACTIONS,
  isSocialAction,
  isSocialActionRequest,
  adjudicateSocialAction,
} from "./social.ts";
export type {
  SocialGraphKind,
  SocialServicePolicy,
  SocialEventBinding,
  SocialAction,
  SocialActionRequest,
  SocialGraphFacts,
  SocialActionDecision,
  SocialRelation,
} from "./social.ts";

// Analytics (R7)
export {
  ANALYTICS_PRIVACY_CLASSES,
  ANALYTICS_FORBIDDEN_PAYLOAD_KEYS,
  isForbiddenAnalyticsPayloadKey,
  isAnalyticsServicePolicy,
  isAnalyticsEventBinding,
  ingestAnalyticsBatch,
} from "./analytics.ts";
export type {
  AnalyticsPrivacyClass,
  AnalyticsServicePolicy,
  AnalyticsEventBinding,
  AnalyticsEventRecord,
  AnalyticsSubmissionRequest,
  AnalyticsRejection,
  AnalyticsIngestReceipt,
} from "./analytics.ts";

// Moderation (R7, E8)
export {
  asModerationReportId,
  asModerationCaseId,
  MODERATION_SURFACES,
  isModerationSurface,
  MODERATION_SEVERITY_ORDER,
  isModerationSeverity,
  severityRank,
  isModerationServicePolicy,
  isModerationEventBinding,
  isModerationReport,
  requiredEvidenceCount,
  assessModerationReport,
  isModerationCaseDecision,
  adjudicateAppeal,
} from "./moderation.ts";
export type {
  ModerationReportId,
  ModerationCaseId,
  ModerationSurface,
  ModerationSeverity,
  ModerationServicePolicy,
  ModerationEventBinding,
  ModerationReport,
  ModerationReportDisposition,
  ModerationCaseDecision,
  ModerationAppeal,
  AppealDecision,
} from "./moderation.ts";

// Competitive integrity (R7, R11 / E11)
export {
  asIntegrityReportId,
  isValidConfidenceInterval,
  isIntegrityEvidenceRef,
  INTEGRITY_SIGNAL_KINDS,
  isIntegritySignalKind,
  AI_PLAY_MODES,
  isAiPlayMode,
  FORBIDDEN_INTEGRITY_FIELDS,
  isForbiddenIntegrityField,
  isIntegrityReport,
  aggregateIntegritySignals,
  validateIntegrityReport,
  isIntegrityEventBinding,
} from "./integrity.ts";
export type {
  IntegrityReportId,
  ConfidenceInterval,
  IntegrityEvidenceRef,
  IntegritySignalKind,
  AiPlayMode,
  IntegritySignal,
  IntegrityEnforcement,
  IntegrityAggregate,
  IntegrityReport,
  IntegrityReportValidation,
  IntegrityEventBinding,
} from "./integrity.ts";

// Cross-capability composition rules (lock 18 enforcement)
export {
  isCapabilityEventBinding,
  isPlatformPolicyDeclaration,
  validateCapabilityPolicy,
} from "./policy.ts";
export type {
  CapabilityEventBinding,
  PlatformPolicyDeclaration,
  PolicyRejectionReason,
  CapabilityPolicyValidation,
} from "./policy.ts";
