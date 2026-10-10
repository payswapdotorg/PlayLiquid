/**
 * Module role: the in-memory FAKE bridge — the TEST HOST for the
 * BlenderBridgePort seam. Deterministic (E9): outcomes derive from a
 * seeded LCG and the invocation content, never from Math.random or the
 * wall clock; identical inputs produce identical outcomes. This is a test
 * double; it is NOT a real tool integration and must never be presented
 * as one (E11: the repository forbids mocks presented as production).
 * The REAL bridge (headless tool process) is a host concern, deliberately
 * deferred — recorded in the work order report.
 *
 * Seeded failure discipline: the fake can be scripted to fail specific
 * targets (e.g. a missing scene) so the E8 negative battery can exercise
 * every bridge error code deterministically.
 *
 * Implements: PL-025 fake bridge (deterministic in-memory host).
 */

import type {
  BlenderBridgeInvocation,
  BlenderBridgeOutcome,
  BlenderBridgePort,
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
  /** Targets reported as missing ("blender-payload target-not-found"). */
  readonly missingTargets?: readonly string[];
  /** Capabilities the fake refuses ("bridge/unsupported-capability"). */
  readonly unsupportedCapabilities?: readonly string[];
  /** Script digests the fake reports as mismatched. */
  readonly mismatchedScriptDigests?: readonly string[];
}

export type FakeBlenderBridgeScript = FakeBridgeScript;

export interface FakeBlenderBridge extends BlenderBridgePort {
  /** Every invocation received, in order (observation log). */
  readonly invoked: readonly BlenderBridgeInvocation[];
  /** Deterministic byte sizes minted for export artifacts, by command key. */
  readonly exportedBytes: Readonly<Record<string, number>>;
}

/** Deterministic artifact digest derived from the invocation content. */
function fakeArtifactDigest(invocation: BlenderBridgeInvocation): string {
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
export function createFakeBlenderBridge(options: { readonly seed: number; readonly script?: FakeBridgeScript }): FakeBlenderBridge {
  const random = createSeededRandom(options.seed);
  const script = options.script ?? {};
  const missing = new Set<string>(script.missingTargets ?? []);
  const unsupported = new Set<string>(script.unsupportedCapabilities ?? []);
  const mismatched = new Set<string>(script.mismatchedScriptDigests ?? []);
  const invoked: BlenderBridgeInvocation[] = [];
  const exportedBytes: Record<string, number> = {};

  async function invoke(invocation: BlenderBridgeInvocation): Promise<BlenderBridgeOutcome> {
    invoked.push(invocation);

    if (unsupported.has(invocation.capability)) {
      return fail("bridge/unsupported-capability", `the fake bridge does not serve ${invocation.capability}`);
    }
    if (missing.has(String((invocation.payload as { target?: unknown }).target ?? ""))) {
      return fail("bridge/target-not-found", `target not found: ${String((invocation.payload as { target?: unknown }).target)}`);
    }

    switch (invocation.capability) {
      case "project.inspect":
      case "scene.inspect":
      case "asset.inspect": {
        return ok({
          capability: invocation.capability,
          target: (invocation.payload as { target: string }).target,
          inspectedAt: seededReading(random),
          objects: Math.floor(random() * 32) + 1,
        });
      }
      case "project.modify": {
        const edits = (invocation.payload as { edits: readonly unknown[] }).edits;
        return ok({
          capability: invocation.capability,
          target: (invocation.payload as { target: string }).target,
          appliedEdits: edits.length,
          revision: seededReading(random),
        });
      }
      case "asset.import": {
        const artifact = (invocation.payload as { artifact: { digest: string; bytes: number } }).artifact;
        return ok({
          capability: invocation.capability,
          target: (invocation.payload as { target: string }).target,
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
          target: (invocation.payload as { target: string }).target,
          artifact: {
            kind: "artifact-ref",
            digest: fakeArtifactDigest(invocation),
            bytes,
          },
          mode: (invocation.payload as { mode: string }).mode,
        });
      }
      case "editor.action": {
        return ok({
          capability: invocation.capability,
          action: (invocation.payload as { action: string }).action,
          target: (invocation.payload as { target: string }).target,
          effect: seededReading(random),
        });
      }
      case "editor.script": {
        const scriptDigest = (invocation.payload as { scriptDigest: string }).scriptDigest;
        if (mismatched.has(scriptDigest)) {
          return fail("bridge/script-digest-mismatch", `script content digest does not match ${scriptDigest}`);
        }
        return ok({
          capability: invocation.capability,
          target: (invocation.payload as { target: string }).target,
          scriptDigest,
          stdout: `script-${scriptDigest.slice(0, 8)}-ok`,
          exitCode: 0,
        });
      }
      default:
        return fail("bridge/unsupported-capability", `the fake bridge does not serve ${invocation.capability}`);
    }
  }

  function ok(value: unknown): BlenderBridgeOutcome {
    return Object.freeze({ outcome: "ok", value, durationMs: 1 });
  }

  function fail(code: string, message: string): BlenderBridgeOutcome {
    return Object.freeze({ outcome: "failed", error: Object.freeze({ code, message }), durationMs: 1 });
  }

  return Object.freeze({
    invoke,
    get invoked(): readonly BlenderBridgeInvocation[] {
      return Object.freeze([...invoked]);
    },
    get exportedBytes(): Readonly<Record<string, number>> {
      return Object.freeze({ ...exportedBytes });
    },
  });
}

/**
 * Deterministic fixed clock fake (E9): a caller-programmed cursor; the
 * adapter under test cannot observe real time even by accident. Mirrors
 * the tool-fabric-runtime in-memory-clock convention — the object IS a
 * callable (the BlenderClockPort `() => number` shape) with cursor
 * helpers attached.
 */
export interface FakeBlenderClock {
  (options?: unknown): number;
  now(): number;
  advanceBy(ms: number): number;
  setTo(epochMs: number): number;
}

export function createFakeBlenderClock(startEpochMs = 0): FakeBlenderClock {
  let cursor = startEpochMs;
  const clock = ((): number => cursor) as FakeBlenderClock;
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
