/**
 * BROKER PANEL (presentational): renders the capabilities read model
 * (view/broker-view.ts) — capability coverage rows (the intents each
 * capability authorizes, with host-denied / approval-required markers),
 * the R5 restriction chips, the authoritative grant table and the broker
 * evaluation timeline (PL-026; lock rule 4: the broker is THE permission
 * authority — this surface only READS it).
 *
 * Presentational component: renders `BrokerView` only; no data fetching.
 */

import type { ReactNode } from "react";
import type { BrokerView } from "../view/broker-view.ts";
import { brokerSummary } from "../view/broker-view.ts";
import { STUDIO_EMPTY_STATE_COPY } from "../view/onboarding.ts";
import { StatusChip } from "./status-chip.tsx";
import { ChipList, DataTable, Mono, Panel } from "./primitives.tsx";
import { EmptySurface } from "./empty-surface.tsx";
import { STYLE } from "./tokens.ts";

/** The Capabilities surface: coverage, restrictions, grants, evaluations. */
export function BrokerPanel({
  view,
  onRefresh,
}: {
  readonly view: BrokerView;
  /** The REAL next step of the first-run empty state: one port pull. */
  readonly onRefresh?: () => void;
}): ReactNode {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Panel title="Capabilities" summary={brokerSummary(view)}>
        {view.coverage.length === 0 ? (
          <EmptySurface copy={STUDIO_EMPTY_STATE_COPY.capabilities} onNextStep={onRefresh} />
        ) : (
          <DataTable
            columns={[
              { key: "capability", header: "capability", render: (row) => <Mono>{row.capability}</Mono> },
              {
                key: "intents",
                header: "authorized intents",
                render: (row) =>
                  row.intentKinds.length === 0 ? (
                    <span style={STYLE.muted}>—</span>
                  ) : (
                    <span style={{ ...STYLE.mono, fontSize: 12 }}>{row.intentKinds.join(", ")}</span>
                  ),
              },
              { key: "status", header: "policy", render: (row) => <StatusChip status={row.status} /> },
            ]}
            rows={view.coverage}
            rowKey={(row) => row.capability}
            empty="no capabilities declared"
          />
        )}
      </Panel>
      <Panel title="Host restrictions" summary={`${view.restrictions.length} active restriction${view.restrictions.length === 1 ? "" : "s"} (R5)`}>
        <ChipList
          label=""
          chips={view.restrictions.map((chip) => (
            <StatusChip
              key={`${chip.kind}-${chip.capability}`}
              status={
                chip.kind === "denied"
                  ? { label: `denied: ${chip.capability}`, tone: "error" }
                  : { label: `approval required: ${chip.capability}`, tone: "warn" }
              }
            />
          ))}
          empty="no host restrictions"
        />
      </Panel>
      <Panel
        title="Active grants"
        summary={`${view.grants.length} grant${view.grants.length === 1 ? "" : "s"} in the authoritative table`}
      >
        <DataTable
          columns={[
            { key: "grantId", header: "grant", render: (row) => <Mono>{row.grantId}</Mono> },
            { key: "capability", header: "capability", render: (row) => <Mono>{row.capability}</Mono> },
            { key: "holder", header: "holder", render: (row) => <Mono>{row.holder}</Mono> },
            { key: "epoch", header: "epoch", render: (row) => <Mono>{String(row.epoch)}</Mono> },
            {
              key: "expires",
              header: "expires after tick",
              render: (row) => (row.expiresAfterTick === null ? <span style={STYLE.muted}>never</span> : <Mono>{String(row.expiresAfterTick)}</Mono>),
            },
          ]}
          rows={view.grants}
          rowKey={(row) => row.grantId}
          empty="no active grants"
        />
      </Panel>
      <Panel
        title="Broker evaluations"
        summary={`${view.evaluations.length} tracked evaluation${view.evaluations.length === 1 ? "" : "s"}`}
      >
        <DataTable
          columns={[
            { key: "intentKind", header: "intent", render: (row) => <Mono>{row.intentKind}</Mono> },
            { key: "status", header: "resolution", render: (row) => <StatusChip status={row.status} /> },
            {
              key: "commandKind",
              header: "command",
              render: (row) => (row.commandKind === null ? <span style={STYLE.muted}>—</span> : <Mono>{row.commandKind}</Mono>),
            },
            { key: "requestId", header: "request", render: (row) => <Mono>{row.requestId}</Mono> },
          ]}
          rows={view.evaluations}
          rowKey={(row) => row.requestId}
          empty="no evaluations tracked"
        />
      </Panel>
    </div>
  );
}
