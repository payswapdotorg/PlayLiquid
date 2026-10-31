/**
 * World Projects workbench STORE tests: the single UI-state owner. Mirrors
 * the game-ui/gameos-lab/gameos-community store discipline: subscription
 * semantics (one notification per committed transition), the serialized
 * re-entrant dispatch queue, refresh success/failure through the
 * `ProjectsDataPort` seam, the SERIALIZED ASYNC command queue over the
 * `ProjectsCommandPort` seam with the APPEND-ONLY command log (E8/E10 —
 * accepted receipts AND typed refusals are both visible states), the
 * typed cross-tenant selection + transition refusals (R20,
 * negative-tested), invalid intents refused BEFORE any domain call (E8)
 * and the identity-stable React projection cache.
 *
 * Honesty scope (E11): no DOM, no rendering, no network, no timers — the
 * scripted ports are deterministic in-memory doubles (lock rule 44) and
 * the demo snapshot is real anchor-package machinery (fixtures/demo.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createProjectsStore } from "./projects-store.ts";
import { projectStateCached } from "./app/use-projects-store.ts";
import {
  ScriptedProjectsCommandPort,
  ScriptedProjectsDataPort,
  StaticProjectsDataPort,
} from "./fakes.ts";
import { demoProjectsSnapshot } from "./fixtures/demo.ts";
import type { ProjectsDataSnapshot } from "./view/projects-view.ts";
import type { ProjectsAction } from "./projects-actions.ts";
import type {
  ProjectsCommandIntent,
  ProjectsCommandReceipt,
  ProjectsCommandReceiptOk,
} from "./ports.ts";

const snapshot = demoProjectsSnapshot();

/** The viewer-tenant harbor pull request in `submitted` state. */
function submittedPrId(): string {
  const harbor = snapshot.details.get("harbor-cycle")!;
  return String(harbor.pullRequests.find((pr) => pr.status === "submitted")!.prId);
}

function transitionIntent(prId: string, command: "triage"): ProjectsCommandIntent {
  return { kind: "transition-pull-request", prId: prId as never, command };
}

const okReceipt = (prId: string): ProjectsCommandReceiptOk => ({
  ok: true,
  prId: prId as never,
  command: "triage",
  at: 1_767_226_000_000,
});

test("the store starts from the given snapshot with no listeners", () => {
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(snapshot),
    command: new ScriptedProjectsCommandPort([]),
  });
  assert.equal(store.state().data, snapshot);
  assert.equal(store.state().selection.tab, "overview");
  assert.equal(store.state().selection.projectId, null);
  assert.equal(store.state().selection.prId, null);
  assert.equal(store.state().loadError, null);
  assert.equal(store.state().selectionRefusal, null);
  assert.equal(store.state().commandLog.length, 0);
  const view = store.view();
  assert.equal(view.projects.totalProjects, snapshot.projects.length);
  assert.equal(view.pullRequests.totalPullRequests, 0, "no project open yet");
});

test("a committed transition notifies each listener exactly once", () => {
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(snapshot),
    command: new ScriptedProjectsCommandPort([]),
  });
  let first = 0;
  let second = 0;
  store.subscribe(() => {
    first += 1;
  });
  store.subscribe(() => {
    second += 1;
  });
  store.dispatch({ type: "select-tab", tab: "composition" });
  assert.equal(first, 1);
  assert.equal(second, 1);
  store.dispatch({ type: "select-tab", tab: "pull-requests" });
  assert.equal(first, 2);
  assert.equal(second, 2);
});

test("an unknown action commits nothing and notifies nobody", () => {
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(snapshot),
    command: new ScriptedProjectsCommandPort([]),
  });
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  const before = store.state();
  store.dispatch({ type: "not-a-real-action" } as unknown as ProjectsAction);
  assert.equal(notifications, 0);
  assert.equal(store.state(), before);
});

test("selecting an unknown project is a no-op, never a crash", () => {
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(snapshot),
    command: new ScriptedProjectsCommandPort([]),
  });
  const before = store.state();
  store.dispatch({ type: "select-project", projectId: "no-such-project" });
  assert.equal(store.state(), before);
});

