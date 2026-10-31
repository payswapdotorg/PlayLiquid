/**
 * World Projects workbench STORE REFUSAL tests (E8/R20 negatives): the
 * typed cross-tenant selection + transition refusals and the
 * invalid-intent refusals, both refused BEFORE any domain call — the
 * domain port's `received` evidence is asserted empty. Same honesty
 * scope (E11) as projects-store.test.ts: no DOM, no rendering, no
 * network, no timers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createProjectsStore } from "./projects-store.ts";
import { ScriptedProjectsCommandPort, StaticProjectsDataPort } from "./fakes.ts";
import {
  DEMO_PROJECTS_FOREIGN_TENANT,
  demoProjectsSnapshot,
} from "./fixtures/demo.ts";
import type { ProjectsCommandIntent } from "./ports.ts";

const snapshot = demoProjectsSnapshot();

/** The viewer-tenant harbor pull request in `submitted` state. */
function submittedPrId(): string {
  const harbor = snapshot.details.get("harbor-cycle")!;
  return String(harbor.pullRequests.find((pr) => pr.status === "submitted")!.prId);
}

/** The confused-host foreign pull request (R20 guard demo). */
function foreignPrId(): string {
  const twin = snapshot.details.get("twin-factory")!;
  return String(twin.pullRequests[0]!.prId);
}

function transitionIntent(prId: string, command: "triage"): ProjectsCommandIntent {
  return { kind: "transition-pull-request", prId: prId as never, command };
}

test("malformed command intents are refused with the typed invalid-intent code BEFORE any domain call (E8)", async () => {
  const command = new ScriptedProjectsCommandPort([]);
  const store = createProjectsStore(snapshot, { data: new StaticProjectsDataPort(snapshot), command });
  const badKind = { kind: "delete-project", prId: submittedPrId(), command: "triage" } as unknown as ProjectsCommandIntent;
  const emptyId = {
    kind: "transition-pull-request",
    prId: "",
    command: "triage",
  } as unknown as ProjectsCommandIntent;
  const badCommand = {
    kind: "transition-pull-request",
    prId: submittedPrId(),
    command: "reopen",
  } as unknown as ProjectsCommandIntent;
  for (const intent of [badKind, emptyId, badCommand]) {
    const receipt = await store.dispatchCommand(intent);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.code, "invalid-intent");
    // The refusal is a VISIBLE log state, never silent (E8)…
    assert.equal(store.state().commandLog.at(-1)!.receipt, receipt);
  }
  // …and the domain port was NEVER called (refused before any domain call).
  assert.equal(command.received.length, 0);
  assert.equal(store.state().commandLog.length, 3);
});

test("a cross-tenant pull-request transition refuses typed, before any domain call (R20/E8)", async () => {
  const command = new ScriptedProjectsCommandPort([]);
  const store = createProjectsStore(snapshot, { data: new StaticProjectsDataPort(snapshot), command });
  const foreign = foreignPrId();
  const receipt = await store.dispatchCommand(transitionIntent(foreign, "triage"));
  assert.equal(receipt.ok, false);
  assert.equal(receipt.code, "cross-tenant");
  assert.ok(receipt.detail.includes(String(DEMO_PROJECTS_FOREIGN_TENANT)));
  // The refusal is logged verbatim (E8) and the domain port was never called.
  assert.equal(store.state().commandLog.length, 1);
  assert.equal(store.state().commandLog[0]!.receipt, receipt);
  assert.equal(command.received.length, 0);
});

test("a cross-tenant project selection refuses with the typed cross-tenant code (R20/E8)", () => {
  const store = createProjectsStore(snapshot, {
    data: new StaticProjectsDataPort(snapshot),
    command: new ScriptedProjectsCommandPort([]),
  });
  const before = store.state().selection;
  store.dispatch({ type: "select-project", projectId: "twin-factory" });
  const refusal = store.state().selectionRefusal;
  assert.ok(refusal !== null);
  assert.equal(refusal.code, "cross-tenant");
  assert.ok(refusal.detail.includes(String(DEMO_PROJECTS_FOREIGN_TENANT)));
  // The selection itself did NOT move to the foreign project.
  assert.equal(store.state().selection, before);
  // A subsequent legal selection clears the refusal.
  store.dispatch({ type: "select-project", projectId: "harbor-cycle" });
  assert.equal(store.state().selectionRefusal, null);
  assert.equal(store.state().selection.projectId, "harbor-cycle");
  assert.equal(store.state().selection.tab, "overview");
});

