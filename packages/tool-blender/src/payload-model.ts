/**
 * Module role: the typed, versioned command payload MODEL for the Blender
 * adapter — the capability vocabulary, the discriminated payload union,
 * and the capability→family mapping. Total VALIDATION lives in
 * payload-validate.ts (same package, pure). Typed kebab-case rejection
 * codes, path-tagged; never `any`, never silent coercion. Capability ids
 * are drawn from the Tool Fabric provider-neutral operation list scoped
 * to what a 3D authoring/asset tool actually offers. Each capability has
 * exactly one payload version family; the payload carries its own version
 * so the bridge can evolve without breaking the neutral exchange.
 *
 * Implements: PL-025 capability surface + command payload model (E4:
 * tool-specific behavior lives only behind this adapter's commands).
 */

// ---------------------------------------------------------------------------
// Capability surface (fixed at registration)
// ---------------------------------------------------------------------------

/** Adapter id for this adapter (engine-specific by design; E4 allows it here and only here). */
export const BLENDER_ADAPTER_ID = "tool.blender" as const;

/** Neutral label; describes the tool class without vendor marketing claims. */
export const BLENDER_ADAPTER_LABEL =
  "Open-source 3D authoring/asset tool adapter (in-memory bridge; real tool invocation is a host concern)" as const;

/** Asset formats this adapter accepts for import/export payloads. */
export const BLENDER_ASSET_FORMATS: readonly string[] = Object.freeze([
  "blend",
  "gltf",
  "glb",
  "fbx",
  "obj",
  "usd",
  "usda",
  "usdc",
  "stl",
  "alembic",
]);

/** Import target scopes. */
export const BLENDER_IMPORT_TARGETS: readonly string[] = Object.freeze(["scene", "library"]);

/** Export modes. */
export const BLENDER_EXPORT_MODES: readonly string[] = Object.freeze(["whole-scene", "selection", "object"]);

/** Inspect subjects. */
export const BLENDER_INSPECT_SUBJECTS: readonly string[] = Object.freeze(["project", "scene", "asset"]);

/** Editable property kinds for modify payloads. */
export const BLENDER_PROPERTY_KINDS: readonly string[] = Object.freeze([
  "name",
  "location",
  "rotation",
  "scale",
  "visibility",
  "custom",
]);

/**
 * The declared capability list — the exact fixed set registered on the
 * adapter. Anything else dispatches to a typed
 * "adapter-capability/not-declared" refusal.
 */
export const BLENDER_OFFERED_CAPABILITIES: readonly string[] = Object.freeze([
  "project.inspect",
  "scene.inspect",
  "asset.inspect",
  "project.modify",
  "asset.import",
  "asset.export",
  "editor.action",
  "editor.script",
]);

/** Payload envelope version for every capability's command payload. */
export const BLENDER_PAYLOAD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Rejection vocabulary
// ---------------------------------------------------------------------------

export type BlenderPayloadRejectionCode =
  | "blender-payload/not-an-object"
  | "blender-payload/version-missing"
  | "blender-payload/version-invalid"
  | "blender-payload/subject-mismatch"
  | "blender-payload/target-missing"
  | "blender-payload/target-invalid"
  | "blender-payload/format-missing"
  | "blender-payload/format-invalid"
  | "blender-payload/artifact-ref-invalid"
  | "blender-payload/edits-missing"
  | "blender-payload/edits-entry-invalid"
  | "blender-payload/into-invalid"
  | "blender-payload/export-mode-missing"
  | "blender-payload/export-mode-invalid"
  | "blender-payload/object-name-invalid"
  | "blender-payload/action-missing"
  | "blender-payload/action-invalid"
  | "blender-payload/script-invalid";

export interface BlenderPayloadRejection {
  readonly code: BlenderPayloadRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type BlenderPayloadValidation =
  | { readonly outcome: "ok"; readonly payload: BlenderCommandPayload }
  | { readonly outcome: "rejected"; readonly rejections: readonly BlenderPayloadRejection[] };

// ---------------------------------------------------------------------------
// Payload model
// ---------------------------------------------------------------------------

/** Content-addressed artifact reference (produced by the bridge/exchange). */
export interface BlenderArtifactRef {
  readonly kind: "artifact-ref";
  readonly digest: string;
  readonly bytes: number;
}

/** One object edit inside a project.modify payload. */
export interface BlenderObjectEdit {
  readonly objectName: string;
  readonly property: string;
  readonly value: unknown;
}

/**
 * The typed, versioned command payload — a discriminated union by
 * capability family: inspect (project/scene/asset), modify, import,
 * export, editor action, editor script.
 */
export interface BlenderCommandPayloadBase {
  readonly kind: "blender-command-payload";
  readonly version: number;
}

export interface BlenderInspectPayload extends BlenderCommandPayloadBase {
  readonly subject: "project" | "scene" | "asset";
  /** Project-relative path or scene/asset id (never a host path). */
  readonly target: string;
}

export interface BlenderModifyPayload extends BlenderCommandPayloadBase {
  readonly subject: "project";
  readonly target: string;
  readonly edits: readonly BlenderObjectEdit[];
}

export interface BlenderImportPayload extends BlenderCommandPayloadBase {
  readonly subject: "asset";
  readonly target: string;
  readonly format: string;
  readonly artifact: BlenderArtifactRef;
  readonly into: "scene" | "library";
}

export interface BlenderExportPayload extends BlenderCommandPayloadBase {
  readonly subject: "asset";
  readonly target: string;
  readonly format: string;
  readonly mode: "whole-scene" | "selection" | "object";
  readonly objectName?: string;
}

export interface BlenderEditorActionPayload extends BlenderCommandPayloadBase {
  readonly subject: "editor";
  readonly action: string;
  readonly target: string;
}

export interface BlenderEditorScriptPayload extends BlenderCommandPayloadBase {
  readonly subject: "editor";
  readonly action: "run-script";
  readonly target: string;
  /** Digest of the script content (content lives in the exchange, not inline). */
  readonly scriptDigest: string;
}

export type BlenderCommandPayload =
  | BlenderInspectPayload
  | BlenderModifyPayload
  | BlenderImportPayload
  | BlenderExportPayload
  | BlenderEditorActionPayload
  | BlenderEditorScriptPayload;

/** Internal discriminator: which payload family a capability expects. */
export type BlenderPayloadFamily =
  | "inspect-project"
  | "inspect-scene"
  | "inspect-asset"
  | "modify"
  | "import"
  | "export"
  | "editor-action"
  | "editor-script";

/** Maps a capability id to its payload family; null when not ours. */
export function payloadFamilyFor(capability: string): BlenderPayloadFamily | null {
  switch (capability) {
    case "project.inspect":
      return "inspect-project";
    case "scene.inspect":
      return "inspect-scene";
    case "asset.inspect":
      return "inspect-asset";
    case "project.modify":
      return "modify";
    case "asset.import":
      return "import";
    case "asset.export":
      return "export";
    case "editor.action":
      return "editor-action";
    case "editor.script":
      return "editor-script";
    default:
      return null;
  }
}
