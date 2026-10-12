/**
 * CANDIDATE GENERATION (PL-029) — the deterministic blueprint → descriptor
 * generator of the candidate space (space.ts).
 *
 * Every candidate organization is a PURE function of (space, space index):
 * content-derived ids (digest slices), cyclic catalog assignments and the
 * frozen presets of records.ts. No randomness, no clock, no IO (E9): the
 * same space + index always produces the byte-identical descriptor, so the
 * same search request always yields the same candidate sequence.
 *
 * Space index 0 is the generalist baseline (lock 26): the canonical
 * lab-contracts constructor over the canonical model catalog's first entry —
 * a search can never be structurally performed without its fallback
 * candidate. Every generated candidate is organization-valid BY
 * CONSTRUCTION (verified by tests over whole spaces); compilation
 * additionally resolves it against the avatar-runtime body catalog.
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import type {
  AgentRoleId,
  BudgetLine,
  CapabilityAllocation,
  CapabilityId,
  CommunicationEdge,
  HumanParticipationPlan,
  MemoryAccessGrant,
  MemoryStore,
  OrganizationDescriptor,
  ReviewGate,
  SchedulingPolicy,
  TopologyEdge,
} from "@playliquid/lab-contracts";
import { GENERALIST_ROLE, generalistBaselineOrganization } from "@playliquid/lab-contracts";
import { asMemoryStoreId, asReviewGateId } from "@playliquid/lab-contracts";
import type { AgentId } from "@playliquid/game-contracts";
import { asAgentId } from "@playliquid/game-contracts";
import type { CandidateBlueprint, CandidateSpace, SearchedCandidate } from "./records.ts";
import { baselineOrganizationId, candidateDigestOf, candidateOrganizationId, organizationDigestOf } from "./digest.ts";
import { decodeBlueprint } from "./space.ts";

/** Domain-separation tag for candidate id derivation. */
const CANDIDATE_ID_TAG = "playliquid:lab-organization:candidate-id:1";

/** The standard budget preset lines (budget axis, non-`none` choice). */
const STANDARD_BUDGET: readonly BudgetLine[] = Object.freeze([
  { resource: "model-tokens", amount: 1_000_000, unit: "tokens" },
  { resource: "compute", amount: 100, unit: "hours" },
]);

/** The phase-gated scheduling phases (scheduling axis, `phase-gated`). */
const PHASE_GATED_PHASES: readonly string[] = Object.freeze(["plan", "build", "review"]);

/** One private memory store id of agent slot `slot` (1-based). */
function privateStoreId(slot: number) {
  return asMemoryStoreId(`memory-a${slot}-private`)!;
}

/**
 * The candidate at one space index. Index 0 is the generalist baseline
 * (lock 26); indices >= 1 decode into blueprints. Total: out-of-range
 * indices yield `undefined`.
 */
export function candidateAtSpaceIndex(space: CandidateSpace, spaceIndex: number): SearchedCandidate | undefined {
  if (spaceIndex < 0 || spaceIndex >= space.size) return undefined;
  if (spaceIndex === 0) {
    const organization = generalistBaselineOrganization({
      organizationId: baselineOrganizationId(space.digest),
      agent: asAgentId("agent-baseline")!,
      model: space.bounds.modelCatalog[0]!,
    });
    return {
      position: spaceIndex,
      spaceIndex,
      isBaseline: true,
      organization,
      contentDigest: candidateDigestOf(organization),
    };
  }
  const blueprint = decodeBlueprint(space, spaceIndex);
  if (blueprint === undefined) return undefined;
  const organization = generateOrganization(space, spaceIndex, blueprint);
  return {
    position: spaceIndex,
    spaceIndex,
    isBaseline: false,
    blueprint,
    organization,
    contentDigest: candidateDigestOf(organization),
  };
}

/** Generates the organization descriptor of one blueprint. */
function generateOrganization(
  space: CandidateSpace,
  spaceIndex: number,
  blueprint: CandidateBlueprint,
): OrganizationDescriptor {
  const bounds = space.bounds;
  const ids: AgentId[] = [];
  for (let slot = 1; slot <= blueprint.agentCount; slot += 1) {
    ids.push(asAgentId(`agent-s${spaceIndex}a${slot}`)!);
  }
  const organizationId = candidateOrganizationId(
    organizationDigestOf({ tag: CANDIDATE_ID_TAG, space: space.digest, spaceIndex }),
  );
  const agents = ids.map((agent, index) => ({
    agent,
    roles: rolesOf(blueprint, index, bounds.roleVocabulary),
    model: bounds.modelCatalog[index % bounds.modelCatalog.length]!,
    body:
      blueprint.bodyBinding === "round-robin"
        ? bounds.bodyCatalog[index % bounds.bodyCatalog.length]
        : undefined,
    tools: [],
  }));
  return {
    id: organizationId,
    agents,
    capabilities: capabilitiesOf(blueprint, ids, bounds.capabilityVocabulary),
    tools: blueprint.toolSet === "catalog" ? bounds.toolCatalog : [],
    topology: topologyOf(blueprint, ids),
    memory: memoryOf(blueprint, ids),
    humanParticipation: humanParticipationOf(blueprint),
    budget: blueprint.budget === "standard" ? STANDARD_BUDGET : [],
    scheduling: schedulingOf(blueprint),
    review: reviewOf(blueprint, ids),
  };
}

