/**
 * TENANCY TESTS (PL-029, R20) — tenant isolation on every door: searches,
 * compilations, evidence and capability gaps are tenant-scoped; a subject
 * of another tenant is refused with typed cross-tenant codes and sees none
 * of the other tenant's records; same-tenant subjects share their tenant's
 * view. `checkTenantIsolation` (platform-contracts) is the authority —
 * consumed here, never re-implemented.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asAgentRoleId, asCapabilityId, asEvaluationSeed, asLabCycleId, asTimestampMs } from "@playliquid/lab-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { evidenceBundleDigestOf, labFixtureContext, labFixtureCycleId, labFixtureEvidenceRecords, labFixtureGeneralistOrganization, labFixtureSuite } from "@playliquid/lab-simulation";
import { LabOrganizationService } from "./service.ts";
import type { CandidateSpace, OrganizationSearchRequest } from "./records.ts";
import { createLabOrganizationFakes, fixtureModelAssignment } from "./fakes.ts";
import { canonicalizeBounds, computeSpace } from "./space.ts";
import { baselinePositionOf, candidateAtPosition, traversalOf } from "./search.ts";

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const subjectA = asSubjectId("subject-alpha-owner")!;
const subjectA2 = asSubjectId("subject-alpha-colleague")!;
const subjectB = asSubjectId("subject-beta-owner")!;
const callerA = { tenant: tenantA, subject: subjectA };
const callerB = { tenant: tenantB, subject: subjectB };

const evidence = labFixtureEvidenceRecords();
const evidenceBundle = {
  recordIds: evidence.map((record) => String(record.evidenceId)),
  declaredDigest: evidenceBundleDigestOf(evidence),
};
const parameters = { seed: asEvaluationSeed("seed-tenancy")!, tickBudget: 12 };

function request(tenant: typeof tenantA, owner: typeof subjectA, seed = "seed-tenancy-search"): OrganizationSearchRequest {
  return {
    tenant,
    owner,
    cycleId: asLabCycleId(String(labFixtureCycleId()))!,
    context: labFixtureContext(),
    bounds: {
      maxAgents: 2,
      roleVocabulary: [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!],
      bodyCatalog: [],
      modelCatalog: [fixtureModelAssignment("route-tenancy")],
      toolCatalog: [],
      capabilityVocabulary: [asCapabilityId("lab-cap-engineering")!],
    },
    seed: asEvaluationSeed(seed)!,
    currentOrganization: labFixtureGeneralistOrganization(),
    requestedAt: asTimestampMs(1_000)!,
  };
}

/** A service carrying tenant A's and tenant B's records side by side. */
function populated() {
  const fakes = createLabOrganizationFakes();
  const service = new LabOrganizationService({ ports: fakes.ports });
  const openedA = service.openSearch(request(tenantA, subjectA));
  assert.ok(openedA.ok);
  const openedB = service.openSearch(request(tenantB, subjectB));
  assert.ok(openedB.ok);
  const compiledA = service.compileOrganization({ descriptor: labFixtureGeneralistOrganization(), as: callerA });
  assert.ok(compiledA.ok);
  const spaceA = spaceOfA(fakes);
  const traversalA = traversalOf(spaceA, request(tenantA, subjectA).seed);
  const spread = findSpread(service, spaceA, traversalA, openedA.searchId, callerA);
  assert.ok(spread !== undefined);
  return { service, openedA, openedB, compiledA, spread, fakes };
}

/** Tenant A's canonical candidate space (test-side derivation, narrowed). */
function spaceOfA(fakes: ReturnType<typeof createLabOrganizationFakes>): CandidateSpace {
  const canonical = canonicalizeBounds(request(tenantA, subjectA).bounds, fakes.bodies.port);
  assert.ok(canonical.ok);
  const space = computeSpace(canonical.bounds);
  assert.ok(space.ok);
  return space.space;
}

function findSpread(service: LabOrganizationService, space: CandidateSpace, traversal: { readonly size: number; readonly start: number; readonly stride: number }, searchId: string, as: typeof callerA) {
  for (let position = 0; position < space.size; position += 1) {
    const candidate = candidateAtPosition(space, traversal, position);
    if (candidate?.blueprint?.capabilitySpread === "lead-agent") {
      const evaluated = service.evaluateCandidate({ searchId, position, suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as });
      assert.ok(evaluated.ok);
      return evaluated;
    }
  }
  return undefined;
}

