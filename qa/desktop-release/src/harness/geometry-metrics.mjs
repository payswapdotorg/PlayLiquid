/**
 * UX-003 harness — pure geometry METRICS (extracted from
 * checks-geometry.mjs unchanged; max-file-lines gate): the single-round-trip
 * bar measurement expression and the violation analysis (overlap /
 * clipping / overflow / truncation / reachability math).
 */

/** One combined measurement of every bar element (single round trip). */
export function barGeometryExpression() {
  const measure = `((el) => {
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        found: true,
        label: (el.getAttribute("aria-label") ?? (el.textContent ?? "").trim()).slice(0, 60),
        rect: {
          left: r.left, top: r.top, right: r.right, bottom: r.bottom,
          width: r.width, height: r.height,
        },
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    })`;
  const selectors = {
    bar: `[data-testid="${SHELL_MARKERS.bar}"]`,
    brand: `[data-testid="${SHELL_MARKERS.brand}"]`,
    navStudio: `[data-testid="${SHELL_MARKERS.navStudio}"]`,
    navLab: `[data-testid="${SHELL_MARKERS.navLab}"]`,
    navCommunity: `[data-testid="${SHELL_MARKERS.navCommunity}"]`,
    workbench: `[data-testid="${SHELL_MARKERS.navWorkbench}"]`,
    workspaceHost: `[data-testid="${SHELL_MARKERS.workspaceHost}"]`,
    overflowControl: `[data-testid="${SHELL_MARKERS.shellOverflow}"]`,
  };
  const windowControls = {};
  for (const label of SHELL_MARKERS.windowControlLabels) {
    // single-quoted attribute value inside the double-quoted selector string
    windowControls[label] = `bar && bar.querySelector("button[aria-label='${label}']")`;
  }
  return `(() => {
    const measure = ${measure};
    const bar = document.querySelector(${JSON.stringify(selectors.bar)});
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      viewport: [vw, vh],
      documentScrollWidth: document.documentElement.scrollWidth,
      bar: bar ? measure(bar) : { found: false },
      ${Object.entries(selectors)
        .filter(([key]) => key !== "bar")
        .map(([key, selector]) => `${key}: measure(document.querySelector(${JSON.stringify(selector)})),`)
        .join("\n      ")}
      windowControls: {
        ${Object.entries(windowControls)
          .map(([label, expr]) => `${JSON.stringify(label)}: measure(${expr}),`)
          .join("\n        ")}
      },
    };
  })()`;
}

export function elementVisible(entry) {
  if (!entry?.found) return false;
  if (entry.display === "none" || entry.visibility === "hidden" || Number(entry.opacity) === 0) return false;
  return entry.rect.width > PX && entry.rect.height > PX;
}

export function elementClipped(entry, vw, vh) {
  const r = entry.rect;
  return r.left < -PX || r.right > vw + PX || r.top < -PX || r.bottom > vh + PX;
}

export function overlapArea(a, b) {
  const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
  const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
  return width > 0 && height > 0 ? width * height : 0;
}

