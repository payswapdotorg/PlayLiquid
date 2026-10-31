/**
 * PROJECTS WORKBENCH SHELL (presentational): the whole World Projects
 * workbench surface — header (title, deterministic summary,
 * load-failure banner, selection-refusal banner, refresh control), the
 * workbench layout (the projects list + the detail tabs Overview /
 * Composition / Pull Requests with count pills), the append-only command
 * log (every dispatched intent AND its typed outcome — E8/E10) and the
 * source-attribution footer.
 *
 * Presentational component: renders `ProjectsWorkbenchViewModel` only.
 * Every control is real and wired through explicit callbacks (no dead
 * controls). No data fetching here — the app layer (app/projects-app.tsx)
 * owns the store.
 */

import type { ReactNode } from "react";
import type { ProjectsCommandIntent, ProjectsCommandLogEntry } from "../ports.ts";
import type {
  ProjectsTab,
  ProjectsViewer,
  ProjectsWorkbenchViewModel,
} from "../view/projects-view.ts";
import { projectsSummary } from "../view/projects-view.ts";
import type { ProjectsSelectionRefusal } from "../view/projects-selection.ts";
import { commandLogNextHint, refreshFailureNextStep } from "../view/onboarding.ts";
import { commandReceiptStatus, refusalStatus } from "../view/status.ts";
import { CompositionPanel } from "./composition-panel.tsx";
import { ProjectListPanel } from "./project-list-panel.tsx";
import { ProjectOverviewPanel } from "./project-overview-panel.tsx";
import { SemanticPullRequestsPanel } from "./semantic-pr-panel.tsx";
import { Banner, Panel } from "./primitives.tsx";
import { CountPill, StatusChip } from "./status-chip.tsx";
import { FONT, STYLE, SURFACE } from "./tokens.ts";

/** Tab ids in navigation order. */
const TABS: readonly { readonly id: ProjectsTab; readonly label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "composition", label: "Composition" },
  { id: "pull-requests", label: "Pull Requests" },
];

export interface ProjectsShellProps {
  /** The view model to render (from the store projection). */
  readonly view: ProjectsWorkbenchViewModel;
  /** The viewer tenancy (rendered in the header; scoped read model, R20). */
  readonly viewer: ProjectsViewer;
  /** Last load failure recorded verbatim, or null (E11 banner). */
  readonly loadError: string | null;
  /** Last cross-tenant selection refusal, or null (R20/E8 banner). */
  readonly selectionRefusal: ProjectsSelectionRefusal | null;
  /** The append-only command log (E10). */
  readonly commandLog: readonly ProjectsCommandLogEntry[];
  /** Select a detail tab (required: tabs are real controls). */
  readonly onSelectTab: (tab: ProjectsTab) => void;
  /** Open one project into the detail tabs. */
  readonly onSelectProject: (projectId: string) => void;
  /** Pick one pull request into the review detail. */
  readonly onSelectPullRequest: (prId: string) => void;
  /** Dispatch one typed command intent (the host command port). */
  readonly onDispatchCommand: (intent: ProjectsCommandIntent) => void;
  /** Pull one authoritative snapshot through the port (rendered when wired). */
  readonly onRefresh?: () => void;
}

/** Count pill source per tab. */
function pillCount(view: ProjectsWorkbenchViewModel, tab: ProjectsTab): number {
  switch (tab) {
    case "overview":
      return view.overview.branches.length;
    case "composition":
      return view.composition.totalPins;
    case "pull-requests":
      return view.pullRequests.openCount;
  }
}

/** The active detail surface for one tab. */
function DetailSurface({
  view,
  tab,
  onDispatchCommand,
  onSelectPullRequest,
  onRefresh,
}: {
  readonly view: ProjectsWorkbenchViewModel;
  readonly tab: ProjectsTab;
  readonly onDispatchCommand: (intent: ProjectsCommandIntent) => void;
  readonly onSelectPullRequest: (prId: string) => void;
  readonly onRefresh?: () => void;
}): ReactNode {
  switch (tab) {
    case "overview":
      return <ProjectOverviewPanel view={view.overview} onRefresh={onRefresh} />;
    case "composition":
      return <CompositionPanel view={view.composition} onRefresh={onRefresh} />;
    case "pull-requests":
      return (
        <SemanticPullRequestsPanel
          view={view.pullRequests}
          onDispatchCommand={onDispatchCommand}
          onSelectPullRequest={onSelectPullRequest}
          onRefresh={onRefresh}
        />
      );
  }
}

/** One command-log row (typed outcome chips; E8/E10). */
function CommandLogRow({ entry }: { readonly entry: ProjectsCommandLogEntry }): ReactNode {
  return (
    <tr>
      <td style={STYLE.td}>
        <span style={STYLE.mono}>{entry.intent.kind}</span>
      </td>
      <td style={STYLE.td}>
        <span style={STYLE.mono}>
          {entry.intent.command} · {entry.intent.prId.slice(0, "sha256:".length + 8)}…
        </span>
      </td>
      <td style={STYLE.td}>
        <StatusChip status={commandReceiptStatus(entry.receipt.ok)} />
      </td>
      <td style={STYLE.td}>
        <span style={STYLE.mono}>
          {entry.receipt.ok ? `${entry.receipt.command} @ ${entry.receipt.at}` : entry.receipt.code}
        </span>
      </td>
    </tr>
  );
}

