/**
 * LEARNING SIGNAL DERIVATION (PL-030) — the deterministic fold over
 * accumulated learning-cycle records (R16/R17: "The Lab learns development
 * organizations and capability allocation"; "The Lab learns from real
 * project evidence over time").
 *
 * THE SIGNAL: dimension-level outcome affinities — which
 * candidate-dimension values co-occurred with which observed-outcome
 * summaries. The fold rule (documented once, here): for each learning
 * record, for each searched candidate carrying a dimension tuple
 * (blueprint), for each dimension/value of that tuple, for each observed
 * outcome of the SAME cycle, the affinity of (dimension, value) gains one
 * co-occurrence; observation ids, outcome content digests and cycle ids
 * accumulate as unique sets. Nothing else contributes: the generalist
 * baseline (no tuple) contributes only to the baseline view, and
 * evaluation estimates NEVER contribute to observed affinities (they live
 * on the guidance module's estimate side — E11 separation).
 *
 * PURITY (E9): no wall-clock, no Math.random, no IO; the same accumulated
 * records always derive the same signals. Enumeration order is
 * content-derived: records fold in (sequence, recordId) order and
 * affinities enumerate in (dimension, value) order. The content-addressed
 * state digest makes determinism observable.
 *
 * The twelve dimension names mirror lab-organization's computed candidate
 * space axes (space.ts) — the alignment is PINNED BY TEST: a real computed
 * space's axis names are exactly covered by {@link LAB_DIMENSIONS}. The
 * names are consumed vocabulary, not a second authority.
 *
 * Pure module: no IO, no clocks, no state.
 */

import type { ContentDigest } from "@playliquid/lab-contracts";
import type { TenantId } from "@playliquid/platform-contracts";
import type { CandidateBlueprint } from "@playliquid/lab-organization";
import type { LearningCycleRecord } from "./records.ts";
import type { GapLadderSummary } from "./gaps.ts";
import { deriveGapLadderSummaries } from "./gaps.ts";
import { signalsStateDigestOf } from "./digest.ts";

/**
 * The frozen candidate-dimension vocabulary (the architecture's twelve
 * dimensions, aligned with lab-organization's CandidateSpaceAxis names).
 */
export const LAB_DIMENSIONS = Object.freeze([
  "agents",
  "roles",
  "bodies",
  "model-assignments",
  "tools",
  "capabilities",
  "communication-delegation",
  "memory-topology",
  "human-participation",
  "budget",
  "scheduling",
  "review-structure",
] as const);

/** One candidate dimension of the search space. */
export type LabDimension = (typeof LAB_DIMENSIONS)[number];

/** Returns true when `value` is a valid {@link LabDimension}. */
export function isLabDimension(value: unknown): value is LabDimension {
  return typeof value === "string" && (LAB_DIMENSIONS as readonly string[]).includes(value);
}

/** One dimension-level outcome affinity (the learning signal unit). */
export interface DimensionOutcomeAffinity {
  readonly dimension: LabDimension;
  readonly value: string;
  /** Total (candidate, outcome) co-occurrences carrying this value. */
  readonly coOccurrences: number;
  /** Sorted unique co-occurring observation ids. */
  readonly observationIds: readonly string[];
  /** Sorted unique content digests of the co-occurring observed-outcome summaries. */
  readonly outcomeDigests: readonly string[];
  /** Sorted unique cycle ids contributing to this affinity. */
  readonly cycleIds: readonly string[];
}

/** The tenant-scoped derived learning signals (pure fold output). */
export interface LabLearningSignals {
  readonly tenant: TenantId;
  readonly recordCount: number;
  /** Sorted unique cycle ids (content-derived enumeration). */
  readonly cycleIds: readonly string[];
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly observationCount: number;
  readonly conclusionCount: number;
  readonly evaluationCount: number;
  readonly searchResultCount: number;
  readonly baselineResultCount: number;
  readonly affinities: readonly DimensionOutcomeAffinity[];
  readonly gaps: readonly GapLadderSummary[];
  /** Content-addressed digest of the whole signals view (E9 determinism). */
  readonly stateDigest: ContentDigest;
}

