/**
 * Module role: the in-memory FAKE bridge — the TEST HOST for the
 * UnrealBridgePort seam. Deterministic (E9): outcomes derive from a
 * seeded LCG and the invocation content, never from Math.random or the
 * wall clock; identical inputs produce identical outcomes. This is a test
 * double; it is NOT a real engine integration and must never be presented
 * as one (E11: the repository forbids mocks presented as production).
 * The REAL bridge (Unreal editor remote-execution / UnrealBuildTool
 * cook & package pipeline invocation) is a host concern, deliberately
 * deferred — recorded in the work order report.
 *
 * Seeded failure discipline: the fake can be scripted to fail specific
 * subjects (a missing project/level/actor/component/asset, a mismatched
 * script digest, an unsupported build platform or configuration) so the
 * E8 negative battery can exercise every bridge error code
 * deterministically. Actor and component identities are compound keys
 * ("<level>|<actorName>" and "<level>|<actorName>|<componentName>")
 * because Unreal addressing is compound — that is the honest shape.
 *
 * Implements: PL-022 fake bridge (deterministic in-memory test host).
 */

import type {
  UnrealBridgeInvocation,
  UnrealBridgeOutcome,
  UnrealBridgePort,
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
  /** Level content paths reported as missing ("bridge/level-not-found"). */
  readonly missingLevels?: readonly string[];
  /** Actors reported as missing, keyed "<level>|<actorName>". */
  readonly missingActors?: readonly string[];
  /** Components reported as missing, keyed "<level>|<actorName>|<componentName>". */
  readonly missingComponents?: readonly string[];
  /** Asset content paths reported as missing ("bridge/asset-not-found"). */
  readonly missingAssets?: readonly string[];
  /** Script digests the fake reports as mismatched. */
  readonly mismatchedScriptDigests?: readonly string[];
  /** Build platforms the fake refuses ("bridge/target-platform-unsupported"). */
  readonly unsupportedPlatforms?: readonly string[];
  /** Build configurations the fake refuses ("bridge/configuration-unsupported"). */
  readonly unsupportedConfigurations?: readonly string[];
}

export type FakeUnrealBridgeScript = FakeBridgeScript;

export interface FakeUnrealBridge extends UnrealBridgePort {
  /** Every invocation received, in order (observation log). */
  readonly invoked: readonly UnrealBridgeInvocation[];
  /** Deterministic byte sizes minted for export artifacts, by command key. */
  readonly exportedBytes: Readonly<Record<string, number>>;
  /** Build ids minted by package invocations, in package order. */
  readonly packagedBuilds: readonly string[];
}

/** Deterministic artifact digest derived from the invocation content. */
function fakeArtifactDigest(invocation: UnrealBridgeInvocation): string {
  return contentDigestOf({ fake: "bridge-artifact", key: invocation.commandKey });
}

/** Deterministic numeric reading derived from the seeded LCG. */
function seededReading(random: () => number): number {
  return Math.floor(random() * 1000);
}

/** Reads a field off the typed payload through a single structural cast. */
function fieldOf(invocation: UnrealBridgeInvocation, key: string): unknown {
  return (invocation.payload as unknown as Record<string, unknown>)[key];
}

/**
 * Creates the deterministic in-memory fake bridge. `seed` drives every
 * derived numeric reading; identical seeds + identical invocations give
 * identical outcomes (E9 reproducibility).
 */
