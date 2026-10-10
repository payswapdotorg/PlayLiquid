/**
 * @playliquid/lab-simulation — public surface (PL-028).
 *
 * The simulation/evaluation stage of the Game Engineering Lab loop
 * (spec/architecture.md §Lab loop): typed evaluation-intake admission
 * binding a candidate organization (lab-contracts dimensions) + a
 * project-evidence bundle (R17) + evaluation parameters as one
 * content-addressed record (E1); a deterministic, seeded runner (E9)
 * that executes the candidate organization against the evidence bundle
 * on the @playliquid/simulation machinery with @playliquid/capability-broker
 * as the least-privilege action authority inside the simulated
 * organization (R20) and @playliquid/replay capture (R8); EPISTEMIC
 * LABELING (E11, lock 28/29) enforced at the type boundary — every
 * result carries the labeled-estimate marker, nothing is ever observed
 * ground truth; and a typed calibration seam consuming immutable
 * observations append-only (E10, lock 27).
 *
 * Pure domain: the service instance is the single mutable-state owner;
 * persistence, time, suites, evidence ledgers and observation ledgers
 * live behind ports (ports.ts) with deterministic in-memory fakes
 * (fakes.ts). No IO, no timers, no globals.
 *
 * Module map:
 * - records.ts     typed record vocabulary + E11 runtime guards
 * - digest.ts      content-addressed identity helpers (canonical JSON + sha256)
 * - intake.ts      the evaluation admission oracle (E1/E8/E10)
 * - scenario.ts    input-dimension → simulation-input projection
 * - world.ts       the lab evaluation world (blueprint, systems, grants)
 * - runner.ts      the deterministic evaluation runner (E9, R8, R20)
 * - metrics.ts     the frozen metric model (statistics → readings, E11)
 * - calibration.ts the typed calibration seam (E10)
 * - ports.ts       injected ports (clock, suites, evidence, observations,
 *                  replay CAS, persistence)
 * - service.ts     LabSimulationService — the state owner (R20 tenant scoping)
 * - fixtures.ts    the fixture Lab vocabulary (tests + harness)
 * - fakes.ts       deterministic in-memory port fakes (re-exports fixtures)
 * - harness.ts     runtime evidence harness (node src/harness.ts)
 */

// Records — the typed vocabulary
export {
  LAB_SIMULATOR_ID,
  LAB_WORK_INTENT_KIND,
  LAB_WORK_COMMAND_KIND,
  LAB_GENERALIST_CAPABILITY,
  LAB_METRIC_IDS,
  MIN_TICK_BUDGET,
  MAX_TICK_BUDGET,
  MIN_EVIDENCE_RECORDS,
  MAX_EVIDENCE_RECORDS,
  asLabEstimateResult,
  isLabEvaluationRequest,
  asLabEvaluationId,
  asLabSeed,
  asLabOrganizationId,
} from "./records.ts";
export type {
  LabEvaluationParameters,
  EvidenceBundleRef,
  LabEvaluationRequest,
  LabEvaluationIntakeRecord,
  LabReplayReferences,
  LabRunStatistics,
  LabEvaluationRunRecord,
  StoredLabEvaluation,
  LabIntakeRefusalCode,
  LabIntakeResult,
  LabRunRefusalCode,
  LabRunResult,
} from "./records.ts";

// Digest — content-addressed identity
export {
  jsonSafeOf,
  labDigestOf,
  labEvaluationIdentityDigest,
  labEvaluationSlugId,
  evidenceBundleDigestOf,
  normalizeEvidenceIds,
} from "./digest.ts";

// Intake — the admission oracle
export { admitLabEvaluation } from "./intake.ts";
export type { LabEvidenceLedger, LabIntakePorts } from "./intake.ts";

// Scenario — the input-dimension projection
export {
  TASK_FRICTION_PROBABILITY,
  EVIDENCE_KIND_BASE_DIFFICULTY,
  WORK_DEPTH,
  buildLabScenario,
} from "./scenario.ts";
export type {
  LabWorkItemSpec,
  LabAgentSpec,
  LabCapabilityCoverage,
  LabScenario,
} from "./scenario.ts";

// World — the lab evaluation game
export {
  LAB_WORLD_ID,
  LAB_SCENE_ID,
  WORK_UNITS_PER_COMMAND,
  workItemEntityRef,
  labAgentActor,
  labWorldBlueprint,
  labWorldSystems,
  labAgentGrants,
  labGameRefOf,
  workCommandPayload,
} from "./world.ts";

// Runner — the deterministic evaluation engine
export { runLabEvaluation } from "./runner.ts";
export type { LabReplaySink } from "./runner.ts";

// Calibration — the E10 seam
export { calibrateLabEvaluation, appendLabCalibrationConclusion } from "./calibration.ts";
export type {
  LabObservationView,
  LabCalibrationRefusalCode,
  LabCalibrationResult,
  LabCalibrationAppendResult,
  LabCalibrationStatement,
} from "./calibration.ts";

// Ports — the host seams
export type { LabClockPort, LabServiceDocument, LabEvaluationStore, LabSimulationPorts } from "./ports.ts";

// Service — the state owner
export { LabSimulationService } from "./service.ts";
export type { LabCaller, LabReadResult, LabSimulationServiceOptions } from "./service.ts";

// Fakes — deterministic in-memory doubles + fixture vocabulary
export {
  labFixtureDigest,
  labFixtureCommit,
  labFixtureGameIdentity,
  labFixtureContext,
  labFixtureEvidenceRecords,
  labFixtureCycleId,
  labFixtureSuite,
  labFixtureForeignMetricSuite,
  labFixtureGeneralistOrganization,
  labFixtureTeamOrganization,
  labFixtureObservation,
  createFixedClock,
  createSuiteDirectory,
  createEvidenceLedger,
  createObservationLedger,
  createReplayStore,
  createEvaluationStore,
  createLabSimulationFakes,
} from "./fakes.ts";
