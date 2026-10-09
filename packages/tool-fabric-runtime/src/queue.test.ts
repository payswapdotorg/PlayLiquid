/**
 * Module role: tests for the tool job queue — command admission, event
 * order and sequences, pump ordering, retry bounds, and cancellation of
 * queued/running jobs. Store/restore coverage lives in
 * queue-resume.test.ts.
 *
 * Implements: PL-019 queue behavior coverage (E6, worker contract).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakeAdapter } from "@playliquid/engine-adapter-contract";
import { createToolFabricRegistry } from "./domain/registry.ts";
import { createInvocationPipeline } from "./app/pipeline.ts";
import { createToolJobQueue } from "./app/queue.ts";
import { createFakeExecutor } from "./fake-executor.ts";
import { createInMemoryClock } from "./in-memory-clock.ts";
import { createInMemoryShapeCatalog } from "./in-memory-shape-catalog.ts";
import { createInMemoryArtifactExchange } from "./in-memory-artifact-exchange.ts";
import { createCollectingJobEventSink } from "./in-memory-jobs.ts";

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
  events: ReturnType<typeof createCollectingJobEventSink>;
  queue: ReturnType<typeof createToolJobQueue>;
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
  const events = createCollectingJobEventSink();
  const queue = createToolJobQueue({ pipeline, clock, eventSink: events });
  return { executor, clock, events, queue };
}

function call(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

test("admission validates the job id and the embedded call", async () => {
  const fabric = harness();
  const invalid = await fabric.queue.enqueue({ jobId: "", call: call() });
  if (invalid.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(invalid.rejections[0]?.code, "job/not-admitted-invalid");
  const badCall = await fabric.queue.enqueue({ jobId: "job-1", call: { kind: "tool-call-request" } });
  if (badCall.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(badCall.rejections[0]?.code, "job/not-admitted-invalid");
});

test("a duplicate job id is a typed duplicate, not a second job", async () => {
  const fabric = harness();
  const first = await fabric.queue.enqueue({ jobId: "job-1", call: call() });
  assert.equal(first.outcome, "admitted");
  const second = await fabric.queue.enqueue({ jobId: "job-1", call: call({ callId: "call-2" }) });
  if (second.outcome !== "duplicate") {
    assert.fail("expected duplicate");
  }
  assert.equal(second.status, "queued");
});

test("pump executes jobs in admission order with the binding event sequence", async () => {
  const fabric = harness();
  await fabric.queue.enqueue({ jobId: "job-1", call: call() });
  await fabric.queue.enqueue({ jobId: "job-2", call: call({ callId: "call-2" }) });
  await fabric.queue.pump();

  const first = fabric.events.forJob("job-1");
  assert.deepEqual(first.map((event) => [event.type, event.sequence]), [["admitted", 1], ["started", 2], ["succeeded", 3]]);
  assert.equal(first[0]?.at, 1_000);
  const second = fabric.events.forJob("job-2");
  assert.deepEqual(second.map((event) => [event.type, event.sequence]), [["admitted", 1], ["started", 2], ["succeeded", 3]]);
  assert.equal(fabric.executor.dispatched[0]?.callId, "call-1");
  assert.equal(fabric.executor.dispatched[1]?.callId, "call-2");
  const status = fabric.queue.status("job-1");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.status, "succeeded");
});

test("a failed attempt retries (bounded by maxAttempts) and the next attempt succeeds", async () => {
  const fabric = harness();
  // One scripted failure: consumed by the first dispatch; the retry
  // (second dispatch) gets the fake executor's default ok echo.
  fabric.executor.scriptNextResult({ outcome: "refused", code: "executor/adapter-failed", message: "boom" });
  await fabric.queue.enqueue({ jobId: "job-1", call: call(), maxAttempts: 3 });
  await fabric.queue.pump();

  const events = fabric.events.forJob("job-1");
  assert.deepEqual(
    events.map((event) => event.type),
    ["admitted", "started", "retry-scheduled", "started", "succeeded"],
  );
  const status = fabric.queue.status("job-1");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.attempts, 2);
  assert.equal(status.job.status, "succeeded");
  assert.equal(fabric.executor.dispatched.length, 2);
});

test("a failure with exhausted attempts is terminal failed", async () => {
  const fabric = harness();
  const failure = { outcome: "refused", code: "executor/adapter-failed", message: "boom" } as const;
  fabric.executor.scriptNextResult(failure);
  await fabric.queue.enqueue({ jobId: "job-1", call: call(), maxAttempts: 1 });
  await fabric.queue.pump();
  const status = fabric.queue.status("job-1");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.status, "failed");
  const terminal = fabric.events.forJob("job-1").at(-1);
  assert.equal(terminal?.type, "failed");
  assert.equal(terminal?.outcome?.outcome, "failure");
});

test("timeouts are terminal typed decisions and never retry", async () => {
  const fabric = harness();
  fabric.executor.scriptNextResult({ outcome: "timeout", deadline: { atEpochMs: 5_000 } });
  await fabric.queue.enqueue({ jobId: "job-1", call: call(), maxAttempts: 3 });
  await fabric.queue.pump();
  const status = fabric.queue.status("job-1");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.status, "timed-out");
  assert.equal(status.job.attempts, 1);
  assert.equal(fabric.events.forJob("job-1").at(-1)?.type, "timed-out");
});

test("cancelling a queued job skips execution entirely", async () => {
  const fabric = harness();
  await fabric.queue.enqueue({ jobId: "job-1", call: call() });
  const cancelled = await fabric.queue.cancel("job-1");
  if (cancelled.outcome !== "ok") {
    assert.fail("expected ok");
  }
  assert.equal(cancelled.job.status, "cancelled");
  await fabric.queue.pump();
  assert.equal(fabric.executor.dispatched.length, 0);
  assert.deepEqual(
    fabric.events.forJob("job-1").map((event) => event.type),
    ["admitted", "cancelled"],
  );
});

test("cancelling a running job lands when the executor honors the token", async () => {
  const registry = createToolFabricRegistry();
  const adapter = createFakeAdapter({ adapterId: "fabric.primary", offeredCapabilities: ["tool.dice"] });
  adapter.markReady();
  registry.register({ descriptor, adapter, dispatchCapability: "tool.dice" });
  const clock = createInMemoryClock(1_000);
  const shapes = createInMemoryShapeCatalog();
  shapes.register(INPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  shapes.register(OUTPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  // A deferred executor: resolves ONLY when the cancellation token fires.
  let signalReach: (() => void) | undefined;
  const reached = new Promise<void>((resolve) => {
    signalReach = resolve;
  });
  const deferredExecutor = {
    execute: (dispatch: { cancellation?: { onCancel(listener: () => void): () => void } }): Promise<{ outcome: "cancelled"; reason: "caller-requested" }> =>
      new Promise((resolve) => {
        signalReach?.();
        dispatch.cancellation?.onCancel(() => resolve({ outcome: "cancelled", reason: "caller-requested" }));
      }),
  };
  const pipeline = createInvocationPipeline({
    registry,
    clock,
    executor: deferredExecutor,
    shapeCatalog: shapes,
    artifactExchange: createInMemoryArtifactExchange(),
  });
  const events = createCollectingJobEventSink();
  const queue = createToolJobQueue({ pipeline, clock, eventSink: events });

  const token = {
    requested: false,
    onCancel: (): (() => void) => () => undefined,
  };
  await queue.enqueue({ jobId: "job-1", call: call({ cancellation: token }) });

  const execution = queue.pump();
  await reached; // the executor now holds the queue-wrapped cancellation token
  const cancelled = await queue.cancel("job-1");
  if (cancelled.outcome !== "ok") {
    assert.fail(`expected ok, got: ${JSON.stringify(cancelled)}`);
  }
  await execution;

  const status = queue.status("job-1");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.status, "cancelled");
  assert.equal(status.job.cancellationRequested, true);
  assert.equal(events.forJob("job-1").at(-1)?.type, "cancelled");
});

test("cancel reports unknown jobs and terminal jobs with typed codes", async () => {
  const fabric = harness();
  const unknown = await fabric.queue.cancel("nope");
  if (unknown.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(unknown.code, "job/unknown-job");

  await fabric.queue.enqueue({ jobId: "job-1", call: call() });
  await fabric.queue.pump();
  const terminal = await fabric.queue.cancel("job-1");
  if (terminal.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(terminal.code, "job/already-terminal");
});

test("status is unknown for absent jobs; snapshot lists all jobs", async () => {
  const fabric = harness();
  assert.equal(fabric.queue.status("ghost").outcome, "unknown");
  await fabric.queue.enqueue({ jobId: "job-1", call: call() });
  await fabric.queue.enqueue({ jobId: "job-2", call: call({ callId: "call-2" }) });
  assert.equal(fabric.queue.snapshot().length, 2);
});
