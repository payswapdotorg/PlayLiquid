/**
 * Module role: tests for tool identity and descriptor validation — typed,
 * accumulated, never-thrown rejections and normalized frozen descriptors.
 *
 * Implements: PL-005 §3.A.1 (tool identity & descriptors) — behavior
 * coverage for descriptor.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { toolIdSlug, validateToolDescriptor, validateToolIdentity } from "./descriptor.ts";

const validDescriptor = {
  identity: { namespace: "playliquid", name: "dice-roll" },
  surfaceVersion: { major: 1, minor: 2 },
  title: "Dice roll",
  description: "Rolls N dice with a given number of sides.",
  inputShape: { shapeId: "playliquid.shape/dice-roll-input", revision: 1 },
  outputShape: { shapeId: "playliquid.shape/dice-roll-output", revision: 3 },
  capabilities: ["random.generate"],
  defaultTimeoutMs: 5_000,
};

test("validateToolDescriptor accepts a full descriptor and normalizes it", () => {
  const result = validateToolDescriptor({ ...validDescriptor, extra: "dropped" });
  if (result.outcome !== "ok") {
    assert.fail(`expected ok, got: ${result.rejections.map((item) => item.code).join(", ")}`);
  }
  const d = result.descriptor;
  assert.equal(toolIdSlug(d.identity), "playliquid/dice-roll");
  assert.equal(d.surfaceVersion.major, 1);
  assert.equal(d.title, "Dice roll");
  assert.deepEqual(d.inputShape, { shapeId: "playliquid.shape/dice-roll-input", revision: 1 });
  assert.deepEqual(d.capabilities, ["random.generate"]);
  assert.equal(d.defaultTimeoutMs, 5_000);
  assert.equal("extra" in d, false);
});

test("validateToolDescriptor returns a frozen descriptor", () => {
  const result = validateToolDescriptor(validDescriptor);
  if (result.outcome !== "ok") {
    assert.fail("expected ok");
  }
  assert.throws(() => {
    (result.descriptor as { title: string }).title = "mutated";
  }, TypeError);
});

test("validateToolDescriptor accepts a descriptor without defaultTimeoutMs", () => {
  const result = validateToolDescriptor({
    identity: validDescriptor.identity,
    surfaceVersion: validDescriptor.surfaceVersion,
    title: validDescriptor.title,
    description: validDescriptor.description,
    inputShape: validDescriptor.inputShape,
    outputShape: validDescriptor.outputShape,
    capabilities: validDescriptor.capabilities,
  });
  if (result.outcome !== "ok") {
    assert.fail(`expected ok, got: ${result.rejections.map((item) => item.code).join(", ")}`);
  }
  assert.equal("defaultTimeoutMs" in result.descriptor, false);
});

test("validateToolDescriptor accepts the maximum default timeout", () => {
  assert.equal(validateToolDescriptor({ ...validDescriptor, defaultTimeoutMs: 600_000 }).outcome, "ok");
});

test("validateToolDescriptor rejects out-of-range default timeouts", () => {
  for (const badTimeout of [0, -5, 700_001, 2.5]) {
    const result = validateToolDescriptor({ ...validDescriptor, defaultTimeoutMs: badTimeout });
    if (result.outcome === "ok") {
      assert.fail(`expected rejection for defaultTimeoutMs=${badTimeout}`);
    }
    const expected =
      badTimeout > 600_000 ? "descriptor/default-timeout-too-large" : "descriptor/default-timeout-invalid";
    assert.equal(result.rejections[0]!.code, expected);
  }
});

test("validateToolDescriptor rejects non-objects", () => {
  for (const input of [null, 42, "x", []]) {
    const result = validateToolDescriptor(input);
    if (result.outcome === "ok") {
      assert.fail(`expected rejection for ${String(input)}`);
    }
    assert.equal(result.rejections[0]!.code, "descriptor/not-an-object");
    assert.equal(result.rejections[0]!.path, "");
  }
});

test("validateToolDescriptor accumulates every problem in one pass", () => {
  const result = validateToolDescriptor({
    identity: null,
    surfaceVersion: { major: 1 },
    title: "",
    description: "ok",
    inputShape: null,
    outputShape: { shapeId: "bad shape", revision: 0 },
    capabilities: "nope",
  });
  if (result.outcome === "ok") {
    assert.fail("expected rejection");
  }
  const codes = result.rejections.map((item) => item.code);
  assert.ok(codes.includes("descriptor/identity-not-an-object"));
  assert.ok(codes.includes("descriptor/surface-version-invalid"));
  assert.ok(codes.includes("descriptor/title-missing"));
  assert.ok(codes.includes("descriptor/shape-not-an-object"));
  assert.ok(codes.includes("descriptor/shape-id-format"));
  assert.ok(codes.includes("descriptor/shape-revision-invalid"));
  assert.ok(codes.includes("descriptor/capabilities-not-an-array"));
  assert.ok(result.rejections.length >= 7);
});

test("validateToolDescriptor rejects duplicate capabilities", () => {
  const result = validateToolDescriptor({
    ...validDescriptor,
    capabilities: ["random.generate", "random.generate"],
  });
  if (result.outcome === "ok") {
    assert.fail("expected rejection");
  }
  assert.deepEqual(result.rejections.map((item) => item.code), ["descriptor/capability-duplicate"]);
  assert.equal(result.rejections[0]!.path, "capabilities[1]");
});

test("validateToolDescriptor rejects invalid capability entries with paths", () => {
  const result = validateToolDescriptor({ ...validDescriptor, capabilities: [42] });
  if (result.outcome === "ok") {
    assert.fail("expected rejection");
  }
  assert.equal(result.rejections[0]!.code, "descriptor/capability-entry-invalid");
  assert.equal(result.rejections[0]!.path, "capabilities[0]");
});

test("validateToolDescriptor never throws on hostile objects", () => {
  const hostile: Record<string, unknown> = {};
  Object.defineProperty(hostile, "identity", {
    enumerable: true,
    get(): unknown {
      throw new Error("boom");
    },
  });
  const result = validateToolDescriptor(hostile);
  if (result.outcome === "ok") {
    assert.fail("expected rejection");
  }
  assert.ok(result.rejections.some((item) => item.code === "descriptor/identity-not-an-object"));
});

test("validateToolIdentity rejects a non-object with a typed code", () => {
  const result = validateToolIdentity(null);
  if (result.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(result.rejections[0]!.code, "descriptor/identity-not-an-object");
  assert.equal(result.rejections[0]!.path, "identity");
});

test("validateToolIdentity reports each bad identity field", () => {
  const result = validateToolIdentity({ namespace: "Playliquid", name: "dice roll" });
  if (result.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.deepEqual(result.rejections.map((item) => item.code), [
    "descriptor/namespace-format",
    "descriptor/name-format",
  ]);
  assert.equal(result.rejections[0]!.path, "identity.namespace");
  assert.equal(result.rejections[1]!.path, "identity.name");
});

test("validateToolIdentity flags missing fields", () => {
  const result = validateToolIdentity({});
  if (result.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.deepEqual(result.rejections.map((item) => item.code), [
    "descriptor/namespace-missing",
    "descriptor/name-missing",
  ]);
});

test("validateToolIdentity accepts a valid identity and freezes it", () => {
  const result = validateToolIdentity({ namespace: "playliquid", name: "dice-roll" });
  if (result.outcome !== "ok") {
    assert.fail("expected ok");
  }
  assert.throws(() => {
    (result.identity as { name: string }).name = "x";
  }, TypeError);
});

test("toolIdSlug renders namespace/name", () => {
  assert.equal(toolIdSlug({ namespace: "playliquid", name: "dice-roll" }), "playliquid/dice-roll");
});
