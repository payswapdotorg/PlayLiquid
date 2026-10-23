/**
 * WORKFLOW PANEL (presentational): the append-only transition ledger
 * (E10) — every recorded workflow transition with its authority (actor),
 * its reason and its content-addressed record id, plus the walked trail
 * of the selected contribution. The "Triage" / "Review" controls dispatch
 * TYPED command intents for the selected contribution; the authoritative
 * community service owns admission (maintainer rights, cross-tenant
 * actor guards and the accept-time qualification gate surface as typed
 * refusals, E8).
 */

import type { ReactNode } from "react";
import type { CommunityCommandIntent } from "../ports.ts";
import type { CommunityViewer } from "../view/community-view.ts";
import type { WorkflowView } from "../view/workflow-view.ts";
import { workflowSummary } from "../view/workflow-view.ts";
import { COMMUNITY_EMPTY_STATE_COPY } from "../view/onboarding.ts";
import { transitionStatus } from "../view/status.ts";
import { Banner, DataTable, Mono, Panel } from "./primitives.tsx";
import { EmptySurface } from "./empty-surface.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

export interface WorkflowPanelProps {
  readonly view: WorkflowView;
  /** The viewer tenancy the advance intents are scoped to. */
  readonly viewer: CommunityViewer;
  /** Dispatch one typed command intent (the host command port). */
  readonly onDispatchCommand: (intent: CommunityCommandIntent) => void;
  /** The REAL next step of the first-run empty state: one port pull. */
  readonly onRefresh?: () => void;
}

/** The Lifecycle surface. */
export function WorkflowPanel({
  view,
  viewer,
  onDispatchCommand,
  onRefresh,
}: WorkflowPanelProps): ReactNode {
  return (
    <Panel title="Lifecycle (append-only)" summary={workflowSummary(view)}>
      <Banner tone="info">
        Every workflow transition is content-addressed and authority-stamped; the ledger is
        append-only (E10) — recorded transitions are never rewritten, reordered or dropped.
        Verdicts (accept/reject) and withdraw are terminal.
      </Banner>
      {view.rows.length === 0 ? (
        <EmptySurface copy={COMMUNITY_EMPTY_STATE_COPY.lifecycle} onNextStep={onRefresh} />
      ) : (
        <DataTable
          columns={[
            { key: "record", header: "Transition", render: (row) => <Mono>{row.recordId}</Mono> },
            { key: "contribution", header: "Contribution", render: (row) => <Mono>{row.contributionId}</Mono> },
            { key: "from", header: "From", render: (row) => <Mono>{row.from ?? "—"}</Mono> },
            {
              key: "to",
              header: "To",
              render: (row) => <StatusChip status={transitionStatus(row.to)} />,
            },
            { key: "actor", header: "Actor", render: (row) => <Mono>{row.actor}</Mono> },
            {
              key: "reason",
              header: "Reason",
              render: (row) =>
                row.reason === null ? (
                  <span style={STYLE.faint}>—</span>
                ) : (
                  <span style={STYLE.muted}>{row.reason}</span>
                ),
            },
            {
              key: "tenant",
              header: "Tenant scope",
              render: (row) => (
                <span style={STYLE.mono}>{row.foreignTenant ? "foreign (R20)" : "viewer"}</span>
              ),
            },
          ]}
          rows={view.rows}
          rowKey={(row) => row.recordId}
          empty="no workflow transitions recorded"
        />
      )}
      {view.selectedTrail === null ? (
        <p style={{ ...STYLE.muted, margin: "12px 0 0", fontSize: 12.5, fontStyle: "italic" }}>
          select a contribution to see its walked trail and dispatch workflow intents
        </p>
      ) : (
        <>
          <p style={{ ...STYLE.muted, margin: "12px 0 6px", fontSize: 12 }}>
            selected trail: <span style={STYLE.mono}>{view.selectedTrail}</span>
          </p>
          <div style={STYLE.chipRow}>
            <button
              type="button"
              style={STYLE.selectButton}
              onClick={() => {
                onDispatchCommand({
                  kind: "advance-contribution",
                  tenant: viewer.tenant,
                  actor: viewer.subject,
                  contributionId: view.selectedContributionId ?? "",
                  command: "triage",
                });
              }}
            >
              triage (maintainer intent)
            </button>
            <button
              type="button"
              style={STYLE.selectButton}
              onClick={() => {
                onDispatchCommand({
                  kind: "advance-contribution",
                  tenant: viewer.tenant,
                  actor: viewer.subject,
                  contributionId: view.selectedContributionId ?? "",
                  command: "review",
                });
              }}
            >
              review (maintainer intent)
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}
