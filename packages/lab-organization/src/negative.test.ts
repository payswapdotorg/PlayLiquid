/**
 * THE E8 NEGATIVE BATTERY (PL-029) — every typed refusal, one file:
 *
 * 1. malformed organization descriptors are refused at the compile and
 *    evaluation doors (never throws);
 * 2. dimension-bound violations are refused at search open (E8);
 * 3. unresolvable body/tool/capability references are typed refusals;
 * 4. invalid request surfaces (tenant/owner/cycle/time/seed/context/
 *    current organization/restriction) are refused;
 * 5. cursor discipline: unknown search, invalid cursor, foreign-space
 *    cursor, regressed cursor, skipped-ahead cursor, past-the-end cursor,
 *    invalid page size;
 * 6. candidate positions are bounded;
 * 7. the lab-simulation port refusals surface with their typed codes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asAgentRoleId, asCapabilityId, asEvaluationSeed, asLabCycleId, asTimestampMs, generalistBaselineOrganization } from "@playliquid/lab-contracts";
import { asAgentId } from "@playliquid/game-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { evidenceBundleDigestOf, labFixtureContext, labFixtureCycleId, labFixtureEvidenceRecords, labFixtureGeneralistOrganization, labFixtureSuite } from "@playliquid/lab-simulation";
import { LabOrganizationService } from "./service.ts";
import type { OrganizationSearchRequest } from "./records.ts";
import type { SearchPageResult } from "./service-types.ts";
import { createLabOrganizationFakes, fixtureModelAssignment, fixtureToolRef } from "./fakes.ts";

const tenant = asTenantId("tenant-negative")!;
const owner = asSubjectId("subject-negative-owner")!;
const caller = { tenant, subject: owner };
const evidence = labFixtureEvidenceRecords();
const evidenceBundle = {
  recordIds: evidence.map((record) => String(record.evidenceId)),
  declaredDigest: evidenceBundleDigestOf(evidence),
};
const parameters = { seed: asEvaluationSeed("seed-negative")!, tickBudget: 12 };

function request(over: Partial<OrganizationSearchRequest> = {}): OrganizationSearchRequest {
  return {
    tenant,
    owner,
    cycleId: asLabCycleId(String(labFixtureCycleId()))!,
    context: labFixtureContext(),
    bounds: {
      maxAgents: 2,
      roleVocabulary: [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!],
      bodyCatalog: [],
      modelCatalog: [fixtureModelAssignment("route-negative")],
      toolCatalog: [],
      capabilityVocabulary: [asCapabilityId("lab-cap-engineering")!],
    },
    seed: asEvaluationSeed("seed-negative-search")!,
    currentOrganization: labFixtureGeneralistOrganization(),
    requestedAt: asTimestampMs(1_000)!,
    ...over,
  };
}

function lab() {
  const fakes = createLabOrganizationFakes();
  return { fakes, service: new LabOrganizationService({ ports: fakes.ports }) };
}

test("negative: malformed descriptors are typed not-an-organization refusals (never throws)", () => {
  const { service } = lab();
  for (const malformed of [null, 17, "org", [], { id: 5 }]) {
    const compiled = service.compileOrganization({ descriptor: malformed, as: caller });
    assert.ok(!compiled.ok && compiled.code === "not-an-organization");
    const evaluated = service.evaluateOrganization({ descriptor: malformed, cycleId: labFixtureCycleId(), context: labFixtureContext(), suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
    assert.ok(!evaluated.ok && evaluated.code === "not-an-organization");
    assert.ok(evaluated.rejections !== undefined && evaluated.rejections.length > 0);
  }
});

test("negative: organization-invalid surfaces the compiler rejections (E8)", () => {
  const { service } = lab();
  const broken = { ...labFixtureGeneralistOrganization(), review: { gates: [] } };
  const result = service.evaluateOrganization({ descriptor: broken, cycleId: labFixtureCycleId(), context: labFixtureContext(), suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(!result.ok && result.code === "organization-invalid");
  assert.ok(result.rejections!.some((rejection) => rejection.detail.includes("no-review-gates")));
});

test("negative: an unresolvable body reference is refused at the evaluation door", () => {
  const { service } = lab();
  const baseline = labFixtureGeneralistOrganization();
  const withGhostBody = {
    ...baseline,
    agents: [{ ...baseline.agents[0]!, body: { bodyId: "avatar-ghost", revisionDigest: "0".repeat(64) } }],
  };
  const result = service.evaluateOrganization({ descriptor: withGhostBody, cycleId: labFixtureCycleId(), context: labFixtureContext(), suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(!result.ok && result.code === "unresolvable-body-reference");
});

test("negative: an out-of-vocabulary capability is refused at the evaluation door", () => {
  const { service } = lab();
  const baseline = labFixtureGeneralistOrganization();
  const withForeignCapability = {
    ...baseline,
    capabilities: [{ capability: asCapabilityId("cap-outside-vocabulary")!, assignedTo: [baseline.agents[0]!.agent] }],
  };
  const result = service.evaluateOrganization({
    descriptor: withForeignCapability,
    cycleId: labFixtureCycleId(),
    context: labFixtureContext(),
    suite: labFixtureSuite().ref,
    evidence: evidenceBundle,
    parameters,
    as: caller,
    capabilities: [asCapabilityId("lab-cap-engineering")!],
  });
  assert.ok(!result.ok && result.code === "unresolvable-capability-reference");
});

test("negative: dimension-bound violations are refused at search open (E8)", () => {
  const { service } = lab();
  const cases: readonly [Partial<OrganizationSearchRequest>, string][] = [
    [{ bounds: { ...request().bounds, maxAgents: 99 } }, "dimension-out-of-bounds"],
    [{ bounds: { ...request().bounds, roleVocabulary: [] } }, "empty-role-vocabulary"],
    [{ bounds: { ...request().bounds, modelCatalog: [] } }, "empty-model-catalog"],
    [{ bounds: { ...request().bounds, bodyCatalog: [{ bodyId: "avatar-ghost", revisionDigest: "0".repeat(64) } as never] } }, "unresolvable-body-reference"],
    [{ tenant: "" as never }, "invalid-tenant"],
    [{ tenant: "Bad Tenant!" as never }, "invalid-tenant"],
    [{ owner: "" as never }, "invalid-owner"],
    [{ cycleId: "cycle missing!" as never }, "invalid-cycle"],
    [{ requestedAt: -1 as never }, "invalid-request-time"],
    [{ seed: "" as never }, "invalid-seed"],
    [{ context: { ...labFixtureContext(), phase: "" } }, "invalid-context"],
    [{ context: { ...labFixtureContext(), taskDifficulty: "impossible" as never } }, "invalid-context"],
    [{ context: { ...labFixtureContext(), deadline: -5 as never } }, "invalid-context"],
    [{ currentOrganization: { broken: true } as never }, "invalid-current-organization"],
    [{ restriction: { denied: "speech" } as never }, "invalid-restriction"],
  ];
  for (const [over, code] of cases) {
    const opened = service.openSearch(request(over));
    assert.ok(!opened.ok, `${code} should refuse`);
    assert.equal(opened.code, code);
    assert.ok(opened.detail.length > 0);
  }
});

test("negative: a broken current organization is refused even when shaped (E8)", () => {
  const { service } = lab();
  const broken = generalistBaselineOrganization({ organizationId: "org-negative-current" as never, agent: asAgentId("agent-negative-current")!, model: fixtureModelAssignment() });
  const result = service.openSearch(request({ currentOrganization: { ...broken, agents: [] } }));
  assert.ok(!result.ok && result.code === "invalid-current-organization");
});

test("negative: unknown searches and invalid cursors are typed refusals", () => {
  const { service } = lab();
  const opened = service.openSearch(request());
  assert.ok(opened.ok);
  const unknown = service.nextCandidates({ searchId: "lab-search-nonexistent", cursor: opened.cursor, as: caller });
  assert.ok(!unknown.ok && unknown.code === "search-unknown");
  const invalid = service.nextCandidates({ searchId: opened.searchId, cursor: { kind: "wrong" } as never, as: caller });
  assert.ok(!invalid.ok && invalid.code === "invalid-cursor");
  const foreignSpace = service.nextCandidates({
    searchId: opened.searchId,
    cursor: { kind: "search-cursor", searchId: opened.searchId, spaceDigest: "a".repeat(64) as never, nextIndex: 0 },
    as: caller,
  });
  assert.ok(!foreignSpace.ok && foreignSpace.code === "cursor-space-mismatch");
  const foreignSearch = service.nextCandidates({
    searchId: opened.searchId,
    cursor: { kind: "search-cursor", searchId: "lab-search-other", spaceDigest: opened.spaceDigest, nextIndex: 0 },
    as: caller,
  });
  assert.ok(!foreignSearch.ok && foreignSearch.code === "cursor-space-mismatch");
});

test("negative: regressed, skipped-ahead, past-the-end cursors and page sizes are refused", () => {
  const { service } = lab();
  const opened = service.openSearch(request());
  assert.ok(opened.ok);
  const searchId = opened.searchId;
  const first = service.nextCandidates({ searchId, cursor: opened.cursor, limit: 5, as: caller });
  assert.ok(first.ok);
  const next = first.nextCursor!;
  const regressed = service.nextCandidates({ searchId, cursor: opened.cursor, as: caller });
  assert.ok(!regressed.ok && regressed.code === "cursor-not-monotonic");
  assert.ok(regressed.detail.includes("regressed"));
  const skipped = service.nextCandidates({ searchId, cursor: { ...next, nextIndex: next.nextIndex + 3 }, as: caller });
  assert.ok(!skipped.ok && skipped.code === "cursor-not-monotonic");
  assert.ok(skipped.detail.includes("skipped ahead"));
  const badLimit = service.nextCandidates({ searchId, cursor: next, limit: 0, as: caller });
  assert.ok(!badLimit.ok && badLimit.code === "invalid-page-size");
  const hugeLimit = service.nextCandidates({ searchId, cursor: next, limit: 65, as: caller });
  assert.ok(!hugeLimit.ok && hugeLimit.code === "invalid-page-size");
  // Drain to the end, then the past-the-end cursor is refused.
  let cursor = next;
  let page: SearchPageResult = first;
  while (page.ok && !page.done) {
    page = service.nextCandidates({ searchId, cursor, limit: 64, as: caller });
    assert.ok(page.ok);
    cursor = page.nextCursor ?? cursor;
  }
  const pastEnd = service.nextCandidates({ searchId, cursor: { ...cursor, nextIndex: 1 << 30 }, as: caller });
  assert.ok(!pastEnd.ok);
  assert.ok(pastEnd.code === "cursor-out-of-range" || pastEnd.code === "cursor-not-monotonic");
});

test("negative: candidate positions are bounded (typed candidate-out-of-range)", () => {
  const { service } = lab();
  const opened = service.openSearch(request());
  assert.ok(opened.ok);
  const unknownSearch = service.evaluateCandidate({ searchId: "lab-search-none", position: 0, suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(!unknownSearch.ok && unknownSearch.code === "search-unknown");
  for (const bad of [-1, opened.size, opened.size + 10, 1.5]) {
    const result = service.evaluateCandidate({ searchId: opened.searchId, position: bad, suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
    assert.ok(!result.ok && result.code === "candidate-out-of-range");
  }
});

test("negative: the lab-simulation port refusals surface with their typed codes (E8)", () => {
  const { service } = lab();
  const result = service.evaluateOrganization({
    descriptor: labFixtureGeneralistOrganization(),
    cycleId: labFixtureCycleId(),
    context: labFixtureContext(),
    suite: labFixtureSuite().ref,
    evidence: { recordIds: evidenceBundle.recordIds, declaredDigest: "9".repeat(64) as never },
    parameters,
    as: caller,
  });
  assert.ok(!result.ok && result.code === "evaluation-refused");
  assert.equal(result.portCode, "evidence-digest-mismatch");
});

test("negative: refused commands mutate nothing (synchronous refusals)", () => {
  const { service } = lab();
  const before = service.document().stateDigest;
  service.compileOrganization({ descriptor: null, as: caller });
  service.openSearch(request({ seed: "" as never }));
  service.nextCandidates({ searchId: "lab-search-none", cursor: { kind: "search-cursor", searchId: "x", spaceDigest: "b".repeat(64) as never, nextIndex: 0 }, as: caller });
  service.evaluateCandidate({ searchId: "lab-search-none", position: 0, suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
  service.advanceCapabilityGap({ gapId: "gap-none", attempt: { rung: "blocked", reason: "x" }, as: caller });
  service.getCapabilityGap("gap-none", caller);
  assert.equal(service.document().stateDigest, before);
});

test("negative: unknown tool references are typed refusals through the tool catalog", () => {
  const { fakes, service } = lab();
  const withGhostTool = { ...labFixtureGeneralistOrganization(), tools: [fixtureToolRef("tool-not-in-catalog")] };
  const result = service.compileOrganization({ descriptor: withGhostTool, as: caller });
  // The default fake catalog has no tools registered, so tools are not
  // resolved at all (the port is optional); register one to flip the axis.
  assert.ok(result.ok || result.code === "unresolvable-tool-reference");
  fakes.tools.add(fixtureToolRef("tool-fabric-editor"));
  const second = service.compileOrganization({ descriptor: withGhostTool, as: caller });
  assert.ok(!second.ok && second.code === "unresolvable-tool-reference");
});
