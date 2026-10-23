/**
 * PROVENANCE PANEL (presentational): the full provenance chain of the
 * selected contribution — contributor-of-record, origin lineage (with the
 * cited package coordinate when lineage-derived), the content-addressed
 * id, the honest AI disclosure with every model-provenance entry, the R18
 * gap link and the E8 trust state. Absence is honest: no selection
 * renders the empty state, never fabricated data (E11).
 */

import type { ReactNode } from "react";
import type { ProvenanceView } from "../view/provenance-view.ts";
import { provenanceSummary } from "../view/provenance-view.ts";
import { COMMUNITY_EMPTY_STATE_COPY } from "../view/onboarding.ts";
import {
  aiDisclosureStatus,
  contributionKindStatus,
  contributionStatusStatus,
  gapLinkStatus,
  originStatus,
  trustStatus,
} from "../view/status.ts";
import { ChipList, KeyValue, Mono, Panel } from "./primitives.tsx";
import { EmptySurface } from "./empty-surface.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

export interface ProvenancePanelProps {
  readonly view: ProvenanceView;
  /** The REAL next step of the no-selection state: one port pull. */
  readonly onRefresh?: () => void;
}

/** The Provenance surface. */
export function ProvenancePanel({ view, onRefresh }: ProvenancePanelProps): ReactNode {
  if (view.detail === null) {
    return (
      <Panel title="Provenance" summary="no contribution selected">
        <EmptySurface copy={COMMUNITY_EMPTY_STATE_COPY.provenance} onNextStep={onRefresh} />
      </Panel>
    );
  }
  const detail = view.detail;
  return (
    <Panel title="Provenance" summary={provenanceSummary(view)}>
      <KeyValue
        entries={[
          { key: "Contribution id", value: <Mono>{detail.contributionId}</Mono> },
          { key: "Kind", value: <StatusChip status={contributionKindStatus(detail.kind)} /> },
          { key: "Lifecycle", value: <StatusChip status={contributionStatusStatus(detail.status)} /> },
          { key: "Trust (E8)", value: <StatusChip status={trustStatus(detail.trust)} /> },
          { key: "Tenant", value: <Mono>{detail.tenant}</Mono> },
          { key: "Contributor", value: <Mono>{detail.contributor}</Mono> },
          { key: "Origin", value: <StatusChip status={originStatus(detail.originKind)} /> },
          ...(detail.originKind === "lineage-derived"
            ? [
                { key: "Base package", value: <Mono>{detail.basePackageId}@{detail.baseVersion}</Mono> },
                { key: "Base content digest", value: <Mono>{detail.baseContentDigest}</Mono> },
                { key: "Base lineage node", value: <Mono>{detail.baseNodeId}</Mono> },
              ]
            : []),
          { key: "AI disclosure", value: <StatusChip status={aiDisclosureStatus(detail.aiGenerated)} /> },
          {
            key: "Gap link (R18)",
            value:
              detail.gapId === null ? (
                <StatusChip status={gapLinkStatus(false)} />
              ) : (
                <span style={STYLE.chipRow}>
                  <StatusChip status={gapLinkStatus(true)} />
                  <Mono>
                    {detail.gapId} · cycle {detail.cycleId}
                  </Mono>
                </span>
              ),
          },
          { key: "Submitted at", value: <Mono>{detail.submittedAt}</Mono> },
          { key: "Decided by", value: <Mono>{detail.decidedBy}</Mono> },
          ...(detail.foreignTenant
            ? [{ key: "Tenant scope", value: <StatusChip status={{ label: "foreign tenant (R20)", tone: "warn" }} /> }]
            : []),
        ]}
      />
      <ChipList
        label={`Model provenance (${detail.modelEntries.length} entr${detail.modelEntries.length === 1 ? "y" : "ies"} — lock 11)`}
        chips={detail.modelEntries.map((entry) => (
          <StatusChip
            key={`${entry.model}:${entry.usage}`}
            status={{
              label: `${entry.model} · ${entry.provider} · ${entry.usage}${entry.disclosed ? " · disclosed" : ""}`,
              tone: entry.disclosed ? "info" : "error",
              note: "package-system model-provenance entry (verbatim)",
            }}
          />
        ))}
        empty="no model-provenance entries — first-party work with no declared AI use"
      />
    </Panel>
  );
}