test("tenancy: another tenant cannot page a foreign search (R20)", () => {
  const { service, openedA } = populated();
  const cross = service.nextCandidates({ searchId: openedA.searchId, cursor: openedA.cursor, as: callerB });
  assert.ok(!cross.ok && cross.code === "cross-tenant");
  assert.ok(cross.detail.includes("R20"));
});

test("tenancy: another tenant cannot evaluate in a foreign search (R20)", () => {
  const { service, openedA, fakes } = populated();
  const space = spaceOfA(fakes);
  const baseline = baselinePositionOf(traversalOf(space, request(tenantA, subjectA).seed));
  const cross = service.evaluateCandidate({ searchId: openedA.searchId, position: baseline, suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: callerB });
  assert.ok(!cross.ok && cross.code === "cross-tenant");
  assert.ok(cross.detail.includes("R20"));
});

test("tenancy: another tenant cannot read a foreign compilation (R20)", () => {
  const { service, compiledA } = populated();
  const cross = service.getCompilation(String(compiledA.compiled.contentDigest), callerB);
  assert.ok(!cross.ok && cross.code === "cross-tenant");
  assert.ok(cross.detail.includes("R20"));
});

test("tenancy: another tenant cannot read or advance a foreign gap (R20)", () => {
  const { service, spread } = populated();
  const gap = spread.gapFindings[0]!;
  const crossRead = service.getCapabilityGap(String(gap.gapId), callerB);
  assert.ok(!crossRead.ok && crossRead.code === "cross-tenant");
  const crossAdvance = service.advanceCapabilityGap({ gapId: String(gap.gapId), attempt: { rung: "alternate-organization", disposition: "attempted", outcome: "resolved" }, as: callerB });
  assert.ok(!crossAdvance.ok && crossAdvance.code === "cross-tenant");
  assert.ok(crossAdvance.detail.includes("R20"));
});

test("tenancy: listings are tenant-filtered — a foreign tenant sees nothing", () => {
  const { service, spread } = populated();
  assert.ok(service.listEvidence(callerA).length >= 1);
  assert.ok(service.listCapabilityGaps(callerA).length >= 1);
  assert.equal(service.listEvidence(callerB).length, 0);
  assert.equal(service.listCapabilityGaps(callerB).length, 0);
  void spread;
});

test("tenancy: same-tenant subjects share their tenant's view", () => {
  const { service, openedA, compiledA, spread } = populated();
  const colleague = { tenant: tenantA, subject: subjectA2 };
  const page = service.nextCandidates({ searchId: openedA.searchId, cursor: openedA.cursor, as: colleague });
  assert.ok(page.ok);
  const compilation = service.getCompilation(String(compiledA.compiled.contentDigest), colleague);
  assert.ok(compilation.ok);
  const gap = service.getCapabilityGap(String(spread.gapFindings[0]!.gapId), colleague);
  assert.ok(gap.ok);
});

test("tenancy: both tenants' records coexist in one service without leaking", () => {
  const { service, openedA, openedB, spread } = populated();
  // Tenant B has its own session and can page it.
  const own = service.nextCandidates({ searchId: openedB.searchId, cursor: openedB.cursor, as: callerB });
  assert.ok(own.ok);
  // Tenant A's gap does not leak into tenant B's gap listing.
  assert.equal(service.listCapabilityGaps(callerB).length, 0);
  assert.equal(service.listCapabilityGaps(callerA).length, 1);
  // A foreign search id is invisible to the other tenant even when guessed.
  const guessed = service.nextCandidates({ searchId: openedA.searchId, cursor: openedA.cursor, as: callerB });
  assert.ok(!guessed.ok && guessed.code === "cross-tenant");
  void openedA;
  void spread;
});

test("tenancy: identical request content under two tenants opens two isolated sessions", () => {
  const fakes = createLabOrganizationFakes();
  const service = new LabOrganizationService({ ports: fakes.ports });
  const first = service.openSearch(request(tenantA, subjectA));
  const second = service.openSearch(request(tenantB, subjectB));
  assert.ok(first.ok && second.ok);
  // The space is a pure function of the canonical bounds (shared); the
  // SESSION identity is tenant-scoped (digest.ts) — two isolated sessions.
  assert.equal(String(first.spaceDigest), String(second.spaceDigest));
  assert.notEqual(first.searchId, second.searchId);
  assert.equal(first.size, second.size);
});
