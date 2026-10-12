/**
 * Module role: the shared per-field validators for the Godot command
 * payloads — the Godot-honest grammars every family dispatches through
 * (payload-validate.ts): version envelope, subject agreement, fixed
 * actions, res:// content paths, project names, NodePath node
 * addressing, enum/format/preset checks, content digests, artifact
 * references and node-edit lists. Every check is total (never throws),
 * accumulates typed path-tagged rejections and normalizes to frozen
 * values. Local twin of the sibling packages' inline validator block,
 * split out only to keep each file under the architecture gate's raw
 * line budget (the Godot surface carries more distinct address grammars
 * than the siblings: res:// paths, project names AND NodePaths).
 *
 * Implements: PL-024 untrusted-payload total validation (E8).
 */

import { snapshotRecord } from "./inspect.ts";
import {
  GODOT_PAYLOAD_VERSION,
  type GodotPayloadRejection,
} from "./payload-model.ts";

export function rejection(code: GodotPayloadRejection["code"], message: string, path: string): GodotPayloadRejection {
  return Object.freeze({ code, message, path });
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const RES_PATH_MAX_LENGTH = 512;
const RES_PATH_PATTERN = /^res:\/\/[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const PROJECT_NAME_MAX_LENGTH = 64;
const PROJECT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const NODE_PATH_MAX_LENGTH = 512;
const NODE_PATH_PATTERN = /^\/?[A-Za-z_][A-Za-z0-9_]*(\/[A-Za-z_][A-Za-z0-9_]*)*$/;
const PRESET_MAX_LENGTH = 128;
const PRESET_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 ._()/-]*[A-Za-z0-9()_/-])?$/;
const PROPERTY_MAX_LENGTH = 64;
const PROPERTY_PATTERN = /^[a-z][a-z0-9_]*$/;
const ACTION_MAX_LENGTH = 128;
const ACTION_PATTERN = /^[a-z][a-z0-9-]*$/;
const MAX_EDITS = 64;

export function checkVersion(record: Readonly<Record<string, unknown>>, rejections: GodotPayloadRejection[]): void {
  const raw = record["version"];
  if (raw === undefined) {
    rejections.push(rejection("godot-payload/version-missing", `payload.version must be the integer ${GODOT_PAYLOAD_VERSION}`, "payload.version"));
  } else if (raw !== GODOT_PAYLOAD_VERSION) {
    rejections.push(rejection("godot-payload/version-invalid", `payload.version must be the integer ${GODOT_PAYLOAD_VERSION}`, "payload.version"));
  }
}

export function checkSubject(record: Readonly<Record<string, unknown>>, expected: string, capability: string, rejections: GodotPayloadRejection[]): void {
  const subject = record["subject"];
  if (subject !== undefined && subject !== expected) {
    rejections.push(rejection("godot-payload/subject-mismatch", `payload.subject must be "${expected}" for ${capability}`, "payload.subject"));
  }
}

export function checkFixedAction(record: Readonly<Record<string, unknown>>, expected: string | undefined, capability: string, rejections: GodotPayloadRejection[]): void {
  if (expected === undefined) {
    return;
  }
  const raw = record["action"];
  if (raw !== undefined && raw !== expected) {
    rejections.push(rejection("godot-payload/action-invalid", `payload.action must be "${expected}" for ${capability}`, "payload.action"));
  }
}

export function checkResPath(record: Readonly<Record<string, unknown>>, rejections: GodotPayloadRejection[]): string | undefined {
  const raw = record["target"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("godot-payload/target-missing", "payload.target must be a non-empty res:// path (scene, asset or resource — never a host path)", "payload.target"));
    return undefined;
  }
  if (raw.length > RES_PATH_MAX_LENGTH || !RES_PATH_PATTERN.test(raw) || raw.endsWith("/")) {
    rejections.push(rejection("godot-payload/target-invalid", `payload.target must be 1-${RES_PATH_MAX_LENGTH} chars of res:// segments (letters/digits/_ starting each segment, then ._- inside), no trailing slash, no dot-segments, e.g. res://scenes/main.tscn`, "payload.target"));
    return undefined;
  }
  return raw;
}

