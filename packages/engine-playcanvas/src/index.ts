/**
 * @playliquid/engine-playcanvas — public surface (PL-021).
 *
 * The PlayCanvas engine adapter: an `engine.playcanvas` adapter
 * implementing the neutral Adapter seam from
 * @playliquid/engine-adapter-contract, registered into the Tool Fabric
 * runtime (PL-019). PlayCanvas-specific behavior lives ONLY here, behind
 * the neutral seam (E4). PlayCanvas-side execution stays behind the
 * PlayCanvasBridgePort (pure interface); the in-memory fake bridge is the
 * test host — the REAL bridge (PlayCanvas editor / web publish pipeline
 * invocation) is a HOST concern, deliberately deferred (E11).
 *
 * Module map:
 * - payload-model.ts    web-first capability vocabulary + typed payload union
 * - payload-validate.ts total payload validation (E8)
 * - bridge-port.ts      the pure PlayCanvasBridgePort seam (E3)
 * - command-id.ts       content-derived command identities (E9)
 * - evidence.ts         append-only digest-pinned evidence (E10)
 * - tenancy.ts          R20 tenant-isolation guard
 * - engine-binding.ts   typed web-first engine binding + compatibility predicate
 * - adapter.ts          the adapter (lifecycle, capability mediation,
 *                       client-claim rejection, deadline, duplicate ids)
 * - fake-bridge.ts      deterministic in-memory test host (E9/E11)
 * - digest.ts           canonical JSON + sha256 (E9/E10 seam)
 * - harness.ts          runtime evidence harness (node src/harness.ts)
 */

// Capability surface + payload model
export {
  PLAYCANVAS_ADAPTER_ID,
  PLAYCANVAS_ADAPTER_LABEL,
  PLAYCANVAS_ASSET_FORMATS,
  PLAYCANVAS_BUILD_CHANNELS,
  PLAYCANVAS_EXPORT_MODES,
  PLAYCANVAS_IMPORT_TARGETS,
  PLAYCANVAS_INSPECT_SUBJECTS,
  PLAYCANVAS_PROPERTY_KINDS,
  PLAYCANVAS_OFFERED_CAPABILITIES,
  PLAYCANVAS_PAYLOAD_VERSION,
  payloadFamilyFor,
} from "./payload-model.ts";
export type {
  PlayCanvasCommandPayload,
  PlayCanvasCommandPayloadBase,
  PlayCanvasInspectPayload,
  PlayCanvasModifyPayload,
  PlayCanvasImportPayload,
  PlayCanvasExportPayload,
  PlayCanvasSceneActionPayload,
  PlayCanvasSceneScriptPayload,
  PlayCanvasPublishPayload,
  PlayCanvasPlayPayload,
  PlayCanvasArtifactRef,
  PlayCanvasEntityEdit,
  PlayCanvasPayloadFamily,
  PlayCanvasPayloadRejection,
  PlayCanvasPayloadRejectionCode,
  PlayCanvasPayloadValidation,
} from "./payload-model.ts";

// Total payload validation
export { validatePlayCanvasCommandPayload } from "./payload-validate.ts";

// Bridge port (pure seam)
export {
  PLAYCANVAS_BRIDGE_ERROR_CODES,
} from "./bridge-port.ts";
export type {
  PlayCanvasBridgePort,
  PlayCanvasBridgeInvocation,
  PlayCanvasBridgeOutcome,
  PlayCanvasClockPort,
  PlayCanvasCommandKey,
} from "./bridge-port.ts";

// Command identities (E9)
export {
  PLAYCANVAS_COMMAND_ID_PREFIX,
  playCanvasCommandKey,
  playCanvasCommandId,
} from "./command-id.ts";

// Evidence (E10)
export {
  createPlayCanvasEvidenceLedger,
} from "./evidence.ts";
export type {
  PlayCanvasEvidenceLedger,
  PlayCanvasExchangeRecord,
} from "./evidence.ts";

// Tenancy (R20)
export {
  validatePlayCanvasTenantClaim,
  checkPlayCanvasTenancy,
} from "./tenancy.ts";
export type {
  PlayCanvasTenancyCheck,
  PlayCanvasTenancyRejection,
  PlayCanvasTenancyRejectionCode,
} from "./tenancy.ts";

// Typed web-first engine binding + compatibility predicate
export {
  PLAYCANVAS_ENGINE_ID,
  PLAYCANVAS_SUPPORTED_TARGETS,
  createPlayCanvasEngineBinding,
  playCanvasCanServeTargetProfile,
  toBuildContractsEngineBindingRef,
  isProjectedEngineBindingRef,
} from "./engine-binding.ts";
export type {
  PlayCanvasEngineBinding,
  PlayCanvasTargetCompatibility,
  PlayCanvasBindingRefusalCode,
} from "./engine-binding.ts";

// The adapter
export { createPlayCanvasAdapter } from "./adapter.ts";
export type {
  PlayCanvasAdapter,
  PlayCanvasAdapterOptions,
} from "./adapter.ts";

// Deterministic fakes (test doubles; E9/E11-labeled)
export {
  createFakePlayCanvasBridge,
  createFakePlayCanvasClock,
} from "./fake-bridge.ts";
export type {
  FakePlayCanvasBridge,
  FakePlayCanvasBridgeScript,
  FakePlayCanvasClock,
} from "./fake-bridge.ts";

// Digest seam (canonical JSON + sha256)
export {
  canonicalJson,
  sha256Hex,
  contentDigestOf,
} from "./digest.ts";
