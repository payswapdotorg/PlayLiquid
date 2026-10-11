/**
 * Module role: the typed, versioned command payload MODEL for the Unity
 * engine adapter — the component-oriented capability vocabulary, the
 * discriminated payload union, and the capability→family mapping. Total
 * VALIDATION lives in payload-validate.ts (same package, pure). Typed
 * kebab-case rejection codes, path-tagged; never `any`, never silent
 * coercion. Capability ids are drawn from the Tool Fabric
 * provider-neutral operation list scoped to what a Unity
 * editor/batch-mode workflow actually offers: inspect
 * project/scene/gameobject/component/prefab/asset, gameobject modify,
 * import/export, editor action, editor script, enter-play-mode run, and
 * the BuildPlayer build step. Each capability has exactly one payload
 * version family; the payload carries its own version so the bridge can
 * evolve without breaking the neutral exchange.
 *
 * Honest-surface notes (the deliberate differences from the siblings):
 * Unity names its scene graph Scene/GameObject/Component (never
 * level/actor), gameobjects are addressed by a compound transform path
 * (scene path + slash-separated object path — GameObject.Find semantics),
 * components are addressed by TYPE (GetComponent semantics — Unity has no
 * component instance names), prefab inspection is a first-class
 * capability (prefabs are the Unity reuse unit the sibling families do
 * not model), assets are addressed by their stable .meta GUID (32
 * lowercase hex — the Unity identity that survives renames), the in-editor
 * run loop is enter-play-mode (scene.play), and the build pipeline is ONE
 * BuildPlayer step (there is no separate cook step — that is the honest
 * difference from the Unreal sibling's cook → package split).
 *
 * Implements: PL-023 capability surface + command payload model (E4:
 * engine-specific behavior lives only behind this adapter's commands).
 */

// ---------------------------------------------------------------------------
// Capability surface (fixed at registration)
// ---------------------------------------------------------------------------

/** Adapter id for this adapter (engine-specific by design; E4 allows it here and only here). */
export const UNITY_ADAPTER_ID = "engine.unity" as const;

/** Neutral label; describes the engine class without vendor marketing claims. */
export const UNITY_ADAPTER_LABEL =
  "Component-oriented 3D engine adapter (in-memory bridge; real editor/batch-mode invocation is a host concern)" as const;

/** Asset formats this adapter accepts for import payloads. */
export const UNITY_IMPORT_FORMATS: readonly string[] = Object.freeze([
  "fbx",
  "obj",
  "png",
  "jpg",
  "tga",
  "exr",
  "wav",
  "mp3",
  "gltf",
  "glb",
  "usd",
  "usda",
  "usdz",
  "unitypackage",
]);

/** Asset formats this adapter can export. */
export const UNITY_EXPORT_FORMATS: readonly string[] = Object.freeze([
  "gltf",
  "glb",
  "obj",
  "png",
  "tga",
  "exr",
  "unitypackage",
]);

/** Export scopes (what gets exported). */
export const UNITY_EXPORT_MODES: readonly string[] = Object.freeze(["asset", "scene", "prefab"]);

/** Editable property kinds for gameobject modify payloads. */
export const UNITY_PROPERTY_KINDS: readonly string[] = Object.freeze([
  "position",
  "rotation",
  "scale",
  "active",
  "tag",
  "layer",
  "static",
]);

/**
 * Build target platforms this adapter's build.player capability serves —
 * the web (WebGL) + desktop + mobile subset of the frozen target taxonomy
 * (mirrors the typed engine binding's supported-target declaration).
 */
export const UNITY_BUILD_TARGET_PLATFORMS: readonly string[] = Object.freeze([
  "web",
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
]);

/** Build configurations the build.player payload accepts (Unity has release vs development builds). */
export const UNITY_BUILD_CONFIGURATIONS: readonly string[] = Object.freeze([
  "release",
  "development",
]);

/**
 * The declared capability list — the exact fixed set registered on the
 * adapter. Anything else dispatches to a typed
 * "adapter-capability/not-declared" refusal.
 */
