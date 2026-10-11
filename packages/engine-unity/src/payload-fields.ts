/**
 * Module role: the shared FIELD validators for the Unity command payload
 * model (payload-model.ts) — the total, never-throwing checks each payload
 * family composes in payload-validate.ts. Split from the family dispatch
 * to keep both files inside the architecture gate's raw-line budget
 * (the family dispatch is the larger half). Every check accumulates
 * typed, path-tagged rejections into the caller's list and returns the
 * normalized field value (or undefined when the field is unusable);
 * nothing here throws, nothing coerces silently.
 *
 * Unity-specific grammar decisions (E4 — engine vocabulary lives only
 * here): asset paths are project-relative "Assets/…" paths (never host
 * paths), scene paths end in ".unity", gameobject paths are
 * slash-separated transform paths (GameObject.Find semantics), component
 * addressing is by type name (GetComponent semantics), and asset identity
 * is the .meta GUID (32 lowercase hex).
 *
 * Implements: PL-023 untrusted-payload total validation (E8), field half.
 */

import { snapshotRecord } from "./inspect.ts";
import type { UnityArtifactRef, UnityPayloadRejection, UnityPayloadRejectionCode } from "./payload-model.ts";

export function rejection(code: UnityPayloadRejectionCode, message: string, path: string): UnityPayloadRejection {
  return Object.freeze({ code, message, path });
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
/** Unity .meta GUID: 32 lowercase hex characters. */
const GUID_PATTERN = /^[a-f0-9]{32}$/;

const PROJECT_NAME_MAX_LENGTH = 128;
const PROJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
const ASSET_PATH_MAX_LENGTH = 512;
/** One Assets/… path segment: starts alphanumeric, no dot-segments. */
const ASSET_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
const OBJECT_PATH_MAX_LENGTH = 1024;
/** One transform-path segment: GameObject names may contain spaces/parens. */
const OBJECT_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _().-]*$/;
const OBJECT_PATH_MAX_SEGMENTS = 16;
const OBJECT_SEGMENT_MAX_LENGTH = 128;
const COMPONENT_TYPE_MAX_LENGTH = 128;
/** C# type-name shape (Unity component types are PascalCase identifiers). */
const COMPONENT_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const PROPERTY_MAX_LENGTH = 64;
const PROPERTY_PATTERN = /^[a-z][a-z0-9-]*$/;
const ACTION_MAX_LENGTH = 128;
const ACTION_PATTERN = /^[a-z][a-z0-9-]*$/;
const MAX_EDITS = 64;
const MAX_BUILD_SCENES = 16;

export function checkVersion(record: Readonly<Record<string, unknown>>, expected: number, rejections: UnityPayloadRejection[]): void {
  const raw = record["version"];
  if (raw === undefined) {
    rejections.push(rejection("unity-payload/version-missing", `payload.version must be the integer ${expected}`, "payload.version"));
  } else if (raw !== expected) {
    rejections.push(rejection("unity-payload/version-invalid", `payload.version must be the integer ${expected}`, "payload.version"));
  }
}

export function checkSubject(record: Readonly<Record<string, unknown>>, expected: string, capability: string, rejections: UnityPayloadRejection[]): void {
  const subject = record["subject"];
  if (subject !== undefined && subject !== expected) {
    rejections.push(rejection("unity-payload/subject-mismatch", `payload.subject must be "${expected}" for ${capability}`, "payload.subject"));
  }
}

export function checkFixedAction(record: Readonly<Record<string, unknown>>, expected: string, capability: string, rejections: UnityPayloadRejection[]): void {
  const raw = record["action"];
  if (raw !== undefined && raw !== expected) {
    rejections.push(rejection("unity-payload/action-invalid", `payload.action must be "${expected}" for ${capability}`, "payload.action"));
  }
}

export function checkProjectName(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): string | undefined {
  const raw = record["projectName"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unity-payload/project-name-missing", "payload.projectName must be a non-empty string (project folder name — never a host path)", "payload.projectName"));
    return undefined;
  }
  if (raw.length > PROJECT_NAME_MAX_LENGTH || !PROJECT_NAME_PATTERN.test(raw)) {
    rejections.push(rejection("unity-payload/project-name-invalid", `payload.projectName must be 1-${PROJECT_NAME_MAX_LENGTH} chars of letters/digits/space/_- starting with an alphanumeric, e.g. MyGame`, "payload.projectName"));
    return undefined;
  }
  return raw;
}

