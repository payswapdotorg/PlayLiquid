/**
 * UX-003 harness — JOURNEY smoke through the production-wired ports.
 *
 * Extends the studio-real-operation pattern to the other two workspaces with
 * REAL no-side-effect operations (the read-model refresh controls), and
 * asserts the honest-outcome discipline (E8/E10) on representative typed
 * commands:
 *
 * - lab-real-operation / community-real-operation: navigate via the frozen
 *   nav markers and pull one authoritative read-model snapshot through the
 *   module's production-wired data port (no E11 load-failure banner).
 * - lab-command-outcome-visible: dispatch the Lab request-search typed
 *   intent through its REAL control and verify the append-only command log
 *   renders its typed outcome (accepted or a typed refusal) — a silent or
 *   missing outcome is a failure (fake success is not tolerated).
 * - community-lifecycle-honest-gate: workflow (maintainer) operations are
 *   unavailable on a first-run system (no contribution selected) — the
 *   surface must either render an honest limitation state (no dead controls,
 *   visible guidance) or dispatch the intent and render its typed refusal;
 *   fake maintainer powers or a silent surface fail.
 */
import { PRODUCT_MARKERS, SHELL_MARKERS } from "./config.mjs";
import { bodyText, clickByText } from "./checks.mjs";
import { sleep } from "./memwatch.mjs";

/** Navigate through the frozen nav marker and verify the surface rendered. */
async function navigateToSurface(page, testid, headingText) {
  const clicked = await page.evaluateValue(`(() => {
    const el = document.querySelector('[data-testid="${testid}"]');
    if (!el) return { found: false };
    el.click();
    return { found: true, label: (el.textContent ?? "").trim() };
  })()`);
  await sleep(1400);
  const heading = await page.evaluateValue(`(() => {
    const match = [...document.querySelectorAll("h1")].find((el) => (el.textContent ?? "").trim() === ${JSON.stringify(headingText)});
    if (!match) return { found: false };
    const r = match.getBoundingClientRect();
    const cs = getComputedStyle(match);
    return { found: true, visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0 };
  })()`);
  return { clicked, heading };
}

/** The read-model refresh real operation on one workspace surface. */
async function refreshOperationCheck(report, page, spec) {
  const target = await navigateToSurface(page, spec.navTestid, spec.headingText);
  if (!target.clicked.found || !target.heading?.visible) {
    report.check(
      spec.id,
      spec.title,
      "fail",
      `cannot reach the ${spec.name} surface (nav found=${target.clicked.found}, heading visible=${Boolean(target.heading?.visible)}) — the real operation cannot run`,
    );
    return;
  }
  const clicked = await clickByText(page, spec.refreshLabel);
  if (!clicked?.found) {
    report.check(
      spec.id,
      spec.title,
      "fail",
      `the ${JSON.stringify(spec.refreshLabel)} control is not rendered on the ${spec.name} surface (${clicked?.controls ?? 0} controls scanned)`,
    );
    return;
  }
  await sleep(2500);
  const after = await bodyText(page);
  const bannerIndex = after.indexOf(spec.errorPrefix);
  if (bannerIndex !== -1) {
    report.check(
      spec.id,
      spec.title,
      "fail",
      `the refresh operation surfaced the E11 load-failure banner: ${JSON.stringify(after.slice(bannerIndex, bannerIndex + 160))}`,
      [`click result: ${JSON.stringify(clicked)}`],
    );
    return;
  }
  report.check(
    spec.id,
    spec.title,
    "pass",
    `clicked ${JSON.stringify(spec.refreshLabel)} on the ${spec.name} surface; no ${spec.name} E11 load-failure banner appeared — the authoritative read-model pull completed through the production-wired data port`,
    [
      `nav control label: ${JSON.stringify(target.clicked.label)} [${spec.navTestid}]`,
      `click result: ${JSON.stringify(clicked)}`,
      `surface summary after refresh: ${JSON.stringify(after.split("\n").slice(0, 4))}`,
    ],
  );
}

