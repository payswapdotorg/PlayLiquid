/**
 * CONTRIBUTION READ MODELS (pure): project the community package's
 * authoritative contribution records (ContributionRecord, PL-032) into
 * typed view models for the workbench's Contributions surface — one row
 * per contribution with its provenance summary, its lifecycle status and
 * its E8 trust state.
 *
 * Provenance is VISIBLE, never hidden (R19 discipline at the seam): every
 * row carries the content-addressed contribution id, the origin kind, the
 * AI-disclosure state and the R18 gap link. The full provenance detail of
 * the SELECTED contribution projects separately (provenance-view.ts).
 *
 * Tenancy (R20): a contribution belonging to a tenant other than the
 * viewer's renders as a visible foreign-tenant row and can never be
 * opened into the detail view (the store's typed refusal).
 *
 * Pure module: no IO, no React, no clock.
 */

import type { ContributionRecord } from "../../../../community/src/index.ts";
import type { CommunitySelection, CommunityViewer } from "./community-selection.ts";

/** One community contribution row. */
export interface ContributionRowView {
  /** Short content address (the contribution's tamper-evident id, display form). */
  readonly contributionId: string;
  /** The FULL content address (the store's selection key). */
  readonly contributionKey: string;
  readonly kind: string;
  readonly status: string;
  readonly tenant: string;
  readonly contributor: string;
  /** `original` (first-party) or `lineage-derived` (cites a base). */
  readonly originKind: "original" | "lineage-derived";
  /** Honest AI disclosure state (lock 11). */
  readonly aiGenerated: boolean;
  /** The R18 capability-gap link, when the contribution addresses one. */
  readonly gapId: string | null;
  /** The E8 trust state: untrusted until qualified at accept. */
  readonly trust: "untrusted-until-qualified" | "qualified-at-accept";
  readonly submittedAt: number;
  readonly foreignTenant: boolean;
}

/** The Contributions surface: kind-filtered rows + vocabulary summaries. */
export interface ContributionsView {
  readonly rows: readonly ContributionRowView[];
  /** The applied kind filter (null = all kinds render). */
  readonly kindFilter: string | null;
  /** The sorted distinct kinds present in the snapshot. */
  readonly kindsPresent: readonly string[];
  readonly totalContributions: number;
  readonly openCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly withdrawnCount: number;
  readonly foreignCount: number;
  readonly aiDisclosedCount: number;
  readonly gapLinkedCount: number;
}

/** Short content digest (keeps the `sha256:` prefix, 12 hex). */
function shortDigest(digest: string): string {
  const bare = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return `sha256:${bare.slice(0, 12)}`;
}

/**
 * Project contribution records + selection into the Contributions view.
 * Rows enumerate in submission order (submittedAt, then contribution id)
 * — content-derived, deterministic. The kind filter renders from the
 * SELECTION (never mutates the underlying rows).
 */
export function projectContributions(
  contributions: readonly ContributionRecord[],
  selection: CommunitySelection,
  viewer: CommunityViewer,
): ContributionsView {
  const allRows = [...contributions]
    .sort(
      (a, b) =>
        a.submittedAt - b.submittedAt || String(a.contributionId).localeCompare(String(b.contributionId)),
    )
    .map((record): ContributionRowView => {
      const originKind = record.provenance.origin.kind;
      return {
        contributionId: shortDigest(String(record.contributionId)),
        contributionKey: String(record.contributionId),
        kind: record.kind,
        status: record.status,
        tenant: String(record.tenant),
        contributor: String(record.contributor),
        originKind: originKind === "lineage-derived" ? "lineage-derived" : "original",
        aiGenerated: record.provenance.aiGenerated,
        gapId: record.gap === undefined ? null : String(record.gap.gapId),
        trust:
          record.status === "accepted" ? "qualified-at-accept" : "untrusted-until-qualified",
        submittedAt: record.submittedAt,
        foreignTenant: record.tenant !== viewer.tenant,
      } satisfies ContributionRowView;
    });
  const rows =
    selection.kindFilter === null
      ? allRows
      : allRows.filter((row) => row.kind === selection.kindFilter);
  const kindsPresent = [...new Set(allRows.map((row) => row.kind))].sort();
  return {
    rows,
    kindFilter: selection.kindFilter,
    kindsPresent,
    totalContributions: allRows.length,
    openCount: allRows.filter(
      (row) => row.status === "submitted" || row.status === "triaged" || row.status === "under-review",
    ).length,
    acceptedCount: allRows.filter((row) => row.status === "accepted").length,
    rejectedCount: allRows.filter((row) => row.status === "rejected").length,
    withdrawnCount: allRows.filter((row) => row.status === "withdrawn").length,
    foreignCount: allRows.filter((row) => row.foreignTenant).length,
    aiDisclosedCount: allRows.filter((row) => row.aiGenerated).length,
    gapLinkedCount: allRows.filter((row) => row.gapId !== null).length,
  } satisfies ContributionsView;
}

/** Deterministic summary line ("N contributions · O open · A accepted · …"). */
export function contributionsSummary(view: ContributionsView): string {
  const total = view.totalContributions;
  return `${total} contribution${total === 1 ? "" : "s"} · ${view.openCount} open · ${view.acceptedCount} accepted · ${view.rejectedCount} rejected · ${view.withdrawnCount} withdrawn · ${view.aiDisclosedCount} AI-disclosed`;
}