/** Shared Assets/… path grammar (segments must start alphanumeric — no dot-segments). */
function checkAssetPath(record: Readonly<Record<string, unknown>>, key: string, missingCode: UnityPayloadRejectionCode, invalidCode: UnityPayloadRejectionCode, describe: string, rejections: UnityPayloadRejection[], suffix: string): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection(missingCode, `payload.${key} must be a non-empty ${describe}`, `payload.${key}`));
    return undefined;
  }
  if (raw.length > ASSET_PATH_MAX_LENGTH || !raw.startsWith("Assets/")) {
    rejections.push(rejection(invalidCode, `payload.${key} must be a project-relative Assets/… path of at most ${ASSET_PATH_MAX_LENGTH} chars (never a host path)`, `payload.${key}`));
    return undefined;
  }
  const segments = raw.slice("Assets/".length).split("/");
  const last = segments[segments.length - 1] ?? "";
  const segmentsOk = segments.every((segment) => ASSET_SEGMENT_PATTERN.test(segment));
  if (!segmentsOk || (suffix !== "" && !last.endsWith(suffix))) {
    const suffixNote = suffix === "" ? " with a file extension" : ` ending in "${suffix}"`;
    rejections.push(rejection(invalidCode, `payload.${key} must be Assets/… segments starting with an alphanumeric${suffixNote}, e.g. Assets/Scenes/Sandbox${suffix === "" ? ".fbx" : suffix}`, `payload.${key}`));
    return undefined;
  }
  return raw;
}

export function checkScenePath(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): string | undefined {
  return checkAssetPath(record, "scenePath", "unity-payload/scene-path-missing", "unity-payload/scene-path-invalid", "scene asset path", rejections, ".unity");
}

export function checkDestinationPath(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): string | undefined {
  const raw = checkAssetPath(record, "destinationPath", "unity-payload/destination-path-missing", "unity-payload/destination-path-invalid", "destination asset path", rejections, "");
  if (raw === undefined) {
    return undefined;
  }
  const last = raw.slice(raw.lastIndexOf("/") + 1);
  if (!last.includes(".") || last.startsWith(".")) {
    rejections.push(rejection("unity-payload/destination-path-invalid", "payload.destinationPath must end in a file name with an extension, e.g. Assets/Imported/Hero.fbx", "payload.destinationPath"));
    return undefined;
  }
  return raw;
}

export function checkObjectPath(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): string | undefined {
  const raw = record["objectPath"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unity-payload/object-path-missing", "payload.objectPath must be a non-empty slash-separated gameobject path, e.g. Player/Main Camera", "payload.objectPath"));
    return undefined;
  }
  if (raw.length > OBJECT_PATH_MAX_LENGTH) {
    rejections.push(rejection("unity-payload/object-path-invalid", `payload.objectPath must be at most ${OBJECT_PATH_MAX_LENGTH} chars`, "payload.objectPath"));
    return undefined;
  }
  const segments = raw.split("/");
  const ok =
    segments.length <= OBJECT_PATH_MAX_SEGMENTS &&
    segments.every((segment) => segment.length > 0 && segment.length <= OBJECT_SEGMENT_MAX_LENGTH && OBJECT_SEGMENT_PATTERN.test(segment));
  if (!ok) {
    rejections.push(rejection("unity-payload/object-path-invalid", `payload.objectPath must be 1-${OBJECT_PATH_MAX_SEGMENTS} slash-separated segments of 1-${OBJECT_SEGMENT_MAX_LENGTH} chars (letters/digits/space/_().- starting with an alphanumeric), e.g. Player/Main Camera`, "payload.objectPath"));
    return undefined;
  }
  return raw;
}

export function checkComponentType(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): string | undefined {
  const raw = record["componentType"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unity-payload/component-type-missing", "payload.componentType must be a non-empty component type name, e.g. Rigidbody", "payload.componentType"));
    return undefined;
  }
  if (raw.length > COMPONENT_TYPE_MAX_LENGTH || !COMPONENT_TYPE_PATTERN.test(raw)) {
    rejections.push(rejection("unity-payload/component-type-invalid", `payload.componentType must be 1-${COMPONENT_TYPE_MAX_LENGTH} chars of letters/digits starting with a letter (a C# type name, e.g. BoxCollider)`, "payload.componentType"));
    return undefined;
  }
  return raw;
}

export function checkAssetGuid(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): string | undefined {
  const raw = record["assetGuid"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unity-payload/asset-guid-missing", "payload.assetGuid must be a non-empty asset GUID", "payload.assetGuid"));
    return undefined;
  }
  if (!GUID_PATTERN.test(raw)) {
    rejections.push(rejection("unity-payload/asset-guid-invalid", "payload.assetGuid must be 32 lowercase hex characters (the .meta GUID — Unity's stable asset identity)", "payload.assetGuid"));
    return undefined;
  }
  return raw;
}

export function checkEnum(record: Readonly<Record<string, unknown>>, key: string, allowed: readonly string[], code: UnityPayloadRejectionCode, path: string, rejections: UnityPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || !allowed.includes(raw)) {
    rejections.push(rejection(code, `${path} must be one of ${allowed.join(", ")}`, path));
    return undefined;
  }
  return raw;
}

export function checkFormat(record: Readonly<Record<string, unknown>>, key: string, allowed: readonly string[], rejections: UnityPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unity-payload/format-missing", `payload.${key} must be a non-empty asset format`, `payload.${key}`));
    return undefined;
  }
  if (!allowed.includes(raw)) {
    rejections.push(rejection("unity-payload/format-invalid", `payload.${key} must be one of ${allowed.join(", ")}`, `payload.${key}`));
    return undefined;
  }
  return raw;
}

