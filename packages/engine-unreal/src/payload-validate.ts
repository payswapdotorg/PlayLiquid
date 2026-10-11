/**
 * Module role: the total payload validator — the discriminated-union
 * dispatch over the typed payload model in payload-model.ts. Total;
 * never throws; accumulates every problem in one pass; normalizes to a
 * frozen typed payload with unknown keys dropped. The subject field is
 * optional in the wire shape (the capability fixes it) but must not
 * contradict the capability's family.
 *
 * Implements: PL-022 untrusted-payload total validation (E8).
 */

import { snapshotRecord } from "./inspect.ts";
import {
  UNREAL_BUILD_CONFIGURATIONS,
  UNREAL_BUILD_TARGET_PLATFORMS,
  UNREAL_EXPORT_FORMATS,
  UNREAL_EXPORT_MODES,
  UNREAL_IMPORT_FORMATS,
  UNREAL_PAYLOAD_VERSION,
  payloadFamilyFor,
  type UnrealCommandPayload,
  type UnrealPayloadRejection,
  type UnrealPayloadValidation,
} from "./payload-model.ts";

function rejection(code: UnrealPayloadRejection["code"], message: string, path: string): UnrealPayloadRejection {
  return Object.freeze({ code, message, path });
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Validates an untrusted command payload for a given capability id (the
 * capability must be one of the adapter's declared capabilities; anything
 * else is rejected here as unreachable-through-the-adapter input).
 */
export function validateUnrealCommandPayload(capability: string, input: unknown): UnrealPayloadValidation {
  const family = payloadFamilyFor(capability);
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("unreal-payload/not-an-object", "command payload must be a non-array object", "payload")],
    };
  }
  if (family === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("unreal-payload/not-an-object", `capability ${capability} is not an Unreal adapter capability`, "capability")],
    };
  }

  const rejections: UnrealPayloadRejection[] = [];
  checkVersion(record, rejections);
  let payload: UnrealCommandPayload | undefined;

  switch (family) {
    case "inspect-project":
    case "inspect-level":
    case "inspect-asset": {
      const expected = inspectSubjectOf(family);
      checkSubject(record, expected, capability, rejections);
      const target = checkTarget(record, rejections);
      if (target !== undefined) {
        payload = Object.freeze({
          kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION, subject: expected, target,
        });
      }
      break;
    }
    case "inspect-actor":
    case "modify-actor": {
      checkSubject(record, "actor", capability, rejections);
      const target = checkTarget(record, rejections);
      const actorName = checkActorName(record, rejections);
      if (family === "inspect-actor") {
        if (target !== undefined && actorName !== undefined) {
          payload = Object.freeze({
            kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION, subject: "actor", target, actorName,
          });
        }
      } else {
        const edits = checkEdits(record, rejections);
        if (target !== undefined && actorName !== undefined && edits !== undefined) {
          payload = Object.freeze({
            kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION, subject: "actor", target, actorName, edits,
          });
        }
      }
      break;
    }
    case "inspect-component": {
      checkSubject(record, "component", capability, rejections);
      const target = checkTarget(record, rejections);
      const actorName = checkActorName(record, rejections);
      const componentName = checkComponentName(record, rejections);
      if (target !== undefined && actorName !== undefined && componentName !== undefined) {
        payload = Object.freeze({
          kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION, subject: "component",
          target, actorName, componentName,
        });
      }
      break;
    }
    case "import": {
      checkSubject(record, "asset", capability, rejections);
      const target = checkTarget(record, rejections);
      const format = checkFormat(record, "format", UNREAL_IMPORT_FORMATS, rejections);
      const artifact = checkArtifactRef(record, rejections);
      if (target !== undefined && format !== undefined && artifact !== undefined) {
        payload = Object.freeze({
          kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION, subject: "asset",
          target, format, artifact,
        });
      }
      break;
    }
    case "export": {
      checkSubject(record, "asset", capability, rejections);
      const target = checkTarget(record, rejections);
      const format = checkFormat(record, "format", UNREAL_EXPORT_FORMATS, rejections);
      const mode = checkEnum(record, "mode", UNREAL_EXPORT_MODES, "unreal-payload/export-mode-missing", "payload.mode", rejections);
      if (target !== undefined && format !== undefined && mode !== undefined) {
        payload = Object.freeze({
          kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION, subject: "asset",
          target, format, mode: mode as "asset" | "level" | "actor",
        });
      }
      break;
    }
    case "editor-action": {
      checkSubject(record, "editor", capability, rejections);
      const action = checkAction(record, rejections);
      if (action !== undefined) {
        payload = Object.freeze({
          kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION, subject: "editor", action,
        });
      }
      break;
    }
    case "editor-script": {
      checkSubject(record, "editor", capability, rejections);
      checkFixedAction(record, "run-script", "editor.script", rejections);
      const scriptDigest = checkDigestField(record, "scriptDigest", rejections);
      if (scriptDigest !== undefined) {
        payload = Object.freeze({
          kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION,
          subject: "editor", action: "run-script", scriptDigest,
        });
      }
      break;
    }
    case "level-pie": {
      checkSubject(record, "level", capability, rejections);
      checkFixedAction(record, "pie", "level.pie", rejections);
      const target = checkTarget(record, rejections);
      const players = checkPlayers(record, rejections);
      if (target !== undefined) {
        payload = Object.freeze({
          kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION, subject: "level", action: "pie", target,
          ...(players === undefined ? {} : { players }),
        });
      }
      break;
    }
    case "build-cook":
    case "build-package": {
      checkSubject(record, "build", capability, rejections);
      checkFixedAction(record, family === "build-cook" ? "cook" : "package", capability, rejections);
      const target = checkTarget(record, rejections);
      const targetPlatform = checkEnum(record, "targetPlatform", UNREAL_BUILD_TARGET_PLATFORMS, "unreal-payload/target-platform-missing", "payload.targetPlatform", rejections);
      const configuration = checkEnum(record, "configuration", UNREAL_BUILD_CONFIGURATIONS, "unreal-payload/configuration-missing", "payload.configuration", rejections);
      if (target !== undefined && targetPlatform !== undefined && configuration !== undefined) {
        payload = Object.freeze({
          kind: "unreal-command-payload", version: UNREAL_PAYLOAD_VERSION, subject: "build",
          action: family === "build-cook" ? "cook" : "package", target,
          targetPlatform: targetPlatform as "windows" | "macos" | "linux",
          configuration: configuration as "debug" | "development" | "shipping",
        });
      }
      break;
    }
  }

  if (rejections.length > 0 || payload === undefined) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }
  return { outcome: "ok", payload };
}

