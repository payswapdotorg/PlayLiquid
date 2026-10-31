/**
 * COMPOSITION PANEL (presentational): the OPEN project's package
 * composition — one row per pinned package coordinate with its semantic
 * version, its content digest and its release-gate verdict
 * (package-system's R19 fail-closed provenance/licensing gate). Blocked
 * pins render their failure summaries verbatim; the counts state the
 * fail-closed rule. Absence is honest (E11).
 */

import type { ReactNode } from "react";
import type { CompositionView } from "../view/composition-view.ts";
import { compositionSummary } from "../view/composition-view.ts";
import { PROJECTS_EMPTY_STATE_COPY } from "../view/onboarding.ts";
import { gateStatusStatus } from "../view/status.ts";
import { DataTable, Mono, Panel } from "./primitives.tsx";
import { EmptySurface } from "./empty-surface.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

export interface CompositionPanelProps {
  /** The Composition view of the open project (from the store projection). */
  readonly view: CompositionView;
  /** The REAL next step of the no-pins state: one data-port pull. */
  readonly onRefresh?: () => void;
}

/** The Composition surface. */
export function CompositionPanel({ view, onRefresh }: CompositionPanelProps): ReactNode {
  if (view.totalPins === 0) {
    return (
      <Panel title="Composition" summary={compositionSummary(view)}>
        <EmptySurface copy={PROJECTS_EMPTY_STATE_COPY.composition} onNextStep={onRefresh} />
      </Panel>
    );
  }
  return (
    <Panel title="Composition" summary={compositionSummary(view)}>
      <DataTable
        columns={[
          {
            key: "package",
            header: "Package",
            render: (row) => (
              <span style={STYLE.chipRow}>
                <span style={{ fontWeight: 600 }}>{row.packageId}</span>
                <span style={{ ...STYLE.faint, fontSize: 11 }}>{row.kind}</span>
              </span>
            ),
          },
          { key: "version", header: "Version", render: (row) => <Mono>{row.versionText}</Mono> },
          { key: "digest", header: "Content digest", render: (row) => <Mono>{row.digest}</Mono> },
          {
            key: "gate",
            header: "Release gate",
            render: (row) => <StatusChip status={gateStatusStatus(row.releaseGate)} />,
          },
          {
            key: "failure",
            header: "Gate failure",
            render: (row) =>
              row.failureSummary === null ? (
                <span style={STYLE.faint}>—</span>
              ) : (
                <span style={STYLE.muted}>{row.failureSummary}</span>
              ),
          },
        ]}
        rows={view.rows}
        rowKey={(row) => `${row.packageId}@${row.versionText}`}
        empty="no package pins"
      />
      <p style={{ ...STYLE.faint, margin: 0, fontSize: 11.5 }}>
        Pins are exact package coordinates (kind, id, semver, content digest); publication gates
        fail closed on provenance and licensing (R19).
      </p>
    </Panel>
  );
}
