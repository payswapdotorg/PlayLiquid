/**
 * Module role: the total payload validator — the discriminated-union
 * dispatch over the typed payload model in payload-model.ts. Total;
 * never throws; accumulates every problem in one pass; normalizes to a
 * frozen typed payload with unknown keys dropped. The subject field is
 * optional in the wire shape (the capability fixes it) but must not
 * contradict the capability's family.
 *
 * Implements: PL-021 untrusted-payload total validation (E8).
 */

import { snapshotRecord } from "./inspect.ts";
import {
  PLAYCANVAS_ASSET_FORMATS,
  PLAYCANVAS_BUILD_CHANNELS,
  PLAYCANVAS_EXPORT_MODES,
  PLAYCANVAS_IMPORT_TARGETS,
  PLAYCANVAS_PAYLOAD_VERSION,
  payloadFamilyFor,
  type PlayCanvasCommandPayload,
  type PlayCanvasPayloadRejection,
  type PlayCanvasPayloadValidation,
} from "./payload-model.ts";

function rejection(code: PlayCanvasPayloadRejection["code"], message: string, path: string): PlayCanvasPayloadRejection {
  return Object.freeze({ code, message, path });
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const ENTITY_NAME_MAX_LENGTH = 128;
const ENTITY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
const BUILD_ID_MAX_LENGTH = 128;
const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Validates an untrusted command payload for a given capability id (the
 * capability must be one of the adapter's declared capabilities; anything
 * else is rejected here as unreachable-through-the-adapter input).
 */
export function validatePlayCanvasCommandPayload(capability: string, input: unknown): PlayCanvasPayloadValidation {
  const family = payloadFamilyFor(capability);
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("playcanvas-payload/not-an-object", "command payload must be a non-array object", "payload")],
    };
  }
  if (family === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("playcanvas-payload/not-an-object", `capability ${capability} is not a PlayCanvas adapter capability`, "capability")],
    };
  }

  const rejections: PlayCanvasPayloadRejection[] = [];
  checkVersion(record, rejections);
  let payload: PlayCanvasCommandPayload | undefined;

  switch (family) {
    case "inspect-project":
    case "inspect-scene":
    case "inspect-entity":
    case "inspect-component":
    case "inspect-asset": {
      const expected = inspectSubjectOf(family);
      checkSubject(record, expected, capability, rejections);
      const target = checkTarget(record, rejections);
      if (target !== undefined) {
        payload = Object.freeze({
          kind: "playcanvas-command-payload", version: PLAYCANVAS_PAYLOAD_VERSION, subject: expected, target,
        });
      }
      break;
    }
    case "modify-project":
    case "modify-entity": {
      const expected = family === "modify-project" ? "project" : "entity";
      checkSubject(record, expected, capability, rejections);
      const target = checkTarget(record, rejections);
      const edits = checkEdits(record, rejections);
      if (target !== undefined && edits !== undefined) {
        payload = Object.freeze({
          kind: "playcanvas-command-payload", version: PLAYCANVAS_PAYLOAD_VERSION, subject: expected, target, edits,
        });
      }
      break;
    }
    case "import": {
      checkSubject(record, "asset", capability, rejections);
      const target = checkTarget(record, rejections);
      const format = checkFormat(record, rejections);
      const artifact = checkArtifactRef(record, rejections);
      const into = checkEnum(record, "into", PLAYCANVAS_IMPORT_TARGETS, "playcanvas-payload/into-invalid", "payload.into", rejections);
      if (target !== undefined && format !== undefined && artifact !== undefined && into !== undefined) {
        payload = Object.freeze({
          kind: "playcanvas-command-payload", version: PLAYCANVAS_PAYLOAD_VERSION, subject: "asset",
          target, format, artifact, into: into as "scene" | "library",
        });
      }
      break;
    }
    case "export": {
      checkSubject(record, "asset", capability, rejections);
      const target = checkTarget(record, rejections);
      const format = checkFormat(record, rejections);
      const mode = checkEnum(record, "mode", PLAYCANVAS_EXPORT_MODES, "playcanvas-payload/export-mode-missing", "payload.mode", rejections);
      const entityName = checkEntityNameField(record, "entityName", "payload.entityName", rejections);
      if (target !== undefined && format !== undefined && mode !== undefined) {
        payload = Object.freeze({
          kind: "playcanvas-command-payload", version: PLAYCANVAS_PAYLOAD_VERSION, subject: "asset",
          target, format, mode: mode as "whole-scene" | "selection" | "entity",
          ...(entityName === undefined ? {} : { entityName }),
        });
      }
      break;
    }
    case "scene-action": {
      checkSubject(record, "scene", capability, rejections);
      const action = checkAction(record, rejections);
      const target = checkTarget(record, rejections);
      if (action !== undefined && target !== undefined) {
        payload = Object.freeze({
          kind: "playcanvas-command-payload", version: PLAYCANVAS_PAYLOAD_VERSION, subject: "scene", action, target,
        });
      }
      break;
    }
    case "scene-script": {
      checkSubject(record, "scene", capability, rejections);
      checkFixedAction(record, "run-script", "scene.script", rejections);
      const target = checkTarget(record, rejections);
      const scriptDigest = checkDigestField(record, "scriptDigest", rejections);
      if (target !== undefined && scriptDigest !== undefined) {
        payload = Object.freeze({
          kind: "playcanvas-command-payload", version: PLAYCANVAS_PAYLOAD_VERSION,
          subject: "scene", action: "run-script", target, scriptDigest,
        });
      }
      break;
    }
    case "build-publish": {
      checkSubject(record, "build", capability, rejections);
      checkFixedAction(record, "publish", "build.publish", rejections);
      const target = checkTarget(record, rejections);
      const channel = checkEnum(record, "channel", PLAYCANVAS_BUILD_CHANNELS, "playcanvas-payload/channel-missing", "payload.channel", rejections);
      if (target !== undefined && channel !== undefined) {
        payload = Object.freeze({
          kind: "playcanvas-command-payload", version: PLAYCANVAS_PAYLOAD_VERSION,
          subject: "build", action: "publish", target, channel: channel as "web" | "spark",
        });
      }
      break;
    }
    case "build-play": {
      checkSubject(record, "build", capability, rejections);
      checkFixedAction(record, "play", "build.play", rejections);
      const target = checkTarget(record, rejections);
      const buildId = checkBuildId(record, rejections);
      if (target !== undefined && buildId !== undefined) {
        payload = Object.freeze({
          kind: "playcanvas-command-payload", version: PLAYCANVAS_PAYLOAD_VERSION,
          subject: "build", action: "play", target, buildId,
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

function inspectSubjectOf(family: "inspect-project" | "inspect-scene" | "inspect-entity" | "inspect-component" | "inspect-asset"): "project" | "scene" | "entity" | "component" | "asset" {
  return family === "inspect-project" ? "project"
    : family === "inspect-scene" ? "scene"
      : family === "inspect-entity" ? "entity"
        : family === "inspect-component" ? "component"
          : "asset";
}

function checkVersion(record: Readonly<Record<string, unknown>>, rejections: PlayCanvasPayloadRejection[]): void {
  const raw = record["version"];
  if (raw === undefined) {
    rejections.push(rejection("playcanvas-payload/version-missing", `payload.version must be the integer ${PLAYCANVAS_PAYLOAD_VERSION}`, "payload.version"));
  } else if (raw !== PLAYCANVAS_PAYLOAD_VERSION) {
    rejections.push(rejection("playcanvas-payload/version-invalid", `payload.version must be the integer ${PLAYCANVAS_PAYLOAD_VERSION}`, "payload.version"));
  }
}

function checkSubject(record: Readonly<Record<string, unknown>>, expected: string, capability: string, rejections: PlayCanvasPayloadRejection[]): void {
  const subject = record["subject"];
  if (subject !== undefined && subject !== expected) {
    rejections.push(rejection("playcanvas-payload/subject-mismatch", `payload.subject must be "${expected}" for ${capability}`, "payload.subject"));
  }
}

function checkFixedAction(record: Readonly<Record<string, unknown>>, expected: string, capability: string, rejections: PlayCanvasPayloadRejection[]): void {
  const raw = record["action"];
  if (raw !== undefined && raw !== expected) {
    rejections.push(rejection("playcanvas-payload/action-invalid", `payload.action must be "${expected}" for ${capability}`, "payload.action"));
  }
}

function checkTarget(record: Readonly<Record<string, unknown>>, rejections: PlayCanvasPayloadRejection[]): string | undefined {
  const raw = record["target"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("playcanvas-payload/target-missing", "payload.target must be a non-empty string (project-relative path or scene/entity/component/asset id)", "payload.target"));
    return undefined;
  }
  if (raw.length > TARGET_MAX_LENGTH || !TARGET_PATTERN.test(raw)) {
    rejections.push(rejection("playcanvas-payload/target-invalid", `payload.target must be 1-${TARGET_MAX_LENGTH} chars of letters/digits/._-// starting alphanumeric`, "payload.target"));
    return undefined;
  }
  return raw;
}

function checkEnum(record: Readonly<Record<string, unknown>>, key: string, allowed: readonly string[], code: PlayCanvasPayloadRejection["code"], path: string, rejections: PlayCanvasPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || !allowed.includes(raw)) {
    rejections.push(rejection(code, `${path} must be one of ${allowed.join(", ")}`, path));
    return undefined;
  }
  return raw;
}

function checkFormat(record: Readonly<Record<string, unknown>>, rejections: PlayCanvasPayloadRejection[]): string | undefined {
  const raw = record["format"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("playcanvas-payload/format-missing", "payload.format must be a non-empty asset format", "payload.format"));
    return undefined;
  }
  if (!PLAYCANVAS_ASSET_FORMATS.includes(raw)) {
    rejections.push(rejection("playcanvas-payload/format-invalid", `payload.format must be one of ${PLAYCANVAS_ASSET_FORMATS.join(", ")}`, "payload.format"));
    return undefined;
  }
  return raw;
}

function checkAction(record: Readonly<Record<string, unknown>>, rejections: PlayCanvasPayloadRejection[]): string | undefined {
  const raw = record["action"];
  if (typeof raw !== "string" || raw.length === 0) {
    rejections.push(rejection("playcanvas-payload/action-missing", "payload.action must be a non-empty kebab-case action id", "payload.action"));
    return undefined;
  }
  if (raw.length > ACTION_MAX_LENGTH || !ACTION_PATTERN.test(raw)) {
    rejections.push(rejection("playcanvas-payload/action-invalid", `payload.action must be 1-${ACTION_MAX_LENGTH} chars kebab-case (lowercase letters/digits/hyphens)`, "payload.action"));
    return undefined;
  }
  return raw;
}

function checkDigestField(record: Readonly<Record<string, unknown>>, key: string, rejections: PlayCanvasPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (typeof raw !== "string" || !DIGEST_PATTERN.test(raw)) {
    rejections.push(rejection("playcanvas-payload/script-invalid", `payload.${key} must be 64 lowercase hex characters (sha256 of the script content)`, `payload.${key}`));
    return undefined;
  }
  return raw;
}

function checkEntityNameField(record: Readonly<Record<string, unknown>>, key: string, path: string, rejections: PlayCanvasPayloadRejection[]): string | undefined {
  const raw = record[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string" || !ENTITY_NAME_PATTERN.test(raw) || raw.length > ENTITY_NAME_MAX_LENGTH) {
    rejections.push(rejection("playcanvas-payload/entity-name-invalid", `${path} must be 1-${ENTITY_NAME_MAX_LENGTH} chars of letters/digits/ _. - starting alphanumeric`, path));
    return undefined;
  }
  return raw;
}

function checkBuildId(record: Readonly<Record<string, unknown>>, rejections: PlayCanvasPayloadRejection[]): string | undefined {
  const raw = record["buildId"];
  if (typeof raw !== "string" || !BUILD_ID_PATTERN.test(raw) || raw.length > BUILD_ID_MAX_LENGTH) {
    rejections.push(rejection("playcanvas-payload/play-build-id-invalid", `payload.buildId must be 1-${BUILD_ID_MAX_LENGTH} chars lowercase kebab id of a previously published build`, "payload.buildId"));
    return undefined;
  }
  return raw;
}

function checkArtifactRef(record: Readonly<Record<string, unknown>>, rejections: PlayCanvasPayloadRejection[]): { kind: "artifact-ref"; digest: string; bytes: number } | undefined {
  const artifactRecord = snapshotRecord(record["artifact"]);
  if (artifactRecord === null) {
    rejections.push(rejection("playcanvas-payload/artifact-ref-invalid", 'payload.artifact must be an artifact reference { kind: "artifact-ref", digest, bytes }', "payload.artifact"));
    return undefined;
  }
  const digest = artifactRecord["digest"];
  const bytes = artifactRecord["bytes"];
  let ok = true;
  if (artifactRecord["kind"] !== "artifact-ref") {
    rejections.push(rejection("playcanvas-payload/artifact-ref-invalid", 'payload.artifact.kind must be the literal "artifact-ref"', "payload.artifact.kind"));
    ok = false;
  }
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
    rejections.push(rejection("playcanvas-payload/artifact-ref-invalid", "payload.artifact.digest must be 64 lowercase hex characters (sha256)", "payload.artifact.digest"));
    ok = false;
  }
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    rejections.push(rejection("playcanvas-payload/artifact-ref-invalid", "payload.artifact.bytes must be a positive integer size", "payload.artifact.bytes"));
    ok = false;
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze({ kind: "artifact-ref", digest: digest as string, bytes: bytes as number });
}

function checkEdits(record: Readonly<Record<string, unknown>>, rejections: PlayCanvasPayloadRejection[]): readonly { entityName: string; property: string; value: unknown }[] | undefined {
  const raw = record["edits"];
  if (!Array.isArray(raw) || raw.length === 0) {
    rejections.push(rejection("playcanvas-payload/edits-missing", "payload.edits must be a non-empty array of entity edits", "payload.edits"));
    return undefined;
  }
  if (raw.length > MAX_EDITS) {
    rejections.push(rejection("playcanvas-payload/edits-entry-invalid", `payload.edits must have at most ${MAX_EDITS} entries`, "payload.edits"));
    return undefined;
  }
  const edits: { entityName: string; property: string; value: unknown }[] = [];
  let ok = true;
  for (let index = 0; index < raw.length; index += 1) {
    const entry = snapshotRecord(raw[index]);
    if (entry === null) {
      ok = false;
      rejections.push(rejection("playcanvas-payload/edits-entry-invalid", `payload.edits[${index}] must be a non-array object`, `payload.edits[${index}]`));
      continue;
    }
    const entityName = entry["entityName"];
    if (typeof entityName !== "string" || !ENTITY_NAME_PATTERN.test(entityName) || entityName.length > ENTITY_NAME_MAX_LENGTH) {
      ok = false;
      rejections.push(rejection("playcanvas-payload/entity-name-invalid", `payload.edits[${index}].entityName must be 1-${ENTITY_NAME_MAX_LENGTH} chars of letters/digits/ _. - starting alphanumeric`, `payload.edits[${index}].entityName`));
      continue;
    }
    const property = entry["property"];
    if (typeof property !== "string" || !PROPERTY_PATTERN.test(property) || property.length > PROPERTY_MAX_LENGTH) {
      ok = false;
      rejections.push(rejection("playcanvas-payload/edits-entry-invalid", `payload.edits[${index}].property must be 1-${PROPERTY_MAX_LENGTH} chars kebab-case`, `payload.edits[${index}].property`));
      continue;
    }
    if (!("value" in entry)) {
      ok = false;
      rejections.push(rejection("playcanvas-payload/edits-entry-invalid", `payload.edits[${index}].value is required`, `payload.edits[${index}].value`));
      continue;
    }
    edits.push(Object.freeze({ entityName, property, value: entry["value"] }));
  }
  if (!ok) {
    return undefined;
  }
  return Object.freeze(edits);
}
