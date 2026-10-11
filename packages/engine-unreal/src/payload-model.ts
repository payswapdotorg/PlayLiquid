/**
 * Module role: the typed, versioned command payload MODEL for the Unreal
 * engine adapter — the desktop-native capability vocabulary, the
 * discriminated payload union, and the capability→family mapping. Total
 * VALIDATION lives in payload-validate.ts (same package, pure). Typed
 * kebab-case rejection codes, path-tagged; never `any`, never silent
 * coercion. Capability ids are drawn from the Tool Fabric
 * provider-neutral operation list scoped to what an Unreal
 * editor/UnrealBuildTool workflow actually offers: inspect
 * project/level/actor/component/asset, actor modify, import/export,
 * editor action, editor script, play-in-editor (PIE) run, and the
 * cook/package build steps. Each capability has exactly one payload
 * version family; the payload carries its own version so the bridge can
 * evolve without breaking the neutral exchange.
 *
 * Honest-surface notes (the deliberate differences from the web-first
 * sibling): Unreal names its scene graph Level/Actor/Component (never
 * scene/entity), actor addressing is compound (level path + actor name +
 * component name — modeled as separate typed fields, not one opaque
 * string), the in-editor run loop is PIE (play-in-editor), and the build
 * pipeline is cook → package (there is no web publish/play step).
 *
 * Implements: PL-022 capability surface + command payload model (E4:
 * engine-specific behavior lives only behind this adapter's commands).
 */

// ---------------------------------------------------------------------------
// Capability surface (fixed at registration)
// ---------------------------------------------------------------------------

/** Adapter id for this adapter (engine-specific by design; E4 allows it here and only here). */
export const UNREAL_ADAPTER_ID = "engine.unreal" as const;

/** Neutral label; describes the engine class without vendor marketing claims. */
export const UNREAL_ADAPTER_LABEL =
  "Native-class desktop 3D engine adapter (in-memory bridge; real editor/build-tool invocation is a host concern)" as const;

/** Asset formats this adapter accepts for import payloads. */
export const UNREAL_IMPORT_FORMATS: readonly string[] = Object.freeze([
  "fbx",
  "obj",
  "usd",
  "usda",
  "usdc",
  "usdz",
  "gltf",
  "glb",
  "png",
  "jpg",
  "tga",
  "exr",
  "wav",
  "mp3",
]);

/** Asset formats this adapter can export. */
export const UNREAL_EXPORT_FORMATS: readonly string[] = Object.freeze([
  "fbx",
  "obj",
  "usd",
  "usda",
  "usdc",
  "usdz",
  "gltf",
  "glb",
  "png",
  "tga",
  "exr",
]);

/** Export scopes (what gets exported). */
export const UNREAL_EXPORT_MODES: readonly string[] = Object.freeze(["asset", "level", "actor"]);

/** Inspect subjects. */
export const UNREAL_INSPECT_SUBJECTS: readonly string[] = Object.freeze([
  "project",
  "level",
  "actor",
  "component",
  "asset",
]);

/** Editable property kinds for actor modify payloads. */
export const UNREAL_PROPERTY_KINDS: readonly string[] = Object.freeze([
  "location",
  "rotation",
  "scale",
  "mobility",
  "hidden",
  "custom",
]);

/**
 * Build target platforms this adapter's cook/package capabilities serve —
 * the desktop-class subset of the frozen target taxonomy (mirrors the
 * typed engine binding's supported-target declaration).
 */
export const UNREAL_BUILD_TARGET_PLATFORMS: readonly string[] = Object.freeze([
  "windows",
  "macos",
  "linux",
]);

/** Build configurations the cook/package payloads accept. */
export const UNREAL_BUILD_CONFIGURATIONS: readonly string[] = Object.freeze([
  "debug",
  "development",
  "shipping",
]);

/**
 * The declared capability list — the exact fixed set registered on the
 * adapter. Anything else dispatches to a typed
 * "adapter-capability/not-declared" refusal.
 */
export const UNREAL_OFFERED_CAPABILITIES: readonly string[] = Object.freeze([
  "project.inspect",
  "level.inspect",
  "actor.inspect",
  "component.inspect",
  "asset.inspect",
  "actor.modify",
  "asset.import",
  "asset.export",
  "editor.action",
  "editor.script",
  "level.pie",
  "build.cook",
  "build.package",
]);

/** Payload envelope version for every capability's command payload. */
export const UNREAL_PAYLOAD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Rejection vocabulary
// ---------------------------------------------------------------------------

export type UnrealPayloadRejectionCode =
  | "unreal-payload/not-an-object"
  | "unreal-payload/version-missing"
  | "unreal-payload/version-invalid"
  | "unreal-payload/subject-mismatch"
  | "unreal-payload/target-missing"
  | "unreal-payload/target-invalid"
  | "unreal-payload/actor-name-missing"
  | "unreal-payload/actor-name-invalid"
  | "unreal-payload/component-name-missing"
  | "unreal-payload/component-name-invalid"
  | "unreal-payload/format-missing"
  | "unreal-payload/format-invalid"
  | "unreal-payload/artifact-ref-invalid"
  | "unreal-payload/export-mode-missing"
  | "unreal-payload/export-mode-invalid"
  | "unreal-payload/edits-missing"
  | "unreal-payload/edits-entry-invalid"
  | "unreal-payload/property-invalid"
  | "unreal-payload/action-missing"
  | "unreal-payload/action-invalid"
  | "unreal-payload/script-invalid"
  | "unreal-payload/players-invalid"
  | "unreal-payload/target-platform-missing"
  | "unreal-payload/target-platform-invalid"
  | "unreal-payload/configuration-missing"
  | "unreal-payload/configuration-invalid";

