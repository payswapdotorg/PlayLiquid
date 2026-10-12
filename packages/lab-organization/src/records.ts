/**
 * LAB ORGANIZATION RECORD VOCABULARY (PL-029) — the typed shapes of the
 * organization-search stage of the Lab loop (spec/architecture.md §Lab
 * loop: "... → organization search → simulation/evaluation → ...").
 *
 * lab-contracts (PL-006) froze the organization MODEL and its validator;
 * lab-simulation (PL-028) froze the evaluation REQUEST and its records.
 * This package's vocabulary is the bridge between them:
 *
 * - {@link SearchDimensionBounds} — the bounded catalogs a search request
 *   supplies for the architecture's candidate dimensions;
 * - {@link CandidateSpace} — the computed finite space: per-axis
 *   enumerations, radices and the content-addressed space digest;
 * - {@link SearchCursor} — the single-use, monotonic stream cursor;
 * - {@link SearchedCandidate} — one emitted candidate (position, tuple,
 *   organization descriptor, content digest, baseline flag);
 * - the compiled-organization record family ({@link CompiledOrganization}
 *   and friends) — the evaluation-ready compiled form;
 * - typed kebab-case refusal code unions for every door.
 *
 * The frozen axis enumerations below are the explicit candidate-dimension
 * choices (spec/architecture.md "Game Engineering Lab"): agents, roles,
 * bodies, model assignments, tools, capabilities, communication/
 * delegation, memory topology, human participation, budget, scheduling,
 * review/evaluation structure — twelve axes, each a small typed
 * enumeration, so the per-request space is FINITE (space.ts enforces the
 * caps and the cross-product bound).
 *
 * Pure module: data types, guards, constants. No IO, no clocks, no
 * randomness; time is ALWAYS caller-supplied data.
 */

import type {
  AgentBodyRef,
  AgentRoleId,
  AgentToolRef,
  CapabilityId,
  ContentDigest,
  EvaluationSeed,
  LabCycleId,
  OrganizationDescriptor,
  OrganizationId,
  OrganizationSearchContext,
  TimestampMs,
  ZCodeModelAssignmentRef,
} from "@playliquid/lab-contracts";
import type { AgentId } from "@playliquid/game-contracts";
import type { TenantId } from "@playliquid/platform-contracts";
import type { SubjectId } from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Candidate-dimension enumerations (frozen; canonical order = declared order)
// ---------------------------------------------------------------------------

/** How roles from the vocabulary are assigned to agent slots. */
export const ROLE_ASSIGNMENTS = Object.freeze(["generalist-only", "vocabulary-split"] as const);
/** One value of the role-assignment axis. */
export type RoleAssignment = (typeof ROLE_ASSIGNMENTS)[number];

/** How body refs from the catalog are bound to agent slots. */
export const BODY_BINDINGS = Object.freeze(["none", "round-robin"] as const);
/** One value of the body-binding axis. */
export type BodyBinding = (typeof BODY_BINDINGS)[number];

/** How model routes from the catalog are assigned to agent slots. */
export const MODEL_ROUTINGS = Object.freeze(["uniform", "round-robin"] as const);
/** One value of the model-routing axis. */
export type ModelRouting = (typeof MODEL_ROUTINGS)[number];

/** Which subset of the tool catalog the organization carries. */
export const TOOL_SETS = Object.freeze(["none", "catalog"] as const);
/** One value of the tool-set axis. */
export type ToolSet = (typeof TOOL_SETS)[number];

/** How the capability vocabulary is allocated across agents. */
export const CAPABILITY_SPREADS = Object.freeze(["none", "lead-agent", "all-agents"] as const);
/** One value of the capability-spread axis. */
export type CapabilitySpread = (typeof CAPABILITY_SPREADS)[number];

/** Communication/delegation topology presets (star/ring need >= 2 agents). */
export const TOPOLOGY_PRESETS = Object.freeze(["none", "ring", "star"] as const);
/** One value of the topology axis. */
export type TopologyPreset = (typeof TOPOLOGY_PRESETS)[number];

