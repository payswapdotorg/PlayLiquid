/**
 * The CANONICAL EVENT PATH (requirement E2) and its order validation.
 *
 * Every observable effect of a runtime session is emitted as exactly one
 * `RuntimeEventEnvelope` on this path: 1-based, gapless per session, with
 * explicit causal provenance. Interactive and Simulation runtimes emit the
 * same envelope shape (lock rule 12); only execution differs.
 *
 * Async/stateful documentation (worker-contract "Async/stateful work"):
 * - Event order: `validateEventStream` is the pure order oracle. Events must
 *   be (a) one session, (b) contiguous `seq` starting at 1 (or at a caller-
 *   declared start cursor after a resume), (c) non-decreasing `tick`, and
 *   (d) causally sound: an event may only cite a command that was admitted
 *   before it (caller supplies the admitted set) or an earlier event in the
 *   same stream; `system` causes need no proof.
 * - Mutable state owner: the authoritative runtime owns the event log.
 *   Events are immutable once emitted (requirement E10 applies downstream;
 *   there is deliberately no API here to rewrite or reorder them).
 */

import type {
  CommandId,
  EventId,
  EventKind,
  EventSequence,
  SessionId,
  Tick,
} from "./primitives.ts";

/** Causal provenance of an event (E2: the event side of the path). */
export type EventCause =
  | { readonly kind: "system" }
  | { readonly kind: "command"; readonly commandId: CommandId }
  | { readonly kind: "event"; readonly causedByEventId: EventId };

/** The single event envelope type for the whole protocol. */
export interface RuntimeEventEnvelope<P = unknown> {
  readonly eventId: EventId;
  readonly sessionId: SessionId;
  readonly kind: EventKind;
  readonly seq: EventSequence;
  readonly tick: Tick;
  readonly cause: EventCause;
  readonly payload: P;
}

/** Violation codes reported by {@link validateEventStream}. */
export type EventStreamErrorCode =
  | "empty-stream"
  | "session-mixed"
  | "sequence-regression"
  | "sequence-gap"
  | "tick-regression"
  | "unresolved-command-cause"
  | "forward-event-cause";

/** Pure validation result for an event stream. */
export type EventStreamValidation =
  | {
      readonly ok: true;
      readonly span: {
        readonly sessionId: SessionId;
        readonly firstSeq: number;
        readonly lastSeq: number;
        readonly count: number;
      };
    }
  | {
      readonly ok: false;
      readonly code: EventStreamErrorCode;
      /** Index in the input array of the first offending event. */
      readonly index: number;
      readonly detail: string;
    };

/**
 * Inputs beyond the stream itself: where a resumed stream is allowed to start
 * (default 1) and which command ids were already admitted (for causal
 * validation of `command` causes).
 */
export interface EventStreamValidationContext {
  /** Sequence number the stream must start at (defaults to 1). */
  readonly startAtSeq?: number;
  /** Command ids that were admitted BEFORE this stream segment. */
  readonly admittedCommandIds?: readonly CommandId[];
}

/**
 * Pure event-order oracle. See module doc for the rule set. Returns the
 * first violation or the validated span.
 */
