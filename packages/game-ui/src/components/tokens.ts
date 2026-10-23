/**
 * STUDIO PRESENTATION TOKENS (pure): the ONE styling vocabulary of the Game
 * Studio components. Tone colors map the shared `UiStatus` vocabulary
 * (view/status.ts) onto chip styles; layout tokens fix the console surface
 * (dark studio theme). Inline-style tokens keep the components host-agnostic:
 * no CSS pipeline, no class-name collisions with the host app, deterministic
 * rendering (E1 applied to presentation: one owner of the style vocabulary).
 *
 * Pure module: no IO, no React.
 */

import type { UiTone } from "../view/status.ts";

/** The studio surface palette (dark console theme). */
export const SURFACE = {
  page: "#0b1220",
  panel: "#111a2c",
  panelHeader: "#0d1524",
  border: "#22304a",
  borderStrong: "#31415f",
  text: "#e2e8f0",
  muted: "#8fa3bf",
  faint: "#64748b",
  selected: "#16233b",
  hover: "#17233a",
} as const;

/** Font stacks (mono for ids/digests/sequences, sans for prose). */
export const FONT = {
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** The chip style of one presentation tone. */
export interface ToneStyle {
  readonly color: string;
  readonly background: string;
  readonly border: string;
}

/** The ONE tone → chip style mapping (dark-theme chips). */
export const TONE_STYLE: Record<UiTone, ToneStyle> = {
  ok: { color: "#4ade80", background: "rgba(34, 197, 94, 0.14)", border: "rgba(74, 222, 128, 0.45)" },
  warn: { color: "#fbbf24", background: "rgba(251, 191, 36, 0.12)", border: "rgba(251, 191, 36, 0.45)" },
  error: { color: "#f87171", background: "rgba(239, 68, 68, 0.14)", border: "rgba(248, 113, 113, 0.45)" },
  neutral: { color: "#94a3b8", background: "rgba(148, 163, 184, 0.12)", border: "rgba(148, 163, 184, 0.38)" },
  info: { color: "#2dd4bf", background: "rgba(45, 212, 191, 0.12)", border: "rgba(45, 212, 191, 0.45)" },
};

/** Base styles shared by the studio components (inline-style objects). */
export const STYLE = {
  panel: {
    background: SURFACE.panel,
    border: `1px solid ${SURFACE.border}`,
    borderRadius: 10,
    overflow: "hidden",
  } as const,
  panelHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 14px",
    background: SURFACE.panelHeader,
    borderBottom: `1px solid ${SURFACE.border}`,
  } as const,
  panelBody: { padding: 14 } as const,
  panelTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "0.02em",
    color: SURFACE.text,
    textTransform: "uppercase",
  } as const,
  panelSummary: { margin: 0, fontSize: 12, color: SURFACE.muted } as const,
  table: { borderCollapse: "collapse", width: "100%", fontSize: 12.5 } as const,
  th: {
    textAlign: "left",
    padding: "6px 10px",
    color: SURFACE.faint,
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    borderBottom: `1px solid ${SURFACE.border}`,
    whiteSpace: "nowrap",
  } as const,
  td: {
    padding: "6px 10px",
    color: SURFACE.text,
    borderBottom: `1px solid ${SURFACE.border}`,
    verticalAlign: "top",
  } as const,
  mono: { fontFamily: FONT.mono, fontSize: 12 } as const,
  muted: { color: SURFACE.muted } as const,
  faint: { color: SURFACE.faint } as const,
  card: {
    background: SURFACE.panel,
    border: `1px solid ${SURFACE.border}`,
    borderRadius: 10,
    padding: 14,
    display: "grid",
    gap: 10,
  } as const,
  cardSelected: {
    background: SURFACE.selected,
    border: `1px solid ${SURFACE.borderStrong}`,
    borderRadius: 10,
    padding: 14,
    display: "grid",
    gap: 10,
  } as const,
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" } as const,
  selectButton: {
    all: "unset",
    cursor: "pointer",
    fontFamily: FONT.mono,
    fontSize: 12,
    color: "#2dd4bf",
    textDecoration: "underline dotted",
  } as const,
  // First-run empty-surface styles (UX-002 frozen empty-state contract).
  emptySurface: {
    display: "grid",
    gap: 8,
    padding: "16px 16px 14px",
    border: `1px dashed ${SURFACE.borderStrong}`,
    borderRadius: 10,
    background: "rgba(17, 26, 44, 0.35)",
  } as const,
  emptyTitle: {
    margin: 0,
    fontSize: 13.5,
    fontWeight: 600,
    letterSpacing: "0.01em",
    color: SURFACE.text,
  } as const,
  emptyExplanation: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.55,
    color: SURFACE.muted,
  } as const,
  emptyGuidance: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: SURFACE.faint,
  } as const,
  emptyStepButton: {
    all: "unset",
    cursor: "pointer",
    justifySelf: "start",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: FONT.sans,
    color: "#0b1220",
    background: "#2dd4bf",
  } as const,
} as const;
