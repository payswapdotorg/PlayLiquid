/**
 * ENTITLEMENT SETTLEMENT CONTRACTS (R10 refinement, PL-009).
 *
 * The settlement pipeline, as the architecture "Rewards" section splits
 * it: games declare eligible semantic events (lock 18); the PLATFORM
 * owns validation, entitlements and settlement. This module types the
 * platform half:
 *
 * - {@link SettlementEligibilityDeclaration} — the refined game-side
 *   declaration: which of the game's events is settlement-eligible, and
 *   which game-ir ValueShape (by digest) the event payload is declared
 *   to carry. It EXTENDS the PL-004 reward-rule discipline
 *   ({@link RewardRuleBinding} keeps `requiresAuthoritativeOutcome:
 *   true`) but replaces the bare `amount` with the shape pin — zero
 *   numeric authority (see economy-values.ts).
 * - {@link validateSettlement} — the pure platform validation oracle:
 *   declared event + authoritative outcome + shape-pinned value +
 *   integrity confidence, each refusal typed (E8).
 * - {@link EntitlementSettlementRecord} — the append-only settlement
 *   record with audit references; {@link admitSettlement} is its
 *   admission oracle (duplicate settlement ids and re-settlement of an
 *   already-settled entitlement are refused — first receipt stands).
 *
 * Mutable state owner: the platform economy service (PL-017) owns the
 * settlement journal; this module is the pure admission rule set.
 *
 * Purity: pure types + pure guards + two pure oracles. No IO, no clock
 * (recordedAt is caller-supplied), no economy math.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { ContentDigest, SubjectId, TenantId, TimestampMs } from "./primitives.ts";
import { isValidContentDigest } from "./primitives.ts";
import type { GameEventKind } from "./events.ts";
import type { EntitlementGrantId } from "./entitlements.ts";
import type { EconomyValueRef } from "./economy-values.ts";
import { isEconomyValueRef, readingPinnedToShape } from "./economy-values.ts";

/** Identifier of one entitlement settlement record. */
export type SettlementId = Brand<string, "SettlementId">;

/** Parses and validates `text` as a {@link SettlementId}. */
export function asSettlementId(text: string): SettlementId | undefined {
  return isValidIdText(text) ? (text as SettlementId) : undefined;
}

// ---------------------------------------------------------------------------
// Game-side settlement eligibility declaration (lock 18)
// ---------------------------------------------------------------------------

/**
 * How a game declares one of ITS events settlement-eligible, refined for
 * the settlement pipeline: same lock-41 discipline as the PL-004 reward
 * rule (authoritative outcome REQUIRED, structural literal `true`), with
 * the value shape pinned BY DIGEST instead of a bare amount — the
 * settlement's magnitude is a game-ir kernel value (economy-values.ts),
 * never contract-level arithmetic.
 */
export interface SettlementEligibilityDeclaration {
  readonly capability: "rewards";
  readonly eventKind: GameEventKind;
  readonly entitlementKind: string;
  readonly requiresAuthoritativeOutcome: true;
  /** Minimum report-time integrity confidence for settlement (in [0,1]). */
  readonly minIntegrityConfidence: number;
  /** Digest of the game-ir ValueShape the event payload is declared to carry. */
  readonly valueShapeDigest: ContentDigest;
}

/** Returns true when `value` is a structurally valid {@link SettlementEligibilityDeclaration}. */
export function isSettlementEligibilityDeclaration(
  value: unknown,
): value is SettlementEligibilityDeclaration {
  if (typeof value !== "object" || value === null) return false;
  const declaration = value as Record<string, unknown>;
  return (
    declaration.capability === "rewards" &&
    typeof declaration.eventKind === "string" &&
    declaration.eventKind.length > 0 &&
    typeof declaration.entitlementKind === "string" &&
    declaration.entitlementKind.length > 0 &&
    declaration.requiresAuthoritativeOutcome === true &&
    typeof declaration.minIntegrityConfidence === "number" &&
    Number.isFinite(declaration.minIntegrityConfidence) &&
    declaration.minIntegrityConfidence >= 0 &&
    declaration.minIntegrityConfidence <= 1 &&
    typeof declaration.valueShapeDigest === "string" &&
    isValidContentDigest(declaration.valueShapeDigest)
  );
}

