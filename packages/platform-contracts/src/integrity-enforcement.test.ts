import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest, asTimestampMs } from "./primitives.ts";
import { asIntegrityReportId } from "./integrity.ts";
import { asEvidenceRecordId } from "./integrity-evidence.ts";
import { asIntegrityVerdictId } from "./integrity-verdicts.ts";
import type { IntegrityRiskVerdict } from "./integrity-verdicts.ts";
import type { ParticipationModeDeclaration } from "./participation.ts";
import {
  asIntegrityEnforcementPolicyId,
  asEnforcementDecisionId,
  ENFORCEMENT_ACTION_KINDS,
  isEnforcementActionKind,
  isEnforcementRule,
  isIntegrityEnforcementPolicy,
  isIntegrityEnforcementDecision,
  decideEnforcement,
  validateEnforcementDecision,
} from "./integrity-enforcement.ts";
import type { IntegrityEnforcementPolicy, IntegrityEnforcementDecision } from "./integrity-enforcement.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const policyId = asIntegrityEnforcementPolicyId("enforce-policy-1")!;
const decisionId = asEnforcementDecisionId("decision-0001")!;
const reportRef = asIntegrityReportId("ir-0042")!;
const verdictId = asIntegrityVerdictId("v-0001")!;
const evidenceId = asEvidenceRecordId("ev-0001")!;
const payloadDigest = asContentDigest("ab".repeat(32))!;
const otherDigest = asContentDigest("34".repeat(32))!;

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

function policy(overrides: Partial<IntegrityEnforcementPolicy> = {}): IntegrityEnforcementPolicy {
  const full: IntegrityEnforcementPolicy = {
    policyId,
    tenant,
    rules: [{ minSeverity: "deviation-observed", minBand: "moderate", action: "flag-for-review" }],
  };
  return { ...full, ...overrides };
}

const humanDeclaration: ParticipationModeDeclaration = {
  declarationKind: "participation.human",
  tenant,
  subject,
  declaredAt: asTimestampMs(0)!,
};

test("enforcement: action vocabulary is frozen and proportionate", () => {
  assert.ok(Object.isFrozen(ENFORCEMENT_ACTION_KINDS));
  assert.deepEqual([...ENFORCEMENT_ACTION_KINDS], [
    "no-action",
    "flag-for-review",
    "refer-to-moderation",
    "restrict-matchmaking",
    "quarantine-rewards",
  ]);
  assert.ok(isEnforcementActionKind("quarantine-rewards"));
  // Identity-asserting actions are unrepresentable (negative path).
  assert.equal(isEnforcementActionKind("ban-as-bot"), false);
  assert.equal(isEnforcementActionKind("ban"), false);
});

test("enforcement: rules and policies validate structurally", () => {
  assert.ok(isEnforcementRule({ minSeverity: "deviation-observed", minBand: "moderate", action: "no-action" }));
  assert.ok(isEnforcementRule({ minSeverity: "inconclusive", minBand: "wide", action: "no-action", declaredMode: "human" }));
  assert.equal(isEnforcementRule({ minSeverity: "isBot" as never, minBand: "wide", action: "no-action" }), false);
  assert.equal(isEnforcementRule({ minSeverity: "inconclusive", minBand: "precise" as never, action: "no-action" }), false);
  assert.equal(isEnforcementRule({ minSeverity: "inconclusive", minBand: "wide", action: "ban" as never }), false);
  assert.equal(
    isEnforcementRule({ minSeverity: "inconclusive", minBand: "wide", action: "no-action", declaredMode: "bot" as never }),
    false,
  );
  assert.ok(isIntegrityEnforcementPolicy(policy()));
  // A policy with no rules is structurally invalid — totality is explicit.
  assert.equal(isIntegrityEnforcementPolicy(policy({ rules: [] })), false);
  assert.ok(asIntegrityEnforcementPolicyId("enforce-policy-2"));
  assert.equal(asIntegrityEnforcementPolicyId("NOT A POLICY"), undefined);
});

test("enforcement: a matching rule produces a decision with the full audit chain", () => {
  const outcome = decideEnforcement(decisionId, policy(), verdict());
  assert.ok(outcome.decided);
  if (outcome.decided) {
    const decision = outcome.decision;
    assert.equal(decision.decisionId, decisionId);
    assert.equal(decision.policyRef, policyId);
    assert.equal(decision.verdictRef, verdictId);
    assert.equal(decision.action, "flag-for-review");
    assert.deepEqual(decision.evidence, [{ evidenceId, payloadDigest }]);
    assert.equal(decision.decidedBy, "platform-authority");
    assert.ok(isIntegrityEnforcementDecision(decision));
    assert.deepEqual(validateEnforcementDecision(decision, policy(), verdict()), {
      ok: true,
      action: "flag-for-review",
    });
  }
});

