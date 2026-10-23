/**
 * RESPONSIVE SHELL TESTS (UX-001): pins the top-bar density ladder and its
 * WIDTH ARITHMETIC — the core defect fix. At the 480px minimum OS window
 * and at the 390px emulated viewport every navigation control must stay
 * reachable; since the station cannot build the production renderer
 * (documented RW-001 environment limitation — the vite production bundle
 * OOMs at 3.9GB RAM), the geometry is proven here the honest way the Work
 * Order prescribes: each density's conservative width budget (computed
 * from the very metrics the styles render with, over-estimating glyphs at
 * 0.62em/char to cover Inter AND the wider Linux fallback fonts) must fit
 * its narrowest served viewport with headroom. Real window geometry is
 * additionally enforced by the UX-003 packaged harness at integration.
 *
 * Also pins: the frozen workspace/agent-workspace vocabulary, the 480px
 * floor mirrored from the main process (read from its source — the two can
 * never silently drift), the viewport/reduced-motion environment queries,
 * and a source-level inventory of the frozen marker vocabulary.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONSERVATIVE_CHAR_WIDTH_EM,
  FULL_BAR_BREAKPOINT,
  MIN_EMULATED_VIEWPORT_WIDTH,
  MIN_WINDOW_WIDTH_FLOOR,
  REDUCED_MOTION_QUERY,
  SHELL_DENSITY_METRICS,
  SHELL_VIEWPORT_FALLBACK,
  barDensityForViewport,
  barWidthBudget,
  brandTextForDensity,
  prefersReducedMotion,
  subscribeReducedMotion,
  subscribeViewportWidth,
  viewportWidth,
  workbenchLabelForDensity,
} from "./shell-density.ts";
import { SHELL_WORKSPACES } from "./shell-workspaces.ts";
import { PRODUCT_NAME, PRODUCT_WORDMARK, WORKBENCH_NAV_LABEL } from "../identity.ts";

test("the density ladder maps every viewport width to a density", () => {
  for (const width of [1280, 1200, 1000, 900, FULL_BAR_BREAKPOINT]) {
    assert.equal(barDensityForViewport(width), "full", `${width}px should render full`);
  }
  for (const width of [FULL_BAR_BREAKPOINT - 1, 800, 700, 600, 500, MIN_WINDOW_WIDTH_FLOOR]) {
    assert.equal(barDensityForViewport(width), "compact", `${width}px should render compact`);
  }
  for (const width of [MIN_WINDOW_WIDTH_FLOOR - 1, 479, MIN_EMULATED_VIEWPORT_WIDTH, 320, 0]) {
    assert.equal(barDensityForViewport(width), "minimal", `${width}px should render minimal`);
  }
  // Degenerate inputs get the SAFEST (narrowest) ladder, never a crash.
  assert.equal(barDensityForViewport(Number.NaN), "minimal");
  assert.equal(barDensityForViewport(-1), "minimal");
});

test("the 480px window floor mirrors the main-process minimum window width", () => {
  assert.equal(MIN_WINDOW_WIDTH_FLOOR, 480);
  const mainSource = readFileSync(
    new URL("../../../../main/desktopWindowSize.ts", import.meta.url),
    "utf8",
  );
  const declared = /MIN_DESKTOP_WINDOW_WIDTH\s*=\s*(\d+)/.exec(mainSource);
  assert.ok(declared, "the main process still declares MIN_DESKTOP_WINDOW_WIDTH");
  assert.equal(
    Number.parseInt(declared![1]!, 10),
    MIN_WINDOW_WIDTH_FLOOR,
    "the renderer floor and the OS-enforced minimum window width must not drift",
  );
  assert.equal(MIN_EMULATED_VIEWPORT_WIDTH, 390, "the UX contract's emulated viewport");
});

test("THE GEOMETRY CONTRACT: each density's conservative budget fits its narrowest served width", () => {
  const full = barWidthBudget("full");
  const compact = barWidthBudget("compact");
  const minimal = barWidthBudget("minimal");
  // The baseline defect, fixed by arithmetic: at 480px the full-density bar
  // (labels + wordmark-free single row of the pre-UX-001 shell) overflowed
  // the window; the ladder now serves it compact, and the compact budget
  // fits with headroom.
  assert.ok(full <= FULL_BAR_BREAKPOINT, `full ${full}px must fit ${FULL_BAR_BREAKPOINT}px`);
  assert.ok(
    compact <= MIN_WINDOW_WIDTH_FLOOR,
    `compact ${compact}px must fit the ${MIN_WINDOW_WIDTH_FLOOR}px minimum window`,
  );
  assert.ok(
    minimal <= MIN_EMULATED_VIEWPORT_WIDTH,
    `minimal ${minimal}px must fit the ${MIN_EMULATED_VIEWPORT_WIDTH}px emulated viewport`,
  );
  assert.ok(full > compact && compact > minimal, "densities narrow monotonically");
  // The conservative char-width factor must stay generous (it exists to
  // cover the wider Linux fallback fonts, not just Inter).
  assert.ok(CONSERVATIVE_CHAR_WIDTH_EM >= 0.6);
});

test("the density metrics stay 4px-disciplined and the ladder is monotone", () => {
  for (const metrics of Object.values(SHELL_DENSITY_METRICS)) {
    for (const value of Object.values(metrics)) {
      assert.ok(Number.isInteger(value) && value >= 2 && value <= 40);
    }
  }
  assert.ok(
    SHELL_DENSITY_METRICS.full.controlWidth >= SHELL_DENSITY_METRICS.minimal.controlWidth,
  );
  assert.ok(SHELL_DENSITY_METRICS.full.navPadX >= SHELL_DENSITY_METRICS.minimal.navPadX);
});

test("the workspace navigation vocabulary is frozen", () => {
  assert.deepEqual(
    SHELL_WORKSPACES.map((workspace) => [workspace.id, workspace.label]),
    [
      ["studio", "Game Studio"],
      ["lab", "Lab"],
      ["community", "Community"],
    ],
  );
  for (const workspace of SHELL_WORKSPACES) {
    assert.ok(workspace.hint.length > 0, `${workspace.id} carries an honest hint`);
    assert.ok(workspace.hint === workspace.hint.trim());
  }
});

test("the brand and escape-hatch vocabulary degrade predictably with density", () => {
  assert.equal(brandTextForDensity("full"), PRODUCT_NAME);
  assert.equal(brandTextForDensity("compact"), PRODUCT_WORDMARK);
  assert.equal(brandTextForDensity("minimal"), PRODUCT_WORDMARK);
  assert.equal(
    WORKBENCH_NAV_LABEL,
    "AI & Agents",
    "the frozen UX-001 escape-hatch label (exact string)",
  );
  assert.equal(workbenchLabelForDensity("full"), WORKBENCH_NAV_LABEL);
  assert.equal(workbenchLabelForDensity("compact"), undefined);
  assert.equal(workbenchLabelForDensity("minimal"), undefined);
  assert.ok(
    PRODUCT_NAME.startsWith(PRODUCT_WORDMARK),
    "the wordmark stays the product's own first word",
  );
});

test("viewportWidth and prefersReducedMotion degrade honestly without a window", () => {
  const hadWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  delete (globalThis as typeof globalThis & { window?: unknown }).window;
  try {
    assert.equal(viewportWidth(), SHELL_VIEWPORT_FALLBACK);
    assert.equal(prefersReducedMotion(), false);
    assert.doesNotThrow(() => {
      const unsubscribe = subscribeViewportWidth(() => {});
      unsubscribe();
      const unsubscribeMotion = subscribeReducedMotion(() => {});
      unsubscribeMotion();
    });
  } finally {
    if (hadWindow !== undefined) {
      (globalThis as typeof globalThis & { window?: unknown }).window = hadWindow;
    }
  }
});

test("viewportWidth reads the live renderer viewport", () => {
  const scope = globalThis as typeof globalThis & { window?: unknown };
  const hadWindow = scope.window;
  try {
    scope.window = { innerWidth: 390 };
    assert.equal(viewportWidth(), 390);
    scope.window = { innerWidth: 1280 };
    assert.equal(viewportWidth(), 1280);
  } finally {
    if (hadWindow === undefined) {
      delete scope.window;
    } else {
      scope.window = hadWindow;
    }
  }
});

test("prefersReducedMotion reads the frozen media query", () => {
  assert.equal(REDUCED_MOTION_QUERY, "(prefers-reduced-motion: reduce)");
  const scope = globalThis as typeof globalThis & { window?: unknown };
  const hadWindow = scope.window;
  let lastQuery: string | undefined;
  try {
    scope.window = {
      matchMedia: (query: string) => {
        lastQuery = query;
        return { matches: true, addEventListener: () => {}, removeEventListener: () => {} };
      },
    };
    assert.equal(prefersReducedMotion(), true);
    assert.equal(lastQuery, REDUCED_MOTION_QUERY);
  } finally {
    if (hadWindow === undefined) {
      delete scope.window;
    } else {
      scope.window = hadWindow;
    }
  }
});

test("SOURCE INVENTORY: the frozen marker vocabulary is present in the shell sources", () => {
  const read = (name: string): string =>
    readFileSync(new URL(name, import.meta.url), "utf8");
  const chrome = read("./shell-chrome.tsx");
  const product = read("./product-shell.tsx");
  const sources = `${chrome}\n${product}`;
  for (const marker of [
    "gameos-shell-bar",
    "gameos-shell-brand",
    "gameos-nav-workbench",
    "gameos-workspace-host",
    "gameos-compose-failed",
  ]) {
    assert.ok(sources.includes(marker), `${marker} must be rendered by the shell`);
  }
  // The three workspace markers come from the vocabulary + the template.
  assert.ok(chrome.includes("gameos-nav-${workspace.id}"), "nav markers derive from the vocabulary");
  assert.deepEqual(
    SHELL_WORKSPACES.map((workspace) => `gameos-nav-${workspace.id}`),
    ["gameos-nav-studio", "gameos-nav-lab", "gameos-nav-community"],
  );
  // Navigation truth preserved: aria-current marks the active workspace
  // (ShellButton forwards the prop to the native aria-current attribute).
  assert.ok(chrome.includes('ariaCurrent={active === workspace.id ? "page" : undefined}'));
  assert.ok(chrome.includes("aria-current={ariaCurrent}"));
  // The kept-mounted design preserved: HIDDEN display switching, no unmount.
  assert.ok(product.includes('display: "none"'));
  assert.ok(product.includes('active === "studio" ? undefined : HIDDEN'));
  // The escape hatch keeps its reachable behavior and honest vocabulary.
  assert.ok(chrome.includes("WORKBENCH_NAV_LABEL"));
  assert.ok(chrome.includes("WORKBENCH_NAV_HINT"));
  assert.ok(chrome.includes("onOpenWorkbench"));
});

test("SOURCE INVENTORY: the inherited fork workbench label is gone from the gameos tree", () => {
  // The frozen UX-001 vocabulary replaced the inherited label; the exact
  // inherited phrase must not survive anywhere in the gameos sources
  // (test files excluded — they are the ones asserting this absence).
  const inheritedLabel = "ZCode workbench";
  const gameosRoot = new URL("..", import.meta.url);
  const visited: string[] = [];
  const walk = (directory: URL): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}/`, directory);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!/\.(ts|tsx|mts)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) {
        continue;
      }
      const source = readFileSync(fileURLToPath(new URL(entry.name, directory)), "utf8");
      visited.push(entry.name);
      assert.ok(
        !source.includes(inheritedLabel),
        `${entry.name} still carries the inherited workbench label`,
      );
    }
  };
  walk(gameosRoot);
  assert.ok(visited.length >= 8, `the walk actually visited the tree (${visited.length} files)`);
});

test("the source-level brand identity stays PlayLiquid-first", () => {
  const identity = readFileSync(new URL("../identity.ts", import.meta.url), "utf8");
  assert.ok(identity.includes('"AI & Agents"'), "the frozen label is declared in identity.ts");
  assert.ok(identity.includes('"PlayLiquid"'));
  assert.ok(identity.includes('"The game engineering operating system"'));
});
