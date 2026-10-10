/**
 * ADMISSION TESTS — the E8 negative gate coverage (PL-018).
 *
 * Every typed refusal path of the admission oracle: malformed requests,
 * non-slug replay references, empty/insufficient traces, forged or
 * mutated command streams (surfaced with the replay verifier's own
 * codes), time-regressing traces, incoherent declarations (structure,
 * tenant, subject, timing), misattributed re-execution verdicts, and
 * malformed verdict shapes. Also the boundary: a trace exactly at the
 * policy minimum IS admissible (honest boundary, not off-by-one).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { admitEvaluation } from "./admission.ts";
import { DEFAULT_INTEGRITY_RISK_POLICY } from "./policy.ts";
import { humanLikeTrace, machineLikeTrace, matchObservation, demoSubject, demoTenant } from "./fakes.ts";
import { sealCommandStream } from "@playliquid/replay";
import { asSubjectId, asTimestampMs } from "@playliquid/platform-contracts";
import { asTimestamp } from "@playliquid/runtime-contracts";

const subject = demoSubject;
const tenant = demoTenant;
const foreignSubject = asSubjectId("actr-foreign")!;
const policy = DEFAULT_INTEGRITY_RISK_POLICY;

function request(overrides: Record<string, unknown>) {
  return {
    tenant,
    subject,
    source: { replayId: "replay-demo-human", commandStream: humanLikeTrace() },
    claim: { claimKind: "unbacked", mode: "human" },
    capturedAt: asTimestampMs(1_000)!,
    ...overrides,
  } as Parameters<typeof admitEvaluation>[0];
}

test("admission: an honest request is admitted with extracted observations", () => {
  const result = admitEvaluation(request({}), policy);
  assert.ok(result.ok);
  assert.equal(result.evaluation.timing.commandCount, 8);
  assert.equal(result.evaluation.trajectory.commandCount, 8);
  assert.equal(result.evaluation.playMode, "human");
  assert.equal(result.evaluation.enforcement, "report-only");
});

test("admission: a non-slug replay reference is refused", () => {
  const result = admitEvaluation(
    request({ source: { replayId: "Not A Slug!", commandStream: humanLikeTrace() } }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "replay-ref-malformed");
});

test("admission: an empty trace is refused", () => {
  const empty = sealCommandStream([]);
  const result = admitEvaluation(
    request({ source: { replayId: "replay-demo-empty", commandStream: empty } }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "trace-empty");
});

test("admission: a trace below the policy minimum is refused; at the minimum admitted", () => {
  const full = humanLikeTrace();
  const shortened = sealCommandStream(full.entries.slice(0, 4));
  const refused = admitEvaluation(
    request({ source: { replayId: "replay-demo-short", commandStream: shortened } }),
    policy,
  );
  assert.ok(!refused.ok);
  assert.equal(refused.code, "trace-insufficient");
  // Boundary: exactly the minimum (8) IS admissible — the fixture itself.
  const admitted = admitEvaluation(request({}), policy);
  assert.ok(admitted.ok);
});

test("admission: a forged (mutated) stream is refused with the verifier's code", () => {
  const trace = machineLikeTrace();
  const mutatedEntries = trace.entries.map((entry, index) =>
    index === trace.entries.length - 1 ? { ...entry, dueTick: 42 } : entry,
  );
  const forged = { streamDigest: trace.streamDigest, form: trace.form, entries: mutatedEntries };
  const result = admitEvaluation(
    request({ source: { replayId: "replay-demo-forged", commandStream: forged } }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "stream-form-mismatch");
});

test("admission: a digest-mismatched stream is refused", () => {
  const trace = machineLikeTrace();
  const forged = { streamDigest: "sha256:" + "a".repeat(64), form: trace.form, entries: trace.entries };
  const result = admitEvaluation(
    request({ source: { replayId: "replay-demo-forged-digest", commandStream: forged } }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "stream-digest-mismatch");
});

test("admission: a time-regressing trace is refused", () => {
  const trace = humanLikeTrace();
  const entries = trace.entries.map((entry) => ({ ...entry }));
  const last = entries[entries.length - 1]!;
  last.envelope = { ...last.envelope, issuedAt: asTimestamp(last.envelope.issuedAt - 10_000) };
  // Re-seal the mutated trace so the stream itself verifies — the
  // regression is caught by THIS module's admission rule, not by the
  // artifact seal (the recorded log is what it is; traveling back in
  // time is the inadmissible part).
  const resealed = sealCommandStream(entries);
  const result = admitEvaluation(
    request({ source: { replayId: "replay-demo-regressed", commandStream: resealed } }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "trace-timing-inconsistent");
});

test("admission: a declaration for another tenant is refused", () => {
  const result = admitEvaluation(
    request({
      claim: {
        claimKind: "declared",
        declaration: {
          declarationKind: "participation.human",
          tenant: asSubjectId("tenant-other")!,
          subject,
          declaredAt: 500,
        },
      },
    }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "declaration-tenant-mismatch");
});

test("admission: a declaration for another subject is refused", () => {
  const result = admitEvaluation(
    request({
      claim: {
        claimKind: "declared",
        declaration: {
          declarationKind: "participation.human",
          tenant,
          subject: foreignSubject,
          declaredAt: 500,
        },
      },
    }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "declaration-subject-mismatch");
});

test("admission: a declaration postdating the evidence is refused", () => {
  const result = admitEvaluation(
    request({
      claim: {
        claimKind: "declared",
        declaration: {
          declarationKind: "participation.human",
          tenant,
          subject,
          declaredAt: 2_000,
        },
      },
    }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "declaration-timing-mismatch");
});

test("admission: a malformed declaration shape is refused", () => {
  const result = admitEvaluation(
    request({
      claim: { claimKind: "declared", declaration: { declarationKind: "participation.nope" } as never },
    }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "declaration-invalid");
});

test("admission: a declared-AI declaration yields the autonomous play mode", () => {
  const result = admitEvaluation(
    request({
      claim: {
        claimKind: "declared",
        declaration: {
          declarationKind: "participation.declared-ai",
          tenant,
          subject,
          declaredAt: 500,
          operator: foreignSubject,
        },
      },
    }),
    policy,
  );
  assert.ok(result.ok);
  assert.equal(result.evaluation.playMode, "ai-autonomous");
  assert.equal(result.evaluation.declaration?.declarationKind, "participation.declared-ai");
});

test("admission: a misattributed re-execution verdict is refused", () => {
  const foreign = machineLikeTrace();
  const result = admitEvaluation(
    request({ reexecution: matchObservation(foreign.streamDigest) }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "reexecution-observed-against-mismatch");
});

test("admission: a malformed re-execution verdict shape is refused", () => {
  const trace = humanLikeTrace();
  const result = admitEvaluation(
    request({
      reexecution: {
        observedAgainst: trace.streamDigest,
        verdict: { kind: "match", confidence: 2, sampledEventSeqs: [1], totalEventCount: 3 } as never,
        observedAt: asTimestampMs(5_000)!,
      },
    }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "reexecution-verdict-malformed");
});

test("admission: a re-execution observed before capture is refused", () => {
  const trace = humanLikeTrace();
  const result = admitEvaluation(
    request({
      reexecution: {
        ...matchObservation(trace.streamDigest),
        observedAt: asTimestampMs(500)!,
      },
    }),
    policy,
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "reexecution-timing-invalid");
});

test("admission: an unknown enforcement posture is refused", () => {
  const result = admitEvaluation(request({ enforcement: "auto-ban" as never }), policy);
  assert.ok(!result.ok);
  assert.equal(result.code, "malformed-request");
});

test("admission: a declared policy-driven enforcement posture passes through", () => {
  const result = admitEvaluation(request({ enforcement: "policy-driven" }), policy);
  assert.ok(result.ok);
  assert.equal(result.evaluation.enforcement, "policy-driven");
});

test("admission: a negative captured-at stamp is refused", () => {
  const result = admitEvaluation(request({ capturedAt: -1 as never }), policy);
  assert.ok(!result.ok);
  assert.equal(result.code, "captured-at-invalid");
});
