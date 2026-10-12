/**
 * THE DURABLE WORKER RUNTIME TESTS (PL-044) — E6 crash-anywhere
 * resume with exactly-once effects, E8 typed refusals, E9 determinism,
 * E10 append-only journal + immutable terminals, R20 tenancy.
 *
 * The crash model: a fault is injected at one DURABLE point (a store
 * save, or an effects invocation), the throw propagates, and the runtime
 * instance is ABANDONED — an accurate model of process death because
 * every mutation is persisted through the store port before anything
 * else happens, so only the store's durable content matters. The resume
 * is a FRESH runtime over the SAME store + the SAME counting executor
 * (the executor models the durable external side effect: it survives
 * the process death and dedupes by the stable effect key).
 *
 * THE CRASH MATRIX (one row per durable point of the first queue pass;
 * after 3 enqueues the drive saves are: #4 lease, #5 WAL intent, #6
 * effect receipt, #7 completion, #8 next item's lease):
 *
 *   F1  save #3        ON the last enqueue save (item 3 never durable)
 *   F2  save #5        lease durable, WAL intent not yet
 *   F3  attempt #1     WAL intent durable, executor NEVER invoked
 *   F4  invocation #2  item 1 done; item 2's real effect done, receipt lost
 *   F5  save #7        effect receipt durable, completion not yet
 *   F6  save #8        item 1 completed durably, item 2's lease not
 *   F7  save #5 +TTL   expired lease reclaimed by a DIFFERENT worker
 *   F8  save #5 +TTL   expired lease re-claimed by the SAME worker
 *
 * EXACTLY-ONCE PROOF, stated honestly per row (E11): the counting
 * executor must show exactly one REAL invocation per work item, EVER.
 * The KEYED-DUPLICATE path (a re-invocation answered by the executor's
 * idempotent duplicate receipt) is only exercised — and only REQUIRED —
 * by rows whose fault point sits AFTER a real invocation but BEFORE its
 * receipt became durable (F4). Rows whose crash PRECEDES the first
 * invocation (F1/F2/F3/F6/F7/F8) must show ZERO duplicate invocations:
 * the resume performs the effect once, for real. Row F5 proves the
 * complement — a DURABLE receipt means the runtime NEVER re-invokes
 * (the ledger-skip path in the journal).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import { DurableWorkerRuntime } from "./worker.ts";
import type { OpsWorkerCaller } from "./worker-ports.ts";
import { verifyWorkJournal } from "./work-journal.ts";
import type { WorkJournalEntry } from "./work-journal.ts";
import {
  crashAfterRealInvocations,
  crashOnInvocationAttempt,
  crashOnNthSave,
  createCountingEffects,
  createFixedClock,
  createMemoryWorkerStore,
  createSteppingClock,
} from "./fixtures.ts";

const TENANT = asTenantId("tenant-ops")!;
const SUBJECT = asSubjectId("subject-ops")!;
const WORKER = "worker-1";

function callerOf(workerId = WORKER): OpsWorkerCaller {
  return { tenant: TENANT, subject: SUBJECT, workerId };
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

/**
 * ONE crash scenario: enqueue `count` items, drive to completion with a
 * fault injected at `fault` (a store save number, an effects-invocation
 * number, or an invocation-ATTEMPT number), then RESUME on a fresh
 * runtime over the same store and finish the queue. Returns the evidence
 * the rows assert against. The whole doomed phase (enqueue AND drive)
 * runs inside the crash window — the process may die at any durable
 * point, including mid-enqueue (F1).
 */
