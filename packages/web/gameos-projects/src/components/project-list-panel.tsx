/**
 * PROJECT LIST PANEL (presentational): one row per world project with its
 * resolved world-kind badge (ACR-001 read model — a project with no
 * world declaration renders `game`, the pre-ACR default), its default
 * branch and counts, its last activity and its tenant scope. Opening a
 * project is the only control; foreign-tenant rows render visibly with
 * the foreign marker and cannot be opened (the store's typed
 * cross-tenant refusal, R20).
 */

import type { ReactNode } from "react";
import type { ProjectsView } from "../view/projects-view.ts";
import { projectsSummary } from "../view/projects-view.ts";
import { PROJECTS_EMPTY_STATE_COPY } from "../view/onboarding.ts";
import { worldKindStatus } from "../view/status.ts";
import { DataTable, Mono, Panel } from "./primitives.tsx";
import { EmptySurface } from "./empty-surface.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

export interface ProjectListPanelProps {
  /** The projects list view (from the store projection). */
  readonly view: ProjectsView;
  /** Open one project into the detail tabs. */
  readonly onSelectProject: (projectId: string) => void;
  /** The REAL next step of the no-projects state: one data-port pull. */
  readonly onRefresh?: () => void;
}

/** The projects list surface. */
export function ProjectListPanel({
  view,
  onSelectProject,
  onRefresh,
}: ProjectListPanelProps): ReactNode {
  if (view.totalProjects === 0) {
    return (
      <Panel title="Projects" summary={projectsSummary(view)}>
        <EmptySurface copy={PROJECTS_EMPTY_STATE_COPY.projects} onNextStep={onRefresh} />
      </Panel>
    );
  }
  return (
    <Panel title="Projects" summary={projectsSummary(view)}>
      <DataTable
        columns={[
          {
            key: "name",
            header: "Project",
            render: (row) => (
              <span style={STYLE.chipRow}>
                <span style={{ fontWeight: 600 }}>{row.name}</span>
                <Mono>{row.projectId}</Mono>
              </span>
            ),
          },
          {
            key: "worldKind",
            header: "World kind",
            render: (row) => (
              <span
                title={
                  row.worldKindDefaulted
                    ? "no world declaration — defaults to game (ACR-001 pre-ACR rule)"
                    : undefined
                }
                style={STYLE.chipRow}
              >
                <StatusChip status={worldKindStatus(row.worldKind)} />
                {row.worldKindDefaulted ? (
                  <span style={{ ...STYLE.faint, fontSize: 11 }}>defaulted</span>
                ) : null}
              </span>
            ),
          },
          { key: "branch", header: "Default branch", render: (row) => <Mono>{row.defaultBranch}</Mono> },
          { key: "branches", header: "Branches", render: (row) => <Mono>{row.branchCount}</Mono> },
          {
            key: "prs",
            header: "Open PRs",
            render: (row) => <Mono>{row.openPullRequestCount}</Mono>,
          },
          { key: "packages", header: "Packages", render: (row) => <Mono>{row.packageCount}</Mono> },
          { key: "tasks", header: "Open tasks", render: (row) => <Mono>{row.openTaskCount}</Mono> },
          { key: "activity", header: "Last activity", render: (row) => <Mono>{row.lastActivityAt}</Mono> },
          {
            key: "tenant",
            header: "Tenant scope",
            render: (row) =>
              row.foreignTenant ? (
                <StatusChip status={{ label: "foreign (R20)", tone: "warn" }} />
              ) : (
                <span style={STYLE.faint}>viewer</span>
              ),
          },
          {
            key: "open",
            header: "Detail",
            render: (row) => (
              <button
                type="button"
                style={STYLE.selectButton}
                onClick={() => {
                  onSelectProject(row.projectId);
                }}
              >
                open project
              </button>
            ),
          },
        ]}
        rows={view.rows}
        rowKey={(row) => row.projectId}
        empty="no projects recorded"
      />
      <p style={{ ...STYLE.muted, margin: "12px 0 0", fontSize: 12 }}>
        World kinds resolve through the ACR-001 read model; {view.foreignCount} foreign-tenant
        project{view.foreignCount === 1 ? "" : "s"} flagged for the R20 guard (openable rows are
        viewer-tenant only).
      </p>
    </Panel>
  );
}