/** The World Projects workbench shell. */
export function ProjectsShell({
  view,
  viewer,
  loadError,
  selectionRefusal,
  commandLog,
  onSelectTab,
  onSelectProject,
  onSelectPullRequest,
  onDispatchCommand,
  onRefresh,
}: ProjectsShellProps): ReactNode {
  return (
    <div style={{ minHeight: "100vh", background: SURFACE.page, color: SURFACE.text, fontFamily: FONT.sans }}>
      <header style={{ padding: "18px 22px 12px", borderBottom: `1px solid ${SURFACE.border}` }}>
        <h1 style={{ margin: 0, fontSize: 17, letterSpacing: "0.01em" }}>PlayLiquid · World Projects</h1>
        <p style={{ ...STYLE.muted, margin: "6px 0 10px", fontSize: 12.5 }}>
          {projectsSummary(view.projects)} · viewer {viewer.displayName} (
          {String(viewer.tenantId)})
        </p>
        {loadError === null ? null : (
          <>
            <Banner tone="error">Projects read-model load failed (E11): {loadError}</Banner>
            <p style={{ ...STYLE.muted, margin: "6px 0 0", fontSize: 12.5 }}>
              {refreshFailureNextStep(loadError)}
            </p>
          </>
        )}
        {selectionRefusal === null ? null : (
          <Banner tone="error">
            <StatusChip status={refusalStatus(selectionRefusal.code)} /> {selectionRefusal.detail}
          </Banner>
        )}
        {onRefresh === undefined ? null : (
          <button
            type="button"
            style={{ ...STYLE.selectButton, fontSize: 12.5 }}
            onClick={() => {
              onRefresh();
            }}
          >
            Refresh read models
          </button>
        )}
      </header>
      <main style={{ display: "grid", gap: 14, padding: "14px 22px 22px" }}>
        <div style={STYLE.workbenchRow}>
          <div style={STYLE.listColumn}>
            <ProjectListPanel view={view.projects} onSelectProject={onSelectProject} onRefresh={onRefresh} />
          </div>
          <div style={STYLE.detailColumn}>
            <nav
              aria-label="Project detail surfaces"
              style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(tab.id);
                  }}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontFamily: FONT.sans,
                    color: view.selection.tab === tab.id ? "#2dd4bf" : SURFACE.muted,
                    background:
                      view.selection.tab === tab.id ? "rgba(45, 212, 191, 0.08)" : "transparent",
                    border: `1px solid ${view.selection.tab === tab.id ? "rgba(45, 212, 191, 0.35)" : SURFACE.border}`,
                  }}
                >
                  {tab.label}
                  <CountPill count={pillCount(view, tab.id)} />
                </button>
              ))}
            </nav>
            <DetailSurface
              view={view}
              tab={view.selection.tab}
              onDispatchCommand={onDispatchCommand}
              onSelectPullRequest={onSelectPullRequest}
              onRefresh={onRefresh}
            />
          </div>
        </div>
        <Panel
          title="Command log (append-only)"
          summary={`${commandLog.length} dispatched intent${commandLog.length === 1 ? "" : "s"} · typed outcomes, never silent (E8)`}
        >
          {commandLog.length === 0 ? (
            <p style={{ ...STYLE.muted, margin: 0, fontSize: 12.5, fontStyle: "italic" }}>
              no command intents dispatched yet
            </p>
          ) : (
            <>
              <table style={STYLE.table}>
                <thead>
                  <tr>
                    <th key="kind" scope="col" style={STYLE.th}>Intent</th>
                    <th key="detail" scope="col" style={STYLE.th}>Detail</th>
                    <th key="outcome" scope="col" style={STYLE.th}>Outcome</th>
                    <th key="code" scope="col" style={STYLE.th}>Code</th>
                  </tr>
                </thead>
                <tbody>
                  {commandLog.map((entry, index) => (
                    <CommandLogRow key={String(index)} entry={entry} />
                  ))}
                </tbody>
              </table>
              <p style={{ ...STYLE.muted, margin: 0, fontSize: 12 }}>
                {commandLogNextHint(commandLog)}
              </p>
            </>
          )}
        </Panel>
      </main>
      <footer style={{ padding: "12px 22px", borderTop: `1px solid ${SURFACE.border}`, ...STYLE.faint, fontSize: 11.5 }}>
        Read-only projection of authoritative systems · world kinds ACR-001 · composition gates fail
        closed (R19) · review commands are typed intents through ports · lifecycle terminal (E10)
      </footer>
    </div>
  );
}
