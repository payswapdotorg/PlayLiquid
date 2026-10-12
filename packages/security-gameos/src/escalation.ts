/**
 * ARENA ESCALATION RIGHTS (PL-041 composing PL-031, R18) — the pure mint
 * of one elevated review right from an INGESTED arena escalation case.
 *
 * Ingestion-only, never mutating live state: the case arrives as passive
 * data through the read port (the arena runtime stays the owner; no door
 * here touches its state). The mint REQUIRES:
 * - the case to exist for the CALLER'S tenant (the PL-031 read doors'
 *   own `unknown-case` / `cross-tenant` codes surface verbatim);
 * - the case to have reached the `ingested` lifecycle state — its
 *   evidence package was filed (a case still in flight mints nothing:
 *   `case-not-ingested`).
 *
 * The minted right pins the case's content-addressed digest (the
 * evidence) and is idempotent per case (E10): minting the same case for
 * the same subject again returns the recorded right; minting it for a
 * DIFFERENT subject is a NEW right (multiple reviewers may hold one).
 *
 * Purity: one pure fold. No IO, no clock (time is caller-supplied).
 */

import { digestSlug } from "./digest.ts";
import type { ElevatedReviewRight, EscalationCaseRead } from "./ports.ts";

/** The result of one elevated-review-right mint. */
export type EscalationRightResult =
  | { readonly ok: true; readonly right: ElevatedReviewRight; readonly duplicate: boolean }
  | {
      readonly ok: false;
      readonly code: "unknown-case" | "cross-tenant" | "case-not-ingested";
      readonly detail: string;
    };

/** Mints one elevated review right from an ingested case (pure). */
export function mintEscalationRight(
  tenant: string,
  subject: string,
  caseId: string,
  read: EscalationCaseRead,
  existing: readonly ElevatedReviewRight[],
  at: number,
): EscalationRightResult {
  if (!read.ok) {
    return { ok: false, code: read.code, detail: `arena case read refused: ${read.code}` };
  }
  const record = read.record;
  if (record.tenant !== tenant) {
    // Defensive: the read port is tenant-scoped, so this is unreachable in
    // a correct composition — the gate stays closed anyway (E8).
    return { ok: false, code: "cross-tenant", detail: "case record belongs to another tenant" };
  }
  if (record.state !== "ingested") {
    return {
      ok: false,
      code: "case-not-ingested",
      detail: `case ${caseId} is at lifecycle state ${JSON.stringify(record.state)}; only ingested cases mint review rights`,
    };
  }
  const rightId = escalationRightId(tenant, subject, caseId);
  const recorded = existing.find((right) => right.rightId === rightId);
  if (recorded !== undefined) {
    return { ok: true, right: recorded, duplicate: true };
  }
  return {
    ok: true,
    duplicate: false,
    right: {
      rightId,
      tenant,
      subject,
      caseId,
      evidenceDigest: record.caseDigest,
      mintedAt: at,
      revision: existing.length + 1,
    },
  };
}

/** The right id of one (tenant, subject, case) mint (content-derived, E9). */
export function escalationRightId(tenant: string, subject: string, caseId: string): string {
  return digestSlug({ tenant, subject, caseId }, "arena-review-right");
}