function crashScenario(options: {
  readonly count: number;
  readonly fault: { readonly save?: number; readonly invocation?: number; readonly attempt?: number };
  readonly resumeWorkerId?: string;
  readonly advanceClockMs?: number;
  readonly reenqueue?: number;
}) {
  const store = createMemoryWorkerStore();
  const counting = createCountingEffects();
  const clock = createFixedClock(10_000);
  const ports = {
    clock,
    store: options.fault.save === undefined ? store : crashOnNthSave(store, options.fault.save),
    effects:
      options.fault.invocation !== undefined
        ? crashAfterRealInvocations(counting, options.fault.invocation)
        : options.fault.attempt !== undefined
          ? crashOnInvocationAttempt(counting, options.fault.attempt)
          : counting,
  };
  const doomed = new DurableWorkerRuntime({ ports, leaseTtlMs: 60_000 });
  const ids: string[] = [];
  let crashed = false;
  try {
    // The doomed phase: the process enqueues, then drives — a fault at
    // any durable point kills it here (the instance is abandoned).
    ids.push(...enqueueItems(doomed, options.count));
    doomed.driveQueue(callerOf());
  } catch {
    crashed = true;
  }
  assert.ok(crashed, `fault at save ${String(options.fault.save)}/invocation ${String(options.fault.invocation)}/attempt ${String(options.fault.attempt)} must crash the doomed runtime`);
  const durableBeforeCrash = store.load()?.journal ?? [];
  // TIME advances while the process is down (the injected clock):
  clock.set(10_000 + (options.advanceClockMs ?? 0));
  // THE RESUME: a fresh process over the SAME durable store + executor.
  const resumed = new DurableWorkerRuntime({ ports: { clock, store, effects: counting }, leaseTtlMs: 60_000 });
  const restored = resumed.restore();
  assert.ok(restored.ok, restored.ok ? "" : restored.detail);
  if (options.reenqueue !== undefined) {
    const requeued = resumed.enqueue(callerOf(), { kind: "demo-work", effectKind: "demo-effect", payload: { n: options.reenqueue } });
    assert.ok(requeued.ok);
  }
  const drive = resumed.driveQueue(callerOf(options.resumeWorkerId));
  assert.ok(drive.ok, drive.ok ? "" : drive.detail);
  return { resumed, counting, ids, durableBeforeCrash, drive, store };
}

/**
 * The universal exactly-once + no-loss + append-only assertions.
 * `duplicates` states the row's honest expectation (E11): "any" — the
 * fault sat after a real invocation but before its receipt was durable,
 * so the resume's re-invocation MUST be answered by the executor's keyed
 * duplicate; "none" — the crash preceded the first invocation (or the
 * receipt is already durable), so a duplicate invocation would be a BUG
 * (a lost or duplicated real effect), never evidence.
 */
function assertExactlyOnceResumed(
  evidence: ReturnType<typeof crashScenario>,
  expectedCount: number,
  duplicates: "none" | "any",
): void {
  const works = evidence.resumed.listWork(callerOf());
  assert.equal(works.length, expectedCount);
  for (const work of works) {
    assert.equal(work.state, "completed", `work ${work.workId} must be completed after resume`);
  }
  // Exactly-once effects: one REAL invocation per work item, ever.
  assert.equal(evidence.counting.realInvocations, expectedCount);
  assert.equal(new Set(evidence.counting.performedWorkIds).size, expectedCount);
  if (duplicates === "any") {
    assert.ok(evidence.counting.duplicateInvocations > 0, "the crash row must have exercised the executor's keyed-duplicate path");
  } else {
    assert.equal(evidence.counting.duplicateInvocations, 0, "no invocation happened pre-crash (or the receipt is durable) — a duplicate invocation here would be a duplicated effect");
  }
  // No duplicated work: re-driving the finished queue is an honest no-op.
  const again = evidence.resumed.driveQueue(callerOf());
  assert.ok(again.ok);
  assert.equal(again.processed, 0);
  assert.equal(again.remaining, 0);
  assert.equal(evidence.counting.realInvocations, expectedCount);
  // The journal verifies and the pre-crash durable journal is a strict prefix.
  const journal = evidence.resumed.journalOf();
  const verified = verifyWorkJournal(journal);
  assert.ok(verified.ok, verified.ok ? "" : verified.detail);
  assert.ok(journal.length > evidence.durableBeforeCrash.length, "resume must append");
  for (let index = 0; index < evidence.durableBeforeCrash.length; index += 1) {
    const before = evidence.durableBeforeCrash[index];
    const after = journal[index];
    assert.ok(before !== undefined && after !== undefined);
    assert.equal(after.digest, before.digest, `journal entry ${String(index)} must be identical before/after the crash (append-only, E10)`);
  }
}

