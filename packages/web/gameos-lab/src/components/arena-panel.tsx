/**
 * ARENA PANEL (presentational): the decided Arena escalation cases
 * (PL-031) — lifecycle state, decision provenance and the filed evidence
 * package. This surface is strictly read-only: escalation was DECIDED by
 * the host (R18 — never auto-escalated), and the UI never sends anything
 * to Arena (no transport exists here at all).
 */

import type { ReactNode } from "react";
import type { ArenaView } from "../view/arena-view.ts";
import { arenaSummary } from "../view/arena-view.ts";
import { arenaLifecycleStatus } from "../view/status.ts";
import { Banner, DataTable, Panel } from "./primitives.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

/** The Arena surface. */
export function ArenaPanel({ view }: { readonly view: ArenaView }): ReactNode {
  return (
    <Panel title="Arena escalation cases" summary={arenaSummary(view)}>
      <Banner tone="info">
        Decided escalations only (R18): a case exists because the host issued a verified decision;
        Arena is external and optional — evidence is ingested read-only (E10/E11).
      </Banner>
      <DataTable
        columns={[
          { key: "caseId", header: "Case", render: (row) => <span style={STYLE.mono}>{row.caseId}</span> },
          { key: "tenant", header: "Tenant", render: (row) => <span style={row.foreignTenant ? STYLE.faint : STYLE.muted}>{row.tenant}</span> },
          { key: "decidedBy", header: "Decided by", render: (row) => <span style={STYLE.mono}>{row.decidedBy}</span> },
          { key: "source", header: "Source", render: (row) => <span style={STYLE.mono}>{row.sourceKind}</span> },
          { key: "request", header: "Request kind", render: (row) => <span style={STYLE.mono}>{row.requestKind}</span> },
          { key: "lifecycle", header: "Lifecycle", render: (row) => <StatusChip status={arenaLifecycleStatus(row.lifecycleState)} /> },
          { key: "trail", header: "Trail (E10)", render: (row) => <span style={STYLE.mono}>{row.lifecycleTrail}</span> },
          { key: "verdict", header: "Evidence verdict", render: (row) => row.evidenceVerdict ?? "—" },
          { key: "counts", header: "R/E/A", render: (row) => <span style={STYLE.mono}>{row.resultCount}/{row.evidenceCount}/{row.artifactCount}</span> },
          { key: "openedAt", header: "Opened at", render: (row) => <span style={STYLE.mono}>{row.openedAt}</span> },
        ]}
        rows={view.rows}
        rowKey={(row) => row.caseId}
        empty="no Arena escalation cases"
      />
    </Panel>
  );
}
