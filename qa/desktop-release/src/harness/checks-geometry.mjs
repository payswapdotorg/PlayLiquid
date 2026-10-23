/**
 * UX-003 harness — GEOMETRY enforcement at the three mandated widths.
 *
 * For every geometry (the real 1280x800 OS window, the ACTUAL 480px minimum
 * OS window — MIN_DESKTOP_WINDOW_WIDTH — and the 390x844 emulated viewport)
 * the product top bar is measured through computed bounding boxes (CDP
 * Runtime.evaluate on getBoundingClientRect):
 *
 * - every required bar element exists, is visible and has a non-zero box
 *   (brand, the three nav buttons, the workbench escape hatch, the window
 *   controls);
 * - no pairwise overlap between any two bar elements;
 * - no element is clipped by the viewport edges (fully inside the window);
 * - no horizontal overflow: documentElement.scrollWidth <= innerWidth AND
 *   the bar's own scrollWidth <= clientWidth (element-level check);
 * - interactive controls' labels are not internally truncated
 *   (scrollWidth <= clientWidth per control);
 * - the full navigation stays REACHABLE: nav buttons may be collapsed into
 *   the optional frozen `gameos-shell-overflow` control — when one is not
 *   directly visible, the overflow control must open it and the check
 *   re-measures the expanded state (compact/collapsed forms allowed by the
 *   frozen contract; unreachable navigation is not).
 *
 * DOM presence alone is NOT a pass: every geometry whose assertions fail
 * fails the run (annotated as the expected baseline failure on the
 * pre-UX-001/002 3.14.3 artifact via --baseline-expectations, never hidden).
 */
import path from "node:path";
import { SHELL_MARKERS, VIEWPORTS, WINDOW_MIN_WIDTH } from "./config.mjs";
import { saveScreenshot } from "./report.mjs";
import { sleep } from "./memwatch.mjs";
import {
  analyzeGeometry,
  barGeometryExpression,
  elementClipped,
  elementVisible,
} from "./geometry-metrics.mjs";

/** Click the frozen overflow control (if rendered) so collapsed navigation
 * becomes measurable — the frozen contract allows compact/collapsed forms. */
async function openOverflowIfPresent(page) {
  return page.evaluateValue(`(() => {
    const control = document.querySelector('[data-testid="${SHELL_MARKERS.shellOverflow}"]');
    if (!control) return { present: false };
    control.click();
    return { present: true, clicked: true, label: (control.textContent ?? "").trim().slice(0, 40) };
  })()`);
}

/** Resize the REAL OS window (Browser.setWindowBounds, window.resizeTo fallback). */
async function resizeOsWindow(browser, page, targetId, width, height) {
  const attempts = [];
  let outer = null;
  const readOuter = async () => {
    const value = await page.evaluateValue(`[window.outerWidth, window.outerHeight]`).catch(() => null);
    return Array.isArray(value) ? value : null;
  };
  try {
    const { windowId } = await browser.send("Browser.getWindowForTarget", targetId ? { targetId } : {});
    await browser.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal", left: 40, top: 40, width, height },
    });
    await sleep(900);
    outer = await readOuter();
    attempts.push(`Browser.setWindowBounds(${width}x${height}) -> outer ${JSON.stringify(outer)}`);
  } catch (error) {
    attempts.push(`Browser.setWindowBounds failed: ${String(error?.message ?? error).slice(0, 120)}`);
  }
  if (!Array.isArray(outer) || outer[0] !== width || outer[1] !== height) {
    await page.evaluate(`window.resizeTo(${width}, ${height})`).catch(() => undefined);
    await sleep(1000);
    outer = await readOuter();
    attempts.push(`window.resizeTo(${width}, ${height}) -> outer ${JSON.stringify(outer)}`);
  }
  return { outer, attempts };
}

/** Measure, analyze and report ONE geometry. `mode` describes how the width
 * was reached (real OS window vs CDP device-metrics emulation). */
