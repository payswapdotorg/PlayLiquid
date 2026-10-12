/**
 * COMPILER TESTS (PL-029) — totality, one-pass rejection accumulation,
 * external-reference resolution (bodies through avatar-runtime + the R5
 * projection), tools, capability-vocabulary gating, the simulation-runnable
 * projection and the lock-26 baseline parity.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentBodyRef, OrganizationDescriptor } from "@playliquid/lab-contracts";
import {
  asAgentRoleId,
  asCapabilityId,
  asMemoryStoreId,
  asOrganizationId,
  asReviewGateId,
  generalistBaselineOrganization,
  validateOrganization,
} from "@playliquid/lab-contracts";
import { asAgentId } from "@playliquid/game-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { compileOrganization, labEvaluationRequestOf } from "./compile.ts";
import type { CompileOptions } from "./compile.ts";
import { craftBodyDefinition, createBodyCatalog, createToolCatalog, demoBodyDefinition, fixtureBodyRef, fixtureModelAssignment, fixtureToolRef } from "./fakes.ts";
import { candidateDigestOf } from "./digest.ts";
import { labFixtureContext, labFixtureCycleId, labFixtureSuite } from "@playliquid/lab-simulation";

const bodies = createBodyCatalog([demoBodyDefinition(), craftBodyDefinition()]);
const tools = createToolCatalog([fixtureToolRef("tool-fabric-editor")]);
const options: CompileOptions = { ports: { bodies: bodies.port } };
const tenant = asTenantId("tenant-compile")!;
const subject = asSubjectId("subject-compile")!;

function teamOrganization(): OrganizationDescriptor {
  const lead = asAgentId("agent-team-lead")!;
  const second = asAgentId("agent-team-second")!;
  const shared = asMemoryStoreId("memory-team")!;
  return {
    id: asOrganizationId("org-team-fixture")!,
    agents: [
      { agent: lead, roles: [asAgentRoleId("implementer")!], model: fixtureModelAssignment(), body: fixtureBodyRef(demoBodyDefinition()) },
      { agent: second, roles: [asAgentRoleId("reviewer")!], model: fixtureModelAssignment("route-b"), body: fixtureBodyRef(craftBodyDefinition()) },
    ],
    capabilities: [{ capability: asCapabilityId("lab-cap-engineering")!, assignedTo: [lead] }],
    tools: [fixtureToolRef("tool-fabric-editor")],
    topology: [{ kind: "communication", from: second, to: lead, channel: "queue" }],
    memory: {
      stores: [{ storeId: shared, scope: "shared" }],
      access: [
        { store: shared, agent: lead, mode: "read-write" },
        { store: shared, agent: second, mode: "read" },
      ],
    },
    humanParticipation: { mode: "none", participants: [] },
    budget: [{ resource: "model-tokens", amount: 1_000, unit: "tokens" }],
    scheduling: { mode: "phase-gated", phases: ["plan", "build"] },
    review: { gates: [{ gateId: asReviewGateId("gate-team")!, reviewers: [second] }] },
  };
}

test("compile: the generalist baseline compiles by construction (lock 26)", () => {
  const baseline = generalistBaselineOrganization({
    organizationId: asOrganizationId("org-baseline-compile")!,
    agent: asAgentId("agent-baseline-compile")!,
    model: fixtureModelAssignment(),
  });
  const result = compileOrganization(baseline, options);
  assert.ok(result.ok);
  assert.equal(result.compiled.isBaseline, true);
  assert.equal(result.compiled.agentSlots.length, 1);
  assert.equal(result.compiled.agentSlots[0]!.body, undefined);
  assert.equal(result.compiled.schedulingMode, "event-driven");
  assert.equal(result.compiled.memoryStores, 1);
  assert.equal(result.compiled.reviewGates, 1);
  assert.equal(result.compiled.humanParticipationMode, "none");
});

test("compile: malformed input is a typed not-an-organization refusal (never throws)", () => {
  for (const malformed of [null, 42, "organization", {}, { id: "x" }, []]) {
    const result = compileOrganization(malformed, options);
    assert.ok(!result.ok);
    assert.equal(result.rejections.length, 1);
    assert.equal(result.rejections[0]!.code, "not-an-organization");
  }
});

test("compile: invalid organizations accumulate organization-invalid rejections in one pass", () => {
  const broken = teamOrganization();
  const descriptor = {
    ...broken,
    agents: [
      { agent: asAgentId("agent-broken")!, roles: [], model: fixtureModelAssignment() },
      { agent: asAgentId("agent-broken")!, roles: [asAgentRoleId("implementer")!], model: fixtureModelAssignment() },
    ],
    review: { gates: [] },
  } as unknown as OrganizationDescriptor;
  const result = compileOrganization(descriptor, options);
  assert.ok(!result.ok);
  const codes = result.rejections.map((rejection) => rejection.code);
  assert.ok(codes.includes("organization-invalid"));
  // One pass: duplicate-agent, empty-agent-roles and no-review-gates all
  // surface together — a later violation never hides an earlier one.
  assert.ok(result.rejections.length >= 3);
  assert.ok(result.rejections.every((rejection) => rejection.detail.length > 0));
});

test("compile: an unresolvable Agent Body reference is a typed refusal", () => {
  const pinned = fixtureBodyRef(demoBodyDefinition());
  const forged = { bodyId: "avatar-does-not-exist", revisionDigest: pinned.revisionDigest } as unknown as AgentBodyRef;
  const organization = teamOrganization();
  const descriptor = {
    ...organization,
    agents: [{ ...organization.agents[0]!, body: forged }],
  };
  const result = compileOrganization(descriptor, options);
  assert.ok(!result.ok);
  assert.ok(result.rejections.some((rejection) => rejection.code === "unresolvable-body-reference"));
});

test("compile: an unresolvable Tool Fabric reference is a typed refusal", () => {
  const result = compileOrganization(teamOrganization(), { ports: { bodies: bodies.port, tools: tools.port } });
  assert.ok(result.ok);
  const unknownTool = compileOrganization(
    { ...teamOrganization(), tools: [fixtureToolRef("tool-not-in-catalog")] },
    { ports: { bodies: bodies.port, tools: tools.port } },
  );
  assert.ok(!unknownTool.ok);
  assert.ok(unknownTool.rejections.some((rejection) => rejection.code === "unresolvable-tool-reference"));
});

test("compile: out-of-vocabulary capabilities are typed refusals (bounded space)", () => {
  const vocabulary = [asCapabilityId("lab-cap-known")!];
  const result = compileOrganization(teamOrganization(), { ports: { bodies: bodies.port }, capabilities: vocabulary });
  assert.ok(!result.ok);
  assert.ok(result.rejections.some((rejection) => rejection.code === "unresolvable-capability-reference"));
  const inside = compileOrganization(teamOrganization(), {
    ports: { bodies: bodies.port },
    capabilities: [asCapabilityId("lab-cap-engineering")!],
  });
  assert.ok(inside.ok);
});

test("compile: bodies resolve and the R5 restriction projection is consumed from avatar-runtime", () => {
  const result = compileOrganization(teamOrganization(), { ports: { bodies: bodies.port }, restriction: { denied: ["speech"], approvalRequired: [], sandboxed: false } });
  assert.ok(result.ok);
  const first = result.compiled.agentSlots[0]!;
  const second = result.compiled.agentSlots[1]!;
  assert.ok(first.body !== undefined && second.body !== undefined);
  // demo body: vision+audio sensors, movement+speech actuators; speech denied.
  assert.deepEqual([...first.body.granted].sort(), ["audio", "movement", "vision"]);
  assert.deepEqual([...first.body.denied], ["speech"]);
  assert.deepEqual(first.body.servedIntentKinds, ["move.to"]);
  assert.deepEqual(first.body.sensorChannels, ["audio.main", "vision.main"]);
  // craft body: touch sensor, manipulation+gaze actuators — untouched.
  assert.deepEqual([...second.body.granted].sort(), ["gaze", "manipulation", "touch"]);
  assert.deepEqual(second.body.denied, []);
  assert.equal(first.body.definitionDigest, String(demoBodyDefinition().definitionDigest));
});

test("compile: an invalid host restriction is a typed invalid-restriction", () => {
  const result = compileOrganization(teamOrganization(), { ports: { bodies: bodies.port }, restriction: { denied: ["not-a-capability"] } as never });
  assert.ok(!result.ok);
  assert.ok(result.rejections.some((rejection) => rejection.code === "invalid-restriction"));
});

test("compile: compiled records are content-addressed and deterministic", () => {
  const first = compileOrganization(teamOrganization(), options);
  const second = compileOrganization(teamOrganization(), options);
  assert.ok(first.ok && second.ok);
  assert.equal(String(first.compiled.contentDigest), String(second.compiled.contentDigest));
  assert.equal(String(first.compiled.contentDigest), String(candidateDigestOf(teamOrganization())));
  // A different organization compiles to a different address.
  const other = compileOrganization(
    { ...teamOrganization(), budget: [] },
    options,
  );
  assert.ok(other.ok);
  assert.notEqual(String(other.compiled.contentDigest), String(first.compiled.contentDigest));
});

test("compile: capability allocations project to the per-agent index", () => {
  const result = compileOrganization(teamOrganization(), options);
  assert.ok(result.ok);
  const lead = result.compiled.agentCapabilities.find((entry) => String(entry.agent) === "agent-team-lead");
  const second = result.compiled.agentCapabilities.find((entry) => String(entry.agent) === "agent-team-second");
  assert.deepEqual(lead?.capabilities.map((capability) => String(capability)), ["lab-cap-engineering"]);
  assert.deepEqual(second?.capabilities, []);
});

test("compile: labEvaluationRequestOf carries every field mechanically", () => {
  const result = compileOrganization(teamOrganization(), options);
  assert.ok(result.ok);
  const request = labEvaluationRequestOf({
    compiled: result.compiled,
    tenant,
    owner: subject,
    cycleId: labFixtureCycleId(),
    suite: labFixtureSuite().ref,
    evidence: { recordIds: ["evidence-std-1"], declaredDigest: candidateDigestOf(teamOrganization()) },
    context: labFixtureContext(),
    parameters: { seed: undefined as never, tickBudget: 8 },
    requestedAt: 1_000 as never,
  });
  assert.equal(String(request.tenant), String(tenant));
  assert.equal(String(request.owner), String(subject));
  assert.deepEqual(request.organization, result.compiled.descriptor);
  assert.equal(request.parameters.tickBudget, 8);
  assert.equal(String(request.suite.suiteId), "suite-lab-standard");
  assert.ok(validateOrganization(request.organization).ok);
});
