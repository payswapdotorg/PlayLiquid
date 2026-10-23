/**
 * Onboarding copy + contextual next-step tests (pure, UX-002): the frozen
 * empty-state contract — every Lab surface's first-run copy explains what
 * the surface does in plain product language and names a REAL next step —
 * plus the honest "what next" lines after a read-model refresh failure
 * (E11) and after a command intent was dispatched (the log grew, E8/E10).
 *
 * The copy and hints are VIEW MODELS (view/onboarding.ts is pure), so the
 * wording is testable exactly like any other projection: deterministically,
 * without a DOM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LAB_EMPTY_STATE_COPY,
  commandLogNextHint,
  refreshFailureNextStep,
} from "./onboarding.ts";
import type { LabEmptySurfaceId } from "./onboarding.ts";
import type { LabCommandLogEntry } from "../ports.ts";
import { demoLabSnapshot } from "../fixtures/demo.ts";

const SURFACES: readonly LabEmptySurfaceId[] = [
  "searches",
  "evidence",
  "learning",
  "guidance",
  "gaps",
  "arena",
];

const snapshot = await demoLabSnapshot();

/** One accepted request-search log entry over the demo viewer (real shapes). */
const openedEntry: LabCommandLogEntry = {
  intent: {
    kind: "request-search",
    tenant: snapshot.viewer.tenant,
    subject: snapshot.viewer.subject,
    cycleId: "cycle-9",
    seed: "seed-9",
    maxAgents: 2,
  },
  receipt: {
    ok: true,
    kind: "search-opened",
    searchId: "search-1",
    size: 12,
    spaceDigest: "sha256:abc",
    position: 0,
    duplicate: false,
  },
};

/** One accepted advance-gap-rung log entry (real shapes). */
const advancedEntry: LabCommandLogEntry = {
  intent: {
    kind: "advance-gap-rung",
    tenant: snapshot.viewer.tenant,
    subject: snapshot.viewer.subject,
    gapId: "gap-1",
    rung: "alternate-organization",
    disposition: "attempted",
  },
  receipt: {
    ok: true,
    kind: "gap-advanced",
    gapId: "gap-1",
    rung: "alternate-organization",
    duplicate: false,
  },
};

/** One refused request-search log entry (the honest no-context refusal). */
const refusedEntry: LabCommandLogEntry = {
  intent: openedEntry.intent,
  receipt: { ok: false, code: "invalid-context", detail: "no pinned local project revision" },
};

test("every Lab surface has first-run empty-state copy (frozen contract)", () => {
  for (const surface of SURFACES) {
    const copy = LAB_EMPTY_STATE_COPY[surface];
    assert.ok(copy !== undefined, `surface ${surface} has copy`);
    assert.ok(copy.title.length > 0, `${surface}: non-empty title`);
    assert.ok(copy.explanation.length > 0, `${surface}: non-empty explanation`);
    assert.ok(copy.nextStepLabel.length > 0, `${surface}: non-empty next-step label`);
  }
});

test("the copy is a frozen value: the same words render every run (E9)", () => {
  assert.ok(Object.isFrozen(LAB_EMPTY_STATE_COPY));
  for (const surface of SURFACES) {
    assert.ok(Object.isFrozen(LAB_EMPTY_STATE_COPY[surface]));
  }
});

test("the real next steps are the module's own supported operations", () => {
  // Searches: the request-search typed intent through the command port.
  assert.equal(LAB_EMPTY_STATE_COPY.searches.nextStepLabel, "Request a search");
  // Every other surface: one authoritative read-model pull through the data port.
  for (const surface of ["evidence", "learning", "guidance", "gaps", "arena"] as const) {
    assert.equal(
      LAB_EMPTY_STATE_COPY[surface].nextStepLabel,
      "Refresh read models",
      `${surface}: the next step is the REAL refresh operation`,
    );
  }
});

test("the searches copy explains what the Lab is, in PlayLiquid product language", () => {
  const explanation = LAB_EMPTY_STATE_COPY.searches.explanation;
  assert.match(explanation, /Game Engineering Lab/);
  assert.match(explanation, /deterministic/);
  assert.match(explanation, /seed/);
});

test("honest limitations: unsupported operations say so with the missing prerequisite", () => {
  const joined = (surface: LabEmptySurfaceId) =>
    [LAB_EMPTY_STATE_COPY[surface].explanation, ...LAB_EMPTY_STATE_COPY[surface].guidance].join(" ");
  assert.match(joined("evidence"), /not yet supported/);
  assert.match(joined("evidence"), /missing prerequisite/);
  assert.match(joined("arena"), /not yet supported/);
  assert.match(joined("arena"), /missing prerequisite/);
});

test("cross-surface suggestions are PROSE naming the Lab's own tabs, never foreign navigation", () => {
  const all = SURFACES.flatMap((surface) => LAB_EMPTY_STATE_COPY[surface].guidance).join(" ");
  assert.match(all, /Searches surface/, "the Searches surface is named in prose");
  assert.doesNotMatch(
    all,
    /Game Studio workspace|Community workspace/,
    "no cross-workspace buttons are implied",
  );
});

test("refreshFailureNextStep: null without a failure, an honest what-next line with one", () => {
  assert.equal(refreshFailureNextStep(null), null);
  const line = refreshFailureNextStep("organization service unreachable");
  assert.ok(line !== null);
  assert.match(line, /still render/, "the last good read models' survival is stated");
  assert.match(line, /Refresh read models/, "the real next control is named");
});

test("commandLogNextHint: null while empty, an honest what-just-happened line once dispatched", () => {
  assert.equal(commandLogNextHint([]), null);
  const hint = commandLogNextHint([openedEntry]);
  assert.ok(hint !== null);
  assert.match(hint, /request-search/);
  assert.match(hint, /search opened/);
  assert.match(hint, /Refresh read models/, "the real next control is named");
  assert.match(hint, /candidate stream/, "the follow-up names the real surface");
});

test("commandLogNextHint: the gap receipt's follow-up names the gap surface", () => {
  const hint = commandLogNextHint([advancedEntry]);
  assert.ok(hint !== null);
  assert.match(hint, /gap advanced/);
  assert.match(hint, /gap summaries/);
});

test("commandLogNextHint: a refusal is surfaced honestly with the typed code", () => {
  const hint = commandLogNextHint([refusedEntry]);
  assert.ok(hint !== null);
  assert.match(hint, /refused/);
  assert.match(hint, /invalid-context/);
  assert.match(hint, /E8/, "the typed-refusal discipline is named");
  assert.match(hint, /no hidden retries/);
});

test("commandLogNextHint: the LAST entry's outcome is the one narrated (append-only log)", () => {
  const hint = commandLogNextHint([openedEntry, refusedEntry]);
  assert.ok(hint !== null);
  assert.match(hint, /refused/, "the newest outcome wins");
  const other = commandLogNextHint([refusedEntry, openedEntry]);
  assert.ok(other !== null);
  assert.match(other, /search opened/);
});

test("determinism: same inputs produce the same lines (pure copy)", () => {
  assert.equal(refreshFailureNextStep("x"), refreshFailureNextStep("x"));
  assert.equal(commandLogNextHint([openedEntry]), commandLogNextHint([openedEntry]));
});
