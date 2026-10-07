/**
 * Module role: tests for the in-memory fake adapter — lifecycle driving,
 * refusal gates (not-ready / degraded / closed / undeclared), deterministic
 * authority stamps, the dispatch log, and scripting. The fake here is the
 * test double under test; it is NOT a real provider integration.
 *
 * Implements: PL-005 §3.B.5 (reference fake) — behavior coverage for
 * fake-adapter.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakeAdapter } from "./fake-adapter.ts";
import { adapterAuthority, failedCommandResult, type AdapterCommandDispatch } from "./exchange.ts";
import type { Adapter } from "./adapter.ts";

const clockTime = 12345;

function dispatchCommand(commandId: string, capability: string): AdapterCommandDispatch {
  return {
    kind: "adapter-command-dispatch",
    commandId,
    capability,
    payload: { frame: 1 },
  };
}

test("createFakeAdapter provides honest defaults", () => {
  const fake = createFakeAdapter();
  assert.equal(fake.id, "fake.default");
  assert.ok(fake.label.toLowerCase().includes("fake"));
  assert.ok(fake.label.includes("NOT a real"));
  assert.equal(fake.state, "registered");
  assert.deepEqual(fake.offeredCapabilities, []);
  assert.deepEqual(fake.dispatched, []);
});

test("the fake satisfies the neutral Adapter interface", () => {
  const asAdapter: Adapter = createFakeAdapter({ adapterId: "fabric.test" });
  assert.equal(asAdapter.id, "fabric.test");
  assert.equal(typeof asAdapter.dispatch, "function");
});

test("lifecycle: markReady, degrade, recover, close, idempotent re-close", () => {
  const fake = createFakeAdapter({ offeredCapabilities: ["scene.render"] });

  const ready = fake.markReady();
  if (ready.outcome !== "ok") {
    assert.fail("expected ok");
  }
  assert.equal(fake.state, "ready");

  const doubleReady = fake.markReady();
  if (doubleReady.outcome === "ok") {
    assert.fail("expected rejection");
  }
  assert.equal(doubleReady.code, "adapter-lifecycle/invalid-transition");
  assert.equal(fake.state, "ready");

  fake.reportDegraded();
  assert.equal(fake.state, "degraded");

  fake.markReady(); // recovery
  assert.equal(fake.state, "ready");

  const closed = fake.close();
  assert.equal(closed.outcome, "ok");
  assert.equal(fake.state, "closed");

  const reclosed = fake.close();
  assert.equal(reclosed.outcome, "ok");
  assert.equal(fake.state, "closed");

  const zombie = fake.markReady();
  if (zombie.outcome === "ok") {
    assert.fail("expected rejection");
  }
  assert.equal(zombie.code, "adapter-lifecycle/closed-is-terminal");
  assert.equal(fake.state, "closed");
});

test("dispatch refuses while registered (not ready)", async () => {
  const fake = createFakeAdapter({ offeredCapabilities: ["scene.render"] });
  const result = await fake.dispatch(dispatchCommand("cmd-1", "scene.render"));
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.refusal.code, "adapter/not-ready");
  assert.equal(fake.dispatched.length, 1);
});

test("dispatch executes when ready and stamps deterministic authority", async () => {
  const fake = createFakeAdapter({
    adapterId: "fabric.test",
    offeredCapabilities: ["scene.render"],
    clock: () => clockTime,
  });
  fake.markReady();
  const command = dispatchCommand("cmd-1", "scene.render");
  const result = await fake.dispatch(command);
  if (result.outcome !== "ok") {
    assert.fail("expected ok");
  }
  assert.equal(result.authority.kind, "adapter-authority");
  assert.equal(result.authority.adapterId, "fabric.test");
  assert.equal(result.authority.finishedAt, clockTime);
  assert.deepEqual(result.value, { commandId: "cmd-1", capability: "scene.render" });
  assert.equal(fake.dispatched[0], command);
});

test("dispatch refuses an undeclared capability and names it", async () => {
  const fake = createFakeAdapter({ offeredCapabilities: ["scene.render"], clock: () => clockTime });
  fake.markReady();
  const result = await fake.dispatch(dispatchCommand("cmd-9", "physics.step"));
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.refusal.code, "adapter-capability/not-declared");
  assert.equal(result.refusal.capability, "physics.step");
  assert.ok(result.refusal.message.includes("physics.step"));
});

test("dispatch refuses while degraded and while closed", async () => {
  const fake = createFakeAdapter({ offeredCapabilities: ["scene.render"] });
  fake.markReady();
  fake.reportDegraded();
  const degraded = await fake.dispatch(dispatchCommand("cmd-1", "scene.render"));
  if (degraded.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(degraded.refusal.code, "adapter/degraded");

  fake.markReady();
  fake.close();
  const closedResult = await fake.dispatch(dispatchCommand("cmd-2", "scene.render"));
  if (closedResult.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(closedResult.refusal.code, "adapter/closed");
});

test("dispatch refuses malformed commands instead of throwing", async () => {
  const fake = createFakeAdapter({ offeredCapabilities: ["scene.render"] });
  fake.markReady();
  const result = await fake.dispatch(null as unknown as AdapterCommandDispatch);
  if (result.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  assert.equal(result.refusal.code, "adapter/invalid-dispatch");
  assert.ok(result.refusal.message.includes("invalid dispatch"));
  assert.equal(fake.dispatched.length, 1);
});

test("scriptNextResult supplies the next executed result verbatim", async () => {
  const fake = createFakeAdapter({ offeredCapabilities: ["scene.render"], clock: () => clockTime });
  fake.markReady();
  const scripted = failedCommandResult(adapterAuthority("fabric.test", clockTime), {
    code: "render.error",
    message: "scripted boom",
  });
  fake.scriptNextResult(scripted);
  const first = await fake.dispatch(dispatchCommand("cmd-1", "scene.render"));
  assert.equal(first, scripted);
  const second = await fake.dispatch(dispatchCommand("cmd-2", "scene.render"));
  if (second.outcome !== "ok") {
    assert.fail("expected default ok after the script was consumed");
  }
});

test("a scripted result survives a refused dispatch", async () => {
  const fake = createFakeAdapter({ offeredCapabilities: ["scene.render"], clock: () => clockTime });
  fake.markReady();
  const scripted = failedCommandResult(adapterAuthority("fabric.test", clockTime), {
    code: "render.error",
    message: "scripted boom",
  });
  fake.scriptNextResult(scripted);
  const refused = await fake.dispatch(dispatchCommand("cmd-1", "physics.step"));
  if (refused.outcome !== "refused") {
    assert.fail("expected refusal");
  }
  const executed = await fake.dispatch(dispatchCommand("cmd-2", "scene.render"));
  assert.equal(executed, scripted);
});
