/**
 * REPLAY / RESUME BOUNDARY CONTRACTS (lock rule 15: replay is a platform
 * primitive; requirement R8).
 *
 * Async/stateful documentation (worker-contract "Async/stateful work"), the
 * portions owned by this module:
 *
 * - Replay/resume boundary: replay ALWAYS begins either at event seq 1 (the
 *   origin of the session) or at `snapshot.afterEventSeq + 1` of a persisted
 *   snapshot. There are no mid-stream starts: any other start position is
 *   refused (`mid-stream-start`). This is the ONLY boundary rule; it is
 *   enforced purely by {@link validateReplayPlan}.
 * - Mutable state owner: the AUTHORITATIVE RUNTIME owns the immutable event
 *   log and the snapshot table. Historical events are never rewritten
 *   (requirements E10 applies); snapshots are content-addressed.
 * - Determinism: replays of SIMULATION sessions must present the session's
 *   original determinism seed; a mismatched seed is refused
 *   (`seed-mismatch`). Interactive sessions replay as recorded observations
 *   only (no re-simulation claim is expressed here).
 * - Resume: a job may only resume from a checkpoint that coincides with a
 *   snapshot boundary whose epoch matches the current session epoch
 *   (jobs.ts `decideResume` + `validateResumeBoundary` here).
 */

import type {
  DeterminismSeed,
  Digest,
  EventSequence,
  SessionEpoch,
  SessionId,
  SnapshotId,
  Tick,
} from "./primitives.ts";
import type { RuntimeRoleKind } from "./session.ts";

/** A persisted, content-addressed session snapshot. */
export interface SessionSnapshot {
  readonly snapshotId: SnapshotId;
  readonly sessionId: SessionId;
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  /** Event log is complete and committed through this sequence. */
  readonly afterEventSeq: EventSequence;
  readonly stateDigest: Digest;
}

/** A declarative replay plan over the immutable event log. */
export interface ReplayPlan {
  readonly sessionId: SessionId;
  readonly fromEventSeq: EventSequence;
  /** Inclusive end; use `null` for "to the present committed head". */
  readonly toEventSeq: EventSequence | null;
  /** Seed the re-simulation must use (simulation role only). */
  readonly determinism?: DeterminismSeed;
}

/** Violation codes for replay plans. */
export type ReplayPlanErrorCode =
  | "backward-window"
  | "mid-stream-start"
  | "unknown-snapshot"
  | "seed-mismatch"
  | "future-end"
  | "snapshot-wrong-session";

/** Pure validation result for a replay plan. */
export type ReplayPlanValidation =
  | { readonly ok: true; readonly fromSeq: number; readonly toSeq: number | null }
  | { readonly ok: false; readonly code: ReplayPlanErrorCode; readonly detail: string };

/**
 * Inputs: known snapshot boundaries (read model), the session's role and
 * (for simulation) its original seed, and the currently committed head of
 * the event log.
 */
export interface ReplayContext {
  readonly snapshots: readonly SessionSnapshot[];
  readonly role: RuntimeRoleKind;
  readonly sessionDeterminism?: DeterminismSeed;
  readonly committedHeadSeq: EventSequence;
  readonly sessionEpoch: SessionEpoch;
}

/**
 * Pure replay-boundary oracle. A plan is valid when:
 * - fromEventSeq is 1, or (snapshot.afterEventSeq + 1) for a snapshot of
 *   this session (THE boundary rule);
 * - toEventSeq (when given) is >= fromEventSeq and <= committedHeadSeq;
 * - for simulation role, the plan's seed equals the session's seed.
 */
export function validateReplayPlan(
  plan: ReplayPlan,
  context: ReplayContext,
): ReplayPlanValidation {
  if (plan.toEventSeq !== null && plan.toEventSeq < plan.fromEventSeq) {
    return { ok: false, code: "backward-window", detail: "toEventSeq precedes fromEventSeq" };
  }
  if (plan.toEventSeq !== null && plan.toEventSeq > context.committedHeadSeq) {
    return { ok: false, code: "future-end", detail: "toEventSeq beyond committed head" };
  }
  const from = plan.fromEventSeq;
  let boundaryOk = from === 1;
  if (!boundaryOk) {
    for (const snapshot of context.snapshots) {
      if (snapshot.sessionId !== plan.sessionId) {
        continue;
      }
      if (snapshot.afterEventSeq + 1 === from) {
        boundaryOk = true;
        break;
      }
    }
  }
  if (!boundaryOk) {
    return {
      ok: false,
      code: "mid-stream-start",
      detail: `replay must start at seq 1 or immediately after a snapshot boundary, got ${String(from)}`,
    };
  }
  if (context.role === "simulation") {
    if (
      plan.determinism === undefined ||
      context.sessionDeterminism === undefined ||
      plan.determinism !== context.sessionDeterminism
    ) {
      return {
        ok: false,
        code: "seed-mismatch",
        detail: "simulation replay must present the session's original determinism seed",
      };
    }
  }
  return { ok: true, fromSeq: from, toSeq: plan.toEventSeq === null ? null : plan.toEventSeq };
}

/** Violation codes for resume boundaries. */
export type ResumeBoundaryErrorCode =
  | "no-durable-checkpoint"
  | "checkpoint-not-on-snapshot"
  | "epoch-stale";

export type ResumeBoundaryValidation =
  | { readonly ok: true; readonly snapshotId: SnapshotId }
  | { readonly ok: false; readonly code: ResumeBoundaryErrorCode; readonly detail: string };

/** A job checkpoint candidate (mirrors jobs.ts JobCheckpoint structurally). */
export interface ResumeCheckpointCandidate {
  readonly afterEventSeq: number;
  readonly atEpoch: SessionEpoch;
  readonly snapshotId: SnapshotId;
}

/**
 * Pure resume-boundary oracle: a resume may only continue from a checkpoint
 * that coincides with a persisted snapshot boundary (same session, snapshot
 * covers exactly afterEventSeq) AND whose epoch matches the current session
 * epoch. Otherwise the resume must fall back to `from-start` (jobs.ts).
 */
export function validateResumeBoundary(
  candidate: ResumeCheckpointCandidate | undefined,
  context: ReplayContext,
): ResumeBoundaryValidation {
  if (candidate === undefined) {
    return { ok: false, code: "no-durable-checkpoint", detail: "job has no durable checkpoint" };
  }
  const matching = context.snapshots.find((s) => s.snapshotId === candidate.snapshotId);
  if (matching === undefined || matching.afterEventSeq !== candidate.afterEventSeq) {
    return {
      ok: false,
      code: "checkpoint-not-on-snapshot",
      detail: "checkpoint does not coincide with a persisted snapshot boundary",
    };
  }
  if (candidate.atEpoch !== context.sessionEpoch) {
    return {
      ok: false,
      code: "epoch-stale",
      detail: "checkpoint predates the current session epoch",
    };
  }
  return { ok: true, snapshotId: matching.snapshotId };
}
