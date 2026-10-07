/**
 * Build-stage vocabulary and phase machine: transition legality (house
 * pattern: frozen table + pure validators).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILD_PHASES,
  BUILD_PHASE_TRANSITIONS,
  BUILD_STAGES,
  canTransitionBuildPhase,
  checkBuildPhaseTransition,
  isBuildPhase,
  isBuildStage,
  isCompleteStageSequence,
  isTerminalBuildPhase,
} from "./stages.ts";

test("the frozen stage vocabulary is exactly resolve → plan → emit → verify → package", () => {
  assert.deepEqual([...BUILD_STAGES], ["resolve", "plan", "emit", "verify", "package"]);
});

test("the frozen phase vocabulary is stages plus queued and terminals", () => {
  assert.deepEqual([...BUILD_PHASES], [
    "queued",
    "resolve",
    "plan",
    "emit",
    "verify",
    "package",
    "succeeded",
    "failed",
    "cancelled",
  ]);
});

test("the happy path chain is legal, step by step", () => {
  const chain = ["queued", "resolve", "plan", "emit", "verify", "package", "succeeded"] as const;
  for (let index = 0; index + 1 < chain.length; index += 1) {
    const from = chain[index]!;
    const to = chain[index + 1]!;
    assert.equal(canTransitionBuildPhase(from, to), true, `${from} -> ${to}`);
    const verdict = checkBuildPhaseTransition(from, to);
    assert.equal(verdict.ok, true);
  }
});

test("skipping a stage is refused (illegal transition)", () => {
  const verdict = checkBuildPhaseTransition("queued", "plan");
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.code, "illegal-phase-transition");
    assert.deepEqual([...verdict.legal], ["resolve", "cancelled"]);
  }
  assert.equal(canTransitionBuildPhase("resolve", "verify"), false);
});

test("backwards transitions are refused", () => {
  assert.equal(canTransitionBuildPhase("plan", "resolve"), false);
  assert.equal(canTransitionBuildPhase("package", "emit"), false);
  assert.equal(canTransitionBuildPhase("succeeded", "queued"), false);
});

test("terminal phases transition nowhere", () => {
  assert.equal(isTerminalBuildPhase("succeeded"), true);
  assert.equal(isTerminalBuildPhase("failed"), true);
  assert.equal(isTerminalBuildPhase("cancelled"), true);
  assert.equal(isTerminalBuildPhase("package"), false);
  for (const terminal of ["succeeded", "failed", "cancelled"] as const) {
    assert.deepEqual([...BUILD_PHASE_TRANSITIONS[terminal]], []);
  }
});

test("any active phase may fail or be cancelled (cooperative)", () => {
  for (const phase of ["queued", "resolve", "plan", "emit", "verify", "package"] as const) {
    assert.equal(canTransitionBuildPhase(phase, "cancelled"), true, `${phase} -> cancelled`);
    if (phase !== "queued") {
      assert.equal(canTransitionBuildPhase(phase, "failed"), true, `${phase} -> failed`);
    }
  }
});

test("stage and phase guards reject unknown vocabulary", () => {
  assert.equal(isBuildStage("deploy"), false);
  assert.equal(isBuildStage("resolve"), true);
  assert.equal(isBuildPhase("queued"), true);
  assert.equal(isBuildPhase("upload"), false);
});

test("a successful manifest records exactly the complete stage sequence", () => {
  assert.equal(isCompleteStageSequence(["resolve", "plan", "emit", "verify", "package"]), true);
  assert.equal(isCompleteStageSequence(["resolve", "plan", "emit", "verify"]), false);
  assert.equal(isCompleteStageSequence(["resolve", "plan", "emit", "verify", "package", "package"]), false);
  assert.equal(isCompleteStageSequence(["plan", "resolve", "emit", "verify", "package"]), false);
  assert.equal(isCompleteStageSequence([]), false);
});
