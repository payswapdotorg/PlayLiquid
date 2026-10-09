/**
 * Pure admission oracle tests: every typed refusal code of the intake
 * oracle and the workflow/qualification oracle (E8 negative coverage).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adjudicateSubmission, adjudicateTransition } from "./admission.ts";
import type { SubmitContributionCommand, SubmissionFacts, TransitionFacts } from "./admission.ts";
import type { ContributionRecord } from "./records.ts";
import { asContributionId } from "./records.ts";
import { computeDigest } from "@playliquid/package-system";
import { fakeGapLink, fakeLineageNode, fakePayload, ids, at } from "./fakes.ts";

const tenant = ids.tenant("tenant-alpha");
const tenantB = ids.tenant("tenant-beta");
const contributor = ids.subject("player-one");
const maintainer = ids.subject("mod-one");
const policy = { maxOpenContributionsPerContributor: 2 };

function facts(over: Partial<SubmissionFacts> = {}): SubmissionFacts {
  return {
    contributorExists: true,
    contributorTenant: tenant,
    submissionSeen: false,
    openContributionsOfContributor: 0,
    gap: undefined,
    ...over,
  };
}

function command(over: Partial<SubmitContributionCommand> = {}): SubmitContributionCommand {
  return {
    tenant,
    contributor,
    kind: "code",
    payload: fakePayload({ title: "fix" }),
    provenance: { origin: { kind: "original" }, aiGenerated: false },
    ...over,
  };
}

test("admission: a well-formed submission is accepted", () => {
  assert.deepEqual(adjudicateSubmission(command(), policy, facts()), { accepted: true });
});

test("admission: every intake refusal code is reachable and typed", () => {
  const cases: { readonly over?: Partial<SubmitContributionCommand>; readonly facts?: Partial<SubmissionFacts>; readonly code: string }[] = [
    { over: { tenant: "BAD TENANT" as never }, code: "invalid-tenant" },
    { over: { contributor: "BAD SUBJECT" as never }, code: "invalid-contributor" },
    { over: { kind: "feature" as never }, code: "invalid-kind" },
    { over: { payload: { kind: "nope" } as unknown as SubmitContributionCommand["payload"] }, code: "invalid-payload" },
    { over: { provenance: { origin: { kind: "weird" } as never, aiGenerated: false } }, code: "invalid-provenance" },
    { over: { provenance: { origin: { kind: "lineage-derived", base: { coordinate: fakeLineageNode("b").coordinate, nodeId: computeDigest({ forged: 1 }) } }, aiGenerated: false } }, code: "invalid-lineage-node" },
    { over: { provenance: { origin: { kind: "original" }, aiGenerated: true, modelProvenance: [] } }, code: "ai-disclosure-missing" },
    { over: { gap: { gapId: "gap 1" as never, cycleId: "cycle-1" as never } }, code: "invalid-gap-link" },
    { facts: { contributorExists: false }, code: "unknown-contributor" },
    { facts: { contributorTenant: tenantB }, code: "cross-tenant-contributor" },
    { over: { gap: fakeGapLink("gap-9", "cycle-9") }, facts: { gap: { exists: false, resolved: false, blocked: false, communityRungReached: false } }, code: "unknown-gap" },
    { over: { gap: fakeGapLink("gap-9", "cycle-9") }, facts: { gap: { exists: true, resolved: true, blocked: false, communityRungReached: true } }, code: "gap-not-open" },
    { over: { gap: fakeGapLink("gap-9", "cycle-9") }, facts: { gap: { exists: true, resolved: false, blocked: true, communityRungReached: true } }, code: "gap-not-open" },
    { over: { gap: fakeGapLink("gap-9", "cycle-9") }, facts: { gap: { exists: true, resolved: false, blocked: false, communityRungReached: false } }, code: "gap-not-at-community-rung" },
    { facts: { openContributionsOfContributor: 2 }, code: "contributor-quota-full" },
    { facts: { submissionSeen: true }, code: "duplicate-contribution" },
  ];
  for (const testCase of cases) {
    const result = adjudicateSubmission(command(testCase.over ?? {}), policy, facts(testCase.facts));
    assert.ok(!result.accepted, `${testCase.code} should refuse`);
    assert.equal(result.code, testCase.code, `expected ${testCase.code}, got ${JSON.stringify(result)}`);
  }
});

function record(over: Partial<ContributionRecord> = {}): ContributionRecord {
  const contributionId = asContributionId(computeDigest({ fixture: "record" }))!;
  return {
    contributionId,
    tenant,
    contributor,
    kind: "code",
    payload: fakePayload({ title: "fix" }),
    provenance: {
      contributor,
      origin: { kind: "original" },
      contentDigest: contributionId,
      aiGenerated: false,
      modelProvenance: [],
    },
    status: "under-review",
    submittedAt: at(1),
    decidedBy: "platform-authority",
    ...over,
  };
}

function transitionFacts(over: Partial<TransitionFacts> = {}): TransitionFacts {
  return {
    record: record(),
    actorTenant: tenant,
    actorIsMaintainer: true,
    lineageBase: undefined,
    ...over,
  };
}

test("admission: accept is admitted for an original provenance under review", () => {
  const result = adjudicateTransition(
    { tenant, contributionId: record().contributionId, kind: "accept", actor: maintainer },
    transitionFacts(),
  );
  assert.deepEqual(result, { accepted: true, to: "accepted" });
});

test("admission: every workflow refusal code is reachable and typed", () => {
  const id = record().contributionId;
  const lineageRecord = record({
    provenance: {
      contributor,
      origin: { kind: "lineage-derived", base: fakeLineageNode("base-pack") },
      contentDigest: id,
      aiGenerated: false,
      modelProvenance: [],
    },
  });
  const cases: { readonly kind: string; readonly facts: Partial<TransitionFacts>; readonly code: string; readonly recordOverride?: ContributionRecord }[] = [
    { kind: "triage", facts: { record: undefined }, code: "unknown-contribution" },
    { kind: "triage", facts: { record: record({ tenant: tenantB }) }, code: "cross-tenant-actor" },
    { kind: "triage", facts: { actorTenant: tenantB }, code: "cross-tenant-actor" },
    { kind: "triage", facts: { actorIsMaintainer: false }, code: "not-a-maintainer" },
    { kind: "withdraw", facts: {}, code: "not-the-contributor" },
    { kind: "triage", facts: { record: record({ status: "triaged" }) }, code: "invalid-transition" },
    { kind: "accept", facts: { record: lineageRecord, lineageBase: undefined }, code: "unknown-lineage-base" },
    { kind: "accept", facts: { record: lineageRecord, lineageBase: { published: false, provenancePasses: false } }, code: "unknown-lineage-base" },
    { kind: "accept", facts: { record: lineageRecord, lineageBase: { published: true, provenancePasses: false } }, code: "lineage-base-unqualified" },
    { kind: "reopen", facts: {}, code: "invalid-command" },
  ];
  for (const testCase of cases) {
    const explicitRecord = "record" in testCase.facts ? testCase.facts.record : (testCase.recordOverride ?? record());
    const factsUsed = transitionFacts({ ...testCase.facts, record: explicitRecord });
    const result = adjudicateTransition(
      { tenant, contributionId: (factsUsed.record ?? record()).contributionId, kind: testCase.kind as never, actor: maintainer },
      factsUsed,
    );
    assert.ok(!result.accepted, `${testCase.code} should refuse`);
    assert.equal(result.code, testCase.code, `expected ${testCase.code}, got ${JSON.stringify(result)}`);
  }
});

test("admission: withdraw is the contributor's own right from under-review", () => {
  const current = record({ status: "under-review" });
  const result = adjudicateTransition(
    { tenant, contributionId: current.contributionId, kind: "withdraw", actor: contributor },
    transitionFacts({ record: current, actorTenant: tenant, actorIsMaintainer: false }),
  );
  assert.deepEqual(result, { accepted: true, to: "withdrawn" });
});

test("admission: a maintainer withdraw is refused even with maintainer facts", () => {
  const current = record({ status: "under-review" });
  const result = adjudicateTransition(
    { tenant, contributionId: current.contributionId, kind: "withdraw", actor: maintainer },
    transitionFacts({ record: current }),
  );
  assert.ok(!result.accepted);
  assert.equal(result.code, "not-the-contributor");
});

test("admission: reasons are bounded", () => {
  const current = record();
  const result = adjudicateTransition(
    { tenant, contributionId: current.contributionId, kind: "accept", actor: maintainer, reason: "x".repeat(600) },
    transitionFacts({ record: current }),
  );
  assert.ok(!result.accepted);
  assert.equal(result.code, "reason-too-long");
});

test("admission: terminal contributions refuse every command kind", () => {
  for (const status of ["accepted", "rejected", "withdrawn"] as const) {
    for (const kind of ["triage", "review", "accept", "reject", "withdraw"] as const) {
      const current = record({ status });
      const actor = kind === "withdraw" ? contributor : maintainer;
      const result = adjudicateTransition(
        { tenant, contributionId: current.contributionId, kind, actor },
        transitionFacts({ record: current, actorTenant: tenant, actorIsMaintainer: kind !== "withdraw" }),
      );
      assert.ok(!result.accepted, `${status} + ${kind} must refuse`);
      assert.equal(result.code, "invalid-transition");
    }
  }
});
