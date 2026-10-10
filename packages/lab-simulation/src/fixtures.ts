/**
 * THE FIXTURE LAB VOCABULARY (PL-028) — deterministic, in-memory fake
 * content used by tests and the selfcheck harness: digests, commits,
 * game identities, search contexts, evidence records, evaluation suites
 * and the two canonical organizations (generalist baseline + team).
 *
 * Everything is deterministic: no IO, no timers, no randomness, no wall
 * clock. Real suite resolution (the package graph) is a host concern —
 * the ports (ports.ts) are the seam.
 *
 * Fragment discipline (house rule): every digest below is derived from
 * short text via {@link labFixtureDigest} — no 64-char hex literals.
 */

import type { LabEvaluationSuite, LabEvaluationSuiteRef, ObservedOutcomeRecord, OrganizationDescriptor, ProjectEvidenceRecord } from "@playliquid/lab-contracts";
import type { OrganizationSearchContext } from "@playliquid/lab-contracts";
import {
  asAgentRoleId,
  asCapabilityId,
  asEvidenceRecordId,
  asLabCycleId,
  asLabEvaluationMetricId,
  asLabEvaluationSuiteId,
  asMemoryStoreId,
  asObservationId,
  asOrganizationId,
  asReleaseId,
  asReviewGateId,
  asTimestampMs,
  asZCodeModelRouteId,
} from "@playliquid/lab-contracts";
import type { GitRef, GameIdentity } from "@playliquid/game-contracts";
import { asAgentId, asCommitSha, asGameId } from "@playliquid/game-contracts";
import { LAB_METRIC_IDS } from "./records.ts";

const HEX_DIGITS = "0123456789abcdef";

/** Deterministic 64-hex digest derived from text (fragment discipline). */
export function labFixtureDigest(text: string) {
  let out = "";
  for (let index = 0; index < 64; index += 1) {
    const code = text.charCodeAt(index % text.length) + index * 31;
    out += HEX_DIGITS[code % 16];
  }
  return out as ProjectEvidenceRecord["contentDigest"];
}

/** A canonical commit-shaped Git ref for fixtures. */
export function labFixtureCommit(text = "fixture-commit"): GitRef {
  const sha = asCommitSha(`ab${String(labFixtureDigest(text)).slice(0, 38)}`);
  if (sha === undefined) {
    // Canonical prefix + derived hex — unreachable by construction.
    throw new Error(`lab-simulation: fixture commit sha failed to parse`);
  }
  return { kind: "commit", commit: sha };
}

/** A canonical game identity for fixtures. */
export function labFixtureGameIdentity(): GameIdentity {
  const sha = asCommitSha(`cd${String(labFixtureDigest("identity")).slice(0, 38)}`)!;
  return {
    id: asGameId("game-lab-fixture")!,
    displayName: "Lab Fixture Game",
    kind: "game",
    repository: { host: "github.com", owner: "payswapdotorg", repository: "game-lab-fixture" },
    revision: { kind: "commit", commit: sha },
    lineage: { head: sha, ancestors: [] },
  };
}

/** A canonical search context (every input dimension exercised). */
export function labFixtureContext(options?: {
  readonly taskDifficulty?: OrganizationSearchContext["taskDifficulty"];
  readonly deadline?: number;
}): OrganizationSearchContext {
  return {
    game: labFixtureGameIdentity(),
    phase: "production",
    genre: "platformer",
    engine: "custom-ir",
    target: "pc-web",
    deadline: options?.deadline === undefined ? undefined : asTimestampMs(options.deadline),
    taskDifficulty: options?.taskDifficulty ?? "moderate",
  };
}

/** N immutable project-evidence records (R17) for fixtures. */
export function labFixtureEvidenceRecords(count = 3, variant = "std"): readonly ProjectEvidenceRecord[] {
  const kinds = ["replay-artifact", "incident-report", "repository-metrics"] as const;
  const cycleId = labFixtureCycleId();
  const records: ProjectEvidenceRecord[] = [];
  for (let index = 1; index <= count; index += 1) {
    const kind = kinds[(index - 1) % kinds.length]!;
    const source: GitRef = labFixtureCommit(`${variant}-${index}`);
    records.push({
      epistemic: "observed-evidence",
      evidenceId: asEvidenceRecordId(`evidence-${variant}-${index}`)!,
      cycleId,
      kind,
      source,
      contentDigest: labFixtureDigest(`evidence-${variant}-${index}`),
      summary: `fixture evidence ${variant} #${index} (${kind})`,
      observedAt: asTimestampMs(1_000 + index)!,
    });
  }
  return records;
}

/** A canonical cycle id for fixtures. */
export function labFixtureCycleId() {
  return asLabCycleId("cycle-fixture-1")!;
}

