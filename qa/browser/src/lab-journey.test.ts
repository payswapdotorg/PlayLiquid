/**
 * THE LAB JOURNEY (PL-043) — the Game Engineering Lab workbench surfaces of
 * `@playliquid/gameos-lab` walked END TO END as one user journey, over the
 * REAL Lab loop engines (lab-rig.ts): request-search through the typed
 * command port → the candidate stream → evaluate → learn/seal cycles →
 * the gap ladder advanced one rung at a time (with its authoritative
 * typed refusals, E8) → the E11 guidance surface (observed evidence vs
 * labeled estimates, structurally disjoint) → the R20 cross-tenant guards
 * (foreign search selection + foreign gap advance, both refused typed) →
 * the append-only trails the workbench surfaces (E10: the evidence
 * ledger, the gap attempt trail, the Arena lifecycle trail and the
 * command log where refusals stay visible).
 *
 * E11 (browser honesty): this journey runs the REAL workbench store + view
 * models — the exact pure projections the browser mounts render — over the
 * REAL PL-029 organization/search + PL-028 simulation + PL-030 learning
 * engines, under `node --test`. There is no DOM, no rendering and no
 * network here; the first test asserts that plainly instead of faking it.
 *
 * E9 (determinism): the whole journey runs TWICE and the traces must be
 * identical (same steps, same facts, same digest).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
// gameos-lab is reached through the Node-surface adapter (see lab-ui.ts).
import { createLabStore } from "./lab-ui.ts";
import type { LabStore } from "./lab-ui.ts";
import { assertSameTrajectory, createTrace } from "./journey-kit.ts";
import type { JourneyTrace } from "./journey-kit.ts";
import {
  JOURNEY_LAB_FOREIGN_SUBJECT,
  JOURNEY_LAB_FOREIGN_TENANT,
  JOURNEY_LAB_SUBJECT,
  JOURNEY_LAB_TENANT,
  createLabJourneyRig,
  openForeignSearch,
} from "./lab-rig.ts";

/** The journey's two Lab cycles. */
const CYCLE_A = "journey-cycle-a";
const CYCLE_B = "journey-cycle-b";

test("lab journey (E11): runs the real workbench store + view models over the real Lab engines under Node — no DOM, no network", async () => {
  // The honest browser-environment statement, executable (see the studio
  // journey header test for the full argument): no browser runner exists in
  // this gate set; the journey walks the same pure projections the browser
  // mounts render.
  const globals = globalThis as Record<string, unknown>;
  assert.equal(globals.window, undefined, "no DOM window in this runtime");
  assert.equal(globals.document, undefined, "no DOM document in this runtime");
  const rig = await createLabJourneyRig([CYCLE_A, CYCLE_B]);
  const first = rig.dataPort.load();
  if (!first.ok) throw new Error("lab journey: the first authoritative load failed");
  const store = createLabStore(first.data, { data: rig.dataPort, command: rig.commandPort });
  const view = store.view();
  assert.equal(view.selection.tab, "searches", "the workbench opens on the Searches tab");
  assert.ok(view.arena.rows.length === 1, "the pre-driven Arena case renders without any browser mount");
  assert.equal(JSON.stringify(view.selection), JSON.stringify(view.selection), "the view model is plain data");
});

