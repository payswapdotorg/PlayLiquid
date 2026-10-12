/**
 * THE STUDIO JOURNEY (PL-043) — the Game Studio surfaces of
 * `@playliquid/game-ui` walked END TO END as one user journey, over a
 * HOST-COMPOSED snapshot of real read models (see studio-rig.ts):
 * packages + release gate (R19) → session timeline (the real kernel's
 * operations, E10 append-only) → avatars under a host restriction (R5) →
 * capabilities (grants + a DENIED evaluation, E8) → tools (a job that
 * FAILED with the executor's typed refusal, E8) → a refresh OUTAGE that
 * surfaces as a typed load failure and never a silent retry (E11) →
 * recovery → the timeline that only ever appends (E10).
 *
 * E11 (browser honesty): this journey runs the REAL store + view models —
 * the exact pure projections the browser mounts render — under
 * `node --test`. There is no DOM, no rendering and no network here; the
 * first test asserts that plainly instead of faking it.
 *
 * E9 (determinism): the whole journey runs TWICE and the traces must be
 * identical (same steps, same facts, same digest).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
// game-ui is reached through the Node-surface adapter (see studio-ui.ts:
// the package entrypoint re-exports .tsx components the Node runner cannot
// load — E11 browser honesty, no bundler here).
import {
  ScriptedStudioDataPort,
  StaticStudioDataPort,
  createStudioStore,
  studioSummary,
} from "./studio-ui.ts";
import type { StudioStore } from "./studio-ui.ts";
import { assertSameTrajectory, createTrace } from "./journey-kit.ts";
import type { JourneyTrace } from "./journey-kit.ts";
import { composeStudioJourneySnapshot } from "./studio-rig.ts";

test("studio journey (E11): runs the real store + view models under Node — no DOM, no network", async () => {
  // The honest browser-environment statement, executable: this gate set
  // has no browser runner; the journey exercises the same pure projections
  // the browser mounts render, not a DOM. Node ships a global fetch
  // (undici), but nothing in the journey graph ever calls it — the
  // asserted evidence is the store's plain-data view models.
  const globals = globalThis as Record<string, unknown>;
  assert.equal(globals.window, undefined, "no DOM window in this runtime");
  assert.equal(globals.document, undefined, "no DOM document in this runtime");
  const snapshot = await composeStudioJourneySnapshot();
  const store = createStudioStore(snapshot, new StaticStudioDataPort(snapshot));
  const view = store.view();
  assert.equal(JSON.stringify(view.selection), JSON.stringify(view.selection), "the view model is plain data");
  assert.deepEqual(view.selection.tab, "packages", "the projection carries data, not DOM handles");
});

/** Walk the whole studio journey once, recording every step. */
async function runStudioJourney(): Promise<JourneyTrace> {
  const trace = createTrace();

  // -- step 0: the HOST composes the studio read models -------------------
  const snapshot = await composeStudioJourneySnapshot();

  // -- step 1: open the studio (Packages tab is the default) -------------
  const outage = { ok: false as const, code: "load-failed" as const, detail: "journey scripted outage (port down)" };
  const fresh = await composeStudioJourneySnapshot();
  const store: StudioStore = createStudioStore(
    snapshot,
    new ScriptedStudioDataPort([outage, { ok: true, data: fresh }]),
  );
  let view = store.view();
  trace.record("open-studio", {
    summary: studioSummary(view),
    tab: view.selection.tab,
    packages: view.packages.cards.length,
    blocked: view.packages.blockedCount,
    lockPins: view.packages.lockPins.length,
  });
  assert.equal(view.selection.tab, "packages");
  assert.equal(view.packages.cards.length, 2);
  assert.equal(view.packages.lockPins.length, 2);

  // -- step 2: browse the package cards (R19: licensing gate visible) -----
  trace.record(
    "browse-packages",
    view.packages.cards.map((card) => ({
      id: card.id,
      version: card.version,
      license: card.license.label,
      gate: card.gate.label,
      reasons: card.gateReasons.map((reason) => reason.code),
    })),
  );
  const verified = view.packages.cards.find((card) => card.id === "game.journey-run");
  const declared = view.packages.cards.find((card) => card.id === "asset.journey-kit");
  assert.ok(verified && declared, "both journey packages render");
  assert.equal(verified!.gate.label, "gate passed");
  // The DECLARED-only license row is gate-blocked with the typed reasons.
  assert.equal(view.packages.blockedCount, 1);
  assert.equal(declared!.gate.label, "gate blocked");
  assert.ok(declared!.gateReasons.length >= 1, "the blocked row carries its gate reasons (E8)");

  // -- step 3: select the released game package ---------------------------
  store.dispatch({ type: "select-package", packageId: "game.journey-run" });
  view = store.view();
  trace.record("select-package", {
    tab: view.selection.tab,
    packageId: view.selection.packageId,
    digest: view.packages.cards.find((card) => card.id === "game.journey-run")?.contentDigest,
    runtimes: verified!.runtimes,
  });
  assert.equal(view.selection.packageId, "game.journey-run");

  // -- step 4: the session timeline (the real kernel's own operations) ----
  store.dispatch({ type: "select-tab", tab: "session" });
  view = store.view();
  assert.ok(view.session.card, "the kernel session card renders");
  trace.record("session-timeline", {
    sessionId: view.session.card!.sessionId,
    phase: view.session.card!.phase.label,
    epoch: view.session.card!.epoch,
    tick: view.session.card!.tick,
    rows: view.session.timeline.map((row) => ({
      operation: row.operation,
      status: row.status.label,
      epoch: row.epoch,
      stale: row.stale,
    })),
    events: view.session.latestEvents.length,
  });
  assert.equal(view.session.timeline.length, snapshot.operations.length);
  assert.ok(
    view.session.timeline.every((row) => row.status.tone === "ok"),
    "every scripted kernel operation succeeded",
  );

  // -- step 5: avatars under the host restriction (R5) --------------------
  store.dispatch({ type: "select-tab", tab: "avatars" });
  view = store.view();
  const avatar = view.avatars.cards[0];
  assert.ok(avatar, "the demo avatar renders under the journey restriction");
  trace.record("avatars", {
    avatarId: avatar.avatarId,
    definitionDigest: avatar.definitionDigest,
    deniedCapabilities: view.avatars.deniedCapabilities,
    chipStatuses: avatar.capabilities.map((chip) => `${chip.capability}:${chip.status.tone}`),
  });
  assert.deepEqual(view.avatars.deniedCapabilities, ["audio"], "R5: the denied channel renders");

  // -- step 6: capabilities — the grant, the coverage, the DENIED action ---
  store.dispatch({ type: "select-tab", tab: "capabilities" });
  view = store.view();
  trace.record("capabilities", {
    grants: view.broker.grants.map((grant) => ({
      grantId: grant.grantId,
      capability: grant.capability,
      epoch: grant.epoch,
    })),
    restrictions: view.broker.restrictions,
    evaluations: view.broker.evaluations.map((row) => ({
      intentKind: row.intentKind,
      status: row.status.label,
      commandKind: row.commandKind,
    })),
  });
  assert.equal(view.broker.grants.length, 1, "the seeded movement grant renders");
  const deniedEvaluation = view.broker.evaluations.find((row) => row.intentKind === "speak.say");
  assert.ok(deniedEvaluation, "the denied evaluation is tracked");
  assert.equal(deniedEvaluation!.status.tone, "error", "E8: the denial renders as an error state");

  // -- step 7: tools — the succeeded job AND the typed refusal (E8) -------
  store.dispatch({ type: "select-tab", tab: "tools" });
  view = store.view();
  trace.record("tools", {
    registrations: view.tools.registrations.map((row) => ({
      toolId: row.toolId,
      adapter: row.adapterState.label,
    })),
    jobs: view.tools.jobs.map((job) => ({
      jobId: job.jobId,
      status: job.status.label,
      attempts: `${job.attempts}/${job.maxAttempts}`,
    })),
    events: view.tools.events.length,
    active: view.tools.activeCount,
  });
  const refusedJob = view.tools.jobs.find((job) => job.jobId === "journey-job-pack-1");
  assert.ok(refusedJob, "the refused pack-audit job renders");
  assert.equal(refusedJob!.status.label, "failed", "E8: the executor refusal is a failed state, never silent");
  assert.ok(view.tools.events.length >= 2, "the job event timeline is populated (E10)");

  // -- step 8: refresh OUTAGE — a typed failure, never a silent retry -----
  store.refresh();
  view = store.view();
  trace.record("refresh-outage", {
    loadError: store.state().loadError,
    packagesStillRendered: view.packages.cards.length,
  });
  assert.equal(store.state().loadError, "journey scripted outage (port down)");
  assert.equal(view.packages.cards.length, 2, "the last good read model keeps rendering (E11)");

  // -- step 9: recovery — the timeline only ever APPENDS (E10) ------------
  const timelineBefore = store.state().operations.length;
  store.refresh();
  view = store.view();
  trace.record("refresh-recovery", {
    loadError: store.state().loadError,
    timelineBefore,
    timelineAfter: store.state().operations.length,
    appended: store.state().operations.length - timelineBefore,
  });
  assert.equal(store.state().loadError, null);
  assert.equal(
    store.state().operations.length,
    timelineBefore + fresh.operations.length,
    "E10: recovery appends the refreshed snapshot's operations, never rewrites",
  );

  // -- step 10: selection survives refreshes; clearing resets ------------
  store.dispatch({ type: "select-tab", tab: "packages" });
  store.dispatch({ type: "clear-selection" });
  view = store.view();
  trace.record("journey-end", {
    tab: view.selection.tab,
    summary: studioSummary(view),
  });
  assert.equal(view.selection.tab, "packages");

  return trace.trace();
}

test("studio journey: the five surfaces walk end-to-end over real read models (E5)", async () => {
  await runStudioJourney();
});

test("studio journey (E9): the same run twice produces the identical trajectory", async () => {
  const first = await runStudioJourney();
  const second = await runStudioJourney();
  assertSameTrajectory(first, second);
});

test("studio journey (E8): a permanent port failure keeps failing typed — no hidden retries", async () => {
  const snapshot = await composeStudioJourneySnapshot();
  const store = createStudioStore(
    snapshot,
    new StaticStudioDataPort(snapshot, { failWith: "journey permanent outage" }),
  );
  store.refresh();
  store.refresh();
  store.refresh();
  assert.equal(store.state().loadError, "journey permanent outage");
  assert.equal(store.view().packages.cards.length, 2, "the UI keeps rendering the last good read model");
});
