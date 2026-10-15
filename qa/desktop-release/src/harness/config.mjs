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
});

/** Checks whose failure is EXPECTED on the current (pre-A/B integration)
 * main artifact. Used only to annotate the baseline report; the raw pass/fail
 * status is always the observed truth. */
export const BASELINE_EXPECTED_FAILURES = Object.freeze([
  "product-identity-title",
  "no-zcode-primary-branding",
  "product-shell-renders",
  "studio-surface",
  "lab-surface",
  "community-surface",
  "product-navigation",
  "studio-real-operation",
  "first-run-empty-state",
  "packaging-identity",
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
