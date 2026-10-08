import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_OBSERVATION_LEDGER,
  EMPTY_PROJECT_EVIDENCE_LEDGER,
  appendCalibrationConclusion,
  appendObservation,
  appendProjectEvidence,
  findCalibrationConclusion,
  findObservation,
  findProjectEvidence,
  isProjectEvidenceKind,
  PROJECT_EVIDENCE_KINDS,
} from "./evidence.ts";
import type {
  CalibrationConclusion,
  ObservedOutcomeRecord,
  ProjectEvidenceRecord,
} from "./evidence.ts";
import {
  asCalibrationId,
  asEvidenceRecordId,
  asLabCycleId,
  asObservationId,
  asReleaseId,
} from "./primitives.ts";
import { fixtureCommitRef, fixtureDigest, fixtureTimestamp } from "./fixtures.ts";

function evidenceRecord(id: string, cycle = "cycle-1"): ProjectEvidenceRecord {
  return {
    epistemic: "observed-evidence",
    evidenceId: asEvidenceRecordId(id)!,
    cycleId: asLabCycleId(cycle)!,
    kind: "replay-artifact",
    source: fixtureCommitRef(`evidence-${id}`),
    contentDigest: fixtureDigest(`evidence-${id}`),
    summary: `Evidence ${id}: captured from the project repository.`,
    observedAt: fixtureTimestamp(),
  };
}

function observationRecord(id: string, release: string, cycle = "cycle-1"): ObservedOutcomeRecord {
  return {
    epistemic: "observed-evidence",
    observationId: asObservationId(id)!,
    cycleId: asLabCycleId(cycle)!,
    release: asReleaseId(release)!,
    contentDigest: fixtureDigest(`observation-${id}`),
    summary: `Observed outcome ${id}.`,
    observedAt: fixtureTimestamp(),
  };
}

test("evidence: project evidence appends immutably to a copy of the ledger", () => {
  const first = appendProjectEvidence(EMPTY_PROJECT_EVIDENCE_LEDGER, evidenceRecord("evidence-1"));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = appendProjectEvidence(first.ledger, evidenceRecord("evidence-2"));
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.ledger.records.length, 2);
  assert.equal(first.ledger.records.length, 1);
  assert.ok(Object.isFrozen(second.ledger.records));
  assert.ok(findProjectEvidence(second.ledger, asEvidenceRecordId("evidence-2")!) !== undefined);
  assert.equal(findProjectEvidence(second.ledger, asEvidenceRecordId("evidence-404")!), undefined);
});

test("evidence: E10 — a sealed evidence record cannot be rewritten (mutation rejected)", () => {
  const result = appendProjectEvidence(EMPTY_PROJECT_EVIDENCE_LEDGER, evidenceRecord("evidence-seal"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const sealed = result.ledger.records[0]!;
  assert.ok(Object.isFrozen(sealed));
  assert.throws(() => {
    (sealed as { summary: string }).summary = "rewritten history";
  }, TypeError);
  assert.throws(() => {
    (sealed as { kind: string }).kind = "incident-report";
  }, TypeError);
  assert.equal(sealed.summary.startsWith("Evidence evidence-seal"), true);
});

test("evidence: E10 — re-appending an existing evidence id is refused (no rewrite path)", () => {
  const first = appendProjectEvidence(EMPTY_PROJECT_EVIDENCE_LEDGER, evidenceRecord("evidence-dup"));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  // Same id, DIFFERENT content — an attempted rewrite.
  const rewrite = {
    ...evidenceRecord("evidence-dup"),
    summary: "history has been rewritten",
  };
  const second = appendProjectEvidence(first.ledger, rewrite);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "duplicate-evidence-id");
  // The ledger is returned UNCHANGED.
  assert.equal(second.ledger.records.length, 1);
  assert.equal(second.ledger.records[0]!.summary.startsWith("Evidence evidence-dup"), true);
});

test("evidence: structurally invalid records never enter the ledger", () => {
  const invalid = { ...evidenceRecord("evidence-bad"), summary: "" };
  const refused = appendProjectEvidence(EMPTY_PROJECT_EVIDENCE_LEDGER, invalid);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.code, "invalid-evidence-record");
  const badDigest = {
    ...evidenceRecord("evidence-bad-2"),
    contentDigest: "0",
  } as unknown as ProjectEvidenceRecord;
  const refused2 = appendProjectEvidence(EMPTY_PROJECT_EVIDENCE_LEDGER, badDigest);
  assert.equal(refused2.ok, false);
});

