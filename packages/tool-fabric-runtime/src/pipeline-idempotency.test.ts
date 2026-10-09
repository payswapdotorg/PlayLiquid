/**
 * Module role: tests for the invocation pipeline idempotency ledger —
 * replay semantics, input-fingerprint mismatch, non-fingerprintable
 * inputs, concurrent single-flight execution and ledger rehydration.
 *
 * Implements: PL-019 binding idempotency semantics of the tool-fabric call
 * protocol (§3.A.2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakeAdapter } from "@playliquid/engine-adapter-contract";
import type { ToolCallFailure, ToolCallOutcome } from "@playliquid/tool-fabric";
import { inputFingerprint } from "@playliquid/tool-fabric";
import { createToolFabricRegistry } from "./domain/registry.ts";
import { createInvocationPipeline } from "./app/pipeline.ts";
import { createFakeExecutor } from "./fake-executor.ts";
import { createInMemoryClock } from "./in-memory-clock.ts";
import { createInMemoryShapeCatalog } from "./in-memory-shape-catalog.ts";
import { createInMemoryArtifactExchange } from "./in-memory-artifact-exchange.ts";

function failureOf(outcome: ToolCallOutcome): ToolCallFailure {
  if (outcome.outcome !== "failure") {
    assert.fail(`expected failure, got ${outcome.outcome}`);
  }
  return outcome;
}

const INPUT_SHAPE = { shapeId: "playliquid.shape/dice-input", revision: 1 };
const OUTPUT_SHAPE = { shapeId: "playliquid.shape/dice-output", revision: 1 };

const descriptor = {
  identity: { namespace: "playliquid", name: "dice-roll" },
  surfaceVersion: { major: 1, minor: 0 },
  title: "Dice roll",
  description: "Rolls N dice.",
  inputShape: INPUT_SHAPE,
  outputShape: OUTPUT_SHAPE,
  capabilities: [],
};

interface Harness {
  executor: ReturnType<typeof createFakeExecutor>;
  clock: ReturnType<typeof createInMemoryClock>;
  pipeline: ReturnType<typeof createInvocationPipeline>;
}

function harness(): Harness {
  const registry = createToolFabricRegistry();
  const adapter = createFakeAdapter({ adapterId: "fabric.primary", offeredCapabilities: ["tool.dice"] });
  adapter.markReady();
  const registration = registry.register({ descriptor, adapter, dispatchCapability: "tool.dice" });
  if (registration.outcome !== "ok") {
    throw new Error("fixture registration failed");
  }
  const clock = createInMemoryClock(1_000);
  const executor = createFakeExecutor(() => clock.now());
  const shapes = createInMemoryShapeCatalog();
  shapes.register(INPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  shapes.register(OUTPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  const pipeline = createInvocationPipeline({
    registry,
    clock,
    executor,
    shapeCatalog: shapes,
    artifactExchange: createInMemoryArtifactExchange(),
  });
  return { executor, clock, pipeline };
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "tool-call-request",
    callId: "call-1",
    tool: { namespace: "playliquid", name: "dice-roll" },
    surfaceVersion: { major: 1, minor: 0 },
    input: { count: 2 },
    requiredCapabilities: [],
    idempotencyKey: "key-1",
    ...overrides,
  };
}

test("a replay returns the very same frozen outcome and does not re-execute", async () => {
  const fabric = harness();
  const first = await fabric.pipeline.invoke(request());
  const second = await fabric.pipeline.invoke(request({ callId: "call-replay" }));
  assert.equal(second, first);
  assert.equal(fabric.executor.dispatched.length, 1);
});

test("a replay with different input fails with the typed mismatch code", async () => {
  const fabric = harness();
  await fabric.pipeline.invoke(request());
  const failure = failureOf(await fabric.pipeline.invoke(request({ input: { count: 3 } })));
  assert.equal(failure.error.code, "tool/idempotency-input-mismatch");
  assert.equal(fabric.executor.dispatched.length, 1);
});

test("non-fingerprintable inputs skip the mismatch check and replay normally", async () => {
  const fabric = harness();
  const exotic = (): unknown => ({ count: 2, fn: () => 1 });
  const first = await fabric.pipeline.invoke(request({ input: exotic() }));
  assert.equal(first.outcome, "ok");
  const second = await fabric.pipeline.invoke(request({ callId: "call-replay", input: exotic() }));
  assert.equal(second.outcome, "ok");
  assert.equal(second, first);
  assert.equal(fabric.executor.dispatched.length, 1);
});

test("concurrent calls with the same scope execute once (single flight)", async () => {
  const fabric = harness();
  const [first, second] = await Promise.all([
    fabric.pipeline.invoke(request()),
    fabric.pipeline.invoke(request({ callId: "call-concurrent" })),
  ]);
  assert.equal(first.outcome, "ok");
  assert.equal(second, first);
  assert.equal(fabric.executor.dispatched.length, 1);
});

test("calls without an idempotency key always execute", async () => {
  const fabric = harness();
  await fabric.pipeline.invoke(request({ idempotencyKey: undefined }));
  await fabric.pipeline.invoke(request({ idempotencyKey: undefined, callId: "call-2" }));
  assert.equal(fabric.executor.dispatched.length, 2);
});

test("the idempotency scope separates surface majors", async () => {
  const fabric = harness();
  const outcome = {
    outcome: "ok",
    callId: "call-0",
    provenance: { kind: "call-provenance", tool: { namespace: "playliquid", name: "dice-roll" }, declaredSurface: { major: 2, minor: 0 } },
    output: 42,
  } as const;
  // Scope string for major 2 (mirrors idempotencyScope).
  fabric.pipeline.ledgerRehydrate("playliquid/dice-roll|2|key-1", inputFingerprint({ count: 2 }), outcome);
  // A major-1 request with the SAME key is a different scope: it executes.
  const executed = await fabric.pipeline.invoke(request());
  assert.equal(executed.outcome, "ok");
  assert.equal(fabric.executor.dispatched.length, 1);
  assert.equal(fabric.pipeline.ledgerSnapshot().length, 2);
});

test("ledgerRehydrate records completed entries, keeps the first, and enables replays", async () => {
  const fabric = harness();
  const outcome = {
    outcome: "ok",
    callId: "call-0",
    provenance: { kind: "call-provenance", tool: { namespace: "playliquid", name: "dice-roll" }, declaredSurface: { major: 1, minor: 0 } },
    output: 42,
  } as const;
  const scope = "playliquid/dice-roll|1|key-1";
  fabric.pipeline.ledgerRehydrate(scope, inputFingerprint({ count: 2 }), outcome);
  // Second rehydrate with a different fingerprint must NOT replace the first.
  fabric.pipeline.ledgerRehydrate(scope, inputFingerprint({ count: 9 }), outcome);
  const entry = fabric.pipeline.ledgerLookup(scope);
  if (entry === null) {
    assert.fail("expected a rehydrated entry");
  }
  assert.equal(entry.fingerprint, inputFingerprint({ count: 2 }));

  // The rehydrated entry replays for a matching request without executing.
  const replayed = await fabric.pipeline.invoke(request({ callId: "call-replay" }));
  assert.equal(replayed, outcome);
  assert.equal(fabric.executor.dispatched.length, 0);
  assert.equal(fabric.pipeline.ledgerSnapshot().length, 1);
});

test("pre-dispatch cancellation is not recorded: a fresh call executes later", async () => {
  const fabric = harness();
  let cancelled = false;
  const token = {
    get requested(): boolean {
      return cancelled;
    },
    onCancel: (): (() => void) => () => undefined,
  };
  cancelled = true;
  const first = await fabric.pipeline.invoke(request({ cancellation: token }));
  assert.equal(first.outcome, "cancelled");
  cancelled = false;
  const second = await fabric.pipeline.invoke(request({ callId: "call-after-cancel" }));
  assert.equal(second.outcome, "ok");
  assert.equal(fabric.executor.dispatched.length, 1);
});