export function checkProjectName(record: Readonly<Record<string, unknown>>, rejections: GodotPayloadRejection[]): string | undefined {
  const raw = record["target"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("godot-payload/project-name-missing", "payload.target must be a non-empty project name (the project.godot directory label)", "payload.target"));
    return undefined;
  }
  if (raw.length > PROJECT_NAME_MAX_LENGTH || !PROJECT_NAME_PATTERN.test(raw)) {
    rejections.push(rejection("godot-payload/project-name-invalid", `payload.target must be 1-${PROJECT_NAME_MAX_LENGTH} chars of a project name (letter first, then letters/digits/_-)`, "payload.target"));
    return undefined;
  }
  return raw;
}

export function checkNodePath(record: Readonly<Record<string, unknown>>, rejections: GodotPayloadRejection[]): string | undefined {
  const raw = record["nodePath"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("godot-payload/node-path-missing", "payload.nodePath must be a non-empty NodePath, e.g. Player/Body/Sprite2D", "payload.nodePath"));
    return undefined;
  }
  if (raw.length > NODE_PATH_MAX_LENGTH || !NODE_PATH_PATTERN.test(raw)) {
    rejections.push(rejection("godot-payload/node-path-invalid", `payload.nodePath must be 1-${NODE_PATH_MAX_LENGTH} chars of identifier segments joined by / (optionally absolute with a leading /), e.g. /root/Main/Player`, "payload.nodePath"));
    return undefined;
  }
  return raw;
}

export function checkEnum(record: Readonly<Record<string, unknown>>, key: string, allowed: readonly string[], code: GodotPayloadRejection["code"], path: string, rejections: GodotPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || !allowed.includes(raw)) {
    rejections.push(rejection(code, `${path} must be one of ${allowed.join(", ")}`, path));
    return undefined;
  }
  return raw;
}

export function checkFormat(record: Readonly<Record<string, unknown>>, key: string, allowed: readonly string[], rejections: GodotPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("godot-payload/format-missing", `payload.${key} must be a non-empty asset format`, `payload.${key}`));
    return undefined;
  }
  if (!allowed.includes(raw)) {
    rejections.push(rejection("godot-payload/format-invalid", `payload.${key} must be one of ${allowed.join(", ")}`, `payload.${key}`));
    return undefined;
  }
  return raw;
}

export function checkAction(record: Readonly<Record<string, unknown>>, rejections: GodotPayloadRejection[]): string | undefined {
  const raw = record["action"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("godot-payload/action-missing", "payload.action must be a non-empty kebab-case action id", "payload.action"));
    return undefined;
  }
  if (raw.length > ACTION_MAX_LENGTH || !ACTION_PATTERN.test(raw)) {
    rejections.push(rejection("godot-payload/action-invalid", `payload.action must be 1-${ACTION_MAX_LENGTH} chars kebab-case (lowercase letters/digits/hyphens)`, "payload.action"));
    return undefined;
  }
  return raw;
}

export function checkDigestField(record: Readonly<Record<string, unknown>>, key: string, rejections: GodotPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || !DIGEST_PATTERN.test(raw)) {
    rejections.push(rejection("godot-payload/script-invalid", `payload.${key} must be 64 lowercase hex characters (sha256 of the script content)`, `payload.${key}`));
    return undefined;
  }
  return raw;
}

export function checkHeadless(record: Readonly<Record<string, unknown>>, rejections: GodotPayloadRejection[]): boolean | undefined {
  const raw = record["headless"];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "boolean") {
    rejections.push(rejection("godot-payload/headless-invalid", "payload.headless must be a boolean when present (run headless via godot --headless)", "payload.headless"));
    return undefined;
  }
  return raw;
}

