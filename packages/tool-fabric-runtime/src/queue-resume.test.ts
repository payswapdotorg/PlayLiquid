/**
 * Module role: tests for the queue store/restore path — persistence on
 * every transition, restore of terminal jobs (no re-execution), requeue of
 * running jobs, ledger rehydration from stored records, and atomic
 * rejection of invalid/duplicate restores.
 *
 * Implements: PL-019 E6 resumability coverage.
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
import { createCollectingJobEventSink, createInMemoryJobStore } from "./in-memory-jobs.ts";

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
  store: ReturnType<typeof createInMemoryJobStore>;
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
  const store = createInMemoryJobStore();
  const queue = createToolJobQueue({
    pipeline,
    clock,
    eventSink: createCollectingJobEventSink(),
    jobStore: store,
  });
  return { executor, clock, store, queue };
}

function call(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

test("the store receives a record on every transition, terminal ones carry the outcome", async () => {
  const fabric = harness();
  await fabric.queue.enqueue({ jobId: "job-1", call: call() });
  await fabric.queue.pump();
  const records = fabric.store.records;
  assert.equal(records.length, 3);
  assert.equal(records[0]?.job.status, "queued");
  assert.equal(records[1]?.job.status, "running");
  assert.equal(records[2]?.job.status, "succeeded");
  assert.equal(records[2]?.outcome?.outcome, "ok");
});

test("restore keeps terminal jobs terminal: pump never re-executes them", async () => {
  const first = harness();
  await first.queue.enqueue({ jobId: "job-1", call: call() });
  await first.queue.pump();
  const executedAfterFirst = first.executor.dispatched.length;
  assert.equal(executedAfterFirst, 1);

  const second = harness();
  const restore = await second.queue.restore(await first.store.loadAll());
  if (restore.outcome !== "ok") {
    assert.fail(`expected ok: ${JSON.stringify(restore)}`);
  }
  assert.equal(restore.restored, 1);
  assert.equal(restore.requeued, 0);
  await second.queue.pump();
  assert.equal(second.executor.dispatched.length, 0);
  const status = second.queue.status("job-1");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.status, "succeeded");
});

test("a completed idempotency key from restored records replays instead of re-executing", async () => {
  const first = harness();
  await first.queue.enqueue({ jobId: "job-1", call: call() });
  await first.queue.pump();

  const second = harness();
  await second.queue.restore(await first.store.loadAll());
  const admission = await second.queue.enqueue({ jobId: "job-2", call: call({ callId: "call-2" }) });
  if (admission.outcome !== "replayed") {
    assert.fail(`expected replay, got: ${JSON.stringify(admission)}`);
  }
  assert.equal(admission.callOutcome.outcome, "ok");
  assert.equal(second.executor.dispatched.length, 0);
});

test("restoring a snapshot taken mid-run requeues the running job (at-least-once)", async () => {
  // A snapshot persisted after "started": status running, attempts 1.
  const runningRecord = {
    kind: "job-store-record",
    job: {
      kind: "tool-job-snapshot",
      jobId: "job-9",
      callId: "call-9",
      tool: { namespace: "playliquid", name: "dice-roll" },
      surfaceVersion: { major: 1, minor: 0 },
      input: { count: 9 },
      requiredCapabilities: [],
      idempotencyKey: "key-9",
      status: "running",
      attempts: 1,
      maxAttempts: 2,
      cancellationRequested: false,
      queuedAt: 5,
      sequence: 2,
    },
  };
  const fresh = harness();
  const restore = await fresh.queue.restore([runningRecord]);
  if (restore.outcome !== "ok") {
    assert.fail(`expected ok: ${JSON.stringify(restore)}`);
  }
  assert.equal(restore.requeued, 1);
  const status = fresh.queue.status("job-9");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.status, "queued");
  assert.equal(status.job.attempts, 1);
  await fresh.queue.pump();
  const finished = fresh.queue.status("job-9");
  if (finished.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(finished.job.status, "succeeded");
  assert.equal(fresh.executor.dispatched.length, 1);
});

test("restored jobs continue their per-job event sequence", async () => {
  const record = {
    kind: "job-store-record",
    job: {
      kind: "tool-job-snapshot",
      jobId: "job-1",
      callId: "call-1",
      tool: { namespace: "playliquid", name: "dice-roll" },
      surfaceVersion: { major: 1, minor: 0 },
      input: { count: 2 },
      requiredCapabilities: [],
      status: "queued",
      attempts: 0,
      maxAttempts: 1,
      cancellationRequested: false,
      queuedAt: 5,
      sequence: 4,
    },
  };
  const events = createCollectingJobEventSink();
  const registry = createToolFabricRegistry();
  const adapter = createFakeAdapter({ adapterId: "fabric.primary", offeredCapabilities: ["tool.dice"] });
  adapter.markReady();
  registry.register({ descriptor, adapter, dispatchCapability: "tool.dice" });
  const clock = createInMemoryClock(1_000);
  const shapes = createInMemoryShapeCatalog();
  shapes.register(INPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  shapes.register(OUTPUT_SHAPE as { shapeId: string; revision: number }, () => []);
  const pipeline = createInvocationPipeline({
    registry,
    clock,
    executor: createFakeExecutor(() => clock.now()),
    shapeCatalog: shapes,
    artifactExchange: createInMemoryArtifactExchange(),
  });
  const queue = createToolJobQueue({ pipeline, clock, eventSink: events });
  await queue.restore([record]);
  await queue.pump();
  const types = events.forJob("job-1").map((event) => [event.type, event.sequence]);
  assert.deepEqual(types, [["started", 5], ["succeeded", 6]]);
});

test("restore is atomic: invalid records or clashes refuse; a duplicated history log reduces", async () => {
  const fabric = harness();
  await fabric.queue.enqueue({ jobId: "job-1", call: call() });
  await fabric.queue.pump();
  const records = await fabric.store.loadAll();
  assert.equal(records.length, 3);

  // Restoring into a queue that already knows the job is a typed clash.
  const clash = await fabric.queue.restore(records);
  if (clash.outcome !== "rejected") {
    assert.fail("expected rejection for clashing job ids");
  }
  assert.equal(clash.rejections[0]?.code, "restore/job-already-known");

  const fresh = harness();
  const invalid = await fresh.queue.restore([{ kind: "job-store-record", job: { status: "bogus" } }]);
  if (invalid.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(invalid.rejections.some((item) => item.code.startsWith("restore/record")), true);
  assert.equal(fresh.queue.snapshot().length, 0);

  // The store is a transition log: a duplicated history is idempotent —
  // the LAST record per job is the authoritative state.
  const reduced = await fresh.queue.restore([...records, ...records]);
  if (reduced.outcome !== "ok") {
    assert.fail(`expected ok, got: ${JSON.stringify(reduced)}`);
  }
  assert.equal(reduced.restored, 1);
  const status = fresh.queue.status("job-1");
  if (status.outcome !== "ok") {
    assert.fail("expected job");
  }
  assert.equal(status.job.status, "succeeded");
});