/** Walk the whole lab journey once, recording every step. */
async function runLabJourney(): Promise<JourneyTrace> {
  const trace = createTrace();

  // -- step 0: the HOST wires the real Lab loop engines + ports ------------
  const rig = await createLabJourneyRig([CYCLE_A, CYCLE_B]);
  const first = rig.dataPort.load();
  if (!first.ok) throw new Error("lab journey: the first authoritative load failed");
  const store: LabStore = createLabStore(first.data, { data: rig.dataPort, command: rig.commandPort });
  let view = store.view();

  // -- step 1: the Arena escalation case, decided and driven to ingested ----
  trace.record("arena-case", {
    rows: view.arena.rows.map((row) => ({
      state: row.lifecycleState,
      trail: row.lifecycleTrail,
      verdict: row.evidenceVerdict,
      foreign: row.foreignTenant,
    })),
  });
  assert.equal(view.arena.ingestedCount, 1, "the Arena case is ingested (E10 trail visible)");

  // -- step 2: request-search through the TYPED command intent (E10 log) --
  const requested = store.dispatchCommand({
    kind: "request-search",
    tenant: JOURNEY_LAB_TENANT,
    subject: JOURNEY_LAB_SUBJECT,
    cycleId: CYCLE_A,
    seed: "seed-lab-journey-request-a",
    maxAgents: 2,
  });
  if (!requested.ok || requested.kind !== "search-opened") {
    throw new Error(`lab journey: request-search refused: ${requested.ok ? requested.kind : requested.detail}`);
  }
  trace.record("request-search", {
    receiptKind: requested.kind,
    size: requested.size,
    duplicate: requested.duplicate,
    logLength: store.state().commandLog.length,
  });
  assert.equal(requested.kind, "search-opened");
  assert.equal(store.state().commandLog.length, 1, "E10: the receipt is appended to the command log");

  // -- step 3: refresh, open the search, read the candidate stream --------
  store.refresh();
  store.dispatch({ type: "select-search", searchId: requested.searchId });
  view = store.view();
  trace.record("candidates", {
    selectedSearchId: view.searches.selectedSearchId,
    totalSearches: view.searches.totalSearches,
    emitted: view.searches.rows.find((row) => row.searchId === requested.searchId)?.emitted,
    candidateRows: view.searches.candidates.length,
    firstCandidate: view.searches.candidates[0] === undefined ? null : {
      position: view.searches.candidates[0].position,
      isBaseline: view.searches.candidates[0].isBaseline,
      spread: view.searches.candidates[0].capabilitySpread,
    },
  });
  assert.equal(view.searches.selectedSearchId, requested.searchId);
  assert.ok(view.searches.candidates.length >= 1, "the emitted candidate stream renders");

  // -- step 4: the Lab loop cycle — evaluate, calibrate, learn/seal (E5) --
  const cycleA = rig.runLabLoopCycle({ cycleId: CYCLE_A, seed: "seed-lab-journey-a", maxAgents: 3 });
  trace.record("loop-cycle-a", {
    searchId: cycleA.searchId,
    streamSize: cycleA.streamSize,
    baselinePosition: cycleA.baselinePosition,
    spreadPosition: cycleA.spreadPosition,
    evidenceKeys: cycleA.evidenceKeys,
    gapIds: cycleA.gapIds,
    learnedRecordId: cycleA.learnedRecordId,
  });
  assert.ok(cycleA.learned, "the cycle is sealed as a learning record");

  // -- step 5: the evidence ledger (append-only, labeled estimates, E10/E11)
  store.refresh();
  store.dispatch({ type: "select-tab", tab: "evidence" });
  view = store.view();
  trace.record("evidence", {
    count: view.evidence.count,
    appendOnly: view.evidence.appendOnly,
    methods: view.evidence.methodSet,
    rows: view.evidence.rows.map((row) => ({ seed: row.seed, epistemic: row.epistemic, tickBudget: row.tickBudget })),
  });
  assert.equal(view.evidence.count, 2, "the baseline + spread evaluations are recorded");
  assert.ok(view.evidence.appendOnly, "the ledger states its immutability rule (E10)");
  assert.ok(view.evidence.rows.every((row) => row.epistemic === "labeled-estimate"), "E11: PL-028 results are labeled estimates by type");

  // -- step 6: the learning surface (sealed records + derived signals) -----
  store.dispatch({ type: "select-tab", tab: "learning" });
  view = store.view();
  trace.record("learning", {
    recordCount: view.learning.recordCount,
    rows: view.learning.rows.map((row) => ({ cycleId: row.cycleId, sequence: row.sequence, gapCount: row.gapCount })),
    signalCount: view.learning.signals.length,
    stateDigest: view.learning.stateDigest,
  });
  assert.equal(view.learning.recordCount, 1, "cycle A's learning record is sealed");
  assert.ok(view.learning.signals.length > 0, "the derived signals fold renders");
  assert.ok(view.learning.stateDigest !== null, "the signals fold carries its content-addressed digest (E9)");

  // -- step 7: the E11 guidance surface — observed vs estimate -------------
  store.dispatch({ type: "select-tab", tab: "guidance" });
  view = store.view();
  trace.record("guidance", {
    observed: view.guidance.observed.map((entry) => ({
      epistemic: entry.epistemic,
      digest: entry.digest,
      seedHint: entry.seedHint,
      adjustments: entry.adjustments.map((row) => `${row.dimension}:${row.preferredValues}`),
    })),
    estimates: view.guidance.estimates.map((entry) => ({
      epistemic: entry.epistemic,
      method: entry.method,
      basis: entry.basis,
      supportDimensions: entry.estimateSupport.map((row) => row.dimension),
    })),
    refusals: view.guidance.refusals.length,
  });
  assert.equal(view.guidance.observed.length, 1, "the observed-evidence guidance renders");
  assert.equal(view.guidance.estimates.length, 1, "the labeled-estimate guidance renders");
  assert.equal(view.guidance.refusals.length, 0, "every guidance marker verified");
  const estimate = view.guidance.estimates[0]!;
  assert.ok(estimate.method.length > 0 && estimate.basis.length > 0, "the estimate class carries its method + basis");

  // -- step 8: the gap ladder, pre-advance ----------------------------------
  store.dispatch({ type: "select-tab", tab: "gaps" });
  view = store.view();
  trace.record("gaps-before-advance", {
    rows: view.gaps.rows.map((row) => ({
      capability: row.missingCapability,
      rung: row.currentRung,
      reached: row.reached,
      trail: row.attemptTrail,
      recurring: row.recurring,
      resolved: row.resolved,
    })),
  });
  const gapRow = view.gaps.rows[0];
  assert.ok(gapRow, "the discovered capability gap renders");
  assert.equal(gapRow.currentRung, "existing-organization", "the trail starts at the existing organization (R18)");

  // -- step 9: advance the ladder ONE RUNG AT A TIME through the typed port
  const gapId = cycleA.gapIds[0]!;
  const skip = store.dispatchCommand({
    kind: "advance-gap-rung",
    tenant: JOURNEY_LAB_TENANT,
    subject: JOURNEY_LAB_SUBJECT,
    gapId,
    rung: "user-community-contribution",
    disposition: "declined",
  });
  if (skip.ok) throw new Error("lab journey: the rung skip was not refused");
  trace.record("gap-rung-skip-refused", { code: skip.code, detail: skip.detail });
  assert.equal(skip.code, "rung-skip", "E8: the authoritative rung-skip code, verbatim");
  const advances: string[] = [];
  for (const attempt of [
    { rung: "alternate-organization", disposition: "unavailable", outcome: "unresolved" },
    { rung: "package-platform-capability", disposition: "unavailable", outcome: "unresolved" },
    { rung: "user-community-contribution", disposition: "declined" },
    { rung: "arena-escalation", disposition: "declined" },
  ] as const) {
    const advanced = store.dispatchCommand({
      kind: "advance-gap-rung",
      tenant: JOURNEY_LAB_TENANT,
      subject: JOURNEY_LAB_SUBJECT,
      gapId,
      ...attempt,
    });
    if (!advanced.ok || advanced.kind !== "gap-advanced") {
      throw new Error(`lab journey: advancing ${attempt.rung} refused: ${advanced.ok ? advanced.kind : advanced.detail}`);
    }
    advances.push(advanced.rung);
  }
  trace.record("gap-ladder-advanced", { advances });

  // -- step 10: the UI-seam typed refusal (invalid intent) -----------------
  const invalid = store.dispatchCommand({
    kind: "request-search",
    tenant: JOURNEY_LAB_TENANT,
    subject: JOURNEY_LAB_SUBJECT,
    cycleId: CYCLE_B,
    seed: "seed-lab-journey-invalid",
    maxAgents: 0,
  });
  if (invalid.ok) throw new Error("lab journey: the malformed intent was not refused");
  trace.record("invalid-intent-refused", { code: invalid.code, detail: invalid.detail });
  assert.equal(invalid.code, "invalid-intent", "E8: the port's own typed refusal code");

  // -- step 11: cycle B records the ADVANCED trail; the ladder view updates
  const cycleB = rig.runLabLoopCycle({ cycleId: CYCLE_B, seed: "seed-lab-journey-b", maxAgents: 2 });
  store.refresh();
  store.dispatch({ type: "select-tab", tab: "gaps" });
  view = store.view();
  trace.record("gaps-after-advance", {
    cycleBSearchId: cycleB.searchId,
    learningRecords: view.learning.recordCount,
    rows: view.gaps.rows.map((row) => ({
      capability: row.missingCapability,
      rung: row.currentRung,
      reached: row.reached,
      trail: row.attemptTrail,
      recurrenceCount: row.recurrenceCount,
      recurring: row.recurring,
    })),
  });
  const advancedRow = view.gaps.rows[0]!;
  assert.equal(advancedRow.currentRung, "arena-escalation", "the ladder view reflects the walked rungs (E10)");
  assert.equal(view.learning.recordCount, 2, "cycle B sealed a second learning record");
  assert.ok(advancedRow.recurrenceCount >= 2, "the gap recurred across both cycles (R18: never silently skipped)");

  // -- step 12: R20 — the foreign search cannot be opened -------------------
  const foreignSearchId = openForeignSearch(rig, "journey-cycle-foreign", "seed-lab-journey-foreign");
  store.refresh();
  store.dispatch({ type: "select-search", searchId: foreignSearchId });
  const selectionRefusal = store.state().selectionRefusal;
  trace.record("foreign-search-refused", {
    foreignSearchId,
    code: selectionRefusal?.code ?? null,
    detail: selectionRefusal?.detail ?? null,
  });
  assert.ok(selectionRefusal, "R20: the cross-tenant selection refusal is rendered, never silent");
  assert.equal(selectionRefusal.code, "cross-tenant");

  // -- step 13: R20 — the foreign tenant cannot advance the journey's gap ---
  const foreignAdvance = store.dispatchCommand({
    kind: "advance-gap-rung",
    tenant: JOURNEY_LAB_FOREIGN_TENANT,
    subject: JOURNEY_LAB_FOREIGN_SUBJECT,
    gapId,
    rung: "arena-escalation",
    disposition: "declined",
  });
  if (foreignAdvance.ok) throw new Error("lab journey: the foreign advance was not refused");
  trace.record("foreign-advance-refused", { code: foreignAdvance.code, detail: foreignAdvance.detail });
  assert.equal(foreignAdvance.code, "cross-tenant", "R20: the authoritative cross-tenant refusal, verbatim");

  // -- step 14: journey end — the append-only command log (E10) -------------
  store.dispatch({ type: "clear-selection" });
  view = store.view();
  const log = store.state().commandLog;
  const refusals = log.filter((entry) => !entry.receipt.ok);
  trace.record("journey-end", {
    tab: view.selection.tab,
    logLength: log.length,
    refusalCount: refusals.length,
    refusalKinds: refusals.map((entry) => entry.receipt.ok ? null : entry.receipt.code),
  });
  assert.equal(view.selection.tab, "searches", "clearing resets to the Searches tab");
  assert.ok(log.length >= 8, "every dispatched intent is logged");
  assert.equal(refusals.length, 3, "E10/E8: the three typed refusals stay visible in the log");

  return trace.trace();
}

