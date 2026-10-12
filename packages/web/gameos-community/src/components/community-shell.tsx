/**
 * COMMUNITY WORKBENCH SHELL (presentational): the whole Community
 * workbench surface — header (title, deterministic summary,
 * load-failure banner, selection-refusal banner, refresh control), the
 * three-tab navigation (Contributions / Lifecycle / Provenance with
 * count pills), the active surface panel, the append-only command log
 * (every dispatched intent AND its typed outcome — E8/E10) and the
 * source-attribution footer.
 *
 * Presentational component: renders `CommunityWorkbenchViewModel` only.
 * Every control is real and wired through explicit callbacks (no dead
 * controls). No data fetching here — the app layer
 * (app/community-app.tsx) owns the store.
 */

import type { ReactNode } from "react";
import type { CommunityCommandIntent, CommunityCommandLogEntry } from "../ports.ts";
import type {
  CommunityWorkbenchViewModel,
  CommunityTab,
} from "../view/community-view.ts";
import { communitySummary } from "../view/community-view.ts";
import type { CommunitySelectionRefusal } from "../view/community-selection.ts";
import { commandReceiptStatus, refusalStatus } from "../view/status.ts";
import { ContributionsPanel } from "./contributions-panel.tsx";
import { ProvenancePanel } from "./provenance-panel.tsx";
import { WorkflowPanel } from "./workflow-panel.tsx";
import { Banner, Panel } from "./primitives.tsx";
import { CountPill, StatusChip } from "./status-chip.tsx";
import { FONT, STYLE, SURFACE } from "./tokens.ts";
import type { CommunityViewer } from "../view/community-view.ts";

/** Tab ids in navigation order. */
const TABS: readonly { readonly id: CommunityTab; readonly label: string }[] = [
  { id: "contributions", label: "Contributions" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "provenance", label: "Provenance" },
];

export interface CommunityShellProps {
  /** The view model to render (from the store projection). */
  readonly view: CommunityWorkbenchViewModel;
  /** The viewer tenancy (scoped command intents; R20). */
  readonly viewer: CommunityViewer;
  /** Last load failure recorded verbatim, or null (E11 banner). */
  readonly loadError: string | null;
  /** Last cross-tenant selection refusal, or null (R20/E8 banner). */
  readonly selectionRefusal: CommunitySelectionRefusal | null;
  /** The append-only command log (E10). */
  readonly commandLog: readonly CommunityCommandLogEntry[];
  /** Select a navigation tab (required: tabs are real controls). */
  readonly onSelectTab: (tab: CommunityTab) => void;
  /** Apply (or clear) the contribution-kind filter. */
  readonly onSelectKind: (kind: string | null) => void;
  /** Open one contribution into the provenance detail view. */
  readonly onSelectContribution: (contributionId: string) => void;
  /** Dispatch one typed command intent (the host command port). */
  readonly onDispatchCommand: (intent: CommunityCommandIntent) => void;
  /** Pull one authoritative snapshot through the port (rendered when wired). */
  readonly onRefresh?: () => void;
}

/** Count pill source per tab. */
function pillCount(view: CommunityWorkbenchViewModel, tab: CommunityTab): number {
  switch (tab) {
    case "contributions":
      return view.contributions.totalContributions;
    case "lifecycle":
      return view.workflow.count;
    case "provenance":
      return view.provenance.detail === null ? 0 : 1;
  }
}

/** The active surface for one tab. */
function CommunitySurface({
  view,
  viewer,
  tab,
  onDispatchCommand,
  onSelectContribution,
  onSelectKind,
}: {
  readonly view: CommunityWorkbenchViewModel;
  readonly viewer: CommunityViewer;
  readonly tab: CommunityTab;
  readonly onDispatchCommand: (intent: CommunityCommandIntent) => void;
  readonly onSelectContribution: (contributionId: string) => void;
  readonly onSelectKind: (kind: string | null) => void;
}): ReactNode {
  switch (tab) {
    case "contributions":
      return (
        <ContributionsPanel
          view={view.contributions}
          viewer={viewer}
          onDispatchCommand={onDispatchCommand}
          onSelectKind={onSelectKind}
          onSelectContribution={onSelectContribution}
        />
      );
    case "lifecycle":
      return <WorkflowPanel view={view.workflow} viewer={viewer} onDispatchCommand={onDispatchCommand} />;
    case "provenance":
      return <ProvenancePanel view={view.provenance} />;
  }
}

