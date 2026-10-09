/**
 * Module role: the queued tool-job model — typed status transitions
 * (queued → running → succeeded | failed | timed-out | cancelled, plus
 * queued/running → cancelled and running → queued for retry), the job
 * request envelope validation, and the durable job snapshot/record shapes
 * used by the store/restore path. Mirrors the sibling lifecycle validator
 * style: typed rejections, never thrown exceptions.
 *
 * Implements: PL-019 long-running work (E6 durability shapes — a queued job
 * model with typed status transitions, cancellation and resumability); the
 * async/stateful documentation duties of spec/worker-contract.md.
 */

import type {
  CallId,
  CapabilityId,
  Deadline,
  IdempotencyKey,
  SurfaceVersion,
  ToolCallOutcome,
  ToolCallRequest,
  ToolIdentity,
} from "@playliquid/tool-fabric";
import { isToolCallOutcome, validateSurfaceVersion, validateToolCallRequest, validateToolIdentity } from "@playliquid/tool-fabric";
export type JobId = string;

export const JOB_ID_MAX_LENGTH = 128;
export const JOB_MAX_ATTEMPTS_LIMIT = 8;

export type ToolJobStatus = "queued" | "running" | "succeeded" | "failed" | "timed-out" | "cancelled";

export type JobTransitionRejectionCode =
  | "job/unknown-status"
  | "job/invalid-transition"
  | "job/terminal-status";

export type JobTransitionCheck =
  | { readonly outcome: "ok"; readonly next: ToolJobStatus }
  | { readonly outcome: "rejected"; readonly code: JobTransitionRejectionCode; readonly message: string };

export const TOOL_JOB_STATUSES: readonly ToolJobStatus[] = Object.freeze([
  "queued",
  "running",
  "succeeded",
  "failed",
  "timed-out",
  "cancelled",
] as ToolJobStatus[]);

/**
 * Binding transition rules:
 *   queued  → running | cancelled
 *   running → succeeded | failed | timed-out | cancelled | queued (retry)
 *   terminal (succeeded | failed | timed-out | cancelled) → nothing.
 */
export const TOOL_JOB_TRANSITIONS: Readonly<Record<ToolJobStatus, readonly ToolJobStatus[]>> = Object.freeze({
  queued: Object.freeze(["running", "cancelled"] as ToolJobStatus[]),
  running: Object.freeze(["succeeded", "failed", "timed-out", "cancelled", "queued"] as ToolJobStatus[]),
  succeeded: Object.freeze([] as ToolJobStatus[]),
  failed: Object.freeze([] as ToolJobStatus[]),
  "timed-out": Object.freeze([] as ToolJobStatus[]),
  cancelled: Object.freeze([] as ToolJobStatus[]),
});

/** Type guard for untrusted job status strings. Total; never throws. */
export function isToolJobStatus(value: unknown): value is ToolJobStatus {
  return typeof value === "string" && TOOL_JOB_STATUSES.includes(value as ToolJobStatus);
}

/** Terminal statuses never transition again (historical state is final). */
export function isToolJobTerminal(status: ToolJobStatus): boolean {
  return TOOL_JOB_TRANSITIONS[status].length === 0;
}

/** Validates a job status transition. Total; never throws. */
export function advanceToolJobStatus(current: ToolJobStatus, requested: ToolJobStatus): JobTransitionCheck {
  if (!isToolJobStatus(current)) {
    return { outcome: "rejected", code: "job/unknown-status", message: `unknown tool job status: ${String(current)}` };
  }
  if (!isToolJobStatus(requested)) {
    return { outcome: "rejected", code: "job/unknown-status", message: `unknown tool job status: ${String(requested)}` };
  }
  if (isToolJobTerminal(current)) {
    return {
      outcome: "rejected",
      code: "job/terminal-status",
      message: `job status "${current}" is terminal; it never transitions again (E10)`,
    };
  }
  const allowed = TOOL_JOB_TRANSITIONS[current];
  if (!allowed.includes(requested)) {
    return {
      outcome: "rejected",
      code: "job/invalid-transition",
      message: `cannot transition job from "${current}" to "${requested}"; allowed: ${allowed.join(", ")}`,
    };
  }
  return { outcome: "ok", next: requested };
}

