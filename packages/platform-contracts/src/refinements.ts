/**
 * PL-009 refinement re-export barrel for
 * `@playliquid/platform-contracts`.
 *
 * The public surface stays `src/index.ts` (package export `.`); this
 * module holds the EXPLICIT re-export lists of the PL-009 refinement
 * modules so the root barrel stays under the 400-line file budget
 * (validation/records split — the lab-contracts precedent). Every name
 * is listed explicitly; nothing is wildcarded from the source modules.
 *
 * Covered areas:
 * - Competitive-integrity evidence refinement (R11/E11): behavioral
 *   evidence records, risk verdicts with explicit confidence bands,
 *   participation-mode declarations, policy-driven enforcement.
 * - Economy/entitlement settlement refinement (R10): the entitlement
 *   lifecycle state machine, digest-pinned economy value carriers, and
 *   the settlement pipeline.
 * - Replay reuse-lane refinement (R8): per-lane request/view contracts,
 *   provenance linkage, and the QA assertion-harness records.
 *
 * Pure contracts only — no IO, no storage, no service implementations.
 */

// Behavioral evidence records (R11/E11 refinement)
export {
  asEvidenceRecordId,
  BEHAVIORAL_EVIDENCE_KINDS,
  isBehavioralEvidenceKind,
  isBehavioralEvidenceRecord,
  isEvidenceCitation,
  citationMatchesRecord,
  resolveEvidenceCitation,
} from "./integrity-evidence.ts";
export type {
  EvidenceRecordId,
  BehavioralEvidenceKind,
  EvidenceRecordMarker,
  BehavioralEvidenceRecord,
  EvidenceCitation,
} from "./integrity-evidence.ts";

// Integrity risk verdicts (R11 refinement)
export {
  asIntegrityVerdictId,
  INTEGRITY_VERDICT_KINDS,
  isIntegrityVerdictKind,
  verdictSeverityRank,
  VERDICT_CONFIDENCE_BANDS,
  isVerdictConfidenceBand,
  verdictBandRank,
  classifyVerdictConfidenceBand,
  FORBIDDEN_VERDICT_FIELDS,
  isForbiddenVerdictField,
  isIntegrityRiskVerdict,
  validateIntegrityRiskVerdict,
} from "./integrity-verdicts.ts";
export type {
  IntegrityVerdictId,
  IntegrityVerdictKind,
  VerdictConfidenceBand,
  IntegrityRiskVerdict,
  IntegrityVerdictValidation,
} from "./integrity-verdicts.ts";

// Participation-mode declarations (explicit AI-player modes)
export {
  PARTICIPATION_DECLARATION_KINDS,
  isParticipationDeclarationKind,
  isParticipationModeDeclaration,
  isDeclaredAiParticipation,
  isAssistParticipation,
  isHumanParticipation,
  participationModeOf,
  declarationsAreCoherent,
} from "./participation.ts";
export type {
  ParticipationDeclarationKind,
  HumanParticipationDeclaration,
  AssistParticipationDeclaration,
  DeclaredAiParticipationDeclaration,
  ParticipationModeDeclaration,
} from "./participation.ts";

// Policy-driven enforcement (evidence-before-enforcement)
export {
  asIntegrityEnforcementPolicyId,
  asEnforcementDecisionId,
  ENFORCEMENT_ACTION_KINDS,
  isEnforcementActionKind,
  isEnforcementRule,
  isIntegrityEnforcementPolicy,
  isIntegrityEnforcementDecision,
  decideEnforcement,
  validateEnforcementDecision,
} from "./integrity-enforcement.ts";
export type {
  IntegrityEnforcementPolicyId,
  EnforcementDecisionId,
  EnforcementActionKind,
  EnforcementRule,
  IntegrityEnforcementPolicy,
  IntegrityEnforcementDecision,
  EnforcementDecisionOutcome,
  EnforcementDecisionValidation,
} from "./integrity-enforcement.ts";

// Entitlement lifecycle (R10 refinement)
export {
  ENTITLEMENT_LIFECYCLE_STATES,
  ENTITLEMENT_LIFECYCLE_TRANSITIONS,
  ENTITLEMENT_REVOCATION_REASONS,
  isEntitlementLifecycleState,
  canTransitionEntitlement,
  isEntitlementRevocationReason,
  lifecycleCommandKeyEquals,
  isEntitlementLifecycleCommand,
  isEntitlementLifecycleRecord,
  openEntitlementLifecycle,
  admitLifecycleCommand,
} from "./entitlement-lifecycle.ts";
export type {
  EntitlementLifecycleState,
  EntitlementLifecycleOperation,
  LifecycleCommandKey,
  EntitlementRevocationReason,
  EntitlementLifecycleCommand,
  LifecycleTransitionRecord,
  EntitlementLifecycleRecord,
  LifecycleCommandDisposition,
} from "./entitlement-lifecycle.ts";

// Economy value carriers (zero numeric authority)
export {
  KERNEL_VALUE_KINDS,
  isKernelValueKind,
  isEconomyValueRef,
  asOpaqueEconomyValue,
  asTypedKernelValueReading,
  isQuantityReading,
  readingPinnedToShape,
} from "./economy-values.ts";
export type {
  KernelValueKind,
  OpaqueEconomyValue,
  TypedKernelValueReading,
  EconomyValueRef,
} from "./economy-values.ts";

// Entitlement settlement (R10 refinement)
export {
  asSettlementId,
  isSettlementEligibilityDeclaration,
  validateSettlement,
  isEntitlementSettlementRecord,
  admitSettlement,
} from "./settlement.ts";
export type {
  SettlementId,
  SettlementEligibilityDeclaration,
  SettlementValidationRequest,
  SettlementValidationVerdict,
  EntitlementSettlementRecord,
  SettlementAdmission,
} from "./settlement.ts";

// Replay reuse lanes (R8 refinement)
export {
  REPLAY_LANES,
  isReplayLane,
  isReplayLaneRequest,
  authorizeReplayLaneRequest,
} from "./replay-lanes.ts";
export type {
  ReplayLane,
  PlayerReplayRequest,
  QaReplayRequest,
  IntegrityReplayRequest,
  SimulationReplayRequest,
  LabReplayRequest,
  ReplayLaneRequest,
  PlayerReplayView,
  QaReplayView,
  IntegrityReplayView,
  SimulationReplayView,
  LabReplayView,
  ReplayLaneView,
  ReplayLaneDecision,
} from "./replay-lanes.ts";

// Replay provenance linkage (R8 refinement)
export {
  isReplayProvenanceLink,
  provenanceMatchesDescriptor,
  authoritativeRecordRefs,
} from "./replay-provenance.ts";
export type { ReplayProvenanceLink } from "./replay-provenance.ts";

// QA assertion harness over replays (R8 refinement)
export {
  asQaExpectationId,
  asQaExpectationResultId,
  REPLAY_EXPECTATION_KINDS,
  isReplayExpectationKind,
  isReplayExpectation,
  EXPECTATION_OUTCOMES,
  isExpectationOutcome,
  isReplayExpectationResult,
  validateExpectationResult,
} from "./qa-assertions.ts";
export type {
  QaExpectationId,
  QaExpectationResultId,
  ReplayExpectationKind,
  ReplayExpectation,
  ExpectationOutcome,
  ReplayExpectationResult,
  ExpectationResultValidation,
} from "./qa-assertions.ts";