// ---------------------------------------------------------------------------
// Shared field validators (module-local)
// ---------------------------------------------------------------------------

const TARGET_MAX_LENGTH = 512;
const TARGET_PATTERN = /^\/?[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const OBJECT_NAME_MAX_LENGTH = 128;
const OBJECT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const PROPERTY_MAX_LENGTH = 64;
const PROPERTY_PATTERN = /^[a-z][a-z0-9-]*$/;
const ACTION_MAX_LENGTH = 128;
const ACTION_PATTERN = /^[a-z][a-z0-9-]*$/;
const MAX_EDITS = 64;
const MAX_PLAYERS = 4;

function inspectSubjectOf(family: "inspect-project" | "inspect-level" | "inspect-asset"): "project" | "level" | "asset" {
  return family === "inspect-project" ? "project" : family === "inspect-level" ? "level" : "asset";
}

function checkVersion(record: Readonly<Record<string, unknown>>, rejections: UnrealPayloadRejection[]): void {
  const raw = record["version"];
  if (raw === undefined) {
    rejections.push(rejection("unreal-payload/version-missing", `payload.version must be the integer ${UNREAL_PAYLOAD_VERSION}`, "payload.version"));
  } else if (raw !== UNREAL_PAYLOAD_VERSION) {
    rejections.push(rejection("unreal-payload/version-invalid", `payload.version must be the integer ${UNREAL_PAYLOAD_VERSION}`, "payload.version"));
  }
}

function checkSubject(record: Readonly<Record<string, unknown>>, expected: string, capability: string, rejections: UnrealPayloadRejection[]): void {
  const subject = record["subject"];
  if (subject !== undefined && subject !== expected) {
    rejections.push(rejection("unreal-payload/subject-mismatch", `payload.subject must be "${expected}" for ${capability}`, "payload.subject"));
  }
}

function checkFixedAction(record: Readonly<Record<string, unknown>>, expected: string | undefined, capability: string, rejections: UnrealPayloadRejection[]): void {
  if (expected === undefined) {
    return;
  }
  const raw = record["action"];
  if (raw !== undefined && raw !== expected) {
    rejections.push(rejection("unreal-payload/action-invalid", `payload.action must be "${expected}" for ${capability}`, "payload.action"));
  }
}

function checkTarget(record: Readonly<Record<string, unknown>>, rejections: UnrealPayloadRejection[]): string | undefined {
  const raw = record["target"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unreal-payload/target-missing", "payload.target must be a non-empty string (project name, level/asset content path — never a host path)", "payload.target"));
    return undefined;
  }
  if (raw.length > TARGET_MAX_LENGTH || !TARGET_PATTERN.test(raw) || raw.endsWith("/") || raw.split("/").some((segment) => segment === "." || segment === "..")) {
    rejections.push(rejection("unreal-payload/target-invalid", `payload.target must be 1-${TARGET_MAX_LENGTH} chars of project-relative/content-path segments (letters/digits/._-) with no dot-segments, e.g. /Game/Maps/L_Sandbox`, "payload.target"));
    return undefined;
  }
  return raw;
}

function checkActorName(record: Readonly<Record<string, unknown>>, rejections: UnrealPayloadRejection[]): string | undefined {
  const raw = record["actorName"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unreal-payload/actor-name-missing", "payload.actorName must be a non-empty actor name, e.g. BP_Player_C_1", "payload.actorName"));
    return undefined;
  }
  if (raw.length > OBJECT_NAME_MAX_LENGTH || !OBJECT_NAME_PATTERN.test(raw)) {
    rejections.push(rejection("unreal-payload/actor-name-invalid", `payload.actorName must be 1-${OBJECT_NAME_MAX_LENGTH} chars of letters/digits/_ starting with a letter`, "payload.actorName"));
    return undefined;
  }
  return raw;
}

function checkComponentName(record: Readonly<Record<string, unknown>>, rejections: UnrealPayloadRejection[]): string | undefined {
  const raw = record["componentName"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unreal-payload/component-name-missing", "payload.componentName must be a non-empty component name, e.g. StaticMeshComponent_0", "payload.componentName"));
    return undefined;
  }
  if (raw.length > OBJECT_NAME_MAX_LENGTH || !OBJECT_NAME_PATTERN.test(raw)) {
    rejections.push(rejection("unreal-payload/component-name-invalid", `payload.componentName must be 1-${OBJECT_NAME_MAX_LENGTH} chars of letters/digits/_ starting with a letter`, "payload.componentName"));
    return undefined;
  }
  return raw;
}

function checkEnum(record: Readonly<Record<string, unknown>>, key: string, allowed: readonly string[], code: UnrealPayloadRejection["code"], path: string, rejections: UnrealPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || !allowed.includes(raw)) {
    rejections.push(rejection(code, `${path} must be one of ${allowed.join(", ")}`, path));
    return undefined;
  }
  return raw;
}

