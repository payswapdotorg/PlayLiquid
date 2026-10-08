import { test } from "node:test";
import assert from "node:assert/strict";
import { isValueShape } from "@playliquid/game-ir";
import {
  isLabEvaluationSuiteRef,
  isLabEvaluationMetric,
} from "./evaluation-suites.ts";
import type { LabEvaluationSuiteRef } from "./evaluation-suites.ts";
import {
  isCandidateEvaluationRecord,
  recordCandidateEvaluation,
  validateCandidateEvaluationRecord,
} from "./evaluation.ts";
import type { CandidateEvaluationRecord, OrganizationEvaluationRequest } from "./evaluation.ts";
import {
  asCandidateEvaluationId,
  asContentDigest,
  asLabCycleId,
  asLabEvaluationMetricId,
  asOrganizationId,
  asTimestampMs,
} from "./primitives.ts";
import type { EvaluationSeed } from "./primitives.ts";
import type { LabeledEstimate } from "./estimates.ts";
import type { EvaluationMetricReading } from "./evaluation-suites.ts";
import { isLabeledEstimate } from "./estimates.ts";
import {
  fakeOrganizationEvaluator,
  fakeSuiteResolver,
  fixtureGameIdentity,
  fixtureGeneralistOrganization,
  fixtureModelRoute,
  fixtureSeed,
  fixtureSuite,
  fixtureSuiteRef,
  fixtureTimestamp,
} from "./fixtures.ts";
import { generalistBaselineOrganization } from "./organization.ts";
import { asAgentId } from "@playliquid/game-contracts";

test("evaluation: suite refs are content-addressed and kernel-versioned", () => {
  const ref = fixtureSuiteRef();
  assert.ok(isLabEvaluationSuiteRef(ref));
  assert.equal(ref.irVersion, "1");
  assert.equal(isLabEvaluationSuiteRef({ suiteId: ref.suiteId, irVersion: "9", contentDigest: ref.contentDigest }), false);
  assert.equal(isLabEvaluationSuiteRef({ suiteId: ref.suiteId, irVersion: "1", contentDigest: "0" }), false);
  assert.equal(isLabEvaluationSuiteRef(null), false);
});

test("evaluation: the suite view uses the game-ir value-shape authority", () => {
  const suite = fixtureSuite();
  assert.ok(suite.metrics.length >= 2);
  for (const metric of suite.metrics) {
    assert.ok(isLabEvaluationMetric(metric));
    assert.ok(isValueShape(metric.shape));
  }
  assert.equal(isLabEvaluationMetric({ metricId: asLabEvaluationMetricId("metric-x")!, summary: "", shape: { kind: "unit" } }), false);
});

test("evaluation: the fake resolver implements the suite-provider port", () => {
  const suite = fixtureSuite();
  const resolver = fakeSuiteResolver([suite]);
  assert.deepEqual(resolver(suite.ref), suite);
  assert.equal(
    resolver({
      ...suite.ref,
      contentDigest: asContentDigest(`${suite.ref.contentDigest.slice(0, 62)}0f`)!,
    }),
    undefined,
  );
});

test("evaluation: the fake evaluator port returns explicitly-labeled estimates (E11/lock 29)", () => {
  const suite = fixtureSuite();
  const organization = fixtureGeneralistOrganization().descriptor;
  const request: OrganizationEvaluationRequest = {
    organization,
    suite,
    context: {
      game: fixtureGameIdentity(),
      phase: "production",
      taskDifficulty: "demanding",
    },
    seed: fixtureSeed(),
  };
  const evaluator = fakeOrganizationEvaluator();
  const estimate = evaluator(request);
  assert.ok(isLabeledEstimate(estimate));
  assert.equal(estimate.method, "simulation");
  assert.equal(estimate.payload.length, suite.metrics.length);
  // The fake's readings satisfy the suite's kernel shapes.
  const validation = validateCandidateEvaluationRecord(
    {
      evaluationId: asCandidateEvaluationId("evaluation-1")!,
      cycleId: asLabCycleId("cycle-1")!,
      organization: asOrganizationId("org-generalist-baseline")!,
      suite: suite.ref,
      seed: fixtureSeed(),
      result: estimate,
      evaluatedAt: fixtureTimestamp(),
    },
    suite,
  );
  assert.equal(validation.ok, true);
});

