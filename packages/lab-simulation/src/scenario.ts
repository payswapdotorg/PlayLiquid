/**
 * THE EVALUATION SCENARIO MODEL (PL-028) — the deterministic bridge from
 * Lab inputs to Simulation Runtime inputs.
 *
 * An evaluation scenario is a PURE function of the input dimensions:
 * the candidate organization (lab-contracts §organization), the search
 * context (game/phase/genre/engine/target/deadline/task-difficulty —
 * lock 25: contextual, evidence-driven) and the resolved project
 * evidence bundle (R17). The best organization MAY vary by every one of
 * these dimensions — so the scenario transforms them into world facts
 * (work-item backlog, difficulty, friction pressure) instead of encoding
 * any "best organization" policy. Search is PL-029; learning is PL-030;
 * THIS module only projects inputs into simulation inputs.
 *
 * Explicit input-dimension mappings (all documented, none hardcoded
 * policy):
 * - task difficulty → per-item work difficulty and friction probability
 *   (light 0.05 / moderate 0.10 / demanding 0.20 / extreme 0.35);
 * - evidence records → the work-item backlog (one item per record; the
 *   record KIND weights its difficulty — an incident is heavier than a
 *   replay artifact);
 * - deadline present → deadline pressure fact (ticks available vs work
 *   needed), an INPUT the metrics observe, never a gate;
 * - organization capability allocations → broker capability coverage
 *   (R20 least privilege inside the simulated organization).
 *
 * Pure module: no IO, no clocks, no randomness.
 */

import type { ProjectEvidenceRecord, TaskDifficulty } from "@playliquid/lab-contracts";
import { GENERALIST_ROLE } from "@playliquid/lab-contracts";
import type { OrganizationDescriptor, OrganizationSearchContext } from "@playliquid/lab-contracts";
import type { AgentId } from "@playliquid/game-contracts";
import { LAB_GENERALIST_CAPABILITY, LAB_WORK_INTENT_KIND } from "./records.ts";

/** Friction (defect-injection) probability by task difficulty. */
export const TASK_FRICTION_PROBABILITY: Readonly<Record<TaskDifficulty, number>> = Object.freeze({
  light: 0.05,
  moderate: 0.1,
  demanding: 0.2,
  extreme: 0.35,
});

/** Base work difficulty (progress units to complete) per evidence kind. */
export const EVIDENCE_KIND_BASE_DIFFICULTY: Readonly<Record<ProjectEvidenceRecord["kind"], number>> =
  Object.freeze({
    "replay-artifact": 6,
    "release-artifact": 8,
    "repository-metrics": 4,
    "telemetry-summary": 5,
    "incident-report": 12,
    "evaluation-run": 6,
  });

/** One work item of the evaluation backlog (world-side fact). */
export interface LabWorkItemSpec {
  /** Entity id slug inside the lab evaluation world. */
  readonly entityId: string;
  /** The evidence record the item was derived from (audit chain, R17). */
  readonly evidenceId: string;
  /** Progress units needed to complete the item. */
  readonly difficulty: number;
  /** The input-dimension facts the item carries (reviewable). */
  readonly kind: ProjectEvidenceRecord["kind"];
}

/** One acting agent of the organization, projected for simulation. */
export interface LabAgentSpec {
  readonly agent: AgentId;
  readonly roles: readonly string[];
  /** Work-authorizing capability ids this agent HOLDS (least privilege). */
  readonly workCapabilities: readonly string[];
  /** True when the agent holds no work authority (denial surface, R20). */
  readonly unprivileged: boolean;
}

/**
 * The frozen broker-coverage view of the scenario: capability id ->
 * intent kinds it authorizes. Exactly one intent kind exists in the lab
 * evaluation world: {@link LAB_WORK_INTENT_KIND}.
 */
export interface LabCapabilityCoverage {
  readonly capability: string;
  readonly intentKinds: readonly string[];
  readonly commandKindByIntent: Readonly<Record<string, string>>;
}

/** The derived evaluation scenario (everything the runner needs). */
export interface LabScenario {
  readonly workItems: readonly LabWorkItemSpec[];
  readonly agents: readonly LabAgentSpec[];
  readonly capabilityCoverage: readonly LabCapabilityCoverage[];
  /** Friction probability per open item per tick (E9-seeded draws). */
  readonly frictionProbability: number;
  /** Deadline pressure input fact (0..1+); undefined when no deadline. */
  readonly deadlinePressure: number | undefined;
  /** Bounded tick budget echo (E6 discipline). */
  readonly tickBudget: number;
}

