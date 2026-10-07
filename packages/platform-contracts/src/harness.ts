/**
 * Runtime pure-check harness (PL-004 evidence).
 *
 * Run with: `node src/harness.ts` (Node >= 24 type stripping).
 * Assembles a synthetic platform policy declaration at runtime from
 * fragments, validates it with the pure cross-capability validator, then
 * exercises each PL-004 keystone contract with deliberately hostile
 * inputs. Prints deterministic outputs — real runtime evidence that the
 * pure contract functions work. No assertions; those live in tests.
 */

import { asGameId } from "@playliquid/game-contracts";
import { asTenantId, asSubjectId, asContentDigest, asTimestampMs } from "./primitives.ts";
import { asGameEventKind } from "./events.ts";
import { checkTenantIsolation, checkLeastPrivilege } from "./tenancy.ts";
import { validateScoreRecord, rankLeaderboardEntries, asLeaderboardId } from "./leaderboard.ts";
import { decideAdmission, validatePlatformOutcome, asMatchSessionId } from "./multiplayer.ts";
import { authorizeReplayAccess, asReplayId } from "./replay.ts";
import { settleGrant, issueRewards } from "./entitlements.ts";
import { asEntitlementGrantId } from "./entitlements.ts";
import { assessModerationReport, asModerationReportId, requiredEvidenceCount } from "./moderation.ts";
import {
  aggregateIntegritySignals,
  validateIntegrityReport,
  asIntegrityReportId,
} from "./integrity.ts";
import { validateCapabilityPolicy } from "./policy.ts";
import type { PlatformPolicyDeclaration } from "./policy.ts";
import type { EntitlementGrant } from "./entitlements.ts";
import type { ModerationReport } from "./moderation.ts";
import type { IntegrityReport, IntegritySignal } from "./integrity.ts";
import type { LeaderboardEntry } from "./leaderboard.ts";
// PL-009 refinement surface.
import { asEvidenceRecordId } from "./integrity-evidence.ts";
import { asIntegrityVerdictId, validateIntegrityRiskVerdict } from "./integrity-verdicts.ts";
import { decideEnforcement, asEnforcementDecisionId, asIntegrityEnforcementPolicyId } from "./integrity-enforcement.ts";
import { openEntitlementLifecycle, admitLifecycleCommand } from "./entitlement-lifecycle.ts";
import { asTypedKernelValueReading } from "./economy-values.ts";
import { validateSettlement, admitSettlement, asSettlementId } from "./settlement.ts";
import { authorizeReplayLaneRequest } from "./replay-lanes.ts";
import { validateExpectationResult, asQaExpectationId, asQaExpectationResultId } from "./qa-assertions.ts";
import type { IntegrityRiskVerdict } from "./integrity-verdicts.ts";
import type { IntegrityEnforcementPolicy } from "./integrity-enforcement.ts";
import type { SettlementEligibilityDeclaration } from "./settlement.ts";
import type { ReplayExpectation, ReplayExpectationResult } from "./qa-assertions.ts";

const game = asGameId("game-harness")!;
const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const subject = asSubjectId("player-one")!;
const matchCompleted = asGameEventKind("match.completed")!;

// Evidence digests assembled at runtime from fragments (never literals).
const digest = asContentDigest(["0f", "1e"].join("") + "a".repeat(60))!;
const otherDigest = asContentDigest(["2b", "3c"].join("") + "b".repeat(60))!;

const policy: PlatformPolicyDeclaration = {
  game,
  capabilities: [
    { capability: "leaderboard", required: true, policy: { metric: "score", ordering: "descending", scope: "global" } },
    {
      capability: "multiplayer",
      required: true,
      policy: { topology: "authoritative-server", maxPlayersPerSession: 8, sessionModel: "matchmade" },
    },
    { capability: "replay", required: true, policy: { capture: "intent-log", determinismRequired: true, consumers: ["qa", "integrity"] } },
    { capability: "rewards", required: true, policy: { mode: "entitlement", settlement: "platform", clientAuthoritative: false } },
  ],
  events: [
    { kind: matchCompleted, summary: "A match finished with authoritative standings." },
  ],
  bindings: [
    { capability: "leaderboard", eventKind: matchCompleted, metric: "score", aggregation: "max" },
    { capability: "multiplayer", eventKind: matchCompleted, outcomeClassification: "protected" },
    { capability: "replay", eventKind: matchCompleted },
    {
      capability: "rewards",
      eventKind: matchCompleted,
      entitlementKind: "arena-coin",
      amount: 100,
      requiresAuthoritativeOutcome: true,
      minIntegrityConfidence: 0.75,
    },
  ],
  tenancy: { mode: "single-tenant", tenant: tenantA },
};

// 1. The valid synthetic policy passes.
const valid = validateCapabilityPolicy(policy);
console.log(`policy-valid: pass=${valid.pass} reasons=${valid.reasons.length}`);

