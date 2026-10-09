/**
 * Module role: the async tool-job queue — command admission, the
 * host-driven deterministic pump, per-job event order, retry, cancellation
 * and the store/restore boundary. Execution flows through the SAME
 * invocation pipeline as synchronous calls (E2: one canonical command path);
 * the queue owns job lifecycle state and its event sequence (E1). No
 * wall-clock (ClockPort), no background timers — the host calls pump().
 *
 * Async/stateful contract (spec/worker-contract.md):
 * - mutable state owner: this queue instance (jobs, statuses, sequences);
 * - command admission: enqueue validates the job id + embedded call,
 *   rejects duplicate job ids, and replays completed idempotency keys
 *   through the pipeline ledger instead of re-executing;
 * - event order: admitted → started → (retry-scheduled → started)* →
 *   terminal, with strictly increasing per-job sequence numbers;
 * - idempotency key: the embedded call's key, deduplicated by the pipeline;
 * - stale-result rule: restored terminal jobs never re-execute; a running
 *   job at snapshot time is re-admitted as queued (at-least-once at the
 *   executor seam — the ledger prevents re-execution after completion);
 * - replay/resume boundary: ledger rehydration happens only from host
 *   records (restore); events are live observations and are never
 *   re-emitted for restored history (E10);
 * - retry/cancellation: only "failure" outcomes retry (bounded by
 *   maxAttempts); timeouts and cancellations are terminal, typed decisions.
 *
 * Implements: PL-019 long-running work; E6 (durable/queued/resumable).
 */

import type {
  CancellationReason,
  CapabilityId,
  ToolCallCancellation,
  ToolCallOutcome,
  ToolCallRequest,
} from "@playliquid/tool-fabric";
import { idempotencyScope, inputFingerprint } from "@playliquid/tool-fabric";
import type { JobId, JobStoreRecord, ToolJobSnapshot } from "../domain/job.ts";
import { advanceToolJobStatus, isToolJobTerminal, validateJobStoreRecord, validateToolJobRequest } from "../domain/job.ts";
import type { ClockPort, JobEvent, JobEventSink, JobEventType, JobStorePort } from "../domain/ports.ts";
import type { InvocationPipeline } from "./pipeline.ts";

export type JobAdmissionRejectionCode =
  | "job/not-admitted-invalid"
  | "job/idempotency-input-mismatch";

export type JobAdmission =
  | { readonly outcome: "admitted"; readonly job: ToolJobSnapshot }
  | { readonly outcome: "rejected"; readonly rejections: readonly { code: JobAdmissionRejectionCode; message: string }[] }
  | { readonly outcome: "duplicate"; readonly jobId: JobId; readonly status: ToolJobSnapshot["status"] }
  | { readonly outcome: "replayed"; readonly callOutcome: ToolCallOutcome };

export type JobCancelCheck =
  | { readonly outcome: "ok"; readonly job: ToolJobSnapshot }
  | { readonly outcome: "rejected"; readonly code: "job/unknown-job" | "job/already-terminal" | "job/invalid-transition"; readonly message: string };

export type JobStatusQuery =
  | { readonly outcome: "ok"; readonly job: ToolJobSnapshot }
  | { readonly outcome: "unknown"; readonly jobId: JobId };

export type JobRestoreCheck =
  | { readonly outcome: "ok"; readonly restored: number; readonly requeued: number; readonly ledgerRehydrated: number }
  | { readonly outcome: "rejected"; readonly rejections: readonly { code: string; message: string }[] };

export interface ToolJobQueue {
  enqueue(request: unknown): Promise<JobAdmission>;
  cancel(jobId: JobId): Promise<JobCancelCheck>;
  status(jobId: JobId): JobStatusQuery;
  /** Drives every currently queued job to a terminal state, in admission order. */
  pump(): Promise<void>;
  snapshot(): readonly ToolJobSnapshot[];
  restore(records: readonly unknown[]): Promise<JobRestoreCheck>;
}

export interface JobQueueDeps {
  readonly pipeline: InvocationPipeline;
  readonly clock: ClockPort;
  readonly eventSink: JobEventSink;
  readonly jobStore?: JobStorePort;
  readonly grantedCapabilities?: readonly CapabilityId[];
}

interface QueueToken {
  request(reason: CancellationReason): void;
}

interface JobRecord {
  job: ToolJobSnapshot;
  order: number;
  token: QueueToken | null;
  callerCancellation: ToolCallCancellation | undefined;
}

