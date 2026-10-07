/**
 * Module role: tests for the adapter lifecycle contract — state guards,
 * the allowed-transition table, and the total transition validator.
 *
 * Implements: PL-005 §3.B.2 (adapter lifecycle) — behavior coverage for
 * lifecycle.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADAPTER_LIFECYCLE_STATES,
  ADAPTER_LIFECYCLE_TRANSITIONS,
  advanceLifecycle,
  isAdapterLifecycleState,
  type AdapterLifecycleState,
} from "./lifecycle.ts";

test("the lifecycle state set is exactly the four contract states", () => {
  assert.deepEqual(ADAPTER_LIFECYCLE_STATES, ["registered", "ready", "degraded", "closed"]);
});

test("the transition table matches the contract", () => {
  assert.deepEqual(ADAPTER_LIFECYCLE_TRANSITIONS.registered, ["ready", "degraded", "closed"]);
  assert.deepEqual(ADAPTER_LIFECYCLE_TRANSITIONS.ready, ["degraded", "closed"]);
  assert.deepEqual(ADAPTER_LIFECYCLE_TRANSITIONS.degraded, ["ready", "closed"]);
  assert.deepEqual(ADAPTER_LIFECYCLE_TRANSITIONS.closed, []);
});

test("isAdapterLifecycleState recognizes exactly the four states", () => {
  for (const state of ["registered", "ready", "degraded", "closed"]) {
    assert.equal(isAdapterLifecycleState(state), true, `expected "${state}" to be a state`);
  }
  for (const notState of ["bogus", "", 42, null, undefined]) {
    assert.equal(isAdapterLifecycleState(notState), false);
  }
});

test("advanceLifecycle allows exactly the contract transitions", () => {
  const legal: readonly [AdapterLifecycleState, AdapterLifecycleState][] = [
    ["registered", "ready"],
    ["registered", "degraded"],
    ["registered", "closed"],
    ["ready", "degraded"],
    ["ready", "closed"],
    ["degraded", "ready"],
    ["degraded", "closed"],
    ["closed", "closed"],
  ];
  for (const [from, to] of legal) {
    const check = advanceLifecycle(from, to);
    if (check.outcome !== "ok") {
      assert.fail(`expected ${from} → ${to} to be legal, got ${check.code}`);
    }
    assert.equal(check.next, to);
  }
});

test("advanceLifecycle rejects self-transitions and backwards moves", () => {
  const illegal: readonly [AdapterLifecycleState, AdapterLifecycleState, string][] = [
    ["registered", "registered", "adapter-lifecycle/invalid-transition"],
    ["ready", "ready", "adapter-lifecycle/invalid-transition"],
    ["ready", "registered", "adapter-lifecycle/invalid-transition"],
    ["degraded", "degraded", "adapter-lifecycle/invalid-transition"],
    ["closed", "ready", "adapter-lifecycle/closed-is-terminal"],
    ["closed", "registered", "adapter-lifecycle/closed-is-terminal"],
  ];
  for (const [from, to, expectedCode] of illegal) {
    const check = advanceLifecycle(from, to);
    if (check.outcome === "ok") {
      assert.fail(`expected ${from} → ${to} to be illegal`);
    }
    assert.equal(check.code, expectedCode, `${from} → ${to}`);
    assert.ok(check.message.length > 0);
  }
});

test("advanceLifecycle lists the allowed targets in its message", () => {
  const check = advanceLifecycle("ready", "ready");
  if (check.outcome === "ok") {
    assert.fail("expected rejection");
  }
  assert.ok(check.message.includes("allowed: degraded, closed"));
});

test("advanceLifecycle rejects unknown states at runtime", () => {
  const fromCheck = advanceLifecycle("bogus" as AdapterLifecycleState, "ready");
  assert.equal(fromCheck.outcome, "rejected");
  if (fromCheck.outcome === "rejected") {
    assert.equal(fromCheck.code, "adapter-lifecycle/unknown-state");
  }
  const toCheck = advanceLifecycle("ready", 42 as unknown as AdapterLifecycleState);
  assert.equal(toCheck.outcome, "rejected");
  if (toCheck.outcome === "rejected") {
    assert.equal(toCheck.code, "adapter-lifecycle/unknown-state");
  }
});
