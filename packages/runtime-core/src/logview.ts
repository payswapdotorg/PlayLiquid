/**
 * CANONICAL EVENT LOG VIEW — segmented validation across epoch boundaries.
 *
 * The kernel's event log is globally append-only (E10: history is never
 * rewritten) with 1-based gapless sequences. `reset` and `restore` advance
 * the session EPOCH and legitimately rewind world TIME (tick), so the raw
 * log cannot be validated as one flat stream — tick monotonicity only
 * holds WITHIN an epoch segment.
 *
 * Segmentation rule: a boundary event (`runtime.session-reset` or
 * `runtime.session-restored`) STARTS a new segment. Each segment is then
 * validated independently with the contract order oracle
 * (`validateEventStream`, startAtSeq chained from the previous segment's
 * head), so the WHOLE log still satisfies the single canonical event path
 * (E2) — one oracle, applied per epoch.
 */

import { validateEventStream } from "@playliquid/runtime-contracts";
import type { CommandId, EventStreamValidation, RuntimeEventEnvelope } from "@playliquid/runtime-contracts";

/** Kernel event kinds that start a new epoch segment in the log. */
export const SESSION_BOUNDARY_EVENT_KINDS: readonly string[] = [
  "runtime.session-reset",
  "runtime.session-restored",
];

/** Whether an event is an epoch boundary marker. */
export function isSessionBoundaryEvent(event: RuntimeEventEnvelope): boolean {
  return SESSION_BOUNDARY_EVENT_KINDS.includes(String(event.kind));
}

/**
 * Split a log into epoch segments (boundary events start new segments).
 * Pure; the input array is never mutated.
 */
export function splitLogSegments(
  events: readonly RuntimeEventEnvelope[],
): readonly (readonly RuntimeEventEnvelope[])[] {
  const segments: RuntimeEventEnvelope[][] = [];
  let current: RuntimeEventEnvelope[] = [];
  for (const event of events) {
    if (isSessionBoundaryEvent(event) && current.length > 0) {
      segments.push(current);
      current = [];
    }
    current.push(event);
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

/**
 * Validate the whole kernel log: each epoch segment must satisfy the
 * contract order oracle (session identity, contiguous sequences from the
 * segment head, non-decreasing ticks within the segment, causal soundness
 * against the admitted command set). Returns the first violation or the
 * aggregated span.
 */
export function validateKernelEventLog(
  events: readonly RuntimeEventEnvelope[],
  admittedCommandIds: readonly CommandId[],
): EventStreamValidation {
  if (events.length === 0) {
    return { ok: false, code: "empty-stream", index: 0, detail: "event stream is empty" };
  }
  const first = events[0];
  if (first === undefined) {
    return { ok: false, code: "empty-stream", index: 0, detail: "event stream is empty" };
  }
  const segments = splitLogSegments(events);
  let count = 0;
  for (const segment of segments) {
    const head = segment[0];
    if (head === undefined) {
      return { ok: false, code: "empty-stream", index: 0, detail: "empty log segment" };
    }
    const validation = validateEventStream(segment, {
      startAtSeq: head.seq,
      admittedCommandIds,
    });
    if (!validation.ok) {
      const offset = events.indexOf(head);
      return { ...validation, index: validation.index + Math.max(offset, 0) };
    }
    count += segment.length;
  }
  const last = events[events.length - 1];
  return {
    ok: true,
    span: {
      sessionId: first.sessionId,
      firstSeq: first.seq,
      lastSeq: last === undefined ? first.seq : last.seq,
      count,
    },
  };
}