/** The standard fixture suite: every simulator-modeled metric. */
export function labFixtureSuite(): LabEvaluationSuite {
  const ref: LabEvaluationSuiteRef = {
    suiteId: asLabEvaluationSuiteId("suite-lab-standard")!,
    irVersion: "1",
    contentDigest: labFixtureDigest("suite-lab-standard"),
  };
  return {
    ref,
    summary: "Lab fixture suite: the full simulator metric vocabulary",
    metrics: [
      { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.completedWork)!, summary: "Completed work items", shape: { kind: "int" } },
      { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.progressUnits)!, summary: "Progress units", shape: { kind: "int" } },
      { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.estimatedThroughput)!, summary: "Estimated throughput", shape: { kind: "float" } },
      { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.defectsIntroduced)!, summary: "Defects introduced", shape: { kind: "int" } },
      { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.defectDensity)!, summary: "Defect density", shape: { kind: "float" } },
      { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.intentDenials)!, summary: "Broker intent denials", shape: { kind: "int" } },
      { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.commandsAdmitted)!, summary: "Commands admitted", shape: { kind: "int" } },
      { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.capabilityCoverage)!, summary: "Capability coverage", shape: { kind: "float" } },
    ],
  };
}

/** A suite with ONE metric outside the simulator vocabulary (E11 test). */
export function labFixtureForeignMetricSuite(): LabEvaluationSuite {
  const ref: LabEvaluationSuiteRef = {
    suiteId: asLabEvaluationSuiteId("suite-lab-foreign")!,
    irVersion: "1",
    contentDigest: labFixtureDigest("suite-lab-foreign"),
  };
  return {
    ref,
    summary: "Lab fixture suite with an unmodeled metric",
    metrics: [
      { metricId: asLabEvaluationMetricId(LAB_METRIC_IDS.completedWork)!, summary: "Completed work items", shape: { kind: "int" } },
      { metricId: asLabEvaluationMetricId("metric-beyond-model")!, summary: "Something the simulator does not model", shape: { kind: "float" } },
    ],
  };
}

/** A canonical model assignment for fixtures. */
function labFixtureModel() {
  return { authority: "zcode-model-routing" as const, route: asZCodeModelRouteId("route-lab-fixture")! };
}

/** The single-generalist baseline fixture organization (lock 26). */
export function labFixtureGeneralistOrganization(): OrganizationDescriptor {
  const agent = asAgentId("agent-lab-generalist")!;
  return {
    id: asOrganizationId("org-lab-generalist")!,
    agents: [{ agent, roles: [asAgentRoleId("generalist")!], model: labFixtureModel() }],
    capabilities: [],
    tools: [],
    topology: [],
    memory: {
      stores: [{ storeId: asMemoryStoreId("memory-generalist")!, scope: "agent-private", owner: agent }],
      access: [{ store: asMemoryStoreId("memory-generalist")!, agent, mode: "read-write" }],
    },
    humanParticipation: { mode: "none", participants: [] },
    budget: [],
    scheduling: { mode: "event-driven" },
    review: { gates: [{ gateId: asReviewGateId("gate-generalist")!, reviewers: [agent] }] },
  };
}

/**
 * A three-agent team fixture: two implementers hold the engineering
 * capability (privileged), one reviewer holds none (the R20 denial
 * surface). Passes validateOrganization.
 */
export function labFixtureTeamOrganization(): OrganizationDescriptor {
  const implementerA = asAgentId("agent-lab-impl-a")!;
  const implementerB = asAgentId("agent-lab-impl-b")!;
  const reviewer = asAgentId("agent-lab-reviewer")!;
  const shared = asMemoryStoreId("memory-team-shared")!;
  return {
    id: asOrganizationId("org-lab-team")!,
    agents: [
      { agent: implementerA, roles: [asAgentRoleId("implementer")!], model: labFixtureModel() },
      { agent: implementerB, roles: [asAgentRoleId("implementer")!], model: labFixtureModel() },
      { agent: reviewer, roles: [asAgentRoleId("reviewer")!], model: labFixtureModel() },
    ],
    capabilities: [
      { capability: asCapabilityId("lab.cap.engineering")!, assignedTo: [implementerA, implementerB] },
    ],
    tools: [],
    topology: [
      { kind: "communication", from: implementerA, to: reviewer, channel: "queue" },
      { kind: "communication", from: implementerB, to: reviewer, channel: "queue" },
    ],
    memory: {
      stores: [{ storeId: shared, scope: "shared" }],
      access: [
        { store: shared, agent: implementerA, mode: "read-write" },
        { store: shared, agent: implementerB, mode: "read-write" },
        { store: shared, agent: reviewer, mode: "read" },
      ],
    },
    humanParticipation: { mode: "none", participants: [] },
    budget: [],
    scheduling: { mode: "event-driven" },
    review: { gates: [{ gateId: asReviewGateId("gate-team-review")!, reviewers: [reviewer] }] },
  };
}

/** One immutable observed-outcome fixture (E10). */
export function labFixtureObservation(observationId = "observation-fixture-1", cycleId?: ProjectEvidenceRecord["cycleId"]): ObservedOutcomeRecord {
  return {
    epistemic: "observed-evidence",
    observationId: asObservationId(observationId)!,
    cycleId: cycleId ?? labFixtureCycleId(),
    release: asReleaseId("release-fixture-1")!,
    contentDigest: labFixtureDigest(observationId),
    summary: `fixture observed outcome ${observationId}`,
    observedAt: asTimestampMs(2_000)!,
  };
}
