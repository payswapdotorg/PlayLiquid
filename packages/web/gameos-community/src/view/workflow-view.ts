/**
 * WORKFLOW READ MODELS (pure): project the community package's append-only
 * transition history (ContributionTransitionRecord, PL-032) into typed
 * view models for the workbench's Lifecycle surface — the normal Git
 * lifecycle states each contribution walked, in recording order.
 *
 * E10 visibility: the transition ledger renders as an append-only history
 * — rows enumerate in recording order (recordedAt, then record id for
 * determinism), every row carries its content-addressed record id, and
 * the view states the immutability rule outright. Nothing here can
 * rewrite, reorder or drop a transition.
 *
 * Tenancy (R20): transitions of another tenant's contributions render as
 * visible foreign-tenant rows.
 *
 * Pure module: no IO, no React, no clock.
 */

import type { ContributionTransitionRecord } from "../../../../community/src/index.ts";
import type { CommunityViewer } from "./community-selection.ts";

/** One append-only workflow transition row. */
export interface TransitionRowView {
  /** Short content address of the transition record (its tamper-evident id). */
  readonly recordId: string;
  /** Short content address of the contribution this transition advanced. */
  readonly contributionId: string;
  /** The source state; null on the genesis (submission) record. */
  readonly from: string | null;
  readonly to: string;
  readonly actor: string;
  readonly reason: string | null;
  readonly recordedAt: number;
  readonly foreignTenant: boolean;
}

/** The Lifecycle surface: the append-only transition ledger view. */
export interface WorkflowView {
  readonly rows: readonly TransitionRowView[];
  readonly count: number;
  /** Always true — rendered so the immutability rule is visible (E10). */
  readonly appendOnly: true;
  /** The walked states of the SELECTED contribution, joined in order; null when nothing is selected or the id is unknown. */
  readonly selectedTrail: string | null;
  readonly selectedContributionId: string | null;
}

/** Short content digest (keeps the `sha256:` prefix, 12 hex). */
function shortDigest(digest: string): string {
  const bare = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return `sha256:${bare.slice(0, 12)}`;
}

/**
 * Project the transition history into the ledger view. Recording order is
 * (recordedAt, recordId) — deterministic, append-faithful.
 */
export function projectWorkflow(
  transitions: readonly ContributionTransitionRecord[],
  viewer: CommunityViewer,
  selectedContributionId: string | null,
): WorkflowView {
  const rows = [...transitions]
    .sort(
      (a, b) =>
        a.recordedAt - b.recordedAt || String(a.recordId).localeCompare(String(b.recordId)),
    )
    .map((transition): TransitionRowView => ({
      recordId: shortDigest(String(transition.recordId)),
      contributionId: shortDigest(String(transition.contributionId)),
      from: transition.from,
      to: transition.to,
      actor: String(transition.actor),
      reason: transition.reason ?? null,
      recordedAt: transition.recordedAt,
      foreignTenant: transition.tenant !== viewer.tenant,
    }));
  // The selected contribution's walked states, derived from its own
  // transitions in recording order (the genesis record's `to` IS the
  // initial `submitted` state, so the trail is simply the walked targets
  // in order — derived, never invented). Matching happens on the FULL
  // contribution id before the display shortening.
  let selectedTrail: string | null = null;
  if (selectedContributionId !== null) {
    const own = [...transitions]
      .filter((transition) => String(transition.contributionId) === selectedContributionId)
      .sort(
        (a, b) =>
          a.recordedAt - b.recordedAt || String(a.recordId).localeCompare(String(b.recordId)),
      );
    if (own.length > 0) {
      selectedTrail = own.map((transition) => transition.to).join(" > ");
    }
  }
  return {
    rows,
    count: rows.length,
    appendOnly: true,
    selectedTrail,
    selectedContributionId: selectedContributionId,
  } satisfies WorkflowView;
}

/** Deterministic summary line ("N transitions · append-only (E10)"). */
export function workflowSummary(view: WorkflowView): string {
  return `${view.count} transition${view.count === 1 ? "" : "s"} · append-only (E10) · verdicts are terminal`;
}
