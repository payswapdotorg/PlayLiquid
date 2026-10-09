/**
 * Module role: tests for the production-default composition — the facade
 * wired with the system clock, the canonical adapter-dispatch executor and
 * empty in-memory stores; plus an end-to-end call through a REAL node
 * process executor (runtime evidence for the composition root).
 *
 * Implements: PL-019 composition coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakeAdapter } from "@playliquid/engine-adapter-contract";
import type { ToolCallFailure, ToolCallOk, ToolCallOutcome } from "@playliquid/tool-fabric";
import { createToolFabricRuntimeWithDefaults } from "./adapters/runtime-composition.ts";
import { createNodeProcessExecutor } from "./adapters/node-process-executor.ts";
import { createInMemoryClock } from "./in-memory-clock.ts";
import { createInMemoryShapeCatalog } from "./in-memory-shape-catalog.ts";

const INPUT_SHAPE = { shapeId: "playliquid.shape/dice-input", revision: 1 };
const OUTPUT_SHAPE = { shapeId: "playliquid.shape/dice-output", revision: 1 };

function okOf(outcome: ToolCallOutcome): ToolCallOk {
  if (outcome.outcome !== "ok") {
    assert.fail(`expected ok, got ${outcome.outcome}`);
  }
  return outcome;
}

function failureOf(outcome: ToolCallOutcome): ToolCallFailure {
  if (outcome.outcome !== "failure") {
    assert.fail(`expected failure, got ${outcome.outcome}`);
  }
  return outcome;
}

const descriptor = {
  identity: { namespace: "playliquid", name: "dice-roll" },
  surfaceVersion: { major: 1, minor: 0 },
  title: "Dice roll",
  description: "Rolls dice through a real process.",
  inputShape: INPUT_SHAPE,
  outputShape: OUTPUT_SHAPE,
  capabilities: [],
};

test("default composition registers, mediates and invokes through the adapter-dispatch executor", async () => {
  const runtime = createToolFabricRuntimeWithDefaults();
  const adapter = createFakeAdapter({ adapterId: "fabric.primary", offeredCapabilities: ["tool.dice"] });
  adapter.markReady();
  const registration = runtime.registerTool({ descriptor, adapter, dispatchCapability: "tool.dice" });
  if (registration.outcome !== "ok") {
    assert.fail("expected registration");
  }
  const outcome = await runtime.invokeToolCall({
    kind: "tool-call-request",
    callId: "call-1",
    tool: { namespace: "playliquid", name: "dice-roll" },
    surfaceVersion: { major: 1, minor: 0 },
    input: { count: 2 },
    requiredCapabilities: [],
  });
  // The empty shape catalog refuses unknown shapes: typed invalid-input.
  assert.equal(failureOf(outcome).error.code, "tool/invalid-input");
});

test("hosts inject a real node process executor and shapes end-to-end", async () => {
  const clock = createInMemoryClock(1_000);
  const shapes = createInMemoryShapeCatalog();
  shapes.register(INPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  shapes.register(OUTPUT_SHAPE as { shapeId: string; revision: number }, (output: unknown) => {
    const record = output as Record<string, unknown>;
    if (record === null || typeof record !== "object" || !("echo" in record)) {
      return [{ path: "echo", message: "the process echo output is required" }];
    }
    return [];
  });
  const runtime = createToolFabricRuntimeWithDefaults({
    clock,
    executor: createNodeProcessExecutor(),
    shapeCatalog: shapes,
  });
  const adapter = createFakeAdapter({ adapterId: "fabric.process", offeredCapabilities: ["tool.process"] });
  adapter.markReady();
  const processDescriptor = {
    ...descriptor,
    identity: { namespace: "playliquid", name: "process-tool" },
  };
  const registration = runtime.registerTool({ descriptor: processDescriptor, adapter, dispatchCapability: "tool.process" });
  if (registration.outcome !== "ok") {
    assert.fail("expected registration");
  }
  const outcome = okOf(await runtime.invokeToolCall({
    kind: "tool-call-request",
    callId: "call-1",
    tool: { namespace: "playliquid", name: "process-tool" },
    surfaceVersion: { major: 1, minor: 0 },
    input: { count: 2 },
    requiredCapabilities: [],
  }));
  assert.deepEqual(outcome.output, { echo: { count: 2 } });
});

test("the default executor is the adapter-dispatch executor (proven by adapter dispatch output)", async () => {
  const shapes = createInMemoryShapeCatalog();
  shapes.register(INPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  shapes.register(OUTPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  const runtime = createToolFabricRuntimeWithDefaults({ shapeCatalog: shapes });
  const adapter = createFakeAdapter({ adapterId: "fabric.ready", offeredCapabilities: ["tool.dice"] });
  adapter.markReady();
  const registered = runtime.registerTool({ descriptor, adapter, dispatchCapability: "tool.dice" });
  if (registered.outcome !== "ok") {
    assert.fail("expected registration");
  }
  const outcome = okOf(await runtime.invokeToolCall({
    kind: "tool-call-request",
    callId: "call-1",
    tool: { namespace: "playliquid", name: "dice-roll" },
    surfaceVersion: { major: 1, minor: 0 },
    input: { count: 2 },
    requiredCapabilities: [],
  }));
  assert.deepEqual(outcome.output, { commandId: "call-1", capability: "tool.dice" });
});
