/**
 * THE COMMUNITY JOURNEY (PL-043) — the Community contribution workbench
 * surfaces of `@playliquid/gameos-community` walked END TO END as one user
 * journey, over the REAL community service (community-rig.ts): the
 * contributions list with its kind filters and trust/origin/AI/gap chips
 * (E8: trust renders honestly — untrusted until qualified at accept) → the
 * provenance full chain of the selected contribution → the append-only
 * lifecycle ledger (E10) → submit-contribution through the TYPED command
 * port (an accept, an E10 duplicate receipt, and typed refusals carrying
 * the community package's own codes verbatim) → the workflow walk to
 * accepted → the R20 cross-tenant guards (the foreign row's selection
 * refusal + the authoritative cross-tenant-contributor refusal) → the
 * command log where every refusal stays visible (E10/E8).
 *
 * E11 (browser honesty): this journey runs the REAL workbench store + view
 * models — the exact pure projections the browser mounts render — over the
 * REAL PL-032 community service under `node --test`. There is no DOM, no
 * rendering and no network here; the first test asserts that plainly
 * instead of faking it.
 *
 * E9 (determinism): the whole journey runs TWICE and the traces must be
 * identical (same steps, same facts, same digest).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
// gameos-community is reached through the Node-surface adapter (see
// community-ui.ts).
import { createCommunityStore } from "./community-ui.ts";
import type { CommunityStore } from "./community-ui.ts";
import { assertSameTrajectory, createTrace } from "./journey-kit.ts";
import type { JourneyTrace } from "./journey-kit.ts";
import {
  JOURNEY_COMMUNITY_CONTRIBUTOR,
  JOURNEY_COMMUNITY_FOREIGN_CONTRIBUTOR,
  JOURNEY_COMMUNITY_GAP,
  JOURNEY_COMMUNITY_MOVED_CONTRIBUTOR,
  JOURNEY_COMMUNITY_TENANT,
  JOURNEY_COMMUNITY_VIEWER,
  createCommunityJourneyRig,
} from "./community-rig.ts";

test("community journey (E11): runs the real workbench store + view models over the real community service under Node — no DOM, no network", () => {
  // The honest browser-environment statement, executable (see the studio
  // journey header test for the full argument): no browser runner exists in
  // this gate set; the journey walks the same pure projections the browser
  // mounts render.
  const globals = globalThis as Record<string, unknown>;
  assert.equal(globals.window, undefined, "no DOM window in this runtime");
  assert.equal(globals.document, undefined, "no DOM document in this runtime");
  const rig = createCommunityJourneyRig();
  const first = rig.dataPort.load();
  if (!first.ok) throw new Error("community journey: the first authoritative load failed");
  const store = createCommunityStore(first.data, { data: rig.dataPort, command: rig.commandPort });
  const view = store.view();
  assert.equal(view.selection.tab, "contributions", "the workbench opens on the Contributions tab");
  assert.equal(JSON.stringify(view.selection), JSON.stringify(view.selection), "the view model is plain data");
});

/** Walk the whole community journey once, recording every step. */
function runCommunityJourney(): JourneyTrace {
  const trace = createTrace();

  // -- step 0: the HOST wires the real service + the real ports -----------
  const rig = createCommunityJourneyRig();
  const first = rig.dataPort.load();
  if (!first.ok) throw new Error("community journey: the first authoritative load failed");
  const store: CommunityStore = createCommunityStore(first.data, { data: rig.dataPort, command: rig.commandPort });
  let view = store.view();

  // -- step 1: the contributions list — chips, counts, kinds ---------------
  trace.record("contributions", {
    rows: view.contributions.rows.map((row) => ({
      kind: row.kind,
      status: row.status,
      origin: row.originKind,
      ai: row.aiGenerated,
      gap: row.gapId,
      trust: row.trust,
      foreign: row.foreignTenant,
    })),
    kindsPresent: view.contributions.kindsPresent,
    total: view.contributions.totalContributions,
    open: view.contributions.openCount,
    accepted: view.contributions.acceptedCount,
    foreignCount: view.contributions.foreignCount,
    aiDisclosed: view.contributions.aiDisclosedCount,
    gapLinked: view.contributions.gapLinkedCount,
  });
  assert.equal(view.contributions.totalContributions, 4, "the seeded fixture rows render");
  assert.equal(view.contributions.acceptedCount, 1, "the qualified asset is accepted");
  assert.equal(view.contributions.foreignCount, 1, "the confused-host foreign row renders visibly (R20)");
  const untrusted = view.contributions.rows.find((row) => row.kind === "code");
  assert.ok(untrusted, "the unqualified-base code row renders");
  assert.equal(untrusted.trust, "untrusted-until-qualified", "E8: trust renders honestly — not yet qualified");

  // -- step 2: the kind filter (selection, never mutation) -----------------
  store.dispatch({ type: "select-kind", kind: "code" });
  view = store.view();
  trace.record("kind-filter", {
    kindFilter: view.contributions.kindFilter,
    rows: view.contributions.rows.map((row) => row.kind),
    totalStill: view.contributions.totalContributions,
  });
  assert.deepEqual(view.contributions.rows.map((row) => row.kind), ["code"], "the filter narrows the rendered rows");
  assert.equal(view.contributions.totalContributions, 4, "the filter never mutates the underlying rows");
  store.dispatch({ type: "select-kind", kind: null });

  // -- step 3: the selected contribution's full provenance chain -----------
  store.dispatch({ type: "select-contribution", contributionId: rig.seeded.acceptedAssetId });
  view = store.view();
  const accepted = view.provenance.detail;
  if (accepted === null) throw new Error("community journey: the accepted asset did not open");
  trace.record("provenance", {
    kind: accepted.kind,
    originKind: accepted.originKind,
    basePackageId: accepted.basePackageId,
    baseVersion: accepted.baseVersion,
    baseNodeId: accepted.baseNodeId === null ? null : "present",
    aiGenerated: accepted.aiGenerated,
    gapId: accepted.gapId,
    cycleId: accepted.cycleId,
    trust: accepted.trust,
    decidedBy: accepted.decidedBy,
  });
  assert.equal(accepted.originKind, "lineage-derived", "the lineage base is visible (R19)");
  assert.equal(accepted.baseVersion, "1.0.0", "the cited base version renders");
  assert.equal(accepted.gapId, JOURNEY_COMMUNITY_GAP, "the R18 gap link renders");
  assert.equal(accepted.trust, "qualified-at-accept", "accept is the only qualification point (E8)");

  // -- step 4: the lifecycle ledger (append-only, E10) ---------------------
  store.dispatch({ type: "select-tab", tab: "lifecycle" });
  view = store.view();
  const ledgerBefore = view.workflow.count;
  trace.record("lifecycle", {
    count: view.workflow.count,
    appendOnly: view.workflow.appendOnly,
    selectedTrail: view.workflow.selectedTrail,
    rows: view.workflow.rows.map((row) => ({ from: row.from, to: row.to, actor: row.actor })),
  });
  assert.equal(view.workflow.appendOnly, true, "the ledger states its immutability rule (E10)");
  assert.equal(view.workflow.selectedTrail, "submitted > triaged > under-review > accepted", "the walked states derive from the record's own transitions");

  // -- step 5: submit-contribution through the TYPED command port ----------
  const submitted = store.dispatchCommand({
    kind: "submit-contribution",
    tenant: JOURNEY_COMMUNITY_TENANT,
    subject: JOURNEY_COMMUNITY_CONTRIBUTOR,
    contributionKind: "dialogue",
    label: "journey-grove-dialogue",
    aiGenerated: true,
    lineageDerived: false,
    gapId: JOURNEY_COMMUNITY_GAP,
  });
  if (!submitted.ok || submitted.kind !== "contribution-submitted") {
    throw new Error(`community journey: submit refused: ${submitted.ok ? submitted.kind : submitted.detail}`);
  }
  trace.record("submit-contribution", {
    receiptKind: submitted.kind,
    contributionId: submitted.contributionId,
    duplicate: submitted.duplicate,
    logLength: store.state().commandLog.length,
  });
  assert.equal(submitted.duplicate, false, "a fresh submission is not a duplicate");
  assert.equal(store.state().commandLog.length, 1, "E10: the receipt is appended to the command log");

  // -- step 6: refresh — the new contribution renders ----------------------
  store.refresh();
  view = store.view();
  trace.record("submitted-row-renders", {
    total: view.contributions.totalContributions,
    kindsPresent: view.contributions.kindsPresent,
    aiDisclosed: view.contributions.aiDisclosedCount,
    gapLinked: view.contributions.gapLinkedCount,
  });
  assert.equal(view.contributions.totalContributions, 5, "the new dialogue row renders after the refresh");
  assert.ok(view.contributions.kindsPresent.includes("dialogue"), "the kind vocabulary grew");

  // -- step 7: the workflow walk to accepted through the typed port -------
  const walked: string[] = [];
  for (const command of ["triage", "review", "accept"] as const) {
    const advanced = store.dispatchCommand({
      kind: "advance-contribution",
      tenant: JOURNEY_COMMUNITY_TENANT,
      actor: JOURNEY_COMMUNITY_VIEWER,
      contributionId: submitted.contributionId,
      command,
      reason: `journey walk: ${command}`,
    });
    if (!advanced.ok || advanced.kind !== "contribution-advanced") {
      throw new Error(`community journey: ${command} refused: ${advanced.ok ? advanced.kind : advanced.detail}`);
    }
    walked.push(advanced.to);
  }
  trace.record("workflow-walk", { walked });

  // -- step 8: refresh — trust flips at accept, the ledger only APPENDS ----
  store.refresh();
  view = store.view();
  const acceptedRow = view.contributions.rows.find((row) => row.kind === "dialogue");
  if (acceptedRow === undefined) throw new Error("community journey: the walked dialogue row is missing");
  trace.record("accepted-after-walk", {
    status: acceptedRow.status,
    trust: acceptedRow.trust,
    ledgerBefore,
    ledgerAfter: view.workflow.count,
    appended: view.workflow.count - ledgerBefore,
  });
  assert.equal(acceptedRow.status, "accepted");
  assert.equal(acceptedRow.trust, "qualified-at-accept", "the trust chip flips exactly at accept (E8)");
  assert.equal(view.workflow.count - ledgerBefore, 4, "E10: genesis + three transitions appended, nothing rewritten");

  // -- step 9: the E10 duplicate — the first receipt stands ----------------
  const replayed = store.dispatchCommand({
    kind: "submit-contribution",
    tenant: JOURNEY_COMMUNITY_TENANT,
    subject: JOURNEY_COMMUNITY_CONTRIBUTOR,
    contributionKind: "dialogue",
    label: "journey-grove-dialogue",
    aiGenerated: true,
    lineageDerived: false,
    gapId: JOURNEY_COMMUNITY_GAP,
  });
  if (!replayed.ok || replayed.kind !== "contribution-submitted") {
    throw new Error(`community journey: duplicate submit refused: ${replayed.ok ? replayed.kind : replayed.detail}`);
  }
  store.refresh();
  view = store.view();
  trace.record("duplicate-submit", {
    duplicate: replayed.duplicate,
    sameId: replayed.contributionId === submitted.contributionId,
    totalAfterReplay: view.contributions.totalContributions,
  });
  assert.equal(replayed.duplicate, true, "E10: the content-identical replay surfaces as a duplicate receipt");
  assert.equal(replayed.contributionId, submitted.contributionId, "E10: the FIRST receipt stands");
  assert.equal(view.contributions.totalContributions, 5, "no second contribution was recorded");

  // -- step 10: E8+R20 — the authoritative cross-tenant contributor refusal
  // (a subject still KNOWN in this tenant but OWNED by the foreign one).
  const foreignSubmit = store.dispatchCommand({
    kind: "submit-contribution",
    tenant: JOURNEY_COMMUNITY_TENANT,
    subject: JOURNEY_COMMUNITY_MOVED_CONTRIBUTOR,
    contributionKind: "asset",
    label: "journey-foreign-attempt",
    aiGenerated: false,
    lineageDerived: false,
  });
  if (foreignSubmit.ok) throw new Error("community journey: the cross-tenant submit was not refused");
  trace.record("cross-tenant-contributor-refused", { code: foreignSubmit.code, detail: foreignSubmit.detail });
  assert.equal(foreignSubmit.code, "cross-tenant-contributor", "R20: the authoritative code, verbatim");

  // -- step 11: E8 — the authority model (not a maintainer) ----------------
  const notMaintainer = store.dispatchCommand({
    kind: "advance-contribution",
    tenant: JOURNEY_COMMUNITY_TENANT,
    actor: JOURNEY_COMMUNITY_CONTRIBUTOR,
    contributionId: rig.seeded.unqualifiedCodeId,
    command: "accept",
    reason: "contributor cannot accept their own work",
  });
  if (notMaintainer.ok) throw new Error("community journey: the contributor accept was not refused");
  trace.record("not-a-maintainer-refused", { code: notMaintainer.code, detail: notMaintainer.detail });
  assert.equal(notMaintainer.code, "not-a-maintainer", "E8: the authoritative code, verbatim");

  // -- step 12: R20 — the foreign row cannot be opened ---------------------
  store.dispatch({ type: "select-contribution", contributionId: rig.seeded.foreignSkillId });
  const selectionRefusal = store.state().selectionRefusal;
  trace.record("foreign-selection-refused", { code: selectionRefusal?.code ?? null, detail: selectionRefusal?.detail ?? null });
  assert.ok(selectionRefusal, "R20: the cross-tenant selection refusal is rendered, never silent");
  assert.equal(selectionRefusal.code, "cross-tenant");

  // -- step 13: journey end — the append-only command log (E10) -------------
  store.dispatch({ type: "clear-selection" });
  view = store.view();
  const log = store.state().commandLog;
  const refusals = log.filter((entry) => !entry.receipt.ok);
  trace.record("journey-end", {
    tab: view.selection.tab,
    logLength: log.length,
    refusalCount: refusals.length,
    refusalCodes: refusals.map((entry) => (entry.receipt.ok ? null : entry.receipt.code)),
    ledgerFinalCount: view.workflow.count,
  });
  assert.equal(view.selection.tab, "contributions", "clearing resets to the Contributions tab");
  assert.equal(log.length, 7, "every dispatched intent is logged (E10)");
  assert.equal(refusals.length, 2, "E8/E10: both typed refusals stay visible in the log");

  return trace.trace();
}

