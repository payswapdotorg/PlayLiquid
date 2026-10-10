/**
 * Module role: the total payload validator — the discriminated-union
 * dispatch over the typed payload model in payload-model.ts. Total;
 * never throws; accumulates every problem in one pass; normalizes to a
 * frozen typed payload with unknown keys dropped. The subject field is
 * optional in the wire shape (the capability fixes it) but must not
 * contradict the capability's family.
 *
 * Implements: PL-025 untrusted-payload total validation (E8).
 */

import { snapshotRecord } from "./inspect.ts";
import {
  BLENDER_ASSET_FORMATS,
  BLENDER_EXPORT_MODES,
  BLENDER_IMPORT_TARGETS,
  BLENDER_PAYLOAD_VERSION,
  payloadFamilyFor,
  type BlenderCommandPayload,
  type BlenderPayloadRejection,
  type BlenderPayloadValidation,
} from "./payload-model.ts";

function rejection(code: BlenderPayloadRejection["code"], message: string, path: string): BlenderPayloadRejection {
  return Object.freeze({ code, message, path });
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const OBJECT_NAME_MAX_LENGTH = 128;
const OBJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

/**
 * Validates an untrusted command payload for a given capability id (the
 * capability must be one of the adapter's declared capabilities; anything
 * else is rejected here as unreachable-through-the-adapter input).
 */
export function validateBlenderCommandPayload(capability: string, input: unknown): BlenderPayloadValidation {
  const family = payloadFamilyFor(capability);
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("blender-payload/not-an-object", "command payload must be a non-array object", "payload")],
    };
  }
  if (family === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("blender-payload/not-an-object", `capability ${capability} is not a Blender adapter capability`, "capability")],
    };
  }

  const rejections: BlenderPayloadRejection[] = [];

  const rawVersion = record["version"];
  if (rawVersion === undefined) {
    rejections.push(rejection("blender-payload/version-missing", `payload.version must be the integer ${BLENDER_PAYLOAD_VERSION}`, "payload.version"));
  } else if (rawVersion !== BLENDER_PAYLOAD_VERSION) {
    rejections.push(rejection("blender-payload/version-invalid", `payload.version must be the integer ${BLENDER_PAYLOAD_VERSION}`, "payload.version"));
  }

  let payload: BlenderCommandPayload | undefined;

  switch (family) {
    case "inspect-project":
    case "inspect-scene":
    case "inspect-asset": {
      const expected = family === "inspect-project" ? "project" : family === "inspect-scene" ? "scene" : "asset";
      checkSubject(record, expected, capability, rejections);
      const target = checkTarget(record, rejections);
      if (target !== undefined) {
        payload = Object.freeze({
          kind: "blender-command-payload",
          version: BLENDER_PAYLOAD_VERSION,
          subject: expected,
          target,
        });
      }
      break;
    }
    case "modify": {
      checkSubject(record, "project", capability, rejections);
      const target = checkTarget(record, rejections);
      const edits = checkEdits(record, rejections);
      if (target !== undefined && edits !== undefined) {
        payload = Object.freeze({
          kind: "blender-command-payload",
          version: BLENDER_PAYLOAD_VERSION,
          subject: "project",
          target,
          edits,
        });
      }
      break;
    }
    case "import": {
      checkSubject(record, "asset", capability, rejections);
      const target = checkTarget(record, rejections);
      const format = checkFormat(record, rejections);
      const artifact = checkArtifactRef(record, rejections);
      const into = record["into"];
      let intoTyped: "scene" | "library" | undefined;
      if (typeof into !== "string" || !BLENDER_IMPORT_TARGETS.includes(into)) {
        rejections.push(rejection("blender-payload/into-invalid", `payload.into must be one of ${BLENDER_IMPORT_TARGETS.join(", ")}`, "payload.into"));
      } else {
        intoTyped = into as "scene" | "library";
      }
      if (target !== undefined && format !== undefined && artifact !== undefined && intoTyped !== undefined) {
        payload = Object.freeze({
          kind: "blender-command-payload",
          version: BLENDER_PAYLOAD_VERSION,
          subject: "asset",
          target,
          format,
          artifact,
          into: intoTyped,
        });
      }
      break;
    }
    case "export": {
      checkSubject(record, "asset", capability, rejections);
      const target = checkTarget(record, rejections);
      const format = checkFormat(record, rejections);
      const mode = record["mode"];
      let modeTyped: "whole-scene" | "selection" | "object" | undefined;
      if (typeof mode !== "string" || !BLENDER_EXPORT_MODES.includes(mode)) {
        rejections.push(rejection("blender-payload/export-mode-missing", `payload.mode must be one of ${BLENDER_EXPORT_MODES.join(", ")}`, "payload.mode"));
      } else {
        modeTyped = mode as "whole-scene" | "selection" | "object";
      }
      let objectName: string | undefined;
      const rawObjectName = record["objectName"];
      if (rawObjectName !== undefined) {
        if (typeof rawObjectName !== "string" || !OBJECT_NAME_PATTERN.test(rawObjectName) || rawObjectName.length > OBJECT_NAME_MAX_LENGTH) {
          rejections.push(rejection("blender-payload/object-name-invalid", "payload.objectName must be 1-128 chars of letters/digits/ _. - starting alphanumeric", "payload.objectName"));
        } else {
          objectName = rawObjectName;
        }
      }
      if (target !== undefined && format !== undefined && modeTyped !== undefined) {
        payload = Object.freeze({
          kind: "blender-command-payload",
          version: BLENDER_PAYLOAD_VERSION,
          subject: "asset",
          target,
          format,
          mode: modeTyped,
          ...(objectName === undefined ? {} : { objectName }),
        });
      }
      break;
    }
    case "editor-action": {
      checkSubject(record, "editor", capability, rejections);
      const action = checkAction(record, rejections);
      const target = checkTarget(record, rejections);
      if (action !== undefined && target !== undefined) {
        payload = Object.freeze({
          kind: "blender-command-payload",
          version: BLENDER_PAYLOAD_VERSION,
          subject: "editor",
          action,
          target,
        });
      }
      break;
    }
    case "editor-script": {
      checkSubject(record, "editor", capability, rejections);
      if (record["action"] !== undefined && record["action"] !== "run-script") {
        rejections.push(rejection("blender-payload/action-invalid", 'payload.action must be "run-script" for editor.script', "payload.action"));
      }
      const target = checkTarget(record, rejections);
      const scriptDigest = record["scriptDigest"];
      let digestTyped: string | undefined;
      if (typeof scriptDigest !== "string" || !DIGEST_PATTERN.test(scriptDigest)) {
        rejections.push(rejection("blender-payload/script-invalid", "payload.scriptDigest must be 64 lowercase hex characters (sha256 of the script content)", "payload.scriptDigest"));
      } else {
        digestTyped = scriptDigest;
      }
      if (target !== undefined && digestTyped !== undefined) {
        payload = Object.freeze({
          kind: "blender-command-payload",
          version: BLENDER_PAYLOAD_VERSION,
          subject: "editor",
          action: "run-script",
          target,
          scriptDigest: digestTyped,
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
const TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const PROPERTY_MAX_LENGTH = 64;
const PROPERTY_PATTERN = /^[a-z][a-z0-9-]*$/;
const ACTION_MAX_LENGTH = 128;
const ACTION_PATTERN = /^[a-z][a-z0-9-]*$/;
const MAX_EDITS = 64;

function checkSubject(record: Readonly<Record<string, unknown>>, expected: string, capability: string, rejections: BlenderPayloadRejection[]): void {
  const subject = record["subject"];
  if (subject === undefined) {
    return;
  }
  if (subject !== expected) {
    rejections.push(rejection("blender-payload/subject-mismatch", `payload.subject must be "${expected}" for ${capability}`, "payload.subject"));
  }
}

function checkTarget(record: Readonly<Record<string, unknown>>, rejections: BlenderPayloadRejection[]): string | undefined {
  const raw = record["target"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("blender-payload/target-missing", "payload.target must be a non-empty string (project-relative path or scene/asset id)", "payload.target"));
    return undefined;
  }
  if (raw.length > TARGET_MAX_LENGTH || !TARGET_PATTERN.test(raw)) {
    rejections.push(rejection("blender-payload/target-invalid", `payload.target must be 1-${TARGET_MAX_LENGTH} chars of letters/digits/._-// starting alphanumeric`, "payload.target"));
    return undefined;
  }
  return raw;
}

function checkArtifactRef(record: Readonly<Record<string, unknown>>, rejections: BlenderPayloadRejection[]): { kind: "artifact-ref"; digest: string; bytes: number } | undefined {
  const raw = record["artifact"];
  const artifactRecord = snapshotRecord(raw);
  if (artifactRecord === null) {
    rejections.push(rejection("blender-payload/artifact-ref-invalid", 'payload.artifact must be an artifact reference { kind: "artifact-ref", digest, bytes }', "payload.artifact"));
    return undefined;
  }
  const digest = artifactRecord["digest"];
  const bytes = artifactRecord["bytes"];
  const kind = artifactRecord["kind"];
  let ok = true;
  if (kind !== "artifact-ref") {
    rejections.push(rejection("blender-payload/artifact-ref-invalid", 'payload.artifact.kind must be the literal "artifact-ref"', "payload.artifact.kind"));
    ok = false;
  }
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
    rejections.push(rejection("blender-payload/artifact-ref-invalid", "payload.artifact.digest must be 64 lowercase hex characters (sha256)", "payload.artifact.digest"));
    ok = false;
  }
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    rejections.push(rejection("blender-payload/artifact-ref-invalid", "payload.artifact.bytes must be a positive integer size", "payload.artifact.bytes"));
    ok = false;
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze({ kind: "artifact-ref", digest: digest as string, bytes: bytes as number });
}

function checkFormat(record: Readonly<Record<string, unknown>>, rejections: BlenderPayloadRejection[]): string | undefined {
  const raw = record["format"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("blender-payload/format-missing", "payload.format must be a non-empty asset format", "payload.format"));
    return undefined;
  }
  if (!BLENDER_ASSET_FORMATS.includes(raw)) {
    rejections.push(rejection("blender-payload/format-invalid", `payload.format must be one of ${BLENDER_ASSET_FORMATS.join(", ")}`, "payload.format"));
    return undefined;
  }
  return raw;
}

function checkAction(record: Readonly<Record<string, unknown>>, rejections: BlenderPayloadRejection[]): string | undefined {
  const raw = record["action"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("blender-payload/action-missing", "payload.action must be a non-empty kebab-case action id", "payload.action"));
    return undefined;
  }
  if (raw.length > ACTION_MAX_LENGTH || !ACTION_PATTERN.test(raw)) {
    rejections.push(rejection("blender-payload/action-invalid", `payload.action must be 1-${ACTION_MAX_LENGTH} chars kebab-case (lowercase letters/digits/hyphens)`, "payload.action"));
    return undefined;
  }
  return raw;
}

function checkEdits(record: Readonly<Record<string, unknown>>, rejections: BlenderPayloadRejection[]): readonly { objectName: string; property: string; value: unknown }[] | undefined {
  const raw = record["edits"];
  if (!Array.isArray(raw) || raw.length === 0) {
    rejections.push(rejection("blender-payload/edits-missing", "payload.edits must be a non-empty array of object edits", "payload.edits"));
    return undefined;
  }
  if (raw.length > MAX_EDITS) {
    rejections.push(rejection("blender-payload/edits-entry-invalid", `payload.edits must have at most ${MAX_EDITS} entries`, "payload.edits"));
    return undefined;
  }
  const edits: { objectName: string; property: string; value: unknown }[] = [];
  let ok = true;
  for (let index = 0; index < raw.length; index += 1) {
    const entry = snapshotRecord(raw[index]);
    if (entry === null) {
      ok = false;
      rejections.push(rejection("blender-payload/edits-entry-invalid", `payload.edits[${index}] must be a non-array object`, `payload.edits[${index}]`));
      continue;
    }
    const objectName = entry["objectName"];
    if (typeof objectName !== "string" || !OBJECT_NAME_PATTERN.test(objectName) || objectName.length > OBJECT_NAME_MAX_LENGTH) {
      ok = false;
      rejections.push(rejection("blender-payload/object-name-invalid", `payload.edits[${index}].objectName must be 1-${OBJECT_NAME_MAX_LENGTH} chars of letters/digits/ _. - starting alphanumeric`, `payload.edits[${index}].objectName`));
      continue;
    }
    const property = entry["property"];
    if (typeof property !== "string" || !PROPERTY_PATTERN.test(property) || property.length > PROPERTY_MAX_LENGTH) {
      ok = false;
      rejections.push(rejection("blender-payload/edits-entry-invalid", `payload.edits[${index}].property must be 1-${PROPERTY_MAX_LENGTH} chars kebab-case`, `payload.edits[${index}].property`));
      continue;
    }
    if (!("value" in entry)) {
      ok = false;
      rejections.push(rejection("blender-payload/edits-entry-invalid", `payload.edits[${index}].value is required`, `payload.edits[${index}].value`));
      continue;
    }
    edits.push(Object.freeze({ objectName, property, value: entry["value"] }));
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze(edits);
}
