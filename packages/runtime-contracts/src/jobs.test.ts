/**
 * Long-running work tests (E6): durable job state machine, bounded retry
 * with pure backoff, and resume decisions from checkpoints.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkJobPhaseTransition,
  decideResume,
  decideRetry,
  type RuntimeJobDescriptor,
  type RuntimeJobPhase,
} from "./jobs.ts";
import {
  asActorId,
  asCheckpointRef,
  asIdempotencyNonce,
  asJobId,
  asSessionEpoch,
  asSessionId,
  asSnapshotId,
  asTimestamp,
} from "./primitives.ts";

const descriptor = (over: Partial<RuntimeJobDescriptor> = {}): RuntimeJobDescriptor => ({
  jobId: asJobId("job-1"),
  kind: "simulation",
  sessionId: asSessionId("s-job"),
  enqueueIdempotencyKey: {
    scope: "job-enqueue",
    actor: asActorId("actor"),
    nonce: asIdempotencyNonce("n-1"),
  },
  requestedAt: asTimestamp(0),
  checkpointPolicy: { kind: "every-n-ticks", ticks: 10 },
  resume: { kind: "from-latest-checkpoint" },
  retry: { maxAttempts: 3, backoffBaseMs: 100, backoffCapMs: 400 },
  cancellation: { graceTicks: 5 },
  ...over,
});

const running = (over: Partial<Extract<RuntimeJobPhase, { phase: "running" }>> = {}): RuntimeJobPhase => ({
  phase: "running",
  attempt: 1,
  ...over,
});

test("job lifecycle transitions follow the frozen table", () => {
  assert.equal(checkJobPhaseTransition("queued", "running").ok, true);
  assert.equal(checkJobPhaseTransition("running", "succeeded").ok, true);
  assert.equal(checkJobPhaseTransition("running", "running").ok, true, "checkpoint self-transition");
  assert.equal(checkJobPhaseTransition("failed", "queued").ok, true, "bounded retry");
  assert.equal(checkJobPhaseTransition("queued", "succeeded").ok, false, "cannot skip running");
  assert.equal(checkJobPhaseTransition("cancelled", "running").ok, false, "cancelled is final");
  assert.equal(checkJobPhaseTransition("expired", "queued").ok, false, "expired is final");
});

test("decideRetry: bounded attempts with exponential backoff, capped", () => {
  const failed: RuntimeJobPhase = { phase: "failed", attempt: 1, retryable: true };
  const first = decideRetry(descriptor(), failed, asTimestamp(0), asTimestamp(0));
  assert.deepEqual(first, { retry: true, nextAttempt: 2, delayMs: 100 });

  const second: RuntimeJobPhase = { phase: "failed", attempt: 2, retryable: true };
  const secondDecision = decideRetry(descriptor(), second, asTimestamp(0), asTimestamp(0));
  assert.deepEqual(secondDecision, { retry: true, nextAttempt: 3, delayMs: 200 });

  const third: RuntimeJobPhase = { phase: "failed", attempt: 3, retryable: true };
  const exhausted = decideRetry(descriptor(), third, asTimestamp(0), asTimestamp(0));
  assert.deepEqual(exhausted, { retry: false, reason: "attempts-exhausted" });

  const cap: RuntimeJobPhase = { phase: "failed", attempt: 9, retryable: true };
  const capped = decideRetry(
    descriptor({ retry: { maxAttempts: 10, backoffBaseMs: 100, backoffCapMs: 400 } }),
    cap,
    asTimestamp(0),
    asTimestamp(0),
  );
  assert.deepEqual(capped, { retry: true, nextAttempt: 10, delayMs: 400 }, "backoff is capped");
});

test("decideRetry: elapsed backoff time is discounted; non-failed jobs never retry", () => {
  const failed: RuntimeJobPhase = { phase: "failed", attempt: 1, retryable: true };
  const later = decideRetry(descriptor(), failed, asTimestamp(60), asTimestamp(0));
  assert.deepEqual(later, { retry: true, nextAttempt: 2, delayMs: 40 }, "remaining delay only");
  const queued: RuntimeJobPhase = { phase: "queued", enqueuedAt: asTimestamp(0) };
  assert.deepEqual(decideRetry(descriptor(), queued, asTimestamp(0), asTimestamp(0)), {
    retry: false,
    reason: "not-failed",
  });
});

test("decideResume: from-start policy ignores checkpoints", () => {
  const withCheckpoint = running({
    latestCheckpoint: {
      checkpointRef: asCheckpointRef("cp-1"),
      snapshotId: asSnapshotId("snap-1"),
      atTick: 40,
      afterEventSeq: 9,
      atEpoch: asSessionEpoch(1),
    },
  });
  const decision = decideResume(descriptor({ resume: { kind: "from-start" } }), withCheckpoint, asSessionEpoch(1));
  assert.deepEqual(decision, { resume: true, from: { kind: "start" } });
});

test("decideResume: checkpoint policy resumes only on matching epoch", () => {
  const checkpoint = {
    checkpointRef: asCheckpointRef("cp-1"),
    snapshotId: asSnapshotId("snap-1"),
    atTick: 40,
    afterEventSeq: 9,
    atEpoch: asSessionEpoch(1),
  };
  const ok = decideResume(descriptor(), running({ latestCheckpoint: checkpoint }), asSessionEpoch(1));
  assert.equal(ok.resume, true);
  if (ok.resume && ok.from.kind === "checkpoint") {
    assert.equal(ok.from.checkpoint.afterEventSeq, 9);
  }
  const stale = decideResume(descriptor(), running({ latestCheckpoint: checkpoint }), asSessionEpoch(2));
  assert.deepEqual(stale, { resume: false, reason: "epoch-stale" });
});

test("decideResume: no checkpoint yet means from-start; finished jobs are not resumable", () => {
  assert.deepEqual(decideResume(descriptor(), running(), asSessionEpoch(1)), {
    resume: true,
    from: { kind: "start" },
  });
  const succeeded: RuntimeJobPhase = {
    phase: "succeeded",
    result: { resultId: "r", digest: "d", epoch: asSessionEpoch(1) },
    epoch: asSessionEpoch(1),
  };
  assert.deepEqual(decideResume(descriptor(), succeeded, asSessionEpoch(1)), {
    resume: false,
    reason: "job-not-resumable",
  });
});

test("type-level: the enqueue idempotency key scope is job-enqueue (E6/E2)", () => {
  const d = descriptor();
  assert.equal(d.enqueueIdempotencyKey.scope, "job-enqueue");
  // @ts-expect-error TS2322: scope is a closed union, not an arbitrary string
  d.enqueueIdempotencyKey.scope = "anything";
  assert.equal(d.kind, "simulation");
});
