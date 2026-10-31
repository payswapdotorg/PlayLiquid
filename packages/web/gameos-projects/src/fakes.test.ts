/**
 * TEST-DOUBLE tests (small): the labeled fakes behave exactly as scripted
 * — lock rule 44 discipline (the doubles are TEST SUPPORT ONLY, never
 * presented as production; their contracts are tested like any other
 * module surface so store/view tests can rely on them).
 *
 * Honesty scope (E11): no DOM, no rendering, no network, no timers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ScriptedProjectsCommandPort,
  ScriptedProjectsDataPort,
  StaticProjectsDataPort,
} from "./fakes.ts";
import { demoProjectsSnapshot } from "./fixtures/demo.ts";
import type { ProjectsCommandIntent, ProjectsCommandReceipt } from "./ports.ts";

const snapshot = demoProjectsSnapshot();

test("StaticProjectsDataPort serves the fixed snapshot (or the fixed failure)", () => {
  const port = new StaticProjectsDataPort(snapshot);
  assert.deepEqual(port.load(), { ok: true, data: snapshot } as const);
  const failing = new StaticProjectsDataPort(snapshot, { failWith: "offline" });
  assert.deepEqual(failing.load(), { ok: false, code: "load-failed", detail: "offline" });
});

test("ScriptedProjectsDataPort serves results in order, sticks on the last, fails typed when empty", () => {
  const fresh = { ...snapshot, projects: [...snapshot.projects] };
  const port = new ScriptedProjectsDataPort([
    { ok: true as const, data: fresh },
    { ok: false as const, code: "load-failed" as const, detail: "outage" },
  ]);
  assert.equal(port.load().ok, true);
  assert.deepEqual(port.load(), { ok: false, code: "load-failed", detail: "outage" });
  assert.deepEqual(port.load(), { ok: false, code: "load-failed", detail: "outage" });
  const empty = new ScriptedProjectsDataPort([]);
  assert.deepEqual(empty.load(), {
    ok: false,
    code: "load-failed",
    detail: "scripted port has no results",
  });
});

test("ScriptedProjectsCommandPort refuses malformed intents before consulting the script (E8)", async () => {
  const port = new ScriptedProjectsCommandPort([
    { ok: true, prId: ("sha256:" + "a".repeat(64)) as never, command: "triage", at: 1 },
  ]);
  const malformed = {
    kind: "transition-pull-request",
    prId: "",
    command: "triage",
  } as unknown as ProjectsCommandIntent;
  const receipt = await port.dispatch(malformed);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.code, "invalid-intent");
  // The scripted receipt was NOT consumed by the malformed intent.
  const good: ProjectsCommandIntent = {
    kind: "transition-pull-request",
    prId: ("sha256:" + "a".repeat(64)) as never,
    command: "triage",
  };
  assert.equal((await port.dispatch(good)).ok, true);
  assert.deepEqual(port.received, [malformed, good]);
});

test("ScriptedProjectsCommandPort serves receipts in order, sticks on the last, fails typed when empty", async () => {
  const prId = ("sha256:" + "b".repeat(64)) as never;
  const receipts: readonly ProjectsCommandReceipt[] = [
    { ok: true, prId, command: "review", at: 10 },
    { ok: false, code: "not-a-maintainer", detail: "actor lacks maintainer rights" },
  ];
  const port = new ScriptedProjectsCommandPort(receipts);
  const intent: ProjectsCommandIntent = { kind: "transition-pull-request", prId, command: "review" };
  assert.equal(await port.dispatch(intent), receipts[0]);
  assert.equal(await port.dispatch(intent), receipts[1]);
  assert.equal(await port.dispatch(intent), receipts[1], "sticks on the last scripted receipt");
  const empty = new ScriptedProjectsCommandPort([]);
  const emptyReceipt = await empty.dispatch(intent);
  assert.deepEqual(emptyReceipt, {
    ok: false,
    code: "invalid-intent",
    detail: "scripted command port has no receipts",
  });
});
