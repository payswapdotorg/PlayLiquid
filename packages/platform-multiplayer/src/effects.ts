/**
 * EFFECT ADMISSION — the pure gate between simulator-proposed effects and
 * committed canonical events (split from kernel.ts for the 400-line
 * ceiling).
 *
 * An effect is admitted only when:
 * 1. its event kind has a multiplayer binding in the game's platform
 *    policy (unbound kinds are refused — the simulator never invents the
 *    event vocabulary);
 * 2. its classification is legal under the session topology: PROTECTED
 *    effects are refused under peer-to-peer (lock 19 — defense in depth
 *    behind the configuration-time refusal);
 * 3. any causal command it cites was admitted on the canonical command
 *    path (forged causes are refused, keeping the committed stream
 *    validatable by `validateEventStream`).
 *
 * Admitted effects yield the event descriptor (kind, cause, payload) plus
 * the protected grant they earn; the kernel assigns sequences, event ids
 * and ticks, and commits.
 */

import type { EventCause, EventKind, ProtectedOutcomeKind } from "@playliquid/runtime-contracts";
import { asEventKind } from "@playliquid/runtime-contracts";
import type { TopologyAdmissionRules } from "./topology.ts";
import type { SimulationEffect } from "./ports.ts";

/** Everything the pure gate needs. */
export interface EffectAdmissionContext {
  /** Game-policy bindings: event kind -> classification. */
  readonly bindings: ReadonlyMap<string, "protected" | "informational">;
  /** Frozen topology rules of the session. */
  readonly rules: TopologyAdmissionRules;
  /** Admitted command ids (canonical path evidence). */
  readonly admittedCommandIds: ReadonlySet<string>;
  /** Game-declared grant semantics: protected kind -> event kind. */
  readonly protectedGrantKinds?: Readonly<Record<string, ProtectedOutcomeKind>>;
}

/** A protected grant earned by an admitted effect. */
export interface EffectGrant {
  readonly actorId: string;
  readonly kind: ProtectedOutcomeKind;
}

/** Pure admission result for one simulator-proposed effect. */
export type EffectAdmission =
  | {
      readonly admitted: true;
      readonly kind: EventKind;
      readonly cause: EventCause;
      readonly payload: unknown;
      readonly grant: EffectGrant | undefined;
    }
  | { readonly admitted: false; readonly code: string; readonly detail: string };

/** THE pure effect gate. */
export function admitEffect(
  effect: SimulationEffect,
  context: EffectAdmissionContext,
): EffectAdmission {
  const kind = String(effect.eventKind);
  const classification = context.bindings.get(kind);
  if (classification === undefined) {
    return {
      admitted: false,
      code: "unbound-event-kind",
      detail: `simulator effect ${kind} has no multiplayer binding`,
    };
  }
  if (classification === "protected" && !context.rules.mayDecideProtectedOutcomes) {
    return {
      admitted: false,
      code: "p2p-protected-refused",
      detail: `protected effect ${kind} refused under peer-to-peer topology (lock 19)`,
    };
  }
  let cause: EventCause = { kind: "system" };
  if (effect.causedByCommand !== undefined) {
    if (!context.admittedCommandIds.has(String(effect.causedByCommand))) {
      return {
        admitted: false,
        code: "unresolved-command-cause",
        detail: `effect ${kind} cites unadmitted command ${String(effect.causedByCommand)}`,
      };
    }
    cause = { kind: "command", commandId: effect.causedByCommand };
  }
  let grant: EffectGrant | undefined;
  if (
    classification === "protected" &&
    effect.actor !== undefined &&
    context.protectedGrantKinds?.[kind] !== undefined
  ) {
    grant = {
      actorId: String(effect.actor.actorId),
      kind: context.protectedGrantKinds[kind],
    };
  }
  return {
    admitted: true,
    kind: asEventKind(kind),
    cause,
    payload: effect.payload,
    grant,
  };
}
