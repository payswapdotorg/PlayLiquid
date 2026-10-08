/**
 * THE ORGANIZATION MODEL (R16 — "Lab searches and learns organizations,
 * tools and capability allocation"; lock rules 25/26).
 *
 * A {@link OrganizationDescriptor} is a typed DESCRIPTION of a development
 * organization: agents (count, roles, Agent Bodies, model assignments via
 * the ZCode seam, tools), capability allocations, communication/delegation
 * topology, memory topology, human participation, budget, scheduling and
 * review/evaluation structure — exactly the candidate dimensions listed in
 * spec/architecture.md ("Game Engineering Lab"). Descriptors describe;
 * they never execute. Search and simulation over them arrive in PL-029/
 * PL-028; this module fixes the vocabulary they search over.
 *
 * Lock rule 26: the single generalist agent is the always-available
 * baseline — {@link generalistBaselineOrganization} is its canonical
 * constructor and every organization search must carry it (enforced
 * structurally by the search stage in loop.ts).
 *
 * Pure module: no IO, no clocks, no randomness, no model/provider
 * vocabulary (the ZCode seam in seams.ts is the ONLY model surface).
 */

import type { AgentId, GameIdentity } from "@playliquid/game-contracts";
import { asAgentId } from "@playliquid/game-contracts";
import type {
  AgentRoleId,
  CapabilityId,
  MemoryStoreId,
  OrganizationId,
  ReviewGateId,
  TimestampMs,
} from "./primitives.ts";
import { asAgentRoleId, asMemoryStoreId, asReviewGateId } from "./primitives.ts";
import type { AgentBodyRef, AgentToolRef, ZCodeModelAssignmentRef } from "./seams.ts";
import { isAgentBodyRef, isAgentToolRef, isZCodeModelAssignmentRef } from "./seams.ts";
import type { LabEvaluationSuiteRef } from "./evaluation-suites.ts";
import { isLabEvaluationSuiteRef } from "./evaluation-suites.ts";

/**
 * The canonical role of the always-available generalist baseline (lock 26).
 * Statically valid slug — the assertion documents intent, it cannot fail.
 */
export const GENERALIST_ROLE: AgentRoleId = asAgentRoleId("generalist")!;

/** All valid agents-participation modes for humans (lock 31). */
export const HUMAN_PARTICIPATION_MODES = Object.freeze(["none", "optional", "required"] as const);

/** Whether human participation is absent, possible or required (lock 31). */
export type HumanParticipationMode = (typeof HUMAN_PARTICIPATION_MODES)[number];

/** Returns true when `value` is a valid {@link HumanParticipationMode}. */
export function isHumanParticipationMode(value: unknown): value is HumanParticipationMode {
  return typeof value === "string" && (HUMAN_PARTICIPATION_MODES as readonly string[]).includes(value);
}

/** Frozen vocabulary of communication channel kinds. */
export const COMMUNICATION_CHANNEL_KINDS = Object.freeze(["direct", "broadcast", "queue"] as const);

/** A communication channel kind in the organization topology. */
export type CommunicationChannelKind = (typeof COMMUNICATION_CHANNEL_KINDS)[number];

/** Frozen vocabulary of scheduling modes. */
export const SCHEDULING_MODES = Object.freeze(["event-driven", "phase-gated", "continuous"] as const);

/** A scheduling mode for the organization's work. */
export type SchedulingMode = (typeof SCHEDULING_MODES)[number];

/** Frozen vocabulary of budget resource kinds. */
export const BUDGET_RESOURCE_KINDS = Object.freeze([
  "compute",
  "model-tokens",
  "human-review-hours",
  "wall-clock-hours",
  "financial",
] as const);

/** A budget resource kind. */
export type BudgetResourceKind = (typeof BUDGET_RESOURCE_KINDS)[number];

/** Frozen vocabulary of memory store scopes. */
export const MEMORY_STORE_SCOPES = Object.freeze(["agent-private", "shared", "organizational"] as const);

/** A memory store scope in the memory topology. */
export type MemoryStoreScope = (typeof MEMORY_STORE_SCOPES)[number];

