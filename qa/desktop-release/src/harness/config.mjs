/**
 * RW-003 packaged-app smoke harness — configuration and check constants.
 *
 * Zero npm dependencies: Node >= 22 (built-in fetch + WebSocket). The harness
 * drives the PACKAGED Linux application (AppImage / installed .deb binary)
 * under Xvfb via the Chrome DevTools Protocol — it never touches a dev
 * server, repo-relative renderer files or dev-only env vars.
 *
 * Everything product-specific lives here so the same harness can be re-run
 * by the TL on the re-branded artifact without code changes (see README).
 */

import { resolve } from "node:path";

/** Markers rendered by the REAL product modules (packages/game-ui,
 * packages/web/gameos-lab, packages/web/gameos-community). Worker A's product
 * shell composes those modules, so these strings are the stable contract. */
export const PRODUCT_MARKERS = Object.freeze({
  productName: "PlayLiquid GameOS",
  studioHeading: "PlayLiquid · Game Studio",
  studioNavLabel: "Studio surfaces",
  studioTabs: ["Packages", "Session", "Avatars", "Capabilities", "Tools"],
  studioRefresh: "Refresh snapshot",
  studioLoadErrorPrefix: "studio load failed (E11):",
  studioEmptyPackages: "no package records loaded",
  labHeading: "PlayLiquid · Game Engineering Lab",
  communityHeading: "PlayLiquid · Community Contributions",
  labRefresh: "Refresh read models",
  communityRefresh: "Refresh read models",
  labLoadErrorPrefix: "Lab read-model load failed (E11):",
  communityLoadErrorPrefix: "Community read-model load failed (E11):",
  /** The shell navigation affordance that opens the ZCode workbench (RW-001
   * reachability requirement; the label honestly names the target). */
  workbenchAffordance: "ZCode workbench",
});

/** The FROZEN shell marker vocabulary (spec/ux/work-items.md — UX-001
 * implements, UX-003 asserts). data-testid selectors + the frozen `AI &
 * Agents` escape-hatch label that replaces the inherited `ZCode workbench`. */
export const SHELL_MARKERS = Object.freeze({
  bar: "gameos-shell-bar",
  brand: "gameos-shell-brand",
  navStudio: "gameos-nav-studio",
  navLab: "gameos-nav-lab",
  navCommunity: "gameos-nav-community",
  navWorkbench: "gameos-nav-workbench",
  workspaceHost: "gameos-workspace-host",
  composeFailed: "gameos-compose-failed",
  /** Optional compact-width overflow control (frozen contract marks it
   * optional; when present, collapsed navigation may live behind it). */
  shellOverflow: "gameos-shell-overflow",
  emptyState: "gameos-empty-state",
  emptyNextStep: "gameos-empty-next-step",
  workbenchLabel: "AI & Agents",
  /** The window-control accessible names rendered by the shell chrome
   * (platform desktop commands; stable, honest, screen-reader labels). */
  windowControlLabels: ["Minimize window", "Maximize window", "Restore window", "Close window"],
});

/** Viewports mandated by AGENTS.md (UI evidence standard). */
export const VIEWPORTS = Object.freeze({
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
});

/** The desktop main window enforces minWidth 480 / minHeight 640
 * (packages/desktop/src/main/desktopWindowSize.ts). A 390-px OS window is
 * therefore impossible without changing the product; the 390x844 viewport is
 * captured with CDP device-metrics emulation instead (documented honestly). */
export const WINDOW_MIN_WIDTH = 480;

export const DEFAULTS = Object.freeze({
  cdpPort: 9333,
  /** The offline scenario gets its own CDP port (main port + 1): a second
   * Chromium cannot bind a port the previous instance may still hold, and it
   * then silently starts WITHOUT remote debugging — observed on the station. */
  offlineCdpPortOffset: 1,
  portFreeTimeoutMs: 30_000,
  display: ":89",
  displayCandidates: [":89", ":88", ":87", ":86", ":85", ":84", ":83", ":82", ":81", ":80"],
  xvfbScreen: "1920x1080x24",
  cdpReadyTimeoutMs: 180_000,
  renderSettleTimeoutMs: 90_000,
  shutdownTimeoutMs: 30_000,
  offlineObserveMs: 30_000,
  memRequiredMb: 600,
  memWaitMs: 120_000,
  memWaitMaxMs: 20 * 60_000,
  /** PLX-REL-001: how long to wait for the product shell markers after the
   * DOM settles — the packaged app's first-run preparation ("Finishing
   * startup": agent-runtime + search-tool staging) legitimately takes
   * 60–120 s on cold CI runners, and the loading screen's DOM is stable,
   * so the render-settle heuristic alone returns early. Generous on
   * purpose: this is a WAIT for real product behavior, not a benchmark. */
  shellReadyTimeoutMs: 180_000,
  shellReadyPollMs: 3_000,
});

