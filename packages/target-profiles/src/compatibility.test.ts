/**
 * Target + engine-binding compatibility: mutual consent, fail-closed
 * refusals (an engine binding that declares no support for a target is
 * refused).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEngineBindingCompatibility } from "./compatibility.ts";
import { fixtureConsoleRecord, fixtureSparkRecord, fixtureWebRecord, fixtureBinding, fixtureDigest } from "./fixtures.ts";
import { asEngineBindingDigest, asEngineId } from "./primitives.ts";

test("a compatible binding is accepted (mutual consent)", () => {
  const profile = fixtureWebRecord();
  const binding = fixtureBinding("native", ["web", "spark"]);
  const result = checkEngineBindingCompatibility(profile, binding);
  assert.equal(result.ok, true);
});

test("an engine binding that declares no support for the target is refused", () => {
  const profile = fixtureWebRecord();
  const binding = fixtureBinding("native", ["spark"]);
  const result = checkEngineBindingCompatibility(profile, binding);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "target-not-supported");
    assert.match(result.message, /declares no support for target "web"/);
  }
});

test("an empty supported-targets declaration refuses every profile", () => {
  const profile = fixtureWebRecord();
  const result = checkEngineBindingCompatibility(profile, fixtureBinding("native", []));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "target-not-supported");
  }
});

test("a binding from an engine the profile does not declare is refused", () => {
  const profile = fixtureWebRecord();
  const binding = fixtureBinding("unreal", ["web"]);
  const result = checkEngineBindingCompatibility(profile, binding);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "engine-not-declared");
  }
});

test("a pinned profile refuses bindings outside its pin list", () => {
  const profile = {
    ...fixtureWebRecord(),
    engineBindings: {
      engines: [asEngineId("native")],
      pinnedBindings: [asEngineBindingDigest(fixtureDigest("binding-native"))],
    },
  };
  const accepted = fixtureBinding("native", ["web"]);
  assert.equal(checkEngineBindingCompatibility(profile, accepted).ok, true);

  const other = { ...accepted, bindingDigest: asEngineBindingDigest(fixtureDigest("other")) };
  const refused = checkEngineBindingCompatibility(profile, other);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "binding-not-pinned");
  }
});

test("a structurally invalid binding descriptor fails closed", () => {
  const profile = fixtureWebRecord();
  const malformed = {
    engineId: "Not-An-Engine",
    bindingDigest: fixtureDigest("binding"),
    supportedTargets: ["web"],
  };
  const result = checkEngineBindingCompatibility(profile, malformed as never);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "invalid-binding");
  }
});

test("spark and console profiles participate in the same compatibility rules", () => {
  const spark = fixtureSparkRecord();
  assert.equal(checkEngineBindingCompatibility(spark, fixtureBinding("native", ["spark", "web"])).ok, true);
  assert.equal(checkEngineBindingCompatibility(spark, fixtureBinding("native", ["web"])).ok, false);

  const consoleRecord = fixtureConsoleRecord();
  const vendorBinding = fixtureBinding("vendor-engine", ["console"]);
  assert.equal(checkEngineBindingCompatibility(consoleRecord, vendorBinding).ok, true);
  const wrongVendorEngine = fixtureBinding("vendor-engine", ["web"]);
  const refused = checkEngineBindingCompatibility(consoleRecord, wrongVendorEngine);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "target-not-supported");
  }
});
