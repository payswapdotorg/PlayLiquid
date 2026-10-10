/**
 * Runner tests (E9 determinism, R8 replay capture, E11 estimate labeling,
 * R20 broker denial surface): the simulation/evaluation engine itself.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { asEvaluationSeed, asTimestampMs } from "@playliquid/lab-contracts";
import { runLabEvaluation } from "./runner.ts";
import type { LabReplaySink } from "./runner.ts";
import {
  createReplayStore,
  createSuiteDirectory,
  labFixtureContext,
  labFixtureEvidenceRecords,
  labFixtureForeignMetricSuite,
  labFixtureGeneralistOrganization,
  labFixtureSuite,
  labFixtureTeamOrganization,
} from "./fakes.ts";
import { evidenceBundleDigestOf, labEvaluationIdentityDigest, labEvaluationSlugId } from "./digest.ts";
import type { LabEvaluationRequest } from "./records.ts";
import { LAB_METRIC_IDS, LAB_SIMULATOR_ID } from "./records.ts";

const tenant = asTenantId("tenant-runner")!;
const owner = asSubjectId("subject-runner")!;
const evidence = labFixtureEvidenceRecords();
const suites = createSuiteDirectory([labFixtureSuite(), labFixtureForeignMetricSuite()]);
const replays = createReplayStore();
const sink: LabReplaySink = replays.sink;

function request(over: Partial<LabEvaluationRequest> = {}): LabEvaluationRequest {
  return {
    tenant,
    owner,
    cycleId: evidence[0]!.cycleId,
    organization: labFixtureTeamOrganization(),
    evidence: {
      recordIds: evidence.map((record) => String(record.evidenceId)),
      declaredDigest: evidenceBundleDigestOf(evidence),
    },
    suite: labFixtureSuite().ref,
    context: labFixtureContext(),
    parameters: { seed: asEvaluationSeed("seed-runner")!, tickBudget: 12 },
    requestedAt: asTimestampMs(1_000)!,
    ...over,
  };
}

function intakeOf(req: LabEvaluationRequest) {
  const digest = labEvaluationIdentityDigest(req);
  return {
    evaluationId: labEvaluationSlugId(digest),
    identityDigest: digest,
    tenant: req.tenant,
    owner: req.owner,
    cycleId: req.cycleId,
    organization: req.organization.id,
    suite: req.suite,
    evidenceRecordIds: req.evidence.recordIds,
    evidenceBundleDigest: evidenceBundleDigestOf(evidence),
    seed: req.parameters.seed,
    tickBudget: req.parameters.tickBudget,
    requestedAt: req.requestedAt,
    admittedAt: asTimestampMs(1_500)!,
  };
}

function run(req: LabEvaluationRequest, over: { readonly replaySink?: LabReplaySink; readonly runAt?: number } = {}) {
  return runLabEvaluation({
    intake: intakeOf(req),
    organization: req.organization,
    context: req.context,
    evidence,
    suite: suites.resolver(req.suite)!,
    runAt: over.runAt ?? 2_000,
    replaySink: over.replaySink ?? sink,
  });
}

test("runs a team evaluation to a labeled estimate (E11) with replay references (R8)", () => {
  const result = run(request());
  assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.detail}`);
  assert.equal(result.run.result.epistemic, "labeled-estimate");
  assert.equal(result.run.result.method, "simulation");
  assert.equal(result.run.simulator, LAB_SIMULATOR_ID);
  assert.ok(result.run.result.payload.length > 0);
  assert.match(result.run.replay.replayId, /^replay-[0-9a-f]{64}$/);
  assert.equal(replays.find(result.run.replay.replayId)?.replayId, result.run.replay.replayId);
});

test("every reading satisfies its suite shape and vocabulary (validateCandidateEvaluationRecord green)", async () => {
  const { validateCandidateEvaluationRecord } = await import("@playliquid/lab-contracts");
  const result = run(request());
  assert.ok(result.ok);
  const validation = validateCandidateEvaluationRecord(
    {
      evaluationId: result.run.evaluationId,
      cycleId: result.run.cycleId,
      organization: result.run.organization,
      suite: result.run.suite,
      seed: result.run.seed,
      result: result.run.result,
      evaluatedAt: result.run.runAt,
    },
    labFixtureSuite(),
  );
  assert.ok(validation.ok, JSON.stringify(validation.ok ? null : validation.violations));
});

test("determinism: same request + seed + evidence → byte-identical runs (E9)", () => {
  const first = run(request(), { replaySink: createReplayStore().sink });
  const second = run(request(), { replaySink: createReplayStore().sink });
  assert.ok(first.ok && second.ok);
  assert.equal(first.run.replay.replayId, second.run.replay.replayId);
  assert.equal(first.run.replay.commandStream, second.run.replay.commandStream);
  assert.equal(first.run.replay.eventWitness, second.run.replay.eventWitness);
  assert.deepEqual(first.run.statistics, second.run.statistics);
  assert.deepEqual(first.run.result.payload, second.run.result.payload);
});

test("determinism: run time is bookkeeping only — addressed artifacts stay identical", () => {
  const first = run(request(), { runAt: 2_000 });
  const second = run(request(), { runAt: 9_999 });
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.run.runAt, second.run.runAt);
  assert.equal(first.run.replay.commandStream, second.run.replay.commandStream);
  assert.equal(first.run.replay.eventWitness, second.run.replay.eventWitness);
  assert.deepEqual(first.run.statistics, second.run.statistics);
  assert.deepEqual(first.run.result.payload, second.run.result.payload);
});

test("a different seed produces a different run (E9 separation)", () => {
  const first = run(request());
  const second = run(request({ parameters: { seed: asEvaluationSeed("seed-runner-2")!, tickBudget: 12 } }));
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.run.replay.replayId, second.run.replay.replayId);
});

test("team statistics: two privileged agents work, the reviewer is denied (R20)", () => {
  const result = run(request());
  assert.ok(result.ok);
  assert.equal(result.run.statistics.brokerGrants, 24);
  assert.equal(result.run.statistics.brokerDenials, 12);
  assert.equal(result.run.statistics.commandsAdmitted, 24);
  assert.ok(result.run.statistics.capabilityCoverage > 0.6 && result.run.statistics.capabilityCoverage < 0.7);
  assert.ok(result.run.statistics.completedWork >= 1);
});

test("generalist baseline: one agent, no denials, always evaluable (lock 26)", () => {
  const result = run(request({ organization: labFixtureGeneralistOrganization(), parameters: { seed: asEvaluationSeed("seed-generalist")!, tickBudget: 12 } }));
  assert.ok(result.ok);
  assert.equal(result.run.statistics.brokerGrants, 12);
  assert.equal(result.run.statistics.brokerDenials, 0);
  assert.equal(result.run.statistics.capabilityCoverage, 1);
});

test("unprivileged organization: all intents denied, zero commands admitted", () => {
  const unprivileged = labFixtureTeamOrganization();
  const organization = {
    ...unprivileged,
    capabilities: [],
  };
  const result = run(request({ organization, parameters: { seed: asEvaluationSeed("seed-unprivileged")!, tickBudget: 4 } }));
  assert.ok(result.ok);
  assert.equal(result.run.statistics.brokerDenials, 12);
  assert.equal(result.run.statistics.commandsAdmitted, 0);
  assert.equal(result.run.statistics.completedWork, 0);
  assert.equal(result.run.statistics.capabilityCoverage, 0);
});

test("input dimensions move the outcome: extreme difficulty bites (lock 25)", () => {
  const moderate = run(request({ context: labFixtureContext({ taskDifficulty: "moderate" }), parameters: { seed: asEvaluationSeed("seed-difficulty")!, tickBudget: 12 } }));
  const extreme = run(request({ context: labFixtureContext({ taskDifficulty: "extreme" }), parameters: { seed: asEvaluationSeed("seed-difficulty")!, tickBudget: 12 } }));
  assert.ok(moderate.ok && extreme.ok);
  assert.ok(moderate.run.statistics.completedWork > extreme.run.statistics.completedWork);
  assert.notEqual(moderate.run.replay.replayId, extreme.run.replay.replayId);
});

test("suite metrics outside the model vocabulary are honestly refused (E11)", () => {
  const result = run(request({ suite: labFixtureForeignMetricSuite().ref, parameters: { seed: asEvaluationSeed("seed-foreign")!, tickBudget: 8 } }));
  assert.ok(!result.ok);
  assert.equal(result.code, "unmeasurable-metric");
  assert.ok(result.detail.includes("metric-beyond-model"));
});

test("tick budget bounds the run (E6 discipline)", () => {
  const result = run(request({ parameters: { seed: asEvaluationSeed("seed-budget")!, tickBudget: 5 } }));
  assert.ok(result.ok);
  assert.equal(result.run.statistics.ticks, 5);
});

test("all frozen metric ids are emitted by the standard suite", () => {
  const result = run(request());
  assert.ok(result.ok);
  const metricIds = result.run.result.payload.map((reading) => String(reading.metricId)).sort();
  const expected = Object.values(LAB_METRIC_IDS).sort();
  assert.deepEqual(metricIds, expected);
});

test("a zero-event run is still sealed: termination guarantees the audit event", () => {
  const result = run(request({ parameters: { seed: asEvaluationSeed("seed-zero")!, tickBudget: 1 } }));
  assert.ok(result.ok);
  assert.ok(result.run.statistics.eventsEmitted >= 1);
  assert.match(result.run.replay.replayId, /^replay-/);
});
