/**
 * Module role: the typed, versioned command payload MODEL for the
 * PlayCanvas engine adapter — the web-first capability vocabulary, the
 * discriminated payload union, and the capability→family mapping. Total
 * VALIDATION lives in payload-validate.ts (same package, pure). Typed
 * kebab-case rejection codes, path-tagged; never `any`, never silent
 * coercion. Capability ids are drawn from the Tool Fabric
 * provider-neutral operation list scoped to what a web-first engine
 * editor/publish pipeline actually offers (inspect
 * project/scene/entity/component/asset, modify/import/export, run scene
 * action/script, publish/play build target). Each capability has exactly
 * one payload version family; the payload carries its own version so the
 * bridge can evolve without breaking the neutral exchange.
 *
 * Implements: PL-021 capability surface + command payload model (E4:
 * engine-specific behavior lives only behind this adapter's commands).
 */

// ---------------------------------------------------------------------------
// Capability surface (fixed at registration)
// ---------------------------------------------------------------------------

/** Adapter id for this adapter (engine-specific by design; E4 allows it here and only here). */
export const PLAYCANVAS_ADAPTER_ID = "engine.playcanvas" as const;

/** Neutral label; describes the engine class without vendor marketing claims. */
export const PLAYCANVAS_ADAPTER_LABEL =
  "Web-first engine adapter (in-memory bridge; real editor/publish invocation is a host concern)" as const;

/** Asset formats this adapter accepts for import/export payloads. */
export const PLAYCANVAS_ASSET_FORMATS: readonly string[] = Object.freeze([
  "gltf",
  "glb",
  "fbx",
  "obj",
  "usd",
  "usda",
  "usdc",
  "json",
  "png",
  "jpg",
  "ktx2",
  "mp3",
  "wav",
]);

/** Import target scopes (web-first scene/library model). */
export const PLAYCANVAS_IMPORT_TARGETS: readonly string[] = Object.freeze(["scene", "library"]);

/** Export modes. */
export const PLAYCANVAS_EXPORT_MODES: readonly string[] = Object.freeze(["whole-scene", "selection", "entity"]);

/** Inspect subjects. */
export const PLAYCANVAS_INSPECT_SUBJECTS: readonly string[] = Object.freeze([
  "project",
  "scene",
  "entity",
  "component",
  "asset",
]);

/** Editable property kinds for modify payloads. */
export const PLAYCANVAS_PROPERTY_KINDS: readonly string[] = Object.freeze([
  "name",
  "position",
  "rotation",
  "scale",
  "enabled",
  "custom",
]);

/** Publish/play build target channels for the web-first engine. */
export const PLAYCANVAS_BUILD_CHANNELS: readonly string[] = Object.freeze(["web", "spark"]);

/**
 * The declared capability list — the exact fixed set registered on the
 * adapter. Anything else dispatches to a typed
 * "adapter-capability/not-declared" refusal.
 */
export const PLAYCANVAS_OFFERED_CAPABILITIES: readonly string[] = Object.freeze([
  "project.inspect",
  "scene.inspect",
  "entity.inspect",
  "component.inspect",
  "asset.inspect",
  "project.modify",
  "entity.modify",
  "asset.import",
  "asset.export",
  "scene.action",
  "scene.script",
  "build.publish",
  "build.play",
]);

/** Payload envelope version for every capability's command payload. */
export const PLAYCANVAS_PAYLOAD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Rejection vocabulary
// ---------------------------------------------------------------------------

export type PlayCanvasPayloadRejectionCode =
  | "playcanvas-payload/not-an-object"
  | "playcanvas-payload/version-missing"
  | "playcanvas-payload/version-invalid"
  | "playcanvas-payload/subject-mismatch"
  | "playcanvas-payload/target-missing"
  | "playcanvas-payload/target-invalid"
  | "playcanvas-payload/format-missing"
  | "playcanvas-payload/format-invalid"
  | "playcanvas-payload/artifact-ref-invalid"
  | "playcanvas-payload/edits-missing"
  | "playcanvas-payload/edits-entry-invalid"
  | "playcanvas-payload/into-invalid"
  | "playcanvas-payload/export-mode-missing"
  | "playcanvas-payload/export-mode-invalid"
  | "playcanvas-payload/entity-name-invalid"
  | "playcanvas-payload/component-type-invalid"
  | "playcanvas-payload/component-id-invalid"
  | "playcanvas-payload/action-missing"
  | "playcanvas-payload/action-invalid"
  | "playcanvas-payload/script-invalid"
  | "playcanvas-payload/channel-missing"
  | "playcanvas-payload/channel-invalid"
  | "playcanvas-payload/play-build-id-invalid";

