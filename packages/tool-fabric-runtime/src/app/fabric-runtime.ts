/**
 * Module role: the Tool Fabric runtime facade — the single composition
 * point callers hold. Composes a fresh registry, the invocation pipeline
 * and the job queue over INJECTED ports (clock, executor, shape catalog,
 * artifact exchange). The facade delegates; it never bypasses the pipeline
 * (E2) and owns no execution state itself (E1). Real IO wiring lives in
 * the adapters layer (runtime-composition).
 *
 * Implements: PL-019 facade scope; R12/R13 groundwork — engine and tool
 * orchestration reaches providers ONLY through registrations on this
 * runtime.
 */

import type { CapabilityId, ToolCallOutcome } from "@playliquid/tool-fabric";
import type { ToolRegistration, RegistrationCheck, UnregisterCheck } from "../domain/registry.ts";
import { createToolFabricRegistry } from "../domain/registry.ts";
import type { ArtifactExchangePort, ClockPort, JobEventSink, JobStorePort, ShapeCatalogPort, ToolExecutorPort } from "../domain/ports.ts";
import type { LedgerEntry } from "./pipeline.ts";
import { createInvocationPipeline } from "./pipeline.ts";
import type { JobAdmission, JobCancelCheck, JobRestoreCheck, JobStatusQuery, ToolJobQueue } from "./queue.ts";
import { createToolJobQueue } from "./queue.ts";
import type { JobId, ToolJobSnapshot } from "../domain/job.ts";

export interface ToolFabricRuntimeDeps {
  readonly clock: ClockPort;
  readonly executor: ToolExecutorPort;
  readonly shapeCatalog: ShapeCatalogPort;
  readonly artifactExchange: ArtifactExchangePort;
  readonly eventSink?: JobEventSink;
  readonly jobStore?: JobStorePort;
  readonly grantedCapabilities?: readonly CapabilityId[];
}

export interface ToolFabricRuntime {
  /** Registers a tool behind an adapter. Typed rejection on any problem. */
  registerTool(input: unknown): RegistrationCheck;
  /** Removes the registration for a tool identity + surface major. */
  unregisterTool(identity: unknown, surfaceMajor: number): UnregisterCheck;
  /** All registrations, deterministic order. */
  listTools(): readonly ToolRegistration[];
  /** Registrations whose descriptors declare the capability. */
  discoverTools(capability: CapabilityId): readonly ToolRegistration[];
  /** Synchronous tool call through the invocation pipeline. */
  invokeToolCall(request: unknown, grantedCapabilities?: readonly CapabilityId[]): Promise<ToolCallOutcome>;
  /** Admits an async tool job ({ jobId, call, maxAttempts? }). */
  enqueueJob(request: unknown): Promise<JobAdmission>;
  /** Cancels a queued job immediately; signals a running job. */
  cancelJob(jobId: JobId): Promise<JobCancelCheck>;
  /** Current snapshot of a job, or unknown. */
  jobStatus(jobId: JobId): JobStatusQuery;
  /** Drives queued jobs (deterministic order, host-driven). */
  pumpJobs(): Promise<void>;
  /** All job snapshots. */
  jobSnapshots(): readonly ToolJobSnapshot[];
  /** Restores job records (durable resume, E6). */
  restoreJobs(records: readonly unknown[]): Promise<JobRestoreCheck>;
  /** Snapshot of the completed idempotency ledger. */
  ledgerSnapshot(): readonly LedgerEntry[];
}

const NULL_EVENT_SINK: JobEventSink = Object.freeze({ emit: () => undefined });

/** Creates the Tool Fabric runtime over injected ports. */
export function createToolFabricRuntime(deps: ToolFabricRuntimeDeps): ToolFabricRuntime {
  const registry = createToolFabricRegistry();
  const pipeline = createInvocationPipeline({
    registry,
    clock: deps.clock,
    executor: deps.executor,
    shapeCatalog: deps.shapeCatalog,
    artifactExchange: deps.artifactExchange,
    grantedCapabilities: deps.grantedCapabilities,
  });
  const queue: ToolJobQueue = createToolJobQueue({
    pipeline,
    clock: deps.clock,
    eventSink: deps.eventSink ?? NULL_EVENT_SINK,
    ...(deps.jobStore === undefined ? {} : { jobStore: deps.jobStore }),
    ...(deps.grantedCapabilities === undefined ? {} : { grantedCapabilities: deps.grantedCapabilities }),
  });

  function registerTool(input: unknown): RegistrationCheck {
    return registry.register(input);
  }

  function unregisterTool(identity: unknown, surfaceMajor: number): UnregisterCheck {
    return registry.unregister(identity, surfaceMajor);
  }

  function invokeToolCall(request: unknown, grantedCapabilities?: readonly CapabilityId[]): Promise<ToolCallOutcome> {
    return pipeline.invoke(request, grantedCapabilities);
  }

  function enqueueJob(request: unknown): Promise<JobAdmission> {
    return queue.enqueue(request);
  }

  function cancelJob(jobId: JobId): Promise<JobCancelCheck> {
    return queue.cancel(jobId);
  }

  function jobStatus(jobId: JobId): JobStatusQuery {
    return queue.status(jobId);
  }

  function pumpJobs(): Promise<void> {
    return queue.pump();
  }

  function jobSnapshots(): readonly ToolJobSnapshot[] {
    return queue.snapshot();
  }

  function restoreJobs(records: readonly unknown[]): Promise<JobRestoreCheck> {
    return queue.restore(records);
  }

  function ledgerSnapshot(): readonly LedgerEntry[] {
    return pipeline.ledgerSnapshot();
  }

  return Object.freeze({
    registerTool,
    unregisterTool,
    listTools: () => registry.list(),
    discoverTools: (capability: CapabilityId) => registry.discoverByCapability(capability),
    invokeToolCall,
    enqueueJob,
    cancelJob,
    jobStatus,
    pumpJobs,
    jobSnapshots,
    restoreJobs,
    ledgerSnapshot,
  });
}
