/**
 * Public barrel of `@playliquid/lab-contracts` — the typed contract layer
 * of the Game Engineering Lab (Work Order PL-006).
 *
 * Imports `@playliquid/game-contracts` and `@playliquid/game-ir` only,
 * per the module dependency matrix (lab-contracts | Lab | game-contracts,
 * game-ir). Fixtures/fakes live in `fixtures.ts` and are deliberately NOT
 * part of the public surface (house pattern of game-ir).
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type {
  OrganizationId,
  LabCycleId,
  EvidenceRecordId,
  DiagnosisId,
  HypothesisId,
  CandidateEvaluationId,
  ImplementationCandidateId,
  ReleaseId,
  ObservationId,
  CalibrationId,
  GapRecordId,
  ArenaEscalationId,
  AgentRoleId,
  CapabilityId,
  MemoryStoreId,
  ReviewGateId,
  LabEvaluationSuiteId,
  LabEvaluationMetricId,
  EvaluationSeed,
  ContentDigest,
  TimestampMs,
} from "./primitives.ts";
export {
  asOrganizationId,
  asLabCycleId,
  asEvidenceRecordId,
  asDiagnosisId,
  asHypothesisId,
  asCandidateEvaluationId,
  asImplementationCandidateId,
  asReleaseId,
  asObservationId,
  asCalibrationId,
  asGapRecordId,
  asArenaEscalationId,
  asAgentRoleId,
  asCapabilityId,
  asMemoryStoreId,
  asReviewGateId,
  asLabEvaluationSuiteId,
  asLabEvaluationMetricId,
  asEvaluationSeed,
  isValidContentDigest,
  asContentDigest,
  asTimestampMs,
  sealRecord,
} from "./primitives.ts";

// ---------------------------------------------------------------------------
// External-authority seams (ZCode model routing, Agent Bodies, tools)
// ---------------------------------------------------------------------------

export type { ZCodeModelRouteId, ZCodeModelRoutingAuthority, ZCodeModelAssignmentRef, AgentBodyId, AgentBodyRef, AgentToolId, AgentToolRef } from "./seams.ts";
export {
  asZCodeModelRouteId,
  isZCodeModelAssignmentRef,
  asAgentBodyId,
  isAgentBodyRef,
  asAgentToolId,
  isAgentToolRef,
} from "./seams.ts";

// ---------------------------------------------------------------------------
// Organization model (R16, lock 25/26)
// ---------------------------------------------------------------------------

export type {
  HumanParticipationMode,
  CommunicationChannelKind,
  SchedulingMode,
  BudgetResourceKind,
  MemoryStoreScope,
  OrganizationAgent,
  CapabilityAllocation,
  CommunicationEdge,
  DelegationEdge,
  TopologyEdge,
  MemoryStore,
  MemoryAccessGrant,
  MemoryTopology,
  HumanParticipant,
  HumanParticipationPlan,
  BudgetLine,
  SchedulingPolicy,
  ReviewGate,
  ReviewStructure,
  OrganizationDescriptor,
  OrganizationSearchContext,
  TaskDifficulty,
} from "./organization.ts";
export {
  GENERALIST_ROLE,
  HUMAN_PARTICIPATION_MODES,
  isHumanParticipationMode,
  COMMUNICATION_CHANNEL_KINDS,
  SCHEDULING_MODES,
  BUDGET_RESOURCE_KINDS,
  MEMORY_STORE_SCOPES,
  TASK_DIFFICULTY_LEVELS,
  generalistBaselineOrganization,
  isGeneralistBaselineOrganization,
  isOrganizationDescriptor,
} from "./organization.ts";
export type {
  OrganizationViolationCode,
  OrganizationViolation,
  OrganizationValidationResult,
} from "./organization-validation.ts";
export { validateOrganization } from "./organization-validation.ts";

// ---------------------------------------------------------------------------
// Epistemic labeling (E11, lock 28/29)
// ---------------------------------------------------------------------------

export type {
  EstimateMethod,
  LabeledEstimateMarker,
  ObservedEvidenceMarker,
  ObservedEvidence,
  LabeledEstimate,
  SimulatorOutput,
  Counterfactual,
  EstimateProvenance,
  EpistemicClass,
} from "./estimates.ts";
export {
  ESTIMATE_METHODS,
  isEstimateMethod,
  isObservedEvidence,
  isLabeledEstimate,
  isSimulatorOutput,
  isCounterfactual,
  epistemicClassOf,
} from "./estimates.ts";

// ---------------------------------------------------------------------------
// Evaluation-suite seam (game-ir consumption)
// ---------------------------------------------------------------------------

export type { LabEvaluationSuiteRef, LabEvaluationMetric, LabEvaluationSuite, EvaluationMetricReading, EvaluationSuiteResolver } from "./evaluation-suites.ts";
export { isLabEvaluationSuiteRef, isLabEvaluationMetric } from "./evaluation-suites.ts";

// ---------------------------------------------------------------------------
// Lab evaluation contracts (candidate-evaluation record + ports)
// ---------------------------------------------------------------------------

export type {
  CandidateEvaluationRecord,
  OrganizationEvaluationRequest,
  OrganizationEvaluator,
  CandidateEvaluationRefusal,
  CandidateEvaluationResult,
  RecordCandidateEvaluationParams,
  CandidateEvaluationViolationCode,
  CandidateEvaluationViolation,
  CandidateEvaluationValidation,
} from "./evaluation.ts";
export {
  recordCandidateEvaluation,
  validateCandidateEvaluationRecord,
  isCandidateEvaluationRecord,
} from "./evaluation.ts";

// ---------------------------------------------------------------------------
// Evidence immutability (E10, lock 27)
// ---------------------------------------------------------------------------

export type {
  ProjectEvidenceKind,
  ProjectEvidenceRecord,
  ObservedOutcomeRecord,
  CalibrationConclusion,
  ProjectEvidenceLedger,
  ObservationLedger,
  ProjectEvidenceAppendRefusal,
  ProjectEvidenceAppendResult,
  ObservationAppendRefusal,
  ObservationAppendResult,
  CalibrationAppendRefusal,
  CalibrationAppendResult,
} from "./evidence.ts";
export {
  PROJECT_EVIDENCE_KINDS,
  isProjectEvidenceKind,
  EMPTY_PROJECT_EVIDENCE_LEDGER,
  EMPTY_OBSERVATION_LEDGER,
  appendProjectEvidence,
  appendObservation,
  appendCalibrationConclusion,
  findProjectEvidence,
  findObservation,
  findCalibrationConclusion,
} from "./evidence.ts";

// ---------------------------------------------------------------------------
// Capability-gap ladder (R18, lock 30/31/32)
// ---------------------------------------------------------------------------

export type {
  GapLadderRung,
  ArenaEscalationRef,
  GapRungOutcome,
  AutonomousRungAttempt,
  CommunityRungAttempt,
  ArenaRungAttempt,
  BlockedRungAttempt,
  GapRungAttempt,
  CapabilityGapRecord,
  GapAppendRefusal,
  GapAppendResult,
  GapViolationCode,
  GapViolation,
  GapValidationResult,
} from "./gap-ladder.ts";
export {
  GAP_LADDER_RUNGS,
  isGapLadderRung,
  GAP_LADDER_TRANSITIONS,
  canAdvanceGapResolution,
  nextGapLadderRung,
  gapLadderPosition,
  isTerminalGapRung,
  isArenaEscalationRef,
  appendGapRungAttempt,
  validateGapRecord,
  isCapabilityGapRecord,
} from "./gap-ladder.ts";

// ---------------------------------------------------------------------------
// Lab loop stages and linkage (R16/R17)
// ---------------------------------------------------------------------------

export type {
  LabLoopStageKind,
  ProjectEvidenceStageRecord,
  DiagnosisStageRecord,
  HypothesisStageRecord,
  OrganizationSearchStageRecord,
  SimulationEvaluationStageRecord,
  ImplementationCandidateStageRecord,
  PrStageRecord,
  ReleaseStageRecord,
  ObservedOutcomeStageRecord,
  CalibrationStageRecord,
  LabLoopStageRecord,
  LabCycleRecord,
  LoopAppendRefusal,
  LoopAppendResult,
} from "./loop.ts";
export {
  LAB_LOOP_STAGE_KINDS,
  isLabLoopStageKind,
  LAB_LOOP_TRANSITIONS,
  canTransitionLoopStage,
  appendLoopStage,
} from "./loop.ts";
export type {
  LabCycleValidationStores,
  LabCycleViolationCode,
  LabCycleViolation,
  LabCycleValidationResult,
} from "./loop-validation.ts";
export { validateLabCycle } from "./loop-validation.ts";
