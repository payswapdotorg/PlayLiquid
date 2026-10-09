/**
 * Module role: tests for the tool/engine adapter registry — registration
 * validation, typed conflicts, unregister, deterministic resolution and
 * capability discovery.
 *
 * Implements: PL-019 registry behavior coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakeAdapter } from "@playliquid/engine-adapter-contract";
import {
  createToolFabricRegistry,
  validateToolRegistration,
} from "./domain/registry.ts";

const sampleDescriptor = {
  identity: { namespace: "playliquid", name: "dice-roll" },
  surfaceVersion: { major: 1, minor: 0 },
  title: "Dice roll",
  description: "Rolls N dice with M sides.",
  inputShape: { shapeId: "playliquid.shape/dice-input", revision: 1 },
  outputShape: { shapeId: "playliquid.shape/dice-output", revision: 1 },
  capabilities: ["random.generate"],
  defaultTimeoutMs: 5_000,
};

function sampleRegistration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    descriptor: sampleDescriptor,
    adapter: createFakeAdapter({ adapterId: "fabric.primary", offeredCapabilities: ["tool.dice"] }),
    dispatchCapability: "tool.dice",
    ...overrides,
  };
}

test("validateToolRegistration accepts a full registration", () => {
  const check = validateToolRegistration(sampleRegistration());
  if (check.outcome !== "ok") {
    assert.fail(check.rejections.map((item) => item.code).join(", "));
  }
  assert.equal(check.registration.descriptor.identity.name, "dice-roll");
  assert.equal(check.registration.dispatchCapability, "tool.dice");
  assert.equal(check.registration.adapter.id, "fabric.primary");
});

test("validateToolRegistration rejects non-objects and missing pieces with typed codes", () => {
  assert.equal(validateToolRegistration(null).outcome, "rejected");
  assert.equal(validateToolRegistration([]).outcome, "rejected");
  const missing = validateToolRegistration({});
  if (missing.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  const codes = missing.rejections.map((item) => item.code);
  assert.ok(codes.includes("registry/descriptor-missing"));
  assert.ok(codes.includes("registry/adapter-missing"));
  assert.ok(codes.includes("registry/dispatch-capability-invalid"));
});

test("validateToolRegistration rejects an invalid descriptor", () => {
  const check = validateToolRegistration(sampleRegistration({ descriptor: { identity: { namespace: "x" } } }));
  if (check.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.ok(check.rejections.some((item) => item.code === "registry/descriptor-invalid"));
});

test("validateToolRegistration rejects a malformed adapter", () => {
  const check = validateToolRegistration(sampleRegistration({ adapter: { id: "BAD ID" } }));
  if (check.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.ok(check.rejections.some((item) => item.code === "registry/adapter-id-invalid"));
  assert.ok(check.rejections.some((item) => item.code === "registry/adapter-dispatch-missing"));
  const noDispatch = validateToolRegistration(sampleRegistration({ adapter: "nope" }));
  if (noDispatch.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.ok(noDispatch.rejections.some((item) => item.code === "registry/adapter-not-an-object"));
});

test("validateToolRegistration refuses a dispatch capability the adapter does not declare", () => {
  const check = validateToolRegistration(
    sampleRegistration({ dispatchCapability: "tool.render" }),
  );
  if (check.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.ok(check.rejections.some((item) => item.code === "registry/dispatch-capability-undeclared"));
});

test("register installs; duplicate same slug+major is a typed conflict, not a silent pick", () => {
  const registry = createToolFabricRegistry();
  const first = registry.register(sampleRegistration());
  assert.equal(first.outcome, "ok");
  const second = registry.register(sampleRegistration());
  if (second.outcome !== "rejected") {
    assert.fail("expected duplicate conflict");
  }
  assert.equal(second.rejections[0]?.code, "registry/duplicate-tool");
  assert.ok(second.rejections[0]?.message.includes("fabric.primary"));

  const otherMajor = registry.register(
    sampleRegistration({
      descriptor: { ...sampleDescriptor, surfaceVersion: { major: 2, minor: 0 } },
    }),
  );
  assert.equal(otherMajor.outcome, "ok");
});

test("unregister removes exactly the matching identity+major", () => {
  const registry = createToolFabricRegistry();
  registry.register(sampleRegistration());
  const removed = registry.unregister({ namespace: "playliquid", name: "dice-roll" }, 1);
  if (removed.outcome !== "ok") {
    assert.fail("expected ok");
  }
  const again = registry.unregister({ namespace: "playliquid", name: "dice-roll" }, 1);
  if (again.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(again.code, "registry/tool-not-registered");
  const invalid = registry.unregister("nope", 1);
  if (invalid.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
});

test("resolve is exact: unknown tool vs wrong surface major vs exact hit", () => {
  const registry = createToolFabricRegistry();
  registry.register(sampleRegistration());
  registry.register(
    sampleRegistration({
      descriptor: { ...sampleDescriptor, surfaceVersion: { major: 2, minor: 1 } },
    }),
  );

  const unknown = registry.resolve({ namespace: "playliquid", name: "other" }, 1);
  if (unknown.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(unknown.code, "registry/tool-not-registered");

  const wrongMajor = registry.resolve({ namespace: "playliquid", name: "dice-roll" }, 3);
  if (wrongMajor.outcome !== "rejected") {
    assert.fail("expected rejection");
  }
  assert.equal(wrongMajor.code, "registry/surface-major-unavailable");
  assert.deepEqual(wrongMajor.registeredMajors, [1, 2]);

  const exact = registry.resolve({ namespace: "playliquid", name: "dice-roll" }, 2);
  if (exact.outcome !== "ok") {
    assert.fail("expected ok");
  }
  assert.equal(exact.registration.descriptor.surfaceVersion.minor, 1);
});

test("discoverByCapability returns only matching registrations in deterministic order", () => {
  const registry = createToolFabricRegistry();
  registry.register(sampleRegistration());
  registry.register(
    sampleRegistration({
      descriptor: { ...sampleDescriptor, identity: { namespace: "playliquid", name: "aaa-tool" } },
    }),
  );
  registry.register(
    sampleRegistration({
      descriptor: {
        ...sampleDescriptor,
        identity: { namespace: "playliquid", name: "zzz-tool" },
        capabilities: ["scene.load"],
      },
    }),
  );
  const found = registry.discoverByCapability("random.generate");
  assert.equal(found.length, 2);
  assert.equal(found[0]?.descriptor.identity.name, "aaa-tool");
  assert.equal(found[1]?.descriptor.identity.name, "dice-roll");
  assert.equal(registry.discoverByCapability("nope.capability").length, 0);
});

test("list is sorted by slug then major and reflects unregistration", () => {
  const registry = createToolFabricRegistry();
  registry.register(sampleRegistration());
  registry.register(
    sampleRegistration({
      descriptor: { ...sampleDescriptor, surfaceVersion: { major: 2, minor: 0 } },
    }),
  );
  const all = registry.list();
  assert.equal(all.length, 2);
  assert.equal(all[0]?.descriptor.surfaceVersion.major, 1);
  assert.equal(all[1]?.descriptor.surfaceVersion.major, 2);
  registry.unregister({ namespace: "playliquid", name: "dice-roll" }, 1);
  assert.equal(registry.list().length, 1);
});
