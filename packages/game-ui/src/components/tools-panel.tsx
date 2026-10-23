/**
 * TOOLS PANEL (presentational): renders the tool fabric read model
 * (view/tools-view.ts) — the adapter registration table (tool identity,
 * surface, adapter lifecycle chip, dispatch capability, offered
 * capabilities), the queued job model rows (status chip, attempts budget,
 * sequence) and the job-event timeline (PL-019; E6 jobs are durable and
 * only READ here — this surface has no dispatch control, the fabric
 * runtime owns admission).
 *
 * Presentational component: renders `ToolsView` only; job selection flows
 * out through the optional `onSelectJob` callback; no data fetching.
 */

import type { ReactNode } from "react";
import type { ToolsView } from "../view/tools-view.ts";
import { toolsSummary } from "../view/tools-view.ts";
import { STUDIO_EMPTY_STATE_COPY } from "../view/onboarding.ts";
import { StatusChip } from "./status-chip.tsx";
import { DataTable, Mono, Panel } from "./primitives.tsx";
import { EmptySurface } from "./empty-surface.tsx";
import { STYLE } from "./tokens.ts";

export interface ToolsPanelProps {
  readonly view: ToolsView;
  /** The currently selected job id (highlighted row), if any. */
  readonly selectedJobId?: string | null;
  /** Called when the user picks a job (selection belongs to the app). */
  readonly onSelectJob?: (jobId: string) => void;
  /** The REAL next step of the first-run empty state: one port pull. */
  readonly onRefresh?: () => void;
}

/** One job row; selection (when wired) renders the id as a real button. */
function JobIdCell({
  jobId,
  selected,
  onSelect,
}: {
  readonly jobId: string;
  readonly selected: boolean;
  readonly onSelect?: (jobId: string) => void;
}): ReactNode {
  if (onSelect === undefined) {
    return <span style={selected ? { ...STYLE.mono, fontWeight: 700 } : undefined}>{jobId}</span>;
  }
  return (
    <button
      type="button"
      style={selected ? { ...STYLE.selectButton, fontWeight: 700 } : STYLE.selectButton}
      onClick={() => onSelect(jobId)}
    >
      {jobId}
    </button>
  );
}

/** The Tools surface: registrations, queued job models, job events. */
export function ToolsPanel({ view, selectedJobId, onSelectJob, onRefresh }: ToolsPanelProps): ReactNode {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Panel title="Tool registrations" summary={toolsSummary(view)}>
        {view.registrations.length === 0 ? (
          <EmptySurface copy={STUDIO_EMPTY_STATE_COPY.tools} onNextStep={onRefresh} />
        ) : (
          <DataTable
            columns={[
              { key: "toolId", header: "tool", render: (row) => <Mono>{row.toolId}</Mono> },
              { key: "title", header: "title", render: (row) => row.title },
              { key: "surface", header: "surface", render: (row) => <Mono>{row.surface}</Mono> },
              {
                key: "adapter",
                header: "adapter",
                render: (row) => (
                  <span style={STYLE.chipRow}>
                    <Mono>{row.adapterLabel}</Mono>
                    <span style={{ ...STYLE.mono, fontSize: 11, color: STYLE.faint.color }}>
                      #{row.adapterId}
                    </span>
                  </span>
                ),
              },
              { key: "adapterState", header: "state", render: (row) => <StatusChip status={row.adapterState} /> },
              {
                key: "dispatchCapability",
                header: "dispatch",
                render: (row) => <Mono>{row.dispatchCapability}</Mono>,
              },
              {
                key: "capabilities",
                header: "offers",
                render: (row) =>
                  row.capabilities.length === 0 ? (
                    <span style={STYLE.muted}>—</span>
                  ) : (
                    <span style={{ ...STYLE.mono, fontSize: 12 }}>{row.capabilities.join(", ")}</span>
                  ),
              },
            ]}
            rows={view.registrations}
            rowKey={(row) => row.toolId}
            empty="no tools registered"
          />
        )}
      </Panel>
      <Panel
        title="Tool jobs"
        summary={`${view.jobs.length} job model${view.jobs.length === 1 ? "" : "s"} · ${view.activeCount} active (durable, E6)`}
      >
        <DataTable
          columns={[
            {
              key: "jobId",
              header: "job",
              render: (row) => (
                <JobIdCell jobId={row.jobId} selected={row.jobId === selectedJobId} onSelect={onSelectJob} />
              ),
            },
            { key: "callId", header: "call", render: (row) => <Mono>{row.callId}</Mono> },
            { key: "toolId", header: "tool", render: (row) => <Mono>{row.toolId}</Mono> },
            { key: "status", header: "status", render: (row) => <StatusChip status={row.status} /> },
            {
              key: "attempts",
              header: "attempts",
              render: (row) => (
                <Mono>
                  {String(row.attempts)}/{String(row.maxAttempts)}
                </Mono>
              ),
            },
            { key: "sequence", header: "sequence", render: (row) => <Mono>{String(row.sequence)}</Mono> },
          ]}
          rows={view.jobs}
          rowKey={(row) => row.jobId}
          empty="no tool jobs recorded"
        />
      </Panel>
      <Panel
        title="Job events"
        summary={`${view.events.length} emitted event${view.events.length === 1 ? "" : "s"} (newest first)`}
      >
        <DataTable
          columns={[
            { key: "sequence", header: "seq", render: (row) => <Mono>#{String(row.sequence)}</Mono> },
            { key: "type", header: "type", render: (row) => <Mono>{row.type}</Mono> },
            { key: "jobId", header: "job", render: (row) => <Mono>{row.jobId}</Mono> },
          ]}
          rows={view.events}
          rowKey={(row) => `${row.jobId}-${String(row.sequence)}`}
          empty="no job events emitted"
        />
      </Panel>
    </div>
  );
}
