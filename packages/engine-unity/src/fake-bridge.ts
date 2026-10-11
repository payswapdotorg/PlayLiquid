/**
 * Module role: the in-memory FAKE bridge — the TEST HOST for the
 * UnityBridgePort seam. Deterministic (E9): outcomes derive from a
 * seeded LCG and the invocation content, never from Math.random or the
 * wall clock; identical inputs produce identical outcomes. This is a test
 * double; it is NOT a real engine integration and must never be presented
 * as one (E11: the repository forbids mocks presented as production).
 * The REAL bridge (Unity editor remote-execution / `Unity -batchmode
 * -executeMethod` / BuildPlayer pipeline invocation) is a host concern,
 * deliberately deferred — recorded in the work order report.
 *
 * Seeded failure discipline: the fake can be scripted to fail specific
 * subjects (a missing project/scene/gameobject/component/prefab/asset, a
 * mismatched script digest, an unsupported build platform or
 * configuration) so the E8 negative battery can exercise every bridge
 * error code deterministically. GameObject and component identities are
 * compound keys ("<scenePath>|<objectPath>" and
 * "<scenePath>|<objectPath>|<componentType>") because Unity addressing is
 * compound and type-based — that is the honest shape.
 *
 * Implements: PL-023 fake bridge (deterministic in-memory test host).
 */

import type {
  UnityBridgeInvocation,
  UnityBridgeOutcome,
  UnityBridgePort,
} from "./bridge-port.ts";
import { contentDigestOf } from "./digest.ts";

/** Deterministic LCG (seeded; no Math.random — E9). */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Scriptable per-subject failure: (capability, subject) → bridge error. */
export interface FakeBridgeScript {
  /** Projects reported as missing ("bridge/project-not-found"). */
  readonly missingProjects?: readonly string[];
  /** Scene paths reported as missing ("bridge/scene-not-found"). */
  readonly missingScenes?: readonly string[];
  /** Gameobjects reported as missing, keyed "<scenePath>|<objectPath>". */
  readonly missingGameObjects?: readonly string[];
  /** Component types reported as missing, keyed "<scenePath>|<objectPath>|<componentType>". */
  readonly missingComponentTypes?: readonly string[];
  /** Prefab GUIDs reported as missing ("bridge/prefab-not-found"). */
  readonly missingPrefabs?: readonly string[];
  /** Asset GUIDs reported as missing ("bridge/asset-not-found"). */
  readonly missingAssets?: readonly string[];
  /** Script digests the fake reports as mismatched. */
  readonly mismatchedScriptDigests?: readonly string[];
  /** Build platforms the fake refuses ("bridge/target-platform-unsupported"). */
  readonly unsupportedPlatforms?: readonly string[];
  /** Build configurations the fake refuses ("bridge/configuration-unsupported"). */
  readonly unsupportedConfigurations?: readonly string[];
}

export type FakeUnityBridgeScript = FakeBridgeScript;

export interface FakeUnityBridge extends UnityBridgePort {
  /** Every invocation received, in order (observation log). */
  readonly invoked: readonly UnityBridgeInvocation[];
  /** Deterministic byte sizes minted for export artifacts, by command key. */
  readonly exportedBytes: Readonly<Record<string, number>>;
  /** Build ids minted by build.player invocations, in build order. */
  readonly builtPlayers: readonly string[];
}

/** Deterministic artifact digest derived from the invocation content. */
function fakeArtifactDigest(invocation: UnityBridgeInvocation): string {
  return contentDigestOf({ fake: "bridge-artifact", key: invocation.commandKey });
}

/** Deterministic numeric reading derived from the seeded LCG. */
function seededReading(random: () => number): number {
  return Math.floor(random() * 1000);
}

/** Reads a field off the typed payload through a single structural cast. */
function fieldOf(invocation: UnityBridgeInvocation, key: string): unknown {
  return (invocation.payload as unknown as Record<string, unknown>)[key];
}

/**
 * Creates the deterministic in-memory fake bridge. `seed` drives every
 * derived numeric reading; identical seeds + identical invocations give
 * identical outcomes (E9 reproducibility).
 */
