/**
 * Module role: the injected ports of the Tool Fabric runtime — the pure
 * seams every piece of IO, wall-clock time and provider detail hides behind
 * (E3). The domain and app layers depend only on these interfaces; the
 * node process adapter, the in-memory fakes and any provider SDK live in
 * the adapters layer / host composition. Also defines the job event and
 * store ports that carry the E6 durability and observability duties.
 *
 * Implements: PL-019 executor/clock/exchange/store ports; spec/requirements
 * E3 (SDKs and IO behind adapters/ports), E6 (durable/queued/resumable).
 */

import type { ArtifactDigest, ArtifactRef } from "./exchange.ts";
import type { ToolRegistration } from "./registry.ts";
import type { JobId, JobStoreRecord } from "./job.ts";
import type {
  CallId,
  CancellationReason,
  Deadline,
  InputIssue,
  SchemaShapeRef,
  ToolCallCancellation,
  ToolCallOutcome,
} from "@playliquid/tool-fabric";

/**
 * Time seam. The domain and app layers NEVER read the wall clock; every
 * timestamp (admission, events, deadline math) flows through this port so
 * decisions stay deterministic and replay-testable.
 */
export interface ClockPort {
  now(): number;
}

/**
 * Shape validation seam. Tool descriptors reference input/output shapes by
 * {@link SchemaShapeRef} (never inline schemas); the host registers the
 * shape validators behind this port. An empty catalog yields a typed
 * rejection for every validated call — unvalidated input is never silently
 * accepted.
 */
export interface ShapeCatalogPort {
  validate(shape: SchemaShapeRef, input: unknown): ShapeCheck;
}

export type ShapeCheck =
  | { readonly outcome: "ok" }
  | { readonly outcome: "rejected"; readonly issues: readonly InputIssue[] };

/** What the artifact exchange reports for a reference. */
export type ArtifactResolution =
  | { readonly outcome: "resolved"; readonly artifact: StoredArtifact }
  | { readonly outcome: "missing"; readonly digest: ArtifactDigest }
  | { readonly outcome: "corrupt"; readonly digest: ArtifactDigest; readonly reason: string };

/** Content-addressed artifact metadata resolved from the exchange. */
export interface StoredArtifact {
  readonly digest: ArtifactDigest;
  readonly bytes: number;
}

/**
 * The content-addressed artifact exchange (E7 spirit): artifacts are stored
 * out-of-band and flow through tool calls ONLY by reference. Executors
 * materialize references for the real tool process and publish outputs back
 * into the exchange BEFORE returning; the pipeline verifies that every
 * referenced artifact resolves.
 */
export interface ArtifactExchangePort {
  resolve(ref: ArtifactRef): Promise<ArtifactResolution>;
}

/** One prepared execution handed to the executor seam. */
export interface ExecutorDispatch {
  readonly kind: "executor-dispatch";
  readonly callId: CallId;
  /** The resolved tool registration the invocation runs through. */
  readonly registration: ToolRegistration;
  /** The validated call input (exchange-guarded, artifact refs verified). */
  readonly input: unknown;
  /** Effective deadline (request deadline or descriptor default), if any. */
  readonly deadline?: Deadline;
  /** Live cancellation token, if the call carries one. */
  readonly cancellation?: ToolCallCancellation;
}

export type ExecutorRefusalCode =
  | "executor/adapter-refused"
  | "executor/adapter-failed"
  | "executor/invalid-dispatch";

/** The executor refused to run the dispatch (typed, never thrown). */
export interface ExecutorRefused {
  readonly outcome: "refused";
  readonly code: ExecutorRefusalCode;
  readonly message: string;
  /** The underlying provider-neutral adapter code, when one was reported. */
  readonly adapterCode?: string;
}

export type ExecutorResult =
  | { readonly outcome: "executed"; readonly output: unknown; readonly finishedAt: number }
  | ExecutorRefused
  | { readonly outcome: "timeout"; readonly deadline: Deadline }
  | { readonly outcome: "cancelled"; readonly reason: CancellationReason };

/**
 * The pure execution seam. Implementations own the IO: the node process
 * adapter spawns real processes and enforces deadlines/output caps; the
 * adapter-dispatch executor forwards to the registration's neutral adapter.
 * Contract obligations:
 * - honor the dispatch deadline (typed timeout) and cancellation token
 *   (typed cancelled) — never return a result that ignores them;
 * - never throw — every problem is a typed result;
 * - publish any output artifacts to the exchange before returning.
 */
export interface ToolExecutorPort {
  execute(dispatch: ExecutorDispatch): Promise<ExecutorResult>;
}

export type JobEventType =
  | "admitted"
  | "started"
  | "retry-scheduled"
  | "succeeded"
  | "failed"
  | "timed-out"
  | "cancelled";

/**
 * One job event. Sequence numbers are per-job, strictly increasing from 1;
 * `at` comes from the injected clock. Terminal events carry the final
 * tool call outcome. Event order per job is binding:
 * admitted → started → (retry-scheduled → started)* → terminal.
 */
export interface JobEvent {
  readonly kind: "tool-job-event";
  readonly jobId: JobId;
  readonly type: JobEventType;
  readonly sequence: number;
  readonly at: number;
  readonly outcome?: ToolCallOutcome;
}

/** Observability seam for job events (host-owned). */
export interface JobEventSink {
  emit(event: JobEvent): void;
}

/**
 * Durability seam (E6): the queue appends a record on EVERY transition
 * (loadAll returns records in persistence order — the store is a
 * transition log); restore reduces per jobId, the last record for a job
 * being its authoritative state. In-memory implementations are test
 * doubles — truthful environment limitation (E11): process-local memory
 * is NOT durable across restarts; real durability is the host's port
 * implementation.
 */
export interface JobStorePort {
  persist(record: JobStoreRecord): Promise<void>;
  loadAll(): Promise<readonly JobStoreRecord[]>;
}
