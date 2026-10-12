/**
 * @playliquid/lab-learning — public surface (PL-030).
 *
 * The learning layer of the Game Engineering Lab loop
 * (spec/architecture.md §Lab loop: "observed outcome → calibration → next
 * search"; R16/R17): tenant-scoped, append-only, content-addressed
 * learning-cycle records folding one completed Lab cycle's artifacts (the
 * observation ledger with its appended calibration conclusions, the
 * PL-028 evaluation run records' evidence digests, the PL-029 search
 * result digests); a deterministic PURE fold deriving typed learning
 * signals (dimension-level outcome affinities) and rung-classified
 * recurring capability-gap summaries (R18); and the top-level product — a
 * typed search-guidance object that parameterizes lab-organization's next
 * search request, with STRUCTURAL epistemic disjointness (E11, lock
 * 28/29): observed-evidence guidance and labeled-estimate guidance are
 * disjoint types, and a stripped or forged marker is a typed refusal.
 *
 * This package NEVER mutates any lab-contracts ledger (E10): all inputs
 * are read-only views; the only writes are appends to its own records.
 *
 * Pure domain: the LabLearningService instance is the single
 * mutable-state owner (E1); time and persistence live behind ports
 * (ports.ts) with deterministic in-memory fakes (fakes.ts) that wire the
 * REAL PL-029 search and PL-028 evaluation engines for tests and the
 * harness. No network, no Arena escalation runtime, no re-implementation
 * of lab-simulation's evaluation or lab-organization's compiler/search.
 *
 * Module map:
 * - records.ts        typed record vocabulary + refusal-code unions
 * - digest.ts         content-addressed identity + tamper oracles
 * - intake.ts         the learning-cycle admission oracle (E1/E8/E10/E11)
 * - gaps.ts           recurring gap-ladder summaries (R18)
 * - signals.ts        the deterministic signal fold (E9)
 * - guidance.ts       search guidance + the E11 marker discipline
 * - ports.ts          injected ports (clock, store)
 * - service-types.ts  service door types
 * - service.ts        LabLearningService — the state owner (R20 scoping)
 * - fakes.ts          deterministic in-memory fakes + the real-engine
 *                     journey stack (tests + harness)
 * - harness.ts        runtime evidence harness (node src/harness.ts)
 */

// Records — the typed vocabulary
export {
  isFoldedEvaluation,
  isLearningCycleRecord,
  asLearningRecordId,
} from "./records.ts";
export type {
  LabCycleLearningSubmission,
  FoldedOutcome,
  FoldedEvaluation,
  FoldedSearchResult,
  LearningCycleRecord,
  LearnRefusalCode,
  LearnAdmissionCode,
  LearningReadRefusalCode,
} from "./records.ts";

// Digest — content-addressed identity + tamper oracles
export {
  jsonSafeOf,
  learningDigestOf,
  learningIdentityDigestOf,
  learningRecordIdOf,
  learningContentOf,
  verifyLearningRecord,
  signalsStateDigestOf,
  guidanceDigestOf,
  guidanceBasisDigestOf,
} from "./digest.ts";
export type { LearningIdentityContent } from "./digest.ts";

// Intake — the admission oracle
export { foldSubmission, admitLearningCycle } from "./intake.ts";
export type { LearningIntakeKnownState, LearningIntakeResult, SubmissionFoldResult } from "./intake.ts";

// Gaps — R18 recurring gap summaries
export { deriveGapLadderSummaries } from "./gaps.ts";
export type { GapLadderSummary } from "./gaps.ts";

// Signals — the deterministic fold
export { LAB_DIMENSIONS, isLabDimension, blueprintDimensions, deriveLabLearningSignals } from "./signals.ts";
export type { LabDimension, DimensionOutcomeAffinity, LabLearningSignals } from "./signals.ts";

// Guidance — the top-level product + the E11 marker discipline
export {
  isGuidanceDerivationMode,
  deriveSearchGuidance,
  verifySearchGuidanceMarker,
  asObservedEvidenceGuidance,
  asLabeledEstimateGuidance,
} from "./guidance.ts";
export type {
  GuidanceDerivationMode,
  BaselinePromotionNote,
  DimensionBoundsAdjustment,
  EstimateDimensionSupport,
  ObservedEvidenceGuidance,
  LabeledEstimateGuidance,
  LabSearchGuidance,
  GuidanceRefusalCode,
  GuidanceDerivationResult,
  GuidanceVerificationResult,
} from "./guidance.ts";

// Ports — the host seams
export type { LabLearningClockPort, LabLearningDocument, LabLearningStore, LabLearningPorts, LabLearningCaller } from "./ports.ts";

// Service — the state owner
export { LabLearningService } from "./service.ts";
export type { LabLearningServiceOptions } from "./service.ts";
export type {
  LearnDoorResult,
  LearnDoorInput,
  LearningReadResult,
  SignalsDoorResult,
  GuidanceDoorResult,
  GuidanceDoorInput,
  VerifyGuidanceDoorResult,
  VerifyGuidanceDoorInput,
  RestoreDoorResult,
  GapSummariesDoorResult,
} from "./service-types.ts";

// Fakes — deterministic in-memory doubles + the real-engine journey stack
export { createFixedClock, createLearningStore, createLabLearningJourney } from "./fakes.ts";
export type { LabJourneyStack } from "./fakes.ts";
