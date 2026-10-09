/**
 * Module role: tests for the Tool Fabric runtime facade — registration,
 * discovery, synchronous invocation, job lifecycle through the facade, and
 * the unregister boundary.
 *
 * Implements: PL-019 facade behavior coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakeAdapter } from "@playliquid/engine-adapter-contract";
import type { ToolCallFailure, ToolCallOk, ToolCallOutcome } from "@playliquid/tool-fabric";
import { createToolFabricRuntime } from "./app/fabric-runtime.ts";
import { createFakeExecutor } from "./fake-executor.ts";
import { createInMemoryClock } from "./in-memory-clock.ts";
import { createInMemoryShapeCatalog } from "./in-memory-shape-catalog.ts";
import { createInMemoryArtifactExchange } from "./in-memory-artifact-exchange.ts";
import { createCollectingJobEventSink } from "./in-memory-jobs.ts";

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
  description: "Rolls N dice.",
  inputShape: INPUT_SHAPE,
  outputShape: OUTPUT_SHAPE,
  capabilities: ["random.generate"],
};

function harness() {
  const clock = createInMemoryClock(1_000);
  const executor = createFakeExecutor(() => clock.now());
  const shapes = createInMemoryShapeCatalog();
  shapes.register(INPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  shapes.register(OUTPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  const events = createCollectingJobEventSink();
  const runtime = createToolFabricRuntime({
    clock,
    executor,
    shapeCatalog: shapes,
    artifactExchange: createInMemoryArtifactExchange(),
    eventSink: events,
    grantedCapabilities: ["random.generate"],
  });
  return { clock, executor, events, runtime };
}

function registerDice(runtime: ReturnType<typeof createToolFabricRuntime>): void {
  const adapter = createFakeAdapter({ adapterId: "fabric.primary", offeredCapabilities: ["tool.dice"] });
  adapter.markReady();
  const registration = runtime.registerTool({ descriptor, adapter, dispatchCapability: "tool.dice" });
  if (registration.outcome !== "ok") {
    throw new Error("fixture registration failed");
  }
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "tool-call-request",
    callId: "call-1",
    tool: { namespace: "playliquid", name: "dice-roll" },
    surfaceVersion: { major: 1, minor: 0 },
    input: { count: 2 },
    requiredCapabilities: [],
    ...overrides,
  };
}

test("register, invoke, discover and list through the facade", async () => {
  const fabric = harness();
  registerDice(fabric.runtime);
  const outcome = okOf(await fabric.runtime.invokeToolCall(request()));
  assert.deepEqual(outcome.output, { echo: { count: 2 } });
  assert.equal(fabric.runtime.listTools().length, 1);
  assert.equal(fabric.runtime.discoverTools("random.generate").length, 1);
  assert.equal(fabric.runtime.discoverTools("absent.capability").length, 0);
});

test("unregister makes subsequent calls unavailable; invalid registrations refuse", async () => {
  const fabric = harness();
  registerDice(fabric.runtime);
  const removed = fabric.runtime.unregisterTool({ namespace: "playliquid", name: "dice-roll" }, 1);
  assert.equal(removed.outcome, "ok");
  const failure = failureOf(await fabric.runtime.invokeToolCall(request()));
  assert.equal(failure.error.code, "tool/unavailable");

  const invalid = fabric.runtime.registerTool({ descriptor: null, adapter: null, dispatchCapability: "tool.dice" });
  assert.equal(invalid.outcome, "rejected");
});

test("jobs flow through the facade: enqueue, pump, terminal status, events", async () => {
  const fabric = harness();
  registerDice(fabric.runtime);
  const admitted = await fabric.runtime.enqueueJob({
    jobId: "job-1",
    call: request({ idempotencyKey: "key-1" }),
    maxAttempts: 2,
  });
  if (admitted.outcome !== "admitted") {
    assert.fail(`expected admission, got: ${JSON.stringify(admitted)}`);
  }
  await fabric.runtime.pumpJobs();
  const status = fabric.runtime.jobStatus("job-1");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.status, "succeeded");
  assert.deepEqual(
    fabric.events.forJob("job-1").map((event) => event.type),
    ["admitted", "started", "succeeded"],
  );
  assert.equal(fabric.runtime.jobSnapshots().length, 1);
  assert.equal(fabric.runtime.ledgerSnapshot().length, 1);
});

test("the facade cancel path cancels a queued job before execution", async () => {
  const fabric = harness();
  registerDice(fabric.runtime);
  await fabric.runtime.enqueueJob({ jobId: "job-1", call: request() });
  const cancelled = await fabric.runtime.cancelJob("job-1");
  if (cancelled.outcome !== "ok") {
    assert.fail(`expected ok, got: ${JSON.stringify(cancelled)}`);
  }
  await fabric.runtime.pumpJobs();
  assert.equal(fabric.executor.dispatched.length, 0);
  const status = fabric.runtime.jobStatus("job-1");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.status, "cancelled");
});
