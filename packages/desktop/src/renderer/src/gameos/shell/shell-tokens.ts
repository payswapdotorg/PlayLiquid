/**
 * THE PRODUCT SHELL DESIGN SYSTEM (RW-001, reworked UX-001): the ONE
 * styling vocabulary of the PlayLiquid GameOS product chrome — color,
 * typography, spacing, borders/radii, focus, motion — plus the
 * density-aware style factories the responsive top bar is built from (see
 * shell-density.ts for the ladder and its width arithmetic).
 *
 * The palette is the sibling product modules' console palette
 * (game-ui / gameos-lab / gameos-community tokens), re-declared locally so
 * the shell's dependency graph stays its own (the module pattern); one
 * inherited value was corrected for WCAG AA (SHELL_SURFACE.faint). Inline
 * styles keep the shell host-agnostic: no CSS pipeline, no class-name
 * collisions with the host app, deterministic rendering (E1 applied to
 * presentation).
 *
 * Pure module: no IO, no JSX (SVG glyphs live in the icon/chrome
 * components); only the React STYLE TYPE and the density metrics are
 * imported (both erased/pure).
 */

import type { CSSProperties } from "react";
import type { BarDensity } from "./shell-density.ts";
import { SHELL_DENSITY_METRICS } from "./shell-density.ts";

/** React CSS properties extended with Electron's app-region (frameless). */
export type ShellCssProperties = CSSProperties & {
  readonly WebkitAppRegion?: "drag" | "no-drag";
};

/** The product shell surface palette (dark console theme). */
export const SHELL_SURFACE = {
  page: "#0b1220",
  bar: "#0d1524",
  panel: "#111a2c",
  hover: "#17233a",
  selected: "#16233b",
  border: "#22304a",
  borderStrong: "#31415f",
  text: "#e2e8f0",
  muted: "#8fa3bf",
  /** AA-fixed (UX-001): the inherited #64748b measured 3.84:1 on the bar. */
  faint: "#8296b3",
  accent: "#2dd4bf",
  danger: "#f87171",
  /** Solid equivalents of the danger washes (alpha over page/bar). */
  dangerBanner: "#221724",
  dangerCloseHover: "#2d1c29",
} as const;

/** Font stacks (mono for diagnostics, sans for chrome). */
export const SHELL_FONT = {
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** Typographic roles of the shell (one scale, restrained weights). */
export const SHELL_TYPE = {
  /** the brand name in the bar. */
  barName: { fontSize: 13, fontWeight: 650, letterSpacing: "0.01em" },
  /** navigation and escape-hatch labels. */
  navLabel: { fontSize: 12.5, fontWeight: 550, letterSpacing: "0.005em" },
  escapeLabel: { fontSize: 12, fontWeight: 550, letterSpacing: "0.005em" },
  /** the starting/failure screens (one step up the hierarchy). */
  startupName: { fontSize: 17, fontWeight: 650, letterSpacing: "0.01em" },
  startupTagline: { fontSize: 12.5, fontWeight: 450 },
  /** honest diagnostics (E11 banners, technical detail). */
  diagnostics: { fontFamily: SHELL_FONT.mono, fontSize: 12.5 },
} as const;

/** The 4px-base spacing scale (px). */
export const SHELL_SPACE = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  xxl: 20,
} as const;

/** Corner-radius scale (px) — quiet, consistent rounding. */
export const SHELL_RADIUS = {
  sm: 6,
  md: 8,
  lg: 10,
} as const;

/** The top-bar height (the drag region of the frameless Linux window). */
export const SHELL_BAR_HEIGHT = 44;

/** One interactive control's height (nav / escape / window buttons). */
export const SHELL_CONTROL_HEIGHT = 28;

/** Motion tokens: quick, quiet transitions only (no layout motion, ever). */
export const SHELL_MOTION = {
  durationMs: 120,
  easing: "cubic-bezier(0.25, 0, 0, 0.9)",
} as const;

/**
 * The color-transition style for interactive chrome. Reduced motion (the
 * user's prefers-reduced-motion) collapses it to none — the ONLY motion the
 * shell adds is this color fade; density changes re-layout instantly by
 * design.
 */
export function motionTransition(reduced: boolean): string {
  if (reduced) return "none";
  const { durationMs, easing } = SHELL_MOTION;
  return ["background-color", "color", "border-color"]
    .map((property) => `${property} ${durationMs}ms ${easing}`)
    .join(", ");
}

