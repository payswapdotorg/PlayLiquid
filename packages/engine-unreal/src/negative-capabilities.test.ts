/**
 * THE E8 NEGATIVE BATTERY, part 1 (PL-022) — capability and
 * dispatch-shape rejection codes: undeclared capabilities (R13), the
 * neutral exchange's envelope codes (kind/commandId/capability/deadline),
 * and the validator's family map refusing foreign capability ids.
 *
 * Part 2 (negative-payload.test.ts) covers the payload rejection codes;
 * part 3 (negative-lifecycle.test.ts) trust, lifecycle, tenancy and
 * bridge failures; part 4 (binding.test.ts) the binding refusals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/platform-contracts";
import type { AdapterCommandDispatch } from "@playliquid/engine-adapter-contract";
import { createUnrealAdapter } from "./adapter.ts";
import { createFakeUnrealBridge, createFakeUnrealClock } from "./fake-bridge.ts";
import { UNREAL_PAYLOAD_VERSION, payloadFamilyFor } from "./payload-model.ts";

const tenant = asTenantId("tenant-alpha")!;

function makeAdapter() {
  const bridge = createFakeUnrealBridge({ seed: 7 });
  const clock = createFakeUnrealClock(10_000);
  const adapter = createUnrealAdapter({ tenant, bridge, clock });
  adapter.markReady();
  return { adapter, bridge, clock };
}

function dispatch(commandId: string, capability: string, payload: unknown, overrides: Record<string, unknown> = {}): AdapterCommandDispatch {
  return {
    kind: "adapter-command-dispatch",
    commandId,
    capability,
    payload,
    ...overrides,
  } as AdapterCommandDispatch;
}

// --- 1. Undeclared capability ---

test("E8: dispatch to an undeclared capability is a typed refusal", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("cmd-x", "build.launch", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
  }));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter-capability/not-declared");
    assert.equal(result.refusal.capability, "build.launch");
  }
});

test("E8: every capability NOT in the fixed surface is refused", async () => {
  const { adapter } = makeAdapter();
  const foreign = [
    "build.launch",
    "build.play",
    "profile.capture",
    "capture.screenshot",
    "test.run",
    "debug.attach",
    "replay.record",
    "project.modify",
    "level.modify",
    "scene.inspect",
    "entity.modify",
    "build.publish",
  ];
  for (const capability of foreign) {
    const result = await adapter.dispatch(dispatch(`cmd-x-${capability}`, capability, {
      version: UNREAL_PAYLOAD_VERSION,
      tenant: "tenant-alpha",
      target: "MyGame",
    }));
    assert.equal(result.outcome, "refused", capability);
    if (result.outcome === "refused") {
      assert.equal(result.refusal.code, "adapter-capability/not-declared");
    }
  }
});

test("E8: dispatch to an undeclared capability never reaches the bridge", async () => {
  const { adapter, bridge } = makeAdapter();
  await adapter.dispatch(dispatch("cmd-x2", "build.launch", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
  }));
  assert.equal(bridge.invoked.length, 0);
});

// --- 2. Malformed neutral dispatch — each exchange rejection code exercised ---

test("E8: non-object dispatch → adapter/invalid-dispatch", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch("not-an-object" as unknown as AdapterCommandDispatch);
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter/invalid-dispatch");
    assert.match(result.refusal.message, /must be a non-array object/);
  }
});

test("E8: wrong kind → exchange/dispatch-kind; bad commandId → command-id codes", async () => {
  const { adapter } = makeAdapter();
  const wrongKind = await adapter.dispatch({
    kind: "something-else",
    commandId: "c1",
    capability: "project.inspect",
    payload: {},
  } as unknown as AdapterCommandDispatch);
  assert.equal(wrongKind.outcome, "refused");
  if (wrongKind.outcome === "refused") {
    assert.match(wrongKind.refusal.message, /adapter-command-dispatch/);
  }

  const emptyId = await adapter.dispatch(dispatch("", "project.inspect", {}));
  assert.equal(emptyId.outcome, "refused");
  if (emptyId.outcome === "refused") {
    assert.match(emptyId.refusal.message, /commandId must be a non-empty string/);
  }

  const longId = await adapter.dispatch(dispatch("x".repeat(129), "project.inspect", {}));
  assert.equal(longId.outcome, "refused");
  if (longId.outcome === "refused") {
    assert.match(longId.refusal.message, /at most 128/);
  }
});

test("E8: invalid capability id in dispatch → exchange/capability-invalid", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch({
    kind: "adapter-command-dispatch",
    commandId: "c2",
    capability: "NOT_A_VALID_ID",
    payload: {},
  } as unknown as AdapterCommandDispatch);
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.match(result.refusal.message, /capability invalid/);
  }
});

test("E8: malformed deadline → exchange/deadline-invalid", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("c3", "project.inspect", {
    version: UNREAL_PAYLOAD_VERSION,
    tenant: "tenant-alpha",
    target: "MyGame",
  }, { deadline: { atEpochMs: -5 } as never }));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.match(result.refusal.message, /atEpochMs/);
  }
});

test("E8: an undeclared capability is refused even with a malformed payload", async () => {
  const { adapter } = makeAdapter();
  const result = await adapter.dispatch(dispatch("c4", "debug.attach", "garbage"));
  assert.equal(result.outcome, "refused");
  if (result.outcome === "refused") {
    assert.equal(result.refusal.code, "adapter-capability/not-declared");
  }
});

test("E8: payloadFamilyFor refuses foreign capabilities at the validator", () => {
  assert.equal(payloadFamilyFor("build.launch"), null);
  assert.equal(payloadFamilyFor("scene.inspect"), null);
  assert.equal(payloadFamilyFor("project.inspect"), "inspect-project");
  assert.equal(payloadFamilyFor("level.pie"), "level-pie");
  assert.equal(payloadFamilyFor("build.package"), "build-package");
});