function checkFormat(record: Readonly<Record<string, unknown>>, key: string, allowed: readonly string[], rejections: UnrealPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unreal-payload/format-missing", `payload.${key} must be a non-empty asset format`, `payload.${key}`));
    return undefined;
  }
  if (!allowed.includes(raw)) {
    rejections.push(rejection("unreal-payload/format-invalid", `payload.${key} must be one of ${allowed.join(", ")}`, `payload.${key}`));
    return undefined;
  }
  return raw;
}

function checkAction(record: Readonly<Record<string, unknown>>, rejections: UnrealPayloadRejection[]): string | undefined {
  const raw = record["action"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("unreal-payload/action-missing", "payload.action must be a non-empty kebab-case action id", "payload.action"));
    return undefined;
  }
  if (raw.length > ACTION_MAX_LENGTH || !ACTION_PATTERN.test(raw)) {
    rejections.push(rejection("unreal-payload/action-invalid", `payload.action must be 1-${ACTION_MAX_LENGTH} chars kebab-case (lowercase letters/digits/hyphens)`, "payload.action"));
    return undefined;
  }
  return raw;
}

function checkDigestField(record: Readonly<Record<string, unknown>>, key: string, rejections: UnrealPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || !DIGEST_PATTERN.test(raw)) {
    rejections.push(rejection("unreal-payload/script-invalid", `payload.${key} must be 64 lowercase hex characters (sha256 of the script content)`, `payload.${key}`));
    return undefined;
  }
  return raw;
}

