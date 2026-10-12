/**
 * THE CANDIDATE SPACE MODEL (PL-029) — typed, bounded dimensions per
 * spec/architecture.md "Game Engineering Lab": agents, roles, Agent Bodies,
 * model assignments through ZCode, tools, capabilities, communication/
 * delegation, memory topology, human participation, budget, scheduling and
 * review/evaluation structure — twelve axes, each a small explicit
 * enumeration, so the space is FINITE per search request bounds. No
 * unbounded generation: per-dimension caps and a cross-product cap are
 * enforced with typed refusals (E8), and out-of-space values (a role, body,
 * model route, tool or capability outside the request's declared catalogs)
 * are refused by the compiler (`unresolvable-*-reference`).
 *
 * Determinism (E9): request catalogs are CANONICALIZED (validated,
 * deduplicated, lexicographically sorted by content) before the space is
 * computed, so the space is a pure function of the catalog SET — identical
 * content always yields the identical space, digest and enumeration. The
 * generalist baseline (lock 26) is candidate zero of every space.
 *
 * Axis order is the architecture's list order (agents first, review
 * structure last); the LAST axis varies fastest in the mixed-radix
 * enumeration. Human-participation and scheduling axes reuse lab-contracts'
 * FROZEN mode vocabularies (consumed, never re-declared).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import type { AgentBodyRef, ContentDigest } from "@playliquid/lab-contracts";
import {
  HUMAN_PARTICIPATION_MODES,
  SCHEDULING_MODES,
  asAgentRoleId,
  asCapabilityId,
  isAgentBodyRef,
  isAgentToolRef,
  isZCodeModelAssignmentRef,
} from "@playliquid/lab-contracts";
import type { AvatarDefinition } from "@playliquid/avatar-runtime";
import type {
  CandidateBlueprint,
  CandidateSpace,
  CandidateSpaceAxis,
  SearchDimensionBounds,
  SearchOpenRefusalCode,
} from "./records.ts";
import {
  BODY_BINDINGS,
  BUDGET_PRESETS,
  CAPABILITY_SPREADS,
  DEFAULT_PAGE_SIZE,
  MAX_BODY_CATALOG,
  MAX_CAPABILITY_VOCABULARY,
  MAX_MODEL_CATALOG,
  MAX_PAGE_SIZE,
  MAX_ROLE_VOCABULARY,
  MAX_SEARCH_AGENT_COUNT,
  MAX_SEARCH_SPACE,
  MAX_TOOL_CATALOG,
  MEMORY_PRESETS,
  MODEL_ROUTINGS,
  REVIEW_PRESETS,
  ROLE_ASSIGNMENTS,
  TOOL_SETS,
  TOPOLOGY_PRESETS,
} from "./records.ts";
import { organizationDigestOf } from "./digest.ts";

/** Result of {@link canonicalizeBounds}: total, typed refusals. */
export type BoundsResult =
  | { readonly ok: true; readonly bounds: SearchDimensionBounds }
  | { readonly ok: false; readonly code: SearchOpenRefusalCode; readonly detail: string };

/** Result of {@link computeSpace}. */
export type SpaceResult =
  | { readonly ok: true; readonly space: CandidateSpace }
  | { readonly ok: false; readonly code: "search-space-too-large"; readonly detail: string };

/**
 * Validates, deduplicates and canonicalizes (lexicographic content order)
 * the request's dimension catalogs. Unresolvable body references are
 * refused HERE (fail fast at open, before any candidate is generated).
 */
