/**
 * Studio store tests: the single UI-state owner. Covers subscription
 * semantics (one notification per committed transition), the serialized
 * re-entrant dispatch queue, the refresh success/failure paths through the
 * `StudioDataPort` seam, unsubscribe, and view projection freshness.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudioStore } from "./studio-store.ts";
import { ScriptedStudioDataPort, StaticStudioDataPort } from "./fakes.ts";
import { demoStudioSnapshot } from "./fixtures/demo.ts";
import type { StudioDataResult } from "./ports.ts";
import type { StudioAction } from "./studio-actions.ts";

const snapshot = await demoStudioSnapshot();

test("the store starts from the given snapshot with no listeners", () => {
  const store = createStudioStore(snapshot, new StaticStudioDataPort(snapshot));
  assert.equal(store.state().data, snapshot);
  assert.equal(store.state().selection.tab, "packages");
  assert.equal(store.state().loadError, null);
  const view = store.view();
  assert.equal(view.packages.cards.length, snapshot.packages.length);
  assert.equal(view.selection.tab, "packages");
});

test("a committed transition notifies each listener exactly once", () => {
  const store = createStudioStore(snapshot, new StaticStudioDataPort(snapshot));
  let first = 0;
  let second = 0;
  store.subscribe(() => {
    first += 1;
  });
  store.subscribe(() => {
    second += 1;
  });
  store.dispatch({ type: "select-tab", tab: "session" });
  assert.equal(first, 1);
  assert.equal(second, 1);
  store.dispatch({ type: "select-tab", tab: "tools" });
  assert.equal(first, 2);
  assert.equal(second, 2);
});

test("a no-op action commits nothing and notifies nobody", () => {
  const store = createStudioStore(snapshot, new StaticStudioDataPort(snapshot));
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const before = store.state();
  store.dispatch({ type: "not-a-real-action" } as unknown as StudioAction);
  assert.equal(notifications, 0);
  assert.equal(store.state(), before);
});

test("re-entrant dispatches from a listener are serialized in order", () => {
  const store = createStudioStore(snapshot, new StaticStudioDataPort(snapshot));
  const seenTabs: string[] = [];
  let reEntryGuard = 0;
  store.subscribe(() => {
    seenTabs.push(store.state().selection.tab);
    if (reEntryGuard === 0) {
      reEntryGuard += 1;
      // Dispatched DURING a listener: must be queued, not interleaved.
      store.dispatch({ type: "select-tab", tab: "tools" });
    }
  });
  store.dispatch({ type: "select-tab", tab: "session" });
  // Both transitions committed, in order, exactly one notification each.
  assert.deepEqual(seenTabs, ["session", "tools"]);
  assert.equal(store.state().selection.tab, "tools");
});

test("unsubscribe stops notifications but the store keeps working", () => {
  const store = createStudioStore(snapshot, new StaticStudioDataPort(snapshot));
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
  store.dispatch({ type: "select-tab", tab: "session" });
  unsubscribe();
  store.dispatch({ type: "select-tab", tab: "tools" });
  assert.equal(notifications, 1);
  assert.equal(store.state().selection.tab, "tools");
});

test("refresh success replaces data, appends the timeline, clears errors", () => {
  const store = createStudioStore(snapshot, new StaticStudioDataPort(snapshot));
  store.dispatch({ type: "select-package", packageId: snapshot.packages[0]!.identity.id });
  store.dispatch({ type: "load-failed", detail: "stale error" });
  const opsBefore = store.state().operations.length;
  store.refresh();
  const after = store.state();
  assert.equal(after.loadError, null);
  assert.equal(after.selection.packageId, snapshot.packages[0]!.identity.id);
  assert.equal(after.operations.length, opsBefore + snapshot.operations.length);
});

test("refresh failure records the typed error verbatim and keeps rendering", () => {
  const store = createStudioStore(
    snapshot,
    new StaticStudioDataPort(snapshot, { failWith: "port down for maintenance" }),
  );
  const before = store.view();
  store.refresh();
  assert.equal(store.state().loadError, "port down for maintenance");
  const after = store.view();
  assert.equal(after.packages.cards.length, before.packages.cards.length);
  assert.equal(after.tools.jobs.length, before.tools.jobs.length);
});

test("a scripted port serves results in order then sticks on the last", () => {
  const fresh: StudioDataResult = {
    ok: true,
    data: { ...snapshot, jobs: [...snapshot.jobs] },
  };
  const outage: StudioDataResult = { ok: false, code: "load-failed", detail: "scripted outage" };
  const store = createStudioStore(snapshot, new ScriptedStudioDataPort([fresh, outage]));
  store.refresh();
  assert.equal(store.state().data, fresh.data);
  store.refresh();
  assert.equal(store.state().loadError, "scripted outage");
  // Sticks on the last scripted result.
  store.refresh();
  assert.equal(store.state().loadError, "scripted outage");
});

test("an empty script fails typed, never by throwing", () => {
  const store = createStudioStore(snapshot, new ScriptedStudioDataPort([]));
  store.refresh();
  assert.equal(store.state().loadError, "scripted port has no results");
});

test("view() always reflects the CURRENT committed state", () => {
  const store = createStudioStore(snapshot, new StaticStudioDataPort(snapshot));
  assert.equal(store.view().selection.tab, "packages");
  store.dispatch({ type: "select-tab", tab: "avatars" });
  assert.equal(store.view().selection.tab, "avatars");
  store.dispatch({ type: "clear-selection" });
  assert.equal(store.view().selection.tab, "packages");
});
