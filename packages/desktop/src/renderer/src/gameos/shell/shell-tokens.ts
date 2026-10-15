/**
 * PRODUCT SHELL PRESENTATION TOKENS (pure): the styling vocabulary of the
 * PlayLiquid GameOS product chrome — the sibling product modules' console
 * palette (game-ui / gameos-lab / gameos-community tokens), re-declared
 * locally so the shell's dependency graph stays its own (the module
 * pattern). Inline-style tokens keep the shell host-agnostic: no CSS
 * pipeline, no class-name collisions with the host app, deterministic
 * rendering (E1 applied to presentation).
 *
 * Pure module: no IO, no JSX (the SVG mark lives in the chrome component
 * where JSX belongs); only the React STYLE TYPE is imported (erased).
 */

import type { CSSProperties } from "react";

/** React CSS properties extended with Electron's app-region (frameless). */
export type ShellCssProperties = CSSProperties & {
  readonly WebkitAppRegion?: "drag" | "no-drag";
};

/** The product shell surface palette (dark console theme). */
export const SHELL_SURFACE = {
  page: "#0b1220",
  bar: "#0d1524",
  panel: "#111a2c",
  border: "#22304a",
  borderStrong: "#31415f",
  text: "#e2e8f0",
  muted: "#8fa3bf",
  faint: "#64748b",
  selected: "#16233b",
  accent: "#2dd4bf",
  danger: "#f87171",
} as const;

/** Font stacks (mono for ids, sans for chrome). */
export const SHELL_FONT = {
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** The top-bar height (the drag region of the frameless Linux window). */
export const SHELL_BAR_HEIGHT = 44;

/** Base styles shared by the shell chrome (inline-style objects). */
export const SHELL_STYLE: Record<string, ShellCssProperties> = {
  root: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    background: SHELL_SURFACE.page,
    color: SHELL_SURFACE.text,
    fontFamily: SHELL_FONT.sans,
    overflow: "hidden",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: SHELL_BAR_HEIGHT,
    padding: "0 10px 0 14px",
    background: SHELL_SURFACE.bar,
    borderBottom: `1px solid ${SHELL_SURFACE.border}`,
    WebkitAppRegion: "drag",
    userSelect: "none",
    flex: "0 0 auto",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
  },
  brandName: {
    margin: 0,
    fontSize: 13,
    fontWeight: 650,
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
  },
  brandTagline: {
    margin: 0,
    fontSize: 11,
    color: SHELL_SURFACE.faint,
    whiteSpace: "nowrap",
  },
  navButton: {
    all: "unset",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 11px",
    borderRadius: 8,
    fontSize: 12.5,
    color: SHELL_SURFACE.muted,
    WebkitAppRegion: "no-drag",
    whiteSpace: "nowrap",
  },
  workbenchButton: {
    all: "unset",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 8,
    fontSize: 12,
    color: SHELL_SURFACE.muted,
    border: `1px solid ${SHELL_SURFACE.border}`,
    background: SHELL_SURFACE.panel,
    WebkitAppRegion: "no-drag",
    whiteSpace: "nowrap",
  },
  windowControl: {
    all: "unset",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 28,
    borderRadius: 7,
    color: SHELL_SURFACE.muted,
    WebkitAppRegion: "no-drag",
  },
  workspaceHost: {
    flex: "1 1 auto",
    minHeight: 0,
    overflow: "auto",
    padding: 12,
  },
  banner: {
    margin: 24,
    padding: "12px 16px",
    borderRadius: 10,
    color: SHELL_SURFACE.danger,
    background: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(248, 113, 113, 0.4)",
    fontFamily: SHELL_FONT.mono,
    fontSize: 12.5,
  },
  retryButton: {
    all: "unset",
    cursor: "pointer",
    marginTop: 12,
    padding: "6px 14px",
    borderRadius: 8,
    color: SHELL_SURFACE.accent,
    border: `1px solid ${SHELL_SURFACE.borderStrong}`,
    fontFamily: SHELL_FONT.mono,
    fontSize: 12.5,
  },
};

/** The active/inactive navigation button style (a fresh merge per call). */
export function navButtonStyle(active: boolean): ShellCssProperties {
  return active
    ? {
        ...SHELL_STYLE.navButton,
        background: SHELL_SURFACE.selected,
        color: SHELL_SURFACE.text,
        boxShadow: `inset 0 0 0 1px ${SHELL_SURFACE.borderStrong}`,
      }
    : { ...SHELL_STYLE.navButton };
}
