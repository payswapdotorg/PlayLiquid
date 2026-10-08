import { test } from "node:test";
import assert from "node:assert/strict";
import { asAgentId } from "@playliquid/game-contracts";
import {
  GENERALIST_ROLE,
  TASK_DIFFICULTY_LEVELS,
  generalistBaselineOrganization,
  isGeneralistBaselineOrganization,
  isOrganizationDescriptor,
} from "./organization.ts";
import { validateOrganization } from "./organization-validation.ts";
import type { OrganizationDescriptor, OrganizationSearchContext, ReviewGate } from "./organization.ts";
import { asOrganizationId, asCapabilityId, asAgentRoleId, asMemoryStoreId, asReviewGateId } from "./primitives.ts";
import { fixtureModelRoute, fixtureGameIdentity, fixtureDigest, fixtureTimestamp } from "./fixtures.ts";
function codesOf(result: ReturnType<typeof validateOrganization>): string[] {
  return result.ok ? [] : result.violations.map((violation) => violation.code);
}

test("organization: the generalist baseline is valid and canonical (lock 26)", () => {
  const baseline = generalistBaselineOrganization({
    organizationId: asOrganizationId("org-generalist")!,
    agent: asAgentId("agent-lab")!,
    model: fixtureModelRoute(),
  });
  const validation = validateOrganization(baseline);
  assert.equal(validation.ok, true);
  assert.ok(isGeneralistBaselineOrganization(baseline));
  assert.ok(isOrganizationDescriptor(baseline));
  // Canonical shape: one agent, generalist role only, no edges, no humans,
  // one self-review gate.
  assert.equal(baseline.agents.length, 1);
  assert.deepEqual(baseline.agents[0]?.roles, [GENERALIST_ROLE]);
  assert.equal(baseline.humanParticipation.mode, "none");
  assert.equal(baseline.review.gates.length, 1);
  assert.equal(baseline.review.gates[0]?.reviewers[0], baseline.agents[0]?.agent);
  // The canonical constructor is deterministic.
  const again = generalistBaselineOrganization({
    organizationId: asOrganizationId("org-generalist")!,
    agent: asAgentId("agent-lab")!,
    model: fixtureModelRoute(),
  });
  assert.deepEqual(again, baseline);
});

test("organization: a multi-agent specialist organization is valid", () => {
  const architect = asAgentId("agent-architect")!;
  const implementer = asAgentId("agent-implementer")!;
  const organization: OrganizationDescriptor = {
    id: asOrganizationId("org-specialists")!,
    agents: [
      { agent: architect, roles: [asAgentRoleId("architect")!], model: fixtureModelRoute("route-architect") },
      {
        agent: implementer,
        roles: [asAgentRoleId("implementer")!, asAgentRoleId("reviewer")!],
        model: fixtureModelRoute("route-implementer"),
      },
    ],
    capabilities: [
      { capability: asCapabilityId("capability-render")!, assignedTo: [implementer] },
      { capability: asCapabilityId("capability-planning")!, assignedTo: [architect, implementer] },
    ],
    tools: [],
    topology: [
      { kind: "delegation", from: architect, to: implementer, scope: "implementation" },
      { kind: "communication", from: implementer, to: architect, channel: "direct" },
    ],
    memory: {
      stores: [
        { storeId: asMemoryStoreId("store-org")!, scope: "organizational" },
        { storeId: asMemoryStoreId("store-architect")!, scope: "agent-private", owner: architect },
      ],
      access: [
        { store: asMemoryStoreId("store-org")!, agent: architect, mode: "read-write" },
        { store: asMemoryStoreId("store-org")!, agent: implementer, mode: "read" },
        { store: asMemoryStoreId("store-architect")!, agent: architect, mode: "read-write" },
      ],
    },
    humanParticipation: {
      mode: "optional",
      participants: [{ role: "release-approver" }],
    },
    budget: [
      { resource: "compute", amount: 12.5, unit: "gpu-hours" },
      { resource: "model-tokens", amount: 0, unit: "1k-tokens" },
    ],
    scheduling: { mode: "phase-gated", phases: ["build", "review", "release"] },
    review: {
      gates: [
        { gateId: asReviewGateId("gate-review")!, reviewers: [architect] },
      ],
    },
  };
  assert.equal(validateOrganization(organization).ok, true);
  assert.equal(isGeneralistBaselineOrganization(organization), false);
});

test("organization: an organization with humans as required participants is legal (lock 31)", () => {
  const organization: OrganizationDescriptor = {
    ...generalistBaselineOrganization({
      organizationId: asOrganizationId("org-human-review")!,
      agent: asAgentId("agent-lab-2")!,
      model: fixtureModelRoute(),
    }),
    humanParticipation: { mode: "required", participants: [{ role: "safety-approver" }] },
  };
  assert.equal(validateOrganization(organization).ok, true);
});