export interface UnrealPayloadRejection {
  readonly code: UnrealPayloadRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type UnrealPayloadValidation =
  | { readonly outcome: "ok"; readonly payload: UnrealCommandPayload }
  | { readonly outcome: "rejected"; readonly rejections: readonly UnrealPayloadRejection[] };

// ---------------------------------------------------------------------------
// Payload model
// ---------------------------------------------------------------------------

/** Content-addressed artifact reference (produced by the bridge/exchange). */
export interface UnrealArtifactRef {
  readonly kind: "artifact-ref";
  readonly digest: string;
  readonly bytes: number;
}

/** One actor property edit inside an actor.modify payload. */
export interface UnrealActorEdit {
  readonly property: string;
  readonly value: unknown;
}

/**
 * The typed, versioned command payload — a discriminated union by
 * capability family: inspect (project/level/actor/component/asset),
 * actor modify, import, export, editor action, editor script, PIE run,
 * build cook, build package.
 */
export interface UnrealCommandPayloadBase {
  readonly kind: "unreal-command-payload";
  readonly version: number;
}

/**
 * One inspect payload for the single-target subjects (project, level,
 * asset) — they share the wire shape; the capability fixes the subject.
 */
export interface UnrealInspectPayload extends UnrealCommandPayloadBase {
  readonly subject: "project" | "level" | "asset";
  /** Project name, level content path or asset content path (never a host path). */
  readonly target: string;
}

export interface UnrealInspectActorPayload extends UnrealCommandPayloadBase {
  readonly subject: "actor";
  /** The level the actor lives in (content path). */
  readonly target: string;
  /** Actor name within the level, e.g. BP_Player_C_1. */
  readonly actorName: string;
}

export interface UnrealInspectComponentPayload extends UnrealCommandPayloadBase {
  readonly subject: "component";
  /** The level the owning actor lives in (content path). */
  readonly target: string;
  readonly actorName: string;
  /** Component name on the actor, e.g. StaticMeshComponent_0. */
  readonly componentName: string;
}

export interface UnrealModifyActorPayload extends UnrealCommandPayloadBase {
  readonly subject: "actor";
  readonly target: string;
  readonly actorName: string;
  readonly edits: readonly UnrealActorEdit[];
}

export interface UnrealImportPayload extends UnrealCommandPayloadBase {
  readonly subject: "asset";
  /** Destination content path the artifact is imported under. */
  readonly target: string;
  readonly format: string;
  readonly artifact: UnrealArtifactRef;
}

export interface UnrealExportPayload extends UnrealCommandPayloadBase {
  readonly subject: "asset";
  /** Asset (or level/actor, per mode) content path to export. */
  readonly target: string;
  readonly format: string;
  readonly mode: "asset" | "level" | "actor";
}

export interface UnrealEditorActionPayload extends UnrealCommandPayloadBase {
  readonly subject: "editor";
  /** Named editor action id, e.g. save-all. */
  readonly action: string;
}

export interface UnrealEditorScriptPayload extends UnrealCommandPayloadBase {
  readonly subject: "editor";
  readonly action: "run-script";
  /** Digest of the script content (content lives in the exchange, not inline). */
  readonly scriptDigest: string;
}

export interface UnrealPiePayload extends UnrealCommandPayloadBase {
  readonly subject: "level";
  readonly action: "pie";
  /** The level to run in the editor. */
  readonly target: string;
  /** Number of local PIE players (1-4); omitted means one player. */
  readonly players?: number;
}

export interface UnrealCookPayload extends UnrealCommandPayloadBase {
  readonly subject: "build";
  readonly action: "cook";
  /** Project name or project-relative path being cooked. */
  readonly target: string;
  readonly targetPlatform: "windows" | "macos" | "linux";
  readonly configuration: "debug" | "development" | "shipping";
}

export interface UnrealPackagePayload extends UnrealCommandPayloadBase {
  readonly subject: "build";
  readonly action: "package";
  readonly target: string;
  readonly targetPlatform: "windows" | "macos" | "linux";
  readonly configuration: "debug" | "development" | "shipping";
}

export type UnrealCommandPayload =
  | UnrealInspectPayload
  | UnrealInspectActorPayload
  | UnrealInspectComponentPayload
  | UnrealModifyActorPayload
  | UnrealImportPayload
  | UnrealExportPayload
  | UnrealEditorActionPayload
  | UnrealEditorScriptPayload
  | UnrealPiePayload
  | UnrealCookPayload
  | UnrealPackagePayload;

/** Internal discriminator: which payload family a capability expects. */
export type UnrealPayloadFamily =
  | "inspect-project"
  | "inspect-level"
  | "inspect-actor"
  | "inspect-component"
  | "inspect-asset"
  | "modify-actor"
  | "import"
  | "export"
  | "editor-action"
  | "editor-script"
  | "level-pie"
  | "build-cook"
  | "build-package";

/** Maps a capability id to its payload family; null when not ours. */
export function payloadFamilyFor(capability: string): UnrealPayloadFamily | null {
  switch (capability) {
    case "project.inspect":
      return "inspect-project";
    case "level.inspect":
      return "inspect-level";
    case "actor.inspect":
      return "inspect-actor";
    case "component.inspect":
      return "inspect-component";
    case "asset.inspect":
      return "inspect-asset";
    case "actor.modify":
      return "modify-actor";
    case "asset.import":
      return "import";
    case "asset.export":
      return "export";
    case "editor.action":
      return "editor-action";
    case "editor.script":
      return "editor-script";
    case "level.pie":
      return "level-pie";
    case "build.cook":
      return "build-cook";
    case "build.package":
      return "build-package";
    default:
      return null;
  }
}
