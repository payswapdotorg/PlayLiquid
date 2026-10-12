/**
 * COMPOSITE LAB WORKBENCH VIEW (pure): the whole Lab read model — the six
 * surfaces (Searches, Evidence, Learning, Guidance, Gaps, Arena) plus the
 * UI selection state — assembled from ONE authoritative data snapshot.
 * The workbench components render THIS model and nothing else (E5: UI
 * consumes read models projected from the authoritative packages'
 * public contracts).
 *
 * The snapshot types are the authoritative packages' OWN public types,
 * imported verbatim (no forked vocabulary): StoredSearch and
 * SearchedCandidate (lab-organization), StoredCandidateEvidence
 * (lab-organization, over lab-simulation run records), LearningCycleRecord
 * (lab-learning), LabSearchGuidance (lab-learning — the E11 disjoint
 * union), GapLadderSummary (lab-learning) and ArenaEscalationCase
 * (arena-integration-runtime).
 *
 * Pure module: no IO, no React, no clock (E9 — timestamps render raw).
 */

import type { StoredCandidateEvidence, StoredSearch } from "../../../../lab-organization/src/index.ts";
import type { SearchedCandidate } from "../../../../lab-organization/src/index.ts";
import type {
  GapLadderSummary,
  LabLearningSignals,
  LabSearchGuidance,
  LearningCycleRecord,
} from "../../../../lab-learning/src/index.ts";
import type { ArenaEscalationCase } from "../../../../arena-integration-runtime/src/index.ts";
import type { LabSelection, LabViewer } from "./lab-selection.ts";
import { projectArenaCases, type ArenaView } from "./arena-view.ts";
import { projectEvidence, type EvidenceView } from "./evidence-view.ts";
import { projectGaps, type GapsView } from "./gaps-view.ts";
import {
  projectGuidanceSet,
  type GuidanceSetView,
} from "./guidance-view.ts";
import { projectLearning, type LearningView } from "./learning-view.ts";
import { projectSearches, type SearchesView } from "./search-view.ts";

/** The Lab workbench's navigation tabs. */
export type LabTab = "searches" | "evidence" | "learning" | "guidance" | "gaps" | "arena";

/**
 * The authoritative Lab read models a host hands the workbench. Every
 * entry is a public authoritative type; the host assembles the snapshot
 * by calling the services' read doors (listEvidence / listLearningCycles
 * / deriveSignals / deriveSearchGuidance / summarizeGaps / listCases).
 */
export interface LabDataSnapshot {
  /** The tenancy scope of this read model (R20; guards selection). */
  readonly viewer: LabViewer;
  /** Organization search sessions (PL-029 StoredSearch read model). */
  readonly searches: readonly StoredSearch[];
  /** Emitted candidate streams, keyed by search id (host-assembled grouping). */
  readonly candidateStreams: Readonly<Record<string, readonly SearchedCandidate[]>>;
  /** Immutable evaluation evidence records (PL-029 over PL-028 runs, E10/E11). */
  readonly evidence: readonly StoredCandidateEvidence[];
  /** Sealed learning-cycle records (PL-030, append-only). */
  readonly learningRecords: readonly LearningCycleRecord[];
  /** The derived learning signals (PL-030 pure fold; absent until learned). */
  readonly signals?: LabLearningSignals;
  /**
   * Derived search guidances (PL-030) — the host may derive both E11
   * epistemic classes; the marker on each guidance is authoritative and
   * the projection classifies by MARKER, never by slot position.
   */
  readonly guidance?: readonly LabSearchGuidance[];
  /** Rung-classified recurring capability-gap summaries (PL-030, R18). */
  readonly gapSummaries: readonly GapLadderSummary[];
  /** Arena escalation cases (PL-031, decided escalations only). */
  readonly arenaCases: readonly ArenaEscalationCase[];
}

/** The whole Lab workbench view model. */
export interface LabWorkbenchViewModel {
  readonly selection: LabSelection;
  readonly searches: SearchesView;
  readonly evidence: EvidenceView;
  readonly learning: LearningView;
  readonly guidance: GuidanceSetView;
  readonly gaps: GapsView;
  readonly arena: ArenaView;
}

/** Re-export the viewer tenancy (defined in lab-selection.ts). */
export type { LabViewer };

/**
 * Project one authoritative data snapshot + UI selection into the whole
 * workbench view model. Deterministic (E9): same inputs → same view.
 */
export function projectLab(
  data: LabDataSnapshot,
  selection: LabSelection,
): LabWorkbenchViewModel {
  return {
    selection,
    searches: projectSearches(data.searches, data.candidateStreams, selection, data.viewer),
    evidence: projectEvidence(data.evidence),
    learning: projectLearning(data.learningRecords, data.signals),
    guidance: projectGuidanceSet(data.guidance ?? []),
    gaps: projectGaps(data.gapSummaries),
    arena: projectArenaCases(data.arenaCases, data.viewer),
  };
}

/** Deterministic header line for the whole workbench. */
export function labSummary(view: LabWorkbenchViewModel): string {
  const open = view.searches.openStreams;
  const evidence = view.evidence.count;
  const cycles = view.learning.recordCount;
  return `Game Engineering Lab · ${open} open search${open === 1 ? "" : "es"} · ${evidence} evidence record${evidence === 1 ? "" : "s"} · ${cycles} learned cycle${cycles === 1 ? "" : "s"}`;
}
