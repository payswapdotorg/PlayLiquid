/**
 * SEARCH READ MODELS (pure): project lab-organization's authoritative
 * search-session read model (StoredSearch, PL-029) and its emitted
 * candidate streams (SearchedCandidate) into typed view models for the
 * workbench's Searches surface. Determinism (E9) is VISIBLE here: each
 * row shows the request's reproducibility seed and the content-addressed
 * space digest; enumeration order is content-derived.
 *
 * Tenancy (R20): a search belonging to a tenant other than the viewer's
 * renders as a visible foreign-tenant row and can NEVER be selected into
 * the detail view (the store's typed refusal; lab-view threads viewer).
 *
 * Pure module: no IO, no React, no clock.
 */

import type {
  SearchedCandidate,
  StoredSearch,
} from "../../../../lab-organization/src/index.ts";
import type { LabSelection, LabViewer } from "./lab-selection.ts";

/** One organization search session row. */
export interface SearchRowView {
  readonly searchId: string;
  readonly tenant: string;
  readonly owner: string;
  readonly cycleId: string;
  /** The request's reproducibility seed (E9 — rendered, never hidden). */
  readonly seed: string;
  readonly spaceSize: number;
  readonly position: number;
  readonly emitted: number;
  readonly done: boolean;
  readonly spaceDigest: string;
  readonly openedAt: number;
  /** True when the row belongs to a tenant other than the viewer's (R20). */
  readonly foreignTenant: boolean;
}

/** One candidate of the selected search's emitted stream. */
export interface CandidateRowView {
  readonly position: number;
  readonly spaceIndex: number;
  readonly isBaseline: boolean;
  readonly agentCount: number | null;
  readonly capabilitySpread: string | null;
  readonly organization: string;
  readonly contentDigest: string;
}

/** The Searches surface: one row per session + the selected stream. */
export interface SearchesView {
  readonly rows: readonly SearchRowView[];
  readonly candidates: readonly CandidateRowView[];
  readonly selectedSearchId: string | null;
  readonly totalSearches: number;
  readonly openStreams: number;
  readonly totalCandidates: number;
}

/** Short content digest (keeps the `sha256:` prefix, 12 hex). */
function shortDigest(digest: string): string {
  const bare = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return `sha256:${bare.slice(0, 12)}`;
}

/**
 * Project search sessions + candidate streams + selection into the
 * Searches view. `candidateStreams` is the host-assembled grouping keyed
 * by search id; the selected stream renders in the detail table.
 */
export function projectSearches(
  searches: readonly StoredSearch[],
  candidateStreams: Readonly<Record<string, readonly SearchedCandidate[]>>,
  selection: LabSelection,
  viewer: LabViewer,
): SearchesView {
  const rows = [...searches]
    .sort((a, b) => a.openedAt - b.openedAt || a.searchId.localeCompare(b.searchId))
    .map((search): SearchRowView => {
      const emitted = (candidateStreams[search.searchId] ?? []).length;
      const done = emitted >= search.space.size;
      return {
        searchId: search.searchId,
        tenant: String(search.tenant),
        owner: String(search.owner),
        cycleId: String(search.request.cycleId),
        seed: String(search.request.seed),
        spaceSize: search.space.size,
        position: search.position,
        emitted,
        done,
        spaceDigest: shortDigest(String(search.space.digest)),
        openedAt: search.openedAt,
        foreignTenant: search.tenant !== viewer.tenant,
      } satisfies SearchRowView;
    });
  const selected = rows.find((row) => row.searchId === selection.searchId) ?? null;
  const candidates = ((selection.searchId !== null ? candidateStreams[selection.searchId] : undefined) ?? [])
    .map((candidate): CandidateRowView => ({
      position: candidate.position,
      spaceIndex: candidate.spaceIndex,
      isBaseline: candidate.isBaseline,
      agentCount: candidate.blueprint?.agentCount ?? null,
      capabilitySpread: candidate.blueprint?.capabilitySpread ?? null,
      organization: String(candidate.organization),
      contentDigest: shortDigest(String(candidate.contentDigest)),
    }));
  return {
    rows,
    candidates,
    selectedSearchId: selected?.searchId ?? null,
    totalSearches: rows.length,
    openStreams: rows.filter((row) => !row.done).length,
    totalCandidates: Object.values(candidateStreams).reduce((sum, stream) => sum + stream.length, 0),
  } satisfies SearchesView;
}

/** Deterministic summary line ("N sessions · M open · K candidates"). */
export function searchesSummary(view: SearchesView): string {
  const total = view.totalSearches;
  const open = view.openStreams;
  const candidates = view.totalCandidates;
  return `${total} session${total === 1 ? "" : "s"} · ${open} open · ${candidates} candidate${candidates === 1 ? "" : "s"}`;
}