/** The journal entries of one kind about one work item. */
function entriesOf(evidence: ReturnType<typeof crashScenario>, kind: string, workId: string): readonly WorkJournalEntry[] {
  return evidence.resumed.journalOf().filter((entry) => entry.kind === kind && entry.workId === workId);
}

/**
 * The work id of the row the crash interrupted: the LAST `leased` entry
 * of the durable pre-crash journal (the tie-broken drive order is by
 * workId under one fixed clock instant, so this — not the enqueue
 * order — identifies the item the doomed drive had claimed).
 */
function crashedRowOf(evidence: ReturnType<typeof crashScenario>): string {
  const leased = [...evidence.durableBeforeCrash].reverse().find((entry) => entry.kind === "leased");
  assert.ok(leased !== undefined, "the durable pre-crash journal must show the interrupted lease");
  return leased.workId;
}

// ---------------------------------------------------------------------------
// E9 — determinism (run twice, identical digests + journals)
// ---------------------------------------------------------------------------

test("E9: the whole queue scenario is deterministic — run twice, identical journals and document digests", () => {
  const run = (): { journal: readonly WorkJournalEntry[]; stateDigest: string; effects: string[] } => {
    const store = createMemoryWorkerStore();
    const counting = createCountingEffects();
    const worker = new DurableWorkerRuntime({ ports: { clock: createSteppingClock(5_000), store, effects: counting }, leaseTtlMs: 60_000 });
    enqueueItems(worker, 3);
    const drive = worker.driveQueue(callerOf());
    assert.ok(drive.ok);
    return { journal: worker.journalOf(), stateDigest: worker.document().stateDigest, effects: [...counting.performedKeys] };
  };
  const first = run();
  const second = run();
  assert.deepEqual(first.journal, second.journal);
  assert.equal(first.stateDigest, second.stateDigest);
  assert.deepEqual(first.effects, second.effects);
});

// ---------------------------------------------------------------------------
// E6/E10 — the crash matrix (fault point → resumed state → exactly-once)
// ---------------------------------------------------------------------------

test("E6 row F1: crash on the LAST enqueue save — resume re-enqueues idempotently, no lost work", () => {
  // Save #3 is item 3's enqueue persist: it never became durable, so the
  // durable truth holds only items 1-2. The resume re-submits the same
  // content — a FRESH work item (not a duplicate: the crashed one never
  // existed durably) — and nothing is lost.
  const evidence = crashScenario({ count: 3, fault: { save: 3 }, reenqueue: 2 });
  assertExactlyOnceResumed(evidence, 3, "none");
});

test("E6 row F2: crash after the lease is persisted, before the effect intent — same worker resumes its own lease", () => {
  // Save #5 is the WAL persist: the lease (save #4) is durable, the
  // effect intent is not. The resume re-claims its OWN lease.
  const evidence = crashScenario({ count: 3, fault: { save: 5 } });
  assertExactlyOnceResumed(evidence, 3, "none");
  const reclaims = entriesOf(evidence, "lease-reclaimed", crashedRowOf(evidence));
  assert.equal(reclaims.length, 1, "the crashed row must be re-claimed, not re-enqueued");
});

test("E6 row F3: crash after the WAL intent is persisted, before the executor is invoked", () => {
  // The attempt fault dies BEFORE the executor runs: the WAL intent
  // (save #5) stands durably, no effect happened. The resume re-invokes
  // — and because the executor never ran, that re-invocation is a REAL
  // effect (exactly one per item), never a duplicate.
  const evidence = crashScenario({ count: 3, fault: { attempt: 1 } });
  assertExactlyOnceResumed(evidence, 3, "none");
});

