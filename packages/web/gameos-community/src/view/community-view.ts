/**
 * COMPOSITE COMMUNITY WORKBENCH VIEW (pure): the whole Community read
 * model — the three surfaces (Contributions, Lifecycle, Provenance) plus
 * the UI selection state — assembled from ONE authoritative data
 * snapshot. The workbench components render THIS model and nothing else
 * (E5: UI consumes read models projected from the authoritative
 * package's public contract).
 *
 * The snapshot types are the community package's OWN public types,
 * imported verbatim (no forked vocabulary): ContributionRecord and
 * ContributionTransitionRecord (PL-032 — the contribution domain with
 * provenance chains and the normal Git lifecycle).
 *
 * Pure module: no IO, no React, no clock (E9 — timestamps render raw).
 */

import type {
  ContributionRecord,
  ContributionTransitionRecord,
} from "../../../../community/src/index.ts";
import type {
  CommunitySelection,
  CommunityTab,
  CommunityViewer,
} from "./community-selection.ts";
import {
  projectContributions,
  type ContributionsView,
} from "./contributions-view.ts";
import { projectProvenance, type ProvenanceView } from "./provenance-view.ts";
import { projectWorkflow, type WorkflowView } from "./workflow-view.ts";

/**
 * The authoritative Community read models a host hands the workbench.
 * Every entry is a public authoritative type; the host assembles the
 * snapshot by calling the service's read doors (contributionsOf /
 * history). A production host returns viewer-scoped read models; the
 * demo host deliberately includes one foreign-tenant row so the R20
 * guard is visible and testable.
 */
export interface CommunityDataSnapshot {
  /** The tenancy scope of this read model (R20; guards selection). */
  readonly viewer: CommunityViewer;
  /** The contribution records (with full provenance chains). */
  readonly contributions: readonly ContributionRecord[];
  /** The append-only transition history (E10). */
  readonly transitions: readonly ContributionTransitionRecord[];
}

/** The whole Community workbench view model. */
export interface CommunityWorkbenchViewModel {
  readonly selection: CommunitySelection;
  readonly contributions: ContributionsView;
  readonly workflow: WorkflowView;
  readonly provenance: ProvenanceView;
}

/** Re-export the viewer tenancy and the tab vocabulary (defined in community-selection.ts). */
export type { CommunityViewer, CommunityTab };

/**
 * Project one authoritative data snapshot + UI selection into the whole
 * workbench view model. Deterministic (E9): same inputs → same view.
 */
export function projectCommunity(
  data: CommunityDataSnapshot,
  selection: CommunitySelection,
): CommunityWorkbenchViewModel {
  const selected =
    selection.contributionId === null
      ? undefined
      : data.contributions.find(
          (record) => String(record.contributionId) === selection.contributionId,
        );
  return {
    selection,
    contributions: projectContributions(data.contributions, selection, data.viewer),
    workflow: projectWorkflow(data.transitions, data.viewer, selection.contributionId),
    provenance: projectProvenance(selected, data.viewer),
  };
}

/** Deterministic header line for the whole workbench. */
export function communitySummary(view: CommunityWorkbenchViewModel): string {
  const total = view.contributions.totalContributions;
  const open = view.contributions.openCount;
  const accepted = view.contributions.acceptedCount;
  return `Community contributions · ${total} record${total === 1 ? "" : "s"} · ${open} open · ${accepted} accepted · provenance on every row (R19)`;
}
