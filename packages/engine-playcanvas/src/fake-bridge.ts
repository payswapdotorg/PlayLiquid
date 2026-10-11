/**
 * Module role: the in-memory FAKE bridge — the TEST HOST for the
 * PlayCanvasBridgePort seam. Deterministic (E9): outcomes derive from a
 * seeded LCG and the invocation content, never from Math.random or the
 * wall clock; identical inputs produce identical outcomes. This is a test
 * double; it is NOT a real engine integration and must never be presented
 * as one (E11: the repository forbids mocks presented as production).
 * The REAL bridge (PlayCanvas editor/web publish pipeline invocation) is
 * a host concern, deliberately deferred — recorded in the work order
 * report.
 *
 * Seeded failure discipline: the fake can be scripted to fail specific
 * targets (e.g. a missing scene/entity or an unpublished build id) so the
 * E8 negative battery can exercise every bridge error code
 * deterministically.
 *
 * Implements: PL-021 fake bridge (deterministic in-memory test host).
 */

import type {
  PlayCanvasBridgeInvocation,
  PlayCanvasBridgeOutcome,
  PlayCanvasBridgePort,
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

/** Scriptable per-target failure: (capability, target) → bridge error. */
export interface FakeBridgeScript {
  /** Targets reported as missing ("bridge/target-not-found"). */
  readonly missingTargets?: readonly string[];
  /** Entities reported as missing ("bridge/entity-not-found"). */
  readonly missingEntities?: readonly string[];
  /** Build ids reported as never published ("bridge/build-not-published"). */
  readonly unpublishedBuilds?: readonly string[];
  /** Channels the fake refuses ("bridge/channel-unsupported"). */
  readonly unsupportedChannels?: readonly string[];
  /** Script digests the fake reports as mismatched. */
  readonly mismatchedScriptDigests?: readonly string[];
}

export type FakePlayCanvasBridgeScript = FakeBridgeScript;

export interface FakePlayCanvasBridge extends PlayCanvasBridgePort {
  /** Every invocation received, in order (observation log). */
  readonly invoked: readonly PlayCanvasBridgeInvocation[];
  /** Deterministic byte sizes minted for export artifacts, by command key. */
  readonly exportedBytes: Readonly<Record<string, number>>;
  /** Build ids minted by publish invocations, in publish order. */
  readonly publishedBuilds: readonly string[];
}

/** Deterministic artifact digest derived from the invocation content. */
function fakeArtifactDigest(invocation: PlayCanvasBridgeInvocation): string {
  return contentDigestOf({ fake: "bridge-artifact", key: invocation.commandKey });
}

/** Deterministic numeric reading derived from the seeded LCG. */
function seededReading(random: () => number): number {
  return Math.floor(random() * 1000);
}

/**
 * Creates the deterministic in-memory fake bridge. `seed` drives every
 * derived numeric reading; identical seeds + identical invocations give
 * identical outcomes (E9 reproducibility).
 */
export function createFakePlayCanvasBridge(options: { readonly seed: number; readonly script?: FakeBridgeScript }): FakePlayCanvasBridge {
  const random = createSeededRandom(options.seed);
  const script = options.script ?? {};
  const missing = new Set<string>(script.missingTargets ?? []);
  const missingEntities = new Set<string>(script.missingEntities ?? []);
  const unpublished = new Set<string>(script.unpublishedBuilds ?? []);
  const unsupportedChannels = new Set<string>(script.unsupportedChannels ?? []);
  const mismatched = new Set<string>(script.mismatchedScriptDigests ?? []);
  const invoked: PlayCanvasBridgeInvocation[] = [];
  const exportedBytes: Record<string, number> = {};
  const publishedBuilds: string[] = [];

  async function invoke(invocation: PlayCanvasBridgeInvocation): Promise<PlayCanvasBridgeOutcome> {
    invoked.push(invocation);
    const target = String((invocation.payload as { target?: unknown }).target ?? "");

    if (missing.has(target)) {
      return fail("bridge/target-not-found", `target not found: ${target}`);
    }

    switch (invocation.capability) {
      case "project.inspect":
      case "scene.inspect":
      case "asset.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          inspectedAt: seededReading(random),
          entities: Math.floor(random() * 32) + 1,
        });
      }
      case "entity.inspect": {
        const entityName = String((invocation.payload as { target: string }).target);
        if (missingEntities.has(entityName)) {
          return fail("bridge/entity-not-found", `entity not found: ${entityName}`);
        }
        return ok({
          capability: invocation.capability,
          target,
          components: Math.floor(random() * 8) + 1,
          inspectedAt: seededReading(random),
        });
      }
      case "component.inspect": {
        return ok({
          capability: invocation.capability,
          target,
          componentType: "script",
          inspectedAt: seededReading(random),
        });
      }
      case "project.modify":
      case "entity.modify": {
        const edits = (invocation.payload as { edits: readonly unknown[] }).edits;
        return ok({
          capability: invocation.capability,
          target,
          appliedEdits: edits.length,
          revision: seededReading(random),
        });
      }
      case "asset.import": {
        const artifact = (invocation.payload as { artifact: { digest: string; bytes: number } }).artifact;
        return ok({
          capability: invocation.capability,
          target,
          importedDigest: artifact.digest,
          importedBytes: artifact.bytes,
          into: (invocation.payload as { into: string }).into,
        });
      }
      case "asset.export": {
        const bytes = Math.floor(random() * 100_000) + 1;
        exportedBytes[invocation.commandKey] = bytes;
        return ok({
          capability: invocation.capability,
          target,
          artifact: {
            kind: "artifact-ref",
            digest: fakeArtifactDigest(invocation),
            bytes,
          },
          mode: (invocation.payload as { mode: string }).mode,
        });
      }
      case "scene.action": {
        return ok({
          capability: invocation.capability,
          action: (invocation.payload as { action: string }).action,
          target,
          effect: seededReading(random),
        });
      }
      case "scene.script": {
        const scriptDigest = (invocation.payload as { scriptDigest: string }).scriptDigest;
        if (mismatched.has(scriptDigest)) {
          return fail("bridge/script-digest-mismatch", `script content digest does not match ${scriptDigest}`);
        }
        return ok({
          capability: invocation.capability,
          target,
          scriptDigest,
          stdout: `script-${scriptDigest.slice(0, 8)}-ok`,
          exitCode: 0,
        });
      }
      case "build.publish": {
        const channel = (invocation.payload as { channel: string }).channel;
        if (unsupportedChannels.has(channel)) {
          return fail("bridge/channel-unsupported", `the fake bridge does not publish to channel ${channel}`);
        }
        const buildId = `build-${fakeArtifactDigest(invocation).slice(0, 12)}`;
        publishedBuilds.push(buildId);
        return ok({
          capability: invocation.capability,
          target,
          channel,
          buildId,
          publishedAt: seededReading(random),
        });
      }
      case "build.play": {
        const buildId = (invocation.payload as { buildId: string }).buildId;
        if (unpublished.has(buildId) || !publishedBuilds.includes(buildId)) {
          return fail("bridge/build-not-published", `build id not published on this bridge: ${buildId}`);
        }
        return ok({
          capability: invocation.capability,
          target,
          buildId,
          sessionUrl: `session-${buildId}`,
          startedAt: seededReading(random),
        });
      }
      default:
        return fail("bridge/unsupported-capability", `the fake bridge does not serve ${invocation.capability}`);
    }
  }

  function ok(value: unknown): PlayCanvasBridgeOutcome {
    return Object.freeze({ outcome: "ok", value, durationMs: 1 });
  }

  function fail(code: string, message: string): PlayCanvasBridgeOutcome {
    return Object.freeze({ outcome: "failed", error: Object.freeze({ code, message }), durationMs: 1 });
  }

  return Object.freeze({
    invoke,
    get invoked(): readonly PlayCanvasBridgeInvocation[] {
      return Object.freeze([...invoked]);
    },
    get exportedBytes(): Readonly<Record<string, number>> {
      return Object.freeze({ ...exportedBytes });
    },
    get publishedBuilds(): readonly string[] {
      return Object.freeze([...publishedBuilds]);
    },
  });
}

/**
 * Deterministic fixed clock fake (E9): a caller-programmed cursor; the
 * adapter under test cannot observe real time even by accident. Mirrors
 * the tool-fabric-runtime in-memory-clock convention — the object IS a
 * callable (the PlayCanvasClockPort `() => number` shape) with cursor
 * helpers attached.
 */
export interface FakePlayCanvasClock {
  (options?: unknown): number;
  now(): number;
  advanceBy(ms: number): number;
  setTo(epochMs: number): number;
}

export function createFakePlayCanvasClock(startEpochMs = 0): FakePlayCanvasClock {
  let cursor = startEpochMs;
  const clock = ((): number => cursor) as FakePlayCanvasClock;
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