export function canonicalizeBounds(
  raw: SearchDimensionBounds,
  bodies: (ref: AgentBodyRef) => AvatarDefinition | undefined,
): BoundsResult {
  if (!Number.isInteger(raw.maxAgents) || raw.maxAgents < 1 || raw.maxAgents > MAX_SEARCH_AGENT_COUNT) {
    return {
      ok: false,
      code: "dimension-out-of-bounds",
      detail: `maxAgents must be an integer in [1, ${MAX_SEARCH_AGENT_COUNT}]`,
    };
  }
  const roles = canonicalizeVocabulary(raw.roleVocabulary, asAgentRoleId);
  if (roles === undefined) {
    return { ok: false, code: "invalid-role-vocabulary", detail: "role vocabulary contains malformed entries" };
  }
  if (roles.length === 0) {
    return { ok: false, code: "empty-role-vocabulary", detail: "the role vocabulary must not be empty" };
  }
  if (roles.length > MAX_ROLE_VOCABULARY) {
    return { ok: false, code: "dimension-out-of-bounds", detail: `role vocabulary exceeds ${MAX_ROLE_VOCABULARY} entries` };
  }
  const bodyRefs = canonicalizeRefs(raw.bodyCatalog, isAgentBodyRef, (ref) => String(ref.bodyId), "invalid-body-catalog");
  if (!bodyRefs.ok) return bodyRefs;
  for (const ref of bodyRefs.refs) {
    if (bodies(ref) === undefined) {
      return {
        ok: false,
        code: "unresolvable-body-reference",
        detail: `body ${String(ref.bodyId)} does not resolve in the body catalog`,
      };
    }
  }
  if (bodyRefs.refs.length > MAX_BODY_CATALOG) {
    return { ok: false, code: "dimension-out-of-bounds", detail: `body catalog exceeds ${MAX_BODY_CATALOG} entries` };
  }
  const models = canonicalizeRefs(raw.modelCatalog, isZCodeModelAssignmentRef, (ref) => String(ref.route), "invalid-model-catalog");
  if (!models.ok) return models;
  if (models.refs.length === 0) {
    return { ok: false, code: "empty-model-catalog", detail: "the model catalog must not be empty" };
  }
  if (models.refs.length > MAX_MODEL_CATALOG) {
    return { ok: false, code: "dimension-out-of-bounds", detail: `model catalog exceeds ${MAX_MODEL_CATALOG} entries` };
  }
  const tools = canonicalizeRefs(raw.toolCatalog, isAgentToolRef, (ref) => String(ref.toolId), "invalid-tool-catalog");
  if (!tools.ok) return tools;
  if (tools.refs.length > MAX_TOOL_CATALOG) {
    return { ok: false, code: "dimension-out-of-bounds", detail: `tool catalog exceeds ${MAX_TOOL_CATALOG} entries` };
  }
  const capabilities = canonicalizeVocabulary(raw.capabilityVocabulary, asCapabilityId);
  if (capabilities === undefined) {
    return { ok: false, code: "invalid-capability-vocabulary", detail: "capability vocabulary contains malformed entries" };
  }
  if (capabilities.length > MAX_CAPABILITY_VOCABULARY) {
    return {
      ok: false,
      code: "dimension-out-of-bounds",
      detail: `capability vocabulary exceeds ${MAX_CAPABILITY_VOCABULARY} entries`,
    };
  }
  return {
    ok: true,
    bounds: {
      maxAgents: raw.maxAgents,
      roleVocabulary: roles,
      bodyCatalog: bodyRefs.refs,
      modelCatalog: models.refs,
      toolCatalog: tools.refs,
      capabilityVocabulary: capabilities,
    },
  };
}

/** Canonicalizes a slug vocabulary (dedupe + lexicographic sort). */
function canonicalizeVocabulary<T extends string>(
  values: readonly T[],
  parse: (value: T) => T | undefined,
): readonly T[] | undefined {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    if (parse(value) === undefined) return undefined;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return Object.freeze(out.sort((a, b) => String(a).localeCompare(String(b))));
}

