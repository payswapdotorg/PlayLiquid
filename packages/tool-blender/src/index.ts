/**
 * @playliquid/tool-blender — public surface (PL-025).
 *
 * The Blender tool adapter: a `tool.blender` adapter implementing the
 * neutral Adapter seam from @playliquid/engine-adapter-contract,
 * registered into the Tool Fabric runtime (PL-019). Blender-specific
 * behavior lives ONLY here, behind the neutral seam (E4). Blender-side
 * execution stays behind the BlenderBridgePort (pure interface); the
 * in-memory fake bridge is the test host — the REAL bridge (headless
 * tool invocation) is a HOST concern, deliberately deferred (E11).
 *
 * Module map:
 * - payload-model.ts    capability vocabulary + typed payload union
 * - payload-validate.ts total payload validation (E8)
 * - bridge-port.ts      the pure BlenderBridgePort seam (E3)
 * - command-id.ts       content-derived command identities (E9)
 * - evidence.ts         append-only digest-pinned evidence (E10)
 * - tenancy.ts          R20 tenant-isolation guard
 * - adapter.ts          the adapter (lifecycle, capability mediation,
 *                       client-claim rejection, deadline, duplicate ids)
 * - fake-bridge.ts      deterministic in-memory test host (E9/E11)
 * - digest.ts           canonical JSON + sha256 (E9/E10 seam)
 * - harness.ts          runtime evidence harness (node src/harness.ts)
 */

// Capability surface + payload model
export {
  BLENDER_ADAPTER_ID,
  BLENDER_ADAPTER_LABEL,
  BLENDER_ASSET_FORMATS,
  BLENDER_EXPORT_MODES,
  BLENDER_IMPORT_TARGETS,
  BLENDER_INSPECT_SUBJECTS,
  BLENDER_PROPERTY_KINDS,
  BLENDER_OFFERED_CAPABILITIES,
  BLENDER_PAYLOAD_VERSION,
  payloadFamilyFor,
} from "./payload-model.ts";
export type {
  BlenderCommandPayload,
  BlenderCommandPayloadBase,
  BlenderInspectPayload,
  BlenderModifyPayload,
  BlenderImportPayload,
  BlenderExportPayload,
  BlenderEditorActionPayload,
  BlenderEditorScriptPayload,
  BlenderArtifactRef,
  BlenderObjectEdit,
  BlenderPayloadFamily,
  BlenderPayloadRejection,
  BlenderPayloadRejectionCode,
  BlenderPayloadValidation,
} from "./payload-model.ts";

// Total payload validation
export { validateBlenderCommandPayload } from "./payload-validate.ts";

// Bridge port (pure seam)
export {
  BLENDER_BRIDGE_ERROR_CODES,
} from "./bridge-port.ts";
export type {
  BlenderBridgePort,
  BlenderBridgeInvocation,
  BlenderBridgeOutcome,
  BlenderClockPort,
  BlenderCommandKey,
} from "./bridge-port.ts";

// Command identities (E9)
export {
  BLENDER_COMMAND_ID_PREFIX,
  blenderCommandKey,
  blenderCommandId,
} from "./command-id.ts";

// Evidence (E10)
export {
  createBlenderEvidenceLedger,
} from "./evidence.ts";
export type {
  BlenderEvidenceLedger,
  BlenderExchangeRecord,
} from "./evidence.ts";

// Tenancy (R20)
export {
  validateBlenderTenantClaim,
  checkBlenderTenancy,
} from "./tenancy.ts";
export type {
  BlenderTenancyCheck,
  BlenderTenancyRejection,
  BlenderTenancyRejectionCode,
} from "./tenancy.ts";

// The adapter
export { createBlenderAdapter } from "./adapter.ts";
export type {
  BlenderAdapter,
  BlenderAdapterOptions,
} from "./adapter.ts";

// Deterministic fakes (test doubles; E9/E11-labeled)
export {
  createFakeBlenderBridge,
  createFakeBlenderClock,
} from "./fake-bridge.ts";
export type {
  FakeBlenderBridge,
  FakeBlenderBridgeScript,
  FakeBlenderClock,
} from "./fake-bridge.ts";

// Digest seam (canonical JSON + sha256)
export {
  canonicalJson,
  sha256Hex,
  contentDigestOf,
} from "./digest.ts";
