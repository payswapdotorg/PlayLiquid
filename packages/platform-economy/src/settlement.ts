/**
 * ECONOMY SETTLEMENT ADMISSION (PL-017) — the pure oracle over the
 * platform-contracts settlement pipeline.
 *
 * THE platform owns validation (R10): the oracle binds the contracts
 * `validateSettlement` (declared event + authoritative outcome +
 * shape-pinned value + integrity threshold), lets a {@link
 * RewardIntegrityPort} reading OVERRIDE the request-carried confidence
 * (evidence before self-declaration), resolves the digest-pinned
 * magnitude through the value seam, and finally applies the contracts
 * grant admission oracle (`settleGrant`) so one authoritative outcome
 * grants one entitlement kind to one subject EXACTLY ONCE.
 *
 * Rule order is normative: request shape -> settlement idempotency
 * (replay returns the recorded receipt, E10; collision refused, E8) ->
 * contracts validation (typed codes verbatim) -> magnitude (value seam)
 * -> grant admission (typed codes verbatim). Rejected requests mutate
 * nothing; accepted requests yield a typed {@link SettlementPlan} the
 * state owner applies atomically.
 *
 * Purity: one pure function over caller-derived facts. No IO.
 */

import {
  isEconomyValueRef,
  isValidEventKindText,
  settleGrant,
  validateSettlement,
} from "@playliquid/platform-contracts";
import type {
  ContentDigest,
  EconomyValueRef,
  EntitlementGrant,
  EntitlementGrantId,
  GameEventKind,
  LedgerEntryId,
  SettlementEligibilityDeclaration,
  SettlementId,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";
import type { RewardIntegrityReading } from "./integrity-port.ts";
import { isRewardIntegrityReading } from "./integrity-port.ts";
import { mintGrantId, mintLedgerEntryId, mintSettlementId } from "./records.ts";

// ---------------------------------------------------------------------------
// Settlement request
// ---------------------------------------------------------------------------

/** How the admission finalizes: settle now, or hold pending cause resolution. */
export type SettlementMode = "immediate" | "hold";

/**
 * A settlement request for one declared event occurrence. The event must
 * be game-declared (reserved `platform.` kinds never match an admitted
 * policy), the outcome must be platform-decided (lock 41 — the typed
 * refusal for a forged decider comes from the contracts oracle), and the
 * value must be a digest-pinned economy carrier (never a bare number).
 */
export interface EconomySettlementRequest {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly eventKind: GameEventKind;
  readonly sourceEventDigest: ContentDigest;
  readonly value: EconomyValueRef;
  readonly outcomeEvidence: ContentDigest;
  readonly outcomeDecidedBy: "platform-authority";
  /** Report-time integrity confidence in [0,1]; a port reading overrides it (R10/R11). */
  readonly integrityConfidence: number;
  readonly mode: SettlementMode;
  /** Required iff mode is "hold": digest of the pending-cause document. */
  readonly holdCauseDigest?: ContentDigest;
}

/** Structural guard (shape-only; composition rules live in the oracles). */
export function isEconomySettlementRequest(value: unknown): value is EconomySettlementRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  if (typeof request.tenant !== "string" || request.tenant.length === 0) return false;
  if (typeof request.subject !== "string" || request.subject.length === 0) return false;
  if (typeof request.eventKind !== "string" || !isValidEventKindText(request.eventKind)) return false;
  const digestLike = (candidate: unknown): boolean =>
    typeof candidate === "string" && /^[0-9a-f]{64}$/.test(candidate);
  if (!digestLike(request.sourceEventDigest) || !digestLike(request.outcomeEvidence)) return false;
  if (!isEconomyValueRef(request.value)) return false;
  if (
    typeof request.integrityConfidence !== "number" ||
    !Number.isFinite(request.integrityConfidence) ||
    request.integrityConfidence < 0 ||
    request.integrityConfidence > 1
  ) {
    return false;
  }
  if (request.mode !== "immediate" && request.mode !== "hold") return false;
  if (request.mode === "hold") return digestLike(request.holdCauseDigest);
  return request.holdCauseDigest === undefined;
}

// ---------------------------------------------------------------------------
// Facts + refusal vocabulary
// ---------------------------------------------------------------------------

/** The facts the state owner derives for the oracle (never from the request). */
export interface SettlementFacts {
  /** The tenant's admitted declarations (tenant scoping is the owner's job, R20). */
  readonly declarations: readonly SettlementEligibilityDeclaration[];
  /** The settlement idempotency key was already recorded (replay encounter). */
  readonly keySeen: boolean;
  /** Outcome evidence recorded under that key, when seen (collision detect). */
  readonly recordedOutcomeEvidence: ContentDigest | undefined;
  /** Grants already recorded under the request's grant idempotency key. */
  readonly priorGrants: readonly EntitlementGrant[];
  /** The integrity-seam reading for this occurrence, when evidence exists. */
  readonly integrityReading: RewardIntegrityReading | undefined;
  /** Magnitude resolved from the value seam; `undefined` = unresolvable. */
  readonly resolvedQuantity: number | undefined;
}

/** Typed refusal codes (contracts codes surface verbatim; E8 coverage). */
export type SettlementRefusalCode =
  | "malformed-request"
  | "duplicate-settlement"
  | "idempotency-collision"
  | "event-not-declared"
  | "outcome-not-authoritative"
  | "value-shape-mismatch"
  | "integrity-below-threshold"
  | "value-not-resolvable"
  | "invalid-quantity"
  | "duplicate-grant"
  | "non-positive-amount"
  | "malformed-grant"
  | "non-authoritative-source";