/** Canonicalizes a ref catalog (shape-check, dedupe, content sort). */
function canonicalizeRefs<T>(
  refs: readonly T[],
  guard: (value: T) => boolean,
  keyOf: (ref: T) => string,
  invalidCode: SearchOpenRefusalCode,
): { readonly ok: true; readonly refs: readonly T[] } | { readonly ok: false; readonly code: SearchOpenRefusalCode; readonly detail: string } {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const ref of refs) {
    if (!guard(ref)) {
      return { ok: false, code: invalidCode, detail: "catalog contains a malformed reference" };
    }
    const key = keyOf(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return { ok: true, refs: Object.freeze(out.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) };
}

/** Computes the finite candidate space of canonical bounds. */
export function computeSpace(bounds: SearchDimensionBounds): SpaceResult {
  const axes: CandidateSpaceAxis[] = [
    { dimension: "agents", values: agentAxis(bounds.maxAgents) },
    { dimension: "roles", values: ROLE_ASSIGNMENTS },
    { dimension: "bodies", values: bounds.bodyCatalog.length === 0 ? ["none"] : BODY_BINDINGS },
    { dimension: "model-assignments", values: bounds.modelCatalog.length > 1 ? MODEL_ROUTINGS : ["uniform"] },
    { dimension: "tools", values: bounds.toolCatalog.length === 0 ? ["none"] : TOOL_SETS },
    { dimension: "capabilities", values: bounds.capabilityVocabulary.length === 0 ? ["none"] : CAPABILITY_SPREADS },
    { dimension: "communication-delegation", values: TOPOLOGY_PRESETS },
    { dimension: "memory-topology", values: MEMORY_PRESETS },
    { dimension: "human-participation", values: HUMAN_PARTICIPATION_MODES },
    { dimension: "budget", values: BUDGET_PRESETS },
    { dimension: "scheduling", values: SCHEDULING_MODES },
    { dimension: "review-structure", values: REVIEW_PRESETS },
  ];
  const radices = axes.map((axis) => axis.values.length);
  const product = radices.reduce((total, radix) => total * radix, 1);
  if (product + 1 > MAX_SEARCH_SPACE) {
    return {
      ok: false,
      code: "search-space-too-large",
      detail: `computed space of ${product + 1} candidates exceeds the ${MAX_SEARCH_SPACE} cap`,
    };
  }
  const digest: ContentDigest = organizationDigestOf({ tag: "playliquid:lab-organization:space:1", bounds });
  return {
    ok: true,
    space: { bounds, axes: Object.freeze(axes), radices: Object.freeze(radices), size: product + 1, digest },
  };
}

/** The agent axis: ascending counts 1..maxAgents (content-derived order). */
function agentAxis(maxAgents: number): readonly string[] {
  const values: string[] = [];
  for (let count = 1; count <= maxAgents; count += 1) values.push(String(count));
  return Object.freeze(values);
}

/** Page-size clamp helper shared by the service doors (undefined = invalid). */
export function pageSizeOf(limit: number | undefined): number | undefined {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) return undefined;
  return limit;
}

/**
 * Decodes one space index (>= 1; 0 is the baseline) into its candidate
 * blueprint. The LAST axis varies fastest (mixed-radix, architecture-list
 * axis order). Total: out-of-range indices yield `undefined`.
 */
export function decodeBlueprint(space: CandidateSpace, spaceIndex: number): CandidateBlueprint | undefined {
  if (spaceIndex < 1 || spaceIndex >= space.size) return undefined;
  let rest = spaceIndex - 1;
  const digits: number[] = Array.from({ length: space.axes.length }, () => 0);
  for (let axis = space.axes.length - 1; axis >= 0; axis -= 1) {
    const radix = space.radices[axis] ?? 1;
    digits[axis] = rest % radix;
    rest = Math.floor(rest / radix);
  }
  const value = (axis: number): string => space.axes[axis]?.values[digits[axis] ?? 0] ?? "";
  return {
    agentCount: Number(value(0)),
    roleAssignment: parseChoice(value(1), ROLE_ASSIGNMENTS),
    bodyBinding: parseChoice(value(2), BODY_BINDINGS),
    modelRouting: parseChoice(value(3), MODEL_ROUTINGS),
    toolSet: value(4) === "catalog" ? "catalog" : "none",
    capabilitySpread: parseChoice(value(5), CAPABILITY_SPREADS),
    topology: parseChoice(value(6), TOPOLOGY_PRESETS),
    memory: parseChoice(value(7), MEMORY_PRESETS),
    humanParticipation: value(8),
    budget: parseChoice(value(9), BUDGET_PRESETS),
    scheduling: value(10),
    review: parseChoice(value(11), REVIEW_PRESETS),
  };
}

/** Membership-checked cast over a frozen enumeration (total, no throw). */
function parseChoice<T extends string>(value: string, table: readonly T[]): T {
  return (table as readonly string[]).includes(value) ? (value as T) : table[0]!;
}