/** Focus tokens: a visible ring on EVERY interactive element (UX-001). */
export const SHELL_FOCUS = {
  width: 2,
  offset: 2,
  color: SHELL_SURFACE.accent,
} as const;

/** The focus style applied on the focused control (inline :focus-visible
 * equivalent — chrome buttons merge it while their focus state is on). */
export function focusRingStyle(visible: boolean): ShellCssProperties {
  return visible
    ? {
        outline: `${SHELL_FOCUS.width}px solid ${SHELL_FOCUS.color}`,
        outlineOffset: SHELL_FOCUS.offset,
      }
    : { outline: "none" };
}

/** Hover treatments (merged over the base styles by the chrome). */
export const SHELL_HOVER = {
  navIdle: { color: SHELL_SURFACE.text, background: SHELL_SURFACE.hover },
  navActive: { color: SHELL_SURFACE.text },
  escape: {
    color: SHELL_SURFACE.text,
    background: SHELL_SURFACE.selected,
    borderColor: SHELL_SURFACE.borderStrong,
  },
  control: { color: SHELL_SURFACE.text, background: SHELL_SURFACE.hover },
  controlClose: { color: SHELL_SURFACE.danger, background: SHELL_SURFACE.dangerCloseHover },
  retry: { color: SHELL_SURFACE.text, borderColor: SHELL_SURFACE.accent },
} as const satisfies Record<string, ShellCssProperties>;

/**
 * The WCAG contrast contract of the shell (verified by
 * shell-tokens.test.ts with the WCAG 2.x relative-luminance formula).
 * minimum: 4.5 for text roles, 3.0 for non-text (glyphs, focus rings).
 */
export const SHELL_CONTRAST_PAIRS = [
  { role: "brand name on the bar", fg: SHELL_SURFACE.text, bg: SHELL_SURFACE.bar, minimum: 4.5 },
  { role: "idle nav label on the bar", fg: SHELL_SURFACE.muted, bg: SHELL_SURFACE.bar, minimum: 4.5 },
  { role: "hovered nav label on hover", fg: SHELL_SURFACE.muted, bg: SHELL_SURFACE.hover, minimum: 4.5 },
  { role: "active nav label on selected", fg: SHELL_SURFACE.text, bg: SHELL_SURFACE.selected, minimum: 4.5 },
  { role: "idle escape label on panel", fg: SHELL_SURFACE.muted, bg: SHELL_SURFACE.panel, minimum: 4.5 },
  { role: "window control glyph on the bar", fg: SHELL_SURFACE.muted, bg: SHELL_SURFACE.bar, minimum: 3 },
  { role: "hovered window glyph on hover", fg: SHELL_SURFACE.text, bg: SHELL_SURFACE.hover, minimum: 3 },
  { role: "close-hover glyph", fg: SHELL_SURFACE.danger, bg: SHELL_SURFACE.dangerCloseHover, minimum: 3 },
  { role: "focus ring on the bar", fg: SHELL_SURFACE.accent, bg: SHELL_SURFACE.bar, minimum: 3 },
  { role: "focus ring on selected", fg: SHELL_SURFACE.accent, bg: SHELL_SURFACE.selected, minimum: 3 },
  { role: "starting tagline on page", fg: SHELL_SURFACE.muted, bg: SHELL_SURFACE.page, minimum: 4.5 },
  { role: "starting brand name on page", fg: SHELL_SURFACE.text, bg: SHELL_SURFACE.page, minimum: 4.5 },
  { role: "compose-failure detail on banner", fg: SHELL_SURFACE.danger, bg: SHELL_SURFACE.dangerBanner, minimum: 4.5 },
  { role: "retry label on page", fg: SHELL_SURFACE.accent, bg: SHELL_SURFACE.page, minimum: 4.5 },
] as const;

/** Base styles shared by the shell chrome (density-agnostic; literal keys
 * so reads stay non-optional even under noUncheckedIndexedAccess). */
