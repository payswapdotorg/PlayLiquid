/**
 * THE ORGANIZATION COMPILER (PL-029) — a total, deterministic function from
 * lab-contracts organization descriptors to evaluation-ready compiled
 * records (spec/architecture.md §Lab loop: "organization search →
 * simulation/evaluation").
 *
 * Totality: the input is `unknown`. Every invalid input is a typed
 * kebab-case {@link CompileRejection}; the compiler never throws, never
 * returns `any`, and accumulates rejections in ONE pass (a malformed body
 * reference does not hide a later capability violation — both are
 * reported). A descriptor is compiled only when the rejection list is
 * empty.
 *
 * Resolution model (one authority per concern — consumed, never
 * duplicated):
 * - structure: lab-contracts `validateOrganization` (the Lab's own
 *   validator) — violations become `organization-invalid` rejections;
 * - agent bodies: resolved through the injected {@link BodyCatalogPort}
 *   against avatar-runtime definitions; the R5 restriction projection
 *   (granted/denied capabilities, served intent kinds, effective sensor
 *   channels) is CONSUMED from `@playliquid/avatar-runtime`
 *   (composeAvatar's projection family), never re-implemented;
 * - model assignments: carried as opaque ZCode seam references (lock
 *   rule 5 — no model, provider or price vocabulary exists here);
 * - tools: resolved through the optional {@link ToolCatalogPort};
 * - capabilities: optionally gated against a caller-supplied vocabulary
 *   (the search's bounded vocabulary) — out-of-vocabulary allocations are
 *   `unresolvable-capability-reference` rejections.
 *
 * The single-generalist baseline compiles by construction (lock 26):
 * `generalistBaselineOrganization(...)` needs no body, no tool and no
 * capability resolution, and `isBaseline` marks the parity.
 *
 * {@link labEvaluationRequestOf} projects a compiled organization into a
 * @playliquid/lab-simulation `LabEvaluationRequest` — the simulation-runnable
 * form the PL-028 engine admits.
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import type {
  AgentBodyRef,
  AgentToolRef,
  CapabilityAllocation,
  CapabilityId,
  OrganizationDescriptor,
  OrganizationId,
  OrganizationSearchContext,
  ZCodeModelAssignmentRef,
} from "@playliquid/lab-contracts";
import {
  isGeneralistBaselineOrganization,
  isOrganizationDescriptor,
  validateOrganization,
} from "@playliquid/lab-contracts";
import type { AgentId } from "@playliquid/game-contracts";
import { isHostRestriction } from "@playliquid/game-contracts";
import type { HostRestriction } from "@playliquid/game-contracts";
import type { AvatarDefinition } from "@playliquid/avatar-runtime";
import { effectiveCapabilities, effectiveSensorChannels, servedIntentKinds } from "@playliquid/avatar-runtime";
import type { EvidenceBundleRef, LabEvaluationRequest } from "@playliquid/lab-simulation";
import type { TenantId } from "@playliquid/platform-contracts";
import type { SubjectId } from "@playliquid/platform-contracts";
import type {
  CompiledAgentCapabilities,
  CompiledAgentSlot,
  CompiledBodySlot,
  CompiledOrganization,
  CompiledTopologyEdge,
  CompileRejection,
} from "./records.ts";
import type { LabCycleId, EvaluationSeed, LabEvaluationSuiteRef, TimestampMs } from "@playliquid/lab-contracts";
import { candidateDigestOf } from "./digest.ts";

/** Resolves Agent Body references against avatar-runtime definitions. */
export type BodyCatalogPort = (ref: AgentBodyRef) => AvatarDefinition | undefined;

/** Resolves Tool Fabric references (opaque; Tool Fabric owns the real one). */
export type ToolCatalogPort = (ref: AgentToolRef) => AgentToolRef | undefined;

/** The resolution ports the pure compiler needs (host-injected). */
export interface CompilePorts {
  readonly bodies: BodyCatalogPort;
  readonly tools?: ToolCatalogPort;
}