test("enforcement: thresholds are respected — weak verdicts fire no rule", () => {
  // Severity below the rule's minimum.
  const mild = decideEnforcement(decisionId, policy(), verdict({ kind: "inconclusive" }));
  assert.deepEqual(mild, { decided: false, code: "no-matching-rule" });
  // Confidence band below the rule's minimum.
  const wide = decideEnforcement(
    decisionId,
    policy(),
    verdict({
      risk: { riskScore: 0.6, confidence: { level: 0.9, lowerBound: 0.2, upperBound: 0.9 } },
      band: "wide",
    }),
  );
  assert.deepEqual(wide, { decided: false, code: "no-matching-rule" });
});

test("enforcement: enforcement without evidence is inadmissible, always", () => {
  const unevidenced = decideEnforcement(decisionId, policy(), verdict({ evidence: [] }));
  assert.deepEqual(unevidenced, { decided: false, code: "verdict-without-evidence" });
  // A verdict that fails its own validation never reaches enforcement.
  const exaggerated = decideEnforcement(
    decisionId,
    policy(),
    verdict({
      risk: { riskScore: 0.6, confidence: { level: 0.9, lowerBound: 0.1, upperBound: 0.9 } },
      band: "narrow", // band-mismatch -> invalid verdict
    }),
  );
  assert.deepEqual(exaggerated, { decided: false, code: "invalid-verdict" });
  // Malformed policy.
  const malformed = decideEnforcement(decisionId, policy({ rules: [] }), verdict());
  assert.deepEqual(malformed, { decided: false, code: "malformed-policy" });
});

test("enforcement: pinned rules branch on the DECLARATION, not inference", () => {
  const pinned = policy({
    rules: [
      { minSeverity: "deviation-observed", minBand: "moderate", action: "restrict-matchmaking", declaredMode: "ai-autonomous" },
    ],
  });
  // Without a declaration, a pinned rule cannot fire.
  const noDeclaration = decideEnforcement(decisionId, pinned, verdict());
  assert.deepEqual(noDeclaration, { decided: false, code: "no-matching-rule" });
  // A human declaration does not satisfy an ai-autonomous pin.
  const human = decideEnforcement(decisionId, pinned, verdict(), humanDeclaration);
  assert.deepEqual(human, { decided: false, code: "no-matching-rule" });
  // A declared-AI participation satisfies the pin — policy branches on
  // the declaration, never on sniffed identity.
  const declaredAi: ParticipationModeDeclaration = {
    declarationKind: "participation.declared-ai",
    tenant,
    subject,
    declaredAt: asTimestampMs(0)!,
    operator: asSubjectId("operator-one")!,
  };
  const fired = decideEnforcement(decisionId, pinned, verdict(), declaredAi);
  assert.ok(fired.decided);
  if (fired.decided) assert.equal(fired.decision.action, "restrict-matchmaking");
});

test("enforcement: the audit validator refuses drift and smuggled evidence (E8)", () => {
  const outcome = decideEnforcement(decisionId, policy(), verdict());
  assert.ok(outcome.decided);
  if (!outcome.decided) return;
  const decision = outcome.decision;

  // Citing evidence the verdict does NOT rest on is refused.
  const smuggled = {
    ...decision,
    evidence: [...decision.evidence, { evidenceId: asEvidenceRecordId("ev-9999")!, payloadDigest: otherDigest }],
  };
  assert.deepEqual(validateEnforcementDecision(smuggled, policy(), verdict()), {
    ok: false,
    code: "evidence-not-in-verdict",
  });

  // A decision citing no evidence at all is refused.
  const empty = { ...decision, evidence: [] };
  assert.deepEqual(validateEnforcementDecision(empty, policy(), verdict()), {
    ok: false,
    code: "no-evidence-cited",
  });

  // A decision under the WRONG policy id is refused.
  const otherPolicy = policy({ policyId: asIntegrityEnforcementPolicyId("enforce-policy-2")! });
  assert.deepEqual(validateEnforcementDecision(decision, otherPolicy, verdict()), {
    ok: false,
    code: "policy-reference-mismatch",
  });

  // A decision naming the WRONG verdict is refused.
  const otherVerdict = verdict({ verdictId: asIntegrityVerdictId("v-9999")! });
  assert.deepEqual(validateEnforcementDecision(decision, policy(), otherVerdict), {
    ok: false,
    code: "verdict-reference-mismatch",
  });

  // An action the policy would not produce is refused (not policy-driven).
  const rigged = { ...decision, action: "quarantine-rewards" as const };
  assert.deepEqual(validateEnforcementDecision(rigged, policy(), verdict()), {
    ok: false,
    code: "action-not-policy-driven",
  });

  // A structurally broken decision is refused.
  const forged = { ...decision, decidedBy: "game-declared" } as unknown as IntegrityEnforcementDecision;
  assert.deepEqual(validateEnforcementDecision(forged, policy(), verdict()), {
    ok: false,
    code: "malformed-decision",
  });
});

test("enforcement: decisions are readonly data (E1 compile check)", () => {
  const outcome = decideEnforcement(decisionId, policy(), verdict());
  assert.ok(outcome.decided);
  if (!outcome.decided) return;
  // @ts-expect-error — E1: contract fields are readonly
  outcome.decision.action = "no-action";
  assert.equal(outcome.decision.decisionId, decisionId);
});