export const SHELL_STYLE = {
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
  brandName: {
    margin: 0,
    ...SHELL_TYPE.barName,
    whiteSpace: "nowrap",
  },
  brandTagline: {
    margin: 0,
    ...SHELL_TYPE.startupTagline,
    color: SHELL_SURFACE.muted,
    whiteSpace: "nowrap",
  },
  workspaceHost: {
    flex: "1 1 auto",
    minHeight: 0,
    overflow: "auto",
    padding: SHELL_SPACE.xl,
  },
  banner: {
    margin: SHELL_SPACE.xxl,
    padding: "12px 16px",
    borderRadius: SHELL_RADIUS.lg,
    color: SHELL_SURFACE.danger,
    background: SHELL_SURFACE.dangerBanner,
    border: `1px solid rgba(248, 113, 113, 0.4)`,
    ...SHELL_TYPE.diagnostics,
  },
  retryButton: {
    all: "unset",
    cursor: "pointer",
    marginTop: SHELL_SPACE.md,
    padding: "6px 14px",
    borderRadius: SHELL_RADIUS.md,
    color: SHELL_SURFACE.accent,
    border: `1px solid ${SHELL_SURFACE.borderStrong}`,
    ...SHELL_TYPE.diagnostics,
  },
} as const satisfies Record<string, ShellCssProperties>;

/** The top-bar style at one density (the frameless window's drag region). */
export function barStyle(density: BarDensity): ShellCssProperties {
  const m = SHELL_DENSITY_METRICS[density];
  return {
    display: "flex",
    alignItems: "center",
    gap: m.barGap,
    height: SHELL_BAR_HEIGHT,
    padding: `0 ${m.barPadRight}px 0 ${m.barPadLeft}px`,
    background: SHELL_SURFACE.bar,
    borderBottom: `1px solid ${SHELL_SURFACE.border}`,
    WebkitAppRegion: "drag",
    userSelect: "none",
    flex: "0 0 auto",
  };
}

/** The brand cluster style at one density (shrinkable: it ellipsizes
 * before any navigation or window control can ever be pushed out). */
export function brandClusterStyle(density: BarDensity): ShellCssProperties {
  const m = SHELL_DENSITY_METRICS[density];
  return {
    display: "flex",
    alignItems: "center",
    gap: m.brandGap,
    flex: "0 1 auto",
    minWidth: 0,
  };
}

/** The brand NAME text style in the bar (ellipsis-guarded). */
export function brandNameTextStyle(): ShellCssProperties {
  return {
    ...SHELL_STYLE.brandName,
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

/** The navigation cluster style at one density. */
export function navClusterStyle(density: BarDensity): ShellCssProperties {
  const m = SHELL_DENSITY_METRICS[density];
  return {
    display: "flex",
    alignItems: "center",
    gap: m.navGap,
    flex: "0 0 auto",
  };
}

/** One navigation button at one density (icon-only below full density). */
export function navButtonStyle(active: boolean, density: BarDensity): ShellCssProperties {
  const m = SHELL_DENSITY_METRICS[density];
  const base: ShellCssProperties = {
    all: "unset",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: m.navIconGap,
    height: SHELL_CONTROL_HEIGHT,
    padding: `0 ${m.navPadX}px`,
    borderRadius: SHELL_RADIUS.md,
    ...SHELL_TYPE.navLabel,
    color: SHELL_SURFACE.muted,
    WebkitAppRegion: "no-drag",
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  };
  return active
    ? {
        ...base,
        background: SHELL_SURFACE.selected,
        color: SHELL_SURFACE.text,
        boxShadow: `inset 0 0 0 1px ${SHELL_SURFACE.borderStrong}`,
      }
    : base;
}

/** The escape hatch ("AI & Agents") button at one density — visually the
 * quiet sibling of the navigation: a bordered panel chip. */
export function workbenchButtonStyle(density: BarDensity): ShellCssProperties {
  const m = SHELL_DENSITY_METRICS[density];
  return {
    all: "unset",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: m.navIconGap,
    height: SHELL_CONTROL_HEIGHT,
    padding: `0 ${m.workbenchPadX}px`,
    borderRadius: SHELL_RADIUS.md,
    ...SHELL_TYPE.escapeLabel,
    color: SHELL_SURFACE.muted,
    border: `1px solid ${SHELL_SURFACE.border}`,
    background: SHELL_SURFACE.panel,
    WebkitAppRegion: "no-drag",
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  };
}

/** One window control button at one density (real platform commands). */
export function windowControlStyle(density: BarDensity): ShellCssProperties {
  const m = SHELL_DENSITY_METRICS[density];
  return {
    all: "unset",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: m.controlWidth,
    height: SHELL_CONTROL_HEIGHT,
    borderRadius: SHELL_RADIUS.sm,
    color: SHELL_SURFACE.muted,
    WebkitAppRegion: "no-drag",
    flex: "0 0 auto",
  };
}
