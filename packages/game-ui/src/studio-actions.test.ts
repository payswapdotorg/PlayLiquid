/**
 * Reducer + action vocabulary tests (pure). Every state transition of the
 * Game Studio UI is a typed action reduced by ONE pure function — these
 * tests exhaustively cover the action set, including the negative paths
 * (load failure recorded verbatim, unknown action is a no-op).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { initialStudioState, projectState, reduce } from "./studio-actions.ts";
import type { StudioAction, StudioState } from "./studio-actions.ts";
import { demoStudioSnapshot } from "./fixtures/demo.ts";
import { INITIAL_SELECTION } from "./view/studio-view.ts";
import type { StudioDataSnapshot } from "./view/studio-view.ts";

const snapshot = await demoStudioSnapshot();

function state(): StudioState {
  return initialStudioState(snapshot);
}

test("initial state seeds data, default selection and the snapshot timeline", () => {
  const initial = state();
  assert.equal(initial.data, snapshot);
  assert.deepEqual(initial.selection, INITIAL_SELECTION);
  assert.equal(initial.selection.tab, "packages");
  assert.equal(initial.operations.length, snapshot.operations.length);
  assert.equal(initial.loadError, null);
});

test("select-tab moves the active tab and nothing else", () => {
  const before = state();
  const after = reduce(before, { type: "select-tab", tab: "tools" });
  assert.equal(after.selection.tab, "tools");
  assert.equal(after.data, before.data);
  assert.equal(after.operations, before.operations);
  assert.equal(after.loadError, before.loadError);
});

test("select-package jumps to the Packages surface with the picked id", () => {
  const after = reduce(state(), { type: "select-package", packageId: "pkg-demo" });
  assert.equal(after.selection.tab, "packages");
  assert.equal(after.selection.packageId, "pkg-demo");
});

test("select-avatar jumps to the Avatars surface with the picked id", () => {
  const after = reduce(state(), { type: "select-avatar", avatarId: "avt-demo" });
  assert.equal(after.selection.tab, "avatars");
  assert.equal(after.selection.avatarId, "avt-demo");
});

test("select-job jumps to the Tools surface with the picked id", () => {
  const after = reduce(state(), { type: "select-job", jobId: "job-1" });
  assert.equal(after.selection.tab, "tools");
  assert.equal(after.selection.jobId, "job-1");
});

test("clear-selection returns to the initial selection (tab included)", () => {
  const moved = reduce(state(), { type: "select-avatar", avatarId: "avt-demo" });
  const cleared = reduce(moved, { type: "clear-selection" });
  assert.deepEqual(cleared.selection, INITIAL_SELECTION);
});

test("refreshed replaces data wholesale and PRESERVES selection + timeline", () => {
  const picked = reduce(state(), { type: "select-package", packageId: snapshot.packages[0]!.identity.id });
  const nextData: StudioDataSnapshot = { ...snapshot, jobs: [...snapshot.jobs] };
  const after = reduce(picked, { type: "refreshed", data: nextData });
  assert.equal(after.data, nextData);
  assert.equal(after.selection.packageId, snapshot.packages[0]!.identity.id);
  // The refreshed snapshot's own operations are appended (E10 append-only).
  assert.equal(after.operations.length, picked.operations.length + snapshot.operations.length);
  assert.equal(after.loadError, null);
});

test("load-failed records the detail verbatim and keeps the last good data", () => {
  const before = state();
  const after = reduce(before, { type: "load-failed", detail: "registry unreachable" });
  assert.equal(after.loadError, "registry unreachable");
  assert.equal(after.data, before.data);
  assert.equal(after.operations, before.operations);
});

test("a later refresh clears the recorded load error", () => {
  const failed = reduce(state(), { type: "load-failed", detail: "boom" });
  const recovered = reduce(failed, { type: "refreshed", data: snapshot });
  assert.equal(recovered.loadError, null);
});

test("record-operations appends in order and never rewrites (E10)", () => {
  const before = state();
  const appended = reduce(before, {
    type: "record-operations",
    operations: [snapshot.operations[0]!, snapshot.operations[1]!],
  });
  assert.equal(appended.operations.length, before.operations.length + 2);
  // The previous entries are still the same references, in place.
  for (const [index, operation] of before.operations.entries()) {
    assert.equal(appended.operations[index], operation);
  }
  assert.equal(appended.operations.at(-1), snapshot.operations[1]);
});

test("unknown actions are a no-op returning the SAME state reference", () => {
  const before = state();
  const after = reduce(before, { type: "not-a-real-action" } as unknown as StudioAction);
  assert.equal(after, before);
});

test("reduce never mutates the previous state (pure transitions)", () => {
  const before = state();
  const after = reduce(before, { type: "select-tab", tab: "session" });
  assert.notEqual(after, before);
  assert.equal(before.selection.tab, "packages");
  assert.equal(after.selection.tab, "session");
});

test("projectState threads selection and the merged timeline into the view", () => {
  const picked = reduce(reduce(state(), { type: "select-avatar", avatarId: snapshot.avatars[0]!.avatarId }), {
    type: "record-operations",
    operations: [snapshot.operations[0]!],
  });
  const view = projectState(picked);
  assert.equal(view.selection.tab, "avatars");
  assert.equal(view.selection.avatarId, snapshot.avatars[0]!.avatarId);
  // Timeline = snapshot operations + the recorded one (E10 order).
  assert.equal(view.session.timeline.length, snapshot.operations.length + 1);
});