export type JobRequestRejectionCode =
  | "job/not-an-object"
  | "job/job-id-missing"
  | "job/job-id-too-long"
  | "job/call-invalid"
  | "job/max-attempts-invalid";

export interface JobRequestRejection {
  readonly code: JobRequestRejectionCode;
  readonly message: string;
}

export type JobRequestValidation =
  | { readonly outcome: "ok"; readonly jobId: JobId; readonly call: ToolCallRequest; readonly maxAttempts: number }
  | { readonly outcome: "rejected"; readonly rejections: readonly JobRequestRejection[] };

function jobRejection(code: JobRequestRejectionCode, message: string): JobRequestRejection {
  return Object.freeze({ code, message });
}

/**
 * Validates an untrusted job request { jobId, call, maxAttempts? }.
 * maxAttempts defaults to 1 (no retry) and is capped at
 * JOB_MAX_ATTEMPTS_LIMIT. Total; never throws; accumulates problems.
 */
export function validateToolJobRequest(input: unknown): JobRequestValidation {
  const record = plainRecord(input);
  if (record === null) {
    return { outcome: "rejected", rejections: [jobRejection("job/not-an-object", "tool job request must be a non-array object")] };
  }
  const rejections: JobRequestRejection[] = [];

  let jobId: JobId | undefined;
  const rawJobId = record["jobId"];
  if (typeof rawJobId !== "string" || rawJobId.length === 0) {
    rejections.push(jobRejection("job/job-id-missing", "jobId must be a non-empty string"));
  } else if (rawJobId.length > JOB_ID_MAX_LENGTH) {
    rejections.push(jobRejection("job/job-id-too-long", `jobId must be at most ${JOB_ID_MAX_LENGTH} characters`));
  } else {
    jobId = rawJobId;
  }

  let call: ToolCallRequest | undefined;
  const callCheck = validateToolCallRequest(record["call"]);
  if (callCheck.outcome === "ok") {
    call = callCheck.request;
  } else {
    rejections.push(
      jobRejection("job/call-invalid", `embedded call invalid: ${callCheck.rejections.map((item) => item.message).join("; ")}`),
    );
  }

  let maxAttempts: number | undefined = 1;
  const rawMax = record["maxAttempts"];
  if (rawMax !== undefined) {
    if (typeof rawMax !== "number" || !Number.isInteger(rawMax) || rawMax < 1 || rawMax > JOB_MAX_ATTEMPTS_LIMIT) {
      rejections.push(
        jobRejection("job/max-attempts-invalid", `maxAttempts must be an integer between 1 and ${JOB_MAX_ATTEMPTS_LIMIT}`),
      );
      maxAttempts = undefined;
    } else {
      maxAttempts = rawMax;
    }
  }

  if (rejections.length > 0 || jobId === undefined || call === undefined || maxAttempts === undefined) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }
  return { outcome: "ok", jobId, call, maxAttempts };
}

/**
 * The durable job record (persisted through the JobStorePort on every
 * transition). Carries everything needed to re-admit or replay the job
 * after a restore, plus the sequence of the last emitted job event (E6).
 */
export interface ToolJobSnapshot {
  readonly kind: "tool-job-snapshot";
  readonly jobId: JobId;
  readonly callId: CallId;
  readonly tool: ToolIdentity;
  readonly surfaceVersion: SurfaceVersion;
  readonly input: unknown;
  readonly requiredCapabilities: readonly CapabilityId[];
  readonly idempotencyKey?: IdempotencyKey;
  readonly deadline?: Deadline;
  readonly status: ToolJobStatus;
  /** Execution attempts started so far. */
  readonly attempts: number;
  readonly maxAttempts: number;
  /** Cancellation was requested by the queue owner. */
  readonly cancellationRequested: boolean;
  /** Admission timestamp (epoch ms, from the injected clock). */
  readonly queuedAt: number;
  /** Sequence number of the last emitted job event for this job. */
  readonly sequence: number;
}

