/**
 * THE WORKER DOOR TESTS (PL-044) — the E10 idempotency/terminal-state
 * doors, the E8 typed door refusals (verbatim codes, refusals mutate
 * nothing), R20 tenancy and the journal lifecycle order. The E6 crash
 * matrix lives in worker.test.ts; the restore/tamper layers in
 * worker-restore.test.ts.
 *
 * Same discipline: injected clock, in-memory store, counting executor;
 * no real timers, no IO (E9/E11).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import { DurableWorkerRuntime } from "./worker.ts";
import type { OpsWorkerCaller } from "./worker-ports.ts";
import { verifyWorkJournal } from "./work-journal.ts";
import { opsEffectKeyOf } from "./digest.ts";
import { createCountingEffects, createFixedClock, createMemoryWorkerStore } from "./fixtures.ts";

const TENANT = asTenantId("tenant-ops")!;
const SUBJECT = asSubjectId("subject-ops")!;
const FOREIGN_TENANT = asTenantId("tenant-foreign")!;

function callerOf(): OpsWorkerCaller {
  return { tenant: TENANT, subject: SUBJECT, workerId: "worker-1" };
}

/** Enqueues `count` deterministic work items; returns their work ids. */
function enqueueItems(worker: DurableWorkerRuntime, count: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const enqueued = worker.enqueue(callerOf(), { kind: "demo-work", effectKind: "demo-effect", payload: { n: index } });
    assert.ok(enqueued.ok, enqueued.ok ? "" : enqueued.detail);
    assert.equal(enqueued.duplicate, false);
    ids.push(enqueued.work.workId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// E10 — idempotent duplicates grow nothing; terminals are immutable
// ---------------------------------------------------------------------------

test("E10: re-enqueue of the same content resumes the SAME work (duplicate receipt, journal grows nothing)", () => {
  const store = createMemoryWorkerStore();
  const worker = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store, effects: createCountingEffects() } });
  const first = worker.enqueue(callerOf(), { kind: "demo-work", effectKind: "demo-effect", payload: { n: 0 } });
  assert.ok(first.ok && !first.duplicate);
  const journalLength = worker.journalOf().length;
  const again = worker.enqueue(callerOf(), { kind: "demo-work", effectKind: "demo-effect", payload: { n: 0 } });
  assert.ok(again.ok && again.duplicate);
  assert.equal(again.ok ? again.work.workId : "", first.ok ? first.work.workId : "");
  assert.equal(worker.journalOf().length, journalLength);
});

test("E10: a completed item's completion is a duplicate receipt, and re-driving never re-effects", () => {
  const counting = createCountingEffects();
  const worker = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store: createMemoryWorkerStore(), effects: counting } });
  const ids = enqueueItems(worker, 1);
  const drive = worker.driveQueue(callerOf());
  assert.ok(drive.ok && drive.processed === 1);
  const completed = worker.complete(callerOf(), ids[0]!);
  assert.ok(completed.ok && completed.duplicate, "terminal completion repeats as a duplicate receipt");
  const failed = worker.fail(callerOf(), ids[0]!, { code: "late", detail: "too late" });
  assert.ok(!failed.ok && failed.code === "already-terminal");
  assert.equal(counting.realInvocations, 1);
});

test("E6/E10: a refused effect fails the item terminally with the executor's code verbatim; a duplicate fail is a receipt", () => {
  const counting = createCountingEffects();
  const worker = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store: createMemoryWorkerStore(), effects: counting } });
  const enqueued = worker.enqueue(callerOf(), { kind: "flaky", effectKind: "flaky-effect", payload: { a: 1 } });
  assert.ok(enqueued.ok);
  const work = enqueued.ok ? enqueued.work : undefined;
  assert.ok(work !== undefined);
  counting.refusedKeys([opsEffectKeyOf({ workId: work.workId, effectKind: work.effectKind, payloadDigest: work.payloadDigest })]);
  const drive = worker.driveQueue(callerOf());
  assert.ok(drive.ok && drive.failed === 1 && drive.processed === 0);
  const stored = worker.readWork(callerOf(), work.workId);
  assert.ok(stored.ok && stored.work.state === "failed");
  if (stored.ok) assert.equal(stored.work.failure?.code, "executor-refused");
  const refusedEntries = worker.journalOf().filter((entry) => entry.kind === "effect-refused");
  assert.equal(refusedEntries.length, 1);
  const failed = worker.fail(callerOf(), work.workId, { code: "again", detail: "again" });
  assert.ok(failed.ok && failed.duplicate);
});