test("re-entrant dispatches from a listener are serialized in order", () => {
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(snapshot),
    command: new ScriptedProjectsCommandPort([]),
  });
  const seenTabs: string[] = [];
  let reEntryGuard = 0;
  store.subscribe(() => {
    seenTabs.push(store.state().selection.tab);
    if (reEntryGuard === 0) {
      reEntryGuard += 1;
      // Dispatched DURING a listener: must be queued, not interleaved.
      store.dispatch({ type: "select-tab", tab: "composition" });
    }
  });
  store.dispatch({ type: "select-tab", tab: "pull-requests" });
  assert.deepEqual(seenTabs, ["pull-requests", "composition"]);
  assert.equal(store.state().selection.tab, "composition");
});

test("refresh success replaces the data snapshot, preserves selection + log", async () => {
  const fresh: ProjectsDataSnapshot = {
    ...snapshot,
    projects: [...snapshot.projects],
    details: new Map(snapshot.details),
  };
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(fresh),
    command: new ScriptedProjectsCommandPort([]),
  });
  store.dispatch({ type: "select-project", projectId: "harbor-cycle" });
  const prId = submittedPrId();
  await store.dispatchCommand(transitionIntent(prId, "triage"));
  store.dispatch({ type: "load-failed", detail: "stale error" });
  store.refresh();
  assert.equal(store.state().data, fresh);
  assert.equal(store.state().loadError, null);
  assert.equal(store.state().selection.projectId, "harbor-cycle");
  assert.equal(store.state().commandLog.length, 1, "the command log survives a refresh (E10)");
});

test("refresh failure records the typed error verbatim and keeps rendering", () => {
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(snapshot, { failWith: "projects service unreachable" }),
    command: new ScriptedProjectsCommandPort([]),
  });
  const before = store.view();
  store.refresh();
  assert.equal(store.state().loadError, "projects service unreachable");
  const after = store.view();
  assert.equal(after.projects.totalProjects, before.projects.totalProjects);
  assert.equal(after.projects.totalOpenPullRequests, before.projects.totalOpenPullRequests);
});

test("a scripted data port serves results in order then sticks on the last", () => {
  const fresh: ProjectsDataSnapshot = {
    ...snapshot,
    projects: [...snapshot.projects],
    details: new Map(snapshot.details),
  };
  const outage = { ok: false as const, code: "load-failed" as const, detail: "scripted outage" };
  const store = createProjectsStore(snapshot, {
    data: new ScriptedProjectsDataPort([{ ok: true as const, data: fresh }, outage]),
    command: new ScriptedProjectsCommandPort([]),
  });
  store.refresh();
  assert.equal(store.state().data, fresh);
  store.refresh();
  assert.equal(store.state().loadError, "scripted outage");
  store.refresh();
  assert.equal(store.state().loadError, "scripted outage", "sticks on the last scripted result");
});

test("an empty data script fails typed, never by throwing", () => {
  const store = createProjectsStore(snapshot, {
    data: new ScriptedProjectsDataPort([]),
    command: new ScriptedProjectsCommandPort([]),
  });
  store.refresh();
  assert.equal(store.state().loadError, "scripted port has no results");
});

test("dispatchCommand appends intent + receipt to the append-only log (E10)", async () => {
  const prId = submittedPrId();
  const ok: ProjectsCommandReceipt = okReceipt(prId);
  const refused: ProjectsCommandReceipt = {
    ok: false,
    code: "invalid-transition",
    detail: "command triage is not legal from status under-review (frozen state machine)",
  };
  const command = new ScriptedProjectsCommandPort([ok, refused]);
  const store = createProjectsStore(snapshot, { data: new StaticProjectsDataPort(snapshot), command });
  const intent = transitionIntent(prId, "triage");
  const first = await store.dispatchCommand(intent);
  assert.equal(first, ok);
  const second = await store.dispatchCommand(intent);
  assert.equal(second, refused);
  // BOTH outcomes are visible log states, in dispatch order — a refusal
  // (here: community's own vocabulary, verbatim) is never silently
  // dropped (E8).
  assert.equal(store.state().commandLog.length, 2);
  assert.equal(store.state().commandLog[0]!.receipt, ok);
  assert.equal(store.state().commandLog[1]!.receipt, refused);
  assert.deepEqual(command.received, [intent, intent]);
});

test("an unknown pull request is forwarded: the domain door owns admission", async () => {
  const refused: ProjectsCommandReceipt = {
    ok: false,
    code: "unknown-contribution",
    detail: "no contribution with this id is recorded for the tenant",
  };
  const command = new ScriptedProjectsCommandPort([refused]);
  const store = createProjectsStore(snapshot, { data: new StaticProjectsDataPort(snapshot), command });
  const receipt = await store.dispatchCommand(
    transitionIntent("sha256:" + "9".repeat(64), "triage"),
  );
  assert.equal(receipt, refused);
  assert.equal(command.received.length, 1, "the store did not fabricate a domain verdict");
  assert.equal(store.state().commandLog[0]!.receipt, refused);
});

