/**
 * Module role: the total payload validator — the discriminated-union
 * dispatch over the typed payload model in payload-model.ts. Total;
 * never throws; accumulates every problem in one pass; normalizes to a
 * frozen typed payload with unknown keys dropped. The subject field is
 * optional in the wire shape (the capability fixes it) but must not
 * contradict the capability's family. Addressing is Godot-honest: res://
 * paths for project content, NodePath for nodes inside a scene, project
 * names where the engine itself names the project (never host paths).
 * The per-field grammars live in field-checks.ts (same package, pure —
 * split from the sibling single-file shape only to respect the raw
 * line budget; the Godot surface carries more distinct address
 * grammars than the siblings).
 *
 * Implements: PL-024 untrusted-payload total validation (E8).
 */

import { snapshotRecord } from "./inspect.ts";
import {
  GODOT_BUILD_CONFIGURATIONS,
  GODOT_BUILD_TARGET_PLATFORMS,
  GODOT_EXPORT_FORMATS,
  GODOT_EXPORT_MODES,
  GODOT_IMPORT_FORMATS,
  GODOT_PAYLOAD_VERSION,
  payloadFamilyFor,
  type GodotCommandPayload,
  type GodotPayloadRejection,
  type GodotPayloadValidation,
} from "./payload-model.ts";
import {
  checkAction,
  checkArtifactRef,
  checkDigestField,
  checkEdits,
  checkEnum,
  checkFixedAction,
  checkFormat,
  checkHeadless,
  checkNodePath,
  checkPreset,
  checkProjectName,
  checkResPath,
  checkSubject,
  checkVersion,
  rejection,
} from "./field-checks.ts";

/**
 * Validates an untrusted command payload for a given capability id (the
 * capability must be one of the adapter's declared capabilities; anything
 * else is rejected here as unreachable-through-the-adapter input).
 */
export function validateGodotCommandPayload(capability: string, input: unknown): GodotPayloadValidation {
  const family = payloadFamilyFor(capability);
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("godot-payload/not-an-object", "command payload must be a non-array object", "payload")],
    };
  }
  if (family === null) {
    return {
      outcome: "rejected",
      rejections: [rejection("godot-payload/not-an-object", `capability ${capability} is not a Godot adapter capability`, "capability")],
    };
  }

  const rejections: GodotPayloadRejection[] = [];
  checkVersion(record, rejections);
  let payload: GodotCommandPayload | undefined;

  switch (family) {
    case "inspect-project": {
      checkSubject(record, "project", capability, rejections);
      const target = checkProjectName(record, rejections);
      if (target !== undefined) {
        payload = Object.freeze({
          kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION, subject: "project", target,
        });
      }
      break;
    }
    case "inspect-scene":
    case "inspect-asset":
    case "inspect-resource": {
      const expected = inspectSubjectOf(family);
      checkSubject(record, expected, capability, rejections);
      const target = checkResPath(record, rejections);
      if (target !== undefined) {
        payload = Object.freeze({
          kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION, subject: expected, target,
        });
      }
      break;
    }
    case "inspect-node":
    case "modify-node": {
      checkSubject(record, "node", capability, rejections);
      const target = checkResPath(record, rejections);
      const nodePath = checkNodePath(record, rejections);
      if (family === "inspect-node") {
        if (target !== undefined && nodePath !== undefined) {
          payload = Object.freeze({
            kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION, subject: "node", target, nodePath,
          });
        }
      } else {
        const edits = checkEdits(record, rejections);
        if (target !== undefined && nodePath !== undefined && edits !== undefined) {
          payload = Object.freeze({
            kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION, subject: "node", target, nodePath, edits,
          });
        }
      }
      break;
    }
    case "import": {
      checkSubject(record, "asset", capability, rejections);
      const target = checkResPath(record, rejections);
      const format = checkFormat(record, "format", GODOT_IMPORT_FORMATS, rejections);
      const artifact = checkArtifactRef(record, rejections);
      if (target !== undefined && format !== undefined && artifact !== undefined) {
        payload = Object.freeze({
          kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION, subject: "asset",
          target, format, artifact,
        });
      }
      break;
    }
    case "export": {
      checkSubject(record, "asset", capability, rejections);
      const target = checkResPath(record, rejections);
      const format = checkFormat(record, "format", GODOT_EXPORT_FORMATS, rejections);
      const mode = checkEnum(record, "mode", GODOT_EXPORT_MODES, "godot-payload/export-mode-missing", "payload.mode", rejections);
      if (target !== undefined && format !== undefined && mode !== undefined) {
        payload = Object.freeze({
          kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION, subject: "asset",
          target, format, mode: mode as "scene" | "resource",
        });
      }
      break;
    }
    case "editor-action": {
      checkSubject(record, "editor", capability, rejections);
      const action = checkAction(record, rejections);
      if (action !== undefined) {
        payload = Object.freeze({
          kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION, subject: "editor", action,
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
          kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION,
          subject: "editor", action: "run-script", scriptDigest,
        });
      }
      break;
    }
    case "scene-run": {
      checkSubject(record, "scene", capability, rejections);
      checkFixedAction(record, "run", "scene.run", rejections);
      const target = checkResPath(record, rejections);
      const headless = checkHeadless(record, rejections);
      if (target !== undefined) {
        payload = Object.freeze({
          kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION, subject: "scene", action: "run", target,
          ...(headless === undefined ? {} : { headless }),
        });
      }
      break;
    }
    case "build-export": {
      checkSubject(record, "build", capability, rejections);
      checkFixedAction(record, "export", "build.export", rejections);
      const target = checkProjectName(record, rejections);
      const preset = checkPreset(record, rejections);
      const targetPlatform = checkEnum(record, "targetPlatform", GODOT_BUILD_TARGET_PLATFORMS, "godot-payload/target-platform-missing", "payload.targetPlatform", rejections);
      const configuration = checkEnum(record, "configuration", GODOT_BUILD_CONFIGURATIONS, "godot-payload/configuration-missing", "payload.configuration", rejections);
      if (target !== undefined && preset !== undefined && targetPlatform !== undefined && configuration !== undefined) {
        payload = Object.freeze({
          kind: "godot-command-payload", version: GODOT_PAYLOAD_VERSION, subject: "build",
          action: "export", target, preset,
          targetPlatform: targetPlatform as "web" | "windows" | "macos" | "linux",
          configuration: configuration as "debug" | "release",
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

function inspectSubjectOf(family: "inspect-scene" | "inspect-asset" | "inspect-resource"): "scene" | "asset" | "resource" {
  return family === "inspect-scene" ? "scene" : family === "inspect-asset" ? "asset" : "resource";
}