export type SnapshotRejectionCode =
  | "snapshot/not-an-object"
  | "snapshot/job-id-invalid"
  | "snapshot/call-id-invalid"
  | "snapshot/tool-invalid"
  | "snapshot/surface-invalid"
  | "snapshot/status-invalid"
  | "snapshot/attempts-invalid"
  | "snapshot/max-attempts-invalid"
  | "snapshot/sequence-invalid"
  | "snapshot/capabilities-invalid";

export interface SnapshotRejection {
  readonly code: SnapshotRejectionCode;
  readonly message: string;
}

export type ToolJobSnapshotValidation =
  | { readonly outcome: "ok"; readonly snapshot: ToolJobSnapshot }
  | { readonly outcome: "rejected"; readonly rejections: readonly SnapshotRejection[] };

function snapshotRejection(code: SnapshotRejectionCode, message: string): SnapshotRejection {
  return Object.freeze({ code, message });
}

/** Validates an untrusted stored job snapshot (restore path). Total; never throws. */
export function validateToolJobSnapshot(input: unknown): ToolJobSnapshotValidation {
  const record = plainRecord(input);
  if (record === null) {
    return { outcome: "rejected", rejections: [snapshotRejection("snapshot/not-an-object", "tool job snapshot must be a non-array object")] };
  }
  const rejections: SnapshotRejection[] = [];

  let jobId: JobId | undefined;
  const rawJobId = record["jobId"];
  if (typeof rawJobId !== "string" || rawJobId.length === 0 || rawJobId.length > JOB_ID_MAX_LENGTH) {
    rejections.push(snapshotRejection("snapshot/job-id-invalid", "jobId must be a non-empty string within the length limit"));
  } else {
    jobId = rawJobId;
  }

  let callId: CallId | undefined;
  const rawCallId = record["callId"];
  if (typeof rawCallId !== "string" || rawCallId.length === 0) {
    rejections.push(snapshotRejection("snapshot/call-id-invalid", "callId must be a non-empty string"));
  } else {
    callId = rawCallId;
  }

  let tool: ToolIdentity | undefined;
  const toolCheck = validateToolIdentity(record["tool"], "tool");
  if (toolCheck.outcome === "ok") {
    tool = toolCheck.identity;
  } else {
    rejections.push(snapshotRejection("snapshot/tool-invalid", toolCheck.rejections.map((item) => item.message).join("; ")));
  }

  let surface: SurfaceVersion | undefined;
  const surfaceCheck = validateSurfaceVersion(record["surfaceVersion"]);
  if (surfaceCheck.outcome === "ok") {
    surface = surfaceCheck.version;
  } else {
    rejections.push(snapshotRejection("snapshot/surface-invalid", surfaceCheck.rejection.message));
  }

  let status: ToolJobStatus | undefined;
  if (!isToolJobStatus(record["status"])) {
    rejections.push(snapshotRejection("snapshot/status-invalid", "status must be a tool job status"));
  } else {
    status = record["status"];
  }

  let attempts: number | undefined;
  const rawAttempts = record["attempts"];
  if (typeof rawAttempts !== "number" || !Number.isInteger(rawAttempts) || rawAttempts < 0) {
    rejections.push(snapshotRejection("snapshot/attempts-invalid", "attempts must be a non-negative integer"));
  } else {
    attempts = rawAttempts;
  }

  let maxAttempts: number | undefined;
  const rawMax = record["maxAttempts"];
  if (typeof rawMax !== "number" || !Number.isInteger(rawMax) || rawMax < 1 || rawMax > JOB_MAX_ATTEMPTS_LIMIT) {
    rejections.push(snapshotRejection("snapshot/max-attempts-invalid", `maxAttempts must be an integer between 1 and ${JOB_MAX_ATTEMPTS_LIMIT}`));
  } else {
    maxAttempts = rawMax;
  }

  let sequence: number | undefined;
  const rawSequence = record["sequence"];
  if (typeof rawSequence !== "number" || !Number.isInteger(rawSequence) || rawSequence < 0) {
    rejections.push(snapshotRejection("snapshot/sequence-invalid", "sequence must be a non-negative integer"));
  } else {
    sequence = rawSequence;
  }

  let requiredCapabilities: readonly CapabilityId[] | undefined;
  const rawCapabilities = record["requiredCapabilities"];
  if (rawCapabilities === undefined) {
    requiredCapabilities = Object.freeze([]);
  } else if (!Array.isArray(rawCapabilities) || rawCapabilities.some((entry) => typeof entry !== "string")) {
    rejections.push(snapshotRejection("snapshot/capabilities-invalid", "requiredCapabilities must be an array of capability ids"));
  } else {
    requiredCapabilities = Object.freeze([...(rawCapabilities as readonly CapabilityId[])]);
  }

  if (
    rejections.length > 0 ||
    jobId === undefined ||
    callId === undefined ||
    tool === undefined ||
    surface === undefined ||
    status === undefined ||
    attempts === undefined ||
    maxAttempts === undefined ||
    sequence === undefined ||
    requiredCapabilities === undefined
  ) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }

  const snapshot: ToolJobSnapshot = {
    kind: "tool-job-snapshot",
    jobId,
    callId,
    tool,
    surfaceVersion: surface,
    input: record["input"],
    requiredCapabilities,
    status,
    attempts,
    maxAttempts,
    cancellationRequested: record["cancellationRequested"] === true,
    queuedAt: typeof record["queuedAt"] === "number" ? record["queuedAt"] : 0,
    sequence,
    ...(record["idempotencyKey"] === undefined ? {} : { idempotencyKey: record["idempotencyKey"] as IdempotencyKey }),
    ...(record["deadline"] === undefined ? {} : { deadline: record["deadline"] as Deadline }),
  };
  return { outcome: "ok", snapshot: Object.freeze(snapshot) };
}

