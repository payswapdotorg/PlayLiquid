/**
 * LAB WORKBENCH SHELL (presentational): the whole Lab workbench surface —
 * header (title, deterministic summary, load-failure banner, selection
 * refusal banner, refresh control), the six-tab navigation (Searches /
 * Evidence / Learning / Guidance / Gaps / Arena with count pills), the
 * active surface panel, the append-only command log (every dispatched
 * intent AND its typed outcome — E8/E10) and the source-attribution
 * footer.
 *
 * Presentational component: renders `LabWorkbenchViewModel` only. Every
 * control is real and wired through explicit callbacks (no dead
 * controls). No data fetching here — the app layer (app/lab-app.tsx)
 * owns the store.
 */

import type { ReactNode } from "react";
import type { LabCommandIntent, LabCommandLogEntry } from "../ports.ts";
import type { LabWorkbenchViewModel, LabTab } from "../view/lab-view.ts";
import { labSummary } from "../view/lab-view.ts";
import type { LabSelectionRefusal } from "../view/lab-selection.ts";
import { commandLogNextHint, refreshFailureNextStep } from "../view/onboarding.ts";
import { commandReceiptStatus, refusalStatus } from "../view/status.ts";
import { ArenaPanel } from "./arena-panel.tsx";
import { EvidencePanel } from "./evidence-panel.tsx";
import { GapsPanel } from "./gaps-panel.tsx";
import { GuidancePanel } from "./guidance-panel.tsx";
import { LearningPanel } from "./learning-panel.tsx";
import { SearchesPanel } from "./searches-panel.tsx";
import { Banner, Panel } from "./primitives.tsx";
import { CountPill, StatusChip } from "./status-chip.tsx";
import { FONT, STYLE, SURFACE } from "./tokens.ts";
import type { LabViewer } from "../view/lab-view.ts";

/** Tab ids in navigation order. */
const TABS: readonly { readonly id: LabTab; readonly label: string }[] = [
  { id: "searches", label: "Searches" },
  { id: "evidence", label: "Evidence" },
  { id: "learning", label: "Learning" },
  { id: "guidance", label: "Guidance" },
  { id: "gaps", label: "Gaps" },
  { id: "arena", label: "Arena" },
];

export interface LabShellProps {
  /** The view model to render (from the store projection). */
  readonly view: LabWorkbenchViewModel;
  /** The viewer tenancy (scoped command intents; R20). */
  readonly viewer: LabViewer;
  /** Last load failure recorded verbatim, or null (E11 banner). */
  readonly loadError: string | null;
  /** Last cross-tenant selection refusal, or null (R20/E8 banner). */
  readonly selectionRefusal: LabSelectionRefusal | null;
  /** The append-only command log (E10). */
  readonly commandLog: readonly LabCommandLogEntry[];
  /** Select a navigation tab (required: tabs are real controls). */
  readonly onSelectTab: (tab: LabTab) => void;
  /** Pick a search session on the Searches surface. */
  readonly onSelectSearch: (searchId: string) => void;
  /** Dispatch one typed command intent (the host command port). */
  readonly onDispatchCommand: (intent: LabCommandIntent) => void;
  /** Pull one authoritative snapshot through the port (rendered when wired). */
  readonly onRefresh?: () => void;
}

/** Count pill source per tab. */
function pillCount(view: LabWorkbenchViewModel, tab: LabTab): number {
  switch (tab) {
    case "searches":
      return view.searches.totalSearches;
    case "evidence":
      return view.evidence.count;
    case "learning":
      return view.learning.recordCount;
    case "guidance":
      return view.guidance.observed.length + view.guidance.estimates.length;
    case "gaps":
      return view.gaps.rows.length;
    case "arena":
      return view.arena.totalCases;
  }
}