export const UNITY_OFFERED_CAPABILITIES: readonly string[] = Object.freeze([
  "project.inspect",
  "scene.inspect",
  "gameobject.inspect",
  "component.inspect",
  "prefab.inspect",
  "asset.inspect",
  "gameobject.modify",
  "asset.import",
  "asset.export",
  "editor.action",
  "editor.script",
  "scene.play",
  "build.player",
]);

/** Payload envelope version for every capability's command payload. */
export const UNITY_PAYLOAD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Rejection vocabulary
// ---------------------------------------------------------------------------

export type UnityPayloadRejectionCode =
  | "unity-payload/not-an-object"
  | "unity-payload/version-missing"
  | "unity-payload/version-invalid"
  | "unity-payload/subject-mismatch"
  | "unity-payload/project-name-missing"
  | "unity-payload/project-name-invalid"
  | "unity-payload/scene-path-missing"
  | "unity-payload/scene-path-invalid"
  | "unity-payload/object-path-missing"
  | "unity-payload/object-path-invalid"
  | "unity-payload/component-type-missing"
  | "unity-payload/component-type-invalid"
  | "unity-payload/asset-guid-missing"
  | "unity-payload/asset-guid-invalid"
  | "unity-payload/destination-path-missing"
  | "unity-payload/destination-path-invalid"
  | "unity-payload/format-missing"
  | "unity-payload/format-invalid"
  | "unity-payload/artifact-ref-invalid"
  | "unity-payload/export-mode-missing"
  | "unity-payload/export-mode-invalid"
  | "unity-payload/edits-missing"
  | "unity-payload/edits-entry-invalid"
  | "unity-payload/property-invalid"
  | "unity-payload/action-missing"
  | "unity-payload/action-invalid"
  | "unity-payload/script-invalid"
  | "unity-payload/scene-list-missing"
  | "unity-payload/scene-list-invalid"
  | "unity-payload/target-platform-missing"
  | "unity-payload/target-platform-invalid"
  | "unity-payload/configuration-missing"
  | "unity-payload/configuration-invalid";

export interface UnityPayloadRejection {
  readonly code: UnityPayloadRejectionCode;
  readonly message: string;
  readonly path: string;
}

export type UnityPayloadValidation =
  | { readonly outcome: "ok"; readonly payload: UnityCommandPayload }
  | { readonly outcome: "rejected"; readonly rejections: readonly UnityPayloadRejection[] };

// ---------------------------------------------------------------------------
// Payload model
// ---------------------------------------------------------------------------

/** Content-addressed artifact reference (produced by the bridge/exchange). */
export interface UnityArtifactRef {
  readonly kind: "artifact-ref";
  readonly digest: string;
  readonly bytes: number;
}

/** One gameobject property edit inside a gameobject.modify payload. */
export interface UnityGameObjectEdit {
  readonly property: string;
  readonly value: unknown;
}

/**
 * The typed, versioned command payload — a discriminated union by
 * capability family: inspect (project/scene/gameobject/component/prefab/
 * asset), gameobject modify, import, export, editor action, editor script,
 * enter-play-mode run, build player.
 */
export interface UnityCommandPayloadBase {
  readonly kind: "unity-command-payload";
  readonly version: number;
}

/** Inspect a Unity project (folder name, never a host path). */
export interface UnityInspectProjectPayload extends UnityCommandPayloadBase {
  readonly subject: "project";
  readonly projectName: string;
}

/** Inspect a scene asset by its project-relative path, e.g. Assets/Scenes/Sandbox.unity. */
export interface UnityInspectScenePayload extends UnityCommandPayloadBase {
  readonly subject: "scene";
  readonly scenePath: string;
}

/** Inspect a gameobject by compound transform path inside a scene. */
export interface UnityInspectGameObjectPayload extends UnityCommandPayloadBase {
  readonly subject: "gameobject";
  readonly scenePath: string;
  /** Slash-separated object path within the scene, e.g. Player/Main Camera. */
  readonly objectPath: string;
}

/** Inspect one component by type on a gameobject (GetComponent semantics). */
export interface UnityInspectComponentPayload extends UnityCommandPayloadBase {
  readonly subject: "component";
  readonly scenePath: string;
  readonly objectPath: string;
  /** Component type name, e.g. Rigidbody, BoxCollider. */
  readonly componentType: string;
}

