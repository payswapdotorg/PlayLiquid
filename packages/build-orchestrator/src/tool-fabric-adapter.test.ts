/**
 * Tool Fabric adapter tests — the production ToolFabricPort wiring over
 * the REAL Tool Fabric runtime (createToolFabricRuntime with the fake
 * executor test double): availability is observable and truthful (E11),
 * invocations flow through the pipeline — never around it (E2) — and
 * every runtime refusal (unbound operations, unregistered tools, shape
 * violations, timeouts, cancellations, thrown errors) is a TYPED failure,
 * never an exception and never a fabricated ok.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asToolOperationId } from "@playliquid/build-contracts";
import type { InputIssue, SurfaceVersion, ToolIdentity } from "@playliquid/tool-fabric";
import {
  createFakeExecutor,
  createInMemoryArtifactExchange,
  createInMemoryClock,
  createInMemoryShapeCatalog,
  createToolFabricRuntime,
} from "@playliquid/tool-fabric-runtime";
import type { FakeToolExecutor, ToolFabricRuntime } from "@playliquid/tool-fabric-runtime";
import { createFakeAdapter } from "@playliquid/engine-adapter-contract";
import { createToolFabricAdapter } from "./tool-fabric-adapter.ts";
import type { FabricToolBinding } from "./tool-fabric-adapter.ts";
import type { BuildToolCall } from "./ports.ts";

const INPUT_SHAPE = { shapeId: "playliquid.shape/build-step-input", revision: 1 };
const OUTPUT_SHAPE = { shapeId: "playliquid.shape/build-step-output", revision: 1 };
const BUILD_TOOL: ToolIdentity = { namespace: "playliquid", name: "compile-step" };
const OTHER_TOOL: ToolIdentity = { namespace: "playliquid", name: "packaging-step" };
const SURFACE: SurfaceVersion = { major: 1, minor: 0 };

interface FabricRig {
  readonly runtime: ToolFabricRuntime;
  readonly executor: FakeToolExecutor;
}

function fabricRig(inputValidator: (input: unknown) => readonly InputIssue[] = () => []): FabricRig {
  const clock = createInMemoryClock(1_000);
  const executor = createFakeExecutor(() => clock.now());
  const shapes = createInMemoryShapeCatalog();
  shapes.register(INPUT_SHAPE, inputValidator);
  shapes.register(OUTPUT_SHAPE, () => []);
  const runtime = createToolFabricRuntime({
    clock,
    executor,
    shapeCatalog: shapes,
    artifactExchange: createInMemoryArtifactExchange(),
    grantedCapabilities: ["build.execute"],
  });
  return { runtime, executor };
}

function registerBuildTool(runtime: ToolFabricRuntime): void {
  const adapter = createFakeAdapter({ adapterId: "fabric.build", offeredCapabilities: ["tool.build"] });
  adapter.markReady();
  const registration = runtime.registerTool({
    descriptor: {
      identity: BUILD_TOOL,
      surfaceVersion: SURFACE,
      title: "Compile step",
      description: "Compiles one build stage step.",
      inputShape: INPUT_SHAPE,
      outputShape: OUTPUT_SHAPE,
      capabilities: ["build.execute"],
    },
    adapter,
    dispatchCapability: "tool.build",
  });
  if (registration.outcome !== "ok") {
    throw new Error(`fixture registration failed: ${registration.rejections.map((rejection) => rejection.message).join("; ")}`);
  }
}

function binding(
  operation: string,
  tool: ToolIdentity = BUILD_TOOL,
  surfaceVersion: SurfaceVersion = SURFACE,
): FabricToolBinding {
  return { operation: asToolOperationId(operation), tool, surfaceVersion };
}

function call(operation: string, input: unknown = { marker: true }, id: string = "call-1"): BuildToolCall {
  return {
    stage: "emit",
    operation: asToolOperationId(operation),
    callId: id,
    idempotencyKey: id,
    input,
  };
}

test("an operation is available exactly when its bound tool is registered behind the fabric (E11)", () => {
  const rig = fabricRig();
  registerBuildTool(rig.runtime);
  const adapter = createToolFabricAdapter({ runtime: rig.runtime, bindings: [binding("build")] });
  assert.deepEqual(adapter.availableOperations(), [asToolOperationId("build")]);
  const removed = rig.runtime.unregisterTool(BUILD_TOOL, SURFACE.major);
  assert.equal(removed.outcome, "ok");
  assert.deepEqual(adapter.availableOperations(), []);
  // A binding to a tool that was never registered is equally unavailable.
  const unregistered = createToolFabricAdapter({ runtime: rig.runtime, bindings: [binding("build", OTHER_TOOL)] });
  assert.deepEqual(unregistered.availableOperations(), []);
});

test("invokeBuildTool executes through the pipeline and returns the tool's output (E2)", async () => {
  const rig = fabricRig();
  registerBuildTool(rig.runtime);
  const adapter = createToolFabricAdapter({ runtime: rig.runtime, bindings: [binding("build")] });
  const result = await adapter.invokeBuildTool(call("build"));
  assert.equal(result.outcome, "ok");
  if (result.outcome === "ok") {
    assert.deepEqual(result.output, { echo: { marker: true } });
  }
  assert.equal(rig.executor.dispatched.length, 1);
  const dispatch = rig.executor.dispatched[0];
  assert.equal(dispatch?.callId, "call-1");
  assert.deepEqual(dispatch?.input, { marker: true });
  // The pipeline's idempotency ledger recorded the completed call.
  assert.equal(rig.runtime.ledgerSnapshot().length, 1);
});

test("an unbound operation is a typed operation-not-bound refusal (host wiring gap, E11)", async () => {
  const rig = fabricRig();
  registerBuildTool(rig.runtime);
  const adapter = createToolFabricAdapter({ runtime: rig.runtime, bindings: [binding("build")] });
  const result = await adapter.invokeBuildTool(call("sign"));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.code, "operation-not-bound");
    assert.match(result.message, /host wiring gap/);
  }
  assert.equal(rig.executor.dispatched.length, 0);
});

test("a bound tool missing from the fabric is a typed tool-not-registered refusal", async () => {
  const rig = fabricRig();
  const adapter = createToolFabricAdapter({ runtime: rig.runtime, bindings: [binding("build")] });
  const result = await adapter.invokeBuildTool(call("build"));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.code, "tool-not-registered");
    assert.match(result.message, /not registered behind the Tool Fabric/);
  }
  assert.equal(rig.executor.dispatched.length, 0);
  // A surface-version mismatch is equally unavailable: the binding names
  // the exact surface the consumer was built against.
  registerBuildTool(rig.runtime);
  const mismatched = createToolFabricAdapter({
    runtime: rig.runtime,
    bindings: [binding("build", BUILD_TOOL, { major: 2, minor: 0 })],
  });
  const mismatch = await mismatched.invokeBuildTool(call("build"));
  assert.equal(mismatch.outcome, "failed");
  if (mismatch.outcome === "failed") {
    assert.equal(mismatch.code, "tool-not-registered");
  }
  assert.equal(rig.executor.dispatched.length, 0);
});

test("a pipeline refusal surfaces verbatim as a typed failure (shape violation)", async () => {
  const rig = fabricRig((input) => {
    const record = input as Record<string, unknown>;
    return record["bad"] === true ? [{ path: "bad", message: "scripted shape violation" }] : [];
  });
  registerBuildTool(rig.runtime);
  const adapter = createToolFabricAdapter({ runtime: rig.runtime, bindings: [binding("build")] });
  const result = await adapter.invokeBuildTool(call("build", { bad: true }));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.code, "tool/invalid-input");
    assert.match(result.message, /failed fabric validation/);
  }
  assert.equal(rig.executor.dispatched.length, 0);
});

test("executor timeouts and cancellations map to typed tool-call failures", async () => {
  const rig = fabricRig();
  registerBuildTool(rig.runtime);
  const adapter = createToolFabricAdapter({ runtime: rig.runtime, bindings: [binding("build")] });
  // Distinct call ids per scenario: the fabric's idempotency ledger REPLAYS
  // a completed call id verbatim (E9), so each scripted executor result
  // needs its own idempotency scope to reach a fresh dispatch.
  rig.executor.scriptNextResult({ outcome: "timeout", deadline: { atEpochMs: 4_242 } });
  const timedOut = await adapter.invokeBuildTool(call("build", { marker: true }, "call-timeout"));
  assert.equal(timedOut.outcome, "failed");
  if (timedOut.outcome === "failed") {
    assert.equal(timedOut.code, "tool-call/timeout");
    assert.match(timedOut.message, /4242/);
  }
  rig.executor.scriptNextResult({ outcome: "cancelled", reason: "fabric-shutdown" });
  const cancelled = await adapter.invokeBuildTool(call("build", { marker: true }, "call-cancelled"));
  assert.equal(cancelled.outcome, "failed");
  if (cancelled.outcome === "failed") {
    assert.equal(cancelled.code, "tool-call/cancelled");
    assert.match(cancelled.message, /fabric-shutdown/);
  }
});

test("a throwing runtime becomes a typed fabric-error, never an exception", async () => {
  const rig = fabricRig();
  registerBuildTool(rig.runtime);
  const throwing: ToolFabricRuntime = {
    ...rig.runtime,
    invokeToolCall: () => {
      throw new Error("boom");
    },
  };
  const adapter = createToolFabricAdapter({ runtime: throwing, bindings: [binding("build")] });
  const result = await adapter.invokeBuildTool(call("build"));
  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.code, "fabric-error");
    assert.match(result.message, /boom/);
  }
});

test("the first binding per operation wins (host wiring order is explicit)", () => {
  const rig = fabricRig();
  registerBuildTool(rig.runtime);
  const firstWins = createToolFabricAdapter({
    runtime: rig.runtime,
    bindings: [binding("build"), binding("build", OTHER_TOOL)],
  });
  assert.deepEqual(firstWins.availableOperations(), [asToolOperationId("build")]);
  const firstAbsent = createToolFabricAdapter({
    runtime: rig.runtime,
    bindings: [binding("build", OTHER_TOOL), binding("build")],
  });
  assert.deepEqual(firstAbsent.availableOperations(), []);
});
