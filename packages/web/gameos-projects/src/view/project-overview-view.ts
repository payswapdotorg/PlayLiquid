/**
 * PROJECT OVERVIEW READ MODELS (pure): the branches / recent commits /
 * tasks panels of the OPEN project — the project's Git surfaces
 * (game-contracts' commit-sha and branch-name vocabulary, R1: every game
 * is a Git repository) and its board tasks, projected from the project's
 * detail payload into typed view models.
 *
 * Absence is honest: no open project (or a host gap between the summary
 * and its detail payload) projects the typed empty view — never
 * fabricated rows (E11).
 *
 * Pure module: no IO, no React, no clock.
 */

import type {
  WorldProjectDetail,
  WorldProjectSummary,
} from "./projects-snapshot.ts";

/** One branch row (game-contracts vocabulary; display shortening only). */
export interface BranchRowView {
  readonly name: string;
  readonly lastCommitSha: string;
  readonly lastCommitHeadline: string;
}

/** One recent-commit row (newest first, deterministic). */
export interface CommitRowView {
  readonly sha: string;
  readonly headline: string;
  readonly author: string;
  readonly at: number;
}

/** One task row. */
export interface TaskRowView {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "in-review" | "done";
}

/** The Overview surface of the open project. */
export interface OverviewView {
  /** The open project id, or null when nothing is open. */
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly defaultBranch: string | null;
  readonly branches: readonly BranchRowView[];
  readonly commits: readonly CommitRowView[];
  readonly tasks: readonly TaskRowView[];
  readonly openTaskCount: number;
  readonly inReviewTaskCount: number;
  readonly doneTaskCount: number;
}

/** Short commit sha (keeps 40-hex shape visible, first 10 chars). */
function shortSha(sha: string): string {
  return sha.slice(0, 10);
}

/**
 * Project the open project's summary + detail into the Overview view.
 * Branches enumerate in name order; commits enumerate NEWEST FIRST
 * ((at, sha) descending — the "recent commits" panel); tasks in board
 * order (status, then id). All deterministic (E9).
 */
export function projectOverview(
  summary: WorldProjectSummary | undefined,
  detail: WorldProjectDetail | undefined,
): OverviewView {
  if (summary === undefined && detail === undefined) {
    return {
      projectId: null,
      projectName: null,
      defaultBranch: null,
      branches: [],
      commits: [],
      tasks: [],
      openTaskCount: 0,
      inReviewTaskCount: 0,
      doneTaskCount: 0,
    } satisfies OverviewView;
  }
  const branches = [...(detail?.branches ?? [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((branch): BranchRowView => ({
      name: String(branch.name),
      lastCommitSha: shortSha(String(branch.lastCommitSha)),
      lastCommitHeadline: branch.lastCommitHeadline,
    }));
  const commits = [...(detail?.commits ?? [])]
    .sort((a, b) => b.at - a.at || String(b.sha).localeCompare(String(a.sha)))
    .map((commit): CommitRowView => ({
      sha: shortSha(String(commit.sha)),
      headline: commit.headline,
      author: String(commit.author),
      at: commit.at,
    }));
  const tasks = [...(detail?.tasks ?? [])]
    .sort((a, b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id))
    .map((task): TaskRowView => ({
      id: task.id,
      title: task.title,
      status: task.status,
    }));
  return {
    projectId: summary?.projectId ?? null,
    projectName: summary?.name ?? null,
    defaultBranch: summary === undefined ? null : String(summary.defaultBranch),
    branches,
    commits,
    tasks,
    openTaskCount: tasks.filter((task) => task.status === "open").length,
    inReviewTaskCount: tasks.filter((task) => task.status === "in-review").length,
    doneTaskCount: tasks.filter((task) => task.status === "done").length,
  } satisfies OverviewView;
}

/** Deterministic summary line for the Overview surface. */
export function overviewSummary(view: OverviewView): string {
  if (view.projectId === null) return "no project open";
  const commits = view.commits.length;
  return `${view.projectName} · ${view.branches.length} branch${view.branches.length === 1 ? "" : "es"} · ${commits} recent commit${commits === 1 ? "" : "s"} · ${view.openTaskCount} open · ${view.inReviewTaskCount} in review · ${view.doneTaskCount} done`;
}
