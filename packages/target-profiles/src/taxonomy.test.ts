/**
 * The frozen target taxonomy and the R12 workflow-class mapping.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TARGETS,
  TARGET_WORKFLOW_CLASSES,
  WORKFLOW_CLASSES,
  isTargetId,
  isWorkflowClass,
  targetWorkflowClass,
  targetsOfWorkflowClass,
} from "./taxonomy.ts";

test("the frozen taxonomy is exactly the architecture's eleven targets", () => {
  assert.deepEqual([...TARGETS], [
    "web",
    "spark",
    "windows",
    "macos",
    "linux",
    "android",
    "ios",
    "steamdeck",
    "xr",
    "dedicated-server",
    "console",
  ]);
});

test("unknown targets are refused by the guard", () => {
  assert.equal(isTargetId("web"), true);
  assert.equal(isTargetId("ps5"), false);
  assert.equal(isTargetId(""), false);
  assert.equal(isTargetId(42), false);
});

test("every target maps to exactly one R12 workflow class", () => {
  for (const target of TARGETS) {
    assert.equal(isWorkflowClass(TARGET_WORKFLOW_CLASSES[target]), true, target);
  }
  assert.equal(targetWorkflowClass("web"), "web");
  assert.equal(targetWorkflowClass("spark"), "mobile");
  assert.equal(targetWorkflowClass("windows"), "desktop");
  assert.equal(targetWorkflowClass("macos"), "desktop");
  assert.equal(targetWorkflowClass("linux"), "desktop");
  assert.equal(targetWorkflowClass("steamdeck"), "desktop");
  assert.equal(targetWorkflowClass("android"), "mobile");
  assert.equal(targetWorkflowClass("ios"), "mobile");
  assert.equal(targetWorkflowClass("xr"), "xr");
  assert.equal(targetWorkflowClass("dedicated-server"), "dedicated-server");
  assert.equal(targetWorkflowClass("console"), "console");
});

test("all six R12 workflow classes are represented", () => {
  assert.deepEqual([...WORKFLOW_CLASSES], ["web", "desktop", "mobile", "xr", "dedicated-server", "console"]);
  for (const workflowClass of WORKFLOW_CLASSES) {
    assert.equal(targetsOfWorkflowClass(workflowClass).length > 0, true, workflowClass);
  }
});

test("workflow class lookup is consistent with the reverse mapping", () => {
  for (const target of TARGETS) {
    assert.equal(targetsOfWorkflowClass(targetWorkflowClass(target)).includes(target), true, target);
  }
});
