/**
 * THE CAPABILITY-GAP LADDER (R18, lock rules 30/31/32).
 *
 * "Capability gaps can trigger user/community contribution or Arena
 * escalation." Resolution order (spec/architecture.md, "Capability gaps"):
 *
 *   existing organization → alternate organization → package/platform
 *   capability → user/community contribution → Arena → blocked.
 *
 * This module types that order as a FROZEN rung table plus a frozen
 * stepwise transition table (the house state-machine pattern): rungs
 * advance ONE STEP AT A TIME — skipping rungs is refused, Arena is only
 * reachable after the user/community rung, and `blocked` is terminal.
 *
 * Optionality without skipping (lock 31 + lock 30): the optional rungs —
 * user/community contribution and Arena escalation — may carry an explicit
 * `declined` disposition, but they can never be silently jumped over.
 * Every rung gets an auditable attempt record; autonomous operation never
 * silently depends on humans, and Arena never silently happens.
 *
 * Arena appears ONLY as the provider-neutral {@link ArenaEscalationRef}
 * (lock 32): an opaque external identifier plus the content digest of the
 * typed escalation request artifact. No Arena SDK, provider or endpoint
 * vocabulary exists here — arena-integration (PL-007) owns the wire.
 *
 * Pure module: no IO, no clocks (caller-supplied timestamps), no network.
 */

import type {
  ArenaEscalationId,
  ContentDigest,
  GapRecordId,
  LabCycleId,
  OrganizationId,
  TimestampMs,
} from "./primitives.ts";
import { asArenaEscalationId, asGapRecordId, asLabCycleId, isValidContentDigest } from "./primitives.ts";

/** The frozen resolution-order ladder (R18). Index = resort order. */
export const GAP_LADDER_RUNGS = Object.freeze([
  "existing-organization",
  "alternate-organization",
  "package-platform-capability",
  "user-community-contribution",
  "arena-escalation",
  "blocked",
] as const);

/** One rung of the capability-gap resolution ladder. */
export type GapLadderRung = (typeof GAP_LADDER_RUNGS)[number];

/** Returns true when `value` is a valid {@link GapLadderRung}. */
export function isGapLadderRung(value: unknown): value is GapLadderRung {
  return typeof value === "string" && (GAP_LADDER_RUNGS as readonly string[]).includes(value);
}

/**
 * The frozen stepwise transition table: each rung may only advance to its
 * IMMEDIATE successor, and `blocked` is terminal. State-machine authority
 * is single-owner (E1) and lives here.
 */
export const GAP_LADDER_TRANSITIONS: Readonly<Record<GapLadderRung, readonly GapLadderRung[]>> = Object.freeze({
  "existing-organization": Object.freeze(["alternate-organization"] as const),
  "alternate-organization": Object.freeze(["package-platform-capability"] as const),
  "package-platform-capability": Object.freeze(["user-community-contribution"] as const),
  "user-community-contribution": Object.freeze(["arena-escalation"] as const),
  "arena-escalation": Object.freeze(["blocked"] as const),
  blocked: Object.freeze([] as const),
});

/** Returns true when `from -> to` is a legal stepwise ladder advance. */
export function canAdvanceGapResolution(from: GapLadderRung, to: GapLadderRung): boolean {
  return GAP_LADDER_TRANSITIONS[from].includes(to);
}

/** The immediate successor of `rung`, or `undefined` when terminal. */
export function nextGapLadderRung(rung: GapLadderRung): GapLadderRung | undefined {
  return GAP_LADDER_TRANSITIONS[rung][0];
}

/** The resort-order position of `rung` (0-based; lower = earlier resort). */
export function gapLadderPosition(rung: GapLadderRung): number {
  return GAP_LADDER_RUNGS.indexOf(rung);
}

/** Returns true when `rung` is terminal (only `blocked` ever is). */
export function isTerminalGapRung(rung: GapLadderRung): boolean {
  return GAP_LADDER_TRANSITIONS[rung].length === 0;
}

/**
 * A provider-neutral external reference to an Arena escalation request
 * (lock 32). `requestDigest` is the content-addressed typed escalation
 * request artifact; `escalationId` is Arena's opaque handle. The literal
 * `external: "arena-external"` marks the trust boundary: Arena is EXTERNAL
 * and cannot directly mutate PlayLiquid state — this type grants no
 * authority, only a reference.
 */
export interface ArenaEscalationRef {
  readonly external: "arena-external";
  readonly escalationId: ArenaEscalationId;
  readonly requestDigest: ContentDigest;
}

/** Returns true when `value` is structurally a valid {@link ArenaEscalationRef}. */
export function isArenaEscalationRef(value: unknown): value is ArenaEscalationRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    ref.external === "arena-external" &&
    typeof ref.escalationId === "string" &&
    asArenaEscalationId(ref.escalationId) !== undefined &&
    typeof ref.requestDigest === "string" &&
    isValidContentDigest(ref.requestDigest)
  );
}

