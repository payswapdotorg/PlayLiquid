/**
 * UX-003 harness — the FROZEN CONTRACT checks (spec/ux/work-items.md):
 * the top-bar escape-hatch vocabulary and the first-run empty-state
 * contract. Extracted from checks.mjs unchanged (max-file-lines gate).
 */
import { PRODUCT_MARKERS, SHELL_MARKERS } from "./config.mjs";
/** The frozen workbench escape-hatch contract (UX-001 implements, UX-003
 * asserts): the element [data-testid=gameos-nav-workbench] is present,
 * visible and labeled exactly `AI & Agents` (title/hint stays honest about
 * what it opens), and is a SECONDARY affordance (never the active page). */
export async function workbenchEscapeCheck(report, cdp) {
  const observed = await cdp.evaluateValue(`(() => {
    const el = document.querySelector('[data-testid="${SHELL_MARKERS.navWorkbench}"]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      found: true,
      label: (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim(),
      title: el.getAttribute("title"),
      ariaCurrent: el.getAttribute("aria-current"),
      visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0,
      rect: [r.left, r.top, r.width, r.height],
    };
  })()`);
  const expected = SHELL_MARKERS.workbenchLabel;
  const problems = [];
  if (!observed?.found) {
    problems.push(`the escape hatch [${SHELL_MARKERS.navWorkbench}] is not rendered`);
  } else {
    if (!observed.visible) problems.push(`the escape hatch is not visible / has a zero box (${JSON.stringify(observed.rect)})`);
    if (observed.label !== expected) {
      problems.push(
        `label mismatch: expected exactly ${JSON.stringify(expected)} (frozen contract, spec/ux/work-items.md), observed ${JSON.stringify(observed.label)}`,
      );
    }
    if (!observed.title || observed.title.trim().length === 0) {
      problems.push("the escape hatch has no title/hint — it must honestly state what it opens (models, agents, provider capabilities)");
    }
    if (observed.ariaCurrent === "page") {
      problems.push("the escape hatch carries aria-current=\"page\" — it is an escape hatch, not the active workspace (must stay secondary)");
    }
  }
  report.check(
    "workbench-escape-hatch-label",
    `the workbench escape hatch is present, visible and labeled exactly ${JSON.stringify(expected)} (frozen shell vocabulary), with an honest hint, as a secondary affordance`,
    problems.length === 0 ? "pass" : "fail",
    problems.length === 0
      ? `escape hatch [${SHELL_MARKERS.navWorkbench}] renders with label ${JSON.stringify(observed.label)}, hint ${JSON.stringify(observed.title)}, aria-current=${JSON.stringify(observed.ariaCurrent)} (secondary)`
      : problems.join("; "),
    observed?.found
      ? [
          `observed label: ${JSON.stringify(observed.label)}`,
          `observed title/hint: ${JSON.stringify(observed.title)}`,
          `observed aria-current: ${JSON.stringify(observed.ariaCurrent)}`,
          `rect: ${JSON.stringify(observed.rect)}`,
          `baseline honesty: the pre-UX-001 artifact ships the inherited "${PRODUCT_MARKERS.workbenchAffordance}" label here — the frozen contract replaces it`,
        ]
      : [`the pre-UX-001 artifact ships the inherited "${PRODUCT_MARKERS.workbenchAffordance}" label on ${SHELL_MARKERS.navWorkbench}`],
  );
}

/** The frozen FIRST-RUN guidance contract (UX-002 implements, UX-003
 * asserts): the default first-run surface renders a visible
 * [data-testid=gameos-empty-state] container that offers at least one REAL
 * next step [data-testid=gameos-empty-next-step] — an enabled, visible
 * interactive control performing a supported operation (no dead controls,
 * no fake success). DOM presence alone is not a pass. */
export async function emptyStateContractCheck(report, cdp) {
  const observed = await cdp.evaluateValue(`(() => {
    const visible = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) !== 0 && r.width > 0 && r.height > 0;
    };
    const containers = [...document.querySelectorAll('[data-testid="${SHELL_MARKERS.emptyState}"]')];
    const interactive = (el) => el.querySelector("button:not([disabled]), a[href], [role='button']:not([disabled]), input:not([disabled])");
    return containers.map((container) => {
      const steps = [...container.querySelectorAll('[data-testid="${SHELL_MARKERS.emptyNextStep}"]')];
      return {
        visible: visible(container),
        text: (container.textContent ?? "").trim().slice(0, 140),
        steps: steps.map((step) => ({
          visible: visible(step),
          text: (step.textContent ?? "").trim().slice(0, 120),
          hasControl: Boolean(interactive(step)),
          controlLabel: interactive(step) ? (interactive(step).textContent ?? "").trim().slice(0, 60) : null,
        })),
      };
    });
  })()`);
  const containers = Array.isArray(observed) ? observed : [];
  const problems = [];
  if (containers.length === 0) {
    problems.push(`no [${SHELL_MARKERS.emptyState}] container is rendered anywhere on the default first-run surface`);
  } else {
    const good = containers.filter(
      (container) =>
        container.visible &&
        container.steps.some((step) => step.visible && step.hasControl),
    );
    if (good.length === 0) {
      const invisible = containers.filter((container) => !container.visible).length;
      const deadSteps = containers
        .filter((container) => container.visible)
        .flatMap((container) => container.steps.filter((step) => !step.visible || !step.hasControl));
      problems.push(
        `${containers.length} [${SHELL_MARKERS.emptyState}] container(s) rendered, but none offers a VISIBLE real next step [${SHELL_MARKERS.emptyNextStep}] with an enabled interactive control` +
          (invisible > 0 ? ` (${invisible} hidden/invisible on kept-mounted surfaces)` : "") +
          (deadSteps.length > 0 ? `; dead steps observed: ${JSON.stringify(deadSteps)}` : ""),
      );
    }
  }
  report.check(
    "gameos-empty-state-contract",
    "first-run guidance: the default first-run surface renders the frozen empty-state contract (gameos-empty-state + a REAL gameos-empty-next-step control)",
    problems.length === 0 ? "pass" : "fail",
    problems.length === 0
      ? `${containers.length} visible empty-state container(s) on the default surface, each offering real next steps: ${JSON.stringify(containers.flatMap((c) => c.steps.map((s) => s.controlLabel)))}`
      : problems.join("; "),
    [
      `baseline honesty: the frozen empty-state vocabulary (${SHELL_MARKERS.emptyState} + ${SHELL_MARKERS.emptyNextStep}) is implemented by UX-002 (Worker B); the 3.14.3 baseline ships the module's own plain empty texts instead`,
      `observed containers: ${JSON.stringify(containers).slice(0, 800)}`,
    ],
  );
}