/**
 * One AI agent of the organization: identity (game-contracts `AgentId` —
 * single agent-identifier authority), roles, optional Agent Body, MANDATORY
 * model assignment via the ZCode seam, and the tools it may use.
 */
export interface OrganizationAgent {
  readonly agent: AgentId;
  readonly roles: readonly AgentRoleId[];
  readonly body?: AgentBodyRef;
  readonly model: ZCodeModelAssignmentRef;
  readonly tools?: readonly AgentToolRef[];
}

/** A capability the organization allocates to specific agents (R16). */
export interface CapabilityAllocation {
  readonly capability: CapabilityId;
  readonly assignedTo: readonly AgentId[];
}

/** A directed communication edge in the organization topology. */
export interface CommunicationEdge {
  readonly kind: "communication";
  readonly from: AgentId;
  readonly to: AgentId;
  readonly channel: CommunicationChannelKind;
}

/** A directed delegation edge: `from` may delegate `scope` of work to `to`. */
export interface DelegationEdge {
  readonly kind: "delegation";
  readonly from: AgentId;
  readonly to: AgentId;
  readonly scope: string;
}

/** The communication/delegation topology of the organization. */
export type TopologyEdge = CommunicationEdge | DelegationEdge;

/** One memory store in the organization's memory topology. */
export interface MemoryStore {
  readonly storeId: MemoryStoreId;
  readonly scope: MemoryStoreScope;
  /** Owning agent; required iff scope is `agent-private`. */
  readonly owner?: AgentId;
}

/** A memory access grant: which agent may access which store, how. */
export interface MemoryAccessGrant {
  readonly store: MemoryStoreId;
  readonly agent: AgentId;
  readonly mode: "read" | "write" | "read-write";
}

/** The memory topology of the organization. */
export interface MemoryTopology {
  readonly stores: readonly MemoryStore[];
  readonly access: readonly MemoryAccessGrant[];
}

/** A human participant in the organization (identity authority is elsewhere). */
export interface HumanParticipant {
  readonly role: string;
}

/**
 * Human participation plan (lock 31: human contribution is optional unless
 * a task contract requires it). `mode: "required"` must list at least one
 * participant; `mode: "none"` must list none.
 */
export interface HumanParticipationPlan {
  readonly mode: HumanParticipationMode;
  readonly participants: readonly HumanParticipant[];
}

/** One budget line: a resource kind, a non-negative finite amount, a unit. */
export interface BudgetLine {
  readonly resource: BudgetResourceKind;
  readonly amount: number;
  readonly unit: string;
}

/** The scheduling policy of the organization. */
export interface SchedulingPolicy {
  readonly mode: SchedulingMode;
  /** Required (non-empty) when mode is `phase-gated`. */
  readonly phases?: readonly string[];
}

/** One review/evaluation gate: reviewers and optionally the suite it runs. */
export interface ReviewGate {
  readonly gateId: ReviewGateId;
  readonly reviewers: readonly AgentId[];
  readonly evaluation?: LabEvaluationSuiteRef;
}

/** The review/evaluation structure of the organization. */
export interface ReviewStructure {
  readonly gates: readonly ReviewGate[];
}

/**
 * A typed description of a development organization. Immutable data: every
 * field is readonly and there is no organization state machine here.
 */
export interface OrganizationDescriptor {
  readonly id: OrganizationId;
  readonly displayName?: string;
  readonly agents: readonly OrganizationAgent[];
  readonly capabilities: readonly CapabilityAllocation[];
  readonly tools: readonly AgentToolRef[];
  readonly topology: readonly TopologyEdge[];
  readonly memory: MemoryTopology;
  readonly humanParticipation: HumanParticipationPlan;
  readonly budget: readonly BudgetLine[];
  readonly scheduling: SchedulingPolicy;
  readonly review: ReviewStructure;
}

/**
 * The search context that makes organization search contextual and
 * evidence-driven (lock 25): the dimensions spec/architecture.md names —
 * game, phase, genre, engine, target, deadline and task difficulty. Every
 * organization search stage record must carry one (loop.ts).
 */
