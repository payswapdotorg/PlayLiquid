import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asAgentRoleId,
  asArenaEscalationId,
  asCandidateEvaluationId,
  asCalibrationId,
  asContentDigest,
  asEvaluationSeed,
  asEvidenceRecordId,
  asGapRecordId,
  asHypothesisId,
  asDiagnosisId,
  asImplementationCandidateId,
  asLabCycleId,
  asLabEvaluationMetricId,
  asLabEvaluationSuiteId,
  asMemoryStoreId,
  asObservationId,
  asOrganizationId,
  asReleaseId,
  asReviewGateId,
  asTimestampMs,
  isValidContentDigest,
  sealRecord,
} from "./primitives.ts";
import { fixtureDigest } from "./fixtures.ts";

test("primitives: lab ids parse canonical slugs and refuse everything else", () => {
  assert.equal(asOrganizationId("org-alpha"), "org-alpha");
  assert.equal(asLabCycleId("cycle-1"), "cycle-1");
  assert.equal(asEvidenceRecordId("evidence-1"), "evidence-1");
  assert.equal(asDiagnosisId("diagnosis-1"), "diagnosis-1");
  assert.equal(asHypothesisId("hypothesis-1"), "hypothesis-1");
  assert.equal(asCandidateEvaluationId("evaluation-1"), "evaluation-1");
  assert.equal(asImplementationCandidateId("candidate-1"), "candidate-1");
  assert.equal(asReleaseId("release-1"), "release-1");
  assert.equal(asObservationId("observation-1"), "observation-1");
  assert.equal(asCalibrationId("calibration-1"), "calibration-1");
  assert.equal(asGapRecordId("gap-1"), "gap-1");
  assert.equal(asArenaEscalationId("escalation-1"), "escalation-1");
  assert.equal(asAgentRoleId("generalist"), "generalist");
  assert.equal(asMemoryStoreId("generalist-memory"), "generalist-memory");
  assert.equal(asReviewGateId("generalist-self-review"), "generalist-self-review");
  assert.equal(asLabEvaluationSuiteId("suite-lab-core"), "suite-lab-core");
  assert.equal(asLabEvaluationMetricId("metric-throughput"), "metric-throughput");

  for (const parse of [
    asOrganizationId,
    asLabCycleId,
    asAgentRoleId,
    asGapRecordId,
  ]) {
    assert.equal(parse(""), undefined);
    assert.equal(parse("NOT-A-SLUG"), undefined);
    assert.equal(parse("-leading"), undefined);
    assert.equal(parse("trailing-"), undefined);
    assert.equal(parse("a".repeat(64)), undefined);
  }
});

test("primitives: content digests are 64-char lowercase hex", () => {
  const digest = fixtureDigest("primitives");
  assert.equal(isValidContentDigest(digest), true);
  assert.equal(asContentDigest(digest), digest);
  assert.equal(asContentDigest(["z".repeat(4)].join("") + "0".repeat(60)), undefined);
  assert.equal(asContentDigest("0".repeat(63)), undefined);
  assert.equal(asContentDigest("0".repeat(65)), undefined);
  assert.equal(asContentDigest(fixtureDigest("a").toUpperCase()), undefined);
});

test("primitives: timestamps are caller-supplied safe non-negative integers", () => {
  assert.equal(asTimestampMs(0), 0);
  assert.equal(asTimestampMs(1_000), 1_000);
  assert.equal(asTimestampMs(-1), undefined);
  assert.equal(asTimestampMs(0.5), undefined);
  assert.equal(asTimestampMs(Number.NaN), undefined);
  assert.equal(asTimestampMs(Number.MAX_SAFE_INTEGER + 1), undefined);
});

test("primitives: evaluation seeds are non-empty bounded text", () => {
  assert.equal(asEvaluationSeed("seed-1"), "seed-1");
  assert.equal(asEvaluationSeed(""), undefined);
  assert.equal(asEvaluationSeed("x".repeat(129)), undefined);
});

test("primitives: sealRecord deeply freezes record trees (E1/E10 runtime immutability)", () => {
  const record = sealRecord({
    summary: "sealed",
    nested: { deep: ["a", "b"] },
    items: [{ value: 1 }],
  });
  assert.throws(() => {
    (record as { summary: string }).summary = "rewritten";
  }, TypeError);
  assert.throws(() => {
    (record.nested as { deep: string[] }).deep = ["c"];
  }, TypeError);
  assert.throws(() => {
    (record.nested.deep as string[])[0] = "c";
  }, TypeError);
  assert.throws(() => {
    ((record.items as { value: number }[])[0] as { value: number }).value = 2;
  }, TypeError);
  // Idempotent: sealing twice keeps the same content.
  assert.equal(sealRecord(record), record);
});
