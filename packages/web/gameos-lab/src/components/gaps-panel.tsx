/**
 * GAPS PANEL (presentational): the rung-classified recurring
 * capability-gap summaries (R18) over the frozen gap ladder (rendered
 * from lab-contracts' own GAP_LADDER_RUNGS — never re-declared). The
 * "Advance rung" control dispatches a TYPED command intent; the
 * authoritative gap door owns admission (rung-skip and Arena-first-resort
 * refusals surface verbatim, E8).
 */

import type { ReactNode } from "react";
import type { LabCommandIntent } from "../ports.ts";
import type { LabViewer } from "../view/lab-view.ts";
import type { GapsView } from "../view/gaps-view.ts";
import { gapsSummary } from "../view/gaps-view.ts";
import { gapRungStatus, gapSummaryStatus } from "../view/status.ts";
import { Banner, DataTable, Panel } from "./primitives.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

export interface GapsPanelProps {
  readonly view: GapsView;
  /** Dispatch one typed command intent (the host command port). */
  readonly onDispatchCommand: (intent: LabCommandIntent) => void;
  /** The viewer tenancy the advance intent is scoped to. */
  readonly viewer: LabViewer;
  /** The currently selected gap (missingCapability), if any. */
  readonly selectedCapability: string | null;
}

/** The Gaps surface. */
export function GapsPanel({
  view,
  onDispatchCommand,
  viewer,
  selectedCapability,
}: GapsPanelProps): ReactNode {
  return (
    <Panel title="Capability gaps (ladder)" summary={gapsSummary(view)}>
      <Banner tone="info">
        Resolution ladder (frozen, R18): {view.ladder.join(" → ")}. Rungs advance one step at a time;
        Arena is a last-but-one external resort and `blocked` is terminal.
      </Banner>
      <DataTable
        columns={[
          { key: "capability", header: "Missing capability", render: (row) => row.missingCapability },
          {
            key: "rung",
            header: "Current rung",
            render: (row) => <StatusChip status={gapRungStatus(row.currentRung)} />,
          },
          { key: "index", header: "Rung #", render: (row) => <span style={STYLE.mono}>{row.rungIndex + 1}/{view.ladder.length}</span> },
          { key: "reached", header: "Reached rungs", render: (row) => <span style={STYLE.mono}>{row.reached}</span> },
          { key: "attempts", header: "Attempts", render: (row) => <span style={STYLE.mono}>{row.attemptTrail}</span> },
          { key: "recurrence", header: "Recurrence", render: (row) => <span style={STYLE.mono}>{row.recurrenceCount} cycle{row.recurrenceCount === 1 ? "" : "s"}</span> },
          {
            key: "state",
            header: "State",
            render: (row) => <StatusChip status={gapSummaryStatus(row.recurring, row.resolved, row.blocked)} />,
          },
          {
            key: "advance",
            header: "Advance rung",
            render: (row) => (
              <button
                type="button"
                style={STYLE.selectButton}
                disabled={row.resolved || row.blocked}
                onClick={() => {
                  onDispatchCommand({
                    kind: "advance-gap-rung",
                    tenant: viewer.tenant,
                    subject: viewer.subject,
                    gapId: row.gapIds[0] ?? "",
                    rung: view.ladder[Math.min(row.rungIndex + 1, view.ladder.length - 1)] ?? "blocked",
                    disposition: "unavailable",
                    outcome: "unresolved",
                  });
                }}
              >
                advance to {view.ladder[Math.min(row.rungIndex + 1, view.ladder.length - 1)] ?? "blocked"}
              </button>
            ),
          },
        ]}
        rows={view.rows}
        rowKey={(row) => row.missingCapability}
        empty="no capability gaps recorded"
      />
      {selectedCapability === null ? null : (
        <p style={{ ...STYLE.muted, margin: 0, fontSize: 12 }}>
          selected gap: <span style={STYLE.mono}>{selectedCapability}</span>
        </p>
      )}
    </Panel>
  );
}
