/**
 * ENTITLEMENT / ECONOMY CONTRACTS (R10; lock rules 19, 41).
 *
 * "Play-to-earn/rewards use platform entitlement/economy infrastructure."
 * "No client-authoritative rewards."
 *
 * Games declare eligible semantic events and reward rules
 * ({@link RewardRuleBinding}, lock 18); the PLATFORM owns validation,
 * integrity, entitlements and settlement (architecture "Rewards").
 *
 * Idempotent grant semantics (worker-contract "Async/stateful work"):
 * - Idempotency key: the triple { subject, sourceOutcome digest,
 *   entitlementKind } — see {@link GrantIdempotencyKey}. One authoritative
 *   outcome can grant one entitlement kind to one subject EXACTLY ONCE.
 * - {@link settleGrant} is the pure admission oracle: a replayed grant is
 *   `duplicate-grant` (first receipt stands), the same key with a
 *   different grant id or amount is a `idempotency-collision` and is
 *   REFUSED (E8 anti-gaming: never silently executed as a second grant),
 *   and grants without the platform authority marker or valid causation
 *   are refused outright.
 * - Mutable state owner: the platform economy service (PL-017) owns the
 *   ledger; {@link settleLedgerEntry} is the pure fold rule it applies.
 * - Retry semantics: retries re-submit the SAME grant; duplicates return
 *   the first disposition and never double-issue.
 *
 * Purity: no IO, no clock, no randomness.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { ContentDigest, SubjectId, TenantId } from "./primitives.ts";
import type { GameEventKind } from "./events.ts";

/** Identifier of one entitlement grant. */
export type EntitlementGrantId = Brand<string, "EntitlementGrantId">;

/** Parses and validates `text` as an {@link EntitlementGrantId}. */
export function asEntitlementGrantId(text: string): EntitlementGrantId | undefined {
  return isValidIdText(text) ? (text as EntitlementGrantId) : undefined;
}

/** Identifier of one ledger entry. */
export type LedgerEntryId = Brand<string, "LedgerEntryId">;

/** Parses and validates `text` as a {@link LedgerEntryId}. */
export function asLedgerEntryId(text: string): LedgerEntryId | undefined {
  return isValidIdText(text) ? (text as LedgerEntryId) : undefined;
}

// ---------------------------------------------------------------------------
// Idempotency key
// ---------------------------------------------------------------------------

/**
 * The grant idempotency key: one subject + one authoritative outcome +
 * one entitlement kind. Structural equality over all three fields.
 */
export interface GrantIdempotencyKey {
  readonly subject: SubjectId;
  readonly sourceOutcome: ContentDigest;
  readonly entitlementKind: string;
}

