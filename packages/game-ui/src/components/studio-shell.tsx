/**
 * STUDIO SHELL (presentational): the whole Game Studio surface — header
 * (title, deterministic studio summary, load-failure banner, refresh
 * control), the five-tab navigation (Packages / Session / Avatars /
 * Capabilities / Tools with count pills) and the active surface panel.
 *
 * Presentational component: renders `GameStudioViewModel` only. Every
 * control is real and wired through explicit callbacks (no dead controls):
 * tabs dispatch selection, ids select entities, refresh pulls one
 * authoritative snapshot through the host port. No data fetching here —
 * the app layer (app/studio-app.tsx) owns the store.
 */

import type { ReactNode } from "react";
import type { GameStudioViewModel, StudioTab } from "../view/studio-view.ts";
import { studioSummary } from "../view/studio-view.ts";
import { refreshFailureNextStep } from "../view/onboarding.ts";
import { CountPill } from "./status-chip.tsx";
import { Banner } from "./primitives.tsx";
import { AvatarsPanel } from "./avatars-panel.tsx";
import { BrokerPanel } from "./broker-panel.tsx";
import { PackagesPanel } from "./packages-panel.tsx";
import { SessionPanel } from "./session-panel.tsx";
import { ToolsPanel } from "./tools-panel.tsx";
import { FONT, STYLE, SURFACE } from "./tokens.ts";

/** Tab ids in navigation order, with their count pill source. */
const TABS: readonly { readonly id: StudioTab; readonly label: string }[] = [
  { id: "packages", label: "Packages" },
  { id: "session", label: "Session" },
  { id: "avatars", label: "Avatars" },
  { id: "capabilities", label: "Capabilities" },
  { id: "tools", label: "Tools" },
];

export interface StudioShellProps {
  /** The view model to render (from the store projection). */
  readonly view: GameStudioViewModel;
  /** Last load failure recorded verbatim, or null (E11 banner). */
  readonly loadError: string | null;
  /** Select a navigation tab (required: tabs are real controls). */
  readonly onSelectTab: (tab: StudioTab) => void;
  /** Pick a package record on the Packages surface. */
  readonly onSelectPackage?: (packageId: string) => void;
  /** Pick an avatar definition on the Avatars surface. */
  readonly onSelectAvatar?: (avatarId: string) => void;
  /** Pick a tool job on the Tools surface. */
  readonly onSelectJob?: (jobId: string) => void;
  /** Pull one authoritative snapshot through the port (rendered only when wired). */
  readonly onRefresh?: () => void;
}

/** The active surface for one tab. */
function StudioSurface({
  tab,
  view,
  onSelectPackage,
  onSelectAvatar,
  onSelectJob,
  onRefresh,
}: Omit<StudioShellProps, "loadError" | "onSelectTab"> & {
  readonly tab: StudioTab;
}): ReactNode {
  switch (tab) {
    case "packages":
      return (
        <PackagesPanel
          view={view.packages}
          selectedPackageId={view.selection.packageId}
          onSelectPackage={onSelectPackage}
          onRefresh={onRefresh}
        />
      );
    case "session":
      return <SessionPanel view={view.session} onRefresh={onRefresh} />;
    case "avatars":
      return (
        <AvatarsPanel
          view={view.avatars}
          selectedAvatarId={view.selection.avatarId}
          onSelectAvatar={onSelectAvatar}
          onRefresh={onRefresh}
        />
      );
    case "capabilities":
      return <BrokerPanel view={view.broker} onRefresh={onRefresh} />;
    case "tools":
      return (
        <ToolsPanel
          view={view.tools}
          selectedJobId={view.selection.jobId}
          onSelectJob={onSelectJob}
          onRefresh={onRefresh}
        />
      );
  }
}

/** Count shown in each tab's pill. */
function tabCount(view: GameStudioViewModel, tab: StudioTab): number {
  switch (tab) {
    case "packages":
      return view.packages.cards.length;
    case "session":
      return view.session.timeline.length;
    case "avatars":
      return view.avatars.cards.length;
    case "capabilities":
      return view.broker.coverage.length;
    case "tools":
      return view.tools.jobs.length;
  }
}

/** The Game Studio shell. */
export function StudioShell({
  view,
  loadError,
  onSelectTab,
  onSelectPackage,
  onSelectAvatar,
  onSelectJob,
  onRefresh,
}: StudioShellProps): ReactNode {
  const tab = view.selection.tab;
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: SURFACE.page,
        color: SURFACE.text,
        fontFamily: FONT.sans,
      }}
    >
      <header
        style={{
          padding: "18px 22px 14px",
          borderBottom: `1px solid ${SURFACE.border}`,
          background: SURFACE.panelHeader,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "0.01em" }}>
            PlayLiquid · Game Studio
          </h1>
          <p style={{ ...STYLE.panelSummary, marginTop: 4 }}>{studioSummary(view)}</p>
        </div>
        {onRefresh === undefined ? null : (
          <button type="button" onClick={onRefresh} style={STYLE.emptyStepButton}>
            Refresh snapshot
          </button>
        )}
      </header>
      <nav
        aria-label="Studio surfaces"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: "10px 22px",
          borderBottom: `1px solid ${SURFACE.border}`,
          background: SURFACE.panel,
        }}
      >
        {TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <button
              key={entry.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelectTab(entry.id)}
              style={{
                all: "unset",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? SURFACE.text : SURFACE.muted,
                background: active ? SURFACE.selected : "transparent",
                border: `1px solid ${active ? SURFACE.borderStrong : "transparent"}`,
              }}
            >
              {entry.label}
              <CountPill count={tabCount(view, entry.id)} />
            </button>
          );
        })}
      </nav>
      <main style={{ flex: 1, padding: 22 }}>
        <div style={{ display: "grid", gap: 14 }}>
          {loadError === null ? null : (
            <>
              <Banner tone="error">studio load failed (E11): {loadError}</Banner>
              <p style={{ ...STYLE.muted, margin: 0, fontSize: 12.5 }}>
                {refreshFailureNextStep(loadError)}
              </p>
            </>
          )}
          <StudioSurface
            tab={tab}
            view={view}
            onSelectPackage={onSelectPackage}
            onSelectAvatar={onSelectAvatar}
            onSelectJob={onSelectJob}
            onRefresh={onRefresh}
          />
        </div>
      </main>
      <footer
        style={{
          marginTop: "auto",
          padding: "10px 22px",
          borderTop: `1px solid ${SURFACE.border}`,
          background: SURFACE.panelHeader,
        }}
      >
        <p style={{ ...STYLE.panelSummary, margin: 0 }}>
          Read-only projection of authoritative systems · packages PL-011 · session PL-013 · avatars
          PL-026 · broker PL-026 · tools PL-019
        </p>
      </footer>
    </div>
  );
}