// 2. A game trying to re-declare a platform authority event fails (lock 18).
const smuggled = {
  ...policy,
  events: [...policy.events, { kind: "platform.entitlement.granted", summary: "spoof" }],
} as unknown as PlatformPolicyDeclaration;
const attack = validateCapabilityPolicy(smuggled);
console.log(`policy-lock18: pass=${attack.pass} codes=[${attack.reasons.map((r) => r.code).join(",")}]`);

// 3. Cross-tenant access is a typed violation (R20).
const isolation = checkTenantIsolation({ tenant: tenantA }, { tenant: tenantB });
console.log(`tenant-isolation: ok=${isolation.ok} violation=${isolation.ok ? "none" : isolation.violation}`);

// 4. Least privilege is default deny (R20).
const privilege = checkLeastPrivilege(
  { tenant: tenantA, subject, capability: "integrity", permission: "read" },
  [],
);
console.log(`least-privilege: ok=${privilege.ok} code=${privilege.ok ? "-" : privilege.code}`);

// 5. Client score claims never pass authority validation (R9/lock 19).
const scoreCheck = validateScoreRecord({
  leaderboard: "board-arena",
  claimedScore: 999_999,
  untrusted: "untrusted-client-input",
});
console.log(`score-admission: ok=${scoreCheck.ok} code=${scoreCheck.ok ? "-" : scoreCheck.code}`);

// 6. The platform ranks, games do not.
const board = asLeaderboardId("board-arena")!;
const entries: LeaderboardEntry[] = [
  { tenant: tenantA, leaderboard: board, subject, rank: 0, score: 100, achievedAt: asTimestampMs(300)!, integrityConfidence: 0.9 },
  { tenant: tenantA, leaderboard: board, subject: asSubjectId("player-two")!, rank: 0, score: 300, achievedAt: asTimestampMs(200)!, integrityConfidence: 0.9 },
];
const ranked = rankLeaderboardEntries(entries, "descending", "first-achieved");
console.log(`leaderboard-rank: top=${ranked[0]?.subject} score=${ranked[0]?.score}`);

// 7. Session admission refuses cross-tenant requests.
const admission = decideAdmission(
  { tenant: tenantA, session: asMatchSessionId("session-1")!, subject },
  { session: asMatchSessionId("session-1")!, tenant: tenantB, capacity: 8, enrolled: 0, admission: "open", invitedSubjects: [] },
);
console.log(`session-admission: admitted=${admission.admitted} code=${admission.admitted ? "-" : admission.code}`);

// 8. Outcomes without evidence chains never validate (lock 19).
const outcomeCheck = validatePlatformOutcome({
  tenant: tenantA,
  session: asMatchSessionId("session-1")!,
  decidedBy: "platform-authority",
  evidence: [],
  standings: [{ subject, rank: 1, score: 100, grants: [] }],
});
console.log(`outcome-evidence: ok=${outcomeCheck.ok} code=${outcomeCheck.ok ? "-" : outcomeCheck.code}`);

// 9. Replay access is denied to undeclared consumers (R8).
const replayCheck = authorizeReplayAccess(
  { tenant: tenantA, consumer: "lab" },
  {
    replayId: asReplayId("replay-1")!,
    tenant: tenantA,
    subject,
    capture: "intent-log",
    digest,
    consumers: ["qa", "integrity"],
    sealedBy: "platform-authority",
  },
);
console.log(`replay-access: granted=${replayCheck.granted} code=${replayCheck.granted ? "-" : replayCheck.code}`);

// 10. Double grants are rejected; the first receipt stands (R10).
const grant: EntitlementGrant = {
  grantId: asEntitlementGrantId("grant-1")!,
  tenant: tenantA,
  subject,
  entitlementKind: "arena-coin",
  amount: 100,
  causation: { sourceEventKind: matchCompleted, outcomeEvidence: digest },
  decidedBy: "platform-authority",
  idempotency: { subject, sourceOutcome: digest, entitlementKind: "arena-coin" },
};
const first = settleGrant(grant, []);
const replayGrant = settleGrant(grant, [grant]);
console.log(`grant-first: ${first.disposition}`);
console.log(`grant-replay: ${replayGrant.disposition}${replayGrant.disposition === "refused" ? ` code=${replayGrant.code}` : ""}`);

// 11. Issuance folds idempotency across a batch (R10).
const issuance = issueRewards({
  tenant: tenantA,
  outcomeEvidence: digest,
  grants: [grant, { ...grant, grantId: asEntitlementGrantId("grant-2")! }],
});
console.log(`issuance: issued=${issuance.issued.length} refused=${issuance.refused.map((r) => r.code).join(",")}`);

