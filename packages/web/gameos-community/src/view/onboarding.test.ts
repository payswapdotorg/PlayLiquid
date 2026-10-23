/**
 * Onboarding copy + contextual next-step tests (pure, UX-002): the frozen
 * empty-state contract — every Community surface's first-run copy
 * explains what the surface does in plain product language and names a
 * REAL next step — plus the honest "what next" lines after a read-model
 * refresh failure (E11) and after a command intent was dispatched (the
 * log grew, E8/E10).
 *
 * The copy and hints are VIEW MODELS (view/onboarding.ts is pure), so the
 * wording is testable exactly like any other projection: deterministically,
 * without a DOM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNITY_EMPTY_STATE_COPY,
  commandLogNextHint,
  refreshFailureNextStep,
} from "./onboarding.ts";
import type { CommunityEmptySurfaceId } from "./onboarding.ts";
import type { CommunityCommandLogEntry } from "../ports.ts";
import {
  DEMO_COMMUNITY_TENANT,
  DEMO_COMMUNITY_VIEWER,
  demoCommunitySnapshot,
} from "../fixtures/demo.ts";

const SURFACES: readonly CommunityEmptySurfaceId[] = ["contributions", "lifecycle", "provenance"];

const snapshot = demoCommunitySnapshot();

/** One accepted submit-contribution log entry over the demo viewer (real shapes). */
const submittedEntry: CommunityCommandLogEntry = {
  intent: {
    kind: "submit-contribution",
    tenant: DEMO_COMMUNITY_TENANT,
    subject: DEMO_COMMUNITY_VIEWER,
    contributionKind: "issue",
    label: "demo-issue-from-workbench",
    aiGenerated: false,
    lineageDerived: false,
    gapId: undefined,
  },
  receipt: {
    ok: true,
    kind: "contribution-submitted",
    contributionId: snapshot.contributions[0]!.contributionId,
    duplicate: false,
  },
};

/** One accepted advance-contribution log entry (real shapes). */
const advancedEntry: CommunityCommandLogEntry = {
  intent: {
    kind: "advance-contribution",
    tenant: DEMO_COMMUNITY_TENANT,
    actor: DEMO_COMMUNITY_VIEWER,
    contributionId: String(snapshot.contributions[0]!.contributionId),
    command: "triage",
  },
  receipt: {
    ok: true,
    kind: "contribution-advanced",
    contributionId: snapshot.contributions[0]!.contributionId,
    to: "triaged",
    duplicate: false,
  },
};

/** One refused submit log entry (the honest no-base lineage refusal). */
const refusedEntry: CommunityCommandLogEntry = {
  intent: submittedEntry.intent,
  receipt: {
    ok: false,
    code: "invalid-lineage-node",
    detail: "the desktop host has no published package to derive a lineage base from",
  },
};

test("every Community surface has first-run empty-state copy (frozen contract)", () => {
  for (const surface of SURFACES) {
    const copy = COMMUNITY_EMPTY_STATE_COPY[surface];
    assert.ok(copy !== undefined, `surface ${surface} has copy`);
    assert.ok(copy.title.length > 0, `${surface}: non-empty title`);
    assert.ok(copy.explanation.length > 0, `${surface}: non-empty explanation`);
    assert.ok(copy.nextStepLabel.length > 0, `${surface}: non-empty next-step label`);
  }
});

test("the copy is a frozen value: the same words render every run (E9)", () => {
  assert.ok(Object.isFrozen(COMMUNITY_EMPTY_STATE_COPY));
  for (const surface of SURFACES) {
    assert.ok(Object.isFrozen(COMMUNITY_EMPTY_STATE_COPY[surface]));
  }
});

test("the real next steps are the module's own supported operations", () => {
  // Contributions: the submit-contribution typed intent through the command port.
  assert.equal(COMMUNITY_EMPTY_STATE_COPY.contributions.nextStepLabel, "Submit an issue");
  // The other surfaces: one authoritative read-model pull through the data port.
  for (const surface of ["lifecycle", "provenance"] as const) {
    assert.equal(
      COMMUNITY_EMPTY_STATE_COPY[surface].nextStepLabel,
      "Refresh read models",
      `${surface}: the next step is the REAL refresh operation`,
    );
  }
});

test("the contributions copy explains the lifecycle and provenance model", () => {
  const explanation = COMMUNITY_EMPTY_STATE_COPY.contributions.explanation;
  assert.match(explanation, /provenance/);
  assert.match(explanation, /submitted → triaged → under-review/);
  assert.match(explanation, /AI disclosure/);
});

test("cross-surface suggestions are PROSE naming the Community's own tabs", () => {
  const all = SURFACES.flatMap((surface) => COMMUNITY_EMPTY_STATE_COPY[surface].guidance).join(" ");
  assert.match(all, /Contributions surface/, "the Contributions surface is named in prose");
  assert.doesNotMatch(
    all,
    /Lab workspace|Game Studio workspace|AI & Agents/,
    "no cross-workspace navigation is implied from Community",
  );
});

test("refreshFailureNextStep: null without a failure, an honest what-next line with one", () => {
  assert.equal(refreshFailureNextStep(null), null);
  const line = refreshFailureNextStep("community service unreachable");
  assert.ok(line !== null);
  assert.match(line, /still render/, "the last good read models' survival is stated");
  assert.match(line, /Refresh read models/, "the real next control is named");
});

test("commandLogNextHint: null while empty, an honest what-just-happened line once dispatched", () => {
  assert.equal(commandLogNextHint([]), null);
  const hint = commandLogNextHint([submittedEntry]);
  assert.ok(hint !== null);
  assert.match(hint, /submit-contribution/);
  assert.match(hint, /contribution-submitted/);
  assert.match(hint, /Refresh read models/, "the real next control is named");
  assert.match(hint, /provenance/, "the follow-up names the real surface");
});

test("commandLogNextHint: the advance receipt's follow-up names the lifecycle ledger", () => {
  const hint = commandLogNextHint([advancedEntry]);
  assert.ok(hint !== null);
  assert.match(hint, /contribution-advanced/);
  assert.match(hint, /lifecycle ledger/);
});

test("commandLogNextHint: a refusal is surfaced honestly with the typed code", () => {
  const hint = commandLogNextHint([refusedEntry]);
  assert.ok(hint !== null);
  assert.match(hint, /refused/);
  assert.match(hint, /invalid-lineage-node/);
  assert.match(hint, /E8/, "the typed-refusal discipline is named");
  assert.match(hint, /no hidden retries/);
});

test("commandLogNextHint: the LAST entry's outcome is the one narrated (append-only log)", () => {
  const hint = commandLogNextHint([submittedEntry, refusedEntry]);
  assert.ok(hint !== null);
  assert.match(hint, /refused/, "the newest outcome wins");
  const other = commandLogNextHint([refusedEntry, submittedEntry]);
  assert.ok(other !== null);
  assert.match(other, /contribution-submitted/);
});

test("determinism: same inputs produce the same lines (pure copy)", () => {
  assert.equal(refreshFailureNextStep("x"), refreshFailureNextStep("x"));
  assert.equal(commandLogNextHint([submittedEntry]), commandLogNextHint([submittedEntry]));
});
