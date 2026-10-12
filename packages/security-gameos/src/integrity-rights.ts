/**
 * INTEGRITY-DERIVED RIGHTS (PL-041 composing PL-018, R11) — the pure fold
 * of one platform-integrity standing verdict into a rights lattice entry.
 *
 * The verdict is TYPED PROBABILISTIC EVIDENCE, never certainty:
 * - `pronounced-deviation-observed` suspends the subject's rights in the
 *   tenant (an integrity HOLD with the confidence band attached);
 * - `deviation-observed` flags without suspending;
 * - `consistent-with-declared-mode` and `inconclusive` record a clear
 *   hold (no removal).
 *
 * STRUCTURAL CERTAINTY BAN: the minted entry carries the verdict kind,
 * the DERIVED confidence band and the aggregate interval — and no field
 * that could represent a boolean guilt/innocess claim exists anywhere on
 * it (mirroring the contracts' FORBIDDEN_VERDICT_FIELDS discipline).
 * Enforcement gravity travels ONLY as (kind, band, interval).
 *
 * Idempotency (E10): the entry id is the content digest of
 * (tenant, subject, verdictId, disposition); re-ingesting the same
 * verdict returns the recorded entry (the history is never re-mutated).
 * A NEW verdict for the same subject APPENDS and becomes the standing.
 *
 * Purity: one pure fold. No IO, no clock (time is caller-supplied).
 */

import type { IntegrityRiskVerdict } from "@playliquid/platform-contracts";
import { digestSlug } from "./digest.ts";
import type { IntegrityRightsEntry, StandingDisposition } from "./ports.ts";

/** The result of one standing ingestion. */
export type StandingIngestionResult =
  | { readonly ok: true; readonly entry: IntegrityRightsEntry; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: "no-recorded-verdict"; readonly detail: string };

/** Folds one standing verdict into a lattice entry (pure). */
export function foldStanding(
  tenant: string,
  subject: string,
  verdict: IntegrityRiskVerdict,
  existing: readonly IntegrityRightsEntry[],
  at: number,
): StandingIngestionResult {
  const disposition = dispositionOf(verdict.kind);
  const entryId = standingEntryId(tenant, subject, verdict.verdictId, disposition);
  const recorded = existing.find((entry) => entry.entryId === entryId);
  if (recorded !== undefined) {
    return { ok: true, entry: recorded, duplicate: true };
  }
  return {
    ok: true,
    duplicate: false,
    entry: {
      entryId,
      tenant,
      subject,
      verdictId: String(verdict.verdictId),
      disposition,
      verdictKind: verdict.kind,
      band: verdict.band,
      confidence: {
        lower: verdict.risk.confidence.lowerBound,
        upper: verdict.risk.confidence.upperBound,
      },
      ingestedAt: at,
      revision: existing.length + 1,
    },
  };
}

/** The entry id of one (tenant, subject, verdict, disposition) ingestion. */
export function standingEntryId(
  tenant: string,
  subject: string,
  verdictId: string,
  disposition: StandingDisposition,
): string {
  return digestSlug({ tenant, subject, verdictId, disposition }, "integrity-right");
}

/** The disposition a verdict kind yields (frozen mapping). */
export function dispositionOf(verdictKind: string): StandingDisposition {
  if (verdictKind === "pronounced-deviation-observed") return "suspended";
  if (verdictKind === "deviation-observed") return "flagged";
  return "held-clear";
}

/** The standing an entry yields for adjudication (suspends or not). */
export function suspendsFor(entry: IntegrityRightsEntry): boolean {
  return entry.disposition === "suspended";
}
