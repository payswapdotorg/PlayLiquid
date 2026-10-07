/**
 * Module role: tests for the tool call protocol — request validation,
 * idempotency scope, input fingerprints, deadline derivation, outcome
 * builders, and the outcome type guard.
 *
 * Implements: PL-005 §3.A.2 (tool call protocol) — behavior coverage for
 * call-protocol.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cancelledOutcome,
  capabilityRefusalOutcome,
  deadlineFromTimeoutMs,
  idempotencyScope,
  inputFingerprint,
  isToolCallOutcome,
  okOutcome,
  surfaceMismatchOutcome,
  timeoutOutcome,
  validateToolCallRequest,
  type ToolCallRequest,
} from "./call-protocol.ts";
import { buildCallProvenance } from "./provenance.ts";

const sampleCancellation = {
  requested: false,
  onCancel: (): (() => void) => () => undefined,
};

const baseRequest = {
  kind: "tool-call-request",
  callId: "call-1",
  tool: { namespace: "playliquid", name: "dice-roll" },
  surfaceVersion: { major: 1, minor: 2 },
  input: { count: 2, sides: 6 },
  requiredCapabilities: ["random.generate"],
  idempotencyKey: "key-1",
  deadline: { atEpochMs: 10_000 },
  cancellation: sampleCancellation,
};

const provenance = buildCallProvenance(
  { namespace: "playliquid", name: "dice-roll" },
  { major: 1, minor: 2 },
);

test("validateToolCallRequest accepts a full request and normalizes it", () => {
  const result = validateToolCallRequest({ ...baseRequest, extra: "dropped" });
  if (result.outcome !== "ok") {
    assert.fail(`expected ok, got: ${result.rejections.map((item) => item.code).join(", ")}`);
  }
  const request = result.request;
  assert.equal(request.kind, "tool-call-request");
  assert.equal(request.callId, "call-1");
  assert.equal(request.tool.name, "dice-roll");
  assert.equal(request.surfaceVersion.minor, 2);
  assert.deepEqual(request.requiredCapabilities, ["random.generate"]);
  assert.equal(request.input, baseRequest.input);
  assert.equal("extra" in request, false);
});

test("validateToolCallRequest preserves the live cancellation token by reference", () => {
  const result = validateToolCallRequest(baseRequest);
  if (result.outcome !== "ok") {
    assert.fail("expected ok");
  }
  assert.equal(result.request.cancellation, sampleCancellation);
});

test("validateToolCallRequest allows omitting every optional field", () => {
  const result = validateToolCallRequest({
    kind: "tool-call-request",
    callId: "call-2",
    tool: { namespace: "playliquid", name: "dice-roll" },
    surfaceVersion: { major: 1, minor: 0 },
    input: null,
    requiredCapabilities: [],
  });
  if (result.outcome !== "ok") {
    assert.fail(`expected ok, got: ${result.rejections.map((item) => item.code).join(", ")}`);
  }
  assert.equal("idempotencyKey" in result.request, false);
  assert.equal("deadline" in result.request, false);
  assert.equal("cancellation" in result.request, false);
});

test("validateToolCallRequest rejects non-objects", () => {
  for (const input of [null, 42, "x", []]) {
    const result = validateToolCallRequest(input);
    if (result.outcome === "ok") {
      assert.fail(`expected rejection for ${String(input)}`);
    }
    assert.equal(result.rejections[0]!.code, "tool-call/not-an-object");
  }
});

test("validateToolCallRequest rejects each malformed field with typed codes and paths", () => {
  const cases: readonly [Record<string, unknown>, string, string][] = [
    [{ ...baseRequest, callId: "" }, "tool-call/call-id-missing", "callId"],
    [{ ...baseRequest, callId: "x".repeat(129) }, "tool-call/call-id-too-long", "callId"],
    [{ ...baseRequest, tool: null }, "tool-call/tool-identity-invalid", "tool"],
    [{ ...baseRequest, surfaceVersion: { major: 1 } }, "tool-call/surface-version-invalid", "surfaceVersion"],
    [{ ...baseRequest, requiredCapabilities: "nope" }, "tool-call/required-capabilities-not-an-array", "requiredCapabilities"],
    [{ ...baseRequest, requiredCapabilities: [42] }, "tool-call/required-capability-entry-invalid", "requiredCapabilities[0]"],
    [{ ...baseRequest, requiredCapabilities: ["random.generate", "random.generate"] }, "tool-call/required-capability-duplicate", "requiredCapabilities[1]"],
    [{ ...baseRequest, idempotencyKey: "" }, "tool-call/idempotency-key-invalid", "idempotencyKey"],
    [{ ...baseRequest, idempotencyKey: "x".repeat(129) }, "tool-call/idempotency-key-invalid", "idempotencyKey"],
    [{ ...baseRequest, deadline: { atEpochMs: 0 } }, "tool-call/deadline-invalid", "deadline.atEpochMs"],
    [{ ...baseRequest, deadline: {} }, "tool-call/deadline-invalid", "deadline.atEpochMs"],
    [{ ...baseRequest, cancellation: { requested: false } }, "tool-call/cancellation-invalid", "cancellation"],
    [{ ...baseRequest, cancellation: { requested: false, onCancel: () => () => undefined, reason: "nope" } }, "tool-call/cancellation-invalid", "cancellation"],
  ];
  for (const [input, expectedCode, expectedPath] of cases) {
    const result = validateToolCallRequest(input);
    if (result.outcome === "ok") {
      assert.fail(`expected ${expectedCode}`);
    }
    const hit = result.rejections.find((item) => item.code === expectedCode);
    assert.ok(
      hit !== undefined,
      `missing rejection ${expectedCode}; got: ${result.rejections.map((item) => item.code).join(", ")}`,
    );
    assert.equal(hit.path, expectedPath);
  }
});

test("idempotencyScope returns null without a key", () => {
  const request: ToolCallRequest = {
    kind: "tool-call-request",
    callId: "call-3",
    tool: { namespace: "playliquid", name: "dice-roll" },
    surfaceVersion: { major: 1, minor: 2 },
    input: null,
    requiredCapabilities: [],
  };
  assert.equal(idempotencyScope(request), null);
});

test("idempotencyScope scopes keys to tool + MAJOR surface only", () => {
  const request: ToolCallRequest = {
    kind: "tool-call-request",
    callId: "call-4",
    tool: { namespace: "playliquid", name: "dice-roll" },
    surfaceVersion: { major: 1, minor: 2 },
    input: null,
    requiredCapabilities: [],
    idempotencyKey: "key-1",
  };
  assert.equal(idempotencyScope(request), "playliquid/dice-roll|1|key-1");
  const otherMinor: ToolCallRequest = { ...request, surfaceVersion: { major: 1, minor: 9 } };
  assert.equal(idempotencyScope(otherMinor), "playliquid/dice-roll|1|key-1");
  const otherMajor: ToolCallRequest = { ...request, surfaceVersion: { major: 2, minor: 0 } };
  assert.equal(idempotencyScope(otherMajor), "playliquid/dice-roll|2|key-1");
  const otherTool: ToolCallRequest = { ...request, tool: { namespace: "playliquid", name: "coin-flip" } };
  assert.equal(idempotencyScope(otherTool), "playliquid/coin-flip|1|key-1");
});

test("inputFingerprint is order-insensitive for object keys", () => {
  assert.equal(inputFingerprint({ b: 2, a: 1 }), inputFingerprint({ a: 1, b: 2 }));
  assert.equal(inputFingerprint({ b: 2, a: 1 }), '{"a":n:1,"b":n:2}');
});

test("inputFingerprint renders arrays, scalars, and special numbers deterministically", () => {
  assert.equal(inputFingerprint([1, "two"]), '[n:1,"two"]');
  assert.equal(inputFingerprint(null), "null");
  assert.equal(inputFingerprint(true), "true");
  assert.equal(inputFingerprint(NaN), "n:nan");
  assert.equal(inputFingerprint(Number.POSITIVE_INFINITY), "n:+inf");
  const datePrint = inputFingerprint(new Date(0));
  if (datePrint === null) {
    assert.fail("expected a date fingerprint");
  }
  assert.ok(datePrint.startsWith("d:1970-01-01"));
});

test("inputFingerprint returns null for non-JSON values", () => {
  assert.equal(inputFingerprint(() => 1), null);
  assert.equal(inputFingerprint(undefined), null);
  assert.equal(inputFingerprint({ fn: () => 1 }), null);
  assert.equal(inputFingerprint(new Map()), null);
  assert.equal(inputFingerprint(new Set([1])), null);
  class Widget {}
  assert.equal(inputFingerprint(new Widget()), null);
});

test("inputFingerprint bounds nesting depth", () => {
  let deep: unknown = 1;
  for (let i = 0; i < 40; i += 1) {
    deep = [deep];
  }
  assert.equal(inputFingerprint(deep), null);
  let shallow: unknown = 1;
  for (let i = 0; i < 5; i += 1) {
    shallow = [shallow];
  }
  assert.equal(inputFingerprint(shallow), "[[[[[n:1]]]]]");
});

test("deadlineFromTimeoutMs derives an absolute deadline", () => {
  assert.equal(deadlineFromTimeoutMs(250, 1_000).atEpochMs, 1_250);
});

test("okOutcome carries provenance and freezes", () => {
  const ok = okOutcome("call-1", provenance, { rolled: 4 });
  assert.equal(ok.outcome, "ok");
  assert.equal(ok.callId, "call-1");
  assert.equal(ok.provenance, provenance);
  assert.deepEqual(ok.output, { rolled: 4 });
  assert.throws(() => {
    (ok as { output: unknown }).output = null;
  }, TypeError);
});

test("capabilityRefusalOutcome lists missing capabilities sorted and deduplicated", () => {
  const refusal = capabilityRefusalOutcome("call-1", provenance, ["z.last", "a.first", "z.last"]);
  assert.equal(refusal.error.code, "tool/capability-refused");
  assert.deepEqual(refusal.error.missingCapabilities, ["a.first", "z.last"]);
  assert.ok(refusal.error.message.includes("a.first"));
  assert.ok(refusal.error.message.includes("z.last"));
});

test("surfaceMismatchOutcome carries both surface versions", () => {
  const mismatch = surfaceMismatchOutcome(
    "call-1",
    provenance,
    { major: 2, minor: 0 },
    { major: 1, minor: 9 },
  );
  assert.equal(mismatch.error.code, "tool/surface-version-mismatch");
  assert.deepEqual(mismatch.error.requestedSurface, { major: 2, minor: 0 });
  assert.deepEqual(mismatch.error.declaredSurface, { major: 1, minor: 9 });
  assert.ok(mismatch.error.message.includes("never auto-coerced"));
});

test("timeoutOutcome echoes the expired deadline", () => {
  const timeout = timeoutOutcome("call-1", provenance, { atEpochMs: 10_000 });
  assert.equal(timeout.outcome, "timeout");
  assert.equal(timeout.deadline.atEpochMs, 10_000);
});

test("cancelledOutcome requires an explicit reason", () => {
  const cancelled = cancelledOutcome("call-1", provenance, "caller-requested");
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.cancellation.reason, "caller-requested");
});

test("isToolCallOutcome recognizes only well-formed outcomes", () => {
  const good = okOutcome("call-1", provenance, null);
  assert.equal(isToolCallOutcome(good), true);
  assert.equal(isToolCallOutcome({ outcome: "ok", callId: "call-1", provenance }), true);
  assert.equal(isToolCallOutcome(null), false);
  assert.equal(isToolCallOutcome({}), false);
  assert.equal(isToolCallOutcome({ outcome: "weird", callId: "call-1", provenance }), false);
  assert.equal(isToolCallOutcome({ outcome: "ok" }), false);
  assert.equal(isToolCallOutcome({ outcome: "ok", callId: "call-1" }), false);
});