/** Memory topology presets. */
export const MEMORY_PRESETS = Object.freeze(["private-only", "shared-store"] as const);
/** One value of the memory-topology axis. */
export type MemoryPreset = (typeof MEMORY_PRESETS)[number];

/** Budget presets. */
export const BUDGET_PRESETS = Object.freeze(["none", "standard"] as const);
/** One value of the budget axis. */
export type BudgetPreset = (typeof BUDGET_PRESETS)[number];

/** Review-structure presets. */
export const REVIEW_PRESETS = Object.freeze(["self-review", "lead-reviewer"] as const);
/** One value of the review-structure axis. */
export type ReviewPreset = (typeof REVIEW_PRESETS)[number];

// ---------------------------------------------------------------------------
// Bounds (E6 discipline: bounded synchronous work; the space is finite)
// ---------------------------------------------------------------------------

/** Max agent count a search may enumerate (agent axis: 1..this). */
export const MAX_SEARCH_AGENT_COUNT = 6;
/** Max distinct roles in a search's role vocabulary. */
export const MAX_ROLE_VOCABULARY = 8;
/** Max body refs in a search's body catalog. */
export const MAX_BODY_CATALOG = 6;
/** Max model assignments in a search's model catalog (>= 1 required). */
export const MAX_MODEL_CATALOG = 6;
/** Max tool refs in a search's tool catalog. */
export const MAX_TOOL_CATALOG = 8;
/** Max capabilities in a search's capability vocabulary. */
export const MAX_CAPABILITY_VOCABULARY = 8;
/** Hard cap on the computed cross-product (defense in depth). */
export const MAX_SEARCH_SPACE = 65_536;
/** Page size bounds of the candidate stream. */
export const MAX_PAGE_SIZE = 64;
/** Default page size of the candidate stream. */
export const DEFAULT_PAGE_SIZE = 16;

/** The bounded catalogs a search request supplies per candidate dimension. */
export interface SearchDimensionBounds {
  /** Agent-count axis upper bound (1..{@link MAX_SEARCH_AGENT_COUNT}). */
  readonly maxAgents: number;
  /** Role vocabulary (non-empty, distinct, valid slugs). */
  readonly roleVocabulary: readonly AgentRoleId[];
  /** Body catalog (may be empty — the body axis then collapses). */
  readonly bodyCatalog: readonly AgentBodyRef[];
  /** Model catalog (non-empty; opaque ZCode seam references, lock rule 5). */
  readonly modelCatalog: readonly ZCodeModelAssignmentRef[];
  /** Tool catalog (may be empty — the tool axis then collapses). */
  readonly toolCatalog: readonly AgentToolRef[];
  /** Capability vocabulary (may be empty — the spread axis collapses). */
  readonly capabilityVocabulary: readonly CapabilityId[];
}

// ---------------------------------------------------------------------------
// The search request and the computed space
// ---------------------------------------------------------------------------

/** One organization-search request (tenant, objective, bounds, seed — E9). */
export interface OrganizationSearchRequest {
  readonly tenant: TenantId;
  readonly owner: SubjectId;
  readonly cycleId: LabCycleId;
  /** The objective context (lock 25: contextual, evidence-driven). */
  readonly context: OrganizationSearchContext;
  readonly bounds: SearchDimensionBounds;
  /** Reproducibility seed — identical request+seed ⇒ identical sequence. */
  readonly seed: EvaluationSeed;
  /** The current organization (rung 1 of the gap ladder; optional). */
  readonly currentOrganization?: OrganizationDescriptor;
  /** Host restriction applied to candidate body projections (R5; optional). */
  readonly restriction?: unknown;
  /** Caller-supplied request time (bookkeeping; never artifact content). */
  readonly requestedAt: TimestampMs;
}

/** One axis of the computed candidate space. */
export interface CandidateSpaceAxis {
  /** The dimension this axis enumerates. */
  readonly dimension: string;
  /** The axis values in canonical content-derived order. */
  readonly values: readonly string[];
}

