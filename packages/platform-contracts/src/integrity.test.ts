import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest } from "./primitives.ts";
import { asReplayId } from "./replay.ts";
import {
  asIntegrityReportId,
  isValidConfidenceInterval,
  isIntegrityEvidenceRef,
  INTEGRITY_SIGNAL_KINDS,
  isIntegritySignalKind,
  AI_PLAY_MODES,
  isAiPlayMode,
  FORBIDDEN_INTEGRITY_FIELDS,
  isForbiddenIntegrityField,
  isIntegrityReport,
  aggregateIntegritySignals,
  validateIntegrityReport,
  isIntegrityEventBinding,
} from "./integrity.ts";
import type {
  ConfidenceInterval,
  IntegritySignal,
  IntegrityReport,
  IntegrityEvidenceRef,
} from "./integrity.ts";
import { asGameEventKind } from "./events.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const reportId = asIntegrityReportId("ir-0042")!;
const replayId = asReplayId("replay-001")!;
const kind = asGameEventKind("shot.landed")!;

// Evidence digests assembled at runtime from fragments.
const digestA = asContentDigest("ab".repeat(32))!;
const digestB = asContentDigest("cd".repeat(32))!;
const qaDigest = asContentDigest("ef".repeat(32))!;

function signal(overrides: Partial<IntegritySignal> = {}): IntegritySignal {
  const confidence: ConfidenceInterval = { level: 0.9, lowerBound: 0.6, upperBound: 0.8 };
  const full: IntegritySignal = {
    kind: "timing",
    weight: 0.6,
    riskContribution: 0.5,
    confidence,
    evidence: [{ source: "replay", replayId, digest: digestA }],
  };
  return { ...full, ...overrides };
}

function report(overrides: Partial<IntegrityReport> = {}): IntegrityReport {
  const signals = [signal()];
  const full: IntegrityReport = {
    reportId,
    tenant,
    subject,
    playMode: "human",
    signals,
    aggregate: aggregateIntegritySignals(signals),
    enforcement: "report-only",
    decidedBy: "platform-authority",
  };
  return { ...full, ...overrides };
}

test("integrity: confidence intervals carry verified bounds (R11 shape checks)", () => {
  assert.ok(isValidConfidenceInterval({ level: 0.95, lowerBound: 0.6, upperBound: 0.8 }));
  assert.ok(isValidConfidenceInterval({ level: 1, lowerBound: 0, upperBound: 1 }));
  assert.equal(isValidConfidenceInterval({ level: 0.95, lowerBound: 0.8, upperBound: 0.6 }), false);
  assert.equal(isValidConfidenceInterval({ level: 0.95, lowerBound: -0.1, upperBound: 0.8 }), false);
  assert.equal(isValidConfidenceInterval({ level: 0.95, lowerBound: 0.6, upperBound: 1.2 }), false);
  assert.equal(isValidConfidenceInterval({ level: 0, lowerBound: 0, upperBound: 1 }), false);
  assert.equal(isValidConfidenceInterval({ level: 1.2, lowerBound: 0, upperBound: 1 }), false);
  assert.equal(isValidConfidenceInterval({ level: Number.NaN, lowerBound: 0, upperBound: 1 }), false);
  assert.equal(isValidConfidenceInterval(null), false);
});

test("integrity: evidence refs are replay-, QA- or telemetry-shaped (E11)", () => {
  const replayRef: IntegrityEvidenceRef = { source: "replay", replayId, digest: digestA };
  const qaRef: IntegrityEvidenceRef = { source: "qa-run", runDigest: qaDigest };
  const telemetryRef: IntegrityEvidenceRef = { source: "session-telemetry", digest: digestB };
  assert.ok(isIntegrityEvidenceRef(replayRef));
  assert.ok(isIntegrityEvidenceRef(qaRef));
  assert.ok(isIntegrityEvidenceRef(telemetryRef));
  assert.equal(isIntegrityEvidenceRef({ source: "psychic", digest: digestA }), false);
  assert.equal(isIntegrityEvidenceRef({ source: "replay", replayId, digest: "junk" }), false);
  assert.equal(isIntegrityEvidenceRef({ source: "qa-run", runDigest: "junk" }), false);
});

test("integrity: signal and AI-play-mode vocabularies are frozen", () => {
  assert.ok(Object.isFrozen(INTEGRITY_SIGNAL_KINDS));
  assert.ok(Object.isFrozen(AI_PLAY_MODES));
  assert.ok(Object.isFrozen(FORBIDDEN_INTEGRITY_FIELDS));
  assert.deepEqual([...INTEGRITY_SIGNAL_KINDS], ["behavioral", "timing", "trajectory", "outcome"]);
  assert.deepEqual([...AI_PLAY_MODES], ["human", "ai-assisted", "ai-autonomous"]);
  assert.ok(isIntegritySignalKind("trajectory"));
  assert.equal(isIntegritySignalKind("psychic"), false);
  assert.ok(isAiPlayMode("ai-assisted"));
  assert.equal(isAiPlayMode("bot"), false);
  assert.ok(isForbiddenIntegrityField("verdict"));
  assert.ok(isForbiddenIntegrityField("isCheating"));
  assert.equal(isForbiddenIntegrityField("riskScore"), false);
});