export interface PlayCanvasPayloadRejection {
  readonly code: PlayCanvasPayloadRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type PlayCanvasPayloadValidation =
  | { readonly outcome: "ok"; readonly payload: PlayCanvasCommandPayload }
  | { readonly outcome: "rejected"; readonly rejections: readonly PlayCanvasPayloadRejection[] };

// ---------------------------------------------------------------------------
// Payload model
// ---------------------------------------------------------------------------

/** Content-addressed artifact reference (produced by the bridge/exchange). */
export interface PlayCanvasArtifactRef {
  readonly kind: "artifact-ref";
  readonly digest: string;
  readonly bytes: number;
}

/** One entity edit inside a project.modify / entity.modify payload. */
export interface PlayCanvasEntityEdit {
  readonly entityName: string;
  readonly property: string;
  readonly value: unknown;
}

/**
 * The typed, versioned command payload — a discriminated union by
 * capability family: inspect (project/scene/entity/component/asset),
 * modify (project/entity), import, export, scene action, scene script,
 * build publish, build play.
 */
export interface PlayCanvasCommandPayloadBase {
  readonly kind: "playcanvas-command-payload";
  readonly version: number;
}

export interface PlayCanvasInspectPayload extends PlayCanvasCommandPayloadBase {
  readonly subject: "project" | "scene" | "entity" | "component" | "asset";
  /** Project-relative path or scene/entity/component/asset id (never a host path). */
  readonly target: string;
}

export interface PlayCanvasModifyPayload extends PlayCanvasCommandPayloadBase {
  readonly subject: "project" | "entity";
  readonly target: string;
  readonly edits: readonly PlayCanvasEntityEdit[];
}

export interface PlayCanvasImportPayload extends PlayCanvasCommandPayloadBase {
  readonly subject: "asset";
  readonly target: string;
  readonly format: string;
  readonly artifact: PlayCanvasArtifactRef;
  readonly into: "scene" | "library";
}

export interface PlayCanvasExportPayload extends PlayCanvasCommandPayloadBase {
  readonly subject: "asset";
  readonly target: string;
  readonly format: string;
  readonly mode: "whole-scene" | "selection" | "entity";
  readonly entityName?: string;
}

export interface PlayCanvasSceneActionPayload extends PlayCanvasCommandPayloadBase {
  readonly subject: "scene";
  readonly action: string;
  readonly target: string;
}

export interface PlayCanvasSceneScriptPayload extends PlayCanvasCommandPayloadBase {
  readonly subject: "scene";
  readonly action: "run-script";
  readonly target: string;
  /** Digest of the script content (content lives in the exchange, not inline). */
  readonly scriptDigest: string;
}

export interface PlayCanvasPublishPayload extends PlayCanvasCommandPayloadBase {
  readonly subject: "build";
  readonly action: "publish";
  readonly target: string;
  /** Web-first publish channel (mirrors the web-first target profile set). */
  readonly channel: "web" | "spark";
}

export interface PlayCanvasPlayPayload extends PlayCanvasCommandPayloadBase {
  readonly subject: "build";
  readonly action: "play";
  readonly target: string;
  /** Opaque build id of a previously published build. */
  readonly buildId: string;
}

export type PlayCanvasCommandPayload =
  | PlayCanvasInspectPayload
  | PlayCanvasModifyPayload
  | PlayCanvasImportPayload
  | PlayCanvasExportPayload
  | PlayCanvasSceneActionPayload
  | PlayCanvasSceneScriptPayload
  | PlayCanvasPublishPayload
  | PlayCanvasPlayPayload;

/** Internal discriminator: which payload family a capability expects. */
export type PlayCanvasPayloadFamily =
  | "inspect-project"
  | "inspect-scene"
  | "inspect-entity"
  | "inspect-component"
  | "inspect-asset"
  | "modify-project"
  | "modify-entity"
  | "import"
  | "export"
  | "scene-action"
  | "scene-script"
  | "build-publish"
  | "build-play";

/** Maps a capability id to its payload family; null when not ours. */
export function payloadFamilyFor(capability: string): PlayCanvasPayloadFamily | null {
  switch (capability) {
    case "project.inspect":
      return "inspect-project";
    case "scene.inspect":
      return "inspect-scene";
    case "entity.inspect":
      return "inspect-entity";
    case "component.inspect":
      return "inspect-component";
    case "asset.inspect":
      return "inspect-asset";
    case "project.modify":
      return "modify-project";
    case "entity.modify":
      return "modify-entity";
    case "asset.import":
      return "import";
    case "asset.export":
      return "export";
    case "scene.action":
      return "scene-action";
    case "scene.script":
      return "scene-script";
    case "build.publish":
      return "build-publish";
    case "build.play":
      return "build-play";
    default:
      return null;
  }
}
