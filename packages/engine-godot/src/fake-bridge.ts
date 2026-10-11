/**
 * Module role: the in-memory FAKE bridge — the TEST HOST for the
 * GodotBridgePort seam. Deterministic (E9): outcomes derive from a
 * seeded LCG and the invocation content, never from Math.random or the
 * wall clock; identical inputs produce identical outcomes. This is a test
 * double; it is NOT a real engine integration and must never be presented
 * as one (E11: the repository forbids mocks presented as production).
 * The REAL bridge (Godot editor remote-control / `godot --headless
 * --script` / export-template pipeline invocation) is a host concern,
 * deliberately deferred — recorded in the work order report.
 *
 * Seeded failure discipline: the fake can be scripted to fail specific
 * subjects (a missing project/scene/node/asset/resource, a mismatched
 * script digest, a missing export preset, an unsupported export platform
 * or configuration) so the E8 negative battery can exercise every bridge
 * error code deterministically. Node identity is the compound key
 * "<scene>|<nodePath>" because Godot addressing is compound (scene file
 * + NodePath inside it) — that is the honest shape.
 *
 * Implements: PL-024 fake bridge (deterministic in-memory test host).
 */

import type {
  GodotBridgeInvocation,
  GodotBridgeOutcome,
  GodotBridgePort,
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
  /** Scene res:// paths reported as missing ("bridge/scene-not-found"). */
  readonly missingScenes?: readonly string[];
  /** Nodes reported as missing, keyed "<scene>|<nodePath>". */
  readonly missingNodes?: readonly string[];
  /** Asset res:// paths reported as missing ("bridge/asset-not-found"). */
  readonly missingAssets?: readonly string[];
  /** Resource res:// paths reported as missing ("bridge/resource-not-found"). */
  readonly missingResources?: readonly string[];
  /** Script digests the fake reports as mismatched. */
  readonly mismatchedScriptDigests?: readonly string[];
  /** Export preset names reported as missing ("bridge/preset-not-found"). */
  readonly missingPresets?: readonly string[];
  /** Export platforms the fake refuses ("bridge/target-platform-unsupported"). */
  readonly unsupportedPlatforms?: readonly string[];
  /** Export configurations the fake refuses ("bridge/configuration-unsupported"). */
  readonly unsupportedConfigurations?: readonly string[];
}

export type FakeGodotBridgeScript = FakeBridgeScript;

export interface FakeGodotBridge extends GodotBridgePort {
  /** Every invocation received, in order (observation log). */
  readonly invoked: readonly GodotBridgeInvocation[];
  /** Deterministic byte sizes minted for export artifacts, by command key. */
  readonly exportedBytes: Readonly<Record<string, number>>;
  /** Export ids minted by build.export invocations, in order. */
  readonly exportedBuilds: readonly string[];
}

/** Deterministic artifact digest derived from the invocation content. */
function fakeArtifactDigest(invocation: GodotBridgeInvocation): string {
  return contentDigestOf({ fake: "bridge-artifact", key: invocation.commandKey });
}

/** Deterministic numeric reading derived from the seeded LCG. */
function seededReading(random: () => number): number {
  return Math.floor(random() * 1000);
}

/** Reads a field off the typed payload through a single structural cast. */
function fieldOf(invocation: GodotBridgeInvocation, key: string): unknown {
  return (invocation.payload as unknown as Record<string, unknown>)[key];
}

/**
 * Creates the deterministic in-memory fake bridge. `seed` drives every
 * derived numeric reading; identical seeds + identical invocations give
 * identical outcomes (E9 reproducibility).
 */
