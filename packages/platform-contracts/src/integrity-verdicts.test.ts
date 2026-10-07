import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest } from "./primitives.ts";
import { asIntegrityReportId } from "./integrity.ts";
import { asEvidenceRecordId } from "./integrity-evidence.ts";
import {
  asIntegrityVerdictId,
  INTEGRITY_VERDICT_KINDS,
  isIntegrityVerdictKind,
  verdictSeverityRank,
  VERDICT_CONFIDENCE_BANDS,
  isVerdictConfidenceBand,
  verdictBandRank,
  classifyVerdictConfidenceBand,
  FORBIDDEN_VERDICT_FIELDS,
  isForbiddenVerdictField,
  isIntegrityRiskVerdict,
  validateIntegrityRiskVerdict,
} from "./integrity-verdicts.ts";
import type { IntegrityRiskVerdict } from "./integrity-verdicts.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const verdictId = asIntegrityVerdictId("v-0001")!;
const reportRef = asIntegrityReportId("ir-0042")!;
const evidenceId = asEvidenceRecordId("ev-0001")!;

// Digests assembled from fragments.
const payloadDigest = asContentDigest("ab".repeat(32))!;

function verdict(overrides: Partial<IntegrityRiskVerdict> = {}): IntegrityRiskVerdict {
  const full: IntegrityRiskVerdict = {
    verdictId,
    tenant,
    subject,
    reportRef,
    kind: "deviation-observed",
    risk: { riskScore: 0.62, confidence: { level: 0.9, lowerBound: 0.5, upperBound: 0.74 } },
    band: "moderate",
    evidence: [{ evidenceId, payloadDigest }],
    decidedBy: "platform-authority",
  };
  return { ...full, ...overrides };
}

test("verdicts: the frozen vocabulary is escalation-ordered, never identity-claiming", () => {
  assert.ok(Object.isFrozen(INTEGRITY_VERDICT_KINDS));
  assert.deepEqual([...INTEGRITY_VERDICT_KINDS], [
    "inconclusive",
    "consistent-with-declared-mode",
    "deviation-observed",
    "pronounced-deviation-observed",
  ]);
  assert.ok(isIntegrityVerdictKind("inconclusive"));
  assert.equal(isIntegrityVerdictKind("isBot"), false);
  assert.equal(isIntegrityVerdictKind("bot"), false);
  assert.equal(verdictSeverityRank("inconclusive"), 0);
  assert.ok(verdictSeverityRank("pronounced-deviation-observed") > verdictSeverityRank("deviation-observed"));
});

test("verdicts: confidence bands are width-derived, frozen and ordered", () => {
  assert.ok(Object.isFrozen(VERDICT_CONFIDENCE_BANDS));
  for (const entry of VERDICT_CONFIDENCE_BANDS) assert.ok(Object.isFrozen(entry));
  assert.ok(isVerdictConfidenceBand("narrow"));
  assert.equal(isVerdictConfidenceBand("precise"), false);
  assert.ok(verdictBandRank("narrow") > verdictBandRank("moderate"));
  assert.ok(verdictBandRank("moderate") > verdictBandRank("wide"));
  // Width classification: 0.74 - 0.5 = 0.24 -> moderate.
  assert.equal(classifyVerdictConfidenceBand({ level: 0.9, lowerBound: 0.5, upperBound: 0.74 }), "moderate");
  assert.equal(classifyVerdictConfidenceBand({ level: 0.9, lowerBound: 0.7, upperBound: 0.75 }), "narrow");
  assert.equal(classifyVerdictConfidenceBand({ level: 0.9, lowerBound: 0.1, upperBound: 0.9 }), "wide");
  // An unusable interval degrades to the maximally honest band.
  assert.equal(classifyVerdictConfidenceBand({ level: 0, lowerBound: 0.5, upperBound: 0.4 } as never), "wide");
});

