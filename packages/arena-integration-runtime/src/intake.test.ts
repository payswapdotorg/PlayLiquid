import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaAuthorizationScope, arenaAuthorizationScopeKey } from "@playliquid/arena-integration";
import { checkArenaEscalationRequestCoherence } from "../src/escalation-request.ts";
import { arenaDecisionDigestOf } from "../src/digest.ts";
import { openArenaEscalationCase, registerEscalationSource } from "../src/intake.ts";
import type { ArenaEscalationCommand } from "../src/records.ts";
import {
  createArenaRuntimeJourney,
  createSteppingClock,
  fixtureAskDigest,
  fixtureGapFinding,
  fixtureGapSummary,
  fixtureWalkedGapRecord,
} from "../src/fakes.ts";
import { asTimestampMs } from "@playliquid/lab-contracts";
import { asTenantId } from "@playliquid/platform-contracts";
import { asSubjectId } from "@playliquid/platform-contracts";
import { gapFindingDigestOf } from "@playliquid/lab-organization";
import type { ArenaRuntimeService } from "../src/service.ts";
import type { ArenaRuntimeJourney } from "../src/fakes.ts";
/**
 * INTAKE TESTS (PL-031, R18/E8) — the admission oracle's total surface:
 * registration validation, the decided-escalation gate (never
 * auto-escalated), source resolution, the rung gate, envelope coherence and
 * the ACR-bridged request record.
 */

function freshService(): { service: ArenaRuntimeService; journey: ArenaRuntimeJourney } {
  const journey = createArenaRuntimeJourney();
  return { service: journey.service, journey };
}

function commandFor(journey: ArenaRuntimeJourney, overrides: Partial<Omit<ArenaEscalationCommand, "sourceKey">> = {}): ArenaEscalationCommand {
  return journey.decidedCommand(overrides);
}

test("intake: a decided escalation opens a content-addressed case with a coherent ACR-bridged request", () => {
  const { service, journey } = freshService();
  const command = commandFor(journey);
  const opened = service.openEscalationCase(journey.caller, command);
  assert.ok(opened.ok);
  assert.equal(opened.duplicate, false);
  assert.equal(opened.case.lifecycle.state, "draft");
  assert.match(String(opened.case.caseId), /^arena-case-[0-9a-f]{52}$/);
  assert.match(String(opened.case.request.escalationId), /^arena-esc-[0-9a-f]{52}$/);
  assert.equal(opened.case.request.external, "arena-external");
  // The correlation pin: the ref's requestDigest is the envelope's payload digest.
  assert.equal(`sha256:${String(opened.case.request.requestDigest)}`, String(opened.case.request.cycle.requestPayload));
  const coherence = checkArenaEscalationRequestCoherence(opened.case.request);
  assert.deepEqual(coherence, { coherent: true });
});

test("intake: re-running the same decided escalation resumes the SAME case (E6/E10)", () => {
  const { service, journey } = freshService();
  const first = service.openEscalationCase(journey.caller, commandFor(journey));
  const second = service.openEscalationCase(journey.caller, commandFor(journey));
  const third = service.openEscalationCase(journey.caller, commandFor(journey, { decidedAt: asTimestampMs(12_005)! }));
  assert.ok(first.ok && second.ok && third.ok);
  assert.equal(second.duplicate, true);
  assert.equal(second.case.caseId, first.case.caseId);
  assert.equal(third.duplicate, true, "decision bookkeeping is excluded from the case content key");
});

test("intake: registration validates gap records through lab-contracts' own oracle", () => {
  const journey = createArenaRuntimeJourney();
  const caller = journey.caller;
  const service = journey.service;
  const walked = fixtureWalkedGapRecord("valid");
  assert.ok(service.registerSource(caller, { kind: "gap-record", record: walked }).ok);
  // A record that skips rungs is refused by lab-contracts' ladder authority.
  const skipped = { ...walked, attempts: [{ rung: "alternate-organization" as const, disposition: "unavailable" as const, outcome: "unresolved" as const }] };
  const refused = service.registerSource(caller, { kind: "gap-record", record: skipped });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, "invalid-source");
  // Duplicate registration is an idempotent receipt.
  const again = service.registerSource(caller, { kind: "gap-record", record: walked });
  assert.ok(again.ok);
  if (again.ok) assert.equal(again.duplicate, true);
});