test("E6 row F4: crash AFTER the real effect, BEFORE its receipt is persisted — the re-invocation is the executor's keyed duplicate", () => {
  // The invocation fault dies after the SECOND real effect (item 2's):
  // item 1 is fully durable; item 2's WAL stands, its effect ran, but
  // the receipt never returned. The resume re-invokes item 2 and the
  // executor answers with the keyed duplicate — THE exactly-once
  // composition (durable at-least-once redelivery × keyed dedupe).
  const evidence = crashScenario({ count: 3, fault: { invocation: 1 } });
  assertExactlyOnceResumed(evidence, 3, "any");
  const executorDuplicates = evidence.resumed.journalOf().filter((entry) => entry.kind === "effect-duplicate" && entry.facts.source === "executor");
  assert.ok(executorDuplicates.length > 0, "the executor's keyed-duplicate receipt must be journaled");
});

test("E6 row F5: crash after the effect receipt is persisted, before completion — the runtime never re-invokes", () => {
  // Save #7 is the completion persist: the receipt (save #6) is durable.
  // The resume finds the standing receipt and SKIPS the executor — the
  // ledger-skip path — going straight to completion.
  const evidence = crashScenario({ count: 3, fault: { save: 7 } });
  assertExactlyOnceResumed(evidence, 3, "none");
  const ledgerDuplicates = entriesOf(evidence, "effect-duplicate", crashedRowOf(evidence)).filter((entry) => entry.facts.source === "ledger");
  assert.equal(ledgerDuplicates.length, 1, "the ledger-skip path must be visible in the journal");
});

test("E6 row F6: crash mid-queue after the first completion — remaining items resume with no loss", () => {
  // Save #8 is item 2's lease persist: item 1 is completed durably
  // (save #7), item 2's lease never became durable. The resume drives
  // items 2-3 from their durable queued state.
  const evidence = crashScenario({ count: 3, fault: { save: 8 } });
  assertExactlyOnceResumed(evidence, 3, "none");
  const completed = [...evidence.durableBeforeCrash].reverse().find((entry) => entry.kind === "completed");
  assert.ok(completed !== undefined, "the first item must be durably completed before the crash");
  assert.equal(evidence.durableBeforeCrash.filter((entry) => entry.kind === "completed").length, 1, "exactly one completion is durable at the crash");
});

test("E6 row F7: crash holding a lease, clock passes the TTL, a DIFFERENT worker reclaims the expired lease", () => {
  // Save #5 again (lease durable), but the clock advances past the TTL
  // while the process is down and a DIFFERENT worker resumes: the
  // expired lease is reclaimed with the journal evidence.
  const evidence = crashScenario({ count: 3, fault: { save: 5 }, resumeWorkerId: "worker-2", advanceClockMs: 61_000 });
  assertExactlyOnceResumed(evidence, 3, "none");
  const crashed = crashedRowOf(evidence);
  const expired = evidence.resumed.journalOf().filter((entry) => entry.kind === "lease-expired");
  assert.equal(expired.length, 1, "the lease-expired entry must be journaled exactly once");
  assert.equal(expired[0]?.workId, crashed);
  const reclaims = entriesOf(evidence, "lease-reclaimed", crashed);
  assert.equal(reclaims.length, 1);
  assert.equal(reclaims[0]?.facts.workerId, "worker-2", "the expired lease must be reclaimed by the DIFFERENT worker");
});

test("E6 row F8: crash holding a lease, clock passes the TTL, the SAME worker restarts and re-claims", () => {
  // Same durable state as F7, but the SAME worker id restarts: its own
  // expired lease is re-claimed (the restart path — own-lease due even
  // after expiry), still exactly-once.
  const evidence = crashScenario({ count: 3, fault: { save: 5 }, advanceClockMs: 61_000 });
  assertExactlyOnceResumed(evidence, 3, "none");
  const reclaims = entriesOf(evidence, "lease-reclaimed", crashedRowOf(evidence));
  assert.equal(reclaims.length, 1);
  assert.equal(reclaims[0]?.facts.workerId, WORKER, "the expired lease must be re-claimed by the SAME worker");
});
