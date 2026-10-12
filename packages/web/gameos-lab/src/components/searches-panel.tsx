/**
 * SEARCHES PANEL (presentational): the organization search sessions of
 * the Lab loop — one row per StoredSearch read model (deterministic seed
 * and space digest rendered, E9), the selected session's candidate
 * stream, and the "Request search" control that dispatches a TYPED
 * command intent through the host command port (never a store write).
 * Foreign-tenant rows render visibly dimmed with no select control
 * (R20 — the store would refuse the selection anyway).
 */

import type { ReactNode } from "react";
import type { LabCommandIntent } from "../ports.ts";
import type { LabViewer } from "../view/lab-view.ts";
import type { SearchesView } from "../view/search-view.ts";
import { searchesSummary } from "../view/search-view.ts";
import { searchProgressStatus } from "../view/status.ts";
import { DataTable, EmptyState, KeyValue, Panel } from "./primitives.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

export interface SearchesPanelProps {
  readonly view: SearchesView;
  /** Dispatch one typed command intent (the host command port). */
  readonly onDispatchCommand: (intent: LabCommandIntent) => void;
  /** The viewer tenancy the request-search intent is scoped to. */
  readonly viewer: LabViewer;
  readonly onSelectSearch: (searchId: string) => void;
}

/** The Searches surface. */
export function SearchesPanel({
  view,
  onDispatchCommand,
  viewer,
  onSelectSearch,
}: SearchesPanelProps): ReactNode {
  const selected = view.rows.find((row) => row.searchId === view.selectedSearchId) ?? null;
  return (
    <Panel title="Organization searches" summary={searchesSummary(view)}>
      <DataTable
        columns={[
          {
            key: "searchId",
            header: "Search",
            render: (row) => (
              <>
                {row.foreignTenant ? (
                  <span title="another tenant's session — selection is refused (R20)" style={STYLE.muted}>
                    {row.searchId}
                  </span>
                ) : (
                  <button
                    type="button"
                    style={STYLE.selectButton}
                    onClick={() => {
                      onSelectSearch(row.searchId);
                    }}
                  >
                    {row.searchId}
                  </button>
                )}
              </>
            ),
          },
          { key: "tenant", header: "Tenant", render: (row) => <span style={row.foreignTenant ? STYLE.faint : STYLE.muted}>{row.tenant}</span> },
          { key: "cycle", header: "Cycle", render: (row) => <span style={STYLE.mono}>{row.cycleId}</span> },
          { key: "seed", header: "Seed (E9)", render: (row) => <span style={STYLE.mono}>{row.seed}</span> },
          { key: "space", header: "Space", render: (row) => <span style={STYLE.mono}>{row.emitted}/{row.spaceSize}</span> },
          {
            key: "state",
            header: "State",
            render: (row) => <StatusChip status={searchProgressStatus(row.done)} />,
          },
          { key: "digest", header: "Space digest", render: (row) => <span style={STYLE.mono}>{row.spaceDigest}</span> },
          { key: "openedAt", header: "Opened at", render: (row) => <span style={STYLE.mono}>{row.openedAt}</span> },
        ]}
        rows={view.rows}
        rowKey={(row) => row.searchId}
        empty="no organization searches recorded"
      />
      <Panel title="Request a search (typed intent)" summary="dispatched through the command port — the host owns admission">
        <button
          type="button"
          style={{ ...STYLE.selectButton, fontSize: 12.5 }}
          onClick={() => {
            onDispatchCommand({
              kind: "request-search",
              tenant: viewer.tenant,
              subject: viewer.subject,
              cycleId: "cycle-ui-request",
              seed: "seed-ui-request",
              maxAgents: 2,
            });
          }}
        >
          request-search · cycle-ui-request · seed seed-ui-request
        </button>
      </Panel>
      {selected === null ? (
        <EmptyState label="no session selected — pick a search above to inspect its candidate stream" />
      ) : (
        <Panel
          title={`Candidate stream · ${selected.searchId}`}
          summary={`${view.candidates.length} candidates · seed ${selected.seed} (deterministic, E9)`}
        >
          <DataTable
            columns={[
              { key: "position", header: "Pos", render: (row) => <span style={STYLE.mono}>{row.position}</span> },
              { key: "spaceIndex", header: "Space idx", render: (row) => <span style={STYLE.mono}>{row.spaceIndex}</span> },
              { key: "baseline", header: "Baseline", render: (row) => (row.isBaseline ? "generalist (lock 26)" : "—") },
              { key: "agents", header: "Agents", render: (row) => <span style={STYLE.mono}>{row.agentCount ?? "—"}</span> },
              { key: "spread", header: "Capability spread", render: (row) => row.capabilitySpread ?? "—" },
              { key: "organization", header: "Organization", render: (row) => <span style={STYLE.mono}>{row.organization}</span> },
              { key: "digest", header: "Content digest", render: (row) => <span style={STYLE.mono}>{row.contentDigest}</span> },
            ]}
            rows={view.candidates}
            rowKey={(row) => String(row.position)}
            empty="this session has emitted no candidates yet"
          />
          <KeyValue
            entries={[
              { key: "Owner", value: <span style={STYLE.mono}>{selected.owner}</span> },
              { key: "Position", value: <span style={STYLE.mono}>{selected.position}</span> },
              { key: "Opened at", value: <span style={STYLE.mono}>{selected.openedAt}</span> },
            ]}
          />
        </Panel>
      )}
    </Panel>
  );
}