/** Structural equality of two {@link GrantIdempotencyKey}s. */
export function grantIdempotencyKeyEquals(a: GrantIdempotencyKey, b: GrantIdempotencyKey): boolean {
  return (
    a.subject === b.subject && a.sourceOutcome === b.sourceOutcome && a.entitlementKind === b.entitlementKind
  );
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

/** The causation proof every grant must carry: event + outcome evidence. */
export interface GrantCausation {
  readonly sourceEventKind: GameEventKind;
  readonly outcomeEvidence: ContentDigest;
}

/** The only admissible entitlement grant shape: platform-decided, caused. */
export interface EntitlementGrant {
  readonly grantId: EntitlementGrantId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly amount: number;
  readonly causation: GrantCausation;
  readonly decidedBy: "platform-authority";
  readonly idempotency: GrantIdempotencyKey;
}

/** Returns true when `value` is a structurally valid {@link EntitlementGrant}. */
export function isEntitlementGrant(value: unknown): value is EntitlementGrant {
  if (typeof value !== "object" || value === null) return false;
  const grant = value as Record<string, unknown>;
  if (typeof grant.grantId !== "string" || grant.grantId.length === 0) return false;
  if (typeof grant.subject !== "string" || grant.subject.length === 0) return false;
  if (typeof grant.entitlementKind !== "string" || grant.entitlementKind.length === 0) return false;
  if (typeof grant.amount !== "number" || !Number.isSafeInteger(grant.amount)) return false;
  if (grant.decidedBy !== "platform-authority") return false;
  const causation = grant.causation as Record<string, unknown> | undefined;
  if (typeof causation !== "object" || causation === null) return false;
  if (typeof causation.sourceEventKind !== "string" || causation.sourceEventKind.length === 0) return false;
  if (typeof causation.outcomeEvidence !== "string" || !/^[0-9a-f]{64}$/.test(causation.outcomeEvidence)) {
    return false;
  }
  const idempotency = grant.idempotency as Record<string, unknown> | undefined;
  if (typeof idempotency !== "object" || idempotency === null) return false;
  if (idempotency.subject !== grant.subject) return false;
  if (idempotency.sourceOutcome !== causation.outcomeEvidence) return false;
  if (idempotency.entitlementKind !== grant.entitlementKind) return false;
  return true;
}

/** Disposition of presenting a grant to the settlement oracle. */
export type GrantDisposition =
  | { readonly disposition: "issued"; readonly grantId: EntitlementGrantId }
  | {
      readonly disposition: "refused";
      readonly code:
        | "duplicate-grant"
        | "idempotency-collision"
        | "non-authoritative-source"
        | "non-positive-amount"
        | "malformed-grant";
    };

/**
 * THE grant admission oracle (pure, R10 idempotency). Rules, in order:
 * the platform authority marker first (`non-authoritative-source` —
 * client-asserted grants never pass, E8), then structural validity
 * (`malformed-grant`), positive integer amount (`non-positive-amount`),
 * then the idempotency encounter: a recorded grant with the SAME key and
 * same grant id is a replay (`duplicate-grant` — the first receipt
 * stands, no double issuance); the same key under a DIFFERENT grant id
 * or amount is a collision (`idempotency-collision` — refused, E8
 * anti-gaming).
 */
export function settleGrant(
  grant: unknown,
  recorded: readonly EntitlementGrant[],
): GrantDisposition {
  if (typeof grant !== "object" || grant === null) {
    return { disposition: "refused", code: "malformed-grant" };
  }
  const record = grant as Record<string, unknown>;
  if (record.decidedBy !== "platform-authority") {
    return { disposition: "refused", code: "non-authoritative-source" };
  }
  if (!isEntitlementGrant(grant)) return { disposition: "refused", code: "malformed-grant" };
  if (grant.amount < 1) return { disposition: "refused", code: "non-positive-amount" };
  for (const prior of recorded) {
    if (!grantIdempotencyKeyEquals(prior.idempotency, grant.idempotency)) continue;
    if (prior.grantId === grant.grantId && prior.amount === grant.amount) {
      return { disposition: "refused", code: "duplicate-grant" };
    }
    return { disposition: "refused", code: "idempotency-collision" };
  }
  return { disposition: "issued", grantId: grant.grantId };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** Why a ledger entry exists. */
export type LedgerReason = "grant" | "revoke" | "consume" | "adjust";

/** One economy ledger entry, tenant- and subject-scoped. */
export interface LedgerEntry {
  readonly entryId: LedgerEntryId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly delta: number;
  readonly reason: LedgerReason;
  readonly grantRef?: EntitlementGrantId;
  readonly balanceAfter: number;
}

/** Disposition of folding a ledger entry onto a balance. */
export type LedgerSettlement =
  | { readonly settled: true; readonly balanceAfter: number }
  | {
      readonly settled: false;
      readonly code: "duplicate-entry" | "non-integer-delta" | "zero-delta" | "negative-balance";
    };

/**
 * Pure ledger fold rule. Refuses: re-applying an entry id already in the
 * journal (`duplicate-entry`), non-integer or zero deltas, and any entry
 * that would drive the balance negative (`negative-balance` — consumption
 * beyond balance never settles).
 */
export function settleLedgerEntry(
  entry: LedgerEntry,
  journal: readonly LedgerEntry[],
  currentBalance: number,
): LedgerSettlement {
  if (journal.some((prior) => prior.entryId === entry.entryId)) {
    return { settled: false, code: "duplicate-entry" };
  }
  if (!Number.isSafeInteger(entry.delta)) return { settled: false, code: "non-integer-delta" };
  if (entry.delta === 0) return { settled: false, code: "zero-delta" };
  const next = currentBalance + entry.delta;
  if (next < 0) return { settled: false, code: "negative-balance" };
  return { settled: true, balanceAfter: next };
}

// ---------------------------------------------------------------------------
// Game-side reward rule declaration (lock 18 + lock 41)
// ---------------------------------------------------------------------------

/**
 * How a game declares one reward rule: which of ITS events, when decided
 * by an authoritative outcome, grants which entitlement and how much.
 * `requiresAuthoritativeOutcome` is the literal `true` — a reward rule
 * that bypasses authoritative outcomes is a TYPE ERROR (lock 41), proven
 * by `@ts-expect-error` tests.
 */
export interface RewardRuleBinding {
  readonly capability: "rewards";
  readonly eventKind: GameEventKind;
  readonly entitlementKind: string;
  readonly amount: number;
  readonly requiresAuthoritativeOutcome: true;
  readonly minIntegrityConfidence: number;
}

/** Returns true when `value` is a structurally valid {@link RewardRuleBinding}. */
export function isRewardRuleBinding(value: unknown): value is RewardRuleBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  return (
    binding.capability === "rewards" &&
    typeof binding.eventKind === "string" &&
    binding.eventKind.length > 0 &&
    typeof binding.entitlementKind === "string" &&
    binding.entitlementKind.length > 0 &&
    typeof binding.amount === "number" &&
    Number.isSafeInteger(binding.amount) &&
    binding.amount >= 1 &&
    binding.requiresAuthoritativeOutcome === true &&
    typeof binding.minIntegrityConfidence === "number" &&
    binding.minIntegrityConfidence >= 0 &&
    binding.minIntegrityConfidence <= 1
  );
}

// ---------------------------------------------------------------------------
// Reward issuance (request/response)
// ---------------------------------------------------------------------------

/** Refusal codes an issuance can produce (mirrors {@link settleGrant}). */
export type GrantRefusalCode = Extract<GrantDisposition, { disposition: "refused" }>["code"];

/** A request to issue rewards from one authoritative outcome. */
export interface RewardIssuanceRequest {
  readonly tenant: TenantId;
  readonly outcomeEvidence: ContentDigest;
  readonly grants: readonly EntitlementGrant[];
}

/** The platform's response: accepted grant ids and typed refusals. */
export interface RewardIssuanceResult {
  readonly issued: readonly EntitlementGrantId[];
  readonly refused: readonly { readonly grantId: EntitlementGrantId; readonly code: GrantRefusalCode }[];
}

/**
 * Pure issuance oracle: fold {@link settleGrant} over the request's
 * grants, honoring idempotency across the batch itself (a duplicated
 * grant inside ONE batch is refused exactly like a replay against the
 * ledger). Only grants whose causation evidence matches the request's
 * outcome evidence are even considered; everything else is refused as
 * `non-authoritative-source`.
 */
export function issueRewards(request: RewardIssuanceRequest): RewardIssuanceResult {
  const issued: EntitlementGrantId[] = [];
  const refused: { grantId: EntitlementGrantId; code: GrantRefusalCode }[] = [];
  const seen: EntitlementGrant[] = [];
  for (const grant of request.grants) {
    if (grant.causation.outcomeEvidence !== request.outcomeEvidence) {
      refused.push({ grantId: grant.grantId, code: "non-authoritative-source" });
      continue;
    }
    const disposition = settleGrant(grant, seen);
    if (disposition.disposition === "issued") {
      issued.push(disposition.grantId);
      seen.push(grant);
    } else {
      refused.push({ grantId: grant.grantId, code: disposition.code });
    }
  }
  return { issued, refused };
}