test("intake: UN-DECIDED auto-escalation is refused — the runtime never escalates without a host decision", () => {
  const { service, journey } = freshService();
  const command = commandFor(journey);
  const tampered = { ...command, decisionDigest: fixtureAskDigest("not-the-decision") };
  const refused = service.openEscalationCase(journey.caller, tampered);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "tampered-decision-digest");
    assert.match(refused.detail, /E8/);
  }
  // A structurally invalid decision digest is an UNDECIDED escalation.
  const undecided = service.openEscalationCase(journey.caller, { ...command, decisionDigest: "not-a-digest" as ArenaEscalationCommand["decisionDigest"] });
  assert.equal(undecided.ok, false);
  if (!undecided.ok) assert.equal(undecided.code, "undecided-escalation");
  // No case was opened by either refusal.
  assert.equal(service.listCases(journey.caller).length, 0);
});

test("intake: an UNKNOWN gap-finding source is refused", () => {
  const { service, journey } = freshService();
  const base = commandFor(journey);
  const unknownKey = "arena-src-0000000000000000000000000000000000000000000000000000" as ArenaEscalationCommand["sourceKey"];
  const command: ArenaEscalationCommand = {
    ...base,
    sourceKey: unknownKey,
    decisionDigest: arenaDecisionDigestOf({
      tenant: String(journey.caller.tenant),
      decidedBy: String(base.decidedBy),
      decidedAt: base.decidedAt,
      sourceKey: String(unknownKey),
      requestKind: base.requestKind,
      requestPayload: String(base.requestPayload),
      endpointDigest: String(base.endpoint.endpointDigest),
      authorizationKey: arenaAuthorizationScopeKey(base.authorization),
    }),
  };
  const refused = service.openEscalationCase(journey.caller, command);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, "unknown-source");
});

test("intake: a tampered registered source is refused (E8)", () => {
  const tenant = asTenantId("tenant-alpha")!;
  const walked = fixtureWalkedGapRecord("tamper-source");
  const registered = registerEscalationSource(tenant, { kind: "gap-record", record: walked }, []);
  assert.ok(registered.ok);
  if (!registered.ok) return;
  const command: ArenaEscalationCommand = {
    decidedBy: asSubjectId("operator-1")!,
    decidedAt: walked.openedAt,
    decisionDigest: arenaDecisionDigestOf({
      tenant: String(tenant),
      decidedBy: "operator-1",
      decidedAt: walked.openedAt,
      sourceKey: String(registered.source.sourceKey),
      requestKind: "result",
      requestPayload: String(fixtureAskDigest("ask")),
      endpointDigest: String(journeyEndpoint().endpointDigest),
      authorizationKey: "",
    }),
    sourceKey: registered.source.sourceKey,
    requestKind: "result",
    requestPayload: fixtureAskDigest("ask"),
    endpoint: journeyEndpoint(),
    authorization: arenaAuthorizationScope([]),
  };
  const tamperedSource = { ...registered.source, record: { ...walked, missingCapability: "mutated-capability" } };
  const refused = openArenaEscalationCase(tenant, command, { sources: [tamperedSource], cases: [] });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, "tampered-source");
});

function journeyEndpoint() {
  return createArenaRuntimeJourney().endpoint;
}