/** Creates the async tool-job queue. The instance owns all job state (E1). */
export function createToolJobQueue(deps: JobQueueDeps): ToolJobQueue {
  const jobs = new Map<JobId, JobRecord>();
  let admissionOrder = 0;

  function emit(job: JobRecord, type: JobEventType, outcome?: ToolCallOutcome): void {
    const sequence = job.job.sequence + 1;
    const event: JobEvent = {
      kind: "tool-job-event",
      jobId: job.job.jobId,
      type,
      sequence,
      at: deps.clock.now(),
      ...(outcome === undefined ? {} : { outcome }),
    };
    job.job = Object.freeze({ ...job.job, sequence });
    deps.eventSink.emit(Object.freeze(event));
  }

  async function persist(job: JobRecord, outcome?: ToolCallOutcome): Promise<void> {
    if (deps.jobStore === undefined) {
      return;
    }
    const record: JobStoreRecord = { kind: "job-store-record", job: job.job, ...(outcome === undefined ? {} : { outcome }) };
    await deps.jobStore.persist(Object.freeze(record));
  }

  async function enqueue(request: unknown): Promise<JobAdmission> {
    const check = validateToolJobRequest(request);
    if (check.outcome === "rejected") {
      return {
        outcome: "rejected",
        rejections: Object.freeze(
          check.rejections.map((item) => ({ code: "job/not-admitted-invalid" as const, message: item.message })),
        ),
      };
    }
    const jobId = check.jobId;

    const existing = jobs.get(jobId);
    if (existing !== undefined) {
      return { outcome: "duplicate", jobId, status: existing.job.status };
    }

    const scope = idempotencyScope(check.call);
    if (scope !== null) {
      const ledgerEntry = deps.pipeline.ledgerLookup(scope);
      if (ledgerEntry !== null) {
        const fingerprint = inputFingerprint(check.call.input);
        if (ledgerEntry.fingerprint !== null && fingerprint !== null && fingerprint !== ledgerEntry.fingerprint) {
          return {
            outcome: "rejected",
            rejections: Object.freeze([
              {
                code: "job/idempotency-input-mismatch",
                message: "the idempotency key was already completed with a different input (inputFingerprint mismatch)",
              },
            ]),
          };
        }
        return { outcome: "replayed", callOutcome: ledgerEntry.outcome };
      }
    }

    const job: ToolJobSnapshot = Object.freeze({
      kind: "tool-job-snapshot",
      jobId,
      callId: check.call.callId,
      tool: check.call.tool,
      surfaceVersion: check.call.surfaceVersion,
      input: check.call.input,
      requiredCapabilities: check.call.requiredCapabilities,
      status: "queued",
      attempts: 0,
      maxAttempts: check.maxAttempts,
      cancellationRequested: false,
      queuedAt: deps.clock.now(),
      sequence: 0,
      ...(check.call.idempotencyKey === undefined ? {} : { idempotencyKey: check.call.idempotencyKey }),
      ...(check.call.deadline === undefined ? {} : { deadline: check.call.deadline }),
    });
    const record: JobRecord = { job, order: admissionOrder, token: null, callerCancellation: check.call.cancellation };
    admissionOrder += 1;
    jobs.set(jobId, record);
    emit(record, "admitted");
    await persist(record);
    return { outcome: "admitted", job: record.job };
  }

  async function cancel(jobId: JobId): Promise<JobCancelCheck> {
    const record = jobs.get(jobId);
    if (record === undefined) {
      return { outcome: "rejected", code: "job/unknown-job", message: `job ${jobId} is not known to this queue` };
    }
    if (isToolJobTerminal(record.job.status)) {
      return { outcome: "rejected", code: "job/already-terminal", message: `job ${jobId} already reached terminal status "${record.job.status}"` };
    }
    if (record.job.status === "queued") {
      const transition = advanceToolJobStatus(record.job.status, "cancelled");
      if (transition.outcome !== "ok") {
        return { outcome: "rejected", code: "job/invalid-transition", message: transition.message };
      }
      record.job = Object.freeze({ ...record.job, status: transition.next });
      emit(record, "cancelled");
      await persist(record);
      return { outcome: "ok", job: record.job };
    }
    // Running: record the request and signal the live token; the effect
    // lands when the executor honors cancellation at its next boundary.
    record.job = Object.freeze({ ...record.job, cancellationRequested: true });
    record.token?.request("caller-requested");
    return { outcome: "ok", job: record.job };
  }

  function status(jobId: JobId): JobStatusQuery {
    const record = jobs.get(jobId);
    if (record === undefined) {
      return { outcome: "unknown", jobId };
    }
    return { outcome: "ok", job: record.job };
  }

  /** Drives queued jobs to terminal states, in admission order (retries
   * included: a re-queued job is picked up again; the loop terminates
   * because attempts strictly increase up to maxAttempts). */
  async function pump(): Promise<void> {
    for (;;) {
      const next = [...jobs.values()]
        .filter((record) => record.job.status === "queued")
        .sort((left, right) => left.order - right.order)[0];
      if (next === undefined) {
        return;
      }
      await runOnce(next);
    }
  }

  async function runOnce(record: JobRecord): Promise<void> {
    const start = advanceToolJobStatus(record.job.status, "running");
    if (start.outcome !== "ok") {
      return;
    }
    record.job = Object.freeze({ ...record.job, status: "running", attempts: record.job.attempts + 1 });
    emit(record, "started");
    await persist(record);

    const request = executionRequest(record);
    const outcome = await deps.pipeline.invoke(request, deps.grantedCapabilities);

    let terminal: "succeeded" | "failed" | "timed-out" | "cancelled" | "retry";
    if (outcome.outcome === "ok") {
      terminal = "succeeded";
    } else if (outcome.outcome === "timeout") {
      terminal = "timed-out";
    } else if (outcome.outcome === "cancelled") {
      terminal = "cancelled";
    } else if (record.job.attempts < record.job.maxAttempts) {
      terminal = "retry";
    } else {
      terminal = "failed";
    }

    if (terminal === "retry") {
      const back = advanceToolJobStatus(record.job.status, "queued");
      if (back.outcome === "ok") {
        record.job = Object.freeze({ ...record.job, status: back.next });
        emit(record, "retry-scheduled");
        await persist(record);
      }
      return;
    }

    const finish = advanceToolJobStatus(record.job.status, terminal);
    if (finish.outcome !== "ok") {
      return;
    }
    record.job = Object.freeze({ ...record.job, status: finish.next });
    emit(record, terminal, outcome);
    await persist(record, outcome);
  }

  function executionRequest(record: JobRecord): ToolCallRequest {
    const job = record.job;
    const wrapped = wrapCancellation(record);
    return Object.freeze({
      kind: "tool-call-request",
      callId: job.callId,
      tool: job.tool,
      surfaceVersion: job.surfaceVersion,
      input: job.input,
      requiredCapabilities: job.requiredCapabilities,
      ...(job.idempotencyKey === undefined ? {} : { idempotencyKey: job.idempotencyKey }),
      ...(job.deadline === undefined ? {} : { deadline: job.deadline }),
      ...(wrapped === undefined ? {} : { cancellation: wrapped }),
    });
  }

  function wrapCancellation(record: JobRecord): ToolCallCancellation | undefined {
    const caller = record.callerCancellation;
    if (caller === undefined) {
      return undefined;
    }
    let queueRequested = false;
    let reason: CancellationReason | undefined = caller.reason;
    const listeners: (() => void)[] = [];
    const token: ToolCallCancellation = {
      get requested(): boolean {
        return queueRequested || caller.requested === true;
      },
      get reason(): CancellationReason | undefined {
        return reason;
      },
      onCancel(listener: () => void): () => void {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
    };
    const queueToken: QueueToken = {
      request(requested: CancellationReason): void {
        queueRequested = true;
        reason = requested;
        const snapshot = [...listeners];
        for (const listener of snapshot) {
          listener();
        }
      },
    };
    record.token = queueToken;
    caller.onCancel(() => queueToken.request("caller-requested"));
    return token;
  }

  function snapshot(): readonly ToolJobSnapshot[] {
    return Object.freeze([...jobs.values()].map((record) => record.job));
  }

  async function restore(records: readonly unknown[]): Promise<JobRestoreCheck> {
    const rejections: { code: string; message: string }[] = [];
    const validated: JobStoreRecord[] = [];
    for (const candidate of records) {
      const check = validateJobStoreRecord(candidate);
      if (check.outcome === "ok") {
        validated.push(check.record);
      } else {
        rejections.push(...check.rejections.map((item) => ({ code: `restore/${item.code}`, message: item.message })));
      }
    }
    // The store is a transition log: reduce per jobId in persistence order —
    // the LAST record for a job is its authoritative state.
    const latest = new Map<JobId, JobStoreRecord>();
    for (const record of validated) {
      latest.set(record.job.jobId, record);
    }
    for (const jobId of latest.keys()) {
      if (jobs.has(jobId)) {
        rejections.push({
          code: "restore/job-already-known",
          message: `job ${jobId} is already known to this queue`,
        });
      }
    }
    // Atomic: any invalid record or clash refuses the whole restore.
    if (rejections.length > 0) {
      return { outcome: "rejected", rejections: Object.freeze(rejections) };
    }

    let requeued = 0;
    let rehydrated = 0;
    for (const record of latest.values()) {
      let status = record.job.status;
      if (status === "running") {
        // Replay/resume boundary: running work is re-admitted as queued.
        status = "queued";
        requeued += 1;
      }
      const job: ToolJobSnapshot = Object.freeze({ ...record.job, status });
      jobs.set(job.jobId, { job, order: admissionOrder, token: null, callerCancellation: undefined });
      admissionOrder += 1;

      if (job.idempotencyKey !== undefined && record.outcome !== undefined && isToolJobTerminal(job.status)) {
        const scope = idempotencyScope({
          kind: "tool-call-request",
          callId: job.callId,
          tool: job.tool,
          surfaceVersion: job.surfaceVersion,
          input: job.input,
          requiredCapabilities: job.requiredCapabilities,
          idempotencyKey: job.idempotencyKey,
        });
        if (scope !== null) {
          deps.pipeline.ledgerRehydrate(scope, inputFingerprint(job.input), record.outcome);
          rehydrated += 1;
        }
      }
    }
    return { outcome: "ok", restored: latest.size, requeued, ledgerRehydrated: rehydrated };
  }

  return Object.freeze({ enqueue, cancel, status, pump, snapshot, restore });
}