export interface OrganizationSearchContext {
  readonly game: GameIdentity;
  readonly phase: string;
  readonly genre?: string;
  readonly engine?: string;
  readonly target?: string;
  readonly deadline?: TimestampMs;
  readonly taskDifficulty: TaskDifficulty;
}

/** Frozen vocabulary of task difficulty levels. */
export const TASK_DIFFICULTY_LEVELS = Object.freeze(["light", "moderate", "demanding", "extreme"] as const);

/** A task difficulty level for the search context. */
export type TaskDifficulty = (typeof TASK_DIFFICULTY_LEVELS)[number];

/**
 * The canonical single-generalist baseline organization (lock 26):
 * one agent, the `generalist` role, a private memory store, no human
 * participation, no budget lines, event-driven scheduling and a single
 * self-review gate. ALWAYS available — organization search may never be
 * blocked for lack of a candidate, because this one always exists.
 */
export function generalistBaselineOrganization(params: {
  readonly organizationId: OrganizationId;
  readonly agent: AgentId;
  readonly model: ZCodeModelAssignmentRef;
}): OrganizationDescriptor {
  const role = asAgentRoleId("generalist");
  const store = asMemoryStoreId("generalist-memory");
  const gate = asReviewGateId("generalist-self-review");
  if (role === undefined || store === undefined || gate === undefined) {
    // Canonical slug literals — unreachable by construction; kept explicit
    // so the baseline can never silently degrade.
    throw new Error("generalist baseline canonical ids failed to parse");
  }
  return {
    id: params.organizationId,
    agents: [
      {
        agent: params.agent,
        roles: Object.freeze([role]),
        model: params.model,
      },
    ],
    capabilities: Object.freeze([]),
    tools: Object.freeze([]),
    topology: Object.freeze([]),
    memory: {
      stores: Object.freeze([{ storeId: store, scope: "agent-private", owner: params.agent }]),
      access: Object.freeze([{ store, agent: params.agent, mode: "read-write" }]),
    },
    humanParticipation: { mode: "none", participants: Object.freeze([]) },
    budget: Object.freeze([]),
    scheduling: { mode: "event-driven" },
    review: {
      gates: Object.freeze([{ gateId: gate, reviewers: Object.freeze([params.agent]) }]),
    },
  };
}

/**
 * Recognizes the canonical generalist baseline shape: exactly one agent
 * holding ONLY the `generalist` role, no topology edges, no human
 * participation, and a single self-review gate reviewed by that agent.
 */
export function isGeneralistBaselineOrganization(descriptor: OrganizationDescriptor): boolean {
  if (descriptor.agents.length !== 1) return false;
  const agent = descriptor.agents[0];
  if (agent === undefined) return false;
  if (agent.roles.length !== 1 || agent.roles[0] !== GENERALIST_ROLE) return false;
  if (descriptor.topology.length !== 0) return false;
  if (descriptor.humanParticipation.mode !== "none") return false;
  if (descriptor.review.gates.length !== 1) return false;
  const gate = descriptor.review.gates[0];
  if (gate === undefined) return false;
  return gate.reviewers.length === 1 && gate.reviewers[0] === agent.agent;
}

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

/**
 * Loose structural guard for untyped input. Accepts structurally plausible
 * organizations (including intentionally broken ones — use
 * {@link validateOrganization} to judge them) so that tests and callers can
 * discriminate organization-shaped values from everything else.
 */
export function isOrganizationDescriptor(value: unknown): value is OrganizationDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Record<string, unknown>;
  return (
    typeof descriptor.id === "string" &&
    Array.isArray(descriptor.agents) &&
    typeof descriptor.memory === "object" &&
    descriptor.memory !== null &&
    typeof descriptor.humanParticipation === "object" &&
    descriptor.humanParticipation !== null &&
    typeof descriptor.scheduling === "object" &&
    descriptor.scheduling !== null &&
    typeof descriptor.review === "object" &&
    descriptor.review !== null &&
    descriptor.agents.every((agent) => {
      const candidate = agent as Record<string, unknown>;
      return typeof candidate.agent === "string" && asAgentId(candidate.agent) !== undefined;
    })
  );
}
