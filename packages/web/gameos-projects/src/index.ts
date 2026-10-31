/**
 * @playliquid/gameos-projects PUBLIC ENTRYPOINT (PLX-UX-003 step 1).
 *
 * Everything the host needs to mount the World Projects workbench:
 * - ports (the two seams: read-model data + typed command intents);
 * - the one UI-state owner, its typed action set and the append-only
 *   command log;
 * - the pure read-model projections (the projects list, the project
 *   overview, the package composition, the semantic pull requests with
 *   the community-frozen review-action legality + the status
 *   vocabulary);
 * - the presentational component set (shell, panels, chips, primitives,
 *   style tokens) — zero data fetching;
 * - the app composition (ProjectsApp + the useSyncExternalStore
 *   binding);
 * - the labeled TEST-SUPPORT doubles and the demo fixture (lock rule 44:
 *   clearly marked, never presented as production integrations).
 *
 * Cross-module access goes through here or src/contract.ts only;
 * implementation details stay inside the module.
 */

// The two seams.
export type {
  ProjectsCommandIntent,
  ProjectsCommandLogEntry,
  ProjectsCommandPort,
  ProjectsCommandReceipt,
  ProjectsCommandReceiptOk,
  ProjectsCommandReceiptRefused,
  ProjectsDataPort,
  ProjectsIntentRefusalCode,
  ProjectsLoadResult,
  ProjectsTransitionRefusalCode,
} from "./ports.ts";
export { projectsIntentProblem } from "./ports.ts";

// The one UI-state owner + its vocabulary.
export type { ProjectsStore, ProjectsWorkbenchPorts, Unsubscribe } from "./projects-store.ts";
export { createProjectsStore } from "./projects-store.ts";
export type { ProjectsAction, ProjectsState } from "./projects-actions.ts";
export { initialProjectsState, projectState, reduce } from "./projects-actions.ts";

// Read-model projections (pure).
export type {
  BranchSummary,
  ChangeKindCount,
  CommitSummary,
  CompositionPin,
  ProjectsDataSnapshot,
  ProjectRowView,
  ProjectsView,
  ProjectsWorkbenchViewModel,
  SemanticPullRequestSummary,
  TaskSummary,
  WorldProjectDetail,
  WorldProjectSummary,
} from "./view/projects-view.ts";
export { projectProjects, projectWorkbench, projectsSummary } from "./view/projects-view.ts";
export { INITIAL_PROJECTS_SELECTION } from "./view/projects-selection.ts";
export type {
  ProjectsSelection,
  ProjectsSelectionRefusal,
  ProjectsTab,
  ProjectsViewer,
} from "./view/projects-selection.ts";
export type {
  BranchRowView,
  CommitRowView,
  OverviewView,
  TaskRowView,
} from "./view/project-overview-view.ts";
export { overviewSummary, projectOverview } from "./view/project-overview-view.ts";
export type {
  CompositionPinRowView,
  CompositionView,
} from "./view/composition-view.ts";
export { compositionSummary, projectComposition } from "./view/composition-view.ts";
export type {
  PullRequestDetailView,
  PullRequestRowView,
  PullRequestsView,
} from "./view/semantic-pr-view.ts";
export {
  changeKindSummaryLine,
  legalTransitionsFor,
  projectPullRequests,
  pullRequestsSummary,
} from "./view/semantic-pr-view.ts";
export type { UiStatus, UiTone } from "./view/status.ts";
export {
  commandReceiptStatus,
  gateStatusStatus,
  pullRequestStatusStatus,
  refusalStatus,
  taskStatusStatus,
  transitionCommandStatus,
  worldKindStatus,
} from "./view/status.ts";

// Onboarding copy + contextual next-step hints (pure; UX-002).
export type { EmptySurfaceCopy, ProjectsEmptySurfaceId } from "./view/onboarding.ts";
export {
  PROJECTS_EMPTY_STATE_COPY,
  commandLogNextHint,
  refreshFailureNextStep,
} from "./view/onboarding.ts";

// Presentational components (zero data fetching).
export { ProjectsShell } from "./components/projects-shell.tsx";
export type { ProjectsShellProps } from "./components/projects-shell.tsx";
export { ProjectListPanel } from "./components/project-list-panel.tsx";
export type { ProjectListPanelProps } from "./components/project-list-panel.tsx";
export { ProjectOverviewPanel } from "./components/project-overview-panel.tsx";
export type { ProjectOverviewPanelProps } from "./components/project-overview-panel.tsx";
export { CompositionPanel } from "./components/composition-panel.tsx";
export type { CompositionPanelProps } from "./components/composition-panel.tsx";
export { SemanticPullRequestsPanel } from "./components/semantic-pr-panel.tsx";
export type { SemanticPullRequestsPanelProps } from "./components/semantic-pr-panel.tsx";
export { EmptySurface } from "./components/empty-surface.tsx";
export type { EmptySurfaceProps } from "./components/empty-surface.tsx";
export { CountPill, StatusChip } from "./components/status-chip.tsx";
export type { StatusChipProps } from "./components/status-chip.tsx";
export { Banner, ChipList, DataTable, EmptyState, KeyValue, Mono, Panel } from "./components/primitives.tsx";
export type { DataTableColumn, DataTableProps } from "./components/primitives.tsx";
export { FONT, STYLE, SURFACE, TONE_STYLE } from "./components/tokens.ts";
export type { ToneStyle } from "./components/tokens.ts";

// The app composition.
export { ProjectsApp } from "./app/projects-app.tsx";
export type { ProjectsAppProps } from "./app/projects-app.tsx";
export { projectStateCached, useProjectsStore } from "./app/use-projects-store.ts";
export type { UseProjectsStore } from "./app/use-projects-store.ts";

// TEST-SUPPORT doubles (lock rule 44) + demo fixture.
export {
  ScriptedProjectsCommandPort,
  ScriptedProjectsDataPort,
  StaticProjectsDataPort,
} from "./fakes.ts";
export {
  DEMO_PROJECTS_FOREIGN_TENANT,
  DEMO_PROJECTS_TENANT,
  DEMO_PROJECTS_VIEWER,
  demoProjectsSnapshot,
} from "./fixtures/demo.ts";