/** The (dimension, value) pairs of one candidate blueprint (content order). */
export function blueprintDimensions(blueprint: CandidateBlueprint): readonly { readonly dimension: LabDimension; readonly value: string }[] {
  return Object.freeze([
    { dimension: "agents", value: String(blueprint.agentCount) },
    { dimension: "roles", value: blueprint.roleAssignment },
    { dimension: "bodies", value: blueprint.bodyBinding },
    { dimension: "model-assignments", value: blueprint.modelRouting },
    { dimension: "tools", value: blueprint.toolSet },
    { dimension: "capabilities", value: blueprint.capabilitySpread },
    { dimension: "communication-delegation", value: blueprint.topology },
    { dimension: "memory-topology", value: blueprint.memory },
    { dimension: "human-participation", value: blueprint.humanParticipation },
    { dimension: "budget", value: blueprint.budget },
    { dimension: "scheduling", value: blueprint.scheduling },
    { dimension: "review-structure", value: blueprint.review },
  ]);
}

/**
 * Derives the learning signals of one tenant's accumulated records.
 * PURE: a deterministic function of the record set — identical records
 * always derive byte-identical signals (stateDigest equality). The
 * records must belong to one tenant (the service guarantees it; the
 * empty set yields the typed empty state, never an exception).
 */
export function deriveLabLearningSignals(records: readonly LearningCycleRecord[], tenant: TenantId): LabLearningSignals {
  const ordered = [...records].sort((a, b) => a.sequence - b.sequence || a.recordId.localeCompare(b.recordId));
  const cycleIds = new Set<string>();
  const observationIds = new Set<string>();
  const conclusions = new Set<string>();
  const affinities = new Map<string, {
    dimension: LabDimension;
    value: string;
    coOccurrences: number;
    observations: Set<string>;
    digests: Set<string>;
    cycles: Set<string>;
  }>();
  let evaluationCount = 0;
  let searchResultCount = 0;
  let baselineResultCount = 0;

  for (const record of ordered) {
    cycleIds.add(String(record.cycleId));
    for (const outcome of record.outcomes) observationIds.add(outcome.observationId);
    for (const conclusion of record.conclusions) conclusions.add(String(conclusion.calibrationId));
    evaluationCount += record.evaluations.length;
    searchResultCount += record.searchResults.length;
    baselineResultCount += record.searchResults.filter((result) => result.isBaseline).length;

    for (const result of record.searchResults) {
      if (result.blueprint === undefined) continue;
      for (const { dimension, value } of blueprintDimensions(result.blueprint)) {
        for (const outcome of record.outcomes) {
          const key = `${dimension}\u0000${value}`;
          let affinity = affinities.get(key);
          if (affinity === undefined) {
            affinity = { dimension, value, coOccurrences: 0, observations: new Set(), digests: new Set(), cycles: new Set() };
            affinities.set(key, affinity);
          }
          affinity.coOccurrences += 1;
          affinity.cycles.add(String(record.cycleId));
          affinity.observations.add(outcome.observationId);
          affinity.digests.add(outcome.contentDigest);
        }
      }
    }
  }

  const base = {
    tenant,
    recordCount: ordered.length,
    cycleIds: [...cycleIds].sort(),
    firstSequence: ordered[0]?.sequence ?? 0,
    lastSequence: ordered[ordered.length - 1]?.sequence ?? 0,
    observationCount: observationIds.size,
    conclusionCount: conclusions.size,
    evaluationCount,
    searchResultCount,
    baselineResultCount,
    affinities: Object.freeze(
      [...affinities.values()]
        .sort((a, b) => a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value))
        .map((affinity) => ({
          dimension: affinity.dimension,
          value: affinity.value,
          coOccurrences: affinity.coOccurrences,
          observationIds: Object.freeze([...affinity.observations].sort()),
          outcomeDigests: Object.freeze([...affinity.digests].sort()),
          cycleIds: Object.freeze([...affinity.cycles].sort()),
        })),
    ),
    gaps: deriveGapLadderSummaries(ordered),
  };
  return { ...base, stateDigest: signalsStateDigestOf(base) };
}