export function createFakeGodotBridge(options: { readonly seed: number; readonly script?: FakeBridgeScript }): FakeGodotBridge {
  const random = createSeededRandom(options.seed);
  const script = options.script ?? {};
  const missingProjects = new Set<string>(script.missingProjects ?? []);
  const missingScenes = new Set<string>(script.missingScenes ?? []);
  const missingNodes = new Set<string>(script.missingNodes ?? []);
  const missingAssets = new Set<string>(script.missingAssets ?? []);
  const missingResources = new Set<string>(script.missingResources ?? []);
  const mismatched = new Set<string>(script.mismatchedScriptDigests ?? []);
  const missingPresets = new Set<string>(script.missingPresets ?? []);
  const unsupportedPlatforms = new Set<string>(script.unsupportedPlatforms ?? []);
  const unsupportedConfigurations = new Set<string>(script.unsupportedConfigurations ?? []);
  const invoked: GodotBridgeInvocation[] = [];
  const exportedBytes: Record<string, number> = {};
  const exportedBuilds: string[] = [];

  async function invoke(invocation: GodotBridgeInvocation): Promise<GodotBridgeOutcome> {
    invoked.push(invocation);
    const target = String(fieldOf(invocation, "target") ?? "");
    const nodePath = String(fieldOf(invocation, "nodePath") ?? "");

    if (missingProjects.has(target)) {
      return fail("bridge/project-not-found", `project not found: ${target}`);
    }
    if (missingScenes.has(target)) {
      return fail("bridge/scene-not-found", `scene not found: ${target}`);
    }
    if (missingAssets.has(target)) {
      return fail("bridge/asset-not-found", `asset not found: ${target}`);
    }
    if (missingResources.has(target)) {
      return fail("bridge/resource-not-found", `resource not found: ${target}`);
    }
    if (nodePath !== "" && missingNodes.has(`${target}|${nodePath}`)) {
      return fail("bridge/node-not-found", `node not found: ${nodePath} in scene ${target}`);
    }

    switch (invocation.capability) {
      case "project.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          settings: Math.floor(random() * 512) + 1,
          autodetectedFeatures: Math.floor(random() * 16) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "scene.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          rootType: "Node2D",
          nodes: Math.floor(random() * 256) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "node.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          nodePath,
          nodeType: "Sprite2D",
          children: Math.floor(random() * 32) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "asset.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          importClass: "CompressedTexture2D",
          sizeBytes: Math.floor(random() * 4_000_000) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "resource.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          resourceType: "Resource",
          sizeBytes: Math.floor(random() * 512_000) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "node.modify": {
        const edits = fieldOf(invocation, "edits") as readonly unknown[];
        return ok({
          capability: invocation.capability,
          target,
          nodePath,
          appliedEdits: edits.length,
          revision: seededReading(random),
        });
      }
      case "asset.import": {
        const artifact = fieldOf(invocation, "artifact") as { digest: string; bytes: number };
        return ok({
          capability: invocation.capability,
          target,
          importedDigest: artifact.digest,
          importedBytes: artifact.bytes,
        });
      }
      case "asset.export": {
        const bytes = Math.floor(random() * 2_000_000) + 1;
        exportedBytes[invocation.commandKey] = bytes;
        return ok({
          capability: invocation.capability,
          target,
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
      case "scene.run": {
        const headless = (fieldOf(invocation, "headless") as boolean | undefined) ?? false;
        return ok({
          capability: invocation.capability,
          target,
          headless,
          runId: `run-${fakeArtifactDigest(invocation).slice(0, 12)}`,
          startedAt: seededReading(random),
        });
      }
      case "build.export": {
        const preset = fieldOf(invocation, "preset") as string;
        const targetPlatform = fieldOf(invocation, "targetPlatform") as string;
        const configuration = fieldOf(invocation, "configuration") as string;
        const platformCheck = checkExportInput(preset, targetPlatform, configuration);
        if (platformCheck !== null) {
          return platformCheck;
        }
        const exportId = `export-${fakeArtifactDigest(invocation).slice(0, 12)}`;
        exportedBuilds.push(exportId);
        return ok({
          capability: invocation.capability,
          target,
          preset,
          targetPlatform,
          configuration,
          exportId,
          artifact: {
            kind: "artifact-ref",
            digest: fakeArtifactDigest(invocation),
            bytes: Math.floor(random() * 400_000_000) + 1,
          },
          exportedAt: seededReading(random),
        });
      }
      default:
        return fail("bridge/unsupported-capability", `the fake bridge does not serve ${invocation.capability}`);
    }
  }

  function checkExportInput(preset: string, targetPlatform: string, configuration: string): GodotBridgeOutcome | null {
    if (missingPresets.has(preset)) {
      return fail("bridge/preset-not-found", `export preset not found: ${preset}`);
    }
    if (unsupportedPlatforms.has(targetPlatform)) {
      return fail("bridge/target-platform-unsupported", `the fake bridge cannot export for platform ${targetPlatform}`);
    }
    if (unsupportedConfigurations.has(configuration)) {
      return fail("bridge/configuration-unsupported", `the fake bridge cannot export configuration ${configuration}`);
    }
    return null;
  }

  function ok(value: unknown): GodotBridgeOutcome {
    return Object.freeze({ outcome: "ok", value, durationMs: 1 });
  }

  function fail(code: string, message: string): GodotBridgeOutcome {
    return Object.freeze({ outcome: "failed", error: Object.freeze({ code, message }), durationMs: 1 });
  }

  return Object.freeze({
    invoke,
    get invoked(): readonly GodotBridgeInvocation[] {
      return Object.freeze([...invoked]);
    },
    get exportedBytes(): Readonly<Record<string, number>> {
      return Object.freeze({ ...exportedBytes });
    },
    get exportedBuilds(): readonly string[] {
      return Object.freeze([...exportedBuilds]);
    },
  });
}

/**
 * Deterministic fixed clock fake (E9): a caller-programmed cursor; the
 * adapter under test cannot observe real time even by accident. Mirrors
 * the tool-fabric-runtime in-memory-clock convention — the object IS a
 * callable (the GodotClockPort `() => number` shape) with cursor
 * helpers attached.
 */
export interface FakeGodotClock {
  (options?: unknown): number;
  now(): number;
  advanceBy(ms: number): number;
  setTo(epochMs: number): number;
}

export function createFakeGodotClock(startEpochMs = 0): FakeGodotClock {
  let cursor = startEpochMs;
  const clock = ((): number => cursor) as FakeGodotClock;
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
