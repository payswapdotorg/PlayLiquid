/**
 * @playliquid/engine-unreal — public surface (PL-022).
 *
 * The Unreal engine adapter: an `engine.unreal` adapter implementing the
 * neutral Adapter seam from @playliquid/engine-adapter-contract,
 * registered into the Tool Fabric runtime (PL-019). Unreal-specific
 * behavior lives ONLY here, behind the neutral seam (E4). Unreal-side
 * execution stays behind the UnrealBridgePort (pure interface); the
 * in-memory fake bridge is the test host — the REAL bridge (Unreal
 * editor remote-execution / UnrealBuildTool cook & package pipeline
 * invocation) is a HOST concern, deliberately deferred (E11).
 *
 * Module map:
 * - payload-model.ts    desktop-native capability vocabulary + typed payload union
 * - payload-validate.ts total payload validation (E8)
 * - bridge-port.ts      the pure UnrealBridgePort seam (E3)
 * - command-id.ts       content-derived command identities (E9)
 * - evidence.ts         append-only digest-pinned evidence (E10)
 * - tenancy.ts          R20 tenant-isolation guard
 * - engine-binding.ts   typed desktop-class engine binding + compatibility predicate
 * - adapter.ts          the adapter (lifecycle, capability mediation,
 *                       client-claim rejection, deadline, duplicate ids)
 * - fake-bridge.ts      deterministic in-memory test host (E9/E11)
 * - digest.ts           canonical JSON + sha256 (E9/E10 seam)
 * - harness.ts          runtime evidence harness (node src/harness.ts)
 */

// Capability surface + payload model
export {
  UNREAL_ADAPTER_ID,
  UNREAL_ADAPTER_LABEL,
  UNREAL_BUILD_CONFIGURATIONS,
  UNREAL_BUILD_TARGET_PLATFORMS,
  UNREAL_EXPORT_FORMATS,
  UNREAL_EXPORT_MODES,
  UNREAL_IMPORT_FORMATS,
  UNREAL_INSPECT_SUBJECTS,
  UNREAL_OFFERED_CAPABILITIES,
  UNREAL_PAYLOAD_VERSION,
  UNREAL_PROPERTY_KINDS,
  payloadFamilyFor,
} from "./payload-model.ts";
export type {
  UnrealCommandPayload,
  UnrealCommandPayloadBase,
  UnrealInspectPayload,
  UnrealInspectActorPayload,
  UnrealInspectComponentPayload,
  UnrealModifyActorPayload,
  UnrealImportPayload,
  UnrealExportPayload,
  UnrealEditorActionPayload,
  UnrealEditorScriptPayload,
  UnrealPiePayload,
  UnrealCookPayload,
  UnrealPackagePayload,
  UnrealArtifactRef,
  UnrealActorEdit,
  UnrealPayloadFamily,
  UnrealPayloadRejection,
  UnrealPayloadRejectionCode,
  UnrealPayloadValidation,
} from "./payload-model.ts";

// Total payload validation
export { validateUnrealCommandPayload } from "./payload-validate.ts";

// Bridge port (pure seam)
export {
  UNREAL_BRIDGE_ERROR_CODES,
} from "./bridge-port.ts";
export type {
  UnrealBridgePort,
  UnrealBridgeInvocation,
  UnrealBridgeOutcome,
  UnrealClockPort,
  UnrealCommandKey,
} from "./bridge-port.ts";

// Command identities (E9)
export {
  UNREAL_COMMAND_ID_PREFIX,
  unrealCommandKey,
  unrealCommandId,
} from "./command-id.ts";

// Evidence (E10)
export {
  createUnrealEvidenceLedger,
} from "./evidence.ts";
export type {
  UnrealEvidenceLedger,
  UnrealExchangeRecord,
} from "./evidence.ts";

// Tenancy (R20)
export {
  validateUnrealTenantClaim,
  checkUnrealTenancy,
} from "./tenancy.ts";
export type {
  UnrealTenancyCheck,
  UnrealTenancyRejection,
  UnrealTenancyRejectionCode,
} from "./tenancy.ts";

// Typed desktop-class engine binding + compatibility predicate
export {
  UNREAL_ENGINE_ID,
  UNREAL_SUPPORTED_TARGETS,
  createUnrealEngineBinding,
  unrealCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
  isProjectedEngineBindingRef,
} from "./engine-binding.ts";
export type {
  UnrealEngineBinding,
  UnrealTargetCompatibility,
  UnrealBindingRefusalCode,
} from "./engine-binding.ts";

// The adapter
export { createUnrealAdapter } from "./adapter.ts";
export type {
  UnrealAdapter,
  UnrealAdapterOptions,
} from "./adapter.ts";

// Deterministic fakes (test doubles; E9/E11-labeled)
export {
  createFakeUnrealBridge,
  createFakeUnrealClock,
} from "./fake-bridge.ts";
export type {
  FakeUnrealBridge,
  FakeUnrealBridgeScript,
  FakeUnrealClock,
} from "./fake-bridge.ts";

// Digest seam (canonical JSON + sha256)
export {
  canonicalJson,
  sha256Hex,
  contentDigestOf,
} from "./digest.ts";
