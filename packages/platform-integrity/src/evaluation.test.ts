/**
 * EVALUATION TESTS — the behavioral golden paths (PL-018; R11, E8/E9/E10/E11).
 *
 * The mode-calibration contract: human-like behavior under a human claim
 * and machine-like behavior under a declared autonomous-AI claim are
 * CONSISTENT with their declarations; machine-like behavior claimed as
 * human and human-like behavior declared as autonomous AI both surface
 * as deviations (the declaration shapes evaluation, never bypasses it).
 * Plus: determinism across fresh service instances (E9), idempotent
 * re-submission with the recorded receipt (E10), new-content new-version
 * history (E10), and the certainty-fields-are-unrepresentable guarantee
 * (E11) on every minted report and verdict.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { IntegrityService } from "./service.ts";
import {
  createFixedClock,
  createMemoryGrantDirectory,
  createMemoryIntegrityStore,
  divergenceObservation,
  humanLikeTrace,
  inconclusiveObservation,
  integrityAdminGrant,
  integritySubmitGrant,
  machineLikeTrace,
  matchObservation,
  demoOperator,
  demoSubject,
  demoTenant,
} from "./fakes.ts";
import {
  FORBIDDEN_INTEGRITY_FIELDS,
  FORBIDDEN_VERDICT_FIELDS,
  asSubjectId,
  validateIntegrityReport,
  validateIntegrityRiskVerdict,
} from "@playliquid/platform-contracts";

const tenant = demoTenant;
const admin = demoOperator;
const operator = asSubjectId("oper-demo-operator")!;
const subject = demoSubject;

function makeService() {
  const grants = createMemoryGrantDirectory();
  grants.grant(integrityAdminGrant(tenant, admin));
  grants.grant(integritySubmitGrant(tenant, operator));
  return new IntegrityService({
    store: createMemoryIntegrityStore().store,
    clock: createFixedClock().clock,
    grants: grants.grantsDirectory,
  });
}

function evaluation(stream: ReturnType<typeof humanLikeTrace>, claim: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    tenant,
    subject,
    source: { replayId: "replay-demo-x", commandStream: stream },
    claim,
    capturedAt: 1_000,
    ...extra,
  } as Parameters<IntegrityService["submitEvaluation"]>[1];
}

test("evaluation: human-like behavior under a human claim is consistent", () => {
  const service = makeService();
  const result = service.submitEvaluation(
    operator,
    evaluation(humanLikeTrace(), { claimKind: "unbacked", mode: "human" }),
  );
  assert.ok(result.accepted);
  assert.equal(result.verdict.kind, "consistent-with-declared-mode");
  assert.ok(result.report.aggregate.riskScore < 0.4);
});

test("evaluation: machine-like behavior under a human claim is pronounced deviation", () => {
  const service = makeService();
  const result = service.submitEvaluation(
    operator,
    evaluation(machineLikeTrace(), { claimKind: "unbacked", mode: "human" }),
  );
  assert.ok(result.accepted);
  assert.equal(result.verdict.kind, "pronounced-deviation-observed");
  assert.ok(result.report.aggregate.riskScore >= 0.7);
});

test("evaluation: machine-like behavior under declared autonomous AI is consistent", () => {
  const service = makeService();
  const result = service.submitEvaluation(
    operator,
    evaluation(machineLikeTrace(), {
      claimKind: "declared",
      declaration: {
        declarationKind: "participation.declared-ai",
        tenant,
        subject,
        declaredAt: 900,
        operator: admin,
      },
    }),
  );
  assert.ok(result.accepted);
  assert.equal(result.verdict.kind, "consistent-with-declared-mode");
});

test("evaluation: human-like behavior under declared autonomous AI is deviation (mismatch surfaced)", () => {
  const service = makeService();
  const result = service.submitEvaluation(
    operator,
    evaluation(humanLikeTrace(), {
      claimKind: "declared",
      declaration: {
        declarationKind: "participation.declared-ai",
        tenant,
        subject,
        declaredAt: 900,
        operator: admin,
      },
    }),
  );
  assert.ok(result.accepted);
  assert.equal(result.verdict.kind, "deviation-observed");
});

test("evaluation: a proven divergence joins the signals as a level-1 outcome signal", () => {
  const service = makeService();
  const stream = machineLikeTrace();
  const result = service.submitEvaluation(
    operator,
    evaluation(stream, { claimKind: "unbacked", mode: "human" }, {
      reexecution: divergenceObservation(stream.streamDigest),
    }),
  );
  assert.ok(result.accepted);
  const outcome = result.report.signals.find((signal) => signal.kind === "outcome");
  assert.ok(outcome);
  assert.equal(outcome.confidence.level, 1);
  assert.equal(outcome.confidence.lowerBound, outcome.confidence.upperBound);
  assert.equal(result.verdict.kind, "pronounced-deviation-observed");
});

test("evaluation: an inconclusive re-execution contributes NO outcome signal (honest absence)", () => {
  const service = makeService();
  const stream = humanLikeTrace();
  const result = service.submitEvaluation(
    operator,
    evaluation(stream, { claimKind: "unbacked", mode: "human" }, {
      reexecution: inconclusiveObservation(stream.streamDigest),
    }),
  );
  assert.ok(result.accepted);
  assert.equal(result.report.signals.find((signal) => signal.kind === "outcome"), undefined);
  assert.equal(result.report.signals.length, 2);
});

test("evaluation: a clean match at full coverage keeps human-like play consistent", () => {
  const service = makeService();
  const stream = humanLikeTrace();
  const result = service.submitEvaluation(
    operator,
    evaluation(stream, { claimKind: "unbacked", mode: "human" }, {
      reexecution: matchObservation(stream.streamDigest, 1),
    }),
  );
  assert.ok(result.accepted);
  assert.equal(result.verdict.kind, "consistent-with-declared-mode");
});

test("evaluation: determinism — fresh instances mint byte-identical artifacts (E9)", () => {
  const first = makeService();
  const second = makeService();
  const request = evaluation(machineLikeTrace(), { claimKind: "unbacked", mode: "human" }, {
    reexecution: divergenceObservation(machineLikeTrace().streamDigest),
  });
  const a = first.submitEvaluation(operator, request);
  const b = second.submitEvaluation(operator, request);
  assert.ok(a.accepted && b.accepted);
  assert.equal(JSON.stringify(a.report), JSON.stringify(b.report));
  assert.equal(JSON.stringify(a.verdict), JSON.stringify(b.verdict));
  assert.equal(a.receipt.receiptId, b.receipt.receiptId);
  assert.equal(a.receipt.submittedAt, b.receipt.submittedAt);
});

test("evaluation: re-submission is idempotent — the recorded receipt, no second mutation (E10)", () => {
  const service = makeService();
  const request = evaluation(humanLikeTrace(), { claimKind: "unbacked", mode: "human" });
  const first = service.submitEvaluation(operator, request);
  assert.ok(first.accepted);
  const second = service.submitEvaluation(operator, request);
  assert.ok(!second.accepted);
  assert.equal(second.code, "duplicate-evaluation");
  assert.ok(second.recorded);
  assert.equal(second.recorded.receiptId, first.receipt.receiptId);
  const history = service.history(admin, tenant);
  assert.ok(history.ok);
  assert.equal(history.receipts.length, 1);
});

test("evaluation: new evidence content mints a NEW version; history is never edited (E10)", () => {
  const service = makeService();
  const stream = humanLikeTrace();
  const base = evaluation(stream, { claimKind: "unbacked", mode: "human" });
  const first = service.submitEvaluation(operator, base);
  assert.ok(first.accepted);
  // New content: the same trace WITH a re-execution outcome observation.
  const second = service.submitEvaluation(
    operator,
    evaluation(stream, { claimKind: "unbacked", mode: "human" }, {
      reexecution: matchObservation(stream.streamDigest),
    }),
  );
  assert.ok(second.accepted);
  assert.notEqual(second.receipt.receiptId, first.receipt.receiptId);
  const history = service.history(admin, tenant);
  assert.ok(history.ok);
  assert.equal(history.receipts.length, 2);
  // The ORIGINAL report is still readable and unchanged.
  const original = service.readReport(admin, tenant, first.receipt.reportId);
  assert.ok(original.ok);
  assert.equal(original.report.reportId, first.receipt.reportId);
});

test("evaluation: minted reports and verdicts never carry forbidden certainty fields (E11)", () => {
  const service = makeService();
  const stream = machineLikeTrace();
  const result = service.submitEvaluation(
    operator,
    evaluation(stream, { claimKind: "unbacked", mode: "human" }, {
      reexecution: divergenceObservation(stream.streamDigest),
    }),
  );
  assert.ok(result.accepted);
  for (const key of Object.keys(result.report as unknown as Record<string, unknown>)) {
    assert.ok(!FORBIDDEN_INTEGRITY_FIELDS.includes(key), `report carries forbidden field ${key}`);
  }
  for (const key of Object.keys(result.verdict as unknown as Record<string, unknown>)) {
    assert.ok(!FORBIDDEN_VERDICT_FIELDS.includes(key), `verdict carries forbidden field ${key}`);
  }
  assert.ok(validateIntegrityReport(result.report).ok);
  assert.ok(validateIntegrityRiskVerdict(result.verdict).ok);
  // Citations resolve against the recorded evidence at the pinned digest.
  for (const citation of result.verdict.evidence) {
    const record = service.readEvidence(admin, tenant, citation.evidenceId);
    assert.ok(record.ok);
    assert.equal(record.record.payloadDigest, citation.payloadDigest);
  }
});

test("evaluation: evidence records are digest-pinned with the stream as source", () => {
  const service = makeService();
  const stream = humanLikeTrace();
  const result = service.submitEvaluation(operator, evaluation(stream, { claimKind: "unbacked", mode: "human" }));
  assert.ok(result.accepted);
  const timingId = result.receipt.evidenceIds[0]!;
  const record = service.readEvidence(admin, tenant, timingId);
  assert.ok(record.ok);
  assert.equal(record.record.kind, "timing");
  assert.equal(record.record.recordKind, "integrity-evidence");
  // The source digest is the bare hex of the stream's package-system digest.
  assert.equal(record.record.sourceDigest, stream.streamDigest.replace("sha256:", ""));
});

test("evaluation: an invalid injected policy is refused before any mutation", () => {
  const service = makeService();
  const brokenPolicy = {
    ...({ policyId: "bad", confidenceLevel: 0.5 } as Record<string, unknown>),
  } as never;
  const result = service.submitEvaluation(
    operator,
    evaluation(humanLikeTrace(), { claimKind: "unbacked", mode: "human" }),
    brokenPolicy,
  );
  assert.ok(!result.accepted);
  assert.equal(result.code, "policy-level-unsupported");
  const history = service.history(admin, tenant);
  assert.ok(history.ok);
  assert.equal(history.receipts.length, 0);
});
