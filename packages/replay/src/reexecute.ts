/**
 * THE DETERMINISTIC RE-EXECUTION ENGINE (E9 + lock 12 + lock 15).
 *
 * Re-executes a recorded replay against a FRESH runtime session: every
 * recorded command re-enters through the target's canonical admission
 * entry (`submitRecordedCommand` — E2, no second command channel), the
 * session advances to the recorded final tick, and the post-boundary event
 * stream is read back for comparison against the recorded witness.
 *
 * The engine NEVER imports a runtime: it drives the {@link ReplayTarget}
 * port, which the Simulation Runtime session satisfies structurally (lock
 * 12 — replay is a platform primitive above both runtimes). The launcher
 * port starts sessions at the origin or at a snapshot boundary (the same
 * boundary rule the record's capture range encodes).
 *
 * Determinism guarantee being exercised: same seed + same admitted command
 * stream → byte-identical event streams (the simulation package's
 * tested E9 property; this engine makes it a replay check).
 *
 * Pure module: no IO, no clocks (timestamps come from artifacts).
 */

import type { DeterminismSeed, RuntimeEventEnvelope, SessionId } from "@playliquid/runtime-contracts";
import type { GameIRValue } from "@playliquid/game-ir";
import type { RuntimeCommandEnvelope } from "@playliquid/runtime-contracts";
import type { CommandStreamArtifact } from "./command-stream.ts";
import { verifyCommandStream } from "./command-stream.ts";
import type { ReplayRecord } from "./record.ts";
import type { ReplaySource } from "./source.ts";
import type { ReplayBoundaryRef } from "./record.ts";
import { eventEnvelopeForm } from "./event-witness.ts";

/** The submission-side result shape the target must return (E2 entry). */
export type TargetSubmission =
  | { readonly status: "submitted" }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

/** The tick-advance result shape the target must return. */
export type TargetAdvance =
  | { readonly status: "advanced" }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

/**
 * A fresh re-execution session. The Simulation Runtime's session satisfies
 * this structurally (`submitRecordedCommand`, `advanceToTick`,
 * `readEvents`).
 */
export interface ReplayTargetSession {
  readonly sessionId: SessionId;
  /** The canonical command admission entry (recorded envelope re-feed). */
  submitRecordedCommand(envelope: RuntimeCommandEnvelope<GameIRValue>, dueTick: number): TargetSubmission;
  /** Advance to exactly `tick` (logical time only). */
  advanceToTick(tick: number): TargetAdvance;
  /** Events with seq strictly greater than `afterEventSeq`. */
  readEvents(afterEventSeq: number): readonly RuntimeEventEnvelope<GameIRValue>[];
}

/** Result of launching a fresh re-execution target. */
export type ReplayTargetLaunch =
  | {
      readonly status: "launched";
      readonly session: ReplayTargetSession;
      /** The event-seq boundary the session starts after (0 at origin). */
      readonly afterEventSeq: number;
      readonly tick: number;
    }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string };

/**
 * Starts fresh re-execution sessions: at the origin (tick 0, empty log) or
 * at a snapshot boundary (adopting the recorded continuation state). The
 * capturing runtime implements this glue; the engine stays runtime-agnostic.
 */
export interface ReplayTargetLauncher {
  launchAtOrigin(input: { readonly sessionId: SessionId; readonly seed: DeterminismSeed }): ReplayTargetLaunch;
  launchAtBoundary(input: {
    readonly sessionId: SessionId;
    readonly seed: DeterminismSeed;
    readonly boundary: ReplayBoundaryRef;
  }): ReplayTargetLaunch;
}

/** Typed rejection codes of the re-execution engine. */
export type ReExecutionErrorCode =
  | "unknown-replay"
  | "stream-missing"
  | "stream-unverifiable"
  | "incoherent-stream"
  | "launch-rejected"
  | "command-rejected"
  | "advance-rejected";

/** The successful re-execution outcome. */
export interface ReExecutionSuccess {
  readonly status: "re-executed";
  /** The event-seq boundary the run continued from (0 at origin). */
  readonly boundaryEventSeq: number;
  readonly finalTick: number;
  /** The re-executed post-boundary event stream, in sequence order. */
  readonly events: readonly RuntimeEventEnvelope<GameIRValue>[];
  /** How many recorded commands were re-admitted. */
  readonly submittedCommands: number;
}

export type ReExecutionResult =
  | ReExecutionSuccess
  | { readonly status: "rejected"; readonly code: ReExecutionErrorCode; readonly detail: string };

/**
 * Re-executes one recorded replay end-to-end. Command entries are fed in
 * RECORDED ADMISSION ORDER (which reproduces the live run's scheduling
 * exactly); the session advances to the recorded final tick; the
 * post-boundary events are returned for comparison. Every failure is a
 * typed rejection (never a silent partial run).
 */