export function rectSummary(entry) {
  if (!entry?.found) return "(absent)";
  const r = entry.rect;
  return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` +
    (entry.scrollWidth > entry.clientWidth + 1 ? ` [internal clip: scrollWidth ${entry.scrollWidth} > ${entry.clientWidth}]` : "");
}

/** Analyze one measurement pass against the geometry contract. */
export function analyzeGeometry(measured) {
  const [vw, vh] = measured.viewport ?? [0, 0];
  const problems = [];
  const evidence = [];

  if (!measured.bar?.found) {
    problems.push(`the shell top bar [${SHELL_MARKERS.bar}] is not rendered — geometry cannot be asserted`);
    return { problems, evidence };
  }
  if (!elementVisible(measured.bar)) {
    problems.push(`the shell top bar is not visible (${rectSummary(measured.bar)})`);
  }

  // 1. Required elements: present, visible, non-zero.
  const named = {};
  for (const item of REQUIRED) {
    const entry = measured[item.key];
    named[item.key] = entry;
    if (!entry?.found) {
      problems.push(`missing required bar element: ${item.label}`);
      continue;
    }
    if (!elementVisible(entry)) {
      problems.push(`${item.label} is not visible / has a zero box (${rectSummary(entry)})`);
    }
  }

  // Window controls: minimize + (maximize|restore) + close, all visible.
  const controls = measured.windowControls ?? {};
  const minimize = controls["Minimize window"];
  const maximize = controls["Maximize window"] ?? controls["Restore window"];
  const close = controls["Close window"];
  for (const [name, entry] of [["Minimize window", minimize], ["Maximize/Restore window", maximize], ["Close window", close]]) {
    if (!entry?.found) {
      problems.push(`missing window control: ${name}`);
    } else if (!elementVisible(entry)) {
      problems.push(`window control ${name} is not visible / has a zero box (${rectSummary(entry)})`);
    }
  }

  // 2. Clipping: fully inside the viewport.
  const clipTargets = [
    ...REQUIRED.map((item) => ({ label: item.label, entry: measured[item.key] })),
    { label: "Minimize window control", entry: minimize },
    { label: "Maximize/Restore window control", entry: maximize },
    { label: "Close window control", entry: close },
  ];
  for (const target of clipTargets) {
    if (target.entry?.found && elementVisible(target.entry) && elementClipped(target.entry, vw, vh)) {
      problems.push(`${target.label} is clipped by the viewport edges (${rectSummary(target.entry)} vs viewport ${vw}x${vh})`);
    }
  }

  // 3. Pairwise overlap among all visible bar elements.
  const overlapSet = [
    { label: "brand cluster", entry: measured.brand },
    { label: "Game Studio nav", entry: measured.navStudio },
    { label: "Lab nav", entry: measured.navLab },
    { label: "Community nav", entry: measured.navCommunity },
    { label: "AI & Agents escape hatch", entry: measured.workbench },
    { label: "overflow control", entry: measured.overflowControl },
    ...Object.entries(controls).map(([label, entry]) => ({ label: `${label} control`, entry })),
  ].filter((item) => elementVisible(item.entry));
  for (let i = 0; i < overlapSet.length; i += 1) {
    for (let j = i + 1; j < overlapSet.length; j += 1) {
      const area = overlapArea(overlapSet[i].entry, overlapSet[j].entry);
      if (area > OVERLAP_AREA) {
        problems.push(
          `${overlapSet[i].label} overlaps ${overlapSet[j].label} by ${Math.round(area)}px^2 ` +
            `(${rectSummary(overlapSet[i].entry)} vs ${rectSummary(overlapSet[j].entry)})`,
        );
      }
    }
  }

  // 4. Horizontal overflow: document level AND bar level (element check).
  const documentOverflow = (measured.documentScrollWidth ?? 0) > vw + 1;
  const barOverflow = measured.bar.scrollWidth > measured.bar.clientWidth + 1;
  if (documentOverflow) {
    problems.push(`document horizontal overflow: scrollWidth ${measured.documentScrollWidth} > viewport ${vw}`);
  }
  if (barOverflow) {
    problems.push(`top bar horizontal overflow: bar scrollWidth ${measured.bar.scrollWidth} > clientWidth ${measured.bar.clientWidth} (content is cut off)`);
  }

  // 5. Interactive-control labels must not be internally truncated.
  for (const target of [
    { label: "Game Studio nav", entry: measured.navStudio },
    { label: "Lab nav", entry: measured.navLab },
    { label: "Community nav", entry: measured.navCommunity },
    { label: "AI & Agents escape hatch", entry: measured.workbench },
  ]) {
    if (target.entry?.found && target.entry.scrollWidth > target.entry.clientWidth + 1) {
      problems.push(`${target.label} label is truncated inside its box (scrollWidth ${target.entry.scrollWidth} > ${target.entry.clientWidth})`);
    }
  }

  evidence.push(`viewport: ${vw}x${vh}; document scrollWidth ${measured.documentScrollWidth}; bar ${rectSummary(measured.bar)}`);
  for (const item of REQUIRED) {
    evidence.push(`${item.label}: ${rectSummary(measured[item.key])}`);
  }
  for (const [label, entry] of Object.entries(controls)) {
    evidence.push(`${label} control: ${rectSummary(entry)}`);
  }
  evidence.push(
    `overflow control [${SHELL_MARKERS.shellOverflow}]: ${measured.overflowControl?.found ? rectSummary(measured.overflowControl) : "not rendered (optional)"}`,
  );
  return { problems, evidence };
}