async function checkGeometry(report, context, spec) {
  const { browser, page, targetId, outDir } = context;
  const shot = async (name) => {
    const png = await page.screenshot();
    return saveScreenshot(path.join(outDir, "screenshots", name), png.data);
  };
  let windowEvidence = [];
  if (spec.mode === "window") {
    const resized = await resizeOsWindow(browser, page, targetId, spec.width, spec.height);
    windowEvidence = resized.attempts;
    const [outerWidth] = resized.outer ?? [];
    if (outerWidth !== spec.width) {
      report.check(
        spec.id,
        spec.title,
        "fail",
        `the OS window could not be set to ${spec.width}px (outerWidth = ${outerWidth}) — geometry at this width cannot be asserted`,
        [...windowEvidence, "this is an environment/launcher failure, not a product pass"],
      );
      await shot(spec.screenshot).catch(() => undefined);
      return;
    }
  } else {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: spec.width,
      height: spec.height,
      deviceScaleFactor: 1,
      mobile: spec.width < WINDOW_MIN_WIDTH,
    });
    await sleep(800);
  }

  let measured = await page.evaluateValue(barGeometryExpression());
  if (measured?.__error || !Array.isArray(measured?.viewport)) {
    report.check(
      spec.id,
      spec.title,
      "fail",
      `the geometry probe failed in the renderer: ${JSON.stringify(measured).slice(0, 500)}`,
      [`mode: ${spec.mode}`, `requested: ${spec.width}x${spec.height}`],
    );
    if (spec.mode === "emulated") {
      await page.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
    }
    return;
  }
  let analysis = analyzeGeometry(measured);
  const navKeys = ["navStudio", "navLab", "navCommunity", "workbench"];
  const navDirectlyOk = navKeys.every((key) => {
    const entry = measured[key];
    return entry?.found && elementVisible(entry) && !elementClipped(entry, measured.viewport[0], measured.viewport[1]);
  });

  // Collapsed navigation is allowed ONLY through the frozen overflow control:
  // open it and re-measure (the expanded state is the reachable state).
  let overflowNote = "all required navigation directly visible in the bar";
  if (!navDirectlyOk) {
    const overflow = await openOverflowIfPresent(page);
    if (overflow?.present) {
      await sleep(900);
      const reopened = await page.evaluateValue(barGeometryExpression());
      if (reopened?.__error || !Array.isArray(reopened?.viewport)) {
        analysis.problems.push(`the re-measurement after opening the overflow control failed: ${JSON.stringify(reopened).slice(0, 300)}`);
      } else {
        const stillOk = navKeys.every((key) => {
          const entry = reopened[key];
          return entry?.found && elementVisible(entry) && !elementClipped(entry, reopened.viewport[0], reopened.viewport[1]);
        });
        if (stillOk) {
          overflowNote = `navigation collapsed behind [${SHELL_MARKERS.shellOverflow}] (label ${JSON.stringify(overflow.label)}) — expanded state measured (compact form allowed by the frozen contract)`;
        } else {
          overflowNote = `overflow control [${SHELL_MARKERS.shellOverflow}] present but the required navigation is STILL not visible/unclipped after opening it`;
        }
        measured = reopened;
        analysis = analyzeGeometry(measured);
        if (!stillOk) analysis.problems.push(overflowNote);
      }
    } else {
      overflowNote =
        `required navigation is not directly visible/unclipped in the bar and no overflow control [${SHELL_MARKERS.shellOverflow}] is rendered — the navigation is unreachable at this width`;
      analysis.problems.push(overflowNote);
    }
  }

  let shotError = null;
  const shotInfo = await shot(spec.screenshot).catch((error) => {
    shotError = String(error?.message ?? error).slice(0, 300);
    return null;
  });
  if (spec.mode === "emulated") {
    await page.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
    await sleep(400);
  }

  const evidence = [
    `mode: ${spec.mode === "window" ? "real OS window" : "CDP device-metrics emulation (the DevTools device-mode equivalent)"}`,
    ...windowEvidence,
    `measured viewport: ${JSON.stringify(measured.viewport)}`,
    overflowNote,
    ...analysis.evidence,
  ];
  if (shotInfo) {
    evidence.push(`screenshot: ${path.basename(shotInfo.file)} (${shotInfo.width}x${shotInfo.height}, ${shotInfo.bytes} bytes)`);
  } else {
    evidence.push(`screenshot FAILED: ${shotError}`);
  }
  report.check(
    spec.id,
    spec.title,
    analysis.problems.length === 0 ? "pass" : "fail",
    analysis.problems.length === 0
      ? `all bar elements present, visible, non-overlapping, unclipped and reachable at ${spec.width}x${spec.height}`
      : `${analysis.problems.length} geometry violation(s) at ${spec.width}x${spec.height}: ${analysis.problems.join("; ")}`,
    evidence,
  );
}

/**
 * The geometry battery: 1280x800 (real window), the actual 480px minimum OS
 * window, and the 390x844 emulated viewport. Leaves the window restored at
 * 1280x800 so later checks run at a sane size.
 */
export async function geometryChecks(report, context) {
  const specs = [
    {
      id: "geometry-1280x800",
      title: "top-bar geometry at 1280x800 (real OS window): no overlap, no clipping, no horizontal overflow, all navigation reachable",
      mode: "window",
      width: VIEWPORTS.desktop.width,
      height: VIEWPORTS.desktop.height,
      screenshot: "geometry-1280x800.png",
    },
    {
      id: "geometry-480-window",
      title: `top-bar geometry at the actual ${WINDOW_MIN_WIDTH}px minimum OS window: no overlap, no clipping, no horizontal overflow, all navigation reachable`,
      mode: "window",
      width: WINDOW_MIN_WIDTH,
      height: 720,
      screenshot: "geometry-480px-window.png",
    },
    {
      id: "geometry-390x844-emulated",
      title: "top-bar geometry at the 390x844 emulated viewport: no overlap, no clipping, no horizontal overflow, all navigation reachable",
      mode: "emulated",
      width: VIEWPORTS.mobile.width,
      height: VIEWPORTS.mobile.height,
      screenshot: "geometry-390x844-emulated.png",
    },
  ];
  for (const spec of specs) {
    try {
      await checkGeometry(report, context, spec);
    } catch (error) {
      report.check(
        spec.id,
        spec.title,
        "fail",
        `geometry check could not run: ${String(error?.message ?? error)}`,
      );
    }
  }
  // Restore a sane window for the checks that follow.
  await resizeOsWindow(context.browser, context.page, context.targetId, VIEWPORTS.desktop.width, VIEWPORTS.desktop.height).catch(
    () => undefined,
  );
}