/** The stored record shape: a job snapshot plus its terminal outcome, if any. */
export interface JobStoreRecord {
  readonly kind: "job-store-record";
  readonly job: ToolJobSnapshot;
  readonly outcome?: ToolCallOutcome;
}

export type RecordRejectionCode = "record/not-an-object" | "record/job-invalid" | "record/outcome-invalid";

export interface RecordRejection {
  readonly code: RecordRejectionCode;
  readonly message: string;
}

export type JobStoreRecordValidation =
  | { readonly outcome: "ok"; readonly record: JobStoreRecord }
  | { readonly outcome: "rejected"; readonly rejections: readonly RecordRejection[] };

/** Validates an untrusted stored record (restore path). Total; never throws. */
export function validateJobStoreRecord(input: unknown): JobStoreRecordValidation {
  const record = plainRecord(input);
  if (record === null) {
    return {
      outcome: "rejected",
      rejections: [Object.freeze({ code: "record/not-an-object", message: "job store record must be a non-array object" })],
    };
  }
  const rejections: RecordRejection[] = [];

  let job: ToolJobSnapshot | undefined;
  const jobCheck = validateToolJobSnapshot(record["job"]);
  if (jobCheck.outcome === "ok") {
    job = jobCheck.snapshot;
  } else {
    rejections.push({ code: "record/job-invalid", message: jobCheck.rejections.map((item) => item.message).join("; ") });
  }

  const outcome = record["outcome"];
  if (outcome !== undefined && !isToolCallOutcome(outcome)) {
    rejections.push({ code: "record/outcome-invalid", message: "recorded outcome must be a well-formed tool call outcome" });
  }

  if (rejections.length > 0 || job === undefined) {
    return { outcome: "rejected", rejections: Object.freeze(rejections) };
  }
  const stored: JobStoreRecord = {
    kind: "job-store-record",
    job,
    ...(outcome === undefined ? {} : { outcome: outcome as ToolCallOutcome }),
  };
  return { outcome: "ok", record: Object.freeze(stored) };
}

function plainRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}