export function reExecuteReplay(input: {
  readonly replayId: string;
  readonly source: ReplaySource;
  readonly launcher: ReplayTargetLauncher;
}): ReExecutionResult {
  const record = input.source.loadReplay(input.replayId);
  if (record === undefined) {
    return { status: "rejected", code: "unknown-replay", detail: `no replay record ${input.replayId}` };
  }
  const stream = input.source.loadCommandStream(record.commandStream);
  if (stream === undefined) {
    return { status: "rejected", code: "stream-missing", detail: `no command stream ${record.commandStream}` };
  }
  const streamVerification = verifyCommandStream(stream);
  if (!streamVerification.ok) {
    return { status: "rejected", code: "stream-unverifiable", detail: `${streamVerification.code}: ${streamVerification.detail}` };
  }
  const coherence = checkStreamCoherence(stream, record);
  if (coherence !== null) {
    return { status: "rejected", code: "incoherent-stream", detail: coherence };
  }
  const boundaryTick = record.capture.boundary?.tick ?? 0;
  const launch = record.capture.boundary !== undefined
    ? input.launcher.launchAtBoundary({
        sessionId: record.sessionId,
        seed: record.determinism,
        boundary: record.capture.boundary,
      })
    : input.launcher.launchAtOrigin({ sessionId: record.sessionId, seed: record.determinism });
  if (launch.status === "rejected") {
    return { status: "rejected", code: "launch-rejected", detail: `${launch.code}: ${launch.detail}` };
  }
  const boundarySeq = record.capture.fromEventSeq - 1;
  if (launch.afterEventSeq !== boundarySeq) {
    return {
      status: "rejected",
      code: "launch-rejected",
      detail: `launcher boundary seq ${launch.afterEventSeq} does not match the record capture start ${boundarySeq}`,
    };
  }
  for (const entry of stream.entries) {
    const submission = launch.session.submitRecordedCommand(entry.envelope, entry.dueTick);
    if (submission.status === "rejected") {
      return {
        status: "rejected",
        code: "command-rejected",
        detail: `command ${entry.envelope.commandId} (admissionSeq ${entry.admissionSeq}) rejected: ${submission.code}: ${submission.detail}`,
      };
    }
  }
  if (record.capture.toTick > boundaryTick) {
    const advance = launch.session.advanceToTick(record.capture.toTick);
    if (advance.status === "rejected") {
      return { status: "rejected", code: "advance-rejected", detail: `${advance.code}: ${advance.detail}` };
    }
  }
  return {
    status: "re-executed",
    boundaryEventSeq: boundarySeq,
    finalTick: record.capture.toTick,
    events: launch.session.readEvents(boundarySeq),
    submittedCommands: stream.entries.length,
  };
}

/** Structural coherence of a command stream against its record. */
function checkStreamCoherence(stream: CommandStreamArtifact, record: ReplayRecord): string | null {
  const boundaryTick = record.capture.boundary?.tick ?? 0;
  for (const entry of stream.entries) {
    if (entry.envelope.sessionId !== record.sessionId) {
      return `entry ${entry.envelope.commandId} targets session ${String(entry.envelope.sessionId)}, record holds ${String(record.sessionId)}`;
    }
    if (entry.dueTick <= boundaryTick) {
      return `entry ${entry.envelope.commandId} due at tick ${entry.dueTick} is not after the boundary tick ${boundaryTick}`;
    }
    if (entry.dueTick > record.capture.toTick) {
      return `entry ${entry.envelope.commandId} due at tick ${entry.dueTick} is beyond the capture end tick ${record.capture.toTick}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recorded vs re-executed comparison (the QA/integrity evidence core)
// ---------------------------------------------------------------------------

/** One byte-level divergence between a recorded and a re-executed stream. */
export interface EventDivergence {
  readonly seq: number;
  readonly recordedForm: string;
  readonly reexecutedForm: string;
}

/** Typed comparison result of two event streams. */
export type EventStreamEquality =
  | { readonly equal: true; readonly comparedCount: number }
  | {
      readonly equal: false;
      readonly lengthMismatch: boolean;
      readonly comparedCount: number;
      readonly divergences: readonly EventDivergence[];
    };

/**
 * Compares a recorded event stream against a re-executed one, event by
 * event, by canonical bytes. Reports length mismatch and every divergence
 * up to the shorter stream's end (plus the missing tail as an explicit
 * `lengthMismatch` flag).
 */
export function compareEventStreams(
  recorded: readonly RuntimeEventEnvelope<GameIRValue>[],
  reexecuted: readonly RuntimeEventEnvelope<GameIRValue>[],
  options: { readonly maxDivergences?: number } = {},
): EventStreamEquality {
  const limit = options.maxDivergences ?? 8;
  const divergences: EventDivergence[] = [];
  const compared = Math.min(recorded.length, reexecuted.length);
  for (let index = 0; index < compared; index += 1) {
    const left = recorded[index];
    const right = reexecuted[index];
    if (left === undefined || right === undefined) break;
    const recordedForm = eventEnvelopeForm(left);
    const reexecutedForm = eventEnvelopeForm(right);
    if (recordedForm !== reexecutedForm) {
      divergences.push({ seq: Number(left.seq), recordedForm, reexecutedForm });
      if (divergences.length >= limit) break;
    }
  }
  if (divergences.length > 0 || recorded.length !== reexecuted.length) {
    return {
      equal: false,
      lengthMismatch: recorded.length !== reexecuted.length,
      comparedCount: compared,
      divergences,
    };
  }
  return { equal: true, comparedCount: compared };
}