test("intake: RUNG-MISMATCH — escalating a non-Arena rung is refused (Arena is never a first resort)", () => {
  const tenant = asTenantId("tenant-alpha")!;
  const caller = { tenant, subject: asSubjectId("operator-1")! };
  const service = createArenaRuntimeJourney().service;
  // A gap record that only reached the ALTERNATE-ORGANIZATION rung.
  const early = { ...fixtureWalkedGapRecord("early"), attempts: [
    { rung: "existing-organization" as const, disposition: "unavailable" as const, outcome: "unresolved" as const },
    { rung: "alternate-organization" as const, disposition: "unavailable" as const, outcome: "unresolved" as const },
  ] };
  const registered = service.registerSource(caller, { kind: "gap-record", record: early });
  assert.ok(registered.ok);
  if (!registered.ok) return;
  const command = service.openEscalationCase(caller, {
    decidedBy: caller.subject,
    decidedAt: early.openedAt,
    decisionDigest: arenaDecisionDigestOf({
      tenant: String(caller.tenant),
      decidedBy: String(caller.subject),
      decidedAt: early.openedAt,
      sourceKey: String(registered.source.sourceKey),
      requestKind: "result",
      requestPayload: String(fixtureAskDigest("ask-early")),
      endpointDigest: String(journeyEndpoint().endpointDigest),
      authorizationKey: "",
    }),
    sourceKey: registered.source.sourceKey,
    requestKind: "result",
    requestPayload: fixtureAskDigest("ask-early"),
    endpoint: journeyEndpoint(),
    authorization: arenaAuthorizationScope([]),
  });
  assert.equal(command.ok, false);
  if (!command.ok) {
    assert.equal(command.code, "rung-mismatch");
    assert.match(command.detail, /R18/);
  }
  // A RESOLVED summary and a BLOCKED summary are both registered but both
  // fail the rung gate at intake (the negative assertions live in the
  // tenancy/rung suites; here the registrations themselves must hold).
  const resolved = service.registerSource(caller, { kind: "gap-summary", summary: { ...fixtureGapSummary(), resolved: true } });
  assert.ok(resolved.ok);
  const blocked = service.registerSource(caller, { kind: "gap-summary", summary: { ...fixtureGapSummary(), blocked: true, currentRung: "blocked", reachedRungs: [...fixtureGapSummary().reachedRungs, "blocked"], rungAttemptCounts: [...fixtureGapSummary().rungAttemptCounts, { rung: "blocked", attempts: 1 }] } });
  assert.ok(blocked.ok);
  if (blocked.ok) {
    const blockedCommand = service.openEscalationCase(caller, {
      decidedBy: caller.subject,
      decidedAt: fixtureWalkedGapRecord("x").openedAt,
      decisionDigest: arenaDecisionDigestOf({
        tenant: String(caller.tenant),
        decidedBy: String(caller.subject),
        decidedAt: fixtureWalkedGapRecord("x").openedAt,
        sourceKey: String(blocked.source.sourceKey),
        requestKind: "result",
        requestPayload: String(fixtureAskDigest("ask-blocked")),
        endpointDigest: String(journeyEndpoint().endpointDigest),
        authorizationKey: "",
      }),
      sourceKey: blocked.source.sourceKey,
      requestKind: "result",
      requestPayload: fixtureAskDigest("ask-blocked"),
      endpoint: journeyEndpoint(),
      authorization: arenaAuthorizationScope([]),
    });
    assert.equal(blockedCommand.ok, false);
    if (!blockedCommand.ok) {
      assert.equal(blockedCommand.code, "rung-mismatch");
      assert.match(blockedCommand.detail, /terminal/);
    }
  }
});

test("intake: INVALID-ENVELOPE — artifact kinds without an authorizing scope are refused", () => {
  const { service, journey } = freshService();
  const command = commandFor(journey, {
    requestKind: "artifact.skill",
    authorization: arenaAuthorizationScope([]),
  });
  const refused = service.openEscalationCase(journey.caller, command);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "invalid-envelope");
    assert.deepEqual(refused.envelopeReasons, ["artifact-scope-missing"]);
  }
});

