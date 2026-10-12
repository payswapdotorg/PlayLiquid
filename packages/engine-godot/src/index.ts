/**
 * @playliquid/engine-godot — public surface (PL-024).
 *
 * The Godot engine adapter: an `engine.godot` adapter implementing the
 * neutral Adapter seam from @playliquid/engine-adapter-contract,
 * registered into the Tool Fabric runtime (PL-019). Godot-specific
 * behavior lives ONLY here, behind the neutral seam (E4). Godot-side
 * execution stays behind the GodotBridgePort (pure interface); the
 * in-memory fake bridge is the test host — the REAL bridge (Godot
 * editor remote-control / `godot --headless --script` / export-template
 * pipeline invocation) is a HOST concern, deliberately deferred (E11).
 *
 * Module map:
 * - payload-model.ts    scene-graph capability vocabulary + typed payload union
 * - payload-validate.ts total payload validation (E8)
 * - bridge-port.ts      the pure GodotBridgePort seam (E3)
 * - command-id.ts       content-derived command identities (E9)
 * - evidence.ts         append-only digest-pinned evidence (E10)
 * - tenancy.ts          R20 tenant-isolation guard
 * - engine-binding.ts   typed web + desktop-class engine binding + compatibility predicate
 * - adapter.ts          the adapter (lifecycle, capability mediation,
 *                       client-claim rejection, deadline, duplicate ids)
 * - fake-bridge.ts      deterministic in-memory test host (E9/E11)
 * - digest.ts           canonical JSON + sha256 (E9/E10 seam)
 * - harness.ts          runtime evidence harness (node src/harness.ts)
 */

// Capability surface + payload model
export {
  GODOT_ADAPTER_ID,
  GODOT_ADAPTER_LABEL,
  GODOT_BUILD_CONFIGURATIONS,
  GODOT_BUILD_TARGET_PLATFORMS,
  GODOT_EXPORT_FORMATS,
  GODOT_EXPORT_MODES,
  GODOT_IMPORT_FORMATS,
  GODOT_INSPECT_SUBJECTS,
  GODOT_OFFERED_CAPABILITIES,
  GODOT_PAYLOAD_VERSION,
  GODOT_PROPERTY_KINDS,
  payloadFamilyFor,
} from "./payload-model.ts";
export type {
  GodotCommandPayload,
  GodotCommandPayloadBase,
  GodotInspectPayload,
  GodotInspectProjectPayload,
  GodotInspectNodePayload,
  GodotModifyNodePayload,
  GodotImportPayload,
  GodotExportPayload,
  GodotEditorActionPayload,
  GodotEditorScriptPayload,
  GodotSceneRunPayload,
  GodotBuildExportPayload,
  GodotArtifactRef,
  GodotNodeEdit,
  GodotPayloadFamily,
  GodotPayloadRejection,
  GodotPayloadRejectionCode,
  GodotPayloadValidation,
} from "./payload-model.ts";

// Total payload validation
export { validateGodotCommandPayload } from "./payload-validate.ts";

// Bridge port (pure seam)
export {
  GODOT_BRIDGE_ERROR_CODES,
} from "./bridge-port.ts";
export type {
  GodotBridgePort,
  GodotBridgeInvocation,
  GodotBridgeOutcome,
  GodotClockPort,
  GodotCommandKey,
} from "./bridge-port.ts";

// Command identities (E9)
export {
  GODOT_COMMAND_ID_PREFIX,
  godotCommandKey,
  godotCommandId,
} from "./command-id.ts";

// Evidence (E10)
export {
  createGodotEvidenceLedger,
} from "./evidence.ts";
export type {
  GodotEvidenceLedger,
  GodotExchangeRecord,
} from "./evidence.ts";

// Tenancy (R20)
export {
  validateGodotTenantClaim,
  checkGodotTenancy,
} from "./tenancy.ts";
export type {
  GodotTenancyCheck,
  GodotTenancyRejection,
  GodotTenancyRejectionCode,
} from "./tenancy.ts";

// Typed web + desktop-class engine binding + compatibility predicate
export {
  GODOT_ENGINE_ID,
  GODOT_SUPPORTED_TARGETS,
  createGodotEngineBinding,
  godotCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
  isProjectedEngineBindingRef,
} from "./engine-binding.ts";
export type {
  GodotEngineBinding,
  GodotTargetCompatibility,
  GodotBindingRefusalCode,
} from "./engine-binding.ts";

// The adapter
export { createGodotAdapter } from "./adapter.ts";
export type {
  GodotAdapter,
  GodotAdapterOptions,
} from "./adapter.ts";

// Deterministic fakes (test doubles; E9/E11-labeled)
export {
  createFakeGodotBridge,
  createFakeGodotClock,
} from "./fake-bridge.ts";
export type {
  FakeGodotBridge,
  FakeGodotBridgeScript,
  FakeGodotClock,
} from "./fake-bridge.ts";

// Digest seam (canonical JSON + sha256)
export {
  canonicalJson,
  sha256Hex,
  contentDigestOf,
} from "./digest.ts";
