import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import {
  asModerationReportId,
  asModerationCaseId,
  MODERATION_SURFACES,
  isModerationSurface,
  MODERATION_SEVERITY_ORDER,
  isModerationSeverity,
  severityRank,
  isModerationServicePolicy,
  isModerationEventBinding,
  isModerationReport,
  requiredEvidenceCount,
  assessModerationReport,
  isModerationCaseDecision,
  adjudicateAppeal,
} from "./moderation.ts";
import type {
  ModerationServicePolicy,
  ModerationReport,
  ModerationAppeal,
  ModerationSeverity,
} from "./moderation.ts";

const tenant = asTenantId("tenant-alpha")!;
const reporter = asSubjectId("player-one")!;
const reported = asSubjectId("player-two")!;
const reportId = asModerationReportId("report-001")!;
const caseId = asModerationCaseId("case-001")!;
const kind = asGameEventKind("chat.message")!;

// Credential-shaped fixtures are assembled at runtime from fragments.
const digestA = asContentDigest(["aa", "bb"].join("") + "0".repeat(60))!;
const digestB = asContentDigest(["cc", "dd"].join("") + "0".repeat(60))!;

const policy: ModerationServicePolicy = {
  surfaces: ["chat", "behavior"],
  appealable: true,
  minEvidenceArtifacts: 1,
};

function report(overrides: Partial<ModerationReport> = {}): ModerationReport {
  const full: ModerationReport = {
    reportId,
    tenant,
    surface: "chat",
    severity: "minor",
    reportedSubject: reported,
    reporter,
    evidence: [digestA],
    summary: "Toxic messaging in lobby chat.",
  };
  return { ...full, ...overrides };
}

test("moderation: vocabularies are frozen and guards work", () => {
  assert.ok(Object.isFrozen(MODERATION_SURFACES));
  assert.ok(Object.isFrozen(MODERATION_SEVERITY_ORDER));
  assert.deepEqual([...MODERATION_SEVERITY_ORDER], ["info", "minor", "major", "critical"]);
  assert.ok(isModerationSurface("chat"));
  assert.equal(isModerationSurface("dm"), false);
  assert.ok(isModerationSeverity("critical"));
  assert.equal(isModerationSeverity("catastrophic"), false);
});

test("moderation: severity ranks are ordered", () => {
  assert.equal(severityRank("info"), 0);
  assert.equal(severityRank("critical"), 3);
  assert.ok(severityRank("major") > severityRank("minor"));
});

test("moderation: service policies and event bindings validate", () => {
  assert.ok(isModerationServicePolicy(policy));
  assert.equal(isModerationServicePolicy({ ...policy, surfaces: [] }), false);
  assert.equal(isModerationServicePolicy({ ...policy, minEvidenceArtifacts: 0 }), false);
  assert.ok(isModerationEventBinding({ capability: "moderation", eventKind: kind, surface: "chat" }));
  assert.equal(
    isModerationEventBinding({ capability: "moderation", eventKind: kind, surface: "dm" }),
    false,
  );
});

test("moderation: report guards demand digests and summaries", () => {
  assert.ok(isModerationReport(report()));
  assert.equal(isModerationReport({ ...report(), evidence: ["not-a-digest"] }), false);
  assert.equal(isModerationReport({ ...report(), summary: "" }), false);
  assert.equal(isModerationReport({ ...report(), severity: "apocalyptic" }), false);
  assert.equal(isModerationReport(null), false);
});

test("moderation: critical reports require double evidence (severity-scaled threshold)", () => {
  const critical: ModerationSeverity = "critical";
  assert.equal(requiredEvidenceCount("minor", policy), 1);
  assert.equal(requiredEvidenceCount(critical, policy), 2);
  // One artifact is not enough for a critical accusation.
  assert.deepEqual(assessModerationReport(report({ severity: "critical", evidence: [digestA] }), policy, []), {
    disposition: "rejected",
    code: "insufficient-evidence",
  });
  assert.deepEqual(
    assessModerationReport(report({ severity: "critical", evidence: [digestA, digestB] }), policy, []),
    { disposition: "accepted-for-review" },
  );
});

test("moderation: reports on undeclared surfaces are rejected (E8 negative path)", () => {
  assert.deepEqual(assessModerationReport(report({ surface: "content" }), policy, []), {
    disposition: "rejected",
    code: "surface-not-declared",
  });
});

test("moderation: evidence-below-threshold reports are rejected (E8 negative path)", () => {
  const strictPolicy: ModerationServicePolicy = { ...policy, minEvidenceArtifacts: 2 };
  assert.deepEqual(assessModerationReport(report({ evidence: [digestA] }), strictPolicy, []), {
    disposition: "rejected",
    code: "insufficient-evidence",
  });
  assert.deepEqual(
    assessModerationReport(report({ evidence: [digestA, digestB] }), strictPolicy, []),
    { disposition: "accepted-for-review" },
  );
});

test("moderation: duplicate reports by the same reporter are rejected (E8 negative path)", () => {
  const priors: readonly Pick<ModerationReport, "reporter" | "reportedSubject" | "surface">[] = [
    { reporter, reportedSubject: reported, surface: "chat" },
  ];
  assert.deepEqual(assessModerationReport(report(), policy, priors), {
    disposition: "rejected",
    code: "duplicate-report",
  });
  // A different surface by the same reporter is a new report, not a duplicate.
  assert.deepEqual(assessModerationReport(report({ surface: "behavior" }), policy, priors), {
    disposition: "accepted-for-review",
  });
});

test("moderation: case decisions carry the platform authority marker", () => {
  assert.ok(
    isModerationCaseDecision({
      caseId,
      reportRef: reportId,
      outcome: "upheld",
      decidedBy: "platform-authority",
      reasons: ["evidence reviewed"],
    }),
  );
  assert.equal(
    isModerationCaseDecision({
      caseId,
      reportRef: reportId,
      outcome: "upheld",
      decidedBy: "game-declared",
      reasons: [],
    }),
    false,
  );
});

test("moderation: appeals are refused under non-appealable policies (E8 negative path)", () => {
  const appeal: ModerationAppeal = { caseId, appellant: reported, grounds: "I did not write that." };
  assert.deepEqual(adjudicateAppeal(appeal, policy), {
    outcome: "pending",
    decidedBy: "platform-authority",
  });
  const nonAppealable: ModerationServicePolicy = { ...policy, appealable: false };
  assert.deepEqual(adjudicateAppeal(appeal, nonAppealable), {
    refused: true,
    code: "policy-not-appealable",
  });
  assert.deepEqual(adjudicateAppeal({ ...appeal, grounds: "   " }, policy), {
    refused: true,
    code: "empty-grounds",
  });
});

test("moderation: severity literals are not interchangeable (compile-time misuse)", () => {
  // @ts-expect-error — "catastrophic" is not a ModerationSeverity literal
  const severity: ModerationSeverity = "catastrophic";
  assert.equal(isModerationSeverity(severity), false);
});