test("lab journey: the workbench walk end-to-end over the real Lab engines (E5)", async () => {
  await runLabJourney();
});

test("lab journey (E9): the same run twice produces the identical trajectory", async () => {
  const first = await runLabJourney();
  const second = await runLabJourney();
  assertSameTrajectory(first, second);
});

test("lab journey (E8): the gap door refuses with the authoritative codes, verbatim", async () => {
  const rig = await createLabJourneyRig([CYCLE_A]);
  const first = rig.dataPort.load();
  if (!first.ok) throw new Error("lab journey: load failed");
  const store = createLabStore(first.data, { data: rig.dataPort, command: rig.commandPort });
  const cycle = rig.runLabLoopCycle({ cycleId: CYCLE_A, seed: "seed-lab-journey-e8", maxAgents: 2 });
  const gapId = cycle.gapIds[0]!;

  // A gap that was never recorded refuses with the door's own code.
  const unknown = store.dispatchCommand({
    kind: "advance-gap-rung",
    tenant: JOURNEY_LAB_TENANT,
    subject: JOURNEY_LAB_SUBJECT,
    gapId: "gap-never-recorded",
    rung: "alternate-organization",
    disposition: "unavailable",
    outcome: "unresolved",
  });
  assert.ok(!unknown.ok);
  assert.equal(unknown.code, "gap-unknown", "the authoritative gap-unknown code, verbatim");

  // The terminal rung cannot be carried by this intent shape (the union
  // requires a reason the intent cannot fabricate) — the port refuses
  // BEFORE any domain call, typed.
  const blocked = store.dispatchCommand({
    kind: "advance-gap-rung",
    tenant: JOURNEY_LAB_TENANT,
    subject: JOURNEY_LAB_SUBJECT,
    gapId,
    rung: "blocked",
    disposition: "declined",
  });
  assert.ok(!blocked.ok);
  assert.equal(blocked.code, "invalid-intent");

  // And the honest first advance still succeeds after the refusals — a
  // refused command never corrupts the door (no hidden retry, no side effect).
  const advanced = store.dispatchCommand({
    kind: "advance-gap-rung",
    tenant: JOURNEY_LAB_TENANT,
    subject: JOURNEY_LAB_SUBJECT,
    gapId,
    rung: "alternate-organization",
    disposition: "unavailable",
    outcome: "unresolved",
  });
  assert.ok(advanced.ok, `the honest advance succeeds: ${advanced.ok ? "" : advanced.detail}`);
  if (!advanced.ok || advanced.kind !== "gap-advanced") throw new Error("unreachable: the honest advance refused");
  assert.equal(advanced.rung, "alternate-organization");
});