// ---------------------------------------------------------------------------
// Platform validation (typed verdicts)
// ---------------------------------------------------------------------------

/** The occurrence a settlement is requested for, as the platform sees it. */
export interface SettlementValidationRequest {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly eventKind: GameEventKind;
  /** Digest of the game-declared event occurrence (content-addressed). */
  readonly sourceEventDigest: ContentDigest;
  /** The carried economy value: opaque digest or typed kernel reading. */
  readonly value: EconomyValueRef;
  /** Digest of the AUTHORITATIVE outcome evidence backing the occurrence. */
  readonly outcomeEvidence: ContentDigest;
  /** The outcome's decider — only the platform authority settles (lock 41). */
  readonly outcomeDecidedBy: "platform-authority";
  /** Report-time integrity confidence for the subject, in [0,1] (R11). */
  readonly integrityConfidence: number;
}

/** Result of {@link validateSettlement}: eligibility, or a typed refusal. */
export type SettlementValidationVerdict =
  | {
      readonly ok: true;
      readonly matched: { readonly eventKind: GameEventKind; readonly entitlementKind: string };
    }
  | {
      readonly ok: false;
      readonly code:
        | "event-not-declared"
        | "outcome-not-authoritative"
        | "value-shape-mismatch"
        | "integrity-below-threshold"
        | "malformed-request";
    };

/**
 * THE platform validation oracle (pure). Rules, in order: the request
 * must be structurally sound (`malformed-request`); the event kind must
 * be covered by a settlement eligibility declaration
 * (`event-not-declared` — undeclared events never settle, lock 18); the
 * outcome must be platform-decided (`outcome-not-authoritative` —
 * client-asserted outcomes never settle, lock 41); a typed kernel
 * reading must be pinned to the DECLARED value shape
 * (`value-shape-mismatch` — opaque values carry no shape claim and pass);
 * and the report-time integrity confidence must meet the declaration's
 * minimum (`integrity-below-threshold`, R11).
 */
export function validateSettlement(
  request: unknown,
  declarations: readonly SettlementEligibilityDeclaration[],
): SettlementValidationVerdict {
  if (typeof request !== "object" || request === null) {
    return { ok: false, code: "malformed-request" };
  }
  const candidate = request as Record<string, unknown>;
  const eventKind = candidate.eventKind;
  if (typeof eventKind !== "string" || eventKind.length === 0) {
    return { ok: false, code: "malformed-request" };
  }
  if (!isEconomyValueRef(candidate.value)) return { ok: false, code: "malformed-request" };
  if (typeof candidate.integrityConfidence !== "number" || !Number.isFinite(candidate.integrityConfidence)) {
    return { ok: false, code: "malformed-request" };
  }
  if (candidate.outcomeDecidedBy !== "platform-authority") {
    return { ok: false, code: "outcome-not-authoritative" };
  }
  const declaration = declarations.find((entry) => entry.eventKind === eventKind);
  if (declaration === undefined) return { ok: false, code: "event-not-declared" };
  const value = candidate.value;
  if (value.carrier === "kernel-reading" && !readingPinnedToShape(value, declaration.valueShapeDigest)) {
    return { ok: false, code: "value-shape-mismatch" };
  }
  if (candidate.integrityConfidence < declaration.minIntegrityConfidence) {
    return { ok: false, code: "integrity-below-threshold" };
  }
  return {
    ok: true,
    matched: { eventKind: declaration.eventKind, entitlementKind: declaration.entitlementKind },
  };
}

// ---------------------------------------------------------------------------
// Settlement record (append-only, audit-referenced)
// ---------------------------------------------------------------------------

/**
 * One entitlement settlement record. Append-only (E10): a settlement is
 * never edited or retracted — revocation is a lifecycle transition
 * (entitlement-lifecycle.ts), not a settlement edit. Audit references:
 * the settled entitlement, the game event occurrence digest, the
 * authoritative outcome digest, and the matched declaration's identity.
 * The value is a carrier (economy-values.ts) — never a bare number.
 */
