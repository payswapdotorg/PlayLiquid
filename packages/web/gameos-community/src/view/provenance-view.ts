/**
 * PROVENANCE READ MODELS (pure): the full provenance chain of the
 * SELECTED contribution (ContributionRecord.provenance, PL-032) — the
 * R19 discipline made visible: contributor-of-record, origin lineage
 * (first-party original vs content-addressed git-lineage base), the
 * content digest (the record's own tamper-evident id), the honest AI
 * disclosure with every model-provenance entry, the R18 gap link and the
 * E8 trust state.
 *
 * The projection NEVER re-derives trust or re-validates provenance (the
 * community service owns those); it renders what the authoritative
 * record carries. Absence is honest: no selected contribution ⇒ the
 * typed `null` detail view (rendered as an empty state, never fabricated
 * data — E11).
 *
 * Pure module: no IO, no React, no clock.
 */

import type { ContributionRecord } from "../../../../community/src/index.ts";
import type { CommunityViewer } from "./community-selection.ts";

/** One model-provenance entry row (the AI disclosure, lock 11). */
export interface ModelEntryRowView {
  readonly model: string;
  readonly provider: string;
  readonly usage: string;
  readonly disclosed: boolean;
}

/** The E8 trust class of one contribution. */
export type ContributionTrustView = "untrusted-until-qualified" | "qualified-at-accept";

/** The full provenance detail of one contribution. */
export interface ProvenanceDetailView {
  /** The FULL content address (tamper-evident id of the submission). */
  readonly contributionId: string;
  readonly kind: string;
  readonly status: string;
  readonly tenant: string;
  readonly contributor: string;
  /** `original` (first-party) or `lineage-derived` (cites a base). */
  readonly originKind: "original" | "lineage-derived";
  /**
   * The lineage base, when origin is lineage-derived: the cited
   * package coordinate (id, version, content digest) and the node's
   * content-addressed id. All null for first-party originals.
   */
  readonly basePackageId: string | null;
  readonly baseVersion: string | null;
  readonly baseContentDigest: string | null;
  readonly baseNodeId: string | null;
  /** Honest AI disclosure (lock 11). */
  readonly aiGenerated: boolean;
  readonly modelEntries: readonly ModelEntryRowView[];
  /** The R18 capability-gap link, when present. */
  readonly gapId: string | null;
  readonly cycleId: string | null;
  readonly submittedAt: number;
  /** Only the community service decides contribution facts (E8). */
  readonly decidedBy: string;
  /** The E8 trust state: untrusted until qualified at accept. */
  readonly trust: ContributionTrustView;
  readonly foreignTenant: boolean;
}

/** The Provenance surface: the selected contribution's detail or null. */
export interface ProvenanceView {
  readonly detail: ProvenanceDetailView | null;
}

/** Short content digest (keeps the `sha256:` prefix, 12 hex). */
function shortDigest(digest: string): string {
  const bare = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return `sha256:${bare.slice(0, 12)}`;
}

/** Renders a package-system semantic version as "major.minor.patch". */
function versionText(version: { readonly major: number; readonly minor: number; readonly patch: number }): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * Project the selected contribution's full provenance. Deterministic
 * (E9): same record → same detail view.
 */
export function projectProvenance(
  contribution: ContributionRecord | undefined,
  viewer: CommunityViewer,
): ProvenanceView {
  if (contribution === undefined) return { detail: null };
  const origin = contribution.provenance.origin;
  const base = origin.kind === "lineage-derived" ? origin.base : undefined;
  const detail: ProvenanceDetailView = {
    contributionId: String(contribution.contributionId),
    kind: contribution.kind,
    status: contribution.status,
    tenant: String(contribution.tenant),
    contributor: String(contribution.contributor),
    originKind: origin.kind,
    basePackageId: base === undefined ? null : base.coordinate.id,
    baseVersion: base === undefined ? null : versionText(base.coordinate.version),
    baseContentDigest: base === undefined ? null : shortDigest(String(base.coordinate.contentDigest)),
    baseNodeId: base === undefined ? null : shortDigest(base.nodeId),
    aiGenerated: contribution.provenance.aiGenerated,
    modelEntries: contribution.provenance.modelProvenance.map((entry) => ({
      model: entry.model,
      provider: entry.provider,
      usage: entry.usage,
      disclosed: entry.disclosed,
    })),
    gapId: contribution.gap === undefined ? null : String(contribution.gap.gapId),
    cycleId: contribution.gap === undefined ? null : String(contribution.gap.cycleId),
    submittedAt: contribution.submittedAt,
    decidedBy: contribution.decidedBy,
    trust:
      contribution.status === "accepted"
        ? "qualified-at-accept"
        : "untrusted-until-qualified",
    foreignTenant: contribution.tenant !== viewer.tenant,
  };
  return { detail };
}

/** Deterministic summary line for the provenance surface. */
export function provenanceSummary(view: ProvenanceView): string {
  if (view.detail === null) return "no contribution selected";
  const detail = view.detail;
  const origin =
    detail.originKind === "lineage-derived"
      ? `lineage-derived from ${detail.basePackageId}@${detail.baseVersion}`
      : "first-party original";
  const ai = detail.aiGenerated
    ? `AI-assisted (${detail.modelEntries.length} model entr${detail.modelEntries.length === 1 ? "y" : "ies"})`
    : "no AI use declared";
  const gap = detail.gapId === null ? "unlinked" : `gap ${detail.gapId}`;
  return `${detail.kind} · ${origin} · ${ai} · ${gap} · ${detail.trust}`;
}
