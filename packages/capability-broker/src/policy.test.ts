/**
 * Broker policy tests: GameIR derivation, the capability bridge, and every
 * fail-closed derivation rule.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarCapabilityId, brokerPolicy, deriveBrokerPolicy } from "./policy.ts";
import type { CapabilityCoverageDeclaration } from "./policy.ts";
import { capId } from "./fakes.ts";
import {
  DEMO_MANIPULATION_CAPABILITY,
  DEMO_SENSORY_OUTPUT_CAPABILITY,
  assertDemoDocumentValid,
  demoCoverage,
  demoGameDocument,
} from "./demo.ts";

test("policy: the demo document is a valid GameIR document", () => {
  assert.doesNotThrow(assertDemoDocumentValid);
});

test("policy: derivation collects coverage, command kinds and restrictions", () => {
  const result = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { policy } = result;
  assert.deepEqual(policy.capabilityIntentKinds["avatar.movement"], ["move.to" as never]);
  assert.deepEqual(policy.capabilityIntentKinds["avatar.speech"], ["speak.say" as never]);
  assert.equal(policy.intentCommandKinds["move.to"], "world.move");
  assert.equal(policy.intentCommandKinds["speak.say"], "avatar.speak");
  assert.deepEqual(policy.restrictions.denied.map(String), ["avatar.sensory-output"]);
  assert.deepEqual(policy.restrictions.approvalRequired.map(String), ["avatar.manipulation"]);
});

test("policy: the avatar capability bridge is the frozen `avatar.<cap>` convention", () => {
  assert.equal(String(avatarCapabilityId("movement")), "avatar.movement");
  assert.equal(String(avatarCapabilityId("sensory-output")), "avatar.sensory-output");
  assert.equal(String(avatarCapabilityId("proprioception")), "avatar.proprioception");
});

test("policy: derivation refuses intents no rule handles (unadjudicatable)", () => {
  const coverage: CapabilityCoverageDeclaration[] = [
    { capability: capId("avatar.movement"), intentKinds: ["dance.waltz"], commandKindByIntent: { "dance.waltz": "world.dance" } },
  ];
  const result = deriveBrokerPolicy(demoGameDocument(), coverage);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "intent-not-handled-by-rules");
    assert.match(result.detail, /dance\.waltz/);
  }
});

test("policy: derivation refuses invalid intent kind text", () => {
  const coverage: CapabilityCoverageDeclaration[] = [
    { capability: capId("avatar.movement"), intentKinds: ["Not Valid!"], commandKindByIntent: { "Not Valid!": "x.y" } },
  ];
  const result = deriveBrokerPolicy(demoGameDocument(), coverage);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid-intent-kind");
});

test("policy: derivation refuses intents without a command kind mapping", () => {
  const coverage: CapabilityCoverageDeclaration[] = [
    { capability: capId("avatar.movement"), intentKinds: ["move.to"], commandKindByIntent: {} },
  ];
  const result = deriveBrokerPolicy(demoGameDocument(), coverage);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "intent-without-command-kind");
});

test("policy: derivation refuses duplicate capability declarations", () => {
  const doubled = [...demoCoverage(), ...demoCoverage()];
  const result = deriveBrokerPolicy(demoGameDocument(), doubled);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "duplicate-capability");
});

test("policy: conflicting command kinds for one intent kind are refused", () => {
  const coverage: CapabilityCoverageDeclaration[] = [
    { capability: capId("avatar.movement"), intentKinds: ["move.to"], commandKindByIntent: { "move.to": "world.move" } },
    { capability: capId("avatar.locomotion"), intentKinds: ["move.to"], commandKindByIntent: { "move.to": "world.walk" } },
  ];
  const result = deriveBrokerPolicy(demoGameDocument(), coverage);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "intent-without-command-kind");
  assert.match(result.detail, /conflicting/);
});

test("policy: restrictions are collected from every avatar binding", () => {
  const base = demoGameDocument();
  const document = { ...base, nodes: [...base.nodes] };
  document.nodes.push({
    id: "binding-2" as never,
    kind: "avatar-binding",
    role: "antagonist",
    restrictions: { denied: ["speech"], approvalRequired: [], sandboxed: true },
  } as never);
  const result = deriveBrokerPolicy(document, demoCoverage());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const denied = result.policy.restrictions.denied.map(String).sort();
  assert.deepEqual(denied, ["avatar.sensory-output", "avatar.speech"]);
});

test("policy: direct builder mirrors document derivation (minus rule check)", () => {
  const result = brokerPolicy(demoCoverage(), {
    denied: [DEMO_SENSORY_OUTPUT_CAPABILITY],
    approvalRequired: [DEMO_MANIPULATION_CAPABILITY],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.policy.capabilityIntentKinds["avatar.movement"], ["move.to" as never]);
  assert.equal(result.policy.intentCommandKinds["grasp.object"], "avatar.grasp");
});

test("policy: a capability with no intents is legal (perception-only)", () => {
  const coverage: CapabilityCoverageDeclaration[] = [
    { capability: capId("avatar.vision"), intentKinds: [], commandKindByIntent: {} },
  ];
  const result = deriveBrokerPolicy(demoGameDocument(), coverage);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.policy.capabilityIntentKinds["avatar.vision"], []);
});
