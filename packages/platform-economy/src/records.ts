/**
 * ECONOMY RECORDS + DETERMINISTIC IDENTIFIER MINTS (E9).
 *
 * Every identifier this authority mints is a pure function of the
 * occurrence's idempotency facts: the same declared event occurrence
 * always yields the same grant/settlement/ledger identifiers, so replays
 * are replay-stable and snapshots are byte-reproducible. Mints use the
 * package's pure SHA-256 (digest.ts) over the canonical key text and
 * keep to the platform id grammar (slug-safe prefixes + hex slices).
 *
 * This module also builds the authoritative record shapes the service
 * journals: the {@link EntitlementGrant} (platform-contracts PL-004), the
 * {@link EntitlementProvenance} (the audit facts carried from admission
 * to final settlement) and the {@link SettlementReceipt} (the immutable
 * first-receipt artifact, E10).
 *
 * Purity: constructors + mint functions only. No IO, no clock (recordedAt
 * is caller-supplied).
 */

import type {
  ContentDigest,
  EconomyValueRef,
  EntitlementGrant,
  EntitlementGrantId,
  EntitlementSettlementRecord,
  GameEventKind,
  LedgerEntryId,
  PlatformAuthorityMarker,
  SettlementId,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import { sha256Hex } from "./digest.ts";
import type { SettlementMode } from "./settlement.ts";

// ---------------------------------------------------------------------------
// Idempotency key + deterministic identifier mints
// ---------------------------------------------------------------------------

/**
 * THE settlement idempotency key: one tenant + one subject + one declared
 * event kind + one content-addressed event occurrence. One occurrence
 * settles at most once per subject (E9/E10).
 */
export function settlementIdempotencyKey(
  tenant: TenantId,
  subject: SubjectId,
  eventKind: GameEventKind,
  sourceEventDigest: ContentDigest,
): string {
  return `${String(tenant)}|${String(subject)}|${String(eventKind)}|${String(sourceEventDigest)}`;
}

/** Deterministic occurrence digest the identifier mints derive from. */
export function occurrenceDigestOf(key: string): string {
  return sha256Hex(key);
}

function slugOf(prefix: string, key: string): string {
  return `${prefix}-${occurrenceDigestOf(key).slice(0, 24)}`;
}

/** Deterministically mint the entitlement grant id of one occurrence. */
export function mintGrantId(key: string): EntitlementGrantId {
  return slugOf("ent", key) as EntitlementGrantId;
}

/** Deterministically mint the settlement record id of one occurrence. */
export function mintSettlementId(key: string): SettlementId {
  return slugOf("stl", key) as SettlementId;
}

/** Deterministically mint the grant ledger entry id of one occurrence. */
export function mintLedgerEntryId(key: string): LedgerEntryId {
  return slugOf("led", key) as LedgerEntryId;
}

/** Deterministically mint the revocation clawback entry id of one attempt. */
export function mintRevokeEntryId(entitlement: EntitlementGrantId, attempt: string): LedgerEntryId {
  return slugOf("led", `${String(entitlement)}|revoke|${attempt}`) as LedgerEntryId;
}

// ---------------------------------------------------------------------------
// Provenance + grant construction
// ---------------------------------------------------------------------------

/**
 * The audit facts carried from settlement admission to final settlement
 * of one entitlement: the originating declared event, its authoritative
 * outcome evidence, the digest-pinned economy value, the admission mode
 * and the integrity evidence (if any) the admission consulted.
 */
export interface EntitlementProvenance {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly eventKind: GameEventKind;
  readonly sourceEventDigest: ContentDigest;
  readonly outcomeEvidence: ContentDigest;
  readonly value: EconomyValueRef;
  readonly mode: SettlementMode;
  readonly integrityEvidenceDigest: ContentDigest | undefined;
}

/**
 * Build the platform-decided {@link EntitlementGrant} of one admitted
 * occurrence: idempotency key { subject, sourceOutcome, entitlementKind }
 * exactly as the contracts oracle expects.
 */
export function entitlementGrantOf(
  provenance: EntitlementProvenance,
  grantId: EntitlementGrantId,
  amount: number,
): EntitlementGrant {
  return {
    grantId,
    tenant: provenance.tenant,
    subject: provenance.subject,
    entitlementKind: provenance.entitlementKind,
    amount,
    causation: {
      sourceEventKind: provenance.eventKind,
      outcomeEvidence: provenance.outcomeEvidence,
    },
    decidedBy: "platform-authority",
    idempotency: {
      subject: provenance.subject,
      sourceOutcome: provenance.outcomeEvidence,
      entitlementKind: provenance.entitlementKind,
    },
  };
}

// ---------------------------------------------------------------------------
// Receipt (immutable first-receipt artifact, E10)
// ---------------------------------------------------------------------------

/** The recorded outcome of one admitted settlement request. */
export interface SettlementReceipt {
  readonly receiptId: string;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly entitlementKind: string;
  readonly grantId: EntitlementGrantId;
  readonly quantity: number;
  readonly balanceAfter: number;
  /** Terminal lifecycle reached by this admission: settled, or held pending cause resolution. */
  readonly lifecycle: "settled" | "held";
  /** Present iff the admission settled immediately; held admissions finalize via completeSettlement. */
  readonly settlementId: SettlementId | undefined;
  readonly sourceEventDigest: ContentDigest;
  readonly outcomeEvidence: ContentDigest;
  readonly integrityEvidenceDigest: ContentDigest | undefined;
  readonly recordedAt: TimestampMs;
  readonly decidedBy: PlatformAuthorityMarker;
}

// ---------------------------------------------------------------------------
// Settlement record construction (PL-009 shape)
// ---------------------------------------------------------------------------

/**
 * Build the append-only {@link EntitlementSettlementRecord} of one
 * entitlement reaching its terminal `settled` state. The value and rule
 * reference come from the stored provenance; the lifecycle pin is the
 * literal `"settled"` (only settled entitlements produce records).
 */
export function settlementRecordOf(facts: {
  readonly settlementId: SettlementId;
  readonly grantId: EntitlementGrantId;
  readonly provenance: EntitlementProvenance;
  readonly recordedAt: TimestampMs;
}): EntitlementSettlementRecord {
  const { provenance } = facts;
  return {
    settlementId: facts.settlementId,
    tenant: provenance.tenant,
    subject: provenance.subject,
    entitlement: facts.grantId,
    lifecycle: "settled",
    value: provenance.value,
    sourceEventKind: provenance.eventKind,
    sourceEventDigest: provenance.sourceEventDigest,
    outcomeEvidence: provenance.outcomeEvidence,
    ruleRef: {
      eventKind: provenance.eventKind,
      entitlementKind: provenance.entitlementKind,
    },
    decidedBy: "platform-authority",
    recordedAt: facts.recordedAt,
  };
}