test("opening a project resets to the overview tab; picking a pull request opens the review", () => {
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(snapshot),
    command: new ScriptedProjectsCommandPort([]),
  });
  store.dispatch({ type: "select-project", projectId: "harbor-cycle" });
  assert.equal(store.state().selection.tab, "overview");
  assert.equal(store.state().selection.prId, null);
  assert.equal(store.view().overview.projectName, "harbor-cycle");
  const prId = submittedPrId();
  store.dispatch({ type: "select-pull-request", prId });
  assert.equal(store.state().selection.tab, "pull-requests");
  assert.equal(store.state().selection.prId, prId);
  assert.equal(store.view().pullRequests.selected!.prId, prId);
  // An unknown pull request is a no-op, never a crash.
  const before = store.state();
  store.dispatch({ type: "select-pull-request", prId: "sha256:" + "7".repeat(64) });
  assert.equal(store.state(), before);
  // clear-selection resets everything.
  store.dispatch({ type: "clear-selection" });
  assert.equal(store.state().selection.projectId, null);
  assert.equal(store.state().selection.prId, null);
  assert.equal(store.state().selection.tab, "overview");
});

test("concurrent command dispatches serialize: receipts append in dispatch order (E10)", async () => {
  const prId = submittedPrId();
  const receipts: readonly ProjectsCommandReceipt[] = [
    { ok: true, prId: prId as never, command: "triage", at: 1 },
    { ok: false, code: "not-a-maintainer", detail: "actor is not a maintainer of the tenant" },
    { ok: true, prId: prId as never, command: "triage", at: 2 },
  ];
  const command = new ScriptedProjectsCommandPort(receipts);
  const store = createProjectsStore(snapshot, { data: new StaticProjectsDataPort(snapshot), command });
  const pending = [
    store.dispatchCommand(transitionIntent(prId, "triage")),
    store.dispatchCommand(transitionIntent(prId, "triage")),
    store.dispatchCommand(transitionIntent(prId, "triage")),
  ];
  const settled = await Promise.all(pending);
  assert.deepEqual(settled, receipts);
  assert.deepEqual(
    store.state().commandLog.map((entry) => entry.receipt),
    receipts,
    "no interleaving: the log order matches the dispatch order",
  );
});

test("running the same scripted scenario twice yields identical trajectories (E9)", async () => {
  const runScenario = async () => {
    const prId = submittedPrId();
    const command = new ScriptedProjectsCommandPort([
      okReceipt(prId),
      { ok: false, code: "invalid-transition", detail: "not legal from the current status" },
    ]);
    const fresh: ProjectsDataSnapshot = {
      ...snapshot,
      projects: [...snapshot.projects],
      details: new Map(snapshot.details),
    };
    const store = createProjectsStore(snapshot, {
      data: new ScriptedProjectsDataPort([{ ok: true as const, data: fresh }]),
      command,
    });
    store.dispatch({ type: "select-project", projectId: "harbor-cycle" });
    const first = await store.dispatchCommand(transitionIntent(prId, "triage"));
    const second = await store.dispatchCommand(transitionIntent(prId, "triage"));
    store.refresh();
    return {
      receipts: [first, second],
      log: store.state().commandLog,
      selection: store.state().selection,
      view: store.view(),
      loadError: store.state().loadError,
    };
  };
  const a = await runScenario();
  const b = await runScenario();
  assert.deepEqual(a.receipts, b.receipts);
  assert.deepEqual(a.log, b.log);
  assert.deepEqual(a.selection, b.selection);
  assert.deepEqual(a.view, b.view);
  assert.equal(a.loadError, b.loadError);
});

test("projectStateCached: one committed state → one identity-stable projection", () => {
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(snapshot),
    command: new ScriptedProjectsCommandPort([]),
  });
  const state = store.state();
  assert.ok(projectStateCached(state) === projectStateCached(state));
  store.dispatch({ type: "select-project", projectId: "harbor-cycle" });
  const next = store.state();
  assert.ok(next !== state);
  assert.ok(projectStateCached(next) !== projectStateCached(state));
  assert.equal(projectStateCached(next).selection.projectId, "harbor-cycle");
});
