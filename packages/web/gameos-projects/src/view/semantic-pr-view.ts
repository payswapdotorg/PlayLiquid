/**
 * SEMANTIC PULL REQUEST READ MODELS (pure): the semantic-PR review
 * surface of the OPEN project — one row per open pull request with its
 * lifecycle status (community's frozen state machine, reused VERBATIM —
 * never forked), its change-kind summary line (git-lineage's frozen
 * semantic change-kind vocabulary, ordered by SEMANTIC_CHANGE_KINDS) and
 * the picked pull request's full review detail.
 *
 * `legalTransitionsFor` is THE review-action availability model: the
 * commands the workbench may dispatch for one status, computed from the
 * community package's own frozen tables (TRANSITION_COMMANDS and
 * COMMAND_FROM_STATES, imported verbatim). The UI never re-derives
 * legality anywhere else (E1).
 *
 * Pure module: no IO, no React, no clock.
 */

import { SEMANTIC_CHANGE_KINDS } from "../../../../git-lineage/src/index.ts";
import { COMMAND_FROM_STATES, TRANSITION_COMMANDS } from "../../../../community/src/index.ts";
import type {
  ContributionId,
  ContributionStatus,
  TransitionCommandKind,
} from "../../../../community/src/index.ts";
import type {
  ChangeKindCount,
  WorldProjectDetail,
} from "./projects-snapshot.ts";

// ---------------------------------------------------------------------------
// The review-action availability model (community's frozen machine)
// ---------------------------------------------------------------------------

/**
 * The transition commands that are LEGAL from one pull-request status —
 * computed from community's frozen COMMAND_FROM_STATES table (imported
 * verbatim, never forked). Terminal verdicts admit no commands (E10).
 */
export function legalTransitionsFor(status: ContributionStatus): readonly TransitionCommandKind[] {
  return TRANSITION_COMMANDS.filter((command) => COMMAND_FROM_STATES[command].includes(status));
}

// ---------------------------------------------------------------------------
// The change-kind summary line
// ---------------------------------------------------------------------------

/** Sort change-kind counts into the frozen SEMANTIC_CHANGE_KINDS order. */
function inVocabularyOrder(counts: readonly ChangeKindCount[]): readonly ChangeKindCount[] {
  return [...counts].sort(
    (a, b) =>
      SEMANTIC_CHANGE_KINDS.indexOf(a.kind) - SEMANTIC_CHANGE_KINDS.indexOf(b.kind) ||
      a.kind.localeCompare(b.kind),
  );
}

/**
 * The one-line change-kind summary of a pull request, e.g.
 * "3 package · 1 world · 2 asset" — kinds in frozen vocabulary order,
 * zero counts excluded, "no classified changes" when empty.
 */
export function changeKindSummaryLine(counts: readonly ChangeKindCount[]): string {
  const present = inVocabularyOrder(counts).filter((entry) => entry.count > 0);
  if (present.length === 0) return "no classified changes";
  return present.map((entry) => `${entry.count} ${entry.kind}`).join(" · ");
}

// ---------------------------------------------------------------------------
// The pull-request surface projections
// ---------------------------------------------------------------------------

/** One pull-request list row. */
export interface PullRequestRowView {
  /** Short content address (display form). */
  readonly prId: string;
  /** The FULL content address (the store's selection key). */
  readonly prKey: ContributionId;
  readonly title: string;
  readonly author: string;
  readonly status: ContributionStatus;
  readonly baseRef: string;
  readonly headRef: string;
  readonly changeKindLine: string;
  readonly subjectCount: number;
}

/** The full review detail of the picked pull request. */
export interface PullRequestDetailView {
  /** The FULL content address (the contribution id of the pull request). */
  readonly prId: ContributionId;
  readonly title: string;
  readonly author: string;
  readonly status: ContributionStatus;
  readonly baseRef: string;
  readonly headRef: string;
  /** Changes per kind, sorted by the frozen SEMANTIC_CHANGE_KINDS order. */
  readonly changeKindCounts: readonly ChangeKindCount[];
  readonly subjectCount: number;
  /** Content address of the classified semantic diff (pins the counts). */
  readonly semanticDiffId: string;
  /** The review commands legal from the current status (community machine). */
  readonly legalTransitions: readonly TransitionCommandKind[];
}

/** The semantic-PR surface of the open project. */
export interface PullRequestsView {
  readonly rows: readonly PullRequestRowView[];
  readonly selected: PullRequestDetailView | null;
  readonly totalPullRequests: number;
  readonly openCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly withdrawnCount: number;
}

/** Short content digest (keeps the `sha256:` prefix, 12 hex). */
function shortDigest(digest: string): string {
  const bare = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return `sha256:${bare.slice(0, 12)}`;
}

/**
 * Project the open project's detail payload + selection into the
 * semantic-PR view. Rows enumerate in (title, prId) order; the picked
 * pull request projects its full review detail with the legal review
 * commands. Deterministic (E9).
 */
export function projectPullRequests(
  detail: WorldProjectDetail | undefined,
  selection: { readonly prId: string | null },
): PullRequestsView {
  if (detail === undefined) {
    return {
      rows: [],
      selected: null,
      totalPullRequests: 0,
      openCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      withdrawnCount: 0,
    } satisfies PullRequestsView;
  }
  const rows = [...detail.pullRequests]
    .sort((a, b) => a.title.localeCompare(b.title) || String(a.prId).localeCompare(String(b.prId)))
    .map((pr): PullRequestRowView => ({
      prId: shortDigest(String(pr.prId)),
      prKey: pr.prId,
      title: pr.title,
      author: String(pr.author),
      status: pr.status,
      baseRef: String(pr.baseRef),
      headRef: String(pr.headRef),
      changeKindLine: changeKindSummaryLine(pr.changeKindCounts),
      subjectCount: pr.subjectCount,
    }));
  const picked =
    selection.prId === null
      ? undefined
      : detail.pullRequests.find((pr) => String(pr.prId) === selection.prId);
  const selected: PullRequestDetailView | null =
    picked === undefined
      ? null
      : {
          prId: picked.prId,
          title: picked.title,
          author: String(picked.author),
          status: picked.status,
          baseRef: String(picked.baseRef),
          headRef: String(picked.headRef),
          changeKindCounts: inVocabularyOrder(picked.changeKindCounts),
          subjectCount: picked.subjectCount,
          semanticDiffId: String(picked.semanticDiffId),
          legalTransitions: legalTransitionsFor(picked.status),
        };
  const all = [...detail.pullRequests];
  return {
    rows,
    selected,
    totalPullRequests: all.length,
    openCount: all.filter(
      (pr) =>
        pr.status === "submitted" || pr.status === "triaged" || pr.status === "under-review",
    ).length,
    acceptedCount: all.filter((pr) => pr.status === "accepted").length,
    rejectedCount: all.filter((pr) => pr.status === "rejected").length,
    withdrawnCount: all.filter((pr) => pr.status === "withdrawn").length,
  } satisfies PullRequestsView;
}

/** Deterministic summary line for the semantic-PR surface. */
export function pullRequestsSummary(view: PullRequestsView): string {
  const total = view.totalPullRequests;
  return `${total} pull request${total === 1 ? "" : "s"} · ${view.openCount} open · ${view.acceptedCount} accepted · ${view.rejectedCount} rejected · ${view.withdrawnCount} withdrawn · lifecycle append-only (E10)`;
}
