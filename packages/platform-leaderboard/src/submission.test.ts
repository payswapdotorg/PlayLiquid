/**
 * Score submission oracle tests: the platform-contracts validation
 * binding (authority marker, evidence, score validity), window
 * gating, idempotency encounters and the integrity quarantine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adjudicateScoreSubmission, submissionIdempotencyKey } from "./submission.ts";
import type { ScoreSubmission, SubmissionFactsInput } from "./submission.ts";
import { asContentDigest, asLeaderboardId, asSubjectId, asTenantId, asTimestampMs } from "@playliquid/platform-contracts";

const ts = (ms: number) => asTimestampMs(ms)!;
import type { LeaderboardServicePolicy } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const leaderboard = asLeaderboardId("board-1")!;
const subject = asSubjectId("player-one")!;
const evidence = asContentDigest("a".repeat(64))!;
const policy: LeaderboardServicePolicy = {
  tieBreaking: "first-achieved",
  resetCadence: "seasonal",
  entryVisibility: "public",
  minIntegrityConfidence: 0.5,
};

function submission(over: Record<string, unknown> = {}): ScoreSubmission {
  return {
    record: {
      tenant,
      leaderboard,
      subject,
      score: 10,
      recordedAt: asTimestampMs(1_000)!,
      sourceEventKind: "match.scored" as never,
      evidence,
      decidedBy: "platform-authority" as const,
    },
    integrityConfidence: 0.9,
    ...over,
  } as ScoreSubmission;
}

function facts(over: Partial<SubmissionFactsInput> = {}): SubmissionFactsInput {
  return {
    boardExists: true,
    boardTenant: tenant,
    withinWindow: true,
    lastRecordedAt: undefined,
    evidenceSeen: false,
    recordedScore: undefined,
    currentEntry: undefined,
    ...over,
  };
}

test("submission: a well-formed authoritative submission is accepted", () => {
  assert.deepEqual(adjudicateScoreSubmission(submission(), facts(), policy), { accepted: true });
});

test("submission: untrusted client-shaped records are refused (R9/E8)", () => {
  const untrusted = adjudicateScoreSubmission(
    submission({ record: { ...submission().record, untrusted: "untrusted-client-input" } }),
    facts(),
    policy,
  );
  assert.ok(!untrusted.accepted && untrusted.code === "not-authoritative");
  const foreign = adjudicateScoreSubmission(
    submission({ record: { ...submission().record, decidedBy: "game-declared" } }),
    facts(),
    policy,
  );
  assert.ok(!foreign.accepted && foreign.code === "not-authoritative");
});

test("submission: the contracts validation codes surface verbatim", () => {
  const missing = adjudicateScoreSubmission(
    submission({ record: { ...submission().record, evidence: "not-a-digest" } }),
    facts(),
    policy,
  );
  assert.ok(!missing.accepted && missing.code === "missing-evidence");
  const negative = adjudicateScoreSubmission(
    submission({ record: { ...submission().record, score: -1 } }),
    facts(),
    policy,
  );
  assert.ok(!negative.accepted && negative.code === "invalid-score");
  const malformed = adjudicateScoreSubmission(
    submission({ record: { ...submission().record, subject: "" } }),
    facts(),
    policy,
  );
  assert.ok(!malformed.accepted && malformed.code === "malformed-record");
});

test("submission: board registration and tenant isolation gates", () => {
  const unknown = adjudicateScoreSubmission(submission(), facts({ boardExists: false }), policy);
  assert.ok(!unknown.accepted && unknown.code === "board-not-registered");
  const cross = adjudicateScoreSubmission(
    submission(),
    facts({ boardTenant: asTenantId("tenant-beta")! }),
    policy,
  );
  assert.ok(!cross.accepted && cross.code === "cross-tenant-access");
});

test("submission: out-of-window submissions are refused", () => {
  const decision = adjudicateScoreSubmission(submission(), facts({ withinWindow: false }), policy);
  assert.ok(!decision.accepted && decision.code === "window-closed");
});

test("submission: replays and collisions are distinct typed refusals (E10/E8)", () => {
  const replay = adjudicateScoreSubmission(submission(), facts({ evidenceSeen: true, recordedScore: 10 }), policy);
  assert.ok(!replay.accepted && replay.code === "duplicate-submission");
  const collision = adjudicateScoreSubmission(submission(), facts({ evidenceSeen: true, recordedScore: 99 }), policy);
  assert.ok(!collision.accepted && collision.code === "idempotency-collision");
});

test("submission: out-of-order submissions are refused as stale (E8)", () => {
  const decision = adjudicateScoreSubmission(submission(), facts({ lastRecordedAt: ts(2_000) }), policy);
  assert.ok(!decision.accepted && decision.code === "stale-submission");
  // Same timestamp is NOT stale (distinct evidence may share a timestamp).
  assert.deepEqual(adjudicateScoreSubmission(submission(), facts({ lastRecordedAt: ts(1_000) }), policy), { accepted: true });
});

test("submission: low-integrity submissions are quarantined (R11 spirit)", () => {
  const decision = adjudicateScoreSubmission(submission({ integrityConfidence: 0.2 }), facts(), policy);
  assert.ok(!decision.accepted && decision.code === "quarantined-low-integrity");
  const invalid = adjudicateScoreSubmission(submission({ integrityConfidence: 1.5 }), facts(), policy);
  assert.ok(!invalid.accepted && invalid.code === "invalid-integrity-confidence");
  const nan = adjudicateScoreSubmission(submission({ integrityConfidence: Number.NaN }), facts(), policy);
  assert.ok(!nan.accepted && nan.code === "invalid-integrity-confidence");
});

test("submission: the idempotency key is the evidence-keyed quadruple", () => {
  assert.equal(
    submissionIdempotencyKey(tenant, leaderboard, subject, evidence),
    `tenant-alpha|board-1|player-one|${"a".repeat(64)}`,
  );
  const other = asContentDigest("b".repeat(64))!;
  assert.notEqual(
    submissionIdempotencyKey(tenant, leaderboard, subject, evidence),
    submissionIdempotencyKey(tenant, leaderboard, subject, other),
  );
});