/** Journey battery. */
export async function journeyChecks(report, page) {
  await refreshOperationCheck(report, page, {
    id: "lab-real-operation",
    title: "Lab journey: a representative REAL operation (read-model refresh) reaches its authoritative module through the production-wired port",
    name: "Lab",
    navTestid: SHELL_MARKERS.navLab,
    headingText: PRODUCT_MARKERS.labHeading,
    refreshLabel: PRODUCT_MARKERS.labRefresh,
    errorPrefix: PRODUCT_MARKERS.labLoadErrorPrefix,
  });
  await refreshOperationCheck(report, page, {
    id: "community-real-operation",
    title: "Community journey: a representative REAL operation (read-model refresh) reaches its authoritative module through the production-wired port",
    name: "Community",
    navTestid: SHELL_MARKERS.navCommunity,
    headingText: PRODUCT_MARKERS.communityHeading,
    refreshLabel: PRODUCT_MARKERS.communityRefresh,
    errorPrefix: PRODUCT_MARKERS.communityLoadErrorPrefix,
  });

  // --- Lab typed-command outcome (never silent) -------------------------
  // The Lab surface must be ACTIVE (kept-mounted surfaces are display:none).
  await navigateToSurface(page, SHELL_MARKERS.navLab, PRODUCT_MARKERS.labHeading);
  const searchControl = await page.evaluateValue(`(() => {
    const buttons = [...document.querySelectorAll("button")].filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && r.width > 0 && r.height > 0 && /request.{0,12}search/i.test((el.textContent ?? "").trim());
    });
    if (buttons.length === 0) return { found: false, scanned: document.querySelectorAll("button").length };
    return { found: true, label: (buttons[0].textContent ?? "").trim().slice(0, 80) };
  })()`);
  if (!searchControl?.found) {
    report.check(
      "lab-command-outcome-visible",
      "Lab typed command: dispatching a real command intent renders its typed outcome in the append-only command log (never silent, never fake success)",
      "fail",
      `no request-search control is rendered on the Lab surface (${searchControl?.scanned ?? 0} buttons scanned) — the Lab journey has no exercisable real operation`,
    );
  } else {
    await page.evaluateValue(`(() => {
      const buttons = [...document.querySelectorAll("button")].filter((el) => /request.{0,12}search/i.test((el.textContent ?? "").trim()));
      buttons[0].click();
      return true;
    })()`);
    await sleep(2000);
    const log = await page.evaluateValue(`(() => {
      const sections = [...document.querySelectorAll("section")];
      const log = sections.find((section) => ((section.textContent ?? "").includes("Command log")));
      if (!log) return { found: false };
      const rows = [...log.querySelectorAll("tbody tr")].map((tr) =>
        [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()),
      );
      return { found: true, rows };
    })()`);
    const searchRows = (log?.rows ?? []).filter((row) => row[0]?.includes("request-search"));
    const outcomeVisible = searchRows.some((row) => row[2] && row[2].length > 0 && row[3] && row[3].length > 0);
    report.check(
      "lab-command-outcome-visible",
      "Lab typed command: dispatching a real command intent renders its typed outcome in the append-only command log (never silent, never fake success)",
      outcomeVisible ? "pass" : "fail",
      outcomeVisible
        ? `the request-search intent dispatched through its real control and the command log renders its typed outcome (${JSON.stringify(searchRows.map((row) => `${row[2]} / ${row[3]}`))}) — both an accepted receipt and a typed refusal are honest outcomes; silence is not`
        : `the dispatched request-search intent produced NO typed outcome in the command log (log found=${log?.found}, rows=${JSON.stringify((log?.rows ?? []).slice(0, 3))}) — a silent or missing outcome is fake success`,
      [
        `control clicked: ${JSON.stringify(searchControl.label)}`,
        `command log rows: ${JSON.stringify((log?.rows ?? []).slice(0, 5))}`,
      ],
    );
  }

  // --- Community lifecycle honest gate (unavailable operation) -----------
  await navigateToSurface(page, SHELL_MARKERS.navCommunity, PRODUCT_MARKERS.communityHeading);
  await clickByText(page, "Lifecycle");
  await sleep(1400);
  const gate = await page.evaluateValue(`(() => {
    const sections = [...document.querySelectorAll("section")];
    const panel = sections.find((section) => /lifecycle/i.test(section.querySelector("h3")?.textContent ?? ""));
    if (!panel) return { found: false };
    const visible = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const advanceButtons = [...panel.querySelectorAll("button")].filter((el) => /triage|review/i.test((el.textContent ?? "").trim()));
    const guidance = [...panel.querySelectorAll("p")].filter(visible).find((el) => (el.textContent ?? "").trim().length >= 20);
    return {
      found: true,
      advanceControls: advanceButtons.map((el) => ({ label: (el.textContent ?? "").trim(), disabled: el.disabled })),
      guidance: guidance ? (guidance.textContent ?? "").trim().slice(0, 140) : null,
      hasKnownMarker: (panel.textContent ?? "").includes("select a contribution"),
    };
  })()`);
  if (!gate?.found) {
    report.check(
      "community-lifecycle-honest-gate",
      "Community lifecycle: the unavailable maintainer workflow renders a truthful limitation state (no fake powers, no dead surface)",
      "fail",
      "the Community lifecycle surface did not render (no panel titled Lifecycle)",
    );
  } else if ((gate.advanceControls ?? []).length === 0) {
    // No advance controls rendered: an honest limitation state must be visible.
    const honest = typeof gate.guidance === "string" && gate.guidance.length >= 20;
    report.check(
      "community-lifecycle-honest-gate",
      "Community lifecycle: the unavailable maintainer workflow renders a truthful limitation state (no fake powers, no dead surface)",
      honest ? "pass" : "fail",
      honest
        ? `no maintainer advance controls are rendered without a selected contribution and the surface explains why: ${JSON.stringify(gate.guidance)}`
        : "no maintainer advance controls are rendered without a selected contribution AND no visible guidance explains the limitation — a dead surface",
      [`known first-run marker "select a contribution" observed: ${gate.hasKnownMarker}`],
    );
  } else {
    // Advance controls ARE rendered without a selection: dispatch one and
    // require a typed, visible outcome (a typed refusal is honest; silence is not).
    const triage = gate.advanceControls.find((entry) => /triage/i.test(entry.label));
    if (triage) {
      await page.evaluateValue(`(() => {
        const sections = [...document.querySelectorAll("section")];
        const panel = sections.find((section) => /lifecycle/i.test(section.querySelector("h3")?.textContent ?? ""));
        const button = [...(panel?.querySelectorAll("button") ?? [])].find((el) => /triage/i.test((el.textContent ?? "").trim()));
        button?.click();
        return Boolean(button);
      })()`);
      await sleep(1800);
      const log = await page.evaluateValue(`(() => {
        const sections = [...document.querySelectorAll("section")];
        const log = sections.find((section) => (section.textContent ?? "").includes("Command log"));
        if (!log) return { found: false };
        return { found: true, rows: [...log.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())) };
      })()`);
      const advanceRows = (log?.rows ?? []).filter((row) => row[0]?.includes("advance-contribution"));
      const outcomeVisible = advanceRows.some((row) => row[2] && row[3]);
      report.check(
        "community-lifecycle-honest-gate",
        "Community lifecycle: the unavailable maintainer workflow renders a truthful limitation state (no fake powers, no dead surface)",
        outcomeVisible ? "pass" : "fail",
        outcomeVisible
          ? `maintainer controls are rendered without a selection and dispatching one renders its typed outcome (${JSON.stringify(advanceRows.map((row) => `${row[2]} / ${row[3]}`))}) — an honest typed refusal, not fake success`
          : `maintainer controls are rendered without a selection but dispatching one produced NO typed outcome in the command log (${JSON.stringify((log?.rows ?? []).slice(0, 3))})`,
        [`guidance observed: ${JSON.stringify(gate.guidance)}`],
      );
    } else {
      report.check(
        "community-lifecycle-honest-gate",
        "Community lifecycle: the unavailable maintainer workflow renders a truthful limitation state (no fake powers, no dead surface)",
        "fail",
        `unexpected lifecycle controls rendered without a selection: ${JSON.stringify(gate.advanceControls)}`,
      );
    }
  }

  await page.evaluateValue(`(() => {
    const el = document.querySelector('[data-testid="${SHELL_MARKERS.navStudio}"]');
    el?.click();
    return true;
  })()`);
  await sleep(800);
}