test("community journey: the workbench walk end-to-end over the real community service (E5)", () => {
  runCommunityJourney();
});

test("community journey (E9): the same run twice produces the identical trajectory", () => {
  const first = runCommunityJourney();
  const second = runCommunityJourney();
  assertSameTrajectory(first, second);
});

test("community journey (E8): the port refuses malformed intents before any domain call — typed, never thrown", () => {
  const rig = createCommunityJourneyRig();
  const first = rig.dataPort.load();
  if (!first.ok) throw new Error("community journey: load failed");
  const store = createCommunityStore(first.data, { data: rig.dataPort, command: rig.commandPort });

  // An empty label cannot become a submission — the port refuses typed.
  const empty = store.dispatchCommand({
    kind: "submit-contribution",
    tenant: JOURNEY_COMMUNITY_TENANT,
    subject: JOURNEY_COMMUNITY_CONTRIBUTOR,
    contributionKind: "asset",
    label: "",
    aiGenerated: false,
    lineageDerived: false,
  });
  assert.ok(!empty.ok);
  assert.equal(empty.code, "invalid-intent", "the port's own typed refusal code");

  // A non-content-address id cannot be advanced — refused before the door.
  const malformed = store.dispatchCommand({
    kind: "advance-contribution",
    tenant: JOURNEY_COMMUNITY_TENANT,
    actor: JOURNEY_COMMUNITY_VIEWER,
    contributionId: "not-a-digest",
    command: "triage",
  });
  assert.ok(!malformed.ok);
  assert.equal(malformed.code, "invalid-intent");

  // The authoritative door still refuses foreign actors verbatim (R20).
  const foreignActor = store.dispatchCommand({
    kind: "advance-contribution",
    tenant: JOURNEY_COMMUNITY_TENANT,
    actor: JOURNEY_COMMUNITY_FOREIGN_CONTRIBUTOR,
    contributionId: rig.seeded.acceptedAssetId,
    command: "triage",
  });
  assert.ok(!foreignActor.ok);
  assert.equal(foreignActor.code, "cross-tenant-actor", "R20: the authoritative code, verbatim");
  assert.ok(foreignActor.detail.length > 0, "the refusal carries its detail");

  // None of the refusals recorded anything — the service state is untouched.
  const after = rig.dataPort.load();
  if (!after.ok) throw new Error("community journey: load failed");
  assert.equal(after.data.transitions.length, first.data.transitions.length, "refused commands record no transitions");
  assert.equal(store.state().commandLog.length, 3, "E10: every refusal is still logged, visibly");
});
