/**
 * Public barrel of `@playliquid/build-contracts` — the build pipeline
 * contract layer (PL-008). Imports `@playliquid/game-ir` (kernel value
 * language) and `@playliquid/package-system` (lockfile, provenance, CAS
 * and digest vocabulary — the digest/CAS authority, E7), per the module
 * dependency matrix row `build-contracts | Build | game-ir, package-system`.
 *
 * The `@playliquid/tool-fabric` / `@playliquid/engine-adapter-contract`
 * vocabulary build inputs cite rides the documented PL-005 seam
 * (`adapter-seam.ts`) until that Work Order merges.
 *
 * Fixtures and deterministic fakes (`fixtures.ts`) are deliberately NOT
 * exported from this barrel.
 */

// Primitives
export type {
  Brand,
  BuildId,
  BuildTargetId,
  BuildArtifactKind,
  VendorId,
  RequesterId,
  BuildNonce,
  ToolchainProfileId,
  ProfileInputId,
} from "./primitives.ts";
export {
  asBuildId,
  asBuildTargetId,
  asVendorId,
  asRequesterId,
  asBuildNonce,
  asToolchainProfileId,
  asProfileInputId,
  isBuildArtifactKind,
  isNonEmptyIdText,
} from "./primitives.ts";

// PL-005 seam (engine binding + tool operations)
export type { EngineId, ToolOperationId, EngineBindingRef } from "./adapter-seam.ts";
export {
  asEngineId,
  asToolOperationId,
  isValidEngineId,
  isValidToolOperationId,
  isEngineBindingRef,
} from "./adapter-seam.ts";

// Build inputs
export type {
  VendorGateRequirement,
  GameIrInputRef,
  PackageLockInputRef,
  TargetProfileInputRef,
  ToolchainProfileRef,
  BuildInputs,
  BuildInputName,
  BuildInputViolation,
  BuildInputViolationCode,
  BuildInputsValidation,
} from "./inputs.ts";
export {
  isVendorGateRequirement,
  BUILD_INPUT_NAMES,
  validateBuildInputs,
  computeBuildInputsDigest,
} from "./inputs.ts";

// Stage vocabulary and phase machine
export type { BuildStage, BuildPhase, BuildPhaseTransitionResult } from "./stages.ts";
export {
  BUILD_STAGES,
  BUILD_PHASES,
  BUILD_PHASE_TRANSITIONS,
  COMPLETE_STAGE_SEQUENCE,
  isBuildStage,
  isBuildPhase,
  isTerminalBuildPhase,
  canTransitionBuildPhase,
  checkBuildPhaseTransition,
  isCompleteStageSequence,
} from "./stages.ts";

// Commands, idempotency, admission
export type {
  BuildParameters,
  BuildIdempotencyScope,
  BuildIdempotencyKey,
  BuildCommandKind,
  BuildRequestCommand,
  CancelBuildCommand,
  BuildCommand,
  AdmittedBuildRequest,
  BuildStateRecord,
  BuildRequestEncounter,
  BuildAdmissionContext,
  BuildAdmissionErrorCode,
  BuildAdmissionRejection,
  BuildRequestAdmission,
  CancelAdmissionResult,
} from "./commands.ts";
export {
  BUILD_IDEMPOTENCY_SCOPES,
  BUILD_COMMAND_KINDS,
  buildIdempotencyKeyEquals,
  computeBuildRequestFingerprint,
  admitBuildRequest,
  buildInputDigests,
  admitCancelBuild,
  requestTarget,
} from "./commands.ts";

// Outputs
export type {
  BuildArtifact,
  BuildStepRecord,
  BuildInputsDigestSummary,
  BuildManifest,
  BuildProvenanceEvidence,
  BuildOutputs,
} from "./outputs.ts";
export { isBuildArtifact, computeBuildManifestDigest } from "./outputs.ts";

// Verification + provenance gates (R19, console truth)
export type {
  VerificationVerdict,
  VendorSdkAuthorization,
  VerificationEvidenceKind,
  EvaluationSuiteEvidence,
  VendorSdkEvidence,
  OnTargetEvidence,
  VerificationEvidence,
  VendorSdkGateInput,
  VendorSdkGateFailureCode,
  VendorSdkGateFailure,
  VendorSdkGateResult,
  BuildProvenanceGateFailure,
  BuildProvenanceGateResult,
} from "./verification.ts";
export {
  isVendorSdkAuthorization,
  VERIFICATION_EVIDENCE_KINDS,
  checkVendorSdkGate,
  checkBuildProvenanceGate,
} from "./verification.ts";

// Composition validation
export type { BuildOutputViolationCode, BuildOutputViolation, BuildOutputsValidation } from "./validate.ts";
export { validateBuildOutputs } from "./validate.ts";

// Port (not engines)
export type { BuildExecutionCommand, BuildExecutionErrorCode, BuildExecutionResult, BuildExecutor } from "./executor.ts";
