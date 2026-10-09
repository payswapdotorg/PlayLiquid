/**
 * REWARD POLICY ADMISSION (PL-017) — how a game's eligible semantic
 * events become platform-admitted reward policies.
 *
 * Architecture "Rewards" split: GAMES DECLARE eligible semantic events and
 * policies (lock 18); the PLATFORM owns validation, entitlements and
 * settlement. The declaration shape is platform-contracts'
 * {@link SettlementEligibilityDeclaration} (PL-009 refinement): event
 * shape (eventKind + valueShapeDigest), eligibility
 * (requiresAuthoritativeOutcome literal true + minIntegrityConfidence)
 * and payout shape (entitlementKind, magnitude digest-pinned — zero
 * numeric authority).
 *
 * Admission is TOTAL-VALIDATED and duplicate-refusing: a re-registration
 * of an already-registered event kind is a typed conflict
 * (`duplicate-policy`) that names the existing payout — never a silent
 * overwrite (E8). Reserved `platform.` event kinds are refused — games
 * cannot mint platform authority events (lock 18). The PL-004
 * `RewardRuleBinding` (bare `amount`) is deliberately NOT admitted: the
 * PL-009 refinement replaced bare amounts with the shape pin; admitting
 * both would create a second payout authority.
 *
 * Purity: types + guards + one pure admission oracle. No IO.
 */

import {
  isReservedPlatformEventKind,
  isSettlementEligibilityDeclaration,
  isValidEventKindText,
} from "@playliquid/platform-contracts";
import type {
  GameEventKind,
  PlatformAuthorityMarker,
  SettlementEligibilityDeclaration,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Registered policies
// ---------------------------------------------------------------------------

/**
 * One platform-admitted reward policy: the game's declaration, the
 * tenant it is scoped to, and the admission audit facts. Policies are
 * immutable once admitted (E10 spirit): replacement is a refusal, not a
 * rewrite.
 */
export interface RegisteredRewardPolicy {
  readonly tenant: TenantId;
  readonly declaration: SettlementEligibilityDeclaration;
  readonly registeredAt: TimestampMs;
  readonly decidedBy: PlatformAuthorityMarker;
}

/** Registry key of one policy: (tenant, eventKind). */
export function policyKey(tenant: TenantId, eventKind: GameEventKind): string {
  return `${String(tenant)}|${String(eventKind)}`;
}

/** Extract the bare declarations for the contracts validation oracle. */
export function declarationsOf(
  policies: readonly RegisteredRewardPolicy[],
): readonly SettlementEligibilityDeclaration[] {
  return policies.map((policy) => policy.declaration);
}

// ---------------------------------------------------------------------------
// Admission oracle
// ---------------------------------------------------------------------------

/** Typed refusal codes (E8 negative coverage). */
export type PolicyRefusalCode =
  | "malformed-policy"
  | "invalid-event-kind"
  | "reserved-platform-event-kind"
  | "duplicate-policy";

/** Result of {@link adjudicatePolicyAdmission}. */
export type PolicyAdmission =
  | { readonly ok: true; readonly registered: RegisteredRewardPolicy }
  | { readonly ok: false; readonly code: PolicyRefusalCode; readonly detail: string };

/**
 * THE pure policy admission oracle. Rule order is normative: structural
 * validity of the whole declaration (`malformed-policy` — total
 * validation: capability, authoritative-outcome literal, bounds, shape
 * digest), event-kind grammar (`invalid-event-kind`), the reserved
 * platform namespace (`reserved-platform-event-kind`, lock 18), then the
 * duplicate conflict — the same event kind already registered under this
 * tenant is refused WITH the existing payout named in the detail
 * (`duplicate-policy` — never a silent overwrite, E8).
 */
export function adjudicatePolicyAdmission(
  tenant: TenantId,
  declaration: unknown,
  registeredAt: TimestampMs,
  existing: readonly SettlementEligibilityDeclaration[],
): PolicyAdmission {
  if (!isSettlementEligibilityDeclaration(declaration)) {
    return { ok: false, code: "malformed-policy", detail: "declaration is not a valid SettlementEligibilityDeclaration" };
  }
  const eventKind: string = declaration.eventKind;
  if (!isValidEventKindText(eventKind)) {
    return { ok: false, code: "invalid-event-kind", detail: `event kind text is malformed: ${eventKind}` };
  }
  if (isReservedPlatformEventKind(eventKind)) {
    return { ok: false, code: "reserved-platform-event-kind", detail: `games cannot declare platform authority event kinds: ${eventKind}` };
  }
  const prior = existing.find((candidate) => candidate.eventKind === eventKind);
  if (prior !== undefined) {
    return {
      ok: false,
      code: "duplicate-policy",
      detail: `event kind ${eventKind} is already registered for entitlement kind ${prior.entitlementKind} (E8: never a silent overwrite)`,
    };
  }
  return {
    ok: true,
    registered: {
      tenant,
      declaration,
      registeredAt,
      decidedBy: "platform-authority",
    },
  };
}
