/**
 * Module role: tests for the adapter exchange contract — dispatch
 * validation, authoritative result builders, and the client-claim gate.
 *
 * Implements: PL-005 §3.B.3 (exchange contracts) — behavior coverage for
 * exchange.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adapterAuthority,
  containsClientClaim,
  failedCommandResult,
  isClientClaimedOutcome,
  okCommandResult,
  rejectClientClaim,
  refusedCommandResult,
  validateAdapterCommandDispatch,
} from "./exchange.ts";

const payload = { frame: 1 };
const validDispatch = {
  kind: "adapter-command-dispatch",
  commandId: "cmd-1",
  capability: "scene.render",
  payload,
  deadline: { atEpochMs: 60_000 },
};

test("validateAdapterCommandDispatch accepts a full dispatch and normalizes it", () => {
  const result = validateAdapterCommandDispatch({ ...validDispatch, extra: "dropped" });
  if (result.outcome !== "ok") {
    assert.fail(`expected ok, got: ${result.rejections.map((item) => item.code).join(", ")}`);
  }
  const dispatch = result.dispatch;
  assert.equal(dispatch.kind, "adapter-command-dispatch");
  assert.equal(dispatch.commandId, "cmd-1");
  assert.equal(dispatch.capability, "scene.render");
  assert.equal(dispatch.payload, payload);
  assert.equal(dispatch.deadline?.atEpochMs, 60_000);
  assert.equal("extra" in dispatch, false);
});

test("validateAdapterCommandDispatch allows omitting the deadline", () => {
  const result = validateAdapterCommandDispatch({
    kind: "adapter-command-dispatch",
    commandId: "cmd-2",
    capability: "scene.render",
    payload: null,
  });
  if (result.outcome !== "ok") {
    assert.fail(`expected ok, got: ${result.rejections.map((item) => item.code).join(", ")}`);
  }
  assert.equal("deadline" in result.dispatch, false);
});

test("validateAdapterCommandDispatch rejects non-objects", () => {
  for (const input of [null, 42, "x", []]) {
    const result = validateAdapterCommandDispatch(input);
    if (result.outcome === "ok") {
      assert.fail(`expected rejection for ${String(input)}`);
    }
    const first = result.rejections[0];
    assert.ok(first !== undefined, "expected at least one rejection");
    assert.equal(first.code, "exchange/dispatch-not-an-object");
  }
});

test("validateAdapterCommandDispatch rejects each malformed field with typed codes", () => {
  const cases: readonly [Record<string, unknown>, string][] = [
    [{ ...validDispatch, kind: "wrong" }, "exchange/dispatch-kind"],
    [{ ...validDispatch, commandId: "" }, "exchange/command-id-missing"],
    [{ ...validDispatch, commandId: "x".repeat(129) }, "exchange/command-id-too-long"],
    [{ ...validDispatch, capability: 42 }, "exchange/capability-invalid"],
    [{ ...validDispatch, capability: "Scene.Render" }, "exchange/capability-invalid"],
    [{ ...validDispatch, deadline: { atEpochMs: 0 } }, "exchange/deadline-invalid"],
    [{ ...validDispatch, deadline: {} }, "exchange/deadline-invalid"],
    [{ ...validDispatch, deadline: { atEpochMs: 10.5 } }, "exchange/deadline-invalid"],
  ];
  for (const [input, expectedCode] of cases) {
    const result = validateAdapterCommandDispatch(input);
    if (result.outcome === "ok") {
      assert.fail(`expected ${expectedCode}`);
    }
    assert.ok(
      result.rejections.some((item) => item.code === expectedCode),
      `missing ${expectedCode}; got: ${result.rejections.map((item) => item.code).join(", ")}`,
    );
  }
});

test("result builders stamp authority and freeze", () => {
  const authority = adapterAuthority("fabric.primary", 123);
  assert.equal(authority.kind, "adapter-authority");
  assert.equal(authority.adapterId, "fabric.primary");
  assert.equal(authority.finishedAt, 123);

  const ok = okCommandResult(authority, { frame: 1 });
  assert.equal(ok.outcome, "ok");
  assert.equal(ok.authority, authority);
  assert.throws(() => {
    (ok as { value: unknown }).value = null;
  }, TypeError);

  const refused = refusedCommandResult(authority, { code: "adapter/closed", message: "closed" });
  assert.equal(refused.outcome, "refused");
  assert.equal(refused.refusal.code, "adapter/closed");

  const failed = failedCommandResult(authority, { code: "render.error", message: "boom" });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.error.code, "render.error");
});

test("isClientClaimedOutcome recognizes only the claim marker shape", () => {
  assert.equal(isClientClaimedOutcome({ clientClaimed: true, claimedOutcome: "ok", claimedValue: 1 }), true);
  assert.equal(isClientClaimedOutcome({ clientClaimed: true, claimedOutcome: "failed" }), true);
  assert.equal(isClientClaimedOutcome({ clientClaimed: true }), false);
  assert.equal(isClientClaimedOutcome({ clientClaimed: false, claimedOutcome: "ok" }), false);
  assert.equal(isClientClaimedOutcome({ frame: 1 }), false);
  assert.equal(isClientClaimedOutcome(null), false);
});

test("containsClientClaim scans the whole payload tree, bounded by depth", () => {
  assert.equal(containsClientClaim({ a: { b: [1, 2] } }), false);
  assert.equal(containsClientClaim({ clientClaimed: true, claimedOutcome: "ok" }), true);
  assert.equal(
    containsClientClaim({ wrapper: { list: [{ clientClaimed: true, claimedOutcome: "failed" }] } }),
    true,
  );
  assert.equal(containsClientClaim([{ clientClaimed: true, claimedOutcome: "ok" }]), true);

  let deep: unknown = { clientClaimed: true, claimedOutcome: "ok" };
  for (let i = 0; i < 40; i += 1) {
    deep = [deep];
  }
  assert.equal(containsClientClaim(deep), false);
});

test("rejectClientClaim passes clean values through by reference and rejects claims", () => {
  const clean = { frame: 1 };
  const accepted = rejectClientClaim(clean);
  if (accepted.outcome !== "accepted") {
    assert.fail("expected acceptance");
  }
  assert.equal(accepted.value, clean);

  const rejected = rejectClientClaim({ nested: [{ clientClaimed: true, claimedOutcome: "ok" }] });
  if (rejected.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(rejected.refusal.code, "exchange/client-claim");
  assert.ok(rejected.refusal.message.includes("never trusted"));
});
