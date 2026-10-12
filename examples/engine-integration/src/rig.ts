/**
 * FORGE — the tool fabric rig (PL-038).
 *
 * The composition root of the engine-native workflow: ONE Tool Fabric
 * runtime (PL-019) — the real registry, invocation pipeline and job queue
 * over injected ports — with the FOUR real adapters registered behind it:
 * tool.blender (PL-025), engine.unreal (PL-022), engine.unity (PL-023)
 * and engine.godot (PL-024), each capability exposed as its own tool
 * (the tool-fabric model: a tool IS a capability surface; the adapter is
 * the engine-specific behavior behind it, E4). Every tool call in the
 * workflow dispatches through the pipeline (E2: never around it) —
 * envelope validation, idempotency ledger, capability mediation, shape
 * catalog, content-addressed exchange guard and the canonical
 * adapter-dispatch executor are ALL the runtime's own code paths.
 *
 * Determinism (E9): the runtime clock, the adapters' clocks and the
 * bridges' seeds are injected constants; nothing reads Date.now() or
 * Math.random anywhere in the workflow.
 *
 * E11 honesty: the bridges are the adapters' own shipped in-memory FAKE
 * bridges — the deterministic test hosts behind the pure bridge ports.
 * No Blender/Unreal/Unity/Godot binary is installed, invoked or pretended.
 * See README.md for the full scope statement.
 */

import { createBlenderAdapter, createFakeBlenderBridge, createFakeBlenderClock } from "../../../packages/tool-blender/src/index.ts";
import type { BlenderAdapter, FakeBlenderBridge } from "../../../packages/tool-blender/src/index.ts";
import { createFakeUnrealBridge, createFakeUnrealClock, createUnrealAdapter } from "../../../packages/engine-unreal/src/index.ts";
import type { FakeUnrealBridge, UnrealAdapter } from "../../../packages/engine-unreal/src/index.ts";
import { createFakeUnityBridge, createFakeUnityClock, createUnityAdapter } from "../../../packages/engine-unity/src/index.ts";
import { createFakeGodotBridge, createFakeGodotClock, createGodotAdapter } from "../../../packages/engine-godot/src/index.ts";
import type { Adapter } from "../../../packages/engine-adapter-contract/src/index.ts";
import {
  createAdapterDispatchExecutor,
  createInMemoryArtifactExchange,
  createInMemoryClock,
  createInMemoryShapeCatalog,
  createToolFabricRuntime,
} from "../../../packages/tool-fabric-runtime/src/index.ts";
import type { InMemoryArtifactExchange, InMemoryClock, ToolFabricRuntime } from "../../../packages/tool-fabric-runtime/src/index.ts";
import type { InputIssue, ToolIdentity } from "../../../packages/tool-fabric/src/index.ts";
import {
  BLENDER_BRIDGE_SEED,
  BLENDER_INPUT_SHAPE,
  BLENDER_OUTPUT_SHAPE,
  ENGINE_INPUT_SHAPE,
  ENGINE_OUTPUT_SHAPE,
  FORGE_TENANT,
  GODOT_BRIDGE_SEED,
  GRANTED_CAPABILITIES,
  TOOL_NAMESPACE,
  TOOL_SURFACE,
  UNREAL_BRIDGE_SEED,
  UNITY_BRIDGE_SEED,
  WORKFLOW_CLOCK_ORIGIN_MS,
} from "./ids.ts";

/** The shared injected workflow clock (E9): a caller-advanced cursor. */
export interface WorkflowClock {
  now(): number;
  advanceBy(ms: number): number;
}

/** Creates the shared deterministic clock every seam consults (E9). */
export function createWorkflowClock(originMs: number = WORKFLOW_CLOCK_ORIGIN_MS): WorkflowClock {
  let cursor = originMs;
  return Object.freeze({
    now: () => cursor,
    advanceBy: (ms: number): number => {
      cursor += ms;
      return cursor;
    },
  });
}

/**
 * The host's shape validators for the fabric seam: the input must be a
 * non-array object the adapter can adjudicate — the FIELD vocabulary and
 * its total validation stay the adapter's own (E4: one authority per
 * concern; the adapter's payload validator is exercised on every call).
 */
function commandShape(input: unknown): readonly InputIssue[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [{ path: "input", message: "command input must be a non-array object (the adapter adjudicates the fields)" }];
  }
  return [];
}

/** The Blender capabilities the workflow registers as tools. */
const BLENDER_CAPABILITIES = ["project.inspect", "asset.import", "project.modify", "scene.inspect", "editor.action", "editor.script"] as const;
/** The Unreal capabilities the workflow registers as tools. */
const UNREAL_CAPABILITIES = ["build.cook", "editor.script", "editor.action", "build.package"] as const;

/** The registered adapter set (real adapters over their shipped fake bridges). */
export interface ForgeAdapters {
  readonly blender: BlenderAdapter;
  readonly unreal: UnrealAdapter;
  /** The content-addressed artifact exchange every tool call flows through (E7). */
  readonly exchange: InMemoryArtifactExchange;
  /** The fabric runtime: registry + invocation pipeline + idempotency ledger. */
  readonly runtime: ToolFabricRuntime;
  /** The pipeline's deterministic clock (the fabric's own time seam). */
  readonly fabricClock: InMemoryClock;
  /** The Blender adapter's fake bridge (observation surface for tests). */
  readonly blenderBridge: FakeBlenderBridge;
  /** The Unreal adapter's fake bridge (observation surface for tests). */
  readonly unrealBridge: FakeUnrealBridge;
}

