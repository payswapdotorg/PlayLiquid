/**
 * LEARNING PANEL (presentational): the Lab's learned cycles (sealed,
 * content-addressed records — R17) and the derived dimension-affinity
 * signals. The signals' content-addressed state digest renders so E9
 * determinism is observable; no signal is ever re-derived here.
 */

import type { ReactNode } from "react";
import type { LearningView } from "../view/learning-view.ts";
import { learningSummary } from "../view/learning-view.ts";
import { LAB_EMPTY_STATE_COPY } from "../view/onboarding.ts";
import { DataTable, KeyValue, Panel } from "./primitives.tsx";
import { EmptySurface } from "./empty-surface.tsx";
import { STYLE } from "./tokens.ts";

export interface LearningPanelProps {
  readonly view: LearningView;
  /** The REAL next step of the first-run empty state: one port pull. */
  readonly onRefresh?: () => void;
}

/** The Learning surface. */
export function LearningPanel({ view, onRefresh }: LearningPanelProps): ReactNode {
  return (
    <Panel title="Learning cycles & signals" summary={learningSummary(view)}>
      {view.rows.length === 0 ? (
        <EmptySurface copy={LAB_EMPTY_STATE_COPY.learning} onNextStep={onRefresh} />
      ) : (
        <DataTable
          columns={[
            { key: "recordId", header: "Record", render: (row) => <span style={STYLE.mono}>{row.recordId}</span> },
            { key: "cycle", header: "Cycle", render: (row) => <span style={STYLE.mono}>{row.cycleId}</span> },
            { key: "sequence", header: "Seq", render: (row) => <span style={STYLE.mono}>{row.sequence}</span> },
            { key: "outcomes", header: "Outcomes", render: (row) => <span style={STYLE.mono}>{row.outcomeCount}</span> },
            { key: "conclusions", header: "Conclusions", render: (row) => <span style={STYLE.mono}>{row.conclusionCount}</span> },
            { key: "evaluations", header: "Evaluations", render: (row) => <span style={STYLE.mono}>{row.evaluationCount}</span> },
            { key: "searches", header: "Search results", render: (row) => <span style={STYLE.mono}>{row.searchResultCount}</span> },
            { key: "gaps", header: "Gaps", render: (row) => <span style={STYLE.mono}>{row.gapCount}</span> },
            { key: "learnedAt", header: "Learned at", render: (row) => <span style={STYLE.mono}>{row.learnedAt}</span> },
          ]}
          rows={view.rows}
          rowKey={(row) => row.recordId}
          empty="no learning cycles recorded yet"
        />
      )}
      <Panel title="Dimension outcome affinities (signals)" summary="folded by lab-learning — read-only here">
        <DataTable
          columns={[
            { key: "dimension", header: "Dimension", render: (row) => row.dimension },
            { key: "value", header: "Value", render: (row) => <span style={STYLE.mono}>{row.value}</span> },
            { key: "co", header: "Co-occurrences", render: (row) => <span style={STYLE.mono}>{row.coOccurrences}</span> },
            { key: "cycles", header: "Cycles", render: (row) => <span style={STYLE.mono}>{row.cycleCount}</span> },
          ]}
          rows={view.signals}
          rowKey={(row) => `${row.dimension}:${row.value}`}
          empty="no signal affinities derived yet"
        />
        <KeyValue
          entries={[
            {
              key: "Signals state digest (E9)",
              value: <span style={STYLE.mono}>{view.stateDigest ?? "not yet derived"}</span>,
            },
          ]}
        />
      </Panel>
    </Panel>
  );
}
