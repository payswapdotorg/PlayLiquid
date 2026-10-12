/**
 * Module role: the typed, versioned command payload MODEL for the Godot
 * engine adapter — the scene-graph capability vocabulary, the
 * discriminated payload union, and the capability→family mapping. Total
 * VALIDATION lives in payload-validate.ts (same package, pure). Typed
 * kebab-case rejection codes, path-tagged; never `any`, never silent
 * coercion. Capability ids are drawn from the Tool Fabric
 * provider-neutral operation list scoped to what a Godot editor /
 * --headless / export-template workflow actually offers: inspect
 * project/scene/node/asset/resource, node modify, import/export, editor
 * action, editor script, the run-scene run action, and the export-preset
 * build target. Each capability has exactly one payload version family;
 * the payload carries its own version so the bridge can evolve without
 * breaking the neutral exchange.
 *
 * Honest-surface notes (the deliberate differences from the siblings):
 * Godot names its scene graph Scene/Node/Resource (never level/actor or
 * scene/entity/component — Godot has no component layer; nodes compose
 * instead), addressing is res:// for project content and NodePath for
 * nodes inside a scene, node property names are snake_case
 * (position/rotation/modulate), the in-editor run loop is the run-scene
 * action (no multi-player variant — Godot multiplayer is scripted, not an
 * engine run parameter), and the build pipeline is a single export-preset
 * step with debug/release export templates (there is no separate
 * cook/package split; Godot's "cook" equivalent is the resource import
 * pass owned by asset.import).
 *
 * Implements: PL-024 capability surface + command payload model (E4:
 * engine-specific behavior lives only behind this adapter's commands).
 */

// ---------------------------------------------------------------------------
// Capability surface (fixed at registration)
// ---------------------------------------------------------------------------

/** Adapter id for this adapter (engine-specific by design; E4 allows it here and only here). */
export const GODOT_ADAPTER_ID = "engine.godot" as const;

/** Neutral label; describes the engine class without vendor marketing claims. */
export const GODOT_ADAPTER_LABEL =
  "Open-source 2D/3D scene-graph engine adapter (in-memory bridge; real editor/headless/export-template invocation is a host concern)" as const;

/** Source asset formats this adapter accepts for import payloads (Godot's native importers). */
export const GODOT_IMPORT_FORMATS: readonly string[] = Object.freeze([
  "png",
  "jpg",
  "webp",
  "svg",
  "bmp",
  "gltf",
  "glb",
  "obj",
  "fbx",
  "wav",
  "ogg",
  "mp3",
  "ttf",
  "otf",
]);

/** Formats this adapter can export to (interchange or serialized resource). */
export const GODOT_EXPORT_FORMATS: readonly string[] = Object.freeze([
  "gltf",
  "glb",
  "png",
  "tres",
  "res",
]);

/** Export scopes (what gets exported): a scene or a standalone resource. */
export const GODOT_EXPORT_MODES: readonly string[] = Object.freeze(["scene", "resource"]);

/** Inspect subjects. */
export const GODOT_INSPECT_SUBJECTS: readonly string[] = Object.freeze([
  "project",
  "scene",
  "node",
  "asset",
  "resource",
]);

/**
 * Vocabulary examples of editable node property kinds (documentational —
 * Godot nodes expose hundreds of snake_case properties; the validator
 * accepts any well-formed snake_case property and the bridge is the
 * authority on whether the addressed node actually has it).
 */
export const GODOT_PROPERTY_KINDS: readonly string[] = Object.freeze([
  "position",
  "rotation",
  "scale",
  "visible",
  "modulate",
]);

/**
 * Export target platforms this adapter's build.export capability serves —
 * the web (HTML5) target plus the desktop-class subset of the frozen
 * target taxonomy (mirrors the typed engine binding's
 * supported-target declaration).
 */
export const GODOT_BUILD_TARGET_PLATFORMS: readonly string[] = Object.freeze([
  "web",
  "windows",
  "macos",
  "linux",
]);

/**
 * Export configurations the build.export payload accepts — Godot's real
 * export-template distinction (debug templates with symbols and dev
 * tooling vs release templates), never the desktop-native
 * debug/development/shipping triple.
 */
export const GODOT_BUILD_CONFIGURATIONS: readonly string[] = Object.freeze([
  "debug",
  "release",
]);

/**
 * The declared capability list — the exact fixed set registered on the
 * adapter. Anything else dispatches to a typed
 * "adapter-capability/not-declared" refusal.
 */
export const GODOT_OFFERED_CAPABILITIES: readonly string[] = Object.freeze([
  "project.inspect",
  "scene.inspect",
  "node.inspect",
  "asset.inspect",
  "resource.inspect",
  "node.modify",
  "asset.import",
  "asset.export",
  "editor.action",
  "editor.script",
  "scene.run",
  "build.export",
]);

/** Payload envelope version for every capability's command payload. */
export const GODOT_PAYLOAD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Rejection vocabulary
// ---------------------------------------------------------------------------

export type GodotPayloadRejectionCode =
  | "godot-payload/not-an-object"
  | "godot-payload/version-missing"
  | "godot-payload/version-invalid"
  | "godot-payload/subject-mismatch"
  | "godot-payload/target-missing"
  | "godot-payload/target-invalid"
  | "godot-payload/project-name-missing"
  | "godot-payload/project-name-invalid"
  | "godot-payload/node-path-missing"
  | "godot-payload/node-path-invalid"
  | "godot-payload/format-missing"
  | "godot-payload/format-invalid"
  | "godot-payload/artifact-ref-invalid"
  | "godot-payload/export-mode-missing"
  | "godot-payload/export-mode-invalid"
  | "godot-payload/edits-missing"
  | "godot-payload/edits-entry-invalid"
  | "godot-payload/property-invalid"
  | "godot-payload/action-missing"
  | "godot-payload/action-invalid"
  | "godot-payload/script-invalid"
  | "godot-payload/headless-invalid"
  | "godot-payload/preset-missing"
  | "godot-payload/preset-invalid"
  | "godot-payload/target-platform-missing"
  | "godot-payload/target-platform-invalid"
  | "godot-payload/configuration-missing"
  | "godot-payload/configuration-invalid";

