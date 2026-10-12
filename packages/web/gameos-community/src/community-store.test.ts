/**
 * Community workbench STORE tests: the single UI-state owner. Mirrors the
 * game-ui/gameos-lab store discipline: subscription semantics (one
 * notification per committed transition), the serialized re-entrant
 * dispatch queue, refresh success/failure through the `CommunityDataPort`
 * seam, the APPEND-ONLY command log over the `CommunityCommandPort` seam
 * (E8/E10 — accepted receipts AND typed refusals are both visible
 * states), the typed cross-tenant selection refusals (R20,
 * negative-tested) and the identity-stable React projection cache.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommunityStore } from "./community-store.ts";
import { projectStateCached } from "./app/use-community-store.ts";
import {
  ScriptedCommunityCommandPort,
  ScriptedCommunityDataPort,
  StaticCommunityDataPort,
} from "./fakes.ts";
import {
  DEMO_COMMUNITY_FOREIGN_TENANT,
  demoCommunitySnapshot,
} from "./fixtures/demo.ts";
import type { CommunityDataSnapshot } from "./view/community-view.ts";
import type { CommunityAction } from "./community-actions.ts";
import type { CommunityCommandIntent, CommunityCommandReceipt } from "./ports.ts";

const snapshot = demoCommunitySnapshot();

test("the store starts from the given snapshot with no listeners", () => {
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(snapshot),
    command: new ScriptedCommunityCommandPort([]),
  });
  assert.equal(store.state().data, snapshot);
  assert.equal(store.state().selection.tab, "contributions");
  assert.equal(store.state().selection.contributionId, null);
  assert.equal(store.state().selection.kindFilter, null);
  assert.equal(store.state().loadError, null);
  assert.equal(store.state().selectionRefusal, null);
  assert.equal(store.state().commandLog.length, 0);
  const view = store.view();
  assert.equal(view.contributions.totalContributions, snapshot.contributions.length);
  assert.equal(view.workflow.count, snapshot.transitions.length);
});

test("a committed transition notifies each listener exactly once", () => {
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(snapshot),
    command: new ScriptedCommunityCommandPort([]),
  });
  let first = 0;
  let second = 0;
  store.subscribe(() => {
    first += 1;
  });
  store.subscribe(() => {
    second += 1;
  });
  store.dispatch({ type: "select-tab", tab: "lifecycle" });
  assert.equal(first, 1);
  assert.equal(second, 1);
  store.dispatch({ type: "select-tab", tab: "provenance" });
  assert.equal(first, 2);
  assert.equal(second, 2);
});

test("an unknown action commits nothing and notifies nobody", () => {
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(snapshot),
    command: new ScriptedCommunityCommandPort([]),
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const before = store.state();
  store.dispatch({ type: "not-a-real-action" } as unknown as CommunityAction);
  assert.equal(notifications, 0);
  assert.equal(store.state(), before);
});

test("selecting an unknown contribution is a no-op, never a crash", () => {
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(snapshot),
    command: new ScriptedCommunityCommandPort([]),
  });
  const before = store.state();
  store.dispatch({ type: "select-contribution", contributionId: "sha256:" + "0".repeat(64) });
  assert.equal(store.state(), before);
});

test("re-entrant dispatches from a listener are serialized in order", () => {
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(snapshot),
    command: new ScriptedCommunityCommandPort([]),
  });
  const seenTabs: string[] = [];
  let reEntryGuard = 0;
  store.subscribe(() => {
    seenTabs.push(store.state().selection.tab);
    if (reEntryGuard === 0) {
      reEntryGuard += 1;
      // Dispatched DURING a listener: must be queued, not interleaved.
      store.dispatch({ type: "select-tab", tab: "lifecycle" });
    }
  });
  store.dispatch({ type: "select-tab", tab: "provenance" });
  assert.deepEqual(seenTabs, ["provenance", "lifecycle"]);
  assert.equal(store.state().selection.tab, "lifecycle");
});

test("refresh success replaces the data snapshot, preserves selection + log", () => {
  const fresh: CommunityDataSnapshot = {
    ...snapshot,
    contributions: [...snapshot.contributions],
  };
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(fresh),
    command: new ScriptedCommunityCommandPort([]),
  });
  const viewerContribution = snapshot.contributions.find(
    (record) => record.tenant === snapshot.viewer.tenant,
  )!;
  store.dispatch({ type: "select-contribution", contributionId: String(viewerContribution.contributionId) });
  store.dispatch({ type: "load-failed", detail: "stale error" });
  store.refresh();
  assert.equal(store.state().data, fresh);
  assert.equal(store.state().loadError, null);
  assert.equal(store.state().selection.contributionId, String(viewerContribution.contributionId));
});

test("refresh failure records the typed error verbatim and keeps rendering", () => {
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(snapshot, { failWith: "port down for maintenance" }),
    command: new ScriptedCommunityCommandPort([]),
  });
  const before = store.view();
  store.refresh();
  assert.equal(store.state().loadError, "port down for maintenance");
  const after = store.view();
  assert.equal(after.contributions.totalContributions, before.contributions.totalContributions);
  assert.equal(after.workflow.count, before.workflow.count);
});

test("a scripted data port serves results in order then sticks on the last", () => {
  const fresh: CommunityDataSnapshot = { ...snapshot, contributions: [...snapshot.contributions] };
  const outage = { ok: false as const, code: "load-failed" as const, detail: "scripted outage" };
  const store = createCommunityStore(snapshot, {
    data: new ScriptedCommunityDataPort([{ ok: true as const, data: fresh }, outage]),
    command: new ScriptedCommunityCommandPort([]),
  });
  store.refresh();
  assert.equal(store.state().data, fresh);
  store.refresh();
  assert.equal(store.state().loadError, "scripted outage");
  store.refresh();
  assert.equal(store.state().loadError, "scripted outage", "sticks on the last scripted result");
});

test("an empty data script fails typed, never by throwing", () => {
  const store = createCommunityStore(snapshot, {
    data: new ScriptedCommunityDataPort([]),
    command: new ScriptedCommunityCommandPort([]),
  });
  store.refresh();
  assert.equal(store.state().loadError, "scripted port has no results");
});

test("dispatchCommand appends intent + receipt to the append-only log (E10)", () => {
  const ok: CommunityCommandReceipt = {
    ok: true,
    kind: "contribution-submitted",
    contributionId: "sha256:" + "a".repeat(64) as never,
    duplicate: false,
  };
  const refused: CommunityCommandReceipt = {
    ok: false,
    code: "contributor-quota-full",
    detail: "contributor already holds too many open contributions",
  };
  const command = new ScriptedCommunityCommandPort([ok, refused]);
  const store = createCommunityStore(snapshot, { data: new StaticCommunityDataPort(snapshot), command });
  const intent: CommunityCommandIntent = {
    kind: "submit-contribution",
    tenant: snapshot.viewer.tenant,
    subject: snapshot.viewer.subject,
    contributionKind: "issue",
    label: "probe-issue",
    aiGenerated: false,
    lineageDerived: false,
    gapId: undefined,
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
  const command = new ScriptedCommunityCommandPort([]);
  const store = createCommunityStore(snapshot, { data: new StaticCommunityDataPort(snapshot), command });
  const base = {
    tenant: snapshot.viewer.tenant,
    subject: snapshot.viewer.subject,
  };
  const badKind: CommunityCommandIntent = {
    ...base,
    kind: "submit-contribution",
    contributionKind: "potion" as never,
    label: "probe",
    aiGenerated: false,
    lineageDerived: false,
  } as CommunityCommandIntent;
  const emptyLabel: CommunityCommandIntent = {
    ...base,
    kind: "submit-contribution",
    contributionKind: "issue",
    label: "",
    aiGenerated: false,
    lineageDerived: false,
  } as CommunityCommandIntent;
  const badCommand: CommunityCommandIntent = {
    ...base,
    kind: "advance-contribution",
    actor: snapshot.viewer.subject,
    contributionId: "sha256:" + "b".repeat(64),
    command: "reopen" as never,
  } as CommunityCommandIntent;
  const emptyId: CommunityCommandIntent = {
    ...base,
    kind: "advance-contribution",
    actor: snapshot.viewer.subject,
    contributionId: "",
    command: "triage",
  } as CommunityCommandIntent;
  for (const intent of [badKind, emptyLabel, badCommand, emptyId]) {
    const receipt = store.dispatchCommand(intent);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.code, "invalid-intent");
    // The refusal is a VISIBLE log state, never silent (E8).
    assert.equal(store.state().commandLog.at(-1)!.receipt, receipt);
  }
});

test("a cross-tenant contribution selection refuses with the typed cross-tenant code (R20/E8)", () => {
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(snapshot),
    command: new ScriptedCommunityCommandPort([]),
  });
  const foreign = snapshot.contributions.find(
    (record) => record.tenant === DEMO_COMMUNITY_FOREIGN_TENANT,
  )!;
  assert.ok(foreign !== undefined, "the demo includes one foreign-tenant contribution");
  const before = store.state().selection;
  store.dispatch({ type: "select-contribution", contributionId: String(foreign.contributionId) });
  const refusal = store.state().selectionRefusal;
  assert.ok(refusal !== null);
  assert.equal(refusal.code, "cross-tenant");
  assert.ok(refusal.detail.includes(String(DEMO_COMMUNITY_FOREIGN_TENANT)));
  // The selection itself did NOT move to the foreign entity.
  assert.equal(store.state().selection, before);
  // A subsequent legal selection clears the refusal.
  const viewerContribution = snapshot.contributions.find(
    (record) => record.tenant === snapshot.viewer.tenant,
  )!;
  store.dispatch({ type: "select-contribution", contributionId: String(viewerContribution.contributionId) });
  assert.equal(store.state().selectionRefusal, null);
  assert.equal(store.state().selection.contributionId, String(viewerContribution.contributionId));
  assert.equal(store.state().selection.tab, "provenance");
});

test("the kind filter threads through selection; clear-selection resets it", () => {
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(snapshot),
    command: new ScriptedCommunityCommandPort([]),
  });
  store.dispatch({ type: "select-kind", kind: "code" });
  assert.equal(store.view().contributions.rows.length, 1);
  assert.equal(store.view().contributions.kindFilter, "code");
  store.dispatch({ type: "clear-selection" });
  assert.equal(store.view().contributions.kindFilter, null);
  assert.equal(store.view().contributions.rows.length, snapshot.contributions.length);
  assert.equal(store.state().selection.tab, "contributions");
});

test("projectStateCached: one committed state → one identity-stable projection", () => {
  const store = createCommunityStore(snapshot, {
    data: new StaticCommunityDataPort(snapshot),
    command: new ScriptedCommunityCommandPort([]),
  });
  const state = store.state();
  assert.ok(projectStateCached(state) === projectStateCached(state));
  store.dispatch({ type: "select-tab", tab: "lifecycle" });
  const next = store.state();
  assert.ok(next !== state);
  assert.ok(projectStateCached(next) !== projectStateCached(state));
  assert.equal(projectStateCached(next).selection.tab, "lifecycle");
});