/** The active surface for one tab. */
function LabSurface({
  view,
  viewer,
  tab,
  onDispatchCommand,
  onSelectSearch,
  onRefresh,
}: {
  readonly view: LabWorkbenchViewModel;
  readonly viewer: LabViewer;
  readonly tab: LabTab;
  readonly onDispatchCommand: (intent: LabCommandIntent) => void;
  readonly onSelectSearch: (searchId: string) => void;
  /** The REAL next step of a no-data surface: one data-port pull. */
  readonly onRefresh?: () => void;
}): ReactNode {
  switch (tab) {
    case "searches":
      return (
        <SearchesPanel
          view={view.searches}
          viewer={viewer}
          onDispatchCommand={onDispatchCommand}
          onSelectSearch={onSelectSearch}
        />
      );
    case "evidence":
      return <EvidencePanel view={view.evidence} onRefresh={onRefresh} />;
    case "learning":
      return <LearningPanel view={view.learning} onRefresh={onRefresh} />;
    case "guidance":
      return <GuidancePanel view={view.guidance} onRefresh={onRefresh} />;
    case "gaps":
      return (
        <GapsPanel
          view={view.gaps}
          viewer={viewer}
          onDispatchCommand={onDispatchCommand}
          selectedCapability={view.selection.gapCapability}
          onRefresh={onRefresh}
        />
      );
    case "arena":
      return <ArenaPanel view={view.arena} onRefresh={onRefresh} />;
  }
}

/** One command-log row (typed outcome chips; E8/E10). */
function CommandLogRow({ entry }: { readonly entry: LabCommandLogEntry }): ReactNode {
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
        <span style={STYLE.mono}>{entry.receipt.ok ? receiptLabel(entry.receipt.kind) : entry.receipt.code}</span>
      </td>
    </tr>
  );
}

function summarizeIntent(intent: LabCommandIntent): string {
  switch (intent.kind) {
    case "request-search":
      return `cycle ${intent.cycleId} · seed ${intent.seed}`;
    case "advance-gap-rung":
      return `gap ${intent.gapId} → ${intent.rung}`;
  }
}

function receiptLabel(kind: "search-opened" | "gap-advanced"): string {
  return kind === "search-opened" ? "search opened" : "gap advanced";
}

/** The Lab workbench shell. */
export function LabShell({
  view,
  viewer,
  loadError,
  selectionRefusal,
  commandLog,
  onSelectTab,
  onSelectSearch,
  onDispatchCommand,
  onRefresh,
}: LabShellProps): ReactNode {
  return (
    <div style={{ minHeight: "100vh", background: SURFACE.page, color: SURFACE.text, fontFamily: FONT.sans }}>
      <header style={{ padding: "18px 22px 12px", borderBottom: `1px solid ${SURFACE.border}` }}>
        <h1 style={{ margin: 0, fontSize: 17, letterSpacing: "0.01em" }}>PlayLiquid · Game Engineering Lab</h1>
        <p style={{ ...STYLE.muted, margin: "6px 0 10px", fontSize: 12.5 }}>{labSummary(view)}</p>
        {loadError === null ? null : (
          <>
            <Banner tone="error">Lab read-model load failed (E11): {loadError}</Banner>
            <p style={{ ...STYLE.muted, margin: "6px 0 0", fontSize: 12.5 }}>
              {refreshFailureNextStep(loadError)}
            </p>
          </>
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
        <LabSurface
          view={view}
          viewer={viewer}
          tab={view.selection.tab}
          onDispatchCommand={onDispatchCommand}
          onSelectSearch={onSelectSearch}
          onRefresh={onRefresh}
        />
        <Panel title="Command log (append-only)" summary={`${commandLog.length} dispatched intent${commandLog.length === 1 ? "" : "s"} · typed outcomes, never silent (E8)`}>
          {commandLog.length === 0 ? (
            <p style={{ ...STYLE.muted, margin: 0, fontSize: 12.5, fontStyle: "italic" }}>
              no command intents dispatched yet
            </p>
          ) : (
            <>
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
              <p style={{ ...STYLE.muted, margin: 0, fontSize: 12 }}>
                {commandLogNextHint(commandLog)}
              </p>
            </>
          )}
        </Panel>
      </main>
      <footer style={{ padding: "12px 22px", borderTop: `1px solid ${SURFACE.border}`, ...STYLE.faint, fontSize: 11.5 }}>
        Read-only projection of authoritative systems · organization PL-029 · simulation PL-028 ·
        learning PL-030 · arena runtime PL-031 · commands are typed intents through ports
      </footer>
    </div>
  );
}