export function createFakeUnityBridge(options: { readonly seed: number; readonly script?: FakeBridgeScript }): FakeUnityBridge {
  const random = createSeededRandom(options.seed);
  const script = options.script ?? {};
  const missingProjects = new Set<string>(script.missingProjects ?? []);
  const missingScenes = new Set<string>(script.missingScenes ?? []);
  const missingGameObjects = new Set<string>(script.missingGameObjects ?? []);
  const missingComponentTypes = new Set<string>(script.missingComponentTypes ?? []);
  const missingPrefabs = new Set<string>(script.missingPrefabs ?? []);
  const missingAssets = new Set<string>(script.missingAssets ?? []);
  const mismatched = new Set<string>(script.mismatchedScriptDigests ?? []);
  const unsupportedPlatforms = new Set<string>(script.unsupportedPlatforms ?? []);
  const unsupportedConfigurations = new Set<string>(script.unsupportedConfigurations ?? []);
  const invoked: UnityBridgeInvocation[] = [];
  const exportedBytes: Record<string, number> = {};
  const builtPlayers: string[] = [];

  async function invoke(invocation: UnityBridgeInvocation): Promise<UnityBridgeOutcome> {
    invoked.push(invocation);
    const projectName = String(fieldOf(invocation, "projectName") ?? "");
    const scenePath = String(fieldOf(invocation, "scenePath") ?? "");
    const objectPath = String(fieldOf(invocation, "objectPath") ?? "");
    const componentType = String(fieldOf(invocation, "componentType") ?? "");
    const assetGuid = String(fieldOf(invocation, "assetGuid") ?? "");

    if (projectName !== "" && missingProjects.has(projectName)) {
      return fail("bridge/project-not-found", `project not found: ${projectName}`);
    }
    if (scenePath !== "" && missingScenes.has(scenePath)) {
      return fail("bridge/scene-not-found", `scene not found: ${scenePath}`);
    }
    if (assetGuid !== "") {
      if (invocation.capability === "prefab.inspect" && missingPrefabs.has(assetGuid)) {
        return fail("bridge/prefab-not-found", `prefab not found: ${assetGuid}`);
      }
      if (invocation.capability !== "prefab.inspect" && missingAssets.has(assetGuid)) {
        return fail("bridge/asset-not-found", `asset not found: ${assetGuid}`);
      }
    }
    if (objectPath !== "" && missingGameObjects.has(`${scenePath}|${objectPath}`)) {
      return fail("bridge/gameobject-not-found", `gameobject not found: ${objectPath} in scene ${scenePath}`);
    }
    if (componentType !== "" && missingComponentTypes.has(`${scenePath}|${objectPath}|${componentType}`)) {
      return fail("bridge/component-not-found", `component not found: ${componentType} on gameobject ${objectPath}`);
    }

    switch (invocation.capability) {
      case "project.inspect": {
        return ok({
          capability: invocation.capability,
          projectName,
          scenes: Math.floor(random() * 128) + 1,
          packages: Math.floor(random() * 64) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "scene.inspect": {
        return ok({
          capability: invocation.capability,
          scenePath,
          gameObjects: Math.floor(random() * 256) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "gameobject.inspect": {
        return ok({
          capability: invocation.capability,
          scenePath,
          objectPath,
          components: Math.floor(random() * 16) + 1,
          active: true,
          inspectedAt: seededReading(random),
        });
      }
      case "component.inspect": {
        return ok({
          capability: invocation.capability,
          scenePath,
          objectPath,
          componentType,
          enabled: true,
          inspectedAt: seededReading(random),
        });
      }
      case "prefab.inspect": {
        return ok({
          capability: invocation.capability,
          assetGuid,
          gameObjects: Math.floor(random() * 64) + 1,
          sizeBytes: Math.floor(random() * 1_000_000) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "asset.inspect": {
        return ok({
          capability: invocation.capability,
          assetGuid,
          importerType: "ModelImporter",
          sizeBytes: Math.floor(random() * 1_000_000) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "gameobject.modify": {
        const edits = fieldOf(invocation, "edits") as readonly unknown[];
        return ok({
          capability: invocation.capability,
          scenePath,
          objectPath,
          appliedEdits: edits.length,
          revision: seededReading(random),
        });
      }
      case "asset.import": {
        const artifact = fieldOf(invocation, "artifact") as { digest: string; bytes: number };
        return ok({
          capability: invocation.capability,
          destinationPath: String(fieldOf(invocation, "destinationPath") ?? ""),
          importedDigest: artifact.digest,
          importedBytes: artifact.bytes,
        });
      }
      case "asset.export": {
        const bytes = Math.floor(random() * 4_000_000) + 1;
        exportedBytes[invocation.commandKey] = bytes;
        return ok({
          capability: invocation.capability,
          assetGuid,
          artifact: {
            kind: "artifact-ref",
            digest: fakeArtifactDigest(invocation),
            bytes,
          },
          mode: fieldOf(invocation, "mode") as string,
        });
      }
      case "editor.action": {
        return ok({
          capability: invocation.capability,
          action: fieldOf(invocation, "action") as string,
          effect: seededReading(random),
        });
      }
      case "editor.script": {
        const scriptDigest = fieldOf(invocation, "scriptDigest") as string;
        if (mismatched.has(scriptDigest)) {
          return fail("bridge/script-digest-mismatch", `script content digest does not match ${scriptDigest}`);
        }
        return ok({
          capability: invocation.capability,
          scriptDigest,
          stdout: `script-${scriptDigest.slice(0, 8)}-ok`,
          exitCode: 0,
        });
      }
      case "scene.play": {
        return ok({
          capability: invocation.capability,
          scenePath,
          playSessionId: `play-${fakeArtifactDigest(invocation).slice(0, 12)}`,
          enteredAt: seededReading(random),
        });
      }
      case "build.player": {
        const targetPlatform = fieldOf(invocation, "targetPlatform") as string;
        const configuration = fieldOf(invocation, "configuration") as string;
        const inputCheck = checkBuildInput(targetPlatform, configuration);
        if (inputCheck !== null) {
          return inputCheck;
        }
        const buildId = `build-${fakeArtifactDigest(invocation).slice(0, 12)}`;
        builtPlayers.push(buildId);
        return ok({
          capability: invocation.capability,
          scenePaths: fieldOf(invocation, "scenePaths") as readonly string[],
          targetPlatform,
          configuration,
          buildId,
          artifact: {
            kind: "artifact-ref",
            digest: fakeArtifactDigest(invocation),
            bytes: Math.floor(random() * 1_000_000_000) + 1,
          },
          builtAt: seededReading(random),
        });
      }
      default:
        return fail("bridge/unsupported-capability", `the fake bridge does not serve ${invocation.capability}`);
    }
  }

  function checkBuildInput(targetPlatform: string, configuration: string): UnityBridgeOutcome | null {
    if (unsupportedPlatforms.has(targetPlatform)) {
      return fail("bridge/target-platform-unsupported", `the fake bridge cannot build the player for platform ${targetPlatform}`);
    }
    if (unsupportedConfigurations.has(configuration)) {
      return fail("bridge/configuration-unsupported", `the fake bridge cannot build configuration ${configuration}`);
    }
    return null;
  }

  function ok(value: unknown): UnityBridgeOutcome {
    return Object.freeze({ outcome: "ok", value, durationMs: 1 });
  }

  function fail(code: string, message: string): UnityBridgeOutcome {
    return Object.freeze({ outcome: "failed", error: Object.freeze({ code, message }), durationMs: 1 });
  }

  return Object.freeze({
    invoke,
    get invoked(): readonly UnityBridgeInvocation[] {
      return Object.freeze([...invoked]);
    },
    get exportedBytes(): Readonly<Record<string, number>> {
      return Object.freeze({ ...exportedBytes });
    },
    get builtPlayers(): readonly string[] {
      return Object.freeze([...builtPlayers]);
    },
  });
}

/**
 * Deterministic fixed clock fake (E9): a caller-programmed cursor; the
 * adapter under test cannot observe real time even by accident. Mirrors
 * the tool-fabric-runtime in-memory-clock convention — the object IS a
 * callable (the UnityClockPort `() => number` shape) with cursor
 * helpers attached.
 */
export interface FakeUnityClock {
  (options?: unknown): number;
  now(): number;
  advanceBy(ms: number): number;
  setTo(epochMs: number): number;
}

export function createFakeUnityClock(startEpochMs = 0): FakeUnityClock {
  let cursor = startEpochMs;
  const clock = ((): number => cursor) as FakeUnityClock;
  clock.now = (): number => cursor;
  clock.advanceBy = (ms: number): number => {
    cursor += ms;
    return cursor;
  };
  clock.setTo = (epochMs: number): number => {
    cursor = epochMs;
    return cursor;
  };
  return Object.freeze(clock);
}
