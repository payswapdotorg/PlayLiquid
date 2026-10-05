/**
 * LONG-RUNNING WORK CONTRACTS (requirement E6: long-running work is
 * durable/queued/resumable).
 *
 * Runtime work that outlives a single request — simulation batches, match
 * runs — is described here as DURABLE JOB DESCRIPTORS. The contracts cover
 * the full async/stateful documentation duty (worker-contract
 * "Async/stateful work"):
 *
 * - Mutable state owner: the DURABLE JOB RUNNER (the platform service that
 *   owns the job table) owns job phase, attempt counters and checkpoint
 *   references. Everything here is immutable descriptor data plus pure
 *   transition functions the runner applies.
 * - Command admission: jobs are ENQUEUED through an idempotency key (see
 *   idempotency.ts); a duplicate enqueue returns the existing job id.
 * - Event order: job progress is reported through the canonical event path
 *   of the owning session (events.ts), not a second channel (E2).
 * - Replay/resume boundary: see replay.ts (`validateReplayPlan`,
 *   `canResumeFromCheckpoint`). A job may only resume from a checkpoint that
 *   coincides with a persisted snapshot boundary.
 * - Retry/cancellation semantics: {@link RetryPolicy} (bounded attempts,
 *   pure backoff EXPRESSION — data, never a sleeper) and
 *   {@link CancellationPolicy} (cooperative: cancellation is observed at the
 *   next checkpoint; there is no hard kill in the contract).
 * - Stale results: completed job results carry the session epoch they were
 *   produced under and are subject to the stale-result rule
 *   (idempotency.ts) — a reset/restore invalidates in-flight and completed
 *   results alike.
 */

import type {
  CheckpointRef,
  JobId,
  SessionEpoch,
  SessionId,
  SnapshotId,
  Timestamp,
} from "./primitives.ts";
import type { IdempotencyKey } from "./idempotency.ts";

/** The two long-running runtime work kinds this protocol covers. */
export type RuntimeJobKind = "simulation" | "match";

/** How often the runner checkpoints (pure policy data). */
export type CheckpointPolicy =
  | { readonly kind: "every-n-ticks"; readonly ticks: number }
  | { readonly kind: "on-every-command" };

/** Where a resumed job starts from. */
export type ResumePolicy =
  | { readonly kind: "from-latest-checkpoint" }
  | { readonly kind: "from-start" };

/** Bounded retry with a pure backoff expression (no sleeping here). */
export interface RetryPolicy {
  readonly maxAttempts: number;
  /** Base delay in ms for exponential backoff: delay = base * 2^(attempt-1). */
  readonly backoffBaseMs: number;
  readonly backoffCapMs: number;
}

/** Cooperative cancellation: observed at checkpoint boundaries. */
export interface CancellationPolicy {
  /** Grace ticks the job may run after cancellation is requested. */
  readonly graceTicks: number;
}

/** Immutable descriptor of one durable runtime job. */
export interface RuntimeJobDescriptor {
  readonly jobId: JobId;
  readonly kind: RuntimeJobKind;
  readonly sessionId: SessionId;
  readonly enqueueIdempotencyKey: IdempotencyKey;
  readonly requestedAt: Timestamp;
  readonly checkpointPolicy: CheckpointPolicy;
  readonly resume: ResumePolicy;
  readonly retry: RetryPolicy;
  readonly cancellation: CancellationPolicy;
}

/** Durable job phase state machine (runner-owned; shown here as read models). */
export type RuntimeJobPhase =
  | { readonly phase: "queued"; readonly enqueuedAt: Timestamp }
  | { readonly phase: "running"; readonly attempt: number; readonly latestCheckpoint?: JobCheckpoint }
  | { readonly phase: "succeeded"; readonly result: JobResultRef; readonly epoch: SessionEpoch }
  | { readonly phase: "failed"; readonly attempt: number; readonly retryable: boolean }
  | { readonly phase: "cancelled"; readonly atCheckpoint: CheckpointRef }
  | { readonly phase: "expired" };

/** A durable checkpoint coinciding with a persisted snapshot boundary. */
export interface JobCheckpoint {
  readonly checkpointRef: CheckpointRef;
  readonly snapshotId: SnapshotId;
  readonly atTick: number;
  readonly afterEventSeq: number;
  readonly atEpoch: SessionEpoch;
}

/** Reference to a durable job result artifact (content-addressed). */
export interface JobResultRef {
  readonly resultId: string;
  readonly digest: string;
  readonly epoch: SessionEpoch;
}

