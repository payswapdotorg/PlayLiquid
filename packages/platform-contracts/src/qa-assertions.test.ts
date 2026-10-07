import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asContentDigest } from "./primitives.ts";
import { asReplayId } from "./replay.ts";
import {
  asQaExpectationId,
  asQaExpectationResultId,
  REPLAY_EXPECTATION_KINDS,
  isReplayExpectationKind,
  isReplayExpectation,
  EXPECTATION_OUTCOMES,
  isExpectationOutcome,
  isReplayExpectationResult,
  validateExpectationResult,
} from "./qa-assertions.ts";
import type { ReplayExpectation, ReplayExpectationResult } from "./qa-assertions.ts";

const tenant = asTenantId("tenant-alpha")!;
const otherTenant = asTenantId("tenant-beta")!;
const replayRef = asReplayId("replay-001")!;
const otherReplay = asReplayId("replay-999")!;
const replayDigest = asContentDigest("ef".repeat(32))!;
const otherDigest = asContentDigest("ab".repeat(32))!;
const expectationDigest = asContentDigest("cd".repeat(32))!;
const evidenceDigest = asContentDigest("12".repeat(32))!;
const expectationId = asQaExpectationId("qa-exp-001")!;

function expectation(
  overrides: Partial<ReplayExpectation> = {},
): ReplayExpectation {
  const full: ReplayExpectation = {
    expectationId,
    tenant,
    replayRef,
    replayDigest,
    kind: "determinism-holds",
    expectationDigest,
  };
  return { ...full, ...overrides };
}

function result(overrides: Partial<ReplayExpectationResult> = {}): ReplayExpectationResult {
  const full: ReplayExpectationResult = {
    resultId: asQaExpectationResultId("qa-res-001")!,
    expectationRef: expectationId,
    tenant,
    replayDigest,
    outcome: "met",
    evidenceDigest,
    decidedBy: "platform-authority",
  };
  return { ...full, ...overrides };
}

test("qa-assertions: the expectation vocabulary is frozen", () => {
  assert.ok(Object.isFrozen(REPLAY_EXPECTATION_KINDS));
  assert.deepEqual([...REPLAY_EXPECTATION_KINDS], [
    "determinism-holds",
    "event-sequence-matches",
    "invariant-holds",
    "outcome-digest-matches",
  ]);
  assert.ok(isReplayExpectationKind("invariant-holds"));
  assert.equal(isReplayExpectationKind("runs-fast"), false);
  assert.equal(isReplayExpectationKind(""), false);
});

test("qa-assertions: expectation records validate (digest-pinned, opaque params)", () => {
  for (const kind of REPLAY_EXPECTATION_KINDS) {
    assert.ok(isReplayExpectation(expectation({ kind })), `${kind} should validate`);
  }
  assert.ok(asQaExpectationId("qa-exp-0042"));
  assert.equal(asQaExpectationId("NOT AN EXPECTATION"), undefined);
  assert.ok(asQaExpectationResultId("qa-res-0042"));
  assert.equal(asQaExpectationResultId("NOT A RESULT"), undefined);
  assert.equal(isReplayExpectation({ ...expectation(), replayDigest: "junk" as never }), false);
  assert.equal(isReplayExpectation({ ...expectation(), expectationDigest: "junk" as never }), false);
  assert.equal(isReplayExpectation({ ...expectation(), kind: "vibes" as never }), false);
  assert.equal(isReplayExpectation({ ...expectation(), expectationId: "" }), false);
  assert.equal(isReplayExpectation(null), false);
});

test("qa-assertions: outcome vocabulary is frozen and includes honest inconclusive", () => {
  assert.ok(Object.isFrozen(EXPECTATION_OUTCOMES));
  assert.deepEqual([...EXPECTATION_OUTCOMES], ["met", "not-met", "inconclusive"]);
  assert.ok(isExpectationOutcome("inconclusive"));
  assert.equal(isExpectationOutcome("passed"), false);
  assert.equal(isExpectationOutcome("verified"), false);
});

test("qa-assertions: results carry mandatory evidence for EVERY outcome (E11)", () => {
  for (const outcome of EXPECTATION_OUTCOMES) {
    const recorded = result({ outcome });
    assert.ok(isReplayExpectationResult(recorded), `${outcome} should validate`);
    assert.ok(validateExpectationResult(recorded, expectation()).ok);
  }
  // A result without a valid evidence digest is structurally refused —
  // a bare claim proves nothing, including "inconclusive".
  assert.equal(isReplayExpectationResult({ ...result(), evidenceDigest: "junk" as never }), false);
  assert.equal(isReplayExpectationResult({ ...result(), decidedBy: "game-declared" }), false);
  assert.equal(isReplayExpectationResult({ ...result(), outcome: "passed" as never }), false);
  assert.equal(isReplayExpectationResult(null), false);
});

test("qa-assertions: the chain result -> expectation -> replay stays closed (E8)", () => {
  // Happy path.
  assert.deepEqual(validateExpectationResult(result(), expectation()), { ok: true, outcome: "met" });
  // Referencing ANOTHER expectation is refused.
  const foreign = expectation({ expectationId: asQaExpectationId("qa-exp-999")! });
  assert.deepEqual(validateExpectationResult(result(), foreign), {
    ok: false,
    code: "expectation-ref-mismatch",
  });
  // Cross-tenant results are refused.
  assert.deepEqual(validateExpectationResult(result({ tenant: otherTenant }), expectation()), {
    ok: false,
    code: "tenant-mismatch",
  });
  // A result pinning DIFFERENT artifact content than its expectation is
  // refused — never a quiet re-attach.
  assert.deepEqual(validateExpectationResult(result({ replayDigest: otherDigest }), expectation()), {
    ok: false,
    code: "replay-mismatch",
  });
  assert.deepEqual(
    validateExpectationResult(result(), expectation({ replayRef: otherReplay, replayDigest: otherDigest })),
    { ok: false, code: "replay-mismatch" },
  );
  // Malformed inputs are refused with the precise code.
  assert.deepEqual(validateExpectationResult("junk", expectation()), {
    ok: false,
    code: "malformed-result",
  });
});

test("qa-assertions: records are readonly data (E1 compile check)", () => {
  const recorded: ReplayExpectationResult = result();
  // @ts-expect-error — E1: contract fields are readonly
  recorded.outcome = "not-met";
  assert.equal(recorded.resultId, asQaExpectationResultId("qa-res-001")!);
});
