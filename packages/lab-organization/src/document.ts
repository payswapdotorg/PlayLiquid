/**
 * SERVICE-DOCUMENT HELPERS (PL-029) — the pure persistence view of the
 * Lab organization service, split from service.ts (the state owner) to
 * keep both modules inside the house file-size budget.
 *
 * - {@link organizationDocumentOf} — snapshots the four tenant-scoped
 *   tables into the content-addressed {@link LabOrganizationDocument}
 *   (the state digest covers every search id + stream position,
 *   compilation digest, evidence content key + evaluation id + replay id,
 *   and gap id + attempt count — a pure function of the state, E9/E6);
 * - {@link restoreOrganizationTables} — folds a persisted document back
 *   into the service's tables (E6 snapshot restore).
 *
 * Pure module: no IO (the store port is the seam), no clocks, no state.
 */

import type {
  LabOrganizationDocument,
  StoredCandidateEvidence,
  StoredCapabilityGap,
  StoredCompilation,
  StoredSearch,
} from "./ports.ts";
import { organizationDigestOf } from "./digest.ts";

/** The four tenant-scoped tables (read view of the service's state). */
export interface OrganizationTables {
  readonly searches: readonly StoredSearch[];
  readonly compilations: readonly StoredCompilation[];
  readonly evidence: readonly StoredCandidateEvidence[];
  readonly gaps: readonly StoredCapabilityGap[];
}

/** Mutable table targets of a document restore. */
export interface OrganizationTableSinks {
  readonly searches: Map<string, StoredSearch>;
  readonly compilations: Map<string, StoredCompilation>;
  readonly evidence: Map<string, StoredCandidateEvidence>;
  readonly gaps: Map<string, StoredCapabilityGap>;
}

/** Builds the content-addressed service document of the tables (E6). */
export function organizationDocumentOf(tables: OrganizationTables): LabOrganizationDocument {
  return {
    stateDigest: String(
      organizationDigestOf({
        searches: tables.searches.map((search) => ({
          searchId: search.searchId,
          position: search.position,
          spaceDigest: search.space.digest,
        })),
        compilations: tables.compilations.map((stored) => String(stored.compiled.contentDigest)),
        evidence: tables.evidence.map((stored) => ({
          contentKey: String(stored.contentKey),
          evaluationId: String(stored.evaluationId),
          replay: stored.run.replay.replayId,
        })),
        gaps: tables.gaps.map((stored) => ({
          gapId: String(stored.gap.gapId),
          attempts: stored.gap.attempts.length,
        })),
      }),
    ),
    searches: tables.searches,
    compilations: tables.compilations,
    evidence: tables.evidence,
    gaps: tables.gaps,
  };
}

/** Folds a persisted document back into the tables; returns the counts. */
export function restoreOrganizationTables(
  sinks: OrganizationTableSinks,
  document: LabOrganizationDocument,
): { readonly searches: number; readonly compilations: number; readonly evidence: number; readonly gaps: number } {
  sinks.searches.clear();
  for (const search of document.searches) sinks.searches.set(search.searchId, search);
  sinks.compilations.clear();
  for (const compilation of document.compilations) sinks.compilations.set(String(compilation.compiled.contentDigest), compilation);
  sinks.evidence.clear();
  for (const record of document.evidence) sinks.evidence.set(String(record.contentKey), record);
  sinks.gaps.clear();
  for (const gap of document.gaps) sinks.gaps.set(String(gap.gap.gapId), gap);
  return {
    searches: sinks.searches.size,
    compilations: sinks.compilations.size,
    evidence: sinks.evidence.size,
    gaps: sinks.gaps.size,
  };
}
