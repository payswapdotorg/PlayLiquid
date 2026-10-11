/**
 * RUNTIME SESSION READ MODELS (pure): project runtime-core authoritative
 * results and read models (PL-013) — kernel operation results (typed
 * unions, epoch-tagged), session snapshot views and experience observations
 * — into the studio Sessions surface: a session header card, counter rows
 * and an append-only operation timeline. The kernel remains the single
 * owner of session state; these projections are READ MODELS only (E5).
 *
 * Pure module: no IO, no React, no clock.
 */

import type {
  ActResult,
  LoadResult,
  ObserveResult,
  ReplayResult,
  ResetResult,
  RestoreResult,
  SnapshotResult,
  StepResult,
  TerminateResult,
} from "@playliquid/runtime-core";
import type {
  ExperienceObservation,
  RuntimeSessionSnapshotView,
} from "@playliquid/runtime-contracts";
import { outcomeStatus, phaseStatus } from "./status.ts";

/** A typed union of every kernel operation result the studio tracks. */
export type SessionOperation =
  | LoadResult
  | ObserveResult
  | ActResult
  | StepResult
  | ResetResult
  | SnapshotResult
  | RestoreResult
  | ReplayResult
  | TerminateResult;

/** One timeline row: the operation, its outcome and its epoch tag. */
export interface SessionTimelineRow {
  readonly operation: string;
  readonly status: ReturnType<typeof outcomeStatus>;
  /** Human detail; rejection code/detail or success counters. */
  readonly detail: string;
  /** Epoch the result was produced under (stale-result rule surface). */
  readonly epoch: number;
  /** Whether this result is stale relative to the session's current epoch. */
  readonly stale: boolean;
}

/** The session header card. */
export interface SessionCardView {
  readonly sessionId: string;
  readonly role: string;
  readonly phase: ReturnType<typeof phaseStatus>;
  readonly epoch: number;
  readonly tick: number;
  readonly committedEventSeq: number;
  readonly admittedCommandSeq: number;
}

/** The Sessions surface view model. */
export interface SessionView {
  readonly card: SessionCardView | undefined;
  readonly timeline: readonly SessionTimelineRow[];
  readonly latestEvents: readonly { readonly seq: number; readonly kind: string }[];
}

function rejectionDetail(result: Extract<SessionOperation, { status: "rejected" | "failed" }>): string {
  const code = result.status === "rejected" ? result.code : result.code;
  const suffix = "denial" in result && result.denial !== undefined
    ? ` (denied: ${String(result.denial)})`
    : "";
  return `${code}: ${result.detail}${suffix}`;
}

/** The operation label of a result, derived from its success shape. */
export function operationLabel(result: SessionOperation): string {
  switch (result.status) {
    case "loaded":
    case "rejected":
      return "load";
    case "observed":
      return "observe";
    case "committed":
    case "duplicate":
      return "act";
    case "stepped":
      return "step";
    case "reset":
      return "reset";
    case "snapshotted":
      return "snapshot";
    case "restored":
      return "restore";
    case "replayed":
      return "replay";
    case "terminated":
      return "terminate";
    default:
      return "operation";
  }
}

function successDetail(result: SessionOperation): string {
  switch (result.status) {
    case "loaded":
      return `${result.events.length} events`;
    case "observed":
      return `tick ${String(result.observation.tick)} · ${result.observation.events.length} events · cursor ${String(result.observation.nextCursor)}`;
    case "committed":
      return `command ${String(result.commandId)} @seq ${String(result.commandSeq)} · ${result.events.length} events`;
    case "duplicate":
      return `idempotent replay of ${String(result.firstCommandId)} (E8 anti-gaming receipt)`;
    case "stepped":
      return `tick ${String(result.fromTick)} → ${String(result.toTick)} · ${result.events.length} events`;
    case "reset":
      return `epoch advanced to ${String(result.epoch)} · ${result.events.length} events`;
    case "snapshotted":
      return `snapshot ${String(result.snapshot.snapshotId)}`;
    case "restored":
      return `restored at tick ${String(result.restoredTick)} · ${result.events.length} events`;
    case "replayed":
      return `seq ${String(result.fromSeq)} → ${String(result.toSeq)} · ${result.events.length} events`;
    case "terminated":
      return `${result.events.length} drain events`;
    default:
      return "";
  }
}

function rowOf(result: SessionOperation, currentEpoch: number | undefined): SessionTimelineRow {
  const status = outcomeStatus(result.status);
  const detail = result.status === "rejected" || result.status === "failed"
    ? rejectionDetail(result)
    : successDetail(result);
  const epoch =
    "epoch" in result
      ? Number(result.epoch)
      : "observation" in result
        ? Number(result.observation.epoch)
        : 0;
  return {
    operation: operationLabel(result),
    status,
    detail,
    epoch,
    stale: currentEpoch !== undefined && epoch < currentEpoch,
  };
}

/**
 * Project one session snapshot + a sequence of operation results into the
 * Sessions view. Timeline is append-only in arrival order (E10: history is
 * never rewritten); `stale` flags results produced under an older epoch.
 */
export function projectSession(
  snapshot: RuntimeSessionSnapshotView | undefined,
  operations: readonly SessionOperation[],
  latestObservation?: ExperienceObservation,
): SessionView {
  const card: SessionCardView | undefined = snapshot === undefined ? undefined : {
    sessionId: String(snapshot.sessionId),
    role: snapshot.role,
    phase: phaseStatus(snapshot.phase),
    epoch: Number(snapshot.epoch),
    tick: Number(snapshot.tick),
    committedEventSeq: snapshot.committedEventSeq,
    admittedCommandSeq: snapshot.admittedCommandSeq,
  };
  const currentEpoch = card?.epoch;
  const timeline = operations.map((operation) => rowOf(operation, currentEpoch));
  const latestEvents = latestObservation === undefined
    ? []
    : latestObservation.events.map((event) => ({
        seq: Number(event.seq),
        kind: String(event.kind),
      }));
  return { card, timeline, latestEvents };
}

/** Deterministic summary line for headers. */
export function sessionSummary(view: SessionView): string {
  const card = view.card;
  if (card === undefined) return "no active session";
  const last = view.timeline.length === 0
    ? "no operations yet"
    : `last: ${view.timeline[view.timeline.length - 1]?.operation ?? ""} ${view.timeline[view.timeline.length - 1]?.status.label ?? ""}`;
  return `session ${card.sessionId} · ${card.phase.label} · epoch ${card.epoch} · tick ${card.tick} · ${last}`;
}