/**
 * Builds the scenario. Deterministic: same organization + context +
 * evidence + parameters → the same scenario, always (E9).
 */
export function buildLabScenario(input: {
  readonly organization: OrganizationDescriptor;
  readonly context: OrganizationSearchContext;
  readonly evidence: readonly ProjectEvidenceRecord[];
  readonly tickBudget: number;
}): LabScenario {
  const difficultyBase = EVIDENCE_KIND_BASE_DIFFICULTY;
  const difficultyScale = taskDifficultyScale(input.context.taskDifficulty);
  const workItems: LabWorkItemSpec[] = [...input.evidence]
    .map((record) => ({ record, sortKey: String(record.evidenceId) }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((entry, index) => ({
      entityId: `work-item-${index + 1}`,
      evidenceId: entry.record.evidenceId,
      difficulty: Math.max(1, Math.round(difficultyBase[entry.record.kind] * difficultyScale * WORK_DEPTH)),
      kind: entry.record.kind,
    }));

  const allocated = new Map<string, readonly AgentId[]>();
  for (const allocation of input.organization.capabilities) {
    allocated.set(String(allocation.capability), allocation.assignedTo);
  }
  const agents: LabAgentSpec[] = [...input.organization.agents]
    .map((agent) => ({ agent, sortKey: String(agent.agent) }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ agent }) => {
      const held: string[] = [];
      for (const [capability, assignees] of allocated) {
        if (assignees.includes(agent.agent)) held.push(capability);
      }
      const generalist = agent.roles.includes(GENERALIST_ROLE);
      if (generalist) held.push(LAB_GENERALIST_CAPABILITY);
      return {
        agent: agent.agent,
        roles: agent.roles,
        workCapabilities: Object.freeze(held),
        unprivileged: held.length === 0,
      };
    });

  const capabilityCoverage: LabCapabilityCoverage[] = [
    {
      capability: LAB_GENERALIST_CAPABILITY,
      intentKinds: [LAB_WORK_INTENT_KIND],
      commandKindByIntent: { [LAB_WORK_INTENT_KIND]: LAB_WORK_INTENT_KIND },
    },
    ...[...allocated.keys()].sort().map((capability) => ({
      capability,
      intentKinds: [LAB_WORK_INTENT_KIND] as readonly string[],
      commandKindByIntent: { [LAB_WORK_INTENT_KIND]: LAB_WORK_INTENT_KIND },
    })),
  ];

  return {
    workItems: Object.freeze(workItems),
    agents: Object.freeze(agents),
    capabilityCoverage: Object.freeze(capabilityCoverage),
    frictionProbability: TASK_FRICTION_PROBABILITY[input.context.taskDifficulty],
    deadlinePressure: deadlinePressureOf(input.context, workItems.length, input.tickBudget),
    tickBudget: input.tickBudget,
  };
}

/** Multiplier on base difficulty per task-difficulty level. */
function taskDifficultyScale(difficulty: TaskDifficulty): number {
  switch (difficulty) {
    case "light":
      return 0.75;
    case "moderate":
      return 1;
    case "demanding":
      return 1.5;
    case "extreme":
      return 2.25;
  }
}

/**
 * Work-depth of the evaluation model: progress units one base unit of
 * evidence difficulty costs. A reviewable model constant (R1): chosen so
 * a bounded tick budget observes organizations under UNFINISHED work
 * (open items, broker denials, throughput, friction) rather than a
 * saturated all-done endpoint. An estimate-model knob, never a
 * ground-truth claim (E11).
 */
export const WORK_DEPTH = 4;

/**
 * Deadline pressure: total work units over available agent-ticks. A pure
 * INPUT fact — the metrics observe it; no gate, no policy.
 */
function deadlinePressureOf(
  context: OrganizationSearchContext,
  workItems: number,
  tickBudget: number,
): number | undefined {
  if (context.deadline === undefined) return undefined;
  const totalWork = workItems * 8;
  const capacity = Math.max(1, tickBudget * 4);
  return totalWork / capacity;
}
