/**
 * TOOL FABRIC READ MODELS (pure): project tool-fabric-runtime authoritative
 * data (PL-019) — the adapter registration table (ToolRegistration[]),
 * the queued job model snapshots (ToolJobSnapshot[]) and emitted job
 * events — into the studio Tools surface: registration rows, job rows and
 * a job-event timeline. The runtime owns all job/registration state (E1);
 * this module only projects it (E5).
 *
 * Pure module: no IO, no React, no clock.
 */

import type { ToolJobSnapshot, ToolRegistration } from "@playliquid/tool-fabric-runtime";
import { adapterStatus, toolJobStatus } from "./status.ts";

/** One adapter registration row. */
export interface RegistrationRow {
  readonly toolId: string;
  readonly title: string;
  readonly surface: string;
  readonly adapterId: string;
  readonly adapterLabel: string;
  readonly adapterState: ReturnType<typeof adapterStatus>;
  readonly dispatchCapability: string;
  readonly capabilities: readonly string[];
}

/** One tool job row. */
export interface JobRow {
  readonly jobId: string;
  readonly callId: string;
  readonly toolId: string;
  readonly status: ReturnType<typeof toolJobStatus>;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly sequence: number;
}

/** One job-event timeline entry. */
export interface JobEventRow {
  readonly jobId: string;
  readonly type: string;
  readonly sequence: number;
}

/** The Tools surface view model. */
export interface ToolsView {
  readonly registrations: readonly RegistrationRow[];
  readonly jobs: readonly JobRow[];
  readonly events: readonly JobEventRow[];
  readonly activeCount: number;
}

/** A job event as emitted by the runtime's JobEventSink (structural read). */
export interface JobEventLike {
  readonly jobId: string;
  readonly type: string;
  readonly sequence: number;
}

/** Deterministic tool id text: `namespace/name` (tool-fabric vocabulary). */
export function toolIdText(tool: { readonly namespace: string; readonly name: string }): string {
  return `${tool.namespace}/${tool.name}`;
}

/** Deterministic surface text: `vMAJOR.MINOR` (SurfaceVersion is an object, never String() it). */
export function surfaceText(surface: { readonly major: number; readonly minor: number }): string {
  return `v${surface.major}.${surface.minor}`;
}

/**
 * Project registrations + job snapshots (+ observed job events) into the
 * Tools view. Jobs sort by descending sequence; registrations by tool id.
 * `activeCount` counts non-terminal jobs (queued or running).
 */
export function projectTools(
  registrations: readonly ToolRegistration[],
  jobs: readonly ToolJobSnapshot[],
  events?: readonly JobEventLike[],
): ToolsView {
  const registrationRows: RegistrationRow[] = registrations
    .map((registration) => ({
      toolId: toolIdText(registration.descriptor.identity),
      title: registration.descriptor.title,
      surface: surfaceText(registration.descriptor.surfaceVersion),
      adapterId: String(registration.adapter.id),
      adapterLabel: registration.adapter.label,
      adapterState: adapterStatus(String(registration.adapter.state)),
      dispatchCapability: String(registration.dispatchCapability),
      capabilities: registration.adapter.offeredCapabilities.map((capability) => String(capability)),
    }))
    .sort((a, b) => a.toolId.localeCompare(b.toolId));

  const jobRows: JobRow[] = jobs
    .map((job) => ({
      jobId: job.jobId,
      callId: job.callId,
      toolId: toolIdText(job.tool),
      status: toolJobStatus(job.status),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      sequence: job.sequence,
    }))
    .sort((a, b) => b.sequence - a.sequence);

  const eventRows: JobEventRow[] = (events ?? [])
    .map((event) => ({ jobId: event.jobId, type: event.type, sequence: event.sequence }))
    .sort((a, b) => b.sequence - a.sequence);

  const activeCount = jobRows.filter(
    (job) => job.status.label === "queued" || job.status.label === "running",
  ).length;

  return { registrations: registrationRows, jobs: jobRows, events: eventRows, activeCount };
}

/** Deterministic summary line for headers. */
export function toolsSummary(view: ToolsView): string {
  const registrations = view.registrations.length;
  const jobs = view.jobs.length;
  return `${registrations} registered tool${registrations === 1 ? "" : "s"} · ${jobs} job${jobs === 1 ? "" : "s"} (${view.activeCount} active)`;
}
