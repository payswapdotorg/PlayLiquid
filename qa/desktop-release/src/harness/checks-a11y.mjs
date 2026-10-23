/**
 * UX-003 harness — ACCESSIBILITY checks on the packaged product shell.
 *
 * All interaction is driven the way a keyboard user does it: CDP
 * Input.dispatchKeyEvent (Tab / Enter / Space) — never synthetic el.click()
 * for the paths under test.
 *
 * - a11y-keyboard-navigation: Tab reaches the bar navigation (Game Studio →
 *   Lab → Community → the AI & Agents escape hatch) in a sensible order
 *   (DOM order; the brand cluster comes first when it is focusable), and
 *   Enter/Space actually ACTIVATE a nav button (surface switches,
 *   aria-current="page" moves).
 * - a11y-visible-focus: the keyboard-focused bar control shows a visible
 *   focus indicator (computed outline, box-shadow, or a focused-vs-blurred
 *   style change — however the shell draws it).
 * - a11y-accessible-names: every visible interactive element (bar + active
 *   surface) has an accessible name (aria-label / aria-labelledby / text /
 *   title).
 * - a11y-heading-hierarchy: every surface has exactly its h1 as the first
 *   visible heading and visible heading levels never skip.
 *
 * DOM presence alone is NOT a pass. Pre-UX-001 failures are annotated as
 * expected baseline failures (--baseline-expectations), never hidden.
 */
import { PRODUCT_MARKERS, SHELL_MARKERS } from "./config.mjs";
import { sleep } from "./memwatch.mjs";

const NAV_TESTIDS = [SHELL_MARKERS.navStudio, SHELL_MARKERS.navLab, SHELL_MARKERS.navCommunity, SHELL_MARKERS.navWorkbench];

/** One keyboard key press through the real CDP input pipeline.
 * Activation requires a NON-raw keyDown: CDP treats a `keyDown` without
 * `text` as a rawKeyDown, and Chromium's default button activation for
 * Enter only fires on a non-raw keydown (Space activates on keyUp, which
 * is never raw). Enter therefore carries text "\r" — exactly what a real
 * Enter press generates (live-caught on the 3.14.3 baseline). */
async function pressKey(page, { key, code, keyCode, text }) {
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: text ?? undefined, ...base }).catch(() => undefined);
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }).catch(() => undefined);
}

function pressTab(page) {
  return pressKey(page, { key: "Tab", code: "Tab", keyCode: 9 });
}

function pressEnter(page) {
  return pressKey(page, { key: "Enter", code: "Enter", keyCode: 13, text: "\r" });
}

function pressSpace(page) {
  return pressKey(page, { key: " ", code: "Space", keyCode: 32, text: " " });
}