test("integrity: aggregation is conservative — never tighter than the evidence", () => {
  const aggregate = aggregateIntegritySignals([
    signal({ weight: 0.75, riskContribution: 0.8, confidence: { level: 0.9, lowerBound: 0.5, upperBound: 0.9 } }),
    signal({ weight: 0.25, riskContribution: 0.2, confidence: { level: 0.8, lowerBound: 0.1, upperBound: 0.7 } }),
  ]);
  assert.ok(Math.abs(aggregate.riskScore - (0.75 * 0.8 + 0.25 * 0.2) / 1) < 1e-9);
  assert.equal(aggregate.confidence.lowerBound, 0.1);
  assert.equal(aggregate.confidence.upperBound, 0.9);
  assert.equal(aggregate.confidence.level, 0.8);
  // Degenerate: zero total weight yields the maximally honest interval.
  const degenerate = aggregateIntegritySignals([signal({ weight: 0, riskContribution: 1 })]);
  assert.equal(degenerate.riskScore, 0);
  assert.deepEqual(degenerate.confidence, { level: 1, lowerBound: 0, upperBound: 1 });
});

test("integrity: a well-formed report validates (R11 happy path)", () => {
  const valid = report();
  assert.ok(isIntegrityReport(valid));
  const validation = validateIntegrityReport(valid);
  assert.equal(validation.ok, true);
  if (validation.ok) assert.equal(validation.riskScore, 0.5);
});

test("integrity: certainty fields make a report INVALID (R11: never magical certainty)", () => {
  const certain = { ...report(), verdict: "cheating" } as unknown;
  assert.equal(isIntegrityReport(certain), false);
  assert.deepEqual(validateIntegrityReport(certain), { ok: false, code: "certainty-claimed" });
  const flagged = { ...report(), isCheating: true } as unknown;
  assert.deepEqual(validateIntegrityReport(flagged), { ok: false, code: "certainty-claimed" });
  const guilty = { ...report(), guilty: true } as unknown;
  assert.deepEqual(validateIntegrityReport(guilty), { ok: false, code: "certainty-claimed" });
});

test("integrity: signals without evidence are inadmissible (E11 negative path)", () => {
  const unevidenced = report({ signals: [signal({ evidence: [] })] });
  // Fix the aggregate so the failure is attributable to the evidence rule.
  const withAggregate = { ...unevidenced, aggregate: aggregateIntegritySignals(unevidenced.signals) };
  assert.deepEqual(validateIntegrityReport(withAggregate), {
    ok: false,
    code: "signal-without-evidence",
  });
});

test("integrity: invalid confidence intervals are rejected (R11 shape check)", () => {
  const broken = report({
    signals: [signal({ confidence: { level: 0.95, lowerBound: 0.9, upperBound: 0.4 } })],
  });
  const withAggregate = { ...broken, aggregate: aggregateIntegritySignals(broken.signals) };
  assert.deepEqual(validateIntegrityReport(withAggregate), {
    ok: false,
    code: "invalid-confidence-interval",
  });
});

test("integrity: reports with no signals and stale aggregates are rejected (E8/E11)", () => {
  assert.deepEqual(validateIntegrityReport(report({ signals: [] })), {
    ok: false,
    code: "empty-signals",
  });
  // An aggregate stronger than the signals can support (0 risk despite a
  // 1.0 risk contribution) is a lie and fails the recomputation check.
  const stronger = report({ signals: [signal({ riskContribution: 1, weight: 1 })] });
  const dishonest = { ...stronger, aggregate: { riskScore: 0, confidence: stronger.aggregate.confidence } };
  assert.deepEqual(validateIntegrityReport(dishonest), { ok: false, code: "aggregate-mismatch" });
  assert.deepEqual(validateIntegrityReport("junk"), { ok: false, code: "malformed-report" });
});

test("integrity: explicit AI play modes are surfaced, not punished (architecture)", () => {
  const aiAssisted = report({ playMode: "ai-assisted" });
  assert.ok(validateIntegrityReport(aiAssisted).ok);
  const aiAutonomous = report({
    playMode: "ai-autonomous",
    signals: [
      signal({
        kind: "behavioral",
        evidence: [
          { source: "qa-run", runDigest: qaDigest },
          { source: "session-telemetry", digest: digestB },
        ],
      }),
    ],
  });
  const reAggregate = { ...aiAutonomous, aggregate: aggregateIntegritySignals(aiAutonomous.signals) };
  assert.ok(validateIntegrityReport(reAggregate).ok);
});

test("integrity: games bind their events for integrity analysis (lock 18)", () => {
  assert.ok(isIntegrityEventBinding({ capability: "integrity", eventKind: kind }));
  assert.equal(isIntegrityEventBinding({ capability: "integrity", eventKind: "" }), false);
  assert.equal(isIntegrityEventBinding({ capability: "leaderboard", eventKind: kind }), false);
});