export function checkPreset(record: Readonly<Record<string, unknown>>, rejections: GodotPayloadRejection[]): string | undefined {
  const raw = record["preset"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("godot-payload/preset-missing", "payload.preset must be a non-empty export preset name from export_presets.cfg, e.g. Web (HTML5)", "payload.preset"));
    return undefined;
  }
  if (raw.length > PRESET_MAX_LENGTH || !PRESET_PATTERN.test(raw)) {
    rejections.push(rejection("godot-payload/preset-invalid", `payload.preset must be 1-${PRESET_MAX_LENGTH} chars of an export preset name (starts/ends non-space; letters/digits/space/._()/- inside), e.g. Web (HTML5) or Linux/X11`, "payload.preset"));
    return undefined;
  }
  return raw;
}

export function checkArtifactRef(record: Readonly<Record<string, unknown>>, rejections: GodotPayloadRejection[]): { kind: "artifact-ref"; digest: string; bytes: number } | undefined {
  const artifactRecord = snapshotRecord(record["artifact"]);
  if (artifactRecord === null) {
    rejections.push(rejection("godot-payload/artifact-ref-invalid", 'payload.artifact must be an artifact reference { kind: "artifact-ref", digest, bytes }', "payload.artifact"));
    return undefined;
  }
  const digest = artifactRecord["digest"];
  const bytes = artifactRecord["bytes"];
  let ok = true;
  if (artifactRecord["kind"] !== "artifact-ref") {
    rejections.push(rejection("godot-payload/artifact-ref-invalid", 'payload.artifact.kind must be the literal "artifact-ref"', "payload.artifact.kind"));
    ok = false;
  }
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
    rejections.push(rejection("godot-payload/artifact-ref-invalid", "payload.artifact.digest must be 64 lowercase hex characters (sha256)", "payload.artifact.digest"));
    ok = false;
  }
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    rejections.push(rejection("godot-payload/artifact-ref-invalid", "payload.artifact.bytes must be a positive integer size", "payload.artifact.bytes"));
    ok = false;
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze({ kind: "artifact-ref", digest: digest as string, bytes: bytes as number });
}

export function checkEdits(record: Readonly<Record<string, unknown>>, rejections: GodotPayloadRejection[]): readonly { property: string; value: unknown }[] | undefined {
  const raw = record["edits"];
  if (!Array.isArray(raw) || raw.length === 0) {
    rejections.push(rejection("godot-payload/edits-missing", "payload.edits must be a non-empty array of node property edits", "payload.edits"));
    return undefined;
  }
  if (raw.length > MAX_EDITS) {
    rejections.push(rejection("godot-payload/edits-entry-invalid", `payload.edits must have at most ${MAX_EDITS} entries`, "payload.edits"));
    return undefined;
  }
  const edits: { property: string; value: unknown }[] = [];
  let ok = true;
  for (let index = 0; index < raw.length; index += 1) {
    const entry = snapshotRecord(raw[index]);
    if (entry === null) {
      ok = false;
      rejections.push(rejection("godot-payload/edits-entry-invalid", `payload.edits[${index}] must be a non-array object`, `payload.edits[${index}]`));
      continue;
    }
    const property = entry["property"];
    if (typeof property !== "string" || !PROPERTY_PATTERN.test(property) || property.length > PROPERTY_MAX_LENGTH) {
      ok = false;
      rejections.push(rejection("godot-payload/property-invalid", `payload.edits[${index}].property must be 1-${PROPERTY_MAX_LENGTH} chars snake_case (Godot node property names are snake_case)`, `payload.edits[${index}].property`));
      continue;
    }
    if (!("value" in entry)) {
      ok = false;
      rejections.push(rejection("godot-payload/edits-entry-invalid", `payload.edits[${index}].value is required`, `payload.edits[${index}].value`));
      continue;
    }
    edits.push(Object.freeze({ property, value: entry["value"] }));
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze(edits);
}
