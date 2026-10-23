/**
 * THE RESPONSIVE SHELL LOGIC (UX-001): the pure decision module that keeps
 * EVERY navigation control of the product top bar reachable at the real
 * window geometries — the 480px minimum OS window
 * (MIN_DESKTOP_WINDOW_WIDTH, mirrored here as MIN_WINDOW_WIDTH_FLOOR) and
 * the 390px emulated viewport — fixing the observed baseline defect where
 * the "Game Studio" and "Lab" nav buttons overflowed off-screen at 480px
 * (release evidence ubuntu-20261015-061743).
 *
 * The mechanism is a THREE-DENSITY ladder chosen from the LIVE renderer
 * viewport width (window.innerWidth driven — JS-driven by requirement,
 * because the emulated 390x844 viewport resizes the renderer INSIDE the OS
 * window, so only the renderer's own viewport width is authoritative):
 *
 * - "full"     (>= FULL_BAR_BREAKPOINT):  brand name + tagline-free bar,
 *              icon+label nav, labeled "AI & Agents" escape hatch.
 * - "compact"  (480..breakpoint):         wordmark brand, icon-only nav with
 *              aria-labels, icon-only escape hatch with aria-label.
 * - "minimal"  (< MIN_WINDOW_WIDTH_FLOOR): wordmark brand, tightened icon
 *              controls (serves the 390x844 emulated viewport).
 *
 * Pure module: no IO, no JSX, no React. The chrome subscribes to the
 * viewport through the exported snapshot/subscription pair (useSyncExternal
 * Store), and the tests pin the ladder thresholds AND the conservative
 * width arithmetic: each density's budget must fit its narrowest served
 * width with headroom, computed from the very metrics the styles use.
 */

import { PRODUCT_NAME, PRODUCT_WORDMARK, WORKBENCH_NAV_LABEL } from "../identity.ts";
import { SHELL_WORKSPACES } from "./shell-workspaces.ts";

/** The density ladder of the product top bar. */
export type BarDensity = "full" | "compact" | "minimal";

/**
 * The viewport width at which the bar renders the FULL vocabulary
 * (icon+label navigation, labeled escape hatch, full brand name). Chosen
 * with headroom over the conservative full-density width budget — see
 * barWidthBudget("full") and its pinning test.
 */
export const FULL_BAR_BREAKPOINT = 820;

/**
 * The renderer viewport floor of a REAL product window: the main process
 * enforces minWidth 480 (packages/desktop/src/main/desktopWindowSize.ts —
 * the value is mirrored, not imported: the renderer must not depend on
 * main-process source; the pinning test reads the main file and asserts the
 * two never drift). Below this width only EMULATED viewports exist, so the
 * minimal density serves them.
 */
export const MIN_WINDOW_WIDTH_FLOOR = 480;

/** The narrowest emulated viewport the UX contract mandates (390x844). */
export const MIN_EMULATED_VIEWPORT_WIDTH = 390;

/** Viewport width used when no window exists (tests / non-DOM runtimes). */
export const SHELL_VIEWPORT_FALLBACK = 1280;

/** The matchMedia query for reduced-motion (frozen by accessibility rule). */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)" as const;

/** The per-density geometry metrics (px). The single source of truth for
 * BOTH the chrome styles (via shell-tokens.ts) and the width budgets — the
 * arithmetic and the rendering can never drift apart. */
export interface BarDensityMetrics {
  /** bar left padding (the macOS traffic-light inset overrides it). */
  readonly barPadLeft: number;
  readonly barPadRight: number;
  /** flex gap between the bar's clusters (brand / nav / escape / controls). */
  readonly barGap: number;
  /** gap between the navigation buttons. */
  readonly navGap: number;
  /** horizontal padding of one nav button. */
  readonly navPadX: number;
  /** the nav icon glyph size (icon-only buttons at compact/minimal). */
  readonly navIconSize: number;
  /** icon-to-label gap inside a labeled button (full density). */
  readonly navIconGap: number;
  /** horizontal padding of the escape-hatch button. */
  readonly workbenchPadX: number;
  /** the product mark size in the brand cluster. */
  readonly markSize: number;
  /** mark-to-name gap in the brand cluster. */
  readonly brandGap: number;
  /** one window control button width. */
  readonly controlWidth: number;
  /** gap between the window control buttons. */
  readonly controlGap: number;
}

