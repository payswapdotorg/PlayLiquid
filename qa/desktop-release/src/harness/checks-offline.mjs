/**
 * RW-003 harness — offline / unavailable-service scenario.
 *
 * A second packaged launch with a dead proxy (`--proxy-server=http://127.0.0.1:9`,
 * a standard Chromium switch) makes every renderer-side network egress fail
 * immediately. The honest pass criteria (window level, no app cooperation):
 * the packaged app still starts, renders a real UI (not blank), stays alive
 * and responsive for the whole observation window, and does not crash —
 * i.e. an unavailable service degrades visibly instead of breaking the app.
 * Observed error text / console errors are recorded as evidence.
 */
import path from "node:path";
import { markerProbe } from "./checks.mjs";
import { saveScreenshot } from "./report.mjs";
import { sleep } from "./memwatch.mjs";

export async function offlineScenario(options) {
  const { report, cdp, outDir, observeMs, pidAlive, log } = options;
  const started = Date.now();
  const probe = await markerProbe(cdp);
  // A real rendered UI: complete DOM + meaningful text + at least one heading
  // or header (the honest bar for "renders", matching the product's own
  // first-run welcome text length ~118 chars).
  const rendered =
    probe && probe.textLength >= 50 && probe.h1s.length + probe.headerText.length > 0 && !probe.__error;
  report.check(
    "error-handling-offline-render",
    "packaged app renders its UI with all renderer network egress failing (dead proxy)",
    rendered ? "pass" : "fail",
    rendered
      ? `window rendered under a dead proxy: title=${JSON.stringify(probe.title)}, primary content ${JSON.stringify(probe.h1s.slice(0, 3))}`
      : `window did not render a real UI under the dead proxy: ${JSON.stringify(probe)}`,
    [`observed text head: ${JSON.stringify(probe?.textHead ?? null)}`],
  );
  const shot = saveScreenshot(
    path.join(outDir, "screenshots", "offline-dead-proxy-window.png"),
    (await cdp.screenshot()).data,
  );
  let alive = true;
  let responsive = true;
  const samples = [];
  const deadline = Date.now() + observeMs;
  while (Date.now() < deadline) {
    await sleep(5000);
    alive = await pidAlive();
    if (!alive) break;
    const ping = await cdp
      .evaluateValue(`({t: Date.now(), nodes: document.querySelectorAll("*").length})`)
      .catch(() => null);
    responsive = ping != null && !ping.__error;
    samples.push({ secondsIn: Math.round((Date.now() - started) / 1000), alive, responsive });
    if (!responsive) break;
  }
  report.check(
    "error-handling-offline-stability",
    "app stays alive and responsive while its services are unavailable",
    alive && responsive ? "pass" : "fail",
    `observed for ${Math.round((Date.now() - started) / 1000)}s after render: process alive=${alive}, renderer responsive=${responsive}`,
    [
      `stability samples: ${JSON.stringify(samples)}`,
      `screenshot: ${path.basename(shot.file)} (${shot.width}x${shot.height}, ${shot.bytes} bytes)`,
    ],
  );
  log(`offline scenario: alive=${alive} responsive=${responsive}`);
  return { alive, responsive, probe };
}