/** The computed, finite candidate space of one search request. */
export interface CandidateSpace {
  /** Canonical (sorted, deduplicated) catalogs the space was built from. */
  readonly bounds: SearchDimensionBounds;
  /** The twelve axes in architecture-list order (agents first, review last). */
  readonly axes: readonly CandidateSpaceAxis[];
  /** Radix per axis (axes[i].values.length); the product bounds the space. */
  readonly radices: readonly number[];
  /** Space size: 1 (generalist baseline, lock 26) + product of radices. */
  readonly size: number;
  /** Content-addressed digest of everything that determines the space. */
  readonly digest: ContentDigest;
}

/** The single-use, monotonic stream cursor of one search session. */
export interface SearchCursor {
  readonly kind: "search-cursor";
  readonly searchId: string;
  readonly spaceDigest: ContentDigest;
  /** The sequence position this cursor admits next (0-based). */
  readonly nextIndex: number;
}

/** The typed candidate tuple (one choice per axis, in axis order). */
export interface CandidateBlueprint {
  readonly agentCount: number;
  readonly roleAssignment: RoleAssignment;
  readonly bodyBinding: BodyBinding;
  readonly modelRouting: ModelRouting;
  readonly toolSet: ToolSet;
  readonly capabilitySpread: CapabilitySpread;
  readonly topology: TopologyPreset;
  readonly memory: MemoryPreset;
  readonly humanParticipation: string;
  readonly budget: BudgetPreset;
  readonly scheduling: string;
  readonly review: ReviewPreset;
}

/** One candidate of the search stream (the emitted unit). */
export interface SearchedCandidate {
  /** Sequence position (the stream order; NOT the space index). */
  readonly position: number;
  /** The space index this candidate was drawn from. */
  readonly spaceIndex: number;
  readonly isBaseline: boolean;
  readonly blueprint?: CandidateBlueprint;
  readonly organization: OrganizationDescriptor;
  readonly contentDigest: ContentDigest;
}

// ---------------------------------------------------------------------------
// The compiled organization (evaluation-ready form)
// ---------------------------------------------------------------------------

/** The compiled body slot of one agent (avatar-runtime resolution + R5). */
export interface CompiledBodySlot {
  readonly ref: AgentBodyRef;
  /** avatar-runtime whole-definition digest of the resolved definition. */
  readonly definitionDigest: string;
  /** Effective avatar capabilities the body keeps (R5 projection). */
  readonly granted: readonly string[];
  /** Declared capabilities the host restriction denies (R5/R20). */
  readonly denied: readonly string[];
  /** Intent kinds the restriction-surviving actuators can serve. */
  readonly servedIntentKinds: readonly string[];
  /** Sensor channels that survive the restriction. */
  readonly sensorChannels: readonly string[];
}

/** The compiled agent slot: everything one agent brings to evaluation. */
export interface CompiledAgentSlot {
  readonly agent: AgentId;
  readonly roles: readonly AgentRoleId[];
  /** Opaque ZCode seam reference (lock rule 5 — never a model name). */
  readonly model: ZCodeModelAssignmentRef;
  readonly tools: readonly AgentToolRef[];
  readonly body?: CompiledBodySlot;
}

/** The compiled capability-allocation view (per-agent index). */
export interface CompiledAgentCapabilities {
  readonly agent: AgentId;
  readonly capabilities: readonly CapabilityId[];
}

/** The compiled communication/delegation edge record. */
export interface CompiledTopologyEdge {
  readonly kind: "communication" | "delegation";
  readonly from: AgentId;
  readonly to: AgentId;
  /** Communication channel kind; delegation edges carry `undefined`. */
  readonly channel?: string;
  /** Delegation scope; communication edges carry `undefined`. */
  readonly scope?: string;
}

/**
 * The compiled organization: the validated descriptor plus the typed
 * compiled records the evaluation path needs. Content-addressed and sealed;
 * the generalist baseline flag is lock rule 26's parity mark.
 */
export interface CompiledOrganization {
  readonly organizationId: OrganizationId;
  readonly descriptor: OrganizationDescriptor;
  readonly isBaseline: boolean;
  readonly agentSlots: readonly CompiledAgentSlot[];
  readonly agentCapabilities: readonly CompiledAgentCapabilities[];
  readonly tools: readonly AgentToolRef[];
  readonly topology: readonly CompiledTopologyEdge[];
  readonly memoryStores: number;
  readonly memoryGrants: number;
  readonly budgetLines: number;
  readonly schedulingMode: string;
  readonly reviewGates: number;
  readonly humanParticipationMode: string;
  readonly contentDigest: ContentDigest;
}