/** Pure phase-transition check for the durable job state machine. */
export type JobTransitionResult =
  | { readonly ok: true; readonly from: RuntimeJobPhase["phase"]; readonly to: RuntimeJobPhase["phase"] }
  | {
      readonly ok: false;
      readonly code: "illegal-job-transition";
      readonly from: RuntimeJobPhase["phase"];
      readonly to: RuntimeJobPhase["phase"];
    };

const JOB_TRANSITIONS: Readonly<
  Record<RuntimeJobPhase["phase"], readonly RuntimeJobPhase["phase"][]>
> = {
  queued: ["running", "cancelled", "expired"],
  running: ["running", "succeeded", "failed", "cancelled", "expired"],
  succeeded: ["expired"],
  failed: ["queued", "expired"],
  cancelled: [],
  expired: [],
};

export function checkJobPhaseTransition(
  from: RuntimeJobPhase["phase"],
  to: RuntimeJobPhase["phase"],
): JobTransitionResult {
  const legal = JOB_TRANSITIONS[from];
  if (legal !== undefined && legal.includes(to)) {
    return { ok: true, from, to };
  }
  return { ok: false, code: "illegal-job-transition", from, to };
}

/**
 * Pure decision: may a job in state `job` be retried now (move failed ->
 * queued) given the descriptor's retry policy? Retries are bounded by
 * `maxAttempts`; the caller supplies "now" as data (no clock IO).
 */
export type RetryDecision =
  | { readonly retry: true; readonly nextAttempt: number; readonly delayMs: number }
  | { readonly retry: false; readonly reason: "not-failed" | "attempts-exhausted" };

export function decideRetry(
  descriptor: RuntimeJobDescriptor,
  job: RuntimeJobPhase,
  now: Timestamp,
  lastAttemptAt: Timestamp,
): RetryDecision {
  if (job.phase !== "failed") {
    return { retry: false, reason: "not-failed" };
  }
  const nextAttempt = job.attempt + 1;
  if (nextAttempt > descriptor.retry.maxAttempts) {
    return { retry: false, reason: "attempts-exhausted" };
  }
  const raw = descriptor.retry.backoffBaseMs * 2 ** (job.attempt - 1);
  const delay = Math.min(raw, descriptor.retry.backoffCapMs);
  const elapsed = (now as number) - (lastAttemptAt as number);
  if (elapsed < delay) {
    // Still inside the backoff window: report the decision with the delay
    // that remains; the runner (owner of timers) enforces it.
    return { retry: true, nextAttempt, delayMs: delay - elapsed };
  }
  return { retry: true, nextAttempt, delayMs: 0 };
}

/**
 * Pure check whether a job may resume, and from where:
 * - policy `from-start` always resumes from the beginning;
 * - policy `from-latest-checkpoint` resumes from the latest checkpoint when
 *   one exists and its epoch matches the session's CURRENT epoch (an epoch
 *   bump from reset/restore invalidates checkpoints — stale-result rule);
 *   with no checkpoint yet it resumes from start;
 * - a running job whose checkpoint epoch is stale reports `epoch-stale`
 *   (the runner then decides to re-enqueue from start or fail the job).
 */
export type ResumeOrigin =
  | { readonly kind: "checkpoint"; readonly checkpoint: JobCheckpoint }
  | { readonly kind: "start" };

export type ResumeDecision =
  | { readonly resume: true; readonly from: ResumeOrigin }
  | {
      readonly resume: false;
      readonly reason: "no-checkpoint" | "epoch-stale" | "job-not-resumable";
    };

export function decideResume(
  descriptor: RuntimeJobDescriptor,
  job: RuntimeJobPhase,
  sessionEpoch: SessionEpoch,
): ResumeDecision {
  if (job.phase !== "running" && job.phase !== "queued" && job.phase !== "failed") {
    return { resume: false, reason: "job-not-resumable" };
  }
  if (descriptor.resume.kind === "from-start") {
    return { resume: true, from: { kind: "start" } };
  }
  if (job.phase === "running" && job.latestCheckpoint !== undefined) {
    if (job.latestCheckpoint.atEpoch !== sessionEpoch) {
      return { resume: false, reason: "epoch-stale" };
    }
    return { resume: true, from: { kind: "checkpoint", checkpoint: job.latestCheckpoint } };
  }
  // No durable checkpoint yet: from-start is the only resumable boundary.
  return { resume: true, from: { kind: "start" } };
}
