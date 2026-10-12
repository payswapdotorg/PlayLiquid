/**
 * THE TYPED HOSTILE COMMAND PORT (PL-040 qa/e2e-lab) — the port vocabulary
 * + the pure narrowing helpers the hostile Lab world dispatches through.
 *
 * Unlike the canonical example's port (which speaks for one fixed caller),
 * the hostile port's intents CARRY the caller identity (tenant + subject) —
 * so a cross-tenant attempt goes THROUGH the port and the authoritative
 * door's refusal code comes back VERBATIM (E8). Malformed identities,
 * impossible rung attempts and unknown kinds are refused BEFORE any domain
 * call (`invalid-intent` — never a silent coercion).
 */

import type {
  ArenaEscalationRef,
  GapLadderRung,
  GapRungAttempt,
} from "../../../packages/lab-contracts/src/index.ts";
import type { GapDoorRefusalCode, SearchOpenRefusalCode } from "../../../packages/lab-organization/src/index.ts";

// ---------------------------------------------------------------------------
// The intent + receipt vocabulary
// ---------------------------------------------------------------------------

/** One typed hostile intent (the caller identity travels WITH the intent). */
export type HostileCommandIntent =
  | {
      readonly kind: "request-search";
      readonly tenant: string;
      readonly subject: string;
      readonly cycleId: string;
      readonly seed: string;
      readonly maxAgents: number;
    }
  | {
      readonly kind: "advance-gap-rung";
      readonly tenant: string;
      readonly subject: string;
      readonly gapId: string;
      readonly rung: GapLadderRung;
      readonly disposition: "attempted" | "unavailable" | "declined";
      readonly outcome?: "resolved" | "unresolved";
      readonly external?: ArenaEscalationRef;
    };

/** The refusal vocabulary the hostile port surfaces (the doors', verbatim, + its own). */
export type HostileCommandRefusalCode = "invalid-intent" | SearchOpenRefusalCode | GapDoorRefusalCode;

/** The typed receipt of one hostile command intent. */
export type HostileCommandReceipt =
  | { readonly ok: true; readonly kind: "search-opened"; readonly searchId: string; readonly size: number; readonly duplicate: boolean }
  | { readonly ok: true; readonly kind: "gap-advanced"; readonly gapId: string; readonly rung: GapLadderRung }
  | { readonly ok: false; readonly code: HostileCommandRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// The frozen door vocabularies (for narrowing only — values flow VERBATIM)
// ---------------------------------------------------------------------------

/** The gap door's frozen vocabulary (lab-organization records.ts). */
const GAP_DOOR_REFUSAL_CODES: readonly string[] = [
  "gap-unknown",
  "cross-tenant",
  "invalid-attempt",
  "arena-first-resort",
  "rung-skip",
  "blocked-is-terminal",
  "gap-already-resolved",
];

/** The search-open door's frozen vocabulary (lab-organization records.ts). */
const SEARCH_OPEN_REFUSAL_CODES: readonly string[] = [
  "invalid-tenant",
  "invalid-owner",
  "invalid-cycle",
  "invalid-request-time",
  "invalid-seed",
  "invalid-context",
  "invalid-current-organization",
  "invalid-restriction",
  "empty-role-vocabulary",
  "invalid-role-vocabulary",
  "empty-model-catalog",
  "invalid-model-catalog",
  "invalid-body-catalog",
  "unresolvable-body-reference",
  "invalid-tool-catalog",
  "invalid-capability-vocabulary",
  "dimension-out-of-bounds",
  "search-space-too-large",
];

/**
 * Narrows a door's widened `string` code into the frozen vocabulary. The
 * VALUE flows through verbatim (E8); an unknown code is a contract defect
 * and fails loudly — never silently passed, never faked.
 */
export function narrowDoorCode<T extends string>(codes: readonly string[], code: string, door: string): T {
  if (!codes.includes(code)) {
    throw new Error(`hostile port: ${door} returned an unknown refusal code "${code}" (not the frozen vocabulary)`);
  }
  return code as T;
}

/** The gap door's frozen code table (exposed for the narrowing call sites). */
export const gapDoorCodes: readonly string[] = GAP_DOOR_REFUSAL_CODES;

/** The search-open door's frozen code table (exposed for the narrowing call sites). */
export const searchOpenCodes: readonly string[] = SEARCH_OPEN_REFUSAL_CODES;

/** Narrows one flattened intent into the authoritative rung-attempt union. */
export function rungAttemptOf(intent: {
  readonly rung: GapLadderRung;
  readonly disposition: "attempted" | "unavailable" | "declined";
  readonly outcome?: "resolved" | "unresolved";
  readonly external?: ArenaEscalationRef;
}): GapRungAttempt | null {
  if (intent.rung === "blocked") return null; // the terminal rung needs a reason this intent cannot carry
  if (intent.rung === "existing-organization" || intent.rung === "alternate-organization" || intent.rung === "package-platform-capability") {
    if (intent.disposition === "declined") return null; // autonomous rungs attempt or are unavailable
    return { rung: intent.rung, disposition: intent.disposition, ...(intent.outcome === undefined ? {} : { outcome: intent.outcome }) };
  }
  if (intent.rung === "arena-escalation" && intent.disposition === "attempted" && intent.external === undefined) {
    return null; // an actual Arena attempt requires the provider-neutral external ref (lock 32)
  }
  return {
    rung: intent.rung,
    disposition: intent.disposition,
    ...(intent.outcome === undefined ? {} : { outcome: intent.outcome }),
    ...(intent.rung === "arena-escalation" && intent.external !== undefined ? { external: intent.external } : {}),
  };
}