// ---------------------------------------------------------------------------
// E8 — typed refusals (verbatim codes; refusals mutate nothing)
// ---------------------------------------------------------------------------

test("E8: enqueue refusals are typed and mutate nothing", () => {
  const worker = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store: createMemoryWorkerStore(), effects: createCountingEffects() } });
  const emptyKind = worker.enqueue(callerOf(), { kind: "", effectKind: "e", payload: {} });
  assert.ok(!emptyKind.ok && emptyKind.code === "invalid-work");
  const badPayload = worker.enqueue(callerOf(), { kind: "k", effectKind: "e", payload: { fn: () => 1 } });
  assert.ok(!badPayload.ok && badPayload.code === "invalid-work");
  const unknown = worker.readWork(callerOf(), "ops-work-nope");
  assert.ok(!unknown.ok && unknown.code === "unknown-work");
});

test("R20/E8: cross-tenant doors are typed refusals; refusals mutate nothing", () => {
  const worker = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store: createMemoryWorkerStore(), effects: createCountingEffects() } });
  const ids = enqueueItems(worker, 1);
  const foreignCaller = { tenant: FOREIGN_TENANT, subject: asSubjectId("foreign-subject")!, workerId: "worker-foreign" };
  const read = worker.readWork(foreignCaller, ids[0]!);
  assert.ok(!read.ok && read.code === "cross-tenant");
  const lease = worker.leaseNext(foreignCaller);
  assert.ok(!lease.ok && lease.code === "queue-empty", "a foreign tenant's own queue is empty (its items are invisible, R20)");
  const heartbeat = worker.heartbeat(foreignCaller, ids[0]!);
  assert.ok(!heartbeat.ok && heartbeat.code === "cross-tenant");
  const completion = worker.complete(foreignCaller, ids[0]!);
  assert.ok(!completion.ok && completion.code === "cross-tenant");
  assert.equal(worker.listWork(foreignCaller).length, 0);
  assert.equal(worker.listWork(callerOf()).length, 1);
});

test("E8: lease refusals — heartbeat on unleased work, a foreign lease-holder, and an expired lease", () => {
  const clock = createFixedClock(1_000);
  const worker = new DurableWorkerRuntime({ ports: { clock, store: createMemoryWorkerStore(), effects: createCountingEffects() } });
  const ids = enqueueItems(worker, 1);
  const unleased = worker.heartbeat(callerOf(), ids[0]!);
  assert.ok(!unleased.ok && unleased.code === "not-leased");
  const lease = worker.leaseNext(callerOf());
  assert.ok(lease.ok);
  const holder = worker.heartbeat({ tenant: TENANT, subject: SUBJECT, workerId: "worker-other" }, ids[0]!);
  assert.ok(!holder.ok && holder.code === "lease-holder");
  const renewed = worker.heartbeat(callerOf(), ids[0]!);
  assert.ok(renewed.ok && renewed.lease.heartbeats === 1);
  clock.set(1_000 + 61_000);
  const late = worker.complete(callerOf(), ids[0]!);
  assert.ok(!late.ok && late.code === "lease-expired");
  const stale = worker.heartbeat(callerOf(), ids[0]!);
  assert.ok(!stale.ok && stale.code === "lease-expired");
});

// ---------------------------------------------------------------------------
// E10/E9 — journal verification + freshness (the liveness evidence)
// ---------------------------------------------------------------------------

test("E10: the journal verifies and carries the full lifecycle in admission order", () => {
  const counting = createCountingEffects();
  const worker = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store: createMemoryWorkerStore(), effects: counting } });
  enqueueItems(worker, 2);
  const drive = worker.driveQueue(callerOf());
  assert.ok(drive.ok);
  const journal = worker.journalOf();
  const kinds = journal.map((entry) => entry.kind);
  assert.deepEqual(kinds, [
    "enqueued",
    "enqueued",
    "leased",
    "effect-intended",
    "effect-performed",
    "completed",
    "leased",
    "effect-intended",
    "effect-performed",
    "completed",
  ]);
  const verified = verifyWorkJournal(journal);
  assert.ok(verified.ok && verified.length === journal.length);
  const freshness = worker.freshness();
  assert.equal(freshness.entries, journal.length);
  assert.equal(freshness.lastEntryAt, 1_000);
});
