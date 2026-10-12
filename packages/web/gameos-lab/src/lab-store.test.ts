/**
 * Lab workbench STORE tests: the single UI-state owner. Mirrors the game-ui
 * studio-store discipline (PL-033): subscription semantics (one
 * notification per committed transition), the serialized re-entrant
 * dispatch queue, refresh success/failure through the `LabDataPort` seam,
 * the APPEND-ONLY command log over the `LabCommandPort` seam (E8/E10 —
 * accepted receipts AND typed refusals are both visible states), the typed
 * cross-tenant selection refusals (R20, negative-tested) and the
 * identity-stable React projection cache.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLabStore } from "./lab-store.ts";
import { projectStateCached } from "./app/use-lab-store.ts";
import { ScriptedLabCommandPort, ScriptedLabDataPort, StaticLabDataPort } from "./fakes.ts";
import {
  DEMO_LAB_FOREIGN_TENANT,
  DEMO_LAB_FOREIGN_SUBJECT,
  demoLabSnapshot,
} from "./fixtures/demo.ts";
import type { LabDataSnapshot } from "./view/lab-view.ts";
import type { LabAction } from "./lab-actions.ts";
import type { LabCommandIntent, LabCommandReceipt } from "./ports.ts";

const snapshot = await demoLabSnapshot();

test("the store starts from the given snapshot with no listeners", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  assert.equal(store.state().data, snapshot);
  assert.equal(store.state().selection.tab, "searches");
  assert.equal(store.state().selection.searchId, null);
  assert.equal(store.state().loadError, null);
  assert.equal(store.state().selectionRefusal, null);
  assert.equal(store.state().commandLog.length, 0);
  const view = store.view();
  assert.equal(view.searches.totalSearches, snapshot.searches.length);
  assert.equal(view.evidence.count, snapshot.evidence.length);
  assert.equal(view.learning.recordCount, snapshot.learningRecords.length);
});

test("a committed transition notifies each listener exactly once", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  let first = 0;
  let second = 0;
  store.subscribe(() => {
    first += 1;
  });
  store.subscribe(() => {
    second += 1;
  });
  store.dispatch({ type: "select-tab", tab: "evidence" });
  assert.equal(first, 1);
  assert.equal(second, 1);
  store.dispatch({ type: "select-tab", tab: "guidance" });
  assert.equal(first, 2);
  assert.equal(second, 2);
});

test("an unknown action commits nothing and notifies nobody", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const before = store.state();
  store.dispatch({ type: "not-a-real-action" } as unknown as LabAction);
  assert.equal(notifications, 0);
  assert.equal(store.state(), before);
});

test("selecting an unknown search is a no-op, never a crash", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  const before = store.state();
  store.dispatch({ type: "select-search", searchId: "search-does-not-exist" });
  assert.equal(store.state(), before);
});

test("re-entrant dispatches from a listener are serialized in order", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  const seenTabs: string[] = [];
  let reEntryGuard = 0;
  store.subscribe(() => {
    seenTabs.push(store.state().selection.tab);
    if (reEntryGuard === 0) {
      reEntryGuard += 1;
      // Dispatched DURING a listener: must be queued, not interleaved.
      store.dispatch({ type: "select-tab", tab: "arena" });
    }
  });
  store.dispatch({ type: "select-tab", tab: "learning" });
  assert.deepEqual(seenTabs, ["learning", "arena"]);
  assert.equal(store.state().selection.tab, "arena");
});

test("refresh success replaces the data snapshot, preserves selection + log", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  const viewerSearch = snapshot.searches.find(
    (search) => search.tenant === snapshot.viewer.tenant,
  )!;
  store.dispatch({ type: "select-search", searchId: viewerSearch.searchId });
  store.dispatch({ type: "load-failed", detail: "stale error" });
  const fresh: LabDataSnapshot = { ...snapshot, searches: [...snapshot.searches] };
  const store2 = createLabStore(snapshot, { data: new StaticLabDataPort(fresh), command: new ScriptedLabCommandPort([]) });
  store2.dispatch({ type: "select-search", searchId: viewerSearch.searchId });
  store2.refresh();
  assert.equal(store2.state().data, fresh);
  assert.equal(store2.state().loadError, null);
  assert.equal(store2.state().selection.searchId, viewerSearch.searchId);
  // The original store's failed load stays recorded until ITS port reloads.
  assert.equal(store.state().loadError, "stale error");
});

test("refresh failure records the typed error verbatim and keeps rendering", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot, { failWith: "port down for maintenance" }),
    command: new ScriptedLabCommandPort([]),
  });
  const before = store.view();
  store.refresh();
  assert.equal(store.state().loadError, "port down for maintenance");
  const after = store.view();
  assert.equal(after.evidence.count, before.evidence.count);
  assert.equal(after.arena.totalCases, before.arena.totalCases);
});

test("a scripted data port serves results in order then sticks on the last", () => {
  const fresh: LabDataSnapshot = { ...snapshot, evidence: [...snapshot.evidence] };
  const outage = { ok: false as const, code: "load-failed" as const, detail: "scripted outage" };
  const store = createLabStore(snapshot, {
    data: new ScriptedLabDataPort([{ ok: true as const, data: fresh }, outage]),
    command: new ScriptedLabCommandPort([]),
  });
  store.refresh();
  assert.equal(store.state().data, fresh);
  store.refresh();
  assert.equal(store.state().loadError, "scripted outage");
  store.refresh();
  assert.equal(store.state().loadError, "scripted outage", "sticks on the last scripted result");
});

test("an empty data script fails typed, never by throwing", () => {
  const store = createLabStore(snapshot, {
    data: new ScriptedLabDataPort([]),
    command: new ScriptedLabCommandPort([]),
  });
  store.refresh();
  assert.equal(store.state().loadError, "scripted port has no results");
});

test("dispatchCommand appends intent + receipt to the append-only log (E10)", () => {
  const ok: LabCommandReceipt = {
    ok: true,
    kind: "search-opened",
    searchId: "search-x",
    size: 12,
    spaceDigest: "sha256:abc",
    position: 0,
    duplicate: false,
  };
  const refused: LabCommandReceipt = { ok: false, code: "invalid-seed", detail: "seed not valid evaluation seed text" };
  const command = new ScriptedLabCommandPort([ok, refused]);
  const store = createLabStore(snapshot, { data: new StaticLabDataPort(snapshot), command });
  const intent: LabCommandIntent = {
    kind: "request-search",
    tenant: snapshot.viewer.tenant,
    subject: snapshot.viewer.subject,
    cycleId: "cycle-3",
    seed: "seed-3",
    maxAgents: 2,
  };
  const first = store.dispatchCommand(intent);
  assert.equal(first, ok);
  const second = store.dispatchCommand(intent);
  assert.equal(second, refused);
  // BOTH outcomes are visible log states, in dispatch order — a refusal
  // is never silently dropped (E8).
  assert.equal(store.state().commandLog.length, 2);
  assert.equal(store.state().commandLog[0]!.receipt, ok);
  assert.equal(store.state().commandLog[1]!.receipt, refused);
  assert.deepEqual(command.received, [intent, intent]);
});

test("malformed command intents are refused with the typed invalid-intent code (E8)", () => {
  const command = new ScriptedLabCommandPort([]);
  const store = createLabStore(snapshot, { data: new StaticLabDataPort(snapshot), command });
  const base = {
    tenant: snapshot.viewer.tenant,
    subject: snapshot.viewer.subject,
  };
  const emptyCycle: LabCommandIntent = {
    ...base,
    kind: "request-search",
    cycleId: "",
    seed: "seed",
    maxAgents: 2,
  } as LabCommandIntent;
  const zeroAgents: LabCommandIntent = {
    ...base,
    kind: "request-search",
    cycleId: "cycle-9",
    seed: "seed",
    maxAgents: 0,
  } as LabCommandIntent;
  const terminalRung: LabCommandIntent = {
    ...base,
    kind: "advance-gap-rung",
    gapId: "gap-1",
    rung: "blocked",
    disposition: "attempted",
  } as LabCommandIntent;
  for (const intent of [emptyCycle, zeroAgents, terminalRung]) {
    const receipt = store.dispatchCommand(intent);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.code, "invalid-intent");
    // The refusal is a VISIBLE log state, never silent (E8).
    assert.equal(store.state().commandLog.at(-1)!.receipt, receipt);
  }
});

test("a cross-tenant search selection refuses with the typed cross-tenant code (R20/E8)", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  const foreign = snapshot.searches.find(
    (search) => search.tenant === DEMO_LAB_FOREIGN_TENANT,
  )!;
  assert.ok(foreign !== undefined, "the demo includes one foreign-tenant search");
  const before = store.state().selection;
  store.dispatch({ type: "select-search", searchId: foreign.searchId });
  const refusal = store.state().selectionRefusal;
  assert.ok(refusal !== null);
  assert.equal(refusal.code, "cross-tenant");
  assert.ok(refusal.detail.includes(String(DEMO_LAB_FOREIGN_TENANT)));
  // The selection itself did NOT move to the foreign entity.
  assert.equal(store.state().selection, before);
  // A subsequent legal selection clears the refusal.
  const viewerSearch = snapshot.searches.find(
    (search) => search.tenant === snapshot.viewer.tenant,
  )!;
  store.dispatch({ type: "select-search", searchId: viewerSearch.searchId });
  assert.equal(store.state().selectionRefusal, null);
  assert.equal(store.state().selection.searchId, viewerSearch.searchId);
});

test("a cross-tenant gap selection refuses with the typed cross-tenant code (R20/E8)", () => {
  const confused: LabDataSnapshot = {
    ...snapshot,
    learningRecords: snapshot.learningRecords.map((record) => ({
      ...record,
      tenant: DEMO_LAB_FOREIGN_TENANT,
    })),
  };
  const store = createLabStore(confused, {
    data: new StaticLabDataPort(confused),
    command: new ScriptedLabCommandPort([]),
  });
  const capability = snapshot.gapSummaries[0]!.missingCapability;
  const before = store.state().selection;
  store.dispatch({ type: "select-gap", capability });
  const refusal = store.state().selectionRefusal;
  assert.ok(refusal !== null);
  assert.equal(refusal.code, "cross-tenant");
  assert.equal(store.state().selection, before);
});

test("clear-selection resets the selection and any recorded refusal", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  store.dispatch({ type: "select-tab", tab: "gaps" });
  store.dispatch({ type: "select-search", searchId: snapshot.searches.at(-1)!.searchId });
  store.dispatch({ type: "clear-selection" });
  assert.equal(store.state().selection.tab, "searches");
  assert.equal(store.state().selection.searchId, null);
  assert.equal(store.state().selectionRefusal, null);
});

test("evidence provenance renders in the view (content key, replay id, recorded order)", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  const rows = store.view().evidence.rows;
  assert.ok(rows.length >= 3);
  for (const row of rows) {
    assert.match(row.contentKey, /^sha256:[0-9a-f]{12}$/);
    assert.ok(row.replayId.length > 0, "the replay provenance id renders");
    assert.ok(row.seed.length > 0, "the reproducibility seed renders");
    assert.ok(row.candidateDigest.startsWith("sha256:"));
  }
  const times = rows.map((row) => row.recordedAt);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), "append-faithful order (E10)");
});

test("projectStateCached: one committed state → one identity-stable projection", () => {
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  const state = store.state();
  assert.ok(projectStateCached(state) === projectStateCached(state));
  store.dispatch({ type: "select-tab", tab: "evidence" });
  const next = store.state();
  assert.ok(next !== state);
  assert.ok(projectStateCached(next) !== projectStateCached(state));
  assert.equal(projectStateCached(next).selection.tab, "evidence");
});

test("the confused-host foreign subject never mints viewer-scoped state", () => {
  // R20 sanity: the snapshot's viewer scope is what selection intents
  // carry; the demo's foreign tenant/subject stay distinguishable.
  assert.notEqual(DEMO_LAB_FOREIGN_TENANT, snapshot.viewer.tenant);
  assert.ok(DEMO_LAB_FOREIGN_SUBJECT !== snapshot.viewer.subject);
  const store = createLabStore(snapshot, {
    data: new StaticLabDataPort(snapshot),
    command: new ScriptedLabCommandPort([]),
  });
  assert.equal(store.view().searches.rows.filter((row) => row.foreignTenant).length, 1);
});
