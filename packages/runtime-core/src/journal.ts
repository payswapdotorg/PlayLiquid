/**
 * SESSION JOURNAL — the owner of the canonical event path's storage state.
 *
 * Owns (E1 — exactly one owner per mutable state):
 * - the append-only event log (E10: history is never rewritten);
 * - the committed event sequence and the admitted command sequence/ids;
 * - deterministic event id minting (`<sessionId>#e<seq>`);
 * - effect-flood guards (caps) when emitting driver effects;
 * - replay plan validation + immutable log windowing (seam for lock 15).
 *
 * The journal never decides phase policy or command admission — that is
 * the kernel's job through the contracts' admission gates. Pure with
 * respect to hosts: no IO, no clock, no randomness.
 */

import { asEventId, asEventKind, asEventSequence, validateReplayPlan } from "@playliquid/runtime-contracts";
import type {
  CommandId,
  CommandSequence,
  EventCause,
  EventStreamValidation,
  ReplayContext,
  ReplayPlan,
  ReplayPlanErrorCode,
  RuntimeEventEnvelope,
  SessionId,
  Tick,
} from "@playliquid/runtime-contracts";
import type { WorldEventEffect } from "./world.ts";
import { validateKernelEventLog } from "./logview.ts";

/** Emitted-event window produced by one journal batch. */
export interface JournalBatch {
  readonly events: readonly RuntimeEventEnvelope[];
  /** True when the driver exceeded its per-step event cap (flood). */
  readonly flood: boolean;
}

/** Validated replay window (raw shape; the kernel maps it to results). */
export type ReplayWindow =
  | { readonly ok: true; readonly fromSeq: number; readonly toSeq: number; readonly events: readonly RuntimeEventEnvelope[] }
  | { readonly ok: false; readonly code: ReplayPlanErrorCode; readonly detail: string };

/**
 * The event journal. Constructed per session by the kernel; not exported
 * through the package barrel as a construction surface (the kernel owns
 * composition), but its type is exported for host introspection.
 */
export class SessionJournal {
  readonly #sessionId: SessionId;
  readonly #events: RuntimeEventEnvelope[] = [];
  readonly #admittedCommandIds: CommandId[] = [];
  #committedEventSeq = 0;
  #admittedCommandSeq = 0;

  constructor(sessionId: SessionId) {
    this.#sessionId = sessionId;
  }

  get committedEventSeq(): number {
    return this.#committedEventSeq;
  }

  get admittedCommandSeq(): number {
    return this.#admittedCommandSeq;
  }

  /** Record one admitted command (called by the command path after admission). */
  recordAdmission(commandId: CommandId, assignedSeq: CommandSequence): void {
    this.#admittedCommandSeq = assignedSeq;
    this.#admittedCommandIds.push(commandId);
  }

  /** Append one event with a deterministic id; returns the envelope. */
  emit(kind: string, tick: Tick, cause: EventCause, payload: unknown): RuntimeEventEnvelope {
    this.#committedEventSeq += 1;
    const envelope: RuntimeEventEnvelope = {
      eventId: asEventId(`${this.#sessionId}#e${this.#committedEventSeq}`),
      sessionId: this.#sessionId,
      kind: asEventKind(kind),
      seq: asEventSequence(this.#committedEventSeq),
      tick,
      cause,
      payload,
    };
    this.#events.push(envelope);
    return envelope;
  }

  /** Emit driver effects under one cause, enforcing the per-step cap. */
  emitEffects(
    effects: readonly WorldEventEffect[],
    tick: Tick,
    cause: EventCause,
    cap: number,
  ): JournalBatch {
    const events: RuntimeEventEnvelope[] = [];
    let flood = false;
    for (const effect of effects) {
      if (events.length >= cap) {
        flood = true;
        break;
      }
      events.push(this.emit(effect.kind, tick, cause, effect.payload));
    }
    return { events, flood };
  }

  /** Events with seq strictly greater than `cursor` (observe semantics). */
  eventsAfter(cursor: number): readonly RuntimeEventEnvelope[] {
    return this.#events.slice(cursor);
  }

  /** Inclusive immutable log window [from, to] by sequence number. */
  window(from: number, to: number): readonly RuntimeEventEnvelope[] {
    return this.#events.slice(from - 1, to);
  }

  /** Whole-log order/causality check (epoch-segmented; see logview.ts). */
  validate(): EventStreamValidation {
    return validateKernelEventLog(this.#events, this.#admittedCommandIds);
  }

  /**
   * Validate a replay plan against the current head and the snapshot
   * boundaries, then window the immutable log. Replay reads RECORDED
   * events only — re-simulation is the Simulation Runtime (PL-014).
   */
  replayWindow(
    query: { readonly fromEventSeq: number; readonly toEventSeq: number | null },
    context: Omit<ReplayContext, "committedHeadSeq">,
  ): ReplayWindow {
    const plan: ReplayPlan = {
      sessionId: this.#sessionId,
      fromEventSeq: asEventSequence(query.fromEventSeq),
      toEventSeq: query.toEventSeq === null ? null : asEventSequence(query.toEventSeq),
    };
    const validation = validateReplayPlan(plan, {
      ...context,
      committedHeadSeq: asEventSequence(this.#committedEventSeq),
    });
    if (!validation.ok) {
      return { ok: false, code: validation.code, detail: validation.detail };
    }
    const to = validation.toSeq ?? this.#committedEventSeq;
    return {
      ok: true,
      fromSeq: validation.fromSeq,
      toSeq: to,
      events: this.window(validation.fromSeq, to),
    };
  }
}
