/**
 * GUIDANCE PANEL (presentational) — THE E11 EPISTEMIC SURFACE: renders the
 * two guidance epistemic classes in STRUCTURALLY DISTINCT sections that
 * can never be visually conflated:
 *
 * - "Observed-evidence guidance" (green `observed evidence` chips): the
 *   section shows ONLY observed content — cycle/observation counts,
 *   baseline note, dimension adjustments. It has no estimate fields to
 *   render, by type.
 * - "Labeled-estimate guidance" (teal `estimate · <method>` chips): the
 *   section ADDITIONALLY renders the estimate method, the
 *   content-addressed basis and the per-dimension estimate support table,
 *   under an explicit "estimates are not ground truth" note (lock 29).
 *
 * A guidance value whose marker is neither authoritative literal renders
 * as a typed refusal banner (E8 — tampering is surfaced, never accepted).
 */

import type { ReactNode } from "react";
import type {
  EstimateGuidanceView,
  GuidanceSetView,
  ObservedGuidanceView,
} from "../view/guidance-view.ts";
import { guidanceSummary } from "../view/guidance-view.ts";
import { estimateMethodStatus, observedEvidenceStatus } from "../view/status.ts";
import { Banner, DataTable, EmptyState, KeyValue, Mono, Panel } from "./primitives.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

function ObservedGuidanceCard({ guidance }: { readonly guidance: ObservedGuidanceView }): ReactNode {
  return (
    <div style={STYLE.card}>
      <div style={STYLE.chipRow}>
        <StatusChip status={observedEvidenceStatus()} />
        <span style={STYLE.muted}>derived only from observed evidence</span>
      </div>
      <KeyValue
        entries={[
          { key: "Cycles", value: <Mono>{guidance.cycleCount}</Mono> },
          { key: "Observations", value: <Mono>{guidance.observationCount}</Mono> },
          { key: "Baseline", value: `${guidance.baselineDirection} — ${guidance.baselineNote}` },
          { key: "Seed hint (E9)", value: <Mono>{guidance.seedHint}</Mono> },
          { key: "Digest", value: <Mono>{guidance.digest}</Mono> },
        ]}
      />
      <DataTable
        columns={[
          { key: "dimension", header: "Dimension", render: (row) => row.dimension },
          { key: "preferred", header: "Preferred values", render: (row) => <Mono>{row.preferredValues}</Mono> },
          { key: "observations", header: "Observations", render: (row) => <Mono>{row.observationCount}</Mono> },
        ]}
        rows={guidance.adjustments}
        rowKey={(row) => row.dimension}
        empty="no dimension adjustments"
      />
    </div>
  );
}

function EstimateGuidanceCard({ guidance }: { readonly guidance: EstimateGuidanceView }): ReactNode {
  return (
    <div style={STYLE.card}>
      <div style={STYLE.chipRow}>
        <StatusChip status={estimateMethodStatus(guidance.method)} />
        <span style={STYLE.muted}>derived wholly or partly from labeled estimates</span>
      </div>
      <KeyValue
        entries={[
          { key: "Cycles", value: <Mono>{guidance.cycleCount}</Mono> },
          { key: "Observations", value: <Mono>{guidance.observationCount}</Mono> },
          { key: "Baseline", value: `${guidance.baselineDirection} — ${guidance.baselineNote}` },
          { key: "Estimate method", value: <Mono>{guidance.method}</Mono> },
          { key: "Estimate basis (digest)", value: <Mono>{guidance.basis}</Mono> },
          { key: "Seed hint (E9)", value: <Mono>{guidance.seedHint}</Mono> },
          { key: "Digest", value: <Mono>{guidance.digest}</Mono> },
        ]}
      />
      <DataTable
        columns={[
          { key: "dimension", header: "Dimension", render: (row) => row.dimension },
          { key: "value", header: "Value", render: (row) => <Mono>{row.value}</Mono> },
          { key: "evaluations", header: "Evaluations", render: (row) => <Mono>{row.evaluationCount}</Mono> },
          { key: "work", header: "Estimated completed work", render: (row) => <Mono>{row.estimatedCompletedWork}</Mono> },
        ]}
        rows={guidance.estimateSupport}
        rowKey={(row) => `${row.dimension}:${row.value}`}
        empty="no estimate support entries"
      />
      <p style={{ ...STYLE.faint, margin: 0, fontSize: 11.5 }}>
        Estimates are reviewable, not more true — simulator output is not ground truth (lock 29).
      </p>
    </div>
  );
}

/** The Guidance surface: the two epistemic classes, visually disjoint. */
export function GuidancePanel({ view }: { readonly view: GuidanceSetView }): ReactNode {
  return (
    <Panel title="Search guidance (next search)" summary={guidanceSummary(view)}>
      <Banner tone="info">
        Epistemic classes are structurally disjoint (E11): observed-evidence guidance and
        labeled-estimate guidance render in separate sections with distinct chips — never conflated.
      </Banner>
      <Panel title="Observed-evidence guidance" summary="green class — observed content only">
        {view.observed.length === 0 ? (
          <EmptyState label="no observed-evidence guidance derived" />
        ) : (
          view.observed.map((guidance) => <ObservedGuidanceCard key={guidance.digest} guidance={guidance} />)
        )}
      </Panel>
      <Panel title="Labeled-estimate guidance" summary="teal class — carries method, basis and estimate support">
        {view.estimates.length === 0 ? (
          <EmptyState label="no labeled-estimate guidance derived" />
        ) : (
          view.estimates.map((guidance) => <EstimateGuidanceCard key={guidance.digest} guidance={guidance} />)
        )}
      </Panel>
      {view.refusals.map((refusal) => (
        <Banner key={refusal.detail} tone="error">
          guidance refused ({refusal.code}): {refusal.detail}
        </Banner>
      ))}
    </Panel>
  );
}