export interface EntitlementSettlementRecord {
  readonly settlementId: SettlementId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlement: EntitlementGrantId;
  /** Only settled entitlements produce settlement records (lifecycle pin). */
  readonly lifecycle: "settled";
  readonly value: EconomyValueRef;
  readonly sourceEventKind: GameEventKind;
  readonly sourceEventDigest: ContentDigest;
  readonly outcomeEvidence: ContentDigest;
  readonly ruleRef: {
    readonly eventKind: GameEventKind;
    readonly entitlementKind: string;
  };
  readonly decidedBy: "platform-authority";
  readonly recordedAt: TimestampMs;
}

/** Returns true when `value` is a structurally valid {@link EntitlementSettlementRecord}. */
export function isEntitlementSettlementRecord(value: unknown): value is EntitlementSettlementRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.settlementId !== "string" || record.settlementId.length === 0) return false;
  if (typeof record.subject !== "string" || record.subject.length === 0) return false;
  if (typeof record.entitlement !== "string" || record.entitlement.length === 0) return false;
  if (record.lifecycle !== "settled") return false;
  if (!isEconomyValueRef(record.value)) return false;
  if (typeof record.sourceEventKind !== "string" || record.sourceEventKind.length === 0) return false;
  if (typeof record.sourceEventDigest !== "string" || !isValidContentDigest(record.sourceEventDigest)) {
    return false;
  }
  if (typeof record.outcomeEvidence !== "string" || !isValidContentDigest(record.outcomeEvidence)) {
    return false;
  }
  const ruleRef = record.ruleRef as Record<string, unknown> | undefined;
  if (typeof ruleRef !== "object" || ruleRef === null) return false;
  if (typeof ruleRef.eventKind !== "string" || ruleRef.eventKind.length === 0) return false;
  if (typeof ruleRef.entitlementKind !== "string" || ruleRef.entitlementKind.length === 0) return false;
  if (record.decidedBy !== "platform-authority") return false;
  return (
    typeof record.recordedAt === "number" &&
    Number.isSafeInteger(record.recordedAt) &&
    record.recordedAt >= 0
  );
}

/** Result of {@link admitSettlement}. */
export type SettlementAdmission =
  | { readonly ok: true; readonly settlementId: SettlementId }
  | {
      readonly ok: false;
      readonly code:
        | "non-authoritative-source"
        | "malformed-record"
        | "duplicate-settlement-id"
        | "entitlement-already-settled"
        | "lifecycle-not-settled";
    };

/**
 * THE settlement admission oracle (pure, append-only discipline). Rules,
 * in order: the platform authority marker first (`non-authoritative-
 * source` — client-asserted settlements never admit, lock 41); structural
 * validity (`malformed-record`); the lifecycle pin (`lifecycle-not-settled`
 * — only settled entitlements produce records); a settlement id already
 * in the journal (`duplicate-settlement-id`); and an entitlement already
 * settled in the journal (`entitlement-already-settled` — one settlement
 * per entitlement, first receipt stands, E8 anti-gaming).
 */
export function admitSettlement(
  record: unknown,
  journal: readonly EntitlementSettlementRecord[],
): SettlementAdmission {
  if (typeof record !== "object" || record === null) {
    return { ok: false, code: "malformed-record" };
  }
  const candidate = record as Record<string, unknown>;
  if (candidate.decidedBy !== "platform-authority") {
    return { ok: false, code: "non-authoritative-source" };
  }
  if (!isEntitlementSettlementRecord(record)) return { ok: false, code: "malformed-record" };
  const settlement = record as EntitlementSettlementRecord;
  if (settlement.lifecycle !== "settled") return { ok: false, code: "lifecycle-not-settled" };
  if (journal.some((prior) => prior.settlementId === settlement.settlementId)) {
    return { ok: false, code: "duplicate-settlement-id" };
  }
  if (journal.some((prior) => prior.entitlement === settlement.entitlement)) {
    return { ok: false, code: "entitlement-already-settled" };
  }
  return { ok: true, settlementId: settlement.settlementId };
}
