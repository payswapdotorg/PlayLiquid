/**
 * @playliquid/engine-unity — public surface (PL-023).
 *
 * The Unity engine adapter: an `engine.unity` adapter implementing the
 * neutral Adapter seam from @playliquid/engine-adapter-contract,
 * registered into the Tool Fabric runtime (PL-019). Unity-specific
 * behavior lives ONLY here, behind the neutral seam (E4). Unity-side
 * execution stays behind the UnityBridgePort (pure interface); the
 * in-memory fake bridge is the test host — the REAL bridge (Unity
 * editor remote-execution / `Unity -batchmode -executeMethod` /
 * BuildPlayer pipeline invocation) is a HOST concern, deliberately
 * deferred (E11).
 *
 * Module map:
 * - payload-model.ts    component-oriented capability vocabulary + typed payload union
 * - payload-fields.ts   shared total field validators (Unity path/GUID grammars)
 * - payload-validate.ts  total payload validation (E8)
 * - bridge-port.ts      the pure UnityBridgePort seam (E3)
 * - command-id.ts       content-derived command identities (E9)
 * - evidence.ts         append-only digest-pinned evidence (E10)
 * - tenancy.ts          R20 tenant-isolation guard
 * - engine-binding.ts   typed web/desktop/mobile engine binding + compatibility predicate
 * - adapter.ts          the adapter (lifecycle, capability mediation,
 *                       client-claim rejection, deadline, duplicate ids)
 * - fake-bridge.ts      deterministic in-memory test host (E9/E11)
 * - digest.ts           canonical JSON + sha256 (E9/E10 seam)
 * - harness.ts          runtime evidence harness (node src/harness.ts)
 */

// Capability surface + payload model
export {
  UNITY_ADAPTER_ID,
  UNITY_ADAPTER_LABEL,
  UNITY_BUILD_CONFIGURATIONS,
  UNITY_BUILD_TARGET_PLATFORMS,
  UNITY_EXPORT_FORMATS,
  UNITY_EXPORT_MODES,
  UNITY_IMPORT_FORMATS,
  UNITY_OFFERED_CAPABILITIES,
  UNITY_PAYLOAD_VERSION,
  UNITY_PROPERTY_KINDS,
  payloadFamilyFor,
} from "./payload-model.ts";
export type {
  UnityCommandPayload,
  UnityCommandPayloadBase,
  UnityInspectProjectPayload,
  UnityInspectScenePayload,
  UnityInspectGameObjectPayload,
  UnityInspectComponentPayload,
  UnityInspectPrefabPayload,
  UnityInspectAssetPayload,
  UnityModifyGameObjectPayload,
  UnityImportPayload,
  UnityExportPayload,
  UnityEditorActionPayload,
  UnityEditorScriptPayload,
  UnityScenePlayPayload,
  UnityBuildPlayerPayload,
  UnityArtifactRef,
  UnityGameObjectEdit,
  UnityPayloadFamily,
  UnityPayloadRejection,
  UnityPayloadRejectionCode,
  UnityPayloadValidation,
} from "./payload-model.ts";

// Total payload validation
export { validateUnityCommandPayload } from "./payload-validate.ts";

// Bridge port (pure seam)
export {
  UNITY_BRIDGE_ERROR_CODES,
} from "./bridge-port.ts";
export type {
  UnityBridgePort,
  UnityBridgeInvocation,
  UnityBridgeOutcome,
  UnityClockPort,
  UnityCommandKey,
} from "./bridge-port.ts";

// Command identities (E9)
export {
  UNITY_COMMAND_ID_PREFIX,
  unityCommandKey,
  unityCommandId,
} from "./command-id.ts";

// Evidence (E10)
export {
  createUnityEvidenceLedger,
} from "./evidence.ts";
export type {
  UnityEvidenceLedger,
  UnityExchangeRecord,
} from "./evidence.ts";

// Tenancy (R20)
export {
  validateUnityTenantClaim,
  checkUnityTenancy,
} from "./tenancy.ts";
export type {
  UnityTenancyCheck,
  UnityTenancyRejection,
  UnityTenancyRejectionCode,
} from "./tenancy.ts";

// Typed web/desktop/mobile engine binding + compatibility predicate
export {
  UNITY_ENGINE_ID,
  UNITY_SUPPORTED_TARGETS,
  createUnityEngineBinding,
  unityCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
  isProjectedEngineBindingRef,
} from "./engine-binding.ts";
export type {
  UnityEngineBinding,
  UnityTargetCompatibility,
  UnityBindingRefusalCode,
} from "./engine-binding.ts";

// The adapter
export { createUnityAdapter } from "./adapter.ts";
export type {
  UnityAdapter,
  UnityAdapterOptions,
} from "./adapter.ts";

// Deterministic fakes (test doubles; E9/E11-labeled)
export {
  createFakeUnityBridge,
  createFakeUnityClock,
} from "./fake-bridge.ts";
export type {
  FakeUnityBridge,
  FakeUnityBridgeScript,
  FakeUnityClock,
} from "./fake-bridge.ts";

// Digest seam (canonical JSON + sha256)
export {
  canonicalJson,
  sha256Hex,
  contentDigestOf,
} from "./digest.ts";