export function checkAction(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): string | undefined {
  const raw = record["action"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unity-payload/action-missing", "payload.action must be a non-empty kebab-case action id", "payload.action"));
    return undefined;
  }
  if (raw.length > ACTION_MAX_LENGTH || !ACTION_PATTERN.test(raw)) {
    rejections.push(rejection("unity-payload/action-invalid", `payload.action must be 1-${ACTION_MAX_LENGTH} chars kebab-case (lowercase letters/digits/hyphens)`, "payload.action"));
    return undefined;
  }
  return raw;
}

export function checkDigestField(record: Readonly<Record<string, unknown>>, key: string, rejections: UnityPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || !DIGEST_PATTERN.test(raw)) {
    rejections.push(rejection("unity-payload/script-invalid", `payload.${key} must be 64 lowercase hex characters (sha256 of the script content)`, `payload.${key}`));
    return undefined;
  }
  return raw;
}

export function checkSceneList(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): readonly string[] | undefined {
  const raw = record["scenePaths"];
  if (!Array.isArray(raw) || raw.length === 0) {
    rejections.push(rejection("unity-payload/scene-list-missing", `payload.scenePaths must be a non-empty array of scene asset paths (the build scene list)`, "payload.scenePaths"));
    return undefined;
  }
  const scenes: string[] = [];
  let ok = true;
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (typeof entry !== "string" || !entry.startsWith("Assets/") || entry.length > ASSET_PATH_MAX_LENGTH || !entry.endsWith(".unity") || !entry.slice("Assets/".length).split("/").every((segment) => ASSET_SEGMENT_PATTERN.test(segment))) {
      ok = false;
      rejections.push(rejection("unity-payload/scene-list-invalid", `payload.scenePaths[${index}] must be a project-relative Assets/….unity scene path`, `payload.scenePaths[${index}]`));
      continue;
    }
    scenes.push(entry);
  }
  if (!ok || scenes.length > MAX_BUILD_SCENES) {
    if (ok) {
      rejections.push(rejection("unity-payload/scene-list-invalid", `payload.scenePaths must have at most ${MAX_BUILD_SCENES} entries`, "payload.scenePaths"));
    }
    return undefined;
  }
  return Object.freeze(scenes);
}

export function checkArtifactRef(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): UnityArtifactRef | undefined {
  const artifactRecord = snapshotRecord(record["artifact"]);
  if (artifactRecord === null) {
    rejections.push(rejection("unity-payload/artifact-ref-invalid", 'payload.artifact must be an artifact reference { kind: "artifact-ref", digest, bytes }', "payload.artifact"));
    return undefined;
  }
  const digest = artifactRecord["digest"];
  const bytes = artifactRecord["bytes"];
  let ok = true;
  if (artifactRecord["kind"] !== "artifact-ref") {
    rejections.push(rejection("unity-payload/artifact-ref-invalid", 'payload.artifact.kind must be the literal "artifact-ref"', "payload.artifact.kind"));
    ok = false;
  }
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
    rejections.push(rejection("unity-payload/artifact-ref-invalid", "payload.artifact.digest must be 64 lowercase hex characters (sha256)", "payload.artifact.digest"));
    ok = false;
  }
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    rejections.push(rejection("unity-payload/artifact-ref-invalid", "payload.artifact.bytes must be a positive integer size", "payload.artifact.bytes"));
    ok = false;
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze({ kind: "artifact-ref", digest: digest as string, bytes: bytes as number });
}

export function checkEdits(record: Readonly<Record<string, unknown>>, rejections: UnityPayloadRejection[]): readonly { property: string; value: unknown }[] | undefined {
  const raw = record["edits"];
  if (!Array.isArray(raw) || raw.length === 0) {
    rejections.push(rejection("unity-payload/edits-missing", "payload.edits must be a non-empty array of gameobject property edits", "payload.edits"));
    return undefined;
  }
  if (raw.length > MAX_EDITS) {
    rejections.push(rejection("unity-payload/edits-entry-invalid", `payload.edits must have at most ${MAX_EDITS} entries`, "payload.edits"));
    return undefined;
  }
  const edits: { property: string; value: unknown }[] = [];
  let ok = true;
  for (let index = 0; index < raw.length; index += 1) {
    const entry = snapshotRecord(raw[index]);
    if (entry === null) {
      ok = false;
      rejections.push(rejection("unity-payload/edits-entry-invalid", `payload.edits[${index}] must be a non-array object`, `payload.edits[${index}]`));
      continue;
    }
    const property = entry["property"];
    if (typeof property !== "string" || !PROPERTY_PATTERN.test(property) || property.length > PROPERTY_MAX_LENGTH) {
      ok = false;
      rejections.push(rejection("unity-payload/property-invalid", `payload.edits[${index}].property must be 1-${PROPERTY_MAX_LENGTH} chars kebab-case`, `payload.edits[${index}].property`));
      continue;
    }
    if (!("value" in entry)) {
      ok = false;
      rejections.push(rejection("unity-payload/edits-entry-invalid", `payload.edits[${index}].value is required`, `payload.edits[${index}].value`));
      continue;
    }
    edits.push(Object.freeze({ property, value: entry["value"] }));
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze(edits);
}
