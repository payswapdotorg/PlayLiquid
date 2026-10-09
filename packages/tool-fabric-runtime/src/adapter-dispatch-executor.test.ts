/**
 * Module role: tests for the canonical adapter-dispatch executor —
 * envelope correctness, ok/refused/failed mapping with authority stamps,
 * and cancellation racing.
 *
 * Implements: PL-019 executor seam behavior over the PL-005 exchange.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createFakeAdapter,
  failedCommandResult,
} from "@playliquid/engine-adapter-contract";
import { createAdapterDispatchExecutor } from "./adapters/adapter-dispatch-executor.ts";
import type { ExecutorDispatch } from "./domain/ports.ts";
import type { ToolRegistration } from "./domain/registry.ts";

const INPUT_SHAPE = { shapeId: "playliquid.shape/dice-input", revision: 1 };

function registration(): { registration: ToolRegistration; adapter: ReturnType<typeof createFakeAdapter> } {
  const adapter = createFakeAdapter({ adapterId: "fabric.primary", offeredCapabilities: ["tool.dice"], clock: () => 7_000 });
  adapter.markReady();
  const registration: ToolRegistration = Object.freeze({
    kind: "tool-registration",
    descriptor: {
      identity: { namespace: "playliquid", name: "dice-roll" },
      surfaceVersion: { major: 1, minor: 0 },
      title: "Dice roll",
      description: "Rolls dice.",
      inputShape: INPUT_SHAPE,
      outputShape: { shapeId: "playliquid.shape/dice-output", revision: 1 },
      capabilities: [],
    },
    adapter,
    dispatchCapability: "tool.dice",
  });
  return { registration, adapter };
}

function dispatch(overrides: Partial<ExecutorDispatch> = {}): ExecutorDispatch {
  const { registration: reg } = registration();
  return {
    kind: "executor-dispatch",
    callId: "call-1",
    registration: reg,
    input: { count: 2 },
    ...overrides,
  };
}

test("an ok adapter result maps to executed with the authority's finishedAt", async () => {
  const { registration: reg, adapter } = registration();
  const executor = createAdapterDispatchExecutor();
  const result = await executor.execute(dispatch({ registration: reg }));
  if (result.outcome !== "executed") {
    assert.fail(`expected executed, got ${result.outcome}`);
  }
  assert.equal(result.finishedAt, 7_000);
  assert.deepEqual(result.output, { commandId: "call-1", capability: "tool.dice" });
  assert.equal(adapter.dispatched.length, 1);
  assert.equal(adapter.dispatched[0]?.commandId, "call-1");
  assert.equal(adapter.dispatched[0]?.capability, "tool.dice");
  assert.equal(adapter.dispatched[0]?.deadline, undefined);
});

test("the dispatch envelope carries the payload, deadline and dispatch capability", async () => {
  const { registration: reg, adapter } = registration();
  const executor = createAdapterDispatchExecutor();
  await executor.execute(
    dispatch({ registration: reg, input: { count: 5 }, deadline: { atEpochMs: 9_000 } }),
  );
  const command = adapter.dispatched[0];
  assert.deepEqual(command?.payload, { count: 5 });
  assert.deepEqual(command?.deadline, { atEpochMs: 9_000 });
});

test("adapter refusals map to executor/adapter-refused with the adapter code passthrough", async () => {
  const { registration: reg, adapter } = registration();
  adapter.close();
  const executor = createAdapterDispatchExecutor();
  const closed = await executor.execute(dispatch({ registration: reg }));
  if (closed.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(closed.code, "executor/adapter-refused");
  assert.equal(closed.adapterCode, "adapter/closed");

  const notReadyAdapter = createFakeAdapter({ adapterId: "fabric.secondary", offeredCapabilities: ["tool.dice"] });
  const notReadyReg: ToolRegistration = Object.freeze({
    ...reg,
    adapter: notReadyAdapter,
  });
  const notReady = await executor.execute(dispatch({ registration: notReadyReg }));
  if (notReady.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(notReady.adapterCode, "adapter/not-ready");
});

test("scripted adapter failures map to executor/adapter-failed", async () => {
  const { registration: reg, adapter } = registration();
  adapter.scriptNextResult(
    failedCommandResult({ kind: "adapter-authority", adapterId: "fabric.primary", finishedAt: 7_000 }, {
      code: "engine/crash",
      message: "the provider crashed",
    }),
  );
  const executor = createAdapterDispatchExecutor();
  const result = await executor.execute(dispatch({ registration: reg }));
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.code, "executor/adapter-failed");
  assert.equal(result.adapterCode, "engine/crash");
  assert.ok(result.message.includes("the provider crashed"));
});

test("pre-requested cancellation returns cancelled without dispatching", async () => {
  const { registration: reg, adapter } = registration();
  const executor = createAdapterDispatchExecutor();
  const token = { requested: true, onCancel: (): (() => void) => () => undefined };
  const result = await executor.execute(dispatch({ registration: reg, cancellation: token }));
  assert.deepEqual(result, { outcome: "cancelled", reason: "caller-requested" });
  assert.equal(adapter.dispatched.length, 0);
});

test("cancellation during flight resolves cancelled; the orphan dispatch is discarded", async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  // An adapter whose dispatch hangs until released: only the cancellation
  // race can settle the executor result.
  const hangingAdapter = createFakeAdapter({ adapterId: "fabric.hanging", offeredCapabilities: ["tool.dice"] });
  hangingAdapter.markReady();
  const originalDispatch = hangingAdapter.dispatch.bind(hangingAdapter);
  const adapter = Object.freeze({
    ...hangingAdapter,
    dispatch: async (command: Parameters<typeof originalDispatch>[0]) => {
      await pending;
      return await originalDispatch(command);
    },
  });
  const reg: ToolRegistration = Object.freeze({ ...dispatch().registration, adapter });
  const executor = createAdapterDispatchExecutor();

  let fired = false;
  const listeners: (() => void)[] = [];
  const token = {
    get requested(): boolean {
      return fired;
    },
    onCancel(listener: () => void): () => void {
      listeners.push(listener);
      return () => undefined;
    },
  };
  const execution = executor.execute(dispatch({ registration: reg, cancellation: token }));
  fired = true;
  const snapshot = [...listeners];
  for (const listener of snapshot) {
    listener();
  }
  const result = await execution;
  assert.deepEqual(result, { outcome: "cancelled", reason: "caller-requested" });
  release?.();
});