/** The density ladder metrics (see BarDensityMetrics). */
export const SHELL_DENSITY_METRICS: Record<BarDensity, BarDensityMetrics> = Object.freeze({
  full: Object.freeze({
    barPadLeft: 14,
    barPadRight: 12,
    barGap: 10,
    navGap: 6,
    navPadX: 11,
    navIconSize: 16,
    navIconGap: 7,
    workbenchPadX: 10,
    markSize: 18,
    brandGap: 9,
    controlWidth: 36,
    controlGap: 2,
  }),
  compact: Object.freeze({
    barPadLeft: 12,
    barPadRight: 10,
    barGap: 10,
    navGap: 6,
    navPadX: 10,
    navIconSize: 16,
    navIconGap: 7,
    workbenchPadX: 10,
    markSize: 18,
    brandGap: 8,
    controlWidth: 36,
    controlGap: 2,
  }),
  minimal: Object.freeze({
    barPadLeft: 10,
    barPadRight: 8,
    barGap: 8,
    navGap: 4,
    navPadX: 8,
    navIconSize: 16,
    navIconGap: 7,
    workbenchPadX: 8,
    markSize: 16,
    brandGap: 8,
    controlWidth: 30,
    controlGap: 2,
  }),
} as const);

/**
 * The density of the top bar for a given renderer viewport width: full at
 * >= FULL_BAR_BREAKPOINT, compact down to the 480px window floor, minimal
 * for emulated/narrower viewports. Pure and total (negative/NaN inputs get
 * the minimal ladder — the safest, narrowest layout).
 */
export function barDensityForViewport(width: number): BarDensity {
  if (!Number.isFinite(width)) return "minimal";
  if (width >= FULL_BAR_BREAKPOINT) return "full";
  if (width >= MIN_WINDOW_WIDTH_FLOOR) return "compact";
  return "minimal";
}

/**
 * The conservative per-character width factor (em) for the bar's sans font.
 * Deliberately generous: it overestimates Inter AND the wider Linux
 * fallbacks (DejaVu Sans class), so a budget that fits under this factor
 * fits the real renderers.
 */
export const CONSERVATIVE_CHAR_WIDTH_EM = 0.62;

/** Conservative rendered width of one text run (ceil to whole px). */
function textWidth(text: string, fontSizePx: number): number {
  return Math.ceil(text.length * fontSizePx * CONSERVATIVE_CHAR_WIDTH_EM);
}

/** The brand text shown at one density (wordmark below the full density). */
export function brandTextForDensity(density: BarDensity): string {
  return density === "full" ? PRODUCT_NAME : PRODUCT_WORDMARK;
}

/** The escape-hatch label shown at one density (icon-only below full). */
export function workbenchLabelForDensity(density: BarDensity): string | undefined {
  return density === "full" ? WORKBENCH_NAV_LABEL : undefined;
}

/**
 * The conservative width the bar OCCUPIES at one density: paddings + brand
 * + navigation + escape hatch + window controls, all computed from
 * SHELL_DENSITY_METRICS and the frozen vocabulary — the same numbers the
 * rendered styles use. The pinning tests assert each density's budget fits
 * its narrowest served viewport with headroom (full <= its 820 breakpoint,
 * compact <= the 480px window floor, minimal <= the 390px emulated floor):
 * that is the arithmetic proof of the UX-001 geometry contract, verifiable
 * without a window manager (the station's vite production build OOMs — the
 * documented RW-001 environment limitation; real geometry is additionally
 * enforced by the UX-003 packaged harness).
 */
export function barWidthBudget(density: BarDensity): number {
  const metrics = SHELL_DENSITY_METRICS[density];
  const paddings = metrics.barPadLeft + metrics.barPadRight;
  const brand = metrics.markSize + metrics.brandGap + textWidth(brandTextForDensity(density), 13);
  const navigation =
    SHELL_WORKSPACES.reduce(
      (sum, workspace) =>
        sum +
        metrics.navPadX * 2 +
        metrics.navIconSize +
        (density === "full" ? metrics.navIconGap + textWidth(workspace.label, 12.5) : 0),
      0,
    ) +
    (SHELL_WORKSPACES.length - 1) * metrics.navGap;
  const workbench =
    metrics.workbenchPadX * 2 +
    metrics.navIconSize +
    (density === "full" ? 2 + metrics.navIconGap + textWidth(WORKBENCH_NAV_LABEL, 12) : 0);
  const controls = 3 * metrics.controlWidth + 2 * metrics.controlGap;
  return paddings + brand + metrics.barGap + navigation + metrics.barGap + workbench + metrics.barGap + controls;
}

/** The live renderer viewport width (no window → the documented fallback). */
export function viewportWidth(): number {
  if (typeof window === "undefined") return SHELL_VIEWPORT_FALLBACK;
  return window.innerWidth;
}

/** Subscribes to renderer viewport resizes (window + emulated viewports). */
export function subscribeViewportWidth(observer: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("resize", observer);
  return () => {
    window.removeEventListener("resize", observer);
  };
}

/** Whether the user asked for reduced motion (no window → false). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Subscribes to reduced-motion preference changes (no window → no-op). */
export function subscribeReducedMotion(observer: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  const legacy = query as MediaQueryList & {
    readonly addListener?: (observer: () => void) => void;
    readonly removeListener?: (observer: () => void) => void;
  };
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", observer);
    return () => {
      query.removeEventListener("change", observer);
    };
  }
  legacy.addListener?.(observer);
  return () => {
    legacy.removeListener?.(observer);
  };
}