/** A compact description of the currently focused element. */
const ACTIVE_PROBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) {
    return { body: true, hasFocus: document.hasFocus() };
  }
  return {
    body: false,
    hasFocus: document.hasFocus(),
    testid: el.getAttribute("data-testid"),
    tag: el.tagName,
    label: (el.getAttribute("aria-label") ?? (el.textContent ?? "").trim()).slice(0, 50),
  };
})()`;

async function activeElement(page) {
  return page.evaluateValue(ACTIVE_PROBE);
}

/** Tab forward until the element with `testid` is focused (bounded). */
async function tabUntil(page, testid, maxTabs = 30) {
  for (let i = 0; i < maxTabs; i += 1) {
    const active = await activeElement(page);
    if (active?.testid === testid) return { reached: true, tabs: i, active };
    await pressTab(page);
    await sleep(120);
  }
  return { reached: false, tabs: maxTabs, active: await activeElement(page) };
}

/** Click the frozen nav control (testid) — used to position surfaces, never
 * as a substitute for the keyboard paths this file asserts. */
async function clickNav(page, testid) {
  return page.evaluateValue(`(() => {
    const el = document.querySelector('[data-testid="${testid}"]');
    if (!el) return { found: false };
    el.click();
    return { found: true };
  })()`);
}

/** Is the surface heading (by exact text) currently visible? */
function headingVisibleExpression(text) {
  return `(() => {
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")];
    const match = headings.find((el) => (el.textContent ?? "").trim() === ${JSON.stringify(text)});
    if (!match) return { found: false };
    const r = match.getBoundingClientRect();
    const cs = getComputedStyle(match);
    return { found: true, visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0, rect: [r.left, r.top, r.width, r.height] };
  })()`;
}

/** The keyboard-navigation + activation check. */
export async function keyboardNavigationCheck(report, page) {
  const evidence = [];
  await page.evaluate(`window.focus()`).catch(() => undefined);
  const initial = await activeElement(page);
  evidence.push(`start: document.hasFocus=${initial.hasFocus}, activeElement=${initial.body ? "body" : `${initial.tag}[${initial.testid ?? initial.label}]`}`);

  // 1. Tab through the beginning of the document and record the order.
  const sequence = [];
  let studioSeen = -1;
  let labSeen = -1;
  let communitySeen = -1;
  let workbenchSeen = -1;
  let brandSeen = -1;
  for (let i = 0; i < 16; i += 1) {
    await pressTab(page);
    await sleep(120);
    const active = await activeElement(page);
    sequence.push(active?.body ? "body" : active?.testid ?? active?.label ?? active?.tag ?? "?");
    const last = sequence[sequence.length - 1];
    if (last === SHELL_MARKERS.brand && brandSeen === -1) brandSeen = i;
    if (last === SHELL_MARKERS.navStudio && studioSeen === -1) studioSeen = i;
    if (last === SHELL_MARKERS.navLab && labSeen === -1) labSeen = i;
    if (last === SHELL_MARKERS.navCommunity && communitySeen === -1) communitySeen = i;
    if (last === SHELL_MARKERS.navWorkbench && workbenchSeen === -1) workbenchSeen = i;
    if (workbenchSeen !== -1) break; // the whole bar has been traversed
  }
  evidence.push(`tab order observed: ${sequence.join(" -> ")}`);

  const problems = [];
  for (const [name, index] of [
    ["Game Studio nav", studioSeen],
    ["Lab nav", labSeen],
    ["Community nav", communitySeen],
    ["AI & Agents escape hatch", workbenchSeen],
  ]) {
    if (index === -1) problems.push(`${name} is never reached by Tab`);
  }
  const sensible =
    studioSeen !== -1 && labSeen !== -1 && communitySeen !== -1 && workbenchSeen !== -1 &&
    studioSeen < labSeen && labSeen < communitySeen && communitySeen < workbenchSeen;
  if (
    studioSeen !== -1 && labSeen !== -1 && communitySeen !== -1 && workbenchSeen !== -1 && !sensible
  ) {
    problems.push(
      `tab order is not sensible: first-focus order was Game Studio@${studioSeen}, Lab@${labSeen}, Community@${communitySeen}, AI & Agents@${workbenchSeen} (expected the bar's DOM order)`,
    );
  }
  if (brandSeen !== -1 && studioSeen !== -1 && brandSeen > studioSeen) {
    problems.push(`the brand cluster receives focus AFTER the navigation (brand@${brandSeen} > Game Studio@${studioSeen}) — not a sensible order`);
  }
  evidence.push(
    brandSeen === -1
      ? `brand cluster [${SHELL_MARKERS.brand}]: not focusable (a static brand is acceptable; recorded honestly)`
      : `brand cluster focused at tab ${brandSeen + 1} (before the navigation — sensible)`,
  );

  // 2. Keyboard ACTIVATION: Enter on the Lab nav switches the surface.
  const lab = await tabUntil(page, SHELL_MARKERS.navLab);
  await pressEnter(page);
  await sleep(1400);
  const labHeading = await page.evaluateValue(headingVisibleExpression(PRODUCT_MARKERS.labHeading));
  const labCurrent = await page.evaluateValue(
    `document.querySelector('[data-testid="${SHELL_MARKERS.navLab}"]')?.getAttribute("aria-current") ?? null`,
  );
  const enterActivated = Boolean(labHeading?.found && labHeading?.visible) && labCurrent === "page";
  evidence.push(
    `Enter on the Lab nav: focus reached=${lab.reached} (after ${lab.tabs} tabs); aria-current=${JSON.stringify(labCurrent)}; lab heading visible=${JSON.stringify(labHeading?.visible ?? null)}`,
  );
  if (!enterActivated) {
    problems.push("Enter does not activate the Lab navigation (surface did not switch / aria-current did not move)");
  }

  // 3. Keyboard ACTIVATION: Space on the Community nav switches the surface.
  const community = await tabUntil(page, SHELL_MARKERS.navCommunity);
  await pressSpace(page);
  await sleep(1400);
  const communityHeading = await page.evaluateValue(headingVisibleExpression(PRODUCT_MARKERS.communityHeading));
  const communityCurrent = await page.evaluateValue(
    `document.querySelector('[data-testid="${SHELL_MARKERS.navCommunity}"]')?.getAttribute("aria-current") ?? null`,
  );
  const spaceActivated = Boolean(communityHeading?.found && communityHeading?.visible) && communityCurrent === "page";
  evidence.push(
    `Space on the Community nav: focus reached=${community.reached} (after ${community.tabs} tabs); aria-current=${JSON.stringify(communityCurrent)}; community heading visible=${JSON.stringify(communityHeading?.visible ?? null)}`,
  );
  if (!spaceActivated) {
    problems.push("Space does not activate the Community navigation (surface did not switch / aria-current did not move)");
  }

  await clickNav(page, SHELL_MARKERS.navStudio); // restore the default surface
  report.check(
    "a11y-keyboard-navigation",
    "keyboard navigation: Tab reaches brand → nav buttons → the AI & Agents escape hatch in a sensible order; Enter and Space activate navigation",
    problems.length === 0 ? "pass" : "fail",
    problems.length === 0
      ? "the full top-bar navigation is keyboard-reachable in DOM order and activates with Enter/Space (aria-current tracks the active surface)"
      : problems.join("; "),
    evidence,
  );
}

