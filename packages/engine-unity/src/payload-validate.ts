/**
 * Module role: the total payload validator — the discriminated-union
 * dispatch over the typed payload model in payload-model.ts, composing
 * the shared field checks from payload-fields.ts. Total; never throws;
 * accumulates every problem in one pass; normalizes to a frozen typed
 * payload with unknown keys dropped. The subject field is optional in the
 * wire shape (the capability fixes it) but must not contradict the
 * capability's family.
 *
 * Implements: PL-023 untrusted-payload total validation (E8).
 */

import { snapshotRecord } from "./inspect.ts";
import {
  UNITY_BUILD_CONFIGURATIONS,
  UNITY_BUILD_TARGET_PLATFORMS,
  UNITY_EXPORT_FORMATS,
  UNITY_EXPORT_MODES,
  UNITY_IMPORT_FORMATS,
  UNITY_PAYLOAD_VERSION,
  payloadFamilyFor,
  type UnityCommandPayload,
  type UnityPayloadRejection,
  type UnityPayloadValidation,
} from "./payload-model.ts";
import {
  checkAction,
  checkAssetGuid,
  checkArtifactRef,
  checkComponentType,
  checkDestinationPath,
  checkDigestField,
  checkEdits,
  checkEnum,
  checkFixedAction,
  checkFormat,
  checkObjectPath,
  checkProjectName,
  checkSceneList,
  checkScenePath,
  checkSubject,
  checkVersion,
} from "./payload-fields.ts";

/**
 * Validates an untrusted command payload for a given capability id (the
 * capability must be one of the adapter's declared capabilities; anything
 * else is rejected here as unreachable-through-the-adapter input).
 */
export function validateUnityCommandPayload(capability: string, input: unknown): UnityPayloadValidation {
  const family = payloadFamilyFor(capability);
  const record = snapshotRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [{ code: "unity-payload/not-an-object", message: "command payload must be a non-array object", path: "payload" }],
    };
  }
  if (family === null) {
    return {
      outcome: "rejected",
      rejections: [{ code: "unity-payload/not-an-object", message: `capability ${capability} is not a Unity adapter capability`, path: "capability" }],
    };
  }

  const rejections: UnityPayloadRejection[] = [];
  checkVersion(record, UNITY_PAYLOAD_VERSION, rejections);
  let payload: UnityCommandPayload | undefined;

  switch (family) {
    case "inspect-project": {
      checkSubject(record, "project", capability, rejections);
      const projectName = checkProjectName(record, rejections);
      if (projectName !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "project", projectName,
        });
      }
      break;
    }
    case "inspect-scene": {
      checkSubject(record, "scene", capability, rejections);
      const scenePath = checkScenePath(record, rejections);
      if (scenePath !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "scene", scenePath,
        });
      }
      break;
    }
    case "inspect-gameobject":
    case "modify-gameobject": {
      checkSubject(record, "gameobject", capability, rejections);
      const scenePath = checkScenePath(record, rejections);
      const objectPath = checkObjectPath(record, rejections);
      if (family === "inspect-gameobject") {
        if (scenePath !== undefined && objectPath !== undefined) {
          payload = Object.freeze({
            kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "gameobject", scenePath, objectPath,
          });
        }
      } else {
        const edits = checkEdits(record, rejections);
        if (scenePath !== undefined && objectPath !== undefined && edits !== undefined) {
          payload = Object.freeze({
            kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "gameobject", scenePath, objectPath, edits,
          });
        }
      }
      break;
    }
    case "inspect-component": {
      checkSubject(record, "component", capability, rejections);
      const scenePath = checkScenePath(record, rejections);
      const objectPath = checkObjectPath(record, rejections);
      const componentType = checkComponentType(record, rejections);
      if (scenePath !== undefined && objectPath !== undefined && componentType !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "component",
          scenePath, objectPath, componentType,
        });
      }
      break;
    }
    case "inspect-prefab": {
      checkSubject(record, "prefab", capability, rejections);
      const assetGuid = checkAssetGuid(record, rejections);
      if (assetGuid !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "prefab", assetGuid,
        });
      }
      break;
    }
    case "inspect-asset": {
      checkSubject(record, "asset", capability, rejections);
      const assetGuid = checkAssetGuid(record, rejections);
      if (assetGuid !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "asset", assetGuid,
        });
      }
      break;
    }
    case "import": {
      checkSubject(record, "asset", capability, rejections);
      const destinationPath = checkDestinationPath(record, rejections);
      const format = checkFormat(record, "format", UNITY_IMPORT_FORMATS, rejections);
      const artifact = checkArtifactRef(record, rejections);
      if (destinationPath !== undefined && format !== undefined && artifact !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "asset",
          destinationPath, format, artifact,
        });
      }
      break;
    }
    case "export": {
      checkSubject(record, "asset", capability, rejections);
      const assetGuid = checkAssetGuid(record, rejections);
      const format = checkFormat(record, "format", UNITY_EXPORT_FORMATS, rejections);
      const mode = checkEnum(record, "mode", UNITY_EXPORT_MODES, "unity-payload/export-mode-missing", "payload.mode", rejections);
      if (assetGuid !== undefined && format !== undefined && mode !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "asset",
          assetGuid, format, mode: mode as "asset" | "scene" | "prefab",
        });
      }
      break;
    }
    case "editor-action": {
      checkSubject(record, "editor", capability, rejections);
      const action = checkAction(record, rejections);
      if (action !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "editor", action,
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
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION,
          subject: "editor", action: "run-script", scriptDigest,
        });
      }
      break;
    }
    case "scene-play": {
      checkSubject(record, "scene", capability, rejections);
      checkFixedAction(record, "play", "scene.play", rejections);
      const scenePath = checkScenePath(record, rejections);
      if (scenePath !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "scene", action: "play", scenePath,
        });
      }
      break;
    }
    case "build-player": {
      checkSubject(record, "build", capability, rejections);
      checkFixedAction(record, "build-player", "build.player", rejections);
      const scenePaths = checkSceneList(record, rejections);
      const targetPlatform = checkEnum(record, "targetPlatform", UNITY_BUILD_TARGET_PLATFORMS, "unity-payload/target-platform-missing", "payload.targetPlatform", rejections);
      const configuration = checkEnum(record, "configuration", UNITY_BUILD_CONFIGURATIONS, "unity-payload/configuration-missing", "payload.configuration", rejections);
      if (scenePaths !== undefined && targetPlatform !== undefined && configuration !== undefined) {
        payload = Object.freeze({
          kind: "unity-command-payload", version: UNITY_PAYLOAD_VERSION, subject: "build",
          action: "build-player", scenePaths,
          targetPlatform: targetPlatform as "web" | "windows" | "macos" | "linux" | "android" | "ios",
          configuration: configuration as "release" | "development",
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
