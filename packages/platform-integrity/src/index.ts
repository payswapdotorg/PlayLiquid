/**
 * @playliquid/platform-integrity — public surface (PL-018).
 *
 * The platform competitive-integrity service (R7/R11, lock 17/29):
 * behavioral-evidence evaluation over frozen platform-contracts shapes,
 * consuming replay artifacts as typed read-only input. Reports and
 * verdicts are probabilistic evidence/confidence/risk only — certainty
 * fields are unrepresentable and enforcement lives outside (the host
 * composes the frozen `decideEnforcement` oracle). Replay command
 * streams and re-execution verdicts are verified, never mutated; the
 * evaluation history is append-only (recomputation mints new versions);
 * every identifier is content-derived (deterministic, E9); persistence,
 * time and grants are injected ports (E6).
 *
 * Module map:
 * - digest.ts        pure FIPS 180-4 SHA-256 + canonical JSON + id slugs
 * - observations.ts  deterministic behavioral statistics (JSON-safe)
 * - policy.ts        the typed evaluation policy seam + frozen default
 * - signals.ts       policy-calibrated signal evaluation (honest intervals)
 * - verdicts.ts      frozen-vocabulary verdict classification + minting
 * - admission.ts     the fail-closed evaluation admission oracle
 * - minting.ts       pure artifact minting (evidence/report/verdict)
 * - service.ts       THE service: single mutable-state owner
 * - results.ts       typed door results (incl. duplicate-receipt shape)
 * - ports.ts         store/clock/grants ports + state document shapes
 * - document.ts      snapshot serialization + tamper-evident adoption
 * - fakes.ts         deterministic in-memory doubles + trace fixtures
 * - adapter.ts       the RewardIntegrityPort-compatible economy seam
 *
 * Purity: the whole package is domain-pure — no IO, no timers, no
 * globals, no randomness. Only `process.exitCode` is touched (by the
 * harness, on failure).
 */

// Values
export { canonicalJson, sha256Hex, digestOf, digestSlug } from "./digest.ts";
export {
  extractTimingObservations,
  extractTrajectoryObservations,
  extractOutcomeObservations,
} from "./observations.ts";
export { DEFAULT_INTEGRITY_RISK_POLICY, validateIntegrityRiskPolicy } from "./policy.ts";
export {
  evaluateTimingSignal,
  evaluateTrajectorySignal,
  evaluateOutcomeSignal,
  evaluateIntegritySignals,
} from "./signals.ts";
export { classifyIntegrityRisk, mintIntegrityRiskVerdict, verdictFollowsReport } from "./verdicts.ts";
export { admitEvaluation, bareHexOf } from "./admission.ts";
export { mintEvaluationArtifacts } from "./minting.ts";
export { IntegrityService } from "./service.ts";
export { adoptDocument, documentOf, citationsOf } from "./document.ts";
export { isIntegrityStateDocument } from "./ports.ts";
export {
  createMemoryIntegrityStore,
  createFixedClock,
  createMemoryGrantDirectory,
  integrityAdminGrant,
  integritySubmitGrant,
  humanLikeTrace,
  machineLikeTrace,
  matchObservation,
  divergenceObservation,
  inconclusiveObservation,
  demoTenant,
  demoSubject,
  demoOperator,
} from "./fakes.ts";
export { createRewardIntegrityAdapter } from "./adapter.ts";

// Types — observations
export type {
  TimingObservations,
  TrajectoryObservations,
  OutcomeObservations,
  BehavioralObservations,
} from "./observations.ts";

// Types — policy
export type {
  PolicyConfidenceLevel,
  ModeCalibration,
  VerdictThresholds,
  IntegrityRiskPolicy,
  PolicyValidation,
  PolicyRefusalCode,
} from "./policy.ts";

// Types — signals
export type { EvidenceRefsByKind, SignalEvaluation } from "./signals.ts";

// Types — verdicts
export type { VerdictMint } from "./verdicts.ts";

// Types — admission
export type {
  ReplaySourceRef,
  PlayModeClaim,
  ReplayReexecutionObservation,
  IntegrityEvaluationRequest,
  AdmittedEvaluation,
  EvaluationAdmission,
  AdmissionRefusalCode,
} from "./admission.ts";

// Types — minting
export type { MintedArtifacts } from "./minting.ts";

// Types — service + results
export type {
  IntegrityRefusal,
  EvaluationResult,
  ReportReadResult,
  VerdictReadResult,
  EvidenceReadResult,
  HistoryResult,
  StandingResult,
  SnapshotResult,
  RestoreResult,
} from "./results.ts";

// Types — ports + document
export type {
  StoredIntegritySnapshot,
  IntegrityStore,
  ServiceClock,
  GrantDirectory,
  EvaluationReceipt,
  IntegrityStateDocument,
  IntegrityServiceOptions,
} from "./ports.ts";
export type { AdoptedState, AdoptionResult } from "./document.ts";

// Types — adapter
export type {
  RewardIntegrityQueryLike,
  RewardIntegrityReadingLike,
  RewardIntegrityAdapterOptions,
  RewardIntegrityAdapter,
} from "./adapter.ts";