test("verdicts: boolean identity claims are unrepresentable (R11 core negative path)", () => {
  assert.ok(Object.isFrozen(FORBIDDEN_VERDICT_FIELDS));
  for (const field of ["isBot", "isBotPlayer", "isHuman", "isAutomaton", "guilty", "innocent"]) {
    assert.ok(isForbiddenVerdictField(field), `${field} must be forbidden`);
  }
  assert.equal(isForbiddenVerdictField("riskScore"), false);
  assert.equal(isForbiddenVerdictField("band"), false);
  // A verdict carrying isBot fails BOTH the structural guard and validation.
  const botClaim = { ...verdict(), isBot: true } as unknown;
  assert.equal(isIntegrityRiskVerdict(botClaim), false);
  assert.deepEqual(validateIntegrityRiskVerdict(botClaim), { ok: false, code: "certainty-claimed" });
  // Absolution is equally unrepresentable — certainty cuts both ways.
  const humanClaim = { ...verdict(), isHuman: true } as unknown;
  assert.deepEqual(validateIntegrityRiskVerdict(humanClaim), { ok: false, code: "certainty-claimed" });
});

test("verdicts: a well-formed verdict validates (happy path)", () => {
  const valid = verdict();
  assert.ok(isIntegrityRiskVerdict(valid));
  assert.deepEqual(validateIntegrityRiskVerdict(valid), {
    ok: true,
    kind: "deviation-observed",
    band: "moderate",
  });
  assert.ok(asIntegrityVerdictId("v-0042"));
  assert.equal(asIntegrityVerdictId("NOT A VERDICT"), undefined);
});

test("verdicts: verdicts without evidence are inadmissible (E11)", () => {
  const unevidenced = verdict({ evidence: [] });
  assert.deepEqual(validateIntegrityRiskVerdict(unevidenced), {
    ok: false,
    code: "verdict-without-evidence",
  });
  const malformedCitation = verdict({
    evidence: [{ evidenceId, payloadDigest: "junk" as never }],
  });
  assert.deepEqual(validateIntegrityRiskVerdict(malformedCitation), { ok: false, code: "malformed-verdict" });
});

test("verdicts: the band may never look narrower than the interval supports", () => {
  // Interval width 0.8 is wide; claiming "narrow" is a lie.
  const exaggerated = verdict({
    risk: { riskScore: 0.6, confidence: { level: 0.9, lowerBound: 0.1, upperBound: 0.9 } },
    band: "narrow",
  });
  assert.deepEqual(validateIntegrityRiskVerdict(exaggerated), { ok: false, code: "band-mismatch" });
  // Same interval, honestly labeled wide, validates.
  const honest = verdict({
    kind: "inconclusive",
    risk: { riskScore: 0.6, confidence: { level: 0.9, lowerBound: 0.1, upperBound: 0.9 } },
    band: "wide",
  });
  assert.equal(validateIntegrityRiskVerdict(honest).ok, true);
});

test("verdicts: malformed verdicts and broken risk intervals are refused", () => {
  assert.deepEqual(validateIntegrityRiskVerdict("junk"), { ok: false, code: "malformed-verdict" });
  assert.deepEqual(validateIntegrityRiskVerdict(null), { ok: false, code: "malformed-verdict" });
  const brokenInterval = verdict({
    risk: { riskScore: 0.6, confidence: { level: 0.95, lowerBound: 0.9, upperBound: 0.4 } },
  });
  assert.deepEqual(validateIntegrityRiskVerdict(brokenInterval), { ok: false, code: "invalid-risk-interval" });
  assert.equal(isIntegrityRiskVerdict({ ...verdict(), decidedBy: "game-declared" }), false);
  assert.equal(isIntegrityRiskVerdict({ ...verdict(), kind: "isBot" as never }), false);
  assert.equal(isIntegrityRiskVerdict({ ...verdict(), reportRef: "" }), false);
});

test("verdicts: verdicts are readonly data (E1 compile check)", () => {
  const verdictRecord: IntegrityRiskVerdict = verdict();
  // @ts-expect-error — E1: contract fields are readonly
  verdictRecord.kind = "inconclusive";
  assert.equal(verdictRecord.verdictId, verdictId);
});