// ---------------------------------------------------------------------------
// Typed refusal codes (kebab-case; every door is total)
// ---------------------------------------------------------------------------

/** Refusal codes of the organization compiler. */
export type CompileRefusalCode =
  | "not-an-organization"
  | "organization-invalid"
  | "unresolvable-body-reference"
  | "unresolvable-tool-reference"
  | "unresolvable-capability-reference"
  | "invalid-restriction";

/** One accumulated compiler rejection (one pass; nothing is dropped). */
export interface CompileRejection {
  readonly code: CompileRefusalCode;
  readonly detail: string;
}

/** Refusal codes of search opening (request admission). */
export type SearchOpenRefusalCode =
  | "invalid-tenant"
  | "invalid-owner"
  | "invalid-cycle"
  | "invalid-request-time"
  | "invalid-seed"
  | "invalid-context"
  | "invalid-current-organization"
  | "invalid-restriction"
  | "empty-role-vocabulary"
  | "invalid-role-vocabulary"
  | "empty-model-catalog"
  | "invalid-model-catalog"
  | "invalid-body-catalog"
  | "unresolvable-body-reference"
  | "invalid-tool-catalog"
  | "invalid-capability-vocabulary"
  | "dimension-out-of-bounds"
  | "search-space-too-large";

/** Refusal codes of the candidate stream. */
export type SearchPageRefusalCode =
  | "search-unknown"
  | "cross-tenant"
  | "invalid-cursor"
  | "cursor-space-mismatch"
  | "cursor-not-monotonic"
  | "cursor-out-of-range"
  | "invalid-page-size";

/** Refusal codes of candidate evaluation. */
export type EvaluateRefusalCode =
  | "search-unknown"
  | "cross-tenant"
  | "candidate-out-of-range"
  | "not-an-organization"
  | "organization-invalid"
  | "unresolvable-body-reference"
  | "unresolvable-tool-reference"
  | "unresolvable-capability-reference"
  | "invalid-restriction"
  | "invalid-request-time"
  | "evaluation-refused";

/** Refusal codes of the capability-gap doors. */
export type GapDoorRefusalCode =
  | "gap-unknown"
  | "cross-tenant"
  | "invalid-attempt"
  | "arena-first-resort"
  | "rung-skip"
  | "blocked-is-terminal"
  | "gap-already-resolved";

/** Structural guard for {@link SearchCursor} values (untyped input). */
export function isSearchCursor(value: unknown): value is SearchCursor {
  if (typeof value !== "object" || value === null) return false;
  const cursor = value as Record<string, unknown>;
  return (
    cursor.kind === "search-cursor" &&
    typeof cursor.searchId === "string" &&
    typeof cursor.spaceDigest === "string" &&
    /^[0-9a-f]{64}$/.test(cursor.spaceDigest) &&
    typeof cursor.nextIndex === "number" &&
    Number.isSafeInteger(cursor.nextIndex) &&
    cursor.nextIndex >= 0
  );
}

/** Structural guard for {@link CandidateBlueprint} values. */
export function isCandidateBlueprint(value: unknown): value is CandidateBlueprint {
  if (typeof value !== "object" || value === null) return false;
  const blueprint = value as Record<string, unknown>;
  return (
    typeof blueprint.agentCount === "number" &&
    typeof blueprint.roleAssignment === "string" &&
    typeof blueprint.bodyBinding === "string" &&
    typeof blueprint.modelRouting === "string" &&
    typeof blueprint.toolSet === "string" &&
    typeof blueprint.capabilitySpread === "string" &&
    typeof blueprint.topology === "string" &&
    typeof blueprint.memory === "string" &&
    typeof blueprint.humanParticipation === "string" &&
    typeof blueprint.budget === "string" &&
    typeof blueprint.scheduling === "string" &&
    typeof blueprint.review === "string"
  );
}
