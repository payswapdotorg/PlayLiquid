/**
 * CONTRIBUTIONS PANEL (presentational): one row per community
 * contribution with its lifecycle status, provenance summary and E8 trust
 * state; the kind-filter row and the "Submit contribution" control
 * dispatch TYPED command intents; the authoritative community service
 * owns admission (its typed refusal codes surface verbatim, E8).
 *
 * Tenancy (R20): foreign-tenant rows render visibly and cannot be opened
 * into the detail view (the store's typed cross-tenant refusal).
 */

import type { ReactNode } from "react";
import type { CommunityCommandIntent } from "../ports.ts";
import type { CommunityViewer } from "../view/community-view.ts";
import type { ContributionsView } from "../view/contributions-view.ts";
import { contributionsSummary } from "../view/contributions-view.ts";
import {
  aiDisclosureStatus,
  contributionKindStatus,
  contributionStatusStatus,
  gapLinkStatus,
  originStatus,
  trustStatus,
} from "../view/status.ts";
import { Banner, DataTable, Mono, Panel } from "./primitives.tsx";
import { StatusChip } from "./status-chip.tsx";
import { FONT, STYLE, SURFACE } from "./tokens.ts";

export interface ContributionsPanelProps {
  readonly view: ContributionsView;
  /** The viewer tenancy the submit intent is scoped to. */
  readonly viewer: CommunityViewer;
  /** Dispatch one typed command intent (the host command port). */
  readonly onDispatchCommand: (intent: CommunityCommandIntent) => void;
  /** Apply (or clear) the contribution-kind filter. */
  readonly onSelectKind: (kind: string | null) => void;
  /** Open one contribution into the provenance detail view. */
  readonly onSelectContribution: (contributionId: string) => void;
}

/** The Contributions surface. */
export function ContributionsPanel({
  view,
  viewer,
  onDispatchCommand,
  onSelectKind,
  onSelectContribution,
}: ContributionsPanelProps): ReactNode {
  return (
    <Panel title="Contributions" summary={contributionsSummary(view)}>
      <Banner tone="info">
        Contribution artifacts preserve provenance and a normal Git lifecycle: submitted → triaged →
        under-review → accepted/rejected/withdrawn. Verdicts are terminal; corrected work is a NEW
        submission (E10). Third-party contributions are untrusted until qualified at accept (E8).
      </Banner>
      <div style={{ ...STYLE.chipRow, marginBottom: 10 }}>
        <span style={{ ...STYLE.faint, fontSize: 11.5 }}>kind filter:</span>
        <button
          type="button"
          style={{
            ...STYLE.filterButton,
            fontSize: 11.5,
            color: view.kindFilter === null ? "#2dd4bf" : SURFACE.muted,
            border: `1px solid ${view.kindFilter === null ? "rgba(45, 212, 191, 0.35)" : SURFACE.border}`,
          }}
          onClick={() => {
            onSelectKind(null);
          }}
        >
          all ({view.totalContributions})
        </button>
        {view.kindsPresent.map((kind) => (
          <button
            key={kind}
            type="button"
            style={{
              ...STYLE.filterButton,
              fontSize: 11.5,
              color: view.kindFilter === kind ? "#2dd4bf" : SURFACE.muted,
              border: `1px solid ${view.kindFilter === kind ? "rgba(45, 212, 191, 0.35)" : SURFACE.border}`,
            }}
            onClick={() => {
              onSelectKind(kind);
            }}
          >
            {kind}
          </button>
        ))}
      </div>
      <DataTable
        columns={[
          { key: "id", header: "Contribution", render: (row) => <Mono>{row.contributionId}</Mono> },
          {
            key: "kind",
            header: "Kind",
            render: (row) => <StatusChip status={contributionKindStatus(row.kind)} />,
          },
          {
            key: "status",
            header: "Lifecycle",
            render: (row) => <StatusChip status={contributionStatusStatus(row.status)} />,
          },
          {
            key: "trust",
            header: "Trust (E8)",
            render: (row) => <StatusChip status={trustStatus(row.trust)} />,
          },
          {
            key: "origin",
            header: "Origin",
            render: (row) => <StatusChip status={originStatus(row.originKind)} />,
          },
          {
            key: "ai",
            header: "AI disclosure",
            render: (row) => <StatusChip status={aiDisclosureStatus(row.aiGenerated)} />,
          },
          {
            key: "gap",
            header: "Gap link",
            render: (row) => (
              <StatusChip status={gapLinkStatus(row.gapId !== null)} />
            ),
          },
          { key: "contributor", header: "Contributor", render: (row) => <Mono>{row.contributor}</Mono> },
          {
            key: "open",
            header: "Detail",
            render: (row) => (
              <button
                type="button"
                style={STYLE.selectButton}
                onClick={() => {
                  onSelectContribution(row.contributionKey);
                }}
              >
                open provenance
              </button>
            ),
          },
        ]}
        rows={view.rows}
        rowKey={(row) => row.contributionKey}
        empty="no contributions recorded"
      />
      <p style={{ ...STYLE.muted, margin: "12px 0 0", fontSize: 12 }}>
        Short ids render (full content addresses on the provenance surface); {view.foreignCount}{" "}
        foreign-tenant row{view.foreignCount === 1 ? "" : "s"} flagged for the R20 guard.
      </p>
      <div style={{ ...STYLE.chipRow, marginTop: 8 }}>
        <button
          type="button"
          style={{ ...STYLE.selectButton, fontSize: 12.5 }}
          onClick={() => {
            onDispatchCommand({
              kind: "submit-contribution",
              tenant: viewer.tenant,
              subject: viewer.subject,
              contributionKind: "issue",
              label: "demo-issue-from-workbench",
              aiGenerated: false,
              lineageDerived: false,
              gapId: undefined,
            });
          }}
        >
          submit an issue (typed intent)
        </button>
        <span style={{ ...STYLE.faint, fontFamily: FONT.mono, fontSize: 11.5 }}>
          the host expands intents into full authoritative commands
        </span>
      </div>
    </Panel>
  );
}