/** The visible-focus check: the focused bar control must render a focus
 * indicator (outline, box-shadow, or any focused-vs-blurred style change). */
export async function visibleFocusCheck(report, page) {
  const probes = [];
  for (const testid of [SHELL_MARKERS.navLab, SHELL_MARKERS.navWorkbench]) {
    const reached = await tabUntil(page, testid);
    const focused = await page.evaluateValue(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        testid: el.getAttribute("data-testid"),
        matchesFocusVisible: el.matches(":focus-visible"),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
        boxShadow: cs.boxShadow,
        borderColor: cs.borderColor,
        backgroundColor: cs.backgroundColor,
      };
    })()`);
    await page.evaluate(`document.activeElement && document.activeElement.blur()`).catch(() => undefined);
    await sleep(150);
    const blurred = await page.evaluateValue(`(() => {
      const el = document.querySelector('[data-testid="${testid}"]');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { boxShadow: cs.boxShadow, borderColor: cs.borderColor, backgroundColor: cs.backgroundColor, borderWidth: cs.borderWidth };
    })()`);
    probes.push({ testid, reached: reached.reached, focused, blurred });
    await sleep(150);
  }
  const problems = [];
  const evidence = probes.map((probe) => {
    if (!probe.reached || !probe.focused) {
      problems.push(`${probe.testid} could not be keyboard-focused`);
      return `${probe.testid}: not focusable via Tab`;
    }
    const outlineVisible = probe.focused.outlineStyle !== "none" && parseFloat(probe.focused.outlineWidth) > 0;
    const shadowVisible = probe.focused.boxShadow !== "none";
    const styleChanged =
      probe.blurred != null &&
      (probe.focused.boxShadow !== probe.blurred.boxShadow ||
        probe.focused.borderColor !== probe.blurred.borderColor ||
        probe.focused.backgroundColor !== probe.blurred.backgroundColor);
    const visible = outlineVisible || shadowVisible || styleChanged;
    if (!visible) {
      problems.push(
        `${probe.testid} shows NO visible focus indicator when keyboard-focused (:focus-visible=${probe.focused.matchesFocusVisible}, outline=${probe.focused.outlineStyle} ${probe.focused.outlineWidth}, boxShadow=${probe.focused.boxShadow}, no focused-vs-blurred style change)`,
      );
    }
    return (
      `${probe.testid}: :focus-visible=${probe.focused.matchesFocusVisible}, outline=${probe.focused.outlineStyle} ${probe.focused.outlineWidth} ${probe.focused.outlineColor}, ` +
      `boxShadow=${probe.focused.boxShadow}, focused-vs-blurred change=${styleChanged}`
    );
  });
  await clickNav(page, SHELL_MARKERS.navStudio); // restore the default surface
  report.check(
    "a11y-visible-focus",
    "visible focus: keyboard-focused top-bar controls render a focus indicator",
    problems.length === 0 ? "pass" : "fail",
    problems.length === 0
      ? "every probed bar control shows a visible focus indicator under keyboard focus"
      : problems.join("; "),
    evidence,
  );
}

/** Every visible interactive element must have an accessible name. */
export async function accessibleNamesCheck(report, page) {
  const named = await page.evaluateValue(`(() => {
    const interactive = [...document.querySelectorAll("button, a, input, select, textarea, [role='button'], [role='tab']")];
    const visible = interactive.filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0.5 && r.height > 0.5;
    });
    const nameSource = (el) => {
      if ((el.getAttribute("aria-label") ?? "").trim()) return "aria-label";
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const refs = labelledby.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean);
        if (refs.some((node) => (node.textContent ?? "").trim())) return "aria-labelledby";
      }
      if ((el.textContent ?? "").trim()) return "text";
      if ((el.getAttribute("title") ?? "").trim()) return "title";
      if (el instanceof HTMLInputElement && String(el.value ?? "").trim()) return "value";
      return null;
    };
    return visible.map((el) => ({
      testid: el.getAttribute("data-testid"),
      tag: el.tagName,
      label: (el.getAttribute("aria-label") ?? (el.textContent ?? "").trim()).slice(0, 40),
      source: nameSource(el),
    }));
  })()`);
  if (!Array.isArray(named)) {
    report.check(
      "a11y-accessible-names",
      "accessible names: every visible interactive element is named (aria-label / text / title)",
      "fail",
      `the accessible-name probe failed: ${JSON.stringify(named)}`,
    );
    return;
  }
  const unnamed = named.filter((entry) => entry.source == null);
  const navCurrent = await page.evaluateValue(
    `document.querySelector('[data-testid="${SHELL_MARKERS.navStudio}"]')?.getAttribute("aria-current") ?? document.querySelector('[data-testid="${SHELL_MARKERS.navLab}"]')?.getAttribute("aria-current") ?? document.querySelector('[data-testid="${SHELL_MARKERS.navCommunity}"]')?.getAttribute("aria-current") ?? null`,
  );
  const problems = [];
  if (unnamed.length > 0) {
    problems.push(`${unnamed.length} visible interactive element(s) have NO accessible name: ${unnamed.map((entry) => `${entry.tag}[${entry.testid ?? entry.label ?? "?"}]`).join(", ")}`);
  }
  if (navCurrent == null) {
    problems.push("no navigation button carries aria-current (the active workspace is not programmatically indicated)");
  }
  report.check(
    "a11y-accessible-names",
    "accessible names: every visible interactive element is named (aria-label / text / title); the active nav carries aria-current",
    problems.length === 0 ? "pass" : "fail",
    problems.length === 0
      ? `${named.length} visible interactive elements checked — all named; active nav aria-current=${JSON.stringify(navCurrent)}`
      : problems.join("; "),
    named.slice(0, 30).map((entry) => `${entry.tag}[${entry.testid ?? "?"}] "${entry.label}" — name via ${entry.source ?? "NONE"}`),
  );
}

/** Per surface: an h1 exists and visible heading levels do not skip. */
export async function headingHierarchyCheck(report, page) {
  const surfaces = [
    { testid: SHELL_MARKERS.navStudio, name: "Game Studio" },
    { testid: SHELL_MARKERS.navLab, name: "Lab" },
    { testid: SHELL_MARKERS.navCommunity, name: "Community" },
  ];
  const problems = [];
  const evidence = [];
  for (const surface of surfaces) {
    await clickNav(page, surface.testid);
    await sleep(1200);
    const headings = await page.evaluateValue(`(() => {
      return [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const visible = cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0.5 && r.height > 0.5;
        return { level: Number(el.tagName.slice(1)), text: (el.textContent ?? "").trim().slice(0, 60), visible };
      }).filter((entry) => entry.visible);
    })()`);
    if (!Array.isArray(headings)) {
      problems.push(`${surface.name}: heading probe failed (${JSON.stringify(headings)})`);
      continue;
    }
    const levels = headings.map((entry) => entry.level);
    evidence.push(`${surface.name}: visible headings ${JSON.stringify(headings.map((entry) => `h${entry.level} ${entry.text.slice(0, 30)}`))}`);
    if (!levels.includes(1)) {
      problems.push(`${surface.name}: NO visible h1 (observed levels: ${JSON.stringify(levels)})`);
      continue;
    }
    if (levels[0] !== 1) {
      problems.push(`${surface.name}: the first visible heading is h${levels[0]}, not the surface h1`);
    }
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] > levels[i - 1] + 1) {
        problems.push(`${surface.name}: heading level skips h${levels[i - 1]} → h${levels[i]} ("${headings[i].text}")`);
      }
    }
  }
  await clickNav(page, SHELL_MARKERS.navStudio); // restore the default surface
  report.check(
    "a11y-heading-hierarchy",
    "heading hierarchy: every surface has its h1 and visible heading levels never skip",
    problems.length === 0 ? "pass" : "fail",
    problems.length === 0
      ? "Studio, Lab and Community each render an h1-first heading structure with no skipped levels"
      : problems.join("; "),
    evidence,
  );
}
