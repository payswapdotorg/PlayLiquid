/**
 * Module role: tests for the node process adapter — REAL child processes
 * are spawned (node -e runners). This is genuine runtime evidence for the
 * executor seam, not a mock: JSON round-trips, non-zero exits, non-JSON
 * stdout, deadline kills, cancellation kills and the output-byte resource
 * cap are all exercised against actual processes.
 *
 * Implements: PL-019 node process adapter evidence; E11 truthful process
 * failure reporting.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakeAdapter } from "@playliquid/engine-adapter-contract";
import { createNodeProcessExecutor } from "./adapters/node-process-executor.ts";
import type { ExecutorDispatch } from "./domain/ports.ts";
import type { ToolRegistration } from "./domain/registry.ts";

const SLOW_RUNNER = "setTimeout(()=>{process.stdout.write(JSON.stringify({done:true}))},5000);";
const BAD_JSON_RUNNER = "process.stdout.write('not json at all');";
const FAILING_RUNNER = "process.stderr.write('boom');process.exit(3);";
const CHATTY_RUNNER = "process.stdout.write('x'.repeat(100000));";

function registration(): ToolRegistration {
  const adapter = createFakeAdapter({ adapterId: "fabric.process", offeredCapabilities: ["tool.process"] });
  adapter.markReady();
  return Object.freeze({
    kind: "tool-registration",
    descriptor: {
      identity: { namespace: "playliquid", name: "process-tool" },
      surfaceVersion: { major: 1, minor: 0 },
      title: "Process tool",
      description: "Generic CLI/process tool.",
      inputShape: { shapeId: "playliquid.shape/any", revision: 1 },
      outputShape: { shapeId: "playliquid.shape/any", revision: 1 },
      capabilities: [],
    },
    adapter,
    dispatchCapability: "tool.process",
  });
}

function dispatch(overrides: Partial<ExecutorDispatch> = {}): ExecutorDispatch {
  return {
    kind: "executor-dispatch",
    callId: "call-1",
    registration: registration(),
    input: { count: 2 },
    ...overrides,
  };
}

test("the default echo runner round-trips JSON through a real process", async () => {
  const executor = createNodeProcessExecutor();
  const result = await executor.execute(dispatch({ input: { count: 2, sides: 6 } }));
  if (result.outcome !== "executed") {
    assert.fail(`expected executed, got ${JSON.stringify(result)}`);
  }
  assert.deepEqual(result.output, { echo: { count: 2, sides: 6 } });
  assert.equal(executor.spawnedCount, 1);
});

test("non-JSON stdout is a typed adapter failure", async () => {
  const executor = createNodeProcessExecutor({ args: ["-e", BAD_JSON_RUNNER] });
  const result = await executor.execute(dispatch());
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.code, "executor/adapter-failed");
  assert.ok(result.message.includes("not valid JSON"));
});

test("a non-zero exit code is a typed adapter failure with stderr detail", async () => {
  const executor = createNodeProcessExecutor({ args: ["-e", FAILING_RUNNER] });
  const result = await executor.execute(dispatch());
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.code, "executor/adapter-failed");
  assert.ok(result.message.includes("code 3"));
  assert.ok(result.message.includes("boom"));
});

test("an already-expired deadline times out without spawning", async () => {
  const executor = createNodeProcessExecutor();
  const result = await executor.execute(dispatch({ deadline: { atEpochMs: 1 } }));
  assert.deepEqual(result, { outcome: "timeout", deadline: { atEpochMs: 1 } });
  assert.equal(executor.spawnedCount, 0);
});

test("a deadline during a slow script kills the process and times out", async () => {
  const executor = createNodeProcessExecutor({ args: ["-e", SLOW_RUNNER] });
  const deadline = { atEpochMs: Date.now() + 150 };
  const startedAt = Date.now();
  const result = await executor.execute(dispatch({ deadline }));
  if (result.outcome !== "timeout") {
    assert.fail(`expected timeout, got ${JSON.stringify(result)}`);
  }
  assert.deepEqual(result.deadline, deadline);
  assert.ok(Date.now() - startedAt < 4_000, "the process must be killed, not awaited");
});

test("cancellation during a slow script kills the process and cancels", async () => {
  const executor = createNodeProcessExecutor({ args: ["-e", SLOW_RUNNER] });
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
  const execution = executor.execute(dispatch({ cancellation: token }));
  fired = true;
  const snapshot = [...listeners];
  for (const listener of snapshot) {
    listener();
  }
  const result = await execution;
  assert.deepEqual(result, { outcome: "cancelled", reason: "caller-requested" });
});

test("stdout beyond the resource cap is a typed refusal (process killed)", async () => {
  const executor = createNodeProcessExecutor({ args: ["-e", CHATTY_RUNNER], maxOutputBytes: 1024 });
  const result = await executor.execute(dispatch());
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.code, "executor/adapter-failed");
  assert.ok(result.message.includes("resource cap"));
});

test("pre-requested cancellation returns cancelled without spawning", async () => {
  const executor = createNodeProcessExecutor();
  const token = { requested: true, onCancel: (): (() => void) => () => undefined };
  const result = await executor.execute(dispatch({ cancellation: token }));
  assert.deepEqual(result, { outcome: "cancelled", reason: "caller-requested" });
  assert.equal(executor.spawnedCount, 0);
});

test("a missing command is a typed spawn failure, never a throw", async () => {
  const executor = createNodeProcessExecutor({ command: "/nonexistent/definitely-not-here" });
  const result = await executor.execute(dispatch());
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.code, "executor/adapter-failed");
  assert.ok(result.message.includes("spawn") || result.message.includes("process error"));
});
