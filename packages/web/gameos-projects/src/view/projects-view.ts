/**
 * WORLD PROJECTS LIST PROJECTION (pure): projects the read-model snapshot
 * into the workbench's projects-list view model (E5: UI consumes read
 * models assembled from the authoritative packages' public contracts
 * only) and composes the per-tab detail projections from their own view
 * modules (overview / composition / semantic PRs). The read-model types
 * live in the shared leaf `projects-snapshot.ts` (re-exported here for
 * the module's public surface).
 *
 * The list resolves each project's effective world kind through
 * game-contracts' `resolveWorldKind` (ACR-001 — including the pre-ACR
 * default `game` for projects with no world declaration).
 *
 * Pure module: no IO, no React, no clock (E9 — timestamps render raw).
 */

import { resolveWorldKind, WORLD_KINDS } from "../../../../game-contracts/src/index.ts";
import type { WorldKind } from "../../../../game-contracts/src/index.ts";
import type { ProjectsSelection, ProjectsTab, ProjectsViewer } from "./projects-selection.ts";
import type { ProjectsDataSnapshot } from "./projects-snapshot.ts";
import { projectOverview, type OverviewView } from "./project-overview-view.ts";
import { projectComposition, type CompositionView } from "./composition-view.ts";
import { projectPullRequests, type PullRequestsView } from "./semantic-pr-view.ts";

// The read-model snapshot vocabulary is the shared leaf (projects-snapshot.ts);
// re-exported here so the module's public surface stays one entry (community
// precedent: index.ts re-exports through the view modules).
export type {
  BranchSummary,
  ChangeKindCount,
  CommitSummary,
  CompositionPin,
  ProjectsDataSnapshot,
  SemanticPullRequestSummary,
  TaskSummary,
  WorldProjectDetail,
  WorldProjectSummary,
} from "./projects-snapshot.ts";

// ---------------------------------------------------------------------------
// The projects list projection
// ---------------------------------------------------------------------------

/** One projects-list row (the resolved presentation read model). */
export interface ProjectRowView {
  readonly projectId: string;
  readonly name: string;
  /** The effective world content kind, resolved via `resolveWorldKind` (ACR-001). */
  readonly worldKind: WorldKind;
  /** True when the project carries NO world declaration and defaulted to `game`. */
  readonly worldKindDefaulted: boolean;
  readonly defaultBranch: string;
  readonly branchCount: number;
  readonly openPullRequestCount: number;
  readonly packageCount: number;
  readonly openTaskCount: number;
  readonly lastActivityAt: number;
  readonly ownerTenant: string;
  readonly foreignTenant: boolean;
}

/** The projects list surface: rows + vocabulary summaries. */
export interface ProjectsView {
  readonly rows: readonly ProjectRowView[];
  readonly totalProjects: number;
  readonly foreignCount: number;
  readonly totalOpenPullRequests: number;
  readonly totalOpenTasks: number;
  /** The distinct world kinds present, in ACR-001 frozen vocabulary order. */
  readonly worldKindsPresent: readonly WorldKind[];
}

/**
 * Project the snapshot into the projects list view. Rows enumerate in
 * (name, projectId) order — deterministic. Each row's world kind is
 * resolved through game-contracts' `resolveWorldKind` (a project with no
 * world declaration is a pre-ACR project and defaults to `game`).
 */
export function projectProjects(data: ProjectsDataSnapshot): ProjectsView {
  const rows = [...data.projects]
    .sort((a, b) => a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId))
    .map((project): ProjectRowView => {
      const worldKind = resolveWorldKind(project.worldDeclaration);
      return {
        projectId: project.projectId,
        name: project.name,
        worldKind,
        worldKindDefaulted: project.worldDeclaration?.kind === undefined,
        defaultBranch: String(project.defaultBranch),
        branchCount: project.branchCount,
        openPullRequestCount: project.openPullRequestCount,
        packageCount: project.packageCount,
        openTaskCount: project.openTaskCount,
        lastActivityAt: project.lastActivityAt,
        ownerTenant: String(project.ownerTenant),
        foreignTenant: project.ownerTenant !== data.viewer.tenantId,
      } satisfies ProjectRowView;
    });
  const worldKindsPresent = WORLD_KINDS.filter((kind) =>
    rows.some((row) => row.worldKind === kind),
  );
  return {
    rows,
    totalProjects: rows.length,
    foreignCount: rows.filter((row) => row.foreignTenant).length,
    totalOpenPullRequests: rows.reduce((sum, row) => sum + row.openPullRequestCount, 0),
    totalOpenTasks: rows.reduce((sum, row) => sum + row.openTaskCount, 0),
    worldKindsPresent,
  } satisfies ProjectsView;
}

/** Deterministic header line for the whole workbench. */
export function projectsSummary(view: ProjectsView): string {
  const total = view.totalProjects;
  const prs = view.totalOpenPullRequests;
  const tasks = view.totalOpenTasks;
  return `World projects · ${total} project${total === 1 ? "" : "s"} · ${prs} open pull request${prs === 1 ? "" : "s"} · ${tasks} open task${tasks === 1 ? "" : "s"} · world-kind read model (ACR-001) · ${view.foreignCount} foreign-tenant row${view.foreignCount === 1 ? "" : "s"} (R20)`;
}

// ---------------------------------------------------------------------------
// The composite workbench projection
// ---------------------------------------------------------------------------

/** The whole projects workbench view model. */
export interface ProjectsWorkbenchViewModel {
  readonly selection: ProjectsSelection;
  readonly projects: ProjectsView;
  readonly overview: OverviewView;
  readonly composition: CompositionView;
  readonly pullRequests: PullRequestsView;
}

/** Re-export the viewer tenancy and the tab vocabulary (defined in projects-selection.ts). */
export type { ProjectsViewer, ProjectsTab };

/**
 * Project one authoritative data snapshot + UI selection into the whole
 * workbench view model. Deterministic (E9): same inputs → same view.
 */
export function projectWorkbench(
  data: ProjectsDataSnapshot,
  selection: ProjectsSelection,
): ProjectsWorkbenchViewModel {
  const selectedSummary =
    selection.projectId === null
      ? undefined
      : data.projects.find((project) => project.projectId === selection.projectId);
  const selectedDetail =
    selection.projectId === null ? undefined : data.details.get(selection.projectId);
  return {
    selection,
    projects: projectProjects(data),
    overview: projectOverview(selectedSummary, selectedDetail),
    composition: projectComposition(selectedDetail),
    pullRequests: projectPullRequests(selectedDetail, selection),
  };
}