/** Options of {@link compileOrganization}. */
export interface CompileOptions {
  readonly ports: CompilePorts;
  /** Capability vocabulary gate (the search's bounded vocabulary). */
  readonly capabilities?: readonly CapabilityId[];
  /** Host restriction for the R5 body projection. */
  readonly restriction?: HostRestriction;
}

/** Result of {@link compileOrganization}: total, never throws. */
export type CompileResult =
  | { readonly ok: true; readonly compiled: CompiledOrganization }
  | { readonly ok: false; readonly rejections: readonly CompileRejection[] };

/** The identity restriction (R5: nothing denied — the no-restriction case). */
const UNRESTRICTED: HostRestriction = { denied: [], approvalRequired: [], sandboxed: false };

/**
 * Compiles one organization descriptor. One pass, rejections accumulated;
 * ok only when the descriptor is organization-valid AND every external
 * reference resolves. The compiled record is content-addressed by the
 * descriptor's canonical content (digest.ts discipline).
 */
export function compileOrganization(descriptor: unknown, options: CompileOptions): CompileResult {
  const rejections: CompileRejection[] = [];
  if (!isOrganizationDescriptor(descriptor)) {
    return {
      ok: false,
      rejections: Object.freeze([
        { code: "not-an-organization", detail: "input is not an organization-shaped descriptor" },
      ]),
    };
  }
  const validation = validateOrganization(descriptor);
  if (!validation.ok) {
    for (const violation of validation.violations) {
      rejections.push({ code: "organization-invalid", detail: `${violation.code}: ${violation.detail}` });
    }
  }
  const restriction = restrictionOf(options.restriction, rejections);

  const slots: CompiledAgentSlot[] = [];
  for (const agent of descriptor.agents) {
    slots.push(compileAgentSlot(agent, options, restriction, rejections));
  }

  const toolPort = options.ports.tools;
  if (toolPort !== undefined) {
    for (const tool of descriptor.tools) {
      if (toolPort(tool) === undefined) {
        rejections.push({
          code: "unresolvable-tool-reference",
          detail: `organization tool ${String(tool.toolId)} is not in the tool catalog`,
        });
      }
    }
  }

  const vocabulary = options.capabilities;
  if (vocabulary !== undefined) {
    const known = new Set(vocabulary.map((capability) => String(capability)));
    for (const allocation of descriptor.capabilities) {
      if (!known.has(String(allocation.capability))) {
        rejections.push({
          code: "unresolvable-capability-reference",
          detail: `capability ${String(allocation.capability)} is not in the declared vocabulary`,
        });
      }
    }
  }

  if (rejections.length > 0) {
    return { ok: false, rejections: Object.freeze(rejections) };
  }
  return { ok: true, compiled: assembleCompiled(descriptor, slots) };
}

/** Compiles one agent slot (body resolution + R5 projection). */
function compileAgentSlot(
  agent: OrganizationDescriptor["agents"][number],
  options: CompileOptions,
  restriction: HostRestriction,
  rejections: CompileRejection[],
): CompiledAgentSlot {
  const slot: CompiledAgentSlot = {
    agent: agent.agent,
    roles: agent.roles,
    model: agent.model,
    tools: agent.tools ?? [],
  };
  if (agent.body === undefined) return slot;
  const definition = options.ports.bodies(agent.body);
  if (definition === undefined) {
    rejections.push({
      code: "unresolvable-body-reference",
      detail: `agent ${String(agent.agent)} references body ${String(agent.body.bodyId)} which the catalog does not resolve`,
    });
    return slot;
  }
  const effective = effectiveCapabilities(definition, restriction);
  const body: CompiledBodySlot = {
    ref: agent.body,
    definitionDigest: String(definition.definitionDigest),
    granted: effective.granted.map((capability) => String(capability)),
    denied: effective.denied.map((capability) => String(capability)),
    servedIntentKinds: [...servedIntentKinds(definition, restriction)].sort(),
    sensorChannels: [...effectiveSensorChannels(definition, restriction)].sort(),
  };
  return { ...slot, body };
}

