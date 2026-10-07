/**
 * Public barrel of `@playliquid/target-profiles` — the target/profile
 * contract layer (PL-008). Imports `@playliquid/game-ir` (kernel value
 * language) and `@playliquid/runtime-contracts` (Experience Protocol
 * vocabulary) per the work order dependency list.
 *
 * The `@playliquid/engine-adapter-contract` vocabulary rides the
 * documented PL-005 seam (`engine-seam.ts`) until that Work Order merges.
 *
 * Fixtures (`fixtures.ts`) are deliberately NOT exported from this barrel.
 */

// Primitives
export type { Brand, ProfileDigest, EngineId, EngineBindingDigest, VendorId } from "./primitives.ts";
export {
  asProfileDigest,
  asEngineId,
  asEngineBindingDigest,
  asVendorId,
  isProfileDigest,
  isValidEngineId,
  isEngineBindingDigest,
  isNonEmptyIdText,
} from "./primitives.ts";

// Frozen taxonomy + R12 workflow classes
export type { TargetId, TargetWorkflowClass } from "./taxonomy.ts";
export {
  TARGETS,
  WORKFLOW_CLASSES,
  TARGET_WORKFLOW_CLASSES,
  isTargetId,
  isWorkflowClass,
  targetWorkflowClass,
  targetsOfWorkflowClass,
} from "./taxonomy.ts";

// Capability descriptors
export type { RenderApiClass, VramClass, InputModality, ScreenShape, TargetCapabilities } from "./capabilities.ts";
export {
  RENDER_API_CLASSES,
  VRAM_CLASSES,
  INPUT_MODALITIES,
  isRenderApiClass,
  isVramClass,
  isInputModality,
  isTargetCapabilities,
} from "./capabilities.ts";

// PL-005 seam (engine binding vocabulary)
export type { EngineBindingDescriptor, EngineBindingCompatibility } from "./engine-seam.ts";
export { isEngineBindingDescriptor, isEngineBindingCompatibility } from "./engine-seam.ts";

// Records
export type {
  RuntimeKind,
  RuntimePolicyBinding,
  EvaluationSuiteRef,
  AuthorizedVendorSdkMarker,
  ConsoleTargetProperties,
  TargetProfileRecordCore,
  TargetProfileRecord,
  SparkTargetProfileRecord,
  ConsoleTargetProfileRecord,
  PlainTargetProfileRecord,
  UnsealedTargetProfileRecord,
  DistributiveOmit,
  TargetProfileErrorCode,
  TargetProfileValidationFailure,
  TargetProfileValidation,
} from "./records.ts";
export {
  RUNTIME_KINDS,
  isRuntimeKind,
  isEvaluationSuiteRef,
  isAuthorizedVendorSdkMarker,
  validateTargetProfileRecord,
} from "./records.ts";

// Seal/append discipline
export { canonicalProfileForm, computeProfileDigest, sealTargetProfileRecord, verifyTargetProfileDigest } from "./digest.ts";

// Compatibility validation
export type { EngineCompatibilityErrorCode, EngineCompatibilityResult } from "./compatibility.ts";
export { checkEngineBindingCompatibility } from "./compatibility.ts";