// 12. Critical moderation reports need double evidence (E8).
const report: ModerationReport = {
  reportId: asModerationReportId("report-1")!,
  tenant: tenantA,
  surface: "chat",
  severity: "critical",
  reportedSubject: asSubjectId("player-two")!,
  reporter: subject,
  evidence: [digest],
  summary: "Critical accusation with a single artifact.",
};
const moderationPolicy = { surfaces: ["chat"] as const, appealable: true, minEvidenceArtifacts: 1 };
const moderationCheck = assessModerationReport(report, moderationPolicy, []);
console.log(
  `moderation: required=${requiredEvidenceCount("critical", moderationPolicy)} disposition=${moderationCheck.disposition}` +
    `${moderationCheck.disposition === "rejected" ? ` code=${moderationCheck.code}` : ""}`,
);

// 13. Integrity reports are evidence/confidence, never certainty (R11/E11).
const signals: IntegritySignal[] = [
  {
    kind: "timing",
    weight: 0.6,
    riskContribution: 0.7,
    confidence: { level: 0.9, lowerBound: 0.5, upperBound: 0.8 },
    evidence: [{ source: "replay", replayId: asReplayId("replay-1")!, digest: otherDigest }],
  },
  {
    kind: "behavioral",
    weight: 0.4,
    riskContribution: 0.2,
    confidence: { level: 0.8, lowerBound: 0.1, upperBound: 0.6 },
    evidence: [{ source: "qa-run", runDigest: otherDigest }],
  },
];
const integrityReport: IntegrityReport = {
  reportId: asIntegrityReportId("ir-0001")!,
  tenant: tenantA,
  subject,
  playMode: "human",
  signals,
  aggregate: aggregateIntegritySignals(signals),
  enforcement: "report-only",
  decidedBy: "platform-authority",
};
const integrityCheck = validateIntegrityReport(integrityReport);
console.log(
  `integrity: ok=${integrityCheck.ok} risk=${integrityCheck.ok ? integrityCheck.riskScore.toFixed(2) : "-"}`,
);
const certainty = validateIntegrityReport({ ...integrityReport, verdict: "cheating" });
console.log(`integrity-certainty: ok=${certainty.ok} code=${certainty.ok ? "-" : certainty.code}`);

// ---------------------------------------------------------------------------
// PL-009 refinement exercises (runtime pure-check evidence)
// ---------------------------------------------------------------------------

const evidenceId = asEvidenceRecordId("ev-harness")!;
const verdict: IntegrityRiskVerdict = {
  verdictId: asIntegrityVerdictId("v-harness")!,
  tenant: tenantA,
  subject,
  reportRef: asIntegrityReportId("ir-0001")!,
  kind: "deviation-observed",
  risk: { riskScore: 0.62, confidence: { level: 0.9, lowerBound: 0.5, upperBound: 0.74 } },
  band: "moderate",
  evidence: [{ evidenceId, payloadDigest: otherDigest }],
  decidedBy: "platform-authority",
};

// 14. Verdicts stay probabilistic: isBot is unrepresentable (R11).
const verdictCheck = validateIntegrityRiskVerdict(verdict);
console.log(`verdict: ok=${verdictCheck.ok} kind=${verdictCheck.ok ? verdictCheck.kind : "-"}`);
const botClaim = validateIntegrityRiskVerdict({ ...verdict, isBot: true });
console.log(`verdict-isBot: ok=${botClaim.ok} code=${botClaim.ok ? "-" : botClaim.code}`);

// 15. Enforcement is policy-driven and cites evidence + policy (audit chain).
const enforcementPolicy: IntegrityEnforcementPolicy = {
  policyId: asIntegrityEnforcementPolicyId("enforce-harness")!,
  tenant: tenantA,
  rules: [{ minSeverity: "deviation-observed", minBand: "moderate", action: "flag-for-review" }],
};
const enforcement = decideEnforcement(asEnforcementDecisionId("decision-harness")!, enforcementPolicy, verdict);
console.log(
  `enforcement: decided=${enforcement.decided} action=${enforcement.decided ? enforcement.decision.action : "-"} policy=${enforcement.decided ? enforcement.decision.policyRef : "-"}`,
);
const unevidenced = decideEnforcement(asEnforcementDecisionId("decision-x")!, enforcementPolicy, {
  ...verdict,
  evidence: [],
});
console.log(`enforcement-no-evidence: decided=${unevidenced.decided} code=${unevidenced.decided ? "-" : unevidenced.code}`);

