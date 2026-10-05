/**
 * @playliquid/runtime-contracts — public surface (PL-003).
 *
 * Protocol layer between AUTHORITATIVE RUNTIME STATE and EXPERIENCES
 * (clients/UI/simulation drivers). Pure types and pure functions only:
 * no IO, no engine SDKs, no client implementation.
 *
 * Module map:
 * - primitives.ts      branded ids/scalars shared by all contracts
 * - game-ir-seam.ts    DOCUMENTED SEAM to @playliquid/game-ir (PL-001)
 * - session.ts         runtime session lifecycle + epoch semantics
 * - commands.ts        the single canonical command path (E2) + admission
 * - events.ts          the single canonical event path (E2) + order oracle
 * - experience.ts      Experience Protocol shared by both runtimes (lock 12)
 * - capability.ts      capability-mediated action protocol (lock 4/13/14)
 * - multiplayer.ts     untrusted claims vs authoritative outcomes (R9/19)
 * - jobs.ts            durable/queued/resumable work contracts (E6)
 * - idempotency.ts     idempotency keys + stale-result rule
 * - replay.ts          replay/resume boundary contracts (lock 15)
 * - spark.ts           Spark target profile types (R6, lock 16)
 */

// Values
export {
  TERMINAL_SESSION_PHASES,
  isTerminalSessionPhase,
  checkSessionPhaseTransition,
  makeSessionDescriptor,
  nextSessionEpoch,
} from "./session.ts";
export { admitCommand } from "./commands.ts";
export { validateEventStream, validateCanonicalPaths } from "./events.ts";
export { admitExperienceOperation, validateLoadRequest } from "./experience.ts";
export {
  EMPTY_BUDGET_LEDGER,
  consumeBudget,
  resolveActionRequest,
} from "./capability.ts";
export { sanitizeClaim, validateProtectedOutcome } from "./multiplayer.ts";
export { checkJobPhaseTransition, decideRetry, decideResume } from "./jobs.ts";
export {
  idempotencyKeyEquals,
  classifyEncounter,
  applyStaleResultRule,
  retainCurrentResults,
} from "./idempotency.ts";
export { validateReplayPlan, validateResumeBoundary } from "./replay.ts";
export { validateSparkProfile, asSparkProfileId } from "./spark.ts";
export {
  isValidDigest,
  isPositiveSequence,
  asSessionId,
  asCommandId,
  asEventId,
  asActorId,
  asIntentId,
  asActionRequestId,
  asCapabilityId,
  asCapabilityGrantId,
  asJobId,
  asClaimId,
  asOutcomeId,
  asSnapshotId,
  asTargetProfileId,
  asCheckpointRef,
  asIdempotencyNonce,
  asCommandKind,
  asEventKind,
  asIntentKind,
  asTimestamp,
  asTick,
  asCommandSequence,
  asEventSequence,
  asSessionEpoch,
  asDeterminismSeed,
  asDigest,
} from "./primitives.ts";
export { asGameIrDigest } from "./game-ir-seam.ts";

// Types
export type {
  Brand,
  SessionId,
  CommandId,
  EventId,
  ActorId,
  IntentId,
  ActionRequestId,
  CapabilityId,
  CapabilityGrantId,
  JobId,
  ClaimId,
  OutcomeId,
  SnapshotId,
  TargetProfileId,
  CheckpointRef,
  IdempotencyNonce,
  CommandKind,
  EventKind,
  IntentKind,
  Timestamp,
  Tick,
  CommandSequence,
  EventSequence,
  SessionEpoch,
  Digest,
  DeterminismSeed,
  ActorClass,
  ActorRef,
} from "./primitives.ts";
export type {
  GameIrDigest,
  WorldSchemaRef,
  AvatarDefinitionRef,
  RuntimePolicyRef,
  GameRefSummary,
} from "./game-ir-seam.ts";
export type {
  RuntimeSessionPhase,
  RuntimeRoleKind,
  RuntimeSessionDescriptor,
  RuntimeSessionSnapshotView,
  PhaseTransitionResult,
} from "./session.ts";
export type {
  CommandOrigin,
  RuntimeCommandEnvelope,
  CommandAdmissionPolicy,
  CommandRejectionCode,
  CommandAdmissionResult,
  CommandReceipt,
} from "./commands.ts";
export type {
  EventCause,
  RuntimeEventEnvelope,
  EventStreamErrorCode,
  EventStreamValidation,
  EventStreamValidationContext,
  CanonicalBehaviorPath,
  CanonicalPathViolation,
} from "./events.ts";
export type {
  TypedIntent,
  ExperienceOperationKind,
  LoadOperation,
  ResetOperation,
  ObserveOperation,
  ActOperation,
  StepOperation,
  SnapshotOperation,
  RestoreOperation,
  ReplayOperation,
  TerminateOperation,
  ExperienceOperation,
  ExperienceObservation,
  ExperienceAdmissionResult,
  ExperienceRejectionCode,
  LoadValidationResult,
} from "./experience.ts";
export type {
  GrantIssuer,
  GrantHolder,
  CapabilityScope,
  CapabilityConstraint,
  CapabilityGrant,
  BudgetLedger,
  BudgetCounter,
  BudgetResult,
  ActionRequest,
  ActionDenialReason,
  ActionResolution,
  BrokerContext,
} from "./capability.ts";
export type {
  ClientSubmittedClaim,
  ClientAssertedFields,
  ClaimEvidence,
  Untrusted,
  AuthorityMarker,
  AuthoritativeEvidence,
  ProtectedOutcomeKind,
  AuthoritativeMatchOutcome,
  MatchStanding,
  ProtectedOutcomeValidation,
  SanitizedClaimRecord,
  ClaimAdjudication,
  ClaimDisposition,
} from "./multiplayer.ts";
export type {
  RuntimeJobKind,
  CheckpointPolicy,
  ResumePolicy,
  RetryPolicy,
  CancellationPolicy,
  RuntimeJobDescriptor,
  RuntimeJobPhase,
  JobCheckpoint,
  JobResultRef,
  JobTransitionResult,
  ResumeOrigin,
  ResumeDecision,
  RetryDecision,
} from "./jobs.ts";
export type {
  IdempotencyScope,
  IdempotencyKey,
  PayloadFingerprint,
  EncounterClassification,
  EpochedResult,
  StaleResultDisposition,
} from "./idempotency.ts";
export type {
  SessionSnapshot,
  ReplayPlan,
  ReplayPlanErrorCode,
  ReplayPlanValidation,
  ReplayContext,
  ResumeBoundaryErrorCode,
  ResumeBoundaryValidation,
  ResumeCheckpointCandidate,
} from "./replay.ts";
export type {
  TargetProfile,
  SparkProfileId,
  SparkBootEntry,
  SparkBootBudget,
  SparkTargetProfile,
  SparkProfileValidation,
} from "./spark.ts";