export function validateEventStream(
  events: readonly RuntimeEventEnvelope[],
  context: EventStreamValidationContext = {},
): EventStreamValidation {
  if (events.length === 0) {
    return { ok: false, code: "empty-stream", index: 0, detail: "event stream is empty" };
  }
  const startAt = context.startAtSeq ?? 1;
  const admitted = new Set<unknown>(context.admittedCommandIds ?? []);
  const seenEventIds = new Set<unknown>();
  const first = events[0];
  if (first === undefined) {
    return { ok: false, code: "empty-stream", index: 0, detail: "event stream is empty" };
  }
  const sessionId = first.sessionId;
  let expectedSeq = startAt;
  let lastTick = Number.NaN;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event === undefined) {
      return { ok: false, code: "empty-stream", index: i, detail: "missing event at index" };
    }
    if (event.sessionId !== sessionId) {
      return {
        ok: false,
        code: "session-mixed",
        index: i,
        detail: `event ${String(event.eventId)} belongs to session ${String(event.sessionId)}, expected ${String(sessionId)}`,
      };
    }
    if (event.seq < expectedSeq) {
      return {
        ok: false,
        code: "sequence-regression",
        index: i,
        detail: `event ${String(event.eventId)} seq ${String(event.seq)} < expected ${String(expectedSeq)}`,
      };
    }
    if (event.seq > expectedSeq) {
      return {
        ok: false,
        code: "sequence-gap",
        index: i,
        detail: `event ${String(event.eventId)} seq ${String(event.seq)} skipped expected ${String(expectedSeq)}`,
      };
    }
    if (!Number.isNaN(lastTick) && event.tick < lastTick) {
      return {
        ok: false,
        code: "tick-regression",
        index: i,
        detail: `event ${String(event.eventId)} tick ${String(event.tick)} regresses below ${String(lastTick)}`,
      };
    }
    if (event.cause.kind === "command" && !admitted.has(event.cause.commandId)) {
      return {
        ok: false,
        code: "unresolved-command-cause",
        index: i,
        detail: `event ${String(event.eventId)} cites unadmitted command ${String(event.cause.commandId)}`,
      };
    }
    if (event.cause.kind === "event" && !seenEventIds.has(event.cause.causedByEventId)) {
      return {
        ok: false,
        code: "forward-event-cause",
        index: i,
        detail: `event ${String(event.eventId)} cites event ${String(event.cause.causedByEventId)} that has not occurred yet in this stream`,
      };
    }
    seenEventIds.add(event.eventId);
    expectedSeq += 1;
    lastTick = event.tick;
  }
  const last = events[events.length - 1];
  return {
    ok: true,
    span: {
      sessionId,
      firstSeq: first.seq,
      lastSeq: last === undefined ? first.seq : last.seq,
      count: events.length,
    },
  };
}

/**
 * Canonical-path registry check (E2: ONE command/event path PER behavior).
 * A game registers, per behavior id, the single command kind and the event
 * kinds it may emit. This pure validator flags: duplicate behavior ids,
 * a command kind claimed by more than one behavior (a second command path
 * for some behavior is then implied), and event kinds claimed by more than
 * one behavior.
 */
export interface CanonicalBehaviorPath {
  readonly behaviorId: string;
  readonly commandKind: string;
  readonly eventKinds: readonly string[];
}

export type CanonicalPathViolation =
  | { readonly code: "duplicate-behavior"; readonly behaviorId: string }
  | { readonly code: "command-kind-shared"; readonly commandKind: string; readonly behaviors: readonly string[] }
  | { readonly code: "event-kind-shared"; readonly eventKind: string; readonly behaviors: readonly string[] };

export function validateCanonicalPaths(
  paths: readonly CanonicalBehaviorPath[],
): readonly CanonicalPathViolation[] {
  const violations: CanonicalPathViolation[] = [];
  const seenBehaviors = new Set<string>();
  const commandOwners = new Map<string, string[]>();
  const eventOwners = new Map<string, string[]>();
  for (const path of paths) {
    if (seenBehaviors.has(path.behaviorId)) {
      violations.push({ code: "duplicate-behavior", behaviorId: path.behaviorId });
      continue;
    }
    seenBehaviors.add(path.behaviorId);
    const cmdOwners = commandOwners.get(path.commandKind) ?? [];
    cmdOwners.push(path.behaviorId);
    commandOwners.set(path.commandKind, cmdOwners);
    for (const eventKind of path.eventKinds) {
      const owners = eventOwners.get(eventKind) ?? [];
      owners.push(path.behaviorId);
      eventOwners.set(eventKind, owners);
    }
  }
  for (const [commandKind, behaviors] of commandOwners) {
    if (behaviors.length > 1) {
      violations.push({ code: "command-kind-shared", commandKind, behaviors });
    }
  }
  for (const [eventKind, behaviors] of eventOwners) {
    if (behaviors.length > 1) {
      violations.push({ code: "event-kind-shared", eventKind, behaviors });
    }
  }
  return violations;
}