test("evidence: observations are immutable and append-only (lock 27)", () => {
  const first = appendObservation(EMPTY_OBSERVATION_LEDGER, observationRecord("observation-1", "release-1"));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const sealed = first.ledger.observations[0]!;
  assert.ok(Object.isFrozen(sealed));
  assert.throws(() => {
    (sealed as { summary: string }).summary = "rewritten";
  }, TypeError);
  // Duplicate observation id: refused, even with different content.
  const rewrite = appendObservation(first.ledger, {
    ...observationRecord("observation-1", "release-1"),
    summary: "history rewritten",
  });
  assert.equal(rewrite.ok, false);
  if (rewrite.ok) return;
  assert.equal(rewrite.code, "duplicate-observation-id");
  assert.equal(rewrite.ledger.observations.length, 1);
});

test("evidence: E10 — calibration APPENDS conclusions and never rewrites observations", () => {
  const withObservation = appendObservation(EMPTY_OBSERVATION_LEDGER, observationRecord("observation-1", "release-1"));
  assert.equal(withObservation.ok, true);
  if (!withObservation.ok) return;
  const before = withObservation.ledger;
  const conclusion: CalibrationConclusion = {
    calibrationId: asCalibrationId("calibration-1")!,
    cycleId: asLabCycleId("cycle-1")!,
    derivedFrom: [asObservationId("observation-1")!],
    statement: "Organizations with review gates missed fewer defects.",
  };
  const after = appendCalibrationConclusion(before, conclusion);
  assert.equal(after.ok, true);
  if (!after.ok) return;
  // The observations list is carried over as the SAME frozen reference —
  // appending a conclusion is structurally incapable of touching it.
  assert.equal(after.ledger.observations, before.observations);
  assert.deepEqual(after.ledger.observations, before.observations);
  assert.equal(after.ledger.conclusions.length, 1);
  assert.equal(findCalibrationConclusion(after.ledger, asCalibrationId("calibration-1")!)?.statement, conclusion.statement);
  // The appended conclusion itself is sealed.
  assert.ok(Object.isFrozen(after.ledger.conclusions[0]!));
});

test("evidence: calibration cannot cite observations that do not exist (audit chain)", () => {
  const withObservation = appendObservation(EMPTY_OBSERVATION_LEDGER, observationRecord("observation-real", "release-1"));
  assert.equal(withObservation.ok, true);
  if (!withObservation.ok) return;
  const bogus = appendCalibrationConclusion(withObservation.ledger, {
    calibrationId: asCalibrationId("calibration-bogus")!,
    cycleId: asLabCycleId("cycle-1")!,
    derivedFrom: [asObservationId("observation-ghost")!],
    statement: "derived from nothing",
  });
  assert.equal(bogus.ok, false);
  if (bogus.ok) return;
  assert.equal(bogus.code, "unknown-observation-reference");
});

test("evidence: duplicate calibration ids and invalid conclusions are refused", () => {
  const withObservation = appendObservation(EMPTY_OBSERVATION_LEDGER, observationRecord("observation-2", "release-1"));
  assert.equal(withObservation.ok, true);
  if (!withObservation.ok) return;
  const conclusion: CalibrationConclusion = {
    calibrationId: asCalibrationId("calibration-dup")!,
    cycleId: asLabCycleId("cycle-1")!,
    derivedFrom: [asObservationId("observation-2")!],
    statement: "first",
  };
  const first = appendCalibrationConclusion(withObservation.ledger, conclusion);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = appendCalibrationConclusion(first.ledger, { ...conclusion, statement: "second" });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "duplicate-calibration-id");
  const invalid = appendCalibrationConclusion(first.ledger, {
    calibrationId: asCalibrationId("calibration-bad")!,
    cycleId: asLabCycleId("cycle-1")!,
    derivedFrom: [],
    statement: "",
  });
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.code, "invalid-calibration-record");
});

test("evidence: project evidence kinds are a frozen vocabulary", () => {
  assert.ok(Object.isFrozen(PROJECT_EVIDENCE_KINDS));
  assert.ok(PROJECT_EVIDENCE_KINDS.length >= 5);
  for (const kind of PROJECT_EVIDENCE_KINDS) {
    assert.ok(isProjectEvidenceKind(kind));
  }
  assert.equal(isProjectEvidenceKind("wishful-thinking"), false);
  assert.equal(isProjectEvidenceKind(null), false);
});

test("evidence: empty ledgers are frozen and find helpers miss gracefully", () => {
  assert.ok(Object.isFrozen(EMPTY_PROJECT_EVIDENCE_LEDGER));
  assert.ok(Object.isFrozen(EMPTY_PROJECT_EVIDENCE_LEDGER.records));
  assert.ok(Object.isFrozen(EMPTY_OBSERVATION_LEDGER));
  assert.equal(findProjectEvidence(EMPTY_PROJECT_EVIDENCE_LEDGER, asEvidenceRecordId("none")!), undefined);
  assert.equal(findObservation(EMPTY_OBSERVATION_LEDGER, asObservationId("none")!), undefined);
  assert.equal(findCalibrationConclusion(EMPTY_OBSERVATION_LEDGER, asCalibrationId("none")!), undefined);
});
