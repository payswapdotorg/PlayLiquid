/**
 * SHELL DESIGN-SYSTEM TESTS (UX-001): pins the product shell's visual
 * system — the WCAG AA contrast contract of every color pair the chrome
 * actually renders (computed here with the WCAG 2.x relative-luminance
 * formula, no external dependency), the visible focus ring, the
 * reduced-motion gate on the shell's only motion (color transitions), the
 * drag-region/no-drag carve-outs of the frameless bar, and the restraint of
 * the type/radius scales. Pure node --test module (PL-043 precedent: no
 * .tsx loading — the chrome components are covered by the source-level
 * inventory in shell-density.test.ts and by the UX-003 packaged harness).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHELL_BAR_HEIGHT,
  SHELL_CONTRAST_PAIRS,
  SHELL_CONTROL_HEIGHT,
  SHELL_FOCUS,
  SHELL_HOVER,
  SHELL_MOTION,
  SHELL_RADIUS,
  SHELL_SPACE,
  SHELL_TYPE,
  barStyle,
  brandClusterStyle,
  brandNameTextStyle,
  focusRingStyle,
  motionTransition,
  navButtonStyle,
  windowControlStyle,
  workbenchButtonStyle,
} from "./shell-tokens.ts";

/** sRGB channel → linear light (WCAG 2.x definition). */
function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  assert.match(hex, /^#[0-9a-fA-F]{6}$/);
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio of two #rrggbb colors. */
function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

test("every rendered shell color pair meets its WCAG AA minimum", () => {
  assert.ok(SHELL_CONTRAST_PAIRS.length >= 10, "the contrast contract is populated");
  for (const pair of SHELL_CONTRAST_PAIRS) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    assert.ok(
      ratio >= pair.minimum,
      `${pair.role}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1 < ${pair.minimum}:1`,
    );
    assert.ok(
      pair.minimum === 4.5 || pair.minimum === 3,
      `${pair.role}: minimum must be the AA text (4.5) or non-text (3) threshold`,
    );
  }
});

test("the focus ring is a visible accent outline on demand", () => {
  assert.equal(SHELL_FOCUS.width, 2);
  assert.equal(SHELL_FOCUS.offset, 2);
  const ring = focusRingStyle(true);
  assert.equal(ring.outline, `${SHELL_FOCUS.width}px solid ${SHELL_FOCUS.color}`);
  assert.equal(ring.outlineOffset, SHELL_FOCUS.offset);
  // The ring must itself pass the non-text contrast threshold on the bar.
  assert.ok(contrastRatio(SHELL_FOCUS.color, "#0d1524") >= 3);
  // Unfocused controls carry no outline (the ring appears on focus only).
  assert.deepEqual(focusRingStyle(false), { outline: "none" });
});

test("the shell's only motion is a quick color fade, disabled under reduced motion", () => {
  assert.equal(motionTransition(true), "none");
  const animated = motionTransition(false);
  assert.match(animated, /background-color/);
  assert.match(animated, /color/);
  assert.match(animated, /border-color/);
  assert.ok(!animated.includes("transform"), "no layout/transform motion in the shell");
  assert.ok(SHELL_MOTION.durationMs > 0 && SHELL_MOTION.durationMs <= 200, "restrained duration");
});

test("the bar is the drag region and every interactive control carves no-drag out", () => {
  for (const density of ["full", "compact", "minimal"] as const) {
    assert.equal(barStyle(density).WebkitAppRegion, "drag");
    assert.equal(barStyle(density).height, SHELL_BAR_HEIGHT);
    assert.equal(navButtonStyle(false, density).WebkitAppRegion, "no-drag");
    assert.equal(navButtonStyle(true, density).WebkitAppRegion, "no-drag");
    assert.equal(workbenchButtonStyle(density).WebkitAppRegion, "no-drag");
    assert.equal(windowControlStyle(density).WebkitAppRegion, "no-drag");
  }
});