test("organization: validator refuses the negative paths (E8)", () => {
  const base = generalistBaselineOrganization({
    organizationId: asOrganizationId("org-neg")!,
    agent: asAgentId("agent-neg")!,
    model: fixtureModelRoute(),
  });

  // No agents at all (cascades: memory owner and reviewer become unknown).
  assert.ok(codesOf(validateOrganization({ ...base, agents: [] })).includes("no-agents"));

  // Duplicate agent identity.
  assert.ok(codesOf(validateOrganization({ ...base, agents: [base.agents[0]!, base.agents[0]!] })).includes("duplicate-agent"));

  // Missing model assignment (untyped caller).
  const noModel = { ...base, agents: [{ agent: asAgentId("agent-nomodel")!, roles: [GENERALIST_ROLE] }] } as unknown as OrganizationDescriptor;
  assert.ok(codesOf(validateOrganization(noModel)).includes("missing-model-assignment"));

  // Empty roles.
  const noRoles = { ...base, agents: [{ agent: asAgentId("agent-noroles")!, roles: [], model: fixtureModelRoute() }] } as unknown as OrganizationDescriptor;
  assert.ok(codesOf(validateOrganization(noRoles)).includes("empty-agent-roles"));

  // Self delegation.
  const agent = asAgentId("agent-self")!;
  assert.ok(
    codesOf(
      validateOrganization({
        ...base,
        agents: [{ agent, roles: [GENERALIST_ROLE], model: fixtureModelRoute() }],
        topology: [{ kind: "delegation", from: agent, to: agent, scope: "everything" }],
      }),
    ).includes("self-delegation"),
  );

  // Unknown agent in capability allocation.
  assert.ok(
    codesOf(
      validateOrganization({
        ...base,
        capabilities: [{ capability: asCapabilityId("capability-ghost")!, assignedTo: [asAgentId("agent-ghost")!] }],
      }),
    ).includes("capability-unknown-agent"),
  );

  // Memory: agent-private store without owner.
  assert.ok(
    codesOf(
      validateOrganization({
        ...base,
        memory: { stores: [{ storeId: asMemoryStoreId("store-orphan")!, scope: "agent-private" }], access: [] },
      }),
    ).includes("agent-private-store-requires-owner"),
  );

  // Memory: access grant to an unknown store.
  assert.ok(
    codesOf(
      validateOrganization({
        ...base,
        memory: { stores: [], access: [{ store: asMemoryStoreId("store-ghost")!, agent: asAgentId("agent-neg")!, mode: "read" }] },
      }),
    ).includes("memory-unknown-store"),
  );

  // Lock 31: required human participation without participants.
  assert.ok(
    codesOf(validateOrganization({ ...base, humanParticipation: { mode: "required", participants: [] } })).includes(
      "required-human-participation-without-participants",
    ),
  );

  // Lock 31: participants declared while mode is none.
  assert.ok(
    codesOf(
      validateOrganization({ ...base, humanParticipation: { mode: "none", participants: [{ role: "reviewer" }] } }),
    ).includes("participants-declared-without-participation"),
  );

  // Negative budget line.
  assert.ok(
    codesOf(validateOrganization({ ...base, budget: [{ resource: "compute", amount: -1, unit: "gpu-hours" }] })).includes(
      "invalid-budget-line",
    ),
  );

  // Phase-gated scheduling without phases.
  assert.ok(
    codesOf(validateOrganization({ ...base, scheduling: { mode: "phase-gated", phases: [] } })).includes(
      "phase-gated-without-phases",
    ),
  );

  // Review structure without gates.
  assert.ok(codesOf(validateOrganization({ ...base, review: { gates: [] } })).includes("no-review-gates"));

  // Review gate reviewed by an unknown agent.
  assert.ok(
    codesOf(
      validateOrganization({
        ...base,
        review: { gates: [{ gateId: asReviewGateId("gate-ghost")!, reviewers: [asAgentId("agent-ghost")!] }] },
      }),
    ).includes("review-gate-unknown-reviewer"),
  );

  // Review gate with a malformed evaluation-suite ref.
  assert.ok(
    codesOf(
      validateOrganization({
        ...base,
        review: {
          gates: [
            {
              gateId: asReviewGateId("gate-bad-suite")!,
              reviewers: [asAgentId("agent-neg")!],
              evaluation: { suiteId: "not-a-suite", irVersion: "9", contentDigest: "0" },
            } as unknown as ReviewGate,
          ],
        },
      }),
    ).includes("invalid-review-gate-evaluation"),
  );

  // Topology edge to an unknown agent.
  assert.ok(
    codesOf(
      validateOrganization({
        ...base,
        topology: [{ kind: "communication", from: asAgentId("agent-neg")!, to: asAgentId("agent-ghost")!, channel: "direct" }],
      }),
    ).includes("topology-unknown-agent"),
  );
});

test("organization: the search context carries the lock-25 dimensions", () => {
  const context: OrganizationSearchContext = {
    game: fixtureGameIdentity(),
    phase: "production",
    genre: "simulation",
    engine: "native-gameos",
    target: "web",
    deadline: fixtureTimestamp(2_000),
    taskDifficulty: "demanding",
  };
  assert.equal(context.taskDifficulty, "demanding");
  assert.ok(TASK_DIFFICULTY_LEVELS.includes("light"));
  assert.ok(TASK_DIFFICULTY_LEVELS.includes("extreme"));
  assert.equal(TASK_DIFFICULTY_LEVELS.includes("impossible" as never), false);
  // The context is data, not behavior: digest and time are references.
  assert.equal(typeof fixtureDigest("context"), "string");
});