export interface GodotPayloadRejection {
  readonly code: GodotPayloadRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type GodotPayloadValidation =
  | { readonly outcome: "ok"; readonly payload: GodotCommandPayload }
  | { readonly outcome: "rejected"; readonly rejections: readonly GodotPayloadRejection[] };

// ---------------------------------------------------------------------------
// Payload model
// ---------------------------------------------------------------------------

/** Content-addressed artifact reference (produced by the bridge/exchange). */
export interface GodotArtifactRef {
  readonly kind: "artifact-ref";
  readonly digest: string;
  readonly bytes: number;
}

/** One node property edit inside a node.modify payload. */
export interface GodotNodeEdit {
  readonly property: string;
  readonly value: unknown;
}

/**
 * The typed, versioned command payload — a discriminated union by
 * capability family: inspect (project/scene/node/asset/resource), node
 * modify, import, export, editor action, editor script, scene run,
 * build export.
 */
export interface GodotCommandPayloadBase {
  readonly kind: "godot-command-payload";
  readonly version: number;
}

/**
 * One inspect payload for the res://-target subjects (scene, asset,
 * resource) — they share the wire shape; the capability fixes the subject.
 */
export interface GodotInspectPayload extends GodotCommandPayloadBase {
  readonly subject: "scene" | "asset" | "resource";
  /** Scene (.tscn), asset or resource (.tres) res:// path (never a host path). */
  readonly target: string;
}

export interface GodotInspectProjectPayload extends GodotCommandPayloadBase {
  readonly subject: "project";
  /** Project name (the project.godot directory label; never a host path). */
  readonly target: string;
}

export interface GodotInspectNodePayload extends GodotCommandPayloadBase {
  readonly subject: "node";
  /** The scene (.tscn) the node lives in (res:// path). */
  readonly target: string;
  /** NodePath of the node inside the scene, e.g. Player/Body/Sprite2D. */
  readonly nodePath: string;
}

export interface GodotModifyNodePayload extends GodotCommandPayloadBase {
  readonly subject: "node";
  readonly target: string;
  readonly nodePath: string;
  readonly edits: readonly GodotNodeEdit[];
}

export interface GodotImportPayload extends GodotCommandPayloadBase {
  readonly subject: "asset";
  /** Destination res:// path the artifact is imported under. */
  readonly target: string;
  readonly format: string;
  readonly artifact: GodotArtifactRef;
}

export interface GodotExportPayload extends GodotCommandPayloadBase {
  readonly subject: "asset";
  /** Scene or resource res:// path to export. */
  readonly target: string;
  readonly format: string;
  readonly mode: "scene" | "resource";
}

export interface GodotEditorActionPayload extends GodotCommandPayloadBase {
  readonly subject: "editor";
  /** Named editor action id, e.g. save-all. */
  readonly action: string;
}

export interface GodotEditorScriptPayload extends GodotCommandPayloadBase {
  readonly subject: "editor";
  readonly action: "run-script";
  /** Digest of the script content (content lives in the exchange, not inline). */
  readonly scriptDigest: string;
}

export interface GodotSceneRunPayload extends GodotCommandPayloadBase {
  readonly subject: "scene";
  readonly action: "run";
  /** The scene to run (res:// path). */
  readonly target: string;
  /** Run headless (godot --headless) instead of with a window; default false. */
  readonly headless?: boolean;
}

export interface GodotBuildExportPayload extends GodotCommandPayloadBase {
  readonly subject: "build";
  readonly action: "export";
  /** Project name being exported. */
  readonly target: string;
  /** Export preset name from export_presets.cfg, e.g. "Web (HTML5)". */
  readonly preset: string;
  readonly targetPlatform: "web" | "windows" | "macos" | "linux";
  readonly configuration: "debug" | "release";
}

export type GodotCommandPayload =
  | GodotInspectPayload
  | GodotInspectProjectPayload
  | GodotInspectNodePayload
  | GodotModifyNodePayload
  | GodotImportPayload
  | GodotExportPayload
  | GodotEditorActionPayload
  | GodotEditorScriptPayload
  | GodotSceneRunPayload
  | GodotBuildExportPayload;

/** Internal discriminator: which payload family a capability expects. */
export type GodotPayloadFamily =
  | "inspect-project"
  | "inspect-scene"
  | "inspect-node"
  | "inspect-asset"
  | "inspect-resource"
  | "modify-node"
  | "import"
  | "export"
  | "editor-action"
  | "editor-script"
  | "scene-run"
  | "build-export";

/** Maps a capability id to its payload family; null when not ours. */
export function payloadFamilyFor(capability: string): GodotPayloadFamily | null {
  switch (capability) {
    case "project.inspect":
      return "inspect-project";
    case "scene.inspect":
      return "inspect-scene";
    case "node.inspect":
      return "inspect-node";
    case "asset.inspect":
      return "inspect-asset";
    case "resource.inspect":
      return "inspect-resource";
    case "node.modify":
      return "modify-node";
    case "asset.import":
      return "import";
    case "asset.export":
      return "export";
    case "editor.action":
      return "editor-action";
    case "editor.script":
      return "editor-script";
    case "scene.run":
      return "scene-run";
    case "build.export":
      return "build-export";
    default:
      return null;
  }
}
