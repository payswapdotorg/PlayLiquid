/**
 * Module role: tests for the invocation pipeline — validation, mediation,
 * exchange guards, deadline/cancellation boundary decisions and executor
 * result mapping. Idempotency ledger coverage lives in
 * pipeline-idempotency.test.ts.
 *
 * Implements: PL-019 pipeline behavior coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakeAdapter } from "@playliquid/engine-adapter-contract";
import type { ToolCallCancelled, ToolCallFailure, ToolCallOk, ToolCallOutcome, ToolCallTimeout } from "@playliquid/tool-fabric";
import { createToolFabricRegistry } from "./domain/registry.ts";
import { createInvocationPipeline } from "./app/pipeline.ts";
import { createFakeExecutor } from "./fake-executor.ts";
import { createInMemoryClock } from "./in-memory-clock.ts";
import { createInMemoryShapeCatalog } from "./in-memory-shape-catalog.ts";
import { createInMemoryArtifactExchange } from "./in-memory-artifact-exchange.ts";

const INPUT_SHAPE = { shapeId: "playliquid.shape/dice-input", revision: 1 };
const OUTPUT_SHAPE = { shapeId: "playliquid.shape/dice-output", revision: 1 };

const descriptor = {
  identity: { namespace: "playliquid", name: "dice-roll" },
  surfaceVersion: { major: 1, minor: 2 },
  title: "Dice roll",
  description: "Rolls N dice.",
  inputShape: INPUT_SHAPE,
  outputShape: OUTPUT_SHAPE,
  capabilities: ["random.generate"],
  defaultTimeoutMs: 5_000,
};

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

function timeoutOf(outcome: ToolCallOutcome): ToolCallTimeout {
  if (outcome.outcome !== "timeout") {
    assert.fail(`expected timeout, got ${outcome.outcome}`);
  }
  return outcome;
}

function cancelledOf(outcome: ToolCallOutcome): ToolCallCancelled {
  if (outcome.outcome !== "cancelled") {
    assert.fail(`expected cancelled, got ${outcome.outcome}`);
  }
  return outcome;
}

interface Harness {
  executor: ReturnType<typeof createFakeExecutor>;
  clock: ReturnType<typeof createInMemoryClock>;
  exchange: ReturnType<typeof createInMemoryArtifactExchange>;
  invoke(request: unknown, granted?: readonly string[]): Promise<ToolCallOutcome>;
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
  shapes.register(INPUT_SHAPE as { shapeId: string; revision: number }, (input: unknown) => {
    const record = input as Record<string, unknown>;
    if (typeof record !== "object" || record === null || typeof record["count"] !== "number") {
      return [{ path: "count", message: "count must be a number" }];
    }
    return [];
  });
  shapes.register(OUTPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  const exchange = createInMemoryArtifactExchange();
  const pipeline = createInvocationPipeline({
    registry,
    clock,
    executor,
    shapeCatalog: shapes,
    artifactExchange: exchange,
    grantedCapabilities: ["random.generate"],
  });
  return { executor, clock, exchange, invoke: (request, granted) => pipeline.invoke(request, granted) };
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

test("happy path: ok outcome with declared-surface provenance and echoed output", async () => {
  const fabric = harness();
  const outcome = okOf(await fabric.invoke(request()));
  assert.equal(outcome.callId, "call-1");
  assert.deepEqual(outcome.output, { echo: { count: 2 } });
  assert.equal(outcome.provenance.declaredSurface.major, 1);
  assert.equal(fabric.executor.dispatched.length, 1);
  assert.equal(fabric.executor.dispatched[0]?.callId, "call-1");
});

test("invalid request envelope is a typed invalid-request failure", async () => {
  const fabric = harness();
  const failure = failureOf(await fabric.invoke({ kind: "tool-call-request", callId: "" }));
  assert.equal(failure.error.code, "tool/invalid-request");
  assert.equal(failure.callId, "(unvalidated)");
  assert.equal(fabric.executor.dispatched.length, 0);
});

test("unknown tool and wrong surface major are typed unavailable failures", async () => {
  const fabric = harness();
  const unknown = failureOf(await fabric.invoke(request({ tool: { namespace: "playliquid", name: "absent" } })));
  assert.equal(unknown.error.code, "tool/unavailable");
  const wrongMajor = failureOf(await fabric.invoke(request({ surfaceVersion: { major: 7, minor: 0 } })));
  assert.equal(wrongMajor.error.code, "tool/unavailable");
  assert.ok(wrongMajor.error.message.includes("surface majors [1]"));
});

test("unregistered surface majors resolve to unavailable; registered-but-newer minors are typed mismatches", async () => {
  const fabric = harness();
  // Major 2 is not registered at all: the registry resolves exact majors,
  // so an unregistered major is a typed unavailability listing majors.
  const absentMajor = failureOf(await fabric.invoke(request({ surfaceVersion: { major: 2, minor: 0 } })));
  assert.equal(absentMajor.error.code, "tool/unavailable");
  assert.ok(absentMajor.error.message.includes("surface majors [1]"));

  // Major 1 IS registered with declared minor 2: requesting minor 9 is the
  // typed surface mismatch (minor-too-new; majors are never auto-coerced).
  const newerMinor = failureOf(await fabric.invoke(request({ surfaceVersion: { major: 1, minor: 9 } })));
  assert.equal(newerMinor.error.code, "tool/surface-version-mismatch");
  assert.deepEqual(newerMinor.error.requestedSurface, { major: 1, minor: 9 });
  assert.deepEqual(newerMinor.error.declaredSurface, { major: 1, minor: 2 });
  assert.ok(newerMinor.error.message.includes("never auto-coerced"));
});

test("capability mediation refuses missing descriptor or request capabilities", async () => {
  const fabric = harness();
  const refused = failureOf(
    await fabric.invoke(request({ requiredCapabilities: ["scene.load", "random.generate"] }), []),
  );
  assert.equal(refused.error.code, "tool/capability-refused");
  assert.deepEqual(refused.error.missingCapabilities, ["random.generate", "scene.load"]);
  assert.equal(fabric.executor.dispatched.length, 0);
});

test("descriptor capabilities and request capabilities union against the grant", async () => {
  const fabric = harness();
  const granted = await fabric.invoke(
    request({ requiredCapabilities: ["extra.capability"] }),
    ["extra.capability", "random.generate"],
  );
  assert.equal(granted.outcome, "ok");
});

test("input shape violations are typed invalid-input with issues", async () => {
  const fabric = harness();
  const invalid = failureOf(await fabric.invoke(request({ input: { count: "two" } })));
  assert.equal(invalid.error.code, "tool/invalid-input");
  assert.equal(invalid.error.issues?.[0]?.path, "count");
  const unknownShape = failureOf(await fabric.invoke(request({ input: { sides: 6 } })));
  assert.equal(unknownShape.error.code, "tool/invalid-input");
});

test("inline bytes in the input are refused at a deterministic path (E7)", async () => {
  const fabric = harness();
  const failure = failureOf(
    await fabric.invoke(request({ input: { count: 2, payload: new Uint8Array([1]) } })),
  );
  assert.equal(failure.error.code, "tool/invalid-input");
  assert.equal(failure.error.issues?.[0]?.path, "value.payload");
  assert.ok(failure.error.issues?.[0]?.message.includes("content-addressed"));
});

test("referenced input artifacts must resolve in the exchange", async () => {
  const fabric = harness();
  const ref = fabric.exchange.put(new Uint8Array([7, 7, 7]));
  assert.equal(okOf(await fabric.invoke(request({ input: { count: 2, asset: ref } }))).outcome, "ok");

  const missing = failureOf(
    await fabric.invoke(request({ input: { count: 2, asset: { kind: "artifact-ref", digest: "c".repeat(64), bytes: 3 } } })),
  );
  assert.equal(missing.error.code, "tool/invalid-input");
  assert.ok(missing.error.issues?.[0]?.message.includes("not found"));
});

test("an already-expired deadline is a deterministic timeout before dispatch", async () => {
  const fabric = harness();
  const timedOut = timeoutOf(await fabric.invoke(request({ deadline: { atEpochMs: 500 } })));
  assert.deepEqual(timedOut.deadline, { atEpochMs: 500 });
  assert.equal(fabric.executor.dispatched.length, 0);
});

test("the descriptor default timeout derives the deadline from the clock", async () => {
  const fabric = harness();
  fabric.clock.setTo(1_000_000);
  assert.equal(okOf(await fabric.invoke(request({ input: { count: 2 } }))).outcome, "ok");
  assert.equal(fabric.executor.dispatched[0]?.deadline?.atEpochMs, 1_005_000);
});

test("pre-dispatch cancellation returns cancelled without executing", async () => {
  const fabric = harness();
  let cancelled = false;
  const token = {
    get requested(): boolean {
      return cancelled;
    },
    onCancel: (): (() => void) => () => undefined,
  };
  cancelled = true;
  const outcome = cancelledOf(await fabric.invoke(request({ cancellation: token })));
  assert.deepEqual(outcome.cancellation, { reason: "caller-requested" });
  assert.equal(fabric.executor.dispatched.length, 0);
});

test("executor refusal codes map to unavailable vs execution-failed", async () => {
  const fabric = harness();
  fabric.executor.scriptNextResult({
    outcome: "refused",
    code: "executor/adapter-refused",
    message: "adapter is not ready yet",
    adapterCode: "adapter/not-ready",
  });
  assert.equal(failureOf(await fabric.invoke(request())).error.code, "tool/unavailable");

  fabric.executor.scriptNextResult({ outcome: "refused", code: "executor/adapter-failed", message: "process exited with code 1" });
  const failed = failureOf(await fabric.invoke(request({ callId: "call-2" })));
  assert.equal(failed.error.code, "tool/execution-failed");
  assert.ok(failed.error.message.includes("process exited"));
});

test("executor timeout and cancelled results map through", async () => {
  const fabric = harness();
  fabric.executor.scriptNextResult({ outcome: "timeout", deadline: { atEpochMs: 42 } });
  assert.deepEqual(timeoutOf(await fabric.invoke(request())).deadline, { atEpochMs: 42 });

  fabric.executor.scriptNextResult({ outcome: "cancelled", reason: "fabric-shutdown" });
  assert.deepEqual(cancelledOf(await fabric.invoke(request({ callId: "call-3" }))).cancellation, {
    reason: "fabric-shutdown",
  });
});

test("a result stamped after the deadline is stale: timeout wins (stale-result rule)", async () => {
  const fabric = harness();
  fabric.clock.setTo(1_000);
  fabric.executor.scriptNextResult({ outcome: "executed", output: { echo: 1 }, finishedAt: 9_000 });
  const timedOut = timeoutOf(await fabric.invoke(request({ deadline: { atEpochMs: 5_000 } })));
  assert.deepEqual(timedOut.deadline, { atEpochMs: 5_000 });
});

test("executor throwing is converted to a typed execution failure", async () => {
  const registry = createToolFabricRegistry();
  const adapter = createFakeAdapter({ adapterId: "fabric.primary", offeredCapabilities: ["tool.dice"] });
  adapter.markReady();
  registry.register({ descriptor, adapter, dispatchCapability: "tool.dice" });
  const shapes = createInMemoryShapeCatalog();
  shapes.register(INPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  shapes.register(OUTPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  const throwingExecutor = {
    execute: (): Promise<never> => {
      throw new Error("boom");
    },
  };
  const pipeline = createInvocationPipeline({
    registry,
    clock: createInMemoryClock(1),
    executor: throwingExecutor,
    shapeCatalog: shapes,
    artifactExchange: createInMemoryArtifactExchange(),
    grantedCapabilities: ["random.generate"],
  });
  const failure = failureOf(await pipeline.invoke(request()));
  assert.equal(failure.error.code, "tool/execution-failed");
  assert.ok(failure.error.message.includes("executor threw"));
});

test("output guards: inline bytes, client claims, missing artifacts", async () => {
  const fabric = harness();

  fabric.executor.scriptNextResult({ outcome: "executed", output: { blob: new Uint8Array([1]) }, finishedAt: 1_000 });
  const inline = failureOf(await fabric.invoke(request()));
  assert.equal(inline.error.code, "tool/execution-failed");
  assert.ok(inline.error.message.includes("inline binary"));

  fabric.executor.scriptNextResult({
    outcome: "executed",
    output: { clientClaimed: true, claimedOutcome: "ok" },
    finishedAt: 1_000,
  });
  const claim = failureOf(await fabric.invoke(request({ callId: "c-claim" })));
  assert.equal(claim.error.code, "tool/execution-failed");
  assert.ok(claim.error.message.includes("client-claimed"));

  fabric.executor.scriptNextResult({
    outcome: "executed",
    output: { asset: { kind: "artifact-ref", digest: "d".repeat(64), bytes: 1 } },
    finishedAt: 1_000,
  });
  const missing = failureOf(await fabric.invoke(request({ callId: "c-missing" })));
  assert.equal(missing.error.code, "tool/execution-failed");
  assert.ok(missing.error.message.includes("artifact"));
});

test("output shape violations are typed execution failures with issues", async () => {
  const registry = createToolFabricRegistry();
  const adapter = createFakeAdapter({ adapterId: "fabric.primary", offeredCapabilities: ["tool.dice"] });
  adapter.markReady();
  registry.register({ descriptor, adapter, dispatchCapability: "tool.dice" });
  const shapes = createInMemoryShapeCatalog();
  shapes.register(INPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  shapes.register(OUTPUT_SHAPE as { shapeId: string; revision: number }, () => [
    { path: "rolls", message: "rolls must be an array" },
  ]);
  const pipeline = createInvocationPipeline({
    registry,
    clock: createInMemoryClock(1),
    executor: createFakeExecutor(() => 1),
    shapeCatalog: shapes,
    artifactExchange: createInMemoryArtifactExchange(),
    grantedCapabilities: ["random.generate"],
  });
  const failure = failureOf(await pipeline.invoke(request()));
  assert.equal(failure.error.code, "tool/execution-failed");
  assert.equal(failure.error.issues?.[0]?.path, "rolls");
});