function checkPlayers(record: Readonly<Record<string, unknown>>, rejections: UnrealPayloadRejection[]): number | undefined {
  const raw = record["players"];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > MAX_PLAYERS) {
    rejections.push(rejection("unreal-payload/players-invalid", `payload.players must be an integer between 1 and ${MAX_PLAYERS} when present`, "payload.players"));
    return undefined;
  }
  return raw;
}

function checkArtifactRef(record: Readonly<Record<string, unknown>>, rejections: UnrealPayloadRejection[]): { kind: "artifact-ref"; digest: string; bytes: number } | undefined {
  const artifactRecord = snapshotRecord(record["artifact"]);
  if (artifactRecord === null) {
    rejections.push(rejection("unreal-payload/artifact-ref-invalid", 'payload.artifact must be an artifact reference { kind: "artifact-ref", digest, bytes }', "payload.artifact"));
    return undefined;
  }
  const digest = artifactRecord["digest"];
  const bytes = artifactRecord["bytes"];
  let ok = true;
  if (artifactRecord["kind"] !== "artifact-ref") {
    rejections.push(rejection("unreal-payload/artifact-ref-invalid", 'payload.artifact.kind must be the literal "artifact-ref"', "payload.artifact.kind"));
    ok = false;
  }
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
    rejections.push(rejection("unreal-payload/artifact-ref-invalid", "payload.artifact.digest must be 64 lowercase hex characters (sha256)", "payload.artifact.digest"));
    ok = false;
  }
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    rejections.push(rejection("unreal-payload/artifact-ref-invalid", "payload.artifact.bytes must be a positive integer size", "payload.artifact.bytes"));
    ok = false;
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze({ kind: "artifact-ref", digest: digest as string, bytes: bytes as number });
}

function checkEdits(record: Readonly<Record<string, unknown>>, rejections: UnrealPayloadRejection[]): readonly { property: string; value: unknown }[] | undefined {
  const raw = record["edits"];
  if (!Array.isArray(raw) || raw.length === 0) {
    rejections.push(rejection("unreal-payload/edits-missing", "payload.edits must be a non-empty array of actor property edits", "payload.edits"));
    return undefined;
  }
  if (raw.length > MAX_EDITS) {
    rejections.push(rejection("unreal-payload/edits-entry-invalid", `payload.edits must have at most ${MAX_EDITS} entries`, "payload.edits"));
    return undefined;
  }
  const edits: { property: string; value: unknown }[] = [];
  let ok = true;
  for (let index = 0; index < raw.length; index += 1) {
    const entry = snapshotRecord(raw[index]);
    if (entry === null) {
      ok = false;
      rejections.push(rejection("unreal-payload/edits-entry-invalid", `payload.edits[${index}] must be a non-array object`, `payload.edits[${index}]`));
      continue;
    }
    const property = entry["property"];
    if (typeof property !== "string" || !PROPERTY_PATTERN.test(property) || property.length > PROPERTY_MAX_LENGTH) {
      ok = false;
      rejections.push(rejection("unreal-payload/property-invalid", `payload.edits[${index}].property must be 1-${PROPERTY_MAX_LENGTH} chars kebab-case`, `payload.edits[${index}].property`));
      continue;
    }
    if (!("value" in entry)) {
      ok = false;
      rejections.push(rejection("unreal-payload/edits-entry-invalid", `payload.edits[${index}].value is required`, `payload.edits[${index}].value`));
      continue;
    }
    edits.push(Object.freeze({ property, value: entry["value"] }));
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze(edits);
}
