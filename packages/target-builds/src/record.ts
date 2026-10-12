/**
 * THE MULTI-TARGET BUILD RECORD (PL-036) — the ONE aggregation of a fan-out:
 * every bound target's typed outcome (build id, orchestrator document
 * digest, manifest digest, artifacts), every resolution refusal, the R19
 * provenance + verification evidence aggregates (content digests, E7), the
 * overall verdict (failure isolation) and the record's own content digest.
 *
 * The record is content-addressed: `recordDigest` seals the canonical form
 * (package-system digest authority, E9) so any later tampering is
 * detectable ({@link verifyMultiTargetRecord}, E8) — the same discipline
 * as the build-orchestrator snapshot.
 */

import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import { canonicalJson } from "@playliquid/package-system";
import type { TenantId } from "@playliquid/build-orchestrator";
import type { TargetRefusal } from "./resolution.ts";
import type { TargetOutcome, MultiTargetVerdict } from "./outcomes.ts";
import type { TargetProvenanceEvidence, TargetVerificationEvidence } from "./evidence.ts";

/** One tenant-scoped multi-target build record (the aggregation of one fan-out). */
export interface MultiTargetBuildRecord {
  readonly kind: "multi-target-build-record";
  /** Deterministic record id (tenant + plan + requester + nonce, E9). */
  readonly recordId: string;
  readonly tenant: TenantId;
  readonly requester: string;
  /** The durable fan-out plan this record executed (content key, E6). */
  readonly planId: ContentDigest;
  readonly requestFingerprint: ContentDigest;
  readonly verdict: MultiTargetVerdict;
  /** Every bound target's typed outcome, in the plan's content-derived order. */
  readonly outcomes: readonly TargetOutcome[];
  /** Every resolution refusal (E8: carried, never hidden). */
  readonly refusals: readonly TargetRefusal[];
  /** R19 provenance evidence per bound target (content digests, E7). */
  readonly provenance: readonly TargetProvenanceEvidence[];
  /** Verification evidence per bound target (gate results, R19/lock 24). */
  readonly verification: readonly TargetVerificationEvidence[];
  /** Content digest of this record's canonical form (tamper detection, E8). */
  readonly recordDigest: ContentDigest;
  readonly completedAt: number;
}

/** The canonical JSON-safe form of one record (digest input; E9). */
function recordForm(record: Omit<MultiTargetBuildRecord, "recordDigest">): unknown {
  return {
    kind: record.kind,
    recordId: record.recordId,
    tenant: record.tenant,
    requester: record.requester,
    planId: record.planId,
    requestFingerprint: record.requestFingerprint,
    verdict: record.verdict,
    outcomes: record.outcomes,
    refusals: record.refusals,
    provenance: record.provenance,
    verification: record.verification,
    completedAt: record.completedAt,
  };
}

/** Computes one record's content digest over its canonical form (E9). */
export function computeRecordDigest(record: Omit<MultiTargetBuildRecord, "recordDigest">): ContentDigest {
  return computeDigest(recordForm(record));
}

/** Seals a record with its content digest (the record is immutable once sealed). */
export function sealMultiTargetRecord(record: Omit<MultiTargetBuildRecord, "recordDigest">): MultiTargetBuildRecord {
  return { ...record, recordDigest: computeRecordDigest(record) };
}

/** Verifies a sealed record's declared digest against its content (E8 tamper check). */
export function verifyMultiTargetRecord(record: MultiTargetBuildRecord): boolean {
  if (typeof record?.recordDigest !== "string") {
    return false;
  }
  const { recordDigest: _ignored, ...rest } = record;
  try {
    return record.recordDigest === computeRecordDigest(rest as Omit<MultiTargetBuildRecord, "recordDigest">);
  } catch {
    return false;
  }
}

/** The record's canonical JSON form (audit/log material; deterministic). */
export function canonicalRecordForm(record: MultiTargetBuildRecord): string {
  return canonicalJson(recordForm(record));
}

/**
 * The typed target → build-document digest mapping of one record (the
 * fan-out's completed state: every bound target's build-orchestrator
 * document digest; null for targets whose build was never admitted).
 */
export function documentDigestMapping(record: MultiTargetBuildRecord): Readonly<Record<string, string | null>> {
  const mapping: Record<string, string | null> = {};
  for (const outcome of record.outcomes) {
    mapping[outcome.target] = outcome.documentDigest === null ? null : outcome.documentDigest;
  }
  return mapping;
}

/**
 * Deterministic record-id minting (E9): same tenant + plan + requester + nonce
 * ⇒ the same record id; any variation yields a distinct one.
 */
export function mintRecordId(tenant: string, planId: ContentDigest, requester: string, nonce: string): string {
  const digest = computeDigest({ tenant, planId, requester, nonce });
  return `mtb-${digest.slice("sha256:".length, "sha256:".length + 24)}`;
}