/** Inspect a prefab asset by its stable .meta GUID (32 lowercase hex). */
export interface UnityInspectPrefabPayload extends UnityCommandPayloadBase {
  readonly subject: "prefab";
  readonly assetGuid: string;
}

/** Inspect an asset by its stable .meta GUID (32 lowercase hex). */
export interface UnityInspectAssetPayload extends UnityCommandPayloadBase {
  readonly subject: "asset";
  readonly assetGuid: string;
}

export interface UnityModifyGameObjectPayload extends UnityCommandPayloadBase {
  readonly subject: "gameobject";
  readonly scenePath: string;
  readonly objectPath: string;
  readonly edits: readonly UnityGameObjectEdit[];
}

export interface UnityImportPayload extends UnityCommandPayloadBase {
  readonly subject: "asset";
  /** Destination asset path the artifact is imported under (Assets/…/File.ext). */
  readonly destinationPath: string;
  readonly format: string;
  readonly artifact: UnityArtifactRef;
}

export interface UnityExportPayload extends UnityCommandPayloadBase {
  readonly subject: "asset";
  /** The asset (or scene/prefab, per mode) GUID being exported. */
  readonly assetGuid: string;
  readonly format: string;
  readonly mode: "asset" | "scene" | "prefab";
}

export interface UnityEditorActionPayload extends UnityCommandPayloadBase {
  readonly subject: "editor";
  /** Named editor menu action id, e.g. save-all. */
  readonly action: string;
}

export interface UnityEditorScriptPayload extends UnityCommandPayloadBase {
  readonly subject: "editor";
  readonly action: "run-script";
  /** Digest of the script content (content lives in the exchange, not inline). */
  readonly scriptDigest: string;
}

/** Enter play mode for a scene (the Unity in-editor run loop). */
export interface UnityScenePlayPayload extends UnityCommandPayloadBase {
  readonly subject: "scene";
  readonly action: "play";
  readonly scenePath: string;
}

/** Build a player for one build-target platform (BuildPlayer semantics). */
export interface UnityBuildPlayerPayload extends UnityCommandPayloadBase {
  readonly subject: "build";
  readonly action: "build-player";
  /** Scenes included in the build, in order (1-16). */
  readonly scenePaths: readonly string[];
  readonly targetPlatform: "web" | "windows" | "macos" | "linux" | "android" | "ios";
  readonly configuration: "release" | "development";
}

export type UnityCommandPayload =
  | UnityInspectProjectPayload
  | UnityInspectScenePayload
  | UnityInspectGameObjectPayload
  | UnityInspectComponentPayload
  | UnityInspectPrefabPayload
  | UnityInspectAssetPayload
  | UnityModifyGameObjectPayload
  | UnityImportPayload
  | UnityExportPayload
  | UnityEditorActionPayload
  | UnityEditorScriptPayload
  | UnityScenePlayPayload
  | UnityBuildPlayerPayload;

/** Internal discriminator: which payload family a capability expects. */
export type UnityPayloadFamily =
  | "inspect-project"
  | "inspect-scene"
  | "inspect-gameobject"
  | "inspect-component"
  | "inspect-prefab"
  | "inspect-asset"
  | "modify-gameobject"
  | "import"
  | "export"
  | "editor-action"
  | "editor-script"
  | "scene-play"
  | "build-player";

/** Maps a capability id to its payload family; null when not ours. */
export function payloadFamilyFor(capability: string): UnityPayloadFamily | null {
  switch (capability) {
    case "project.inspect":
      return "inspect-project";
    case "scene.inspect":
      return "inspect-scene";
    case "gameobject.inspect":
      return "inspect-gameobject";
    case "component.inspect":
      return "inspect-component";
    case "prefab.inspect":
      return "inspect-prefab";
    case "asset.inspect":
      return "inspect-asset";
    case "gameobject.modify":
      return "modify-gameobject";
    case "asset.import":
      return "import";
    case "asset.export":
      return "export";
    case "editor.action":
      return "editor-action";
    case "editor.script":
      return "editor-script";
    case "scene.play":
      return "scene-play";
    case "build.player":
      return "build-player";
    default:
      return null;
  }
}