test("evaluation: recordCandidateEvaluation assembles and seals the record", () => {
  const suite = fixtureSuite();
  const estimate = fakeOrganizationEvaluator()({
    organization: generalistBaselineOrganization({
      organizationId: asOrganizationId("org-generalist-baseline")!,
      agent: asAgentId("agent-lab")!,
      model: fixtureModelRoute(),
    }),
    suite,
    context: { game: fixtureGameIdentity(), phase: "production", taskDifficulty: "light" },
    seed: fixtureSeed(),
  });
  const result = recordCandidateEvaluation({
    evaluationId: asCandidateEvaluationId("evaluation-1")!,
    cycleId: asLabCycleId("cycle-1")!,
    organization: asOrganizationId("org-generalist-baseline")!,
    suite: suite.ref,
    seed: fixtureSeed(),
    result: estimate,
    evaluatedAt: fixtureTimestamp(),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(isCandidateEvaluationRecord(result.record));
  assert.ok(Object.isFrozen(result.record));
  assert.throws(() => {
    (result.record as { summary?: string }).summary = "x";
  }, TypeError);
});

test("evaluation: recordCandidateEvaluation refuses the negative paths", () => {
  const suite = fixtureSuite();
  const estimate = fakeOrganizationEvaluator()({
    organization: fixtureGeneralistOrganization().descriptor,
    suite,
    context: { game: fixtureGameIdentity(), phase: "production", taskDifficulty: "light" },
    seed: fixtureSeed(),
  });
  const params = {
    evaluationId: asCandidateEvaluationId("evaluation-1")!,
    cycleId: asLabCycleId("cycle-1")!,
    organization: asOrganizationId("org-generalist-baseline")!,
    suite: suite.ref,
    seed: fixtureSeed(),
    result: estimate,
    evaluatedAt: fixtureTimestamp(),
  };
  // Empty seed (untyped caller).
  const badSeed = recordCandidateEvaluation({ ...params, seed: "" as unknown as EvaluationSeed });
  assert.equal(badSeed.ok, false);
  if (badSeed.ok) return;
  assert.equal(badSeed.code, "invalid-seed");
  // Empty readings.
  const empty = recordCandidateEvaluation({
    ...params,
    result: { ...estimate, payload: [] },
  });
  assert.equal(empty.ok, false);
  if (empty.ok) return;
  assert.equal(empty.code, "empty-readings");
  // Unlabeled result smuggled in by an untyped caller.
  const unlabeled = recordCandidateEvaluation({
    ...params,
    result: { method: "simulation", payload: estimate.payload } as unknown as LabeledEstimate<
      readonly EvaluationMetricReading[]
    >,
  });
  assert.equal(unlabeled.ok, false);
  if (unlabeled.ok) return;
  assert.equal(unlabeled.code, "result-not-estimate");
});

test("evaluation: validation catches readings that violate the kernel shapes", () => {
  const suite = fixtureSuite();
  const record: CandidateEvaluationRecord = {
    evaluationId: asCandidateEvaluationId("evaluation-bad")!,
    cycleId: asLabCycleId("cycle-1")!,
    organization: asOrganizationId("org-generalist-baseline")!,
    suite: suite.ref,
    seed: fixtureSeed(),
    result: {
      epistemic: "labeled-estimate",
      method: "simulation",
      payload: [
        // throughput is declared as float; send a string reading.
        { metricId: asLabEvaluationMetricId("metric-throughput")!, value: { kind: "string", value: "fast" } },
        { metricId: asLabEvaluationMetricId("metric-defects")!, value: { kind: "int", value: 2n } },
      ],
    },
    evaluatedAt: asTimestampMs(1_000)!,
  };
  const validation = validateCandidateEvaluationRecord(record, suite);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.deepEqual(
    validation.violations.map((violation) => violation.code),
    ["reading-shape-mismatch"],
  );
  // Unknown metric id.
  const unknownMetric: CandidateEvaluationRecord = {
    ...record,
    result: {
      ...record.result,
      payload: [{ metricId: asLabEvaluationMetricId("metric-ghost")!, value: { kind: "int", value: 1n } }],
    },
  };
  const validation2 = validateCandidateEvaluationRecord(unknownMetric, suite);
  assert.equal(validation2.ok, false);
  if (validation2.ok) return;
  assert.deepEqual(
    validation2.violations.map((violation) => violation.code),
    ["unknown-metric"],
  );
});

test("evaluation: suite mismatch is a typed violation", () => {
  const suite = fixtureSuite();
  const estimate = fakeOrganizationEvaluator()({
    organization: fixtureGeneralistOrganization().descriptor,
    suite,
    context: { game: fixtureGameIdentity(), phase: "production", taskDifficulty: "light" },
    seed: fixtureSeed(),
  });
  const record: CandidateEvaluationRecord = {
    evaluationId: asCandidateEvaluationId("evaluation-mismatch")!,
    cycleId: asLabCycleId("cycle-1")!,
    organization: asOrganizationId("org-generalist-baseline")!,
    suite: { ...suite.ref, contentDigest: asContentDigest(`${suite.ref.contentDigest.slice(0, 62)}1f`)! },
    seed: fixtureSeed(),
    result: estimate,
    evaluatedAt: fixtureTimestamp(),
  };
  const validation = validateCandidateEvaluationRecord(record, suite);
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.deepEqual(
    validation.violations.map((violation) => violation.code),
    ["suite-mismatch"],
  );
});

test("evaluation: an observation can never be a candidate-evaluation result (E11, compile-time)", () => {
  const observed = { epistemic: "observed-evidence", summary: "what actually happened" };
  // @ts-expect-error — observed evidence is not a labeled estimate (E11)
  const result: LabeledEstimate<unknown> = observed;
  const record: CandidateEvaluationRecord = {
    evaluationId: asCandidateEvaluationId("evaluation-x")!,
    cycleId: asLabCycleId("cycle-1")!,
    organization: asOrganizationId("org-x")!,
    suite: fixtureSuiteRef(),
    seed: fixtureSeed(),
    // @ts-expect-error — observed evidence cannot occupy the result slot either
    result: observed,
    evaluatedAt: fixtureTimestamp(),
  };
  assert.equal(result.epistemic, "observed-evidence");
  assert.equal(record.result.epistemic, "observed-evidence");
});

test("evaluation: a raw suite reference cannot be forged from plain strings (compile-time)", () => {
  // @ts-expect-error — suite refs are minted through the constructors, not literals
  const ref: LabEvaluationSuiteRef = { suiteId: "suite-lab-core", irVersion: "1", contentDigest: "0".repeat(64) };
  assert.equal(typeof ref.suiteId, "string");
});