test("intake: INVALID-ENVELOPE — a request payload colliding with the gap summary is refused", () => {
  const { service, journey } = freshService();
  const caller = journey.caller;
  const source = service.listSources(caller)[0]!;
  assert.ok(source && source.kind === "gap-finding");
  const colliding = gapFindingDigestOf({
    tenant: String(caller.tenant),
    missingCapability: source.finding.missingCapability,
    candidateDigest: source.finding.candidateDigest,
  });
  const refused = service.openEscalationCase(caller, {
    ...commandFor(journey),
    requestPayload: colliding,
    decisionDigest: arenaDecisionDigestOf({
      tenant: String(caller.tenant),
      decidedBy: String(caller.subject),
      decidedAt: 12_000,
      sourceKey: String(source.sourceKey),
      requestKind: "result",
      requestPayload: String(colliding),
      endpointDigest: String(journey.endpoint.endpointDigest),
      authorizationKey: "",
    }),
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "invalid-envelope");
    assert.deepEqual(refused.envelopeReasons, ["payload-gap-summary-collision"]);
  }
});

test("intake: an invalid command shape is refused (total oracle, never throws)", () => {
  const { service, journey } = freshService();
  const base = commandFor(journey);
  const refused = service.openEscalationCase(journey.caller, { ...base, decidedBy: "NOT A VALID ID" as ArenaEscalationCommand["decidedBy"] });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, "invalid-command");
  const badExpiry = service.openEscalationCase(journey.caller, { ...base, expiresAt: base.decidedAt });
  assert.equal(badExpiry.ok, false);
  if (!badExpiry.ok) assert.equal(badExpiry.code, "invalid-command");
  const garbage = service.openEscalationCase(journey.caller, null as unknown as ArenaEscalationCommand);
  assert.equal(garbage.ok, false);
});

test("intake: the ACR bridge coherence oracle refuses a mismatched digest pin", () => {
  const { service, journey } = freshService();
  const opened = service.openEscalationCase(journey.caller, commandFor(journey));
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const request = opened.case.request;
  const mismatched = { ...request, requestDigest: fixtureAskDigest("other") };
  const verdict = checkArenaEscalationRequestCoherence(mismatched);
  assert.deepEqual(verdict, { coherent: false, reasons: ["digest-pin-mismatch"] });
  const malformed = checkArenaEscalationRequestCoherence({ ...request, external: "somewhere-else" });
  assert.equal(malformed.coherent, false);
  if (!malformed.coherent) assert.equal(malformed.reasons[0], "malformed-escalation-ref");
});

test("intake: sources register across all three kinds with idempotent receipts", () => {
  const caller = { tenant: asTenantId("tenant-beta")!, subject: asSubjectId("op-2")! };
  const service = createArenaRuntimeJourney().service;
  const walked = fixtureWalkedGapRecord("multi");
  const finding = fixtureGapFinding(walked);
  const first = service.registerSource(caller, { kind: "gap-finding", finding, record: walked });
  const second = service.registerSource(caller, { kind: "gap-record", record: walked });
  const third = service.registerSource(caller, { kind: "gap-summary", summary: fixtureGapSummary() });
  assert.ok(first.ok && second.ok && third.ok);
  const dup = service.registerSource(caller, { kind: "gap-summary", summary: fixtureGapSummary() });
  assert.ok(dup.ok);
  if (dup.ok) assert.equal(dup.duplicate, true);
  assert.equal(service.listSources(caller).length, 3);
});

test("intake: deterministic fixtures — same seeds, same identities (E9)", () => {
  const clock = createSteppingClock(1_000);
  assert.equal(clock.now(), 1_000);
  assert.equal(clock.now(), 1_001);
  assert.deepEqual(fixtureWalkedGapRecord("seed-a"), fixtureWalkedGapRecord("seed-a"));
  assert.equal(String(fixtureWalkedGapRecord("seed-a").gapId), String(fixtureWalkedGapRecord("seed-a").gapId));
});