/** The tool identity of one registered capability (deterministic slug). */
export function capabilityTool(capability: string, adapterId: string): ToolIdentity {
  const family = capability.replace(".", "-");
  // Per-adapter namespacing: Blender and the engines overlap on capability
  // names (editor.script / editor.action) while the fabric registry keys
  // tools by identity alone — the adapter slug keeps the identities unique
  // without hiding the collision (the overlap is real, the tools are not).
  const slug = adapterId.split(".").pop() ?? adapterId;
  return { namespace: TOOL_NAMESPACE, name: `tool-${slug}-${family}` };
}

/** Registers one capability of one adapter as a tool behind the runtime. */
function registerCapability(
  runtime: ToolFabricRuntime,
  adapter: Adapter,
  capability: string,
  inputShape: { readonly shapeId: string; readonly revision: number },
  outputShape: { readonly shapeId: string; readonly revision: number },
  granted: string,
): void {
  const registration = runtime.registerTool({
    descriptor: {
      identity: capabilityTool(capability, adapter.id),
      surfaceVersion: { ...TOOL_SURFACE },
      title: `Forge ${capability}`,
      description: `The ${adapter.id} adapter's ${capability} capability, registered behind the Tool Fabric runtime (PL-038 rig; in-memory fake bridge, E11).`,
      inputShape: { ...inputShape },
      outputShape: { ...outputShape },
      capabilities: [granted],
    },
    adapter,
    dispatchCapability: capability,
  });
  if (registration.outcome !== "ok") {
    throw new Error(
      `rig registration failed for ${capability}: ${registration.rejections.map((rejection) => rejection.message).join("; ")}`,
    );
  }
}

/** Creates the rig: runtime + four real adapters + per-capability registrations. */
export function createForgeAdapters(): ForgeAdapters {
  const fabricClock = createInMemoryClock(WORKFLOW_CLOCK_ORIGIN_MS);

  const blenderBridge = createFakeBlenderBridge({ seed: BLENDER_BRIDGE_SEED });
  const unrealBridge = createFakeUnrealBridge({ seed: UNREAL_BRIDGE_SEED });
  const unityBridge = createFakeUnityBridge({ seed: UNITY_BRIDGE_SEED });
  const godotBridge = createFakeGodotBridge({ seed: GODOT_BRIDGE_SEED });

  const blender = createBlenderAdapter({ tenant: FORGE_TENANT, bridge: blenderBridge, clock: createFakeBlenderClock(WORKFLOW_CLOCK_ORIGIN_MS) });
  const unreal = createUnrealAdapter({ tenant: FORGE_TENANT, bridge: unrealBridge, clock: createFakeUnrealClock(WORKFLOW_CLOCK_ORIGIN_MS) });
  const unity = createUnityAdapter({ tenant: FORGE_TENANT, bridge: unityBridge, clock: createFakeUnityClock(WORKFLOW_CLOCK_ORIGIN_MS) });
  const godot = createGodotAdapter({ tenant: FORGE_TENANT, bridge: godotBridge, clock: createFakeGodotClock(WORKFLOW_CLOCK_ORIGIN_MS) });
  blender.markReady();
  unreal.markReady();
  unity.markReady();
  godot.markReady();

  const shapes = createInMemoryShapeCatalog();
  shapes.register({ ...BLENDER_INPUT_SHAPE }, commandShape);
  shapes.register({ ...BLENDER_OUTPUT_SHAPE }, commandShape);
  shapes.register({ ...ENGINE_INPUT_SHAPE }, commandShape);
  shapes.register({ ...ENGINE_OUTPUT_SHAPE }, commandShape);
  const exchange = createInMemoryArtifactExchange();

  const runtime = createToolFabricRuntime({
    clock: fabricClock,
    executor: createAdapterDispatchExecutor(),
    shapeCatalog: shapes,
    artifactExchange: exchange,
    grantedCapabilities: [...GRANTED_CAPABILITIES],
  });

  for (const capability of BLENDER_CAPABILITIES) {
    registerCapability(runtime, blender, capability, BLENDER_INPUT_SHAPE, BLENDER_OUTPUT_SHAPE, "forge.author");
  }
  for (const capability of UNREAL_CAPABILITIES) {
    registerCapability(runtime, unreal, capability, ENGINE_INPUT_SHAPE, ENGINE_OUTPUT_SHAPE, "forge.build");
  }
  // Unity and Godot register their build capabilities: the fabric's
  // capability discovery finds all four engine families (the negative
  // battery adjudicates their typed target sets through their bindings).
  registerCapability(runtime, unity, "build.player", ENGINE_INPUT_SHAPE, ENGINE_OUTPUT_SHAPE, "forge.build");
  registerCapability(runtime, godot, "build.export", ENGINE_INPUT_SHAPE, ENGINE_OUTPUT_SHAPE, "forge.build");

  return Object.freeze({ blender, unreal, exchange, runtime, fabricClock, blenderBridge, unrealBridge });
}
