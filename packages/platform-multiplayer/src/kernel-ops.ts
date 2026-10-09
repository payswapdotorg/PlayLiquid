/**
 * KERNEL OPERATION CONTEXT + SHARED INTERNAL HELPERS.
 *
 * The operation modules (kernel-session.ts, kernel-settlement.ts) receive
 * this context instead of holding their own state: the kernel INSTANCE
 * (kernel.ts) remains the single mutable-state owner (E1) — the context
 * is the bundle of things it owns, handed to its operations.
 */

import type { CommandAdmissionPolicy } from "@playliquid/runtime-contracts";
import type { RuntimeSessionPhase } from "@playliquid/runtime-contracts";
import {
  asEventId,
  asEventKind as _asEventKind,
  asEventSequence,
  checkSessionPhaseTransition,
} from "@playliquid/runtime-contracts";
import type {
  EventCause,
  EventKind,
  RuntimeEventEnvelope,
  Tick,
} from "@playliquid/runtime-contracts";
import type { AuthoritySessionKernelOptions } from "./kernel-types.ts";
import type { AuthoritySessionState } from "./kernel-types.ts";
import type { RefusalRecord } from "./snapshot.ts";
import type { MultiplayerSessionConfiguration } from "./topology.ts";

/** The bundle of kernel-owned state + injected ports operations act on. */
export interface KernelOperationContext<S> {
  readonly options: AuthoritySessionKernelOptions<S>;
  readonly state: AuthoritySessionState<S>;
  /** Game-policy multiplayer bindings: event kind -> classification. */
  bindings: Map<string, "protected" | "informational">;
  readonly commandPolicy: CommandAdmissionPolicy;
  /** Resolved at open(); undefined until then. */
  configuration: MultiplayerSessionConfiguration | undefined;
}

/** Append one committed event to the log (deterministic id + seq). */
export function emitEvent<S>(
  context: KernelOperationContext<S>,
  kind: EventKind,
  cause: EventCause,
  payload: unknown,
  tick: Tick,
): RuntimeEventEnvelope {
  const seq = context.state.events.length + 1;
  const event: RuntimeEventEnvelope = {
    eventId: asEventId(`evt:${String(context.options.sessionId)}:${seq}`),
    sessionId: context.options.sessionId,
    kind,
    seq: asEventSequence(seq),
    tick,
    cause,
    payload,
  };
  context.state.events.push(event);
  return event;
}

/** The system cause (authoritative step / lifecycle origin). */
export function systemCause(): EventCause {
  return { kind: "system" };
}

/** Legal phase transition check (bound runtime-contracts table). */
export function transitionPhase<S>(
  context: KernelOperationContext<S>,
  to: RuntimeSessionPhase,
): boolean {
  const result = checkSessionPhaseTransition(context.state.phase, to);
  if (!result.ok) {
    failSession(context, `illegal phase transition ${result.from} -> ${result.to}`);
    return false;
  }
  context.state.phase = to;
  return true;
}

/** Fail the session closed (no further stepping, admissions or decisions). */
export function failSession<S>(context: KernelOperationContext<S>, detail: string): void {
  context.state.phase = "failed";
  recordRefusal(context, "session", "session-failed", detail);
}

/** Append to the deterministic, tick/epoch-stamped refusal log. */
export function recordRefusal<S>(
  context: KernelOperationContext<S>,
  kind: RefusalRecord["kind"],
  code: string,
  detail: string,
): void {
  context.state.refusals.push({
    kind,
    code,
    detail,
    atTick: context.state.tick,
    atEpoch: context.state.epoch,
  });
}

/** Retained cast helper (kept for API symmetry with the primitives). */
export const asKernelEventKind = _asEventKind;