/** Roles of agent slot `index` (0-based) under the role-assignment axis. */
function rolesOf(
  blueprint: CandidateBlueprint,
  index: number,
  vocabulary: readonly AgentRoleId[],
): readonly AgentRoleId[] {
  if (blueprint.roleAssignment === "generalist-only") return [GENERALIST_ROLE];
  return [vocabulary[index % vocabulary.length]!];
}

/** Capability allocations under the capability-spread axis. */
function capabilitiesOf(
  blueprint: CandidateBlueprint,
  ids: readonly AgentId[],
  vocabulary: readonly CapabilityId[],
): readonly CapabilityAllocation[] {
  if (blueprint.capabilitySpread === "none") return [];
  const assignees = blueprint.capabilitySpread === "all-agents" ? ids : [ids[0]!];
  return vocabulary.map((capability) => ({ capability, assignedTo: assignees }));
}

/** Communication edges under the topology axis (star/ring need >= 2 agents). */
function topologyOf(blueprint: CandidateBlueprint, ids: readonly AgentId[]): readonly TopologyEdge[] {
  if (blueprint.topology === "none" || ids.length < 2) return [];
  const edges: CommunicationEdge[] = [];
  if (blueprint.topology === "star") {
    for (let index = 1; index < ids.length; index += 1) {
      edges.push({ kind: "communication", from: ids[index]!, to: ids[0]!, channel: "queue" });
    }
    return edges;
  }
  for (let index = 0; index < ids.length; index += 1) {
    edges.push({ kind: "communication", from: ids[index]!, to: ids[(index + 1) % ids.length]!, channel: "direct" });
  }
  return edges;
}

/** Memory topology under the memory-preset axis. */
function memoryOf(
  blueprint: CandidateBlueprint,
  ids: readonly AgentId[],
): { readonly stores: readonly MemoryStore[]; readonly access: readonly MemoryAccessGrant[] } {
  if (blueprint.memory === "shared-store") {
    const store = asMemoryStoreId("memory-shared")!;
    return {
      stores: [{ storeId: store, scope: "shared" }],
      access: ids.map((agent) => ({ store, agent, mode: "read-write" as const })),
    };
  }
  return {
    stores: ids.map((agent, index) => ({
      storeId: privateStoreId(index + 1),
      scope: "agent-private" as const,
      owner: agent,
    })),
    access: ids.map((agent, index) => ({ store: privateStoreId(index + 1), agent, mode: "read-write" as const })),
  };
}

/** Human participation under the human-participation axis (lock 31). */
function humanParticipationOf(blueprint: CandidateBlueprint): HumanParticipationPlan {
  switch (blueprint.humanParticipation) {
    case "optional":
      return { mode: "optional", participants: [{ role: "human-advisor" }] };
    case "required":
      return { mode: "required", participants: [{ role: "human-approver" }] };
    default:
      return { mode: "none", participants: [] };
  }
}

/** Scheduling under the scheduling axis. */
function schedulingOf(blueprint: CandidateBlueprint): SchedulingPolicy {
  if (blueprint.scheduling === "phase-gated") return { mode: "phase-gated", phases: PHASE_GATED_PHASES };
  if (blueprint.scheduling === "continuous") return { mode: "continuous" };
  return { mode: "event-driven" };
}

/** Review structure under the review-structure axis. */
function reviewOf(blueprint: CandidateBlueprint, ids: readonly AgentId[]): { readonly gates: readonly ReviewGate[] } {
  if (blueprint.review === "lead-reviewer") {
    return { gates: [{ gateId: asReviewGateId("gate-lead-review")!, reviewers: [ids[0]!] }] };
  }
  return {
    gates: ids.map((agent, index) => ({ gateId: asReviewGateId(`gate-a${index + 1}-self`)!, reviewers: [agent] })),
  };
}