/** Outcome of a rung attempt that was actually made. */
export type GapRungOutcome = "resolved" | "unresolved";

/**
 * An attempt record for the three always-considered rungs: the existing
 * organization, an alternate organization, or a package/platform
 * capability. These rungs cannot be `declined` — they are the autonomous
 * resolution path.
 */
export interface AutonomousRungAttempt {
  readonly rung: "existing-organization" | "alternate-organization" | "package-platform-capability";
  readonly disposition: "attempted" | "unavailable";
  readonly outcome?: GapRungOutcome;
  readonly organization?: OrganizationId;
  readonly capability?: string;
}

/**
 * An attempt record for the user/community rung (lock 31: human
 * contribution is optional unless a task contract requires it — so this
 * rung may be explicitly `declined`, never silently skipped).
 */
export interface CommunityRungAttempt {
  readonly rung: "user-community-contribution";
  readonly disposition: "attempted" | "unavailable" | "declined";
  readonly outcome?: GapRungOutcome;
  readonly contribution?: string;
}

/**
 * An attempt record for the Arena rung (lock 32: external and optional).
 * `declined` is legal (Arena is optional for normal autonomy); an actual
 * attempt REQUIRES the provider-neutral {@link ArenaEscalationRef}.
 */
export interface ArenaRungAttempt {
  readonly rung: "arena-escalation";
  readonly disposition: "attempted" | "unavailable" | "declined";
  readonly outcome?: GapRungOutcome;
  readonly external?: ArenaEscalationRef;
}

/** The terminal rung record: why the gap is blocked. Terminal, no exit. */
export interface BlockedRungAttempt {
  readonly rung: "blocked";
  readonly reason: string;
}

/** Any ladder rung attempt record. */
export type GapRungAttempt = AutonomousRungAttempt | CommunityRungAttempt | ArenaRungAttempt | BlockedRungAttempt;

/**
 * A capability-gap record (lock 30: explicit and auditable): what is
 * missing, in which Lab cycle it was discovered, and the append-only
 * attempt trail walking the ladder in order.
 */
export interface CapabilityGapRecord {
  readonly gapId: GapRecordId;
  readonly cycleId: LabCycleId;
  readonly missingCapability: string;
  readonly summary: string;
  readonly openedAt: TimestampMs;
  readonly attempts: readonly GapRungAttempt[];
}

/** Typed refusal of {@link appendGapRungAttempt}. */
export type GapAppendRefusal =
  | "invalid-attempt"
  | "arena-first-resort"
  | "rung-skip"
  | "blocked-is-terminal"
  | "gap-already-resolved";

/** Result of {@link appendGapRungAttempt}. */
export type GapAppendResult =
  | { readonly ok: true; readonly gap: CapabilityGapRecord }
  | { readonly ok: false; readonly code: GapAppendRefusal; readonly gap: CapabilityGapRecord; readonly detail: string };

function lastRungOf(gap: CapabilityGapRecord): GapLadderRung | undefined {
  return gap.attempts.length === 0 ? undefined : gap.attempts[gap.attempts.length - 1]?.rung;
}

/**
 * Appends the next rung attempt to a gap record's audit trail (lock 30).
 * The ladder is walked STEPWISE: the first attempt must be the existing
 * organization; every later attempt must be the immediate successor of the
 * last; nothing can follow `blocked`; and a gap whose last attempt
 * resolved stays resolved. Arena as the FIRST resort is refused with its
 * own code — it is a last-but-one resort by construction.
 */
export function appendGapRungAttempt(gap: CapabilityGapRecord, attempt: GapRungAttempt): GapAppendResult {
  const rung = attempt.rung;
  const last = lastRungOf(gap);
  if (gap.attempts.length === 0) {
    if (rung !== "existing-organization") {
      return {
        ok: false,
        code: rung === "arena-escalation" ? "arena-first-resort" : "rung-skip",
        gap,
        detail: `the ladder must start at the existing organization, not ${rung}`,
      };
    }
  } else if (last === "blocked") {
    return { ok: false, code: "blocked-is-terminal", gap, detail: "blocked is terminal; no rung may follow it" };
  } else if (last !== undefined) {
    const resolved = gap.attempts.some((existing) => existing.rung !== "blocked" && existing.outcome === "resolved");
    if (resolved) {
      return { ok: false, code: "gap-already-resolved", gap, detail: "a resolved gap takes no further rungs" };
    }
    if (!canAdvanceGapResolution(last, rung)) {
      return {
        ok: false,
        code: "rung-skip",
        gap,
        detail: `cannot advance from ${last} to ${rung}: rungs advance one step at a time`,
      };
    }
  }
  return { ok: true, gap: { ...gap, attempts: Object.freeze([...gap.attempts, attempt]) } };
}