// 16. The entitlement lifecycle: grant -> hold -> settle, idempotent commands.
const lifecycle = openEntitlementLifecycle({
  entitlement: asEntitlementGrantId("grant-harness")!,
  tenant: tenantA,
  subject,
});
const holdResult = admitLifecycleCommand(
  {
    command: "hold",
    key: { entitlement: asEntitlementGrantId("grant-harness")!, operation: "hold", attempt: "1" },
    entitlement: asEntitlementGrantId("grant-harness")!,
    against: "granted",
    holdCauseDigest: digest,
  },
  lifecycle,
);
console.log(`lifecycle-hold: ok=${holdResult.ok} state=${holdResult.ok ? holdResult.record.state : "-"}`);
const holdReplay = admitLifecycleCommand(
  {
    command: "hold",
    key: { entitlement: asEntitlementGrantId("grant-harness")!, operation: "hold", attempt: "1" },
    entitlement: asEntitlementGrantId("grant-harness")!,
    against: "granted",
    holdCauseDigest: digest,
  },
  holdResult.ok ? holdResult.record : lifecycle,
);
console.log(`lifecycle-replay: ok=${holdReplay.ok} code=${holdReplay.ok ? "-" : holdReplay.code}`);

// 17. Settlement validates declared, authoritative, shape-pinned occurrences.
const declaredShape = asContentDigest(["aa", "bb"].join("") + "c".repeat(60))!;
const settlementRule: SettlementEligibilityDeclaration = {
  capability: "rewards",
  eventKind: matchCompleted,
  entitlementKind: "arena-coin",
  requiresAuthoritativeOutcome: true,
  minIntegrityConfidence: 0.75,
  valueShapeDigest: declaredShape,
};
const settlementValue = asTypedKernelValueReading("int", declaredShape, digest)!;
const settlementCheck = validateSettlement(
  {
    tenant: tenantA,
    subject,
    eventKind: matchCompleted,
    sourceEventDigest: digest,
    value: settlementValue,
    outcomeEvidence: digest,
    outcomeDecidedBy: "platform-authority",
    integrityConfidence: 0.9,
  },
  [settlementRule],
);
console.log(`settlement-validate: ok=${settlementCheck.ok} code=${settlementCheck.ok ? "-" : settlementCheck.code}`);
const settlementRecord = {
  settlementId: asSettlementId("settle-harness")!,
  tenant: tenantA,
  subject,
  entitlement: asEntitlementGrantId("grant-harness")!,
  lifecycle: "settled" as const,
  value: settlementValue,
  sourceEventKind: matchCompleted,
  sourceEventDigest: digest,
  outcomeEvidence: digest,
  ruleRef: { eventKind: matchCompleted, entitlementKind: "arena-coin" },
  decidedBy: "platform-authority" as const,
  recordedAt: asTimestampMs(1)!,
};
const settlementAdmission = admitSettlement(settlementRecord, []);
console.log(`settlement-admit: ok=${settlementAdmission.ok}`);
const settlementDouble = admitSettlement(settlementRecord, [settlementRecord]);
console.log(`settlement-double: ok=${settlementDouble.ok} code=${settlementDouble.ok ? "-" : settlementDouble.code}`);

// 18. Replay lanes: typed views; the player lane is own-subject scoped (R8).
const laneArtifact = {
  replayId: asReplayId("replay-1")!,
  tenant: tenantA,
  subject,
  capture: "intent-log" as const,
  digest,
  consumers: ["player", "qa", "integrity", "simulation", "lab"] as const,
  sealedBy: "platform-authority" as const,
};
const playerLane = authorizeReplayLaneRequest(
  { lane: "player", tenant: tenantA, requester: asSubjectId("player-two")!, replayId: asReplayId("replay-1")! },
  laneArtifact,
);
console.log(`lane-player-snoop: granted=${playerLane.granted} code=${playerLane.granted ? "-" : playerLane.code}`);
const labLane = authorizeReplayLaneRequest(
  { lane: "lab", tenant: tenantA, replayId: asReplayId("replay-1")!, studyRef: digest },
  laneArtifact,
);
console.log(
  `lane-lab: granted=${labLane.granted} view=${labLane.granted ? labLane.view.view : "-"}`,
);

// 19. QA expectations: honest outcomes with digest-pinned evidence (E11).
const expectation: ReplayExpectation = {
  expectationId: asQaExpectationId("qa-exp-harness")!,
  tenant: tenantA,
  replayRef: asReplayId("replay-1")!,
  replayDigest: digest,
  kind: "determinism-holds",
  expectationDigest: otherDigest,
};
const expectationResult: ReplayExpectationResult = {
  resultId: asQaExpectationResultId("qa-res-harness")!,
  expectationRef: asQaExpectationId("qa-exp-harness")!,
  tenant: tenantA,
  replayDigest: digest,
  outcome: "inconclusive",
  evidenceDigest: otherDigest,
  decidedBy: "platform-authority",
};
const qaCheck = validateExpectationResult(expectationResult, expectation);
console.log(`qa-expectation: ok=${qaCheck.ok} outcome=${qaCheck.ok ? qaCheck.outcome : "-"}`);
