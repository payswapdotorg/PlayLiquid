/**
 * The organization validator (R16/lock 25/26 negative surface).
 *
 * `validateOrganization` checks every dimension of the
 * {@link OrganizationDescriptor} model — agent uniqueness and ZCode-seam
 * model assignments, capability allocation closure, topology edge
 * endpoints, memory topology consistency, lock-31 human participation
 * rules, budget finiteness, scheduling/phase coherence and
 * review-structure closure — reporting typed violation codes. Pure:
 * never throws, never mutates. Split from organization.ts to keep both
 * modules inside the house file-size budget.
 */

import type { OrganizationDescriptor } from "./organization.ts";
import {
  BUDGET_RESOURCE_KINDS,
  COMMUNICATION_CHANNEL_KINDS,
  MEMORY_STORE_SCOPES,
  SCHEDULING_MODES,
  isHumanParticipationMode,
} from "./organization.ts";
import { asAgentRoleId, asReviewGateId } from "./primitives.ts";
import { isAgentBodyRef, isAgentToolRef, isZCodeModelAssignmentRef } from "./seams.ts";
import { isLabEvaluationSuiteRef } from "./evaluation-suites.ts";

/** Typed violation code of {@link validateOrganization}. */
export type OrganizationViolationCode =
  | "no-agents"
  | "duplicate-agent"
  | "empty-agent-roles"
  | "invalid-agent-role"
  | "missing-model-assignment"
  | "invalid-agent-body"
  | "invalid-agent-tool"
  | "duplicate-capability"
  | "empty-capability-allocation"
  | "capability-unknown-agent"
  | "topology-unknown-agent"
  | "self-delegation"
  | "invalid-communication-channel"
  | "empty-delegation-scope"
  | "memory-unknown-store"
  | "memory-unknown-agent"
  | "duplicate-memory-store"
  | "agent-private-store-requires-owner"
  | "unexpected-store-owner"
  | "invalid-memory-scope"
  | "required-human-participation-without-participants"
  | "participants-declared-without-participation"
  | "empty-participant-role"
  | "invalid-human-participation-mode"
  | "invalid-budget-line"
  | "invalid-scheduling-mode"
  | "phase-gated-without-phases"
  | "no-review-gates"
  | "review-gate-without-reviewers"
  | "review-gate-unknown-reviewer"
  | "duplicate-review-gate"
  | "invalid-review-gate-evaluation";

/** One typed violation of the organization validator. */
export interface OrganizationViolation {
  readonly code: OrganizationViolationCode;
  readonly detail: string;
}

/** Result of {@link validateOrganization}. */
export type OrganizationValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly OrganizationViolation[] };

/**
 * Pure structural validator for {@link OrganizationDescriptor}. Checks
 * every dimension of the model: agent uniqueness and model assignments
 * (through the ZCode seam), capability allocation closure, topology edge
 * endpoints, memory topology consistency, lock-31 human participation
 * rules, budget finiteness, scheduling/phase coherence and review-structure
 * closure. Returns typed violation codes — never throws, never mutates.
 */