/** Typed violation of {@link validateGapRecord}. */
export type GapViolationCode =
  | "invalid-gap-ids"
  | "invalid-missing-capability"
  | "arena-first-resort"
  | "rung-order-violation"
  | "post-blocked-attempt"
  | "gap-resolved-then-continued"
  | "attempt-requires-outcome"
  | "declined-non-optional-rung"
  | "arena-escalation-requires-external-ref"
  | "missing-blocked-reason";

/** One typed violation. */
export interface GapViolation {
  readonly code: GapViolationCode;
  readonly detail: string;
}

/** Result of {@link validateGapRecord}. */
export type GapValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly GapViolation[] };

/**
 * Pure validator for {@link CapabilityGapRecord}: ids parse, the missing
 * capability is stated, the attempt trail walks the ladder in strict
 * stepwise order from the existing organization, every attempted rung
 * carries an outcome, only the optional rungs (community, Arena) may be
 * declined, an actual Arena attempt carries the provider-neutral external
 * reference, `blocked` is terminal and nothing follows a resolved attempt.
 */
export function validateGapRecord(gap: CapabilityGapRecord): GapValidationResult {
  const violations: GapViolation[] = [];
  if (asGapRecordId(gap.gapId) === undefined || asLabCycleId(gap.cycleId) === undefined) {
    violations.push({ code: "invalid-gap-ids", detail: "gap or cycle id failed validation" });
  }
  if (gap.missingCapability.length === 0 || gap.summary.length === 0) {
    violations.push({ code: "invalid-missing-capability", detail: "a gap must state what is missing" });
  }
  let resolvedSeen = false;
  for (let index = 0; index < gap.attempts.length; index += 1) {
    const attempt = gap.attempts[index];
    if (attempt === undefined) continue;
    const expected: GapLadderRung | undefined = index === 0 ? "existing-organization" : nextGapLadderRung(gap.attempts[index - 1]?.rung ?? "blocked");
    if (index === 0 && attempt.rung === "arena-escalation") {
      violations.push({ code: "arena-first-resort", detail: "Arena is never a first resort (R18)" });
    } else if (attempt.rung !== expected) {
      violations.push({
        code: "rung-order-violation",
        detail: `attempt ${index} is ${attempt.rung}; the ladder requires ${expected ?? "nothing (terminal)"}`,
      });
    }
    if (resolvedSeen) {
      violations.push({ code: "gap-resolved-then-continued", detail: `attempt ${index} follows a resolved attempt` });
    }
    if (attempt.rung === "blocked") {
      if (attempt.reason.length === 0) {
        violations.push({ code: "missing-blocked-reason", detail: "blocked requires a reason" });
      }
      if (index !== gap.attempts.length - 1) {
        violations.push({ code: "post-blocked-attempt", detail: "blocked is terminal; attempts follow it" });
      }
    } else {
      if (attempt.disposition === "attempted" && attempt.outcome === undefined) {
        violations.push({ code: "attempt-requires-outcome", detail: `attempted rung ${attempt.rung} has no outcome` });
      }
      if (attempt.disposition === "declined") {
        // Defense in depth: the type system already makes this unrepresentable
        // (only the optional rungs carry "declined" in their disposition
        // unions); the widened comparison keeps the runtime guard honest for
        // untyped callers.
        const rung: string = attempt.rung;
        if (rung !== "user-community-contribution" && rung !== "arena-escalation") {
          violations.push({ code: "declined-non-optional-rung", detail: `rung ${rung} is not declinable` });
        }
      }
      if (attempt.rung === "arena-escalation" && attempt.disposition === "attempted" && !isArenaEscalationRef(attempt.external)) {
        violations.push({
          code: "arena-escalation-requires-external-ref",
          detail: "an actual Arena attempt requires the provider-neutral external reference (lock 32)",
        });
      }
    }
    if (attempt.rung !== "blocked" && attempt.outcome === "resolved") resolvedSeen = true;
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations: Object.freeze(violations) };
}

/** Returns true when `value` is structurally a {@link CapabilityGapRecord}. */
export function isCapabilityGapRecord(value: unknown): value is CapabilityGapRecord {
  if (typeof value !== "object" || value === null) return false;
  const gap = value as Record<string, unknown>;
  return (
    typeof gap.gapId === "string" &&
    asGapRecordId(gap.gapId) !== undefined &&
    typeof gap.cycleId === "string" &&
    asLabCycleId(gap.cycleId) !== undefined &&
    typeof gap.missingCapability === "string" &&
    gap.missingCapability.length > 0 &&
    Array.isArray(gap.attempts)
  );
}
