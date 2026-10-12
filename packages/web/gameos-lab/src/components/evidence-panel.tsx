/**
 * EVIDENCE PANEL (presentational): the append-only evaluation evidence
 * ledger — one row per immutable StoredCandidateEvidence record. The
 * immutability rule renders as an explicit E10 note; every row's
 * epistemic chip is FIXED to the labeled-estimate class with the run's
 * own estimate method (E11 — evaluation output is never rendered as
 * observed fact).
 */

import type { ReactNode } from "react";
import type { EvidenceView } from "../view/evidence-view.ts";
import { evidenceSummary } from "../view/evidence-view.ts";
import { estimateMethodStatus } from "../view/status.ts";
import { Banner, DataTable, Panel } from "./primitives.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

/** The Evidence surface. */
export function EvidencePanel({ view }: { readonly view: EvidenceView }): ReactNode {
  return (
    <Panel title="Evaluation evidence ledger" summary={evidenceSummary(view)}>
      <Banner tone="info">
        Append-only history (E10): recorded evidence is immutable; re-evaluation of a content key
        replays the recorded outcome. Every result below is a labeled estimate (E11) — never an
        observation.
      </Banner>
      <DataTable
        columns={[
          { key: "contentKey", header: "Content key", render: (row) => <span style={STYLE.mono}>{row.contentKey}</span> },
          { key: "evaluationId", header: "Evaluation", render: (row) => <span style={STYLE.mono}>{row.evaluationId}</span> },
          { key: "cycle", header: "Cycle", render: (row) => <span style={STYLE.mono}>{row.cycleId}</span> },
          { key: "epistemic", header: "Epistemic", render: (row) => <StatusChip status={estimateMethodStatus(row.method)} /> },
          { key: "work", header: "Completed work", render: (row) => <span style={STYLE.mono}>{row.completedWork}</span> },
          { key: "defects", header: "Defects", render: (row) => <span style={STYLE.mono}>{row.defects}</span> },
          { key: "coverage", header: "Capability coverage", render: (row) => <span style={STYLE.mono}>{row.capabilityCoverage.toFixed(2)}</span> },
          { key: "seed", header: "Seed (E9)", render: (row) => <span style={STYLE.mono}>{row.seed}</span> },
          { key: "ticks", header: "Tick budget", render: (row) => <span style={STYLE.mono}>{row.tickBudget}</span> },
          { key: "replay", header: "Replay", render: (row) => <span style={STYLE.mono}>{row.replayId}</span> },
          { key: "recordedAt", header: "Recorded at", render: (row) => <span style={STYLE.mono}>{row.recordedAt}</span> },
        ]}
        rows={view.rows}
        rowKey={(row) => row.contentKey}
        empty="no evaluation evidence recorded"
      />
    </Panel>
  );
}