/** Validates the caller-supplied restriction; defaults to unrestricted. */
function restrictionOf(restriction: HostRestriction | undefined, rejections: CompileRejection[]): HostRestriction {
  if (restriction === undefined) return UNRESTRICTED;
  if (!isHostRestriction(restriction)) {
    rejections.push({ code: "invalid-restriction", detail: "restriction is not a valid HostRestriction" });
    return UNRESTRICTED;
  }
  return restriction;
}

/** Assembles the sealed compiled record (callers guarantee no rejections). */
function assembleCompiled(
  descriptor: OrganizationDescriptor,
  slots: readonly CompiledAgentSlot[],
): CompiledOrganization {
  const byAgent = new Map<string, CapabilityId[]>();
  const allocations: CapabilityAllocation[] = [...descriptor.capabilities];
  for (const allocation of allocations) {
    for (const agent of allocation.assignedTo) {
      const held = byAgent.get(String(agent)) ?? [];
      held.push(allocation.capability);
      byAgent.set(String(agent), held);
    }
  }
  const agentCapabilities: CompiledAgentCapabilities[] = slots.map((slot) => ({
    agent: slot.agent,
    capabilities: Object.freeze(byAgent.get(String(slot.agent)) ?? []),
  }));
  const topology: CompiledTopologyEdge[] = descriptor.topology.map((edge) =>
    edge.kind === "communication"
      ? { kind: "communication", from: edge.from, to: edge.to, channel: edge.channel }
      : { kind: "delegation", from: edge.from, to: edge.to, scope: edge.scope },
  );
  return {
    organizationId: descriptor.id,
    descriptor,
    isBaseline: isGeneralistBaselineOrganization(descriptor),
    agentSlots: Object.freeze(slots),
    agentCapabilities: Object.freeze(agentCapabilities),
    tools: descriptor.tools,
    topology: Object.freeze(topology),
    memoryStores: descriptor.memory.stores.length,
    memoryGrants: descriptor.memory.access.length,
    budgetLines: descriptor.budget.length,
    schedulingMode: descriptor.scheduling.mode,
    reviewGates: descriptor.review.gates.length,
    humanParticipationMode: descriptor.humanParticipation.mode,
    contentDigest: candidateDigestOf(descriptor),
  };
}

/** Input of {@link labEvaluationRequestOf} (the simulation projection). */
export interface LabEvaluationRequestInput {
  readonly compiled: CompiledOrganization;
  readonly tenant: TenantId;
  readonly owner: SubjectId;
  readonly cycleId: LabCycleId;
  readonly suite: LabEvaluationSuiteRef;
  readonly evidence: EvidenceBundleRef;
  readonly context: OrganizationSearchContext;
  readonly parameters: { readonly seed: EvaluationSeed; readonly tickBudget: number };
  readonly requestedAt: TimestampMs;
}

/**
 * Projects a compiled organization into the simulation-runnable form: the
 * @playliquid/lab-simulation evaluation request (organization descriptor +
 * suite pin + evidence bundle + parameters, bound as one typed request).
 * Mechanical — every field is carried, none is invented.
 */
export function labEvaluationRequestOf(input: LabEvaluationRequestInput): LabEvaluationRequest {
  return {
    tenant: input.tenant,
    owner: input.owner,
    cycleId: input.cycleId,
    organization: input.compiled.descriptor,
    evidence: input.evidence,
    suite: input.suite,
    context: input.context,
    parameters: { seed: input.parameters.seed, tickBudget: input.parameters.tickBudget },
    requestedAt: input.requestedAt,
  };
}

/** Convenience re-export of the slot types used by callers (typed imports). */
export type { CompiledAgentSlot as LabCompiledAgentSlot };
export type { AgentId as LabOrganizationAgentId };
export type { OrganizationId as LabOrganizationId };
export type { ZCodeModelAssignmentRef as LabZCodeModelAssignmentRef };