/** One command-log row (typed outcome chips; E8/E10). */
function CommandLogRow({ entry }: { readonly entry: CommunityCommandLogEntry }): ReactNode {
  return (
    <tr>
      <td style={STYLE.td}>
        <span style={STYLE.mono}>{entry.intent.kind}</span>
      </td>
      <td style={STYLE.td}>
        <span style={STYLE.mono}>{summarizeIntent(entry.intent)}</span>
      </td>
      <td style={STYLE.td}>
        <StatusChip status={commandReceiptStatus(entry.receipt.ok)} />
      </td>
      <td style={STYLE.td}>
        <span style={STYLE.mono}>
          {entry.receipt.ok ? receiptLabel(entry.receipt.kind) : entry.receipt.code}
        </span>
      </td>
    </tr>
  );
}

function summarizeIntent(intent: CommunityCommandIntent): string {
  switch (intent.kind) {
    case "submit-contribution":
      return `${intent.contributionKind} · ${intent.label}${intent.aiGenerated ? " · AI-disclosed" : ""}`;
    case "advance-contribution":
      return `${intent.command} · ${intent.contributionId.slice(0, "sha256:".length + 8)}…`;
  }
}

function receiptLabel(kind: "contribution-submitted" | "contribution-advanced"): string {
  return kind === "contribution-submitted" ? "contribution submitted" : "contribution advanced";
}

/** The Community workbench shell. */
export function CommunityShell({
  view,
  viewer,
  loadError,
  selectionRefusal,
  commandLog,
  onSelectTab,
  onSelectKind,
  onSelectContribution,
  onDispatchCommand,
  onRefresh,
}: CommunityShellProps): ReactNode {
  return (
    <div style={{ minHeight: "100vh", background: SURFACE.page, color: SURFACE.text, fontFamily: FONT.sans }}>
      <header style={{ padding: "18px 22px 12px", borderBottom: `1px solid ${SURFACE.border}` }}>
        <h1 style={{ margin: 0, fontSize: 17, letterSpacing: "0.01em" }}>PlayLiquid · Community Contributions</h1>
        <p style={{ ...STYLE.muted, margin: "6px 0 10px", fontSize: 12.5 }}>{communitySummary(view)}</p>
        {loadError === null ? null : (
          <Banner tone="error">Community read-model load failed (E11): {loadError}</Banner>
        )}
        {selectionRefusal === null ? null : (
          <Banner tone="error">
            <StatusChip status={refusalStatus(selectionRefusal.code)} /> {selectionRefusal.detail}
          </Banner>
        )}
        {onRefresh === undefined ? null : (
          <button
            type="button"
            style={{ ...STYLE.selectButton, fontSize: 12.5 }}
            onClick={() => {
              onRefresh();
            }}
          >
            Refresh read models
          </button>
        )}
      </header>
      <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 22px", borderBottom: `1px solid ${SURFACE.border}` }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              onSelectTab(tab.id);
            }}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12.5,
              fontFamily: FONT.sans,
              color: view.selection.tab === tab.id ? "#2dd4bf" : SURFACE.muted,
              background: view.selection.tab === tab.id ? "rgba(45, 212, 191, 0.08)" : "transparent",
              border: `1px solid ${view.selection.tab === tab.id ? "rgba(45, 212, 191, 0.35)" : SURFACE.border}`,
            }}
          >
            {tab.label}
            <CountPill count={pillCount(view, tab.id)} />
          </button>
        ))}
      </nav>
      <main style={{ display: "grid", gap: 14, padding: "14px 22px 22px" }}>
        <CommunitySurface
          view={view}
          viewer={viewer}
          tab={view.selection.tab}
          onDispatchCommand={onDispatchCommand}
          onSelectContribution={onSelectContribution}
          onSelectKind={onSelectKind}
        />
        <Panel
          title="Command log (append-only)"
          summary={`${commandLog.length} dispatched intent${commandLog.length === 1 ? "" : "s"} · typed outcomes, never silent (E8)`}
        >
          {commandLog.length === 0 ? (
            <p style={{ ...STYLE.muted, margin: 0, fontSize: 12.5, fontStyle: "italic" }}>
              no command intents dispatched yet
            </p>
          ) : (
            <table style={STYLE.table}>
              <thead>
                <tr>
                  <th key="kind" scope="col" style={STYLE.th}>Intent</th>
                  <th key="detail" scope="col" style={STYLE.th}>Detail</th>
                  <th key="outcome" scope="col" style={STYLE.th}>Outcome</th>
                  <th key="code" scope="col" style={STYLE.th}>Code</th>
                </tr>
              </thead>
              <tbody>
                {commandLog.map((entry, index) => (
                  <CommandLogRow key={String(index)} entry={entry} />
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </main>
      <footer style={{ padding: "12px 22px", borderTop: `1px solid ${SURFACE.border}`, ...STYLE.faint, fontSize: 11.5 }}>
        Read-only projection of authoritative systems · community PL-032 · commands are typed intents
        through ports · untrusted until qualified (E8)
      </footer>
    </div>
  );
}