/** Checks whose failure is EXPECTED on the pre-UX-001/002 baseline artifact
 * (the published PlayLiquid-GameOS-3.14.3 release, built from main 4f88d746
 * — the honest pre-integration state). Used only to annotate the baseline
 * report; the raw pass/fail status is always the observed truth. Every id
 * listed here is a FROZEN-contract requirement (spec/ux/work-items.md) that
 * Workers A/B implement; after A+B integration (TL rebases this branch) the
 * same checks must pass without this annotation:
 * - identity/workbench: the 3.14.3 escape hatch still carries the inherited
 *   `ZCode workbench` label and ZCode text in the top bar (frozen new label:
 *   `AI & Agents`, testid gameos-nav-workbench);
 * - geometry: `gameos-shell-brand` does not exist on 3.14.3 and the known
 *   defect (release evidence ubuntu-20261015-061743) is real — Game
 *   Studio/Lab overflow off-screen at the 480px minimum window;
 * - a11y: the 3.14.3 chrome has no visible focus styles and its surfaces
 *   skip heading levels (h1 → h3 panels);
 * - first-run: the frozen empty-state vocabulary (gameos-empty-state +
 *   gameos-empty-next-step) is not implemented yet (Worker B).
 */
export const BASELINE_EXPECTED_FAILURES = Object.freeze([
  "no-zcode-primary-branding",
  "workbench-escape-hatch-label",
  "geometry-1280x800",
  "geometry-480-window",
  "geometry-390x844-emulated",
  "a11y-visible-focus",
  "a11y-heading-hierarchy",
  "gameos-empty-state-contract",
]);

export function usage() {
  return [
    "usage: node qa/desktop-release/scripts/run-smoke.mjs --artifact <AppImage|executable>",
    "  [--deb <file.deb>] [--sums <SHA256SUMS>] [--out <dir>] [--cdp-port <n>]",
    "  [--display <:89>] [--expected-title <string>] [--baseline-expectations]",
    "  [--skip-offline] [--help]",
    "",
    "Environment alternatives: QA_RELEASE_ARTIFACT, QA_RELEASE_DEB, QA_RELEASE_SUMS.",
    "--baseline-expectations annotates (does not hide) the expected pre-integration",
    "failures and excludes ONLY those from the exit-code calculation.",
  ].join("\n");
}

export function parseArgs(argv) {
  const out = {
    artifact: process.env.QA_RELEASE_ARTIFACT ?? null,
    deb: process.env.QA_RELEASE_DEB ?? null,
    sums: process.env.QA_RELEASE_SUMS ?? null,
    out: null,
    cdpPort: DEFAULTS.cdpPort,
    display: DEFAULTS.display,
    expectedTitle: null,
    baselineExpectations: false,
    skipOffline: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--artifact":
        out.artifact = next();
        break;
      case "--deb":
        out.deb = next();
        break;
      case "--sums":
        out.sums = next();
        break;
      case "--out":
        out.out = next();
        break;
      case "--cdp-port":
        out.cdpPort = Number.parseInt(next(), 10);
        break;
      case "--display":
        out.display = next();
        break;
      case "--expected-title":
        out.expectedTitle = next();
        break;
      case "--baseline-expectations":
        out.baselineExpectations = true;
        break;
      case "--skip-offline":
        out.skipOffline = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!out.help && !out.artifact) {
    throw new Error("no artifact given: pass --artifact <path> or set QA_RELEASE_ARTIFACT");
  }
  if (!out.help && out.artifact) {
    // The launcher spawns the app from a NEUTRAL cwd (the clean-profile
    // home, like a real desktop user), so relative --artifact/--deb/--sums/
    // --out paths would not resolve at spawn time (observed live: release
    // run 38673153333, spawn ENOENT on a relative release-out/... path).
    // Resolve every path ONCE, here, before any consumer sees it.
    out.artifact = resolve(out.artifact);
    if (!out.sums) {
      // Auto-detect a sibling SHA256SUMS next to the artifact (convention of
      // the release workflow); absence is recorded, never fatal.
      out.sums = `${out.artifact.replace(/\/[^/]*$/, "")}/SHA256SUMS`;
    }
    out.deb = out.deb === null ? null : resolve(out.deb);
    out.sums = resolve(out.sums);
    out.out = out.out === null ? null : resolve(out.out);
  }
  return out;
}