/** The typed acceptance plan the state owner applies atomically. */
export interface SettlementPlan {
  readonly idempotencyKey: string;
  readonly quantity: number;
  readonly entitlementKind: string;
  readonly effectiveConfidence: number;
  readonly integrityEvidenceDigest: ContentDigest | undefined;
  readonly grantId: EntitlementGrantId;
  readonly settlementId: SettlementId;
  readonly entryId: LedgerEntryId;
  readonly mode: SettlementMode;
}

/** Result of {@link adjudicateEconomySettlement}. */
export type EconomySettlementAdmission =
  | { readonly accepted: true; readonly plan: SettlementPlan }
  | { readonly accepted: false; readonly code: SettlementRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------

/**
 * THE pure settlement admission oracle. Rules, in normative order:
 * request shape (`malformed-request`); the settlement idempotency
 * encounter — a recorded key with the SAME outcome evidence is a replay
 * (`duplicate-settlement`, first receipt stands, E10) and with a
 * DIFFERENT one is a collision (`idempotency-collision`, E8); the
 * contracts validation oracle over the INTEGRITY-OVERRIDDEN request
 * (codes verbatim, R10: platform-owned validation); the resolved
 * magnitude (`value-not-resolvable` / `invalid-quantity`); and the
 * contracts grant admission oracle over the deterministically minted
 * grant (codes verbatim — one outcome grants one kind to one subject
 * exactly once).
 */
export function adjudicateEconomySettlement(
  request: unknown,
  facts: SettlementFacts,
): EconomySettlementAdmission {
  if (!isEconomySettlementRequest(request)) {
    return { accepted: false, code: "malformed-request", detail: "request is not a valid EconomySettlementRequest" };
  }
  const key = settlementKeyOf(request);
  if (facts.keySeen) {
    if (facts.recordedOutcomeEvidence === request.outcomeEvidence) {
      return {
        accepted: false,
        code: "duplicate-settlement",
        detail: "event occurrence already settled (E10: the first receipt stands)",
      };
    }
    return {
      accepted: false,
      code: "idempotency-collision",
      detail: "event occurrence key already recorded with a DIFFERENT outcome (E8: never a second mutation)",
    };
  }
  const effective = effectiveRequestOf(request, facts.integrityReading);
  const verdict = validateSettlement(effective, facts.declarations);
  if (!verdict.ok) {
    return { accepted: false, code: verdict.code, detail: `settlement validation refused: ${verdict.code}` };
  }
  if (facts.resolvedQuantity === undefined) {
    return { accepted: false, code: "value-not-resolvable", detail: "the economy value seam could not resolve a magnitude for the carried value" };
  }
  if (!Number.isSafeInteger(facts.resolvedQuantity) || facts.resolvedQuantity < 1) {
    return { accepted: false, code: "invalid-quantity", detail: `resolved quantity must be a positive safe integer, got ${String(facts.resolvedQuantity)}` };
  }
  const grantId = mintGrantId(key);
  const grant = grantCandidateOf(request, grantId, verdict.matched.entitlementKind, facts.resolvedQuantity);
  const disposition = settleGrant(grant, facts.priorGrants);
  if (disposition.disposition === "refused") {
    return { accepted: false, code: disposition.code, detail: `grant admission refused: ${disposition.code}` };
  }
  return {
    accepted: true,
    plan: {
      idempotencyKey: key,
      quantity: facts.resolvedQuantity,
      entitlementKind: verdict.matched.entitlementKind,
      effectiveConfidence: effective.integrityConfidence,
      integrityEvidenceDigest: facts.integrityReading?.evidenceDigest,
      grantId,
      settlementId: mintSettlementId(key),
      entryId: mintLedgerEntryId(key),
      mode: request.mode,
    },
  };
}

/** The settlement idempotency key of a (structurally valid) request. */
export function settlementKeyOf(request: EconomySettlementRequest): string {
  return `${String(request.tenant)}|${String(request.subject)}|${String(request.eventKind)}|${String(request.sourceEventDigest)}`;
}

/**
 * The integrity-overridden request: a port reading replaces the carried
 * confidence (R10 — the platform's evidence outranks the game's
 * self-declaration). An invalid reading is ignored rather than trusted.
 */
function effectiveRequestOf(
  request: EconomySettlementRequest,
  reading: RewardIntegrityReading | undefined,
): EconomySettlementRequest {
  if (reading === undefined || !isRewardIntegrityReading(reading)) return request;
  return { ...request, integrityConfidence: reading.confidence };
}

/** The grant candidate the oracle mints for the contracts admission. */
function grantCandidateOf(
  request: EconomySettlementRequest,
  grantId: EntitlementGrantId,
  entitlementKind: string,
  quantity: number,
): EntitlementGrant {
  return {
    grantId,
    tenant: request.tenant,
    subject: request.subject,
    entitlementKind,
    amount: quantity,
    causation: {
      sourceEventKind: request.eventKind,
      outcomeEvidence: request.outcomeEvidence,
    },
    decidedBy: "platform-authority",
    idempotency: {
      subject: request.subject,
      sourceOutcome: request.outcomeEvidence,
      entitlementKind,
    },
  };
}