export function createFakeUnrealBridge(options: { readonly seed: number; readonly script?: FakeBridgeScript }): FakeUnrealBridge {
  const random = createSeededRandom(options.seed);
  const script = options.script ?? {};
  const missingProjects = new Set<string>(script.missingProjects ?? []);
  const missingLevels = new Set<string>(script.missingLevels ?? []);
  const missingActors = new Set<string>(script.missingActors ?? []);
  const missingComponents = new Set<string>(script.missingComponents ?? []);
  const missingAssets = new Set<string>(script.missingAssets ?? []);
  const mismatched = new Set<string>(script.mismatchedScriptDigests ?? []);
  const unsupportedPlatforms = new Set<string>(script.unsupportedPlatforms ?? []);
  const unsupportedConfigurations = new Set<string>(script.unsupportedConfigurations ?? []);
  const invoked: UnrealBridgeInvocation[] = [];
  const exportedBytes: Record<string, number> = {};
  const packagedBuilds: string[] = [];

  async function invoke(invocation: UnrealBridgeInvocation): Promise<UnrealBridgeOutcome> {
    invoked.push(invocation);
    const target = String(fieldOf(invocation, "target") ?? "");
    const actorName = String(fieldOf(invocation, "actorName") ?? "");
    const componentName = String(fieldOf(invocation, "componentName") ?? "");

    if (missingProjects.has(target)) {
      return fail("bridge/project-not-found", `project not found: ${target}`);
    }
    if (missingLevels.has(target)) {
      return fail("bridge/level-not-found", `level not found: ${target}`);
    }
    if (missingAssets.has(target)) {
      return fail("bridge/asset-not-found", `asset not found: ${target}`);
    }
    if (actorName !== "" && missingActors.has(`${target}|${actorName}`)) {
      return fail("bridge/actor-not-found", `actor not found: ${actorName} in level ${target}`);
    }
    if (componentName !== "" && missingComponents.has(`${target}|${actorName}|${componentName}`)) {
      return fail("bridge/component-not-found", `component not found: ${componentName} on actor ${actorName}`);
    }

    switch (invocation.capability) {
      case "project.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          modules: Math.floor(random() * 64) + 1,
          plugins: Math.floor(random() * 32) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "level.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          actors: Math.floor(random() * 128) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "actor.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          actorName,
          components: Math.floor(random() * 16) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "component.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          actorName,
          componentName,
          componentClass: "StaticMeshComponent",
          inspectedAt: seededReading(random),
        });
      }
      case "asset.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          assetClass: "StaticMesh",
          sizeBytes: Math.floor(random() * 1_000_000) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "actor.modify": {
        const edits = fieldOf(invocation, "edits") as readonly unknown[];
        return ok({
          capability: invocation.capability,
          target,
          actorName,
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
        const bytes = Math.floor(random() * 4_000_000) + 1;
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
      case "level.pie": {
        const players = (fieldOf(invocation, "players") as number | undefined) ?? 1;
        return ok({
          capability: invocation.capability,
          target,
          players,
          sessionId: `pie-${fakeArtifactDigest(invocation).slice(0, 12)}`,
          startedAt: seededReading(random),
        });
      }
      case "build.cook": {
        const targetPlatform = fieldOf(invocation, "targetPlatform") as string;
        const configuration = fieldOf(invocation, "configuration") as string;
        const platformCheck = checkBuildInput(targetPlatform, configuration);
        if (platformCheck !== null) {
          return platformCheck;
        }
        return ok({
          capability: invocation.capability,
          target,
          targetPlatform,
          configuration,
          cookedPackages: Math.floor(random() * 4096) + 1,
          cookedAt: seededReading(random),
        });
      }
      case "build.package": {
        const targetPlatform = fieldOf(invocation, "targetPlatform") as string;
        const configuration = fieldOf(invocation, "configuration") as string;
        const platformCheck = checkBuildInput(targetPlatform, configuration);
        if (platformCheck !== null) {
          return platformCheck;
        }
        const buildId = `build-${fakeArtifactDigest(invocation).slice(0, 12)}`;
        packagedBuilds.push(buildId);
        return ok({
          capability: invocation.capability,
          target,
          targetPlatform,
          configuration,
          buildId,
          artifact: {
            kind: "artifact-ref",
            digest: fakeArtifactDigest(invocation),
            bytes: Math.floor(random() * 1_000_000_000) + 1,
          },
          packagedAt: seededReading(random),
        });
      }
      default:
        return fail("bridge/unsupported-capability", `the fake bridge does not serve ${invocation.capability}`);
    }
  }

  function checkBuildInput(targetPlatform: string, configuration: string): UnrealBridgeOutcome | null {
    if (unsupportedPlatforms.has(targetPlatform)) {
      return fail("bridge/target-platform-unsupported", `the fake bridge cannot cook/package for platform ${targetPlatform}`);
    }
    if (unsupportedConfigurations.has(configuration)) {
      return fail("bridge/configuration-unsupported", `the fake bridge cannot build configuration ${configuration}`);
    }
    return null;
  }

  function ok(value: unknown): UnrealBridgeOutcome {
    return Object.freeze({ outcome: "ok", value, durationMs: 1 });
  }

  function fail(code: string, message: string): UnrealBridgeOutcome {
    return Object.freeze({ outcome: "failed", error: Object.freeze({ code, message }), durationMs: 1 });
  }

  return Object.freeze({
    invoke,
    get invoked(): readonly UnrealBridgeInvocation[] {
      return Object.freeze([...invoked]);
    },
    get exportedBytes(): Readonly<Record<string, number>> {
      return Object.freeze({ ...exportedBytes });
    },
    get packagedBuilds(): readonly string[] {
      return Object.freeze([...packagedBuilds]);
    },
  });
}

/**
 * Deterministic fixed clock fake (E9): a caller-programmed cursor; the
 * adapter under test cannot observe real time even by accident. Mirrors
 * the tool-fabric-runtime in-memory-clock convention — the object IS a
 * callable (the UnrealClockPort `() => number` shape) with cursor
 * helpers attached.
 */
export interface FakeUnrealClock {
  (options?: unknown): number;
  now(): number;
  advanceBy(ms: number): number;
  setTo(epochMs: number): number;
}

export function createFakeUnrealClock(startEpochMs = 0): FakeUnrealClock {
  let cursor = startEpochMs;
  const clock = ((): number => cursor) as FakeUnrealClock;
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