test("interactive controls share one control height and never wrap", () => {
  for (const density of ["full", "compact", "minimal"] as const) {
    assert.equal(navButtonStyle(false, density).height, SHELL_CONTROL_HEIGHT);
    assert.equal(workbenchButtonStyle(density).height, SHELL_CONTROL_HEIGHT);
    assert.equal(windowControlStyle(density).height, SHELL_CONTROL_HEIGHT);
    assert.equal(navButtonStyle(false, density).whiteSpace, "nowrap");
    assert.equal(workbenchButtonStyle(density).whiteSpace, "nowrap");
  }
});

test("active and inactive navigation differ by surface treatment only", () => {
  const idle = navButtonStyle(false, "full");
  const active = navButtonStyle(true, "full");
  assert.equal(idle.color, "#8fa3bf");
  assert.equal(active.color, "#e2e8f0");
  assert.equal(active.background, "#16233b");
  assert.equal(active.boxShadow, 'inset 0 0 0 1px #31415f');
  assert.equal(idle.background, undefined);
  // The treatments keep AA in both states (contract pairs above pin the
  // exact colors; this asserts the styles actually USE them).
  assert.ok(contrastRatio(String(active.color), String(active.background)) >= 4.5);
  assert.ok(contrastRatio(String(idle.color), "#0d1524") >= 4.5);
});

test("the escape hatch reads as the quiet sibling of the navigation", () => {
  for (const density of ["full", "compact", "minimal"] as const) {
    const style = workbenchButtonStyle(density);
    assert.equal(style.background, "#111a2c");
    assert.ok(String(style.border).includes("#22304a"));
    assert.ok(contrastRatio(String(style.color), String(style.background)) >= 4.5);
  }
});

test("the brand degrades gracefully before anything else can be pushed out", () => {
  const cluster = brandClusterStyle("compact");
  assert.equal(cluster.flex, "0 1 auto");
  assert.equal(cluster.minWidth, 0);
  const name = brandNameTextStyle();
  assert.equal(name.whiteSpace, "nowrap");
  assert.equal(name.overflow, "hidden");
  assert.equal(name.textOverflow, "ellipsis");
});

test("the type scale is small, quiet and readable", () => {
  assert.equal(SHELL_TYPE.barName.fontSize, 13);
  assert.ok(SHELL_TYPE.navLabel.fontSize >= 12 && SHELL_TYPE.navLabel.fontSize <= 13);
  assert.ok(SHELL_TYPE.escapeLabel.fontSize >= 12 && SHELL_TYPE.escapeLabel.fontSize <= 13);
  assert.ok(SHELL_TYPE.startupName.fontSize > SHELL_TYPE.barName.fontSize);
  assert.ok(SHELL_TYPE.diagnostics.fontSize >= 12);
});

test("spacing and radius scales are small integers (4px-base discipline)", () => {
  for (const value of Object.values(SHELL_SPACE)) {
    assert.ok(Number.isInteger(value) && value > 0 && value <= 24);
  }
  for (const value of Object.values(SHELL_RADIUS)) {
    assert.ok(Number.isInteger(value) && value >= 4 && value <= 12);
  }
});

test("hover treatments stay inside the contrast contract", () => {
  assert.equal(SHELL_HOVER.navIdle.background, "#17233a");
  assert.ok(contrastRatio(String(SHELL_HOVER.navIdle.color), String(SHELL_HOVER.navIdle.background)) >= 4.5);
  assert.ok(
    contrastRatio(String(SHELL_HOVER.controlClose.color), String(SHELL_HOVER.controlClose.background)) >= 3,
  );
});

test("the density metrics drive the styles (single source of geometry)", () => {
  // The style factories must consume the shared metrics — the same numbers
  // the width budgets are computed from (see shell-density.test.ts).
  assert.equal(windowControlStyle("minimal").width, 30);
  assert.equal(windowControlStyle("compact").width, 36);
  assert.ok(navButtonStyle(false, "minimal").padding === "0 8px");
});