export function validateOrganization(descriptor: OrganizationDescriptor): OrganizationValidationResult {
  const violations: OrganizationViolation[] = [];
  const known = new Set<string>();

  if (descriptor.agents.length === 0) {
    violations.push({ code: "no-agents", detail: "an organization needs at least one agent" });
  }
  for (const agent of descriptor.agents) {
    if (known.has(agent.agent)) {
      violations.push({ code: "duplicate-agent", detail: `agent ${agent.agent} appears twice` });
    }
    known.add(agent.agent);
    if (agent.roles.length === 0) {
      violations.push({ code: "empty-agent-roles", detail: `agent ${agent.agent} has no roles` });
    }
    for (const role of agent.roles) {
      if (asAgentRoleId(role) === undefined) {
        violations.push({ code: "invalid-agent-role", detail: `agent ${agent.agent} has malformed role` });
      }
    }
    if (!isZCodeModelAssignmentRef(agent.model)) {
      violations.push({ code: "missing-model-assignment", detail: `agent ${agent.agent} lacks a ZCode model assignment` });
    }
    if (agent.body !== undefined && !isAgentBodyRef(agent.body)) {
      violations.push({ code: "invalid-agent-body", detail: `agent ${agent.agent} has malformed body ref` });
    }
    for (const tool of agent.tools ?? []) {
      if (!isAgentToolRef(tool)) {
        violations.push({ code: "invalid-agent-tool", detail: `agent ${agent.agent} has malformed tool ref` });
      }
    }
  }
  if (descriptor.tools.some((tool) => !isAgentToolRef(tool))) {
    violations.push({ code: "invalid-agent-tool", detail: "organization-level tool ref is malformed" });
  }

  const capabilities = new Set<string>();
  for (const allocation of descriptor.capabilities) {
    if (capabilities.has(allocation.capability)) {
      violations.push({ code: "duplicate-capability", detail: `capability ${allocation.capability} allocated twice` });
    }
    capabilities.add(allocation.capability);
    if (allocation.assignedTo.length === 0) {
      violations.push({ code: "empty-capability-allocation", detail: `capability ${allocation.capability} assigned to nobody` });
    }
    for (const agent of allocation.assignedTo) {
      if (!known.has(agent)) {
        violations.push({ code: "capability-unknown-agent", detail: `capability ${allocation.capability} references unknown agent ${agent}` });
      }
    }
  }

  for (const edge of descriptor.topology) {
    if (!known.has(edge.from) || !known.has(edge.to)) {
      violations.push({ code: "topology-unknown-agent", detail: `topology edge references unknown agent` });
    }
    if (edge.kind === "delegation") {
      if (edge.from === edge.to) {
        violations.push({ code: "self-delegation", detail: `agent ${edge.from} delegates to itself` });
      }
      if (edge.scope.length === 0) {
        violations.push({ code: "empty-delegation-scope", detail: "delegation edge has empty scope" });
      }
    } else if (!(COMMUNICATION_CHANNEL_KINDS as readonly string[]).includes(edge.channel)) {
      violations.push({ code: "invalid-communication-channel", detail: `unknown channel ${String(edge.channel)}` });
    }
  }

  const stores = new Set<string>();
  for (const store of descriptor.memory.stores) {
    if (stores.has(store.storeId)) {
      violations.push({ code: "duplicate-memory-store", detail: `memory store ${store.storeId} declared twice` });
    }
    stores.add(store.storeId);
    if (!(MEMORY_STORE_SCOPES as readonly string[]).includes(store.scope)) {
      violations.push({ code: "invalid-memory-scope", detail: `memory store ${store.storeId} has unknown scope` });
    }
    if (store.scope === "agent-private" && store.owner === undefined) {
      violations.push({ code: "agent-private-store-requires-owner", detail: `memory store ${store.storeId} is agent-private without owner` });
    }
    if (store.scope !== "agent-private" && store.owner !== undefined) {
      violations.push({ code: "unexpected-store-owner", detail: `memory store ${store.storeId} is ${store.scope} but declares an owner` });
    }
    if (store.owner !== undefined && !known.has(store.owner)) {
      violations.push({ code: "memory-unknown-agent", detail: `memory store ${store.storeId} owned by unknown agent` });
    }
  }
  for (const grant of descriptor.memory.access) {
    if (!stores.has(grant.store)) {
      violations.push({ code: "memory-unknown-store", detail: `access grant references unknown store ${grant.store}` });
    }
    if (!known.has(grant.agent)) {
      violations.push({ code: "memory-unknown-agent", detail: `access grant references unknown agent ${grant.agent}` });
    }
  }

  const participation = descriptor.humanParticipation;
  if (!isHumanParticipationMode(participation.mode)) {
    violations.push({ code: "invalid-human-participation-mode", detail: `unknown mode ${String(participation.mode)}` });
  }
  if (participation.mode === "required" && participation.participants.length === 0) {
    violations.push({ code: "required-human-participation-without-participants", detail: "mode is required but no participant is listed" });
  }
  if (participation.mode === "none" && participation.participants.length > 0) {
    violations.push({ code: "participants-declared-without-participation", detail: "mode is none but participants are listed" });
  }
  for (const participant of participation.participants) {
    if (participant.role.length === 0) {
      violations.push({ code: "empty-participant-role", detail: "human participant has empty role" });
    }
  }

  for (const line of descriptor.budget) {
    if (
      !(BUDGET_RESOURCE_KINDS as readonly string[]).includes(line.resource) ||
      typeof line.amount !== "number" ||
      !Number.isFinite(line.amount) ||
      line.amount < 0 ||
      line.unit.length === 0
    ) {
      violations.push({ code: "invalid-budget-line", detail: `budget line for ${String(line.resource)} is malformed` });
    }
  }

  if (!(SCHEDULING_MODES as readonly string[]).includes(descriptor.scheduling.mode)) {
    violations.push({ code: "invalid-scheduling-mode", detail: `unknown mode ${String(descriptor.scheduling.mode)}` });
  }
  if (descriptor.scheduling.mode === "phase-gated" && (descriptor.scheduling.phases ?? []).length === 0) {
    violations.push({ code: "phase-gated-without-phases", detail: "phase-gated scheduling without phases" });
  }

  if (descriptor.review.gates.length === 0) {
    violations.push({ code: "no-review-gates", detail: "review structure has no gates" });
  }
  const gates = new Set<string>();
  for (const gate of descriptor.review.gates) {
    if (asReviewGateId(gate.gateId) === undefined || gates.has(gate.gateId)) {
      violations.push({ code: "duplicate-review-gate", detail: `review gate ${gate.gateId} is malformed or duplicated` });
    }
    gates.add(gate.gateId);
    if (gate.reviewers.length === 0) {
      violations.push({ code: "review-gate-without-reviewers", detail: `review gate ${gate.gateId} has no reviewers` });
    }
    for (const reviewer of gate.reviewers) {
      if (!known.has(reviewer)) {
        violations.push({ code: "review-gate-unknown-reviewer", detail: `review gate ${gate.gateId} reviewed by unknown agent ${reviewer}` });
      }
    }
    if (gate.evaluation !== undefined && !isLabEvaluationSuiteRef(gate.evaluation)) {
      violations.push({ code: "invalid-review-gate-evaluation", detail: `review gate ${gate.gateId} has malformed suite ref` });
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations: Object.freeze(violations) };
}
