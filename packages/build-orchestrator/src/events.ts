/**
 * The append-only, authority-stamped build event log (E10: historical
 * evidence is immutable; every build transition is recorded).
 *
 * Discipline, binding on the service:
 * - events are FROZEN records; the log only ever APPENDS;
 * - `sequence` is per build, strictly increasing from 1 — an event log
 *   whose per-build sequences are not strictly increasing from 1 is
 *   corrupt and is refused at restore (typed, never silently healed);
 * - `authority` is always this service ("build-orchestrator") — the
 *   single state owner stamps its own history (E1);
 * - `at` comes exclusively from the injected ServiceClock port (E3).
 */

import type { Brand } from "@playliquid/build-contracts";
import type { BuildPhase, BuildStage } from "@playliquid/build-contracts";
import type { TenantId } from "./tenancy.ts";

/** The authority stamp of every event this service appends (E1). */
export const BUILD_ORCHESTRATOR_AUTHORITY = "build-orchestrator" as const;

/** Sequence number of one build's event stream (1-based). */
export type BuildEventSequence = Brand<number, "BuildEventSequence">;

/** The frozen build event type vocabulary. */
export const BUILD_EVENT_TYPES = Object.freeze([
  "admitted",
  "phase-transition",
  "stage-completed",
  "build-succeeded",
  "build-failed",
  "build-cancelled",
  "limitation-recorded",
] as const);

/** One build event type. */
export type BuildEventType = (typeof BUILD_EVENT_TYPES)[number];

/** The append-only history of one build, as one immutable event. */
export interface BuildEvent {
  readonly kind: "build-orchestrator-event";
  /** Always "build-orchestrator" (this service stamps its own history). */
  readonly authority: typeof BUILD_ORCHESTRATOR_AUTHORITY;
  readonly tenant: TenantId;
  readonly buildId: string;
  /** Per-build sequence, strictly increasing from 1 (E10). */
  readonly sequence: number;
  /** ServiceClock reading at append time (never a wall clock read here). */
  readonly at: number;
  readonly type: BuildEventType;
  /** The build's phase AFTER applying the recorded transition. */
  readonly phase: BuildPhase;
  /** Typed detail payload per event type (see {@link BuildEventDetail}). */
  readonly detail?: unknown;
}

/** Detail payload of a `phase-transition` event. */
export interface PhaseTransitionDetail {
  readonly from: BuildPhase;
  readonly to: BuildPhase;
}

/** Detail payload of a `stage-completed` event. */
export interface StageCompletedDetail {
  readonly stage: BuildStage;
  /** Digest of the completed stage's record (manifest step material, E9). */
  readonly stageDigest: string;
}

/** Detail payload of a `build-failed` event. */
export interface BuildFailedDetail {
  readonly code: string;
  readonly message: string;
}

/** Detail payload of a `build-succeeded` event. */
export interface BuildSucceededDetail {
  /** Digest of the recorded build manifest (pins inputs, steps, artifacts). */
  readonly manifestDigest: string;
}

/** Detail payload of a `limitation-recorded` event (E11 truth). */
export interface LimitationRecordedDetail {
  readonly limitationId: string;
  readonly code: string;
  readonly message: string;
}

/** The typed detail payloads ({@link BuildEvent}["detail"] per type). */
export type BuildEventDetail =
  | PhaseTransitionDetail
  | StageCompletedDetail
  | BuildFailedDetail
  | BuildSucceededDetail
  | LimitationRecordedDetail;

/** Type guard: a structurally valid build event. Total; never throws. */
export function isBuildEvent(value: unknown): value is BuildEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<BuildEvent>;
  return (
    candidate.kind === "build-orchestrator-event" &&
    candidate.authority === BUILD_ORCHESTRATOR_AUTHORITY &&
    typeof candidate.tenant === "string" &&
    candidate.tenant.length > 0 &&
    typeof candidate.buildId === "string" &&
    candidate.buildId.length > 0 &&
    typeof candidate.sequence === "number" &&
    Number.isSafeInteger(candidate.sequence) &&
    candidate.sequence >= 1 &&
    typeof candidate.at === "number" &&
    Number.isFinite(candidate.at) &&
    typeof candidate.type === "string" &&
    (BUILD_EVENT_TYPES as readonly string[]).includes(candidate.type) &&
    typeof candidate.phase === "string" &&
    candidate.phase.length > 0
  );
}

/**
 * Verifies the append-only discipline over a full event log: per build,
 * sequences must be exactly 1, 2, 3, … in first-seen order. Returns the
 * first violation as a typed refusal; `null` means the log is sound.
 */
export function findEventLogCorruption(events: readonly BuildEvent[]): { buildId: string; message: string } | null {
  const nextByBuild = new Map<string, number>();
  for (const event of events) {
    const candidate: unknown = event;
    if (!isBuildEvent(candidate)) {
      const record = candidate as { readonly buildId?: unknown } | null | undefined;
      const buildId = typeof record?.buildId === "string" && record.buildId.length > 0 ? record.buildId : "<unknown>";
      return { buildId, message: "event is structurally invalid" };
    }
    const expected = nextByBuild.get(event.buildId) ?? 1;
    if (event.sequence !== expected) {
      return {
        buildId: event.buildId,
        message: `expected sequence ${expected} for build ${event.buildId} but found ${event.sequence} (append-only violation, E10)`,
      };
    }
    nextByBuild.set(event.buildId, expected + 1);
  }
  return null;
}

/** Mints the next sequence number for `buildId` given the current log tail. */
export function nextSequence(events: readonly BuildEvent[], buildId: string): number {
  let last = 0;
  for (const event of events) {
    if (event.buildId === buildId && event.sequence > last) {
      last = event.sequence;
    }
  }
  return last + 1;
}
