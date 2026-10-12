/**
 * SERVICE TESTS (PL-029) — the state owner's happy paths: search open
 * (content-addressed idempotency), full-stream paging through single-use
 * cursors, candidate evaluation through the REAL PL-028 engine with gap
 * recording, the direct-organization evaluation door, compilation reads,
 * persistence restore and document determinism.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asAgentRoleId, asCapabilityId, asEvaluationSeed, asLabCycleId, asTimestampMs } from "@playliquid/lab-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { evidenceBundleDigestOf, labFixtureContext, labFixtureCycleId, labFixtureEvidenceRecords, labFixtureGeneralistOrganization, labFixtureSuite } from "@playliquid/lab-simulation";
import { LabOrganizationService } from "./service.ts";
import type { OrganizationSearchRequest } from "./records.ts";
import { createLabOrganizationFakes, fixtureModelAssignment } from "./fakes.ts";
import { baselinePositionOf, candidateAtPosition, traversalOf } from "./search.ts";
import { canonicalizeBounds, computeSpace } from "./space.ts";

const tenant = asTenantId("tenant-service")!;
const owner = asSubjectId("subject-service-owner")!;
const caller = { tenant, subject: owner };
const evidence = labFixtureEvidenceRecords();
const evidenceBundle = {
  recordIds: evidence.map((record) => String(record.evidenceId)),
  declaredDigest: evidenceBundleDigestOf(evidence),
};
const parameters = { seed: asEvaluationSeed("seed-service")!, tickBudget: 12 };

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
      modelCatalog: [fixtureModelAssignment("route-service-a")],
      toolCatalog: [],
      capabilityVocabulary: [asCapabilityId("lab-cap-engineering")!],
    },
    seed: asEvaluationSeed("seed-service-search")!,
    currentOrganization: labFixtureGeneralistOrganization(),
    requestedAt: asTimestampMs(1_000)!,
    ...over,
  };
}

function service() {
  const fakes = createLabOrganizationFakes();
  return { fakes, service: new LabOrganizationService({ ports: fakes.ports }) };
}

function spaceOf(fakes: ReturnType<typeof createLabOrganizationFakes>) {
  const bounds = canonicalizeBounds(request().bounds, fakes.bodies.port);
  const space = bounds.ok ? computeSpace(bounds.bounds) : undefined;
  assert.ok(space?.ok);
  return space.space;
}

test("service: opening the same request twice returns the same session receipt", () => {
  const { service: first } = service();
  const opened = first.openSearch(request());
  assert.ok(opened.ok);
  const again = first.openSearch(request());
  assert.ok(again.ok);
  assert.equal(again.duplicate, true);
  assert.equal(again.searchId, opened.searchId);
  assert.equal(again.size, opened.size);
  // A different seed is a different session (E9).
  const other = first.openSearch(request({ seed: asEvaluationSeed("seed-service-other")! }));
  assert.ok(other.ok);
  assert.notEqual(other.searchId, opened.searchId);
});

test("service: the whole stream pages through single-use cursors to done", () => {
  const { service: lab, fakes } = service();
  const opened = lab.openSearch(request());
  assert.ok(opened.ok);
  const space = spaceOf(fakes);
  let cursor = opened.cursor;
  const digests: string[] = [];
  let pages = 0;
  for (;;) {
    const page = lab.nextCandidates({ searchId: opened.searchId, cursor, limit: 7, as: caller });
    assert.ok(page.ok);
    pages += 1;
    digests.push(...page.candidates.map((candidate) => String(candidate.contentDigest)));
    if (page.done) {
      assert.equal(page.nextCursor, undefined);
      break;
    }
    cursor = page.nextCursor!;
  }
  assert.equal(digests.length, space.size);
  assert.ok(pages > 1);
  // The sequence equals the seeded traversal derivation (E9).
  const traversal = traversalOf(space, request().seed);
  assert.deepEqual(
    digests,
    Array.from({ length: space.size }, (_, position) => String(candidateAtPosition(space, traversal, position)!.contentDigest)),
  );
});

test("service: a second service instance replays the identical sequence (E9)", () => {
  const first = service().service;
  const second = service().service;
  const a = first.openSearch(request());
  const b = second.openSearch(request());
  assert.ok(a.ok && b.ok);
  assert.equal(a.searchId, b.searchId);
  const drain = (lab: LabOrganizationService, searchId: string, cursor: typeof a.cursor): string[] => {
    const out: string[] = [];
    let current = cursor;
    for (;;) {
      const page = lab.nextCandidates({ searchId, cursor: current, as: caller });
      assert.ok(page.ok);
      out.push(...page.candidates.map((candidate) => String(candidate.contentDigest)));
      if (page.done || page.nextCursor === undefined) break;
      current = page.nextCursor;
    }
    return out;
  };
  const firstStream = drain(first, a.searchId, a.cursor);
  const secondStream = drain(second, b.searchId, b.cursor);
  assert.deepEqual(secondStream, firstStream);
});

test("service: evaluateCandidate runs the candidate through the real engine", () => {
  const { service: lab, fakes } = service();
  const opened = lab.openSearch(request());
  assert.ok(opened.ok);
  const space = spaceOf(fakes);
  const traversal = traversalOf(space, request().seed);
  const baseline = baselinePositionOf(traversal);
  const evaluated = lab.evaluateCandidate({ searchId: opened.searchId, position: baseline, suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(evaluated.ok);
  assert.equal(evaluated.replayed, false);
  assert.equal(evaluated.evidence.run.result.epistemic, "labeled-estimate");
  assert.equal(evaluated.evidence.position, baseline);
  assert.equal(evaluated.gapFindings.length, 0);
  const replay = lab.evaluateCandidate({ searchId: opened.searchId, position: baseline, suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(replay.ok && replay.replayed);
  assert.equal(String(replay.evidence.contentKey), String(evaluated.evidence.contentKey));
  assert.equal(lab.listEvidence(caller).length, 1);
});

test("service: capability-spreading candidates record typed gaps against the current organization", () => {
  const { service: lab, fakes } = service();
  const opened = lab.openSearch(request());
  assert.ok(opened.ok);
  const space = spaceOf(fakes);
  const traversal = traversalOf(space, request().seed);
  let spreadPosition = -1;
  for (let position = 0; position < space.size; position += 1) {
    const candidate = candidateAtPosition(space, traversal, position);
    if (candidate?.blueprint?.capabilitySpread === "lead-agent") {
      spreadPosition = position;
      break;
    }
  }
  assert.ok(spreadPosition >= 0);
  const evaluated = lab.evaluateCandidate({ searchId: opened.searchId, position: spreadPosition, suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(evaluated.ok);
  assert.equal(evaluated.gapFindings.length, 1);
  const gap = evaluated.gapFindings[0]!;
  assert.equal(gap.missingCapability, "lab-cap-engineering");
  assert.equal(gap.attempts[0]!.rung, "existing-organization");
  const read = lab.getCapabilityGap(String(gap.gapId), caller);
  assert.ok(read.ok);
  assert.equal(lab.listCapabilityGaps(caller).length, 1);
  const advanced = lab.advanceCapabilityGap({ gapId: String(gap.gapId), attempt: { rung: "alternate-organization", disposition: "attempted", outcome: "resolved" }, as: caller });
  assert.ok(advanced.ok);
  assert.equal(advanced.gap.attempts.length, 2);
});

test("service: evaluateOrganization compiles and evaluates a direct descriptor", () => {
  const { service: lab } = service();
  const result = lab.evaluateOrganization({
    descriptor: labFixtureGeneralistOrganization(),
    cycleId: labFixtureCycleId(),
    context: labFixtureContext(),
    suite: labFixtureSuite().ref,
    evidence: evidenceBundle,
    parameters,
    as: caller,
  });
  assert.ok(result.ok);
  assert.equal(result.evidence.run.result.epistemic, "labeled-estimate");
  assert.equal(result.gapFindings.length, 0);
});

test("service: compilations are recorded and read back tenant-scoped", () => {
  const { service: lab } = service();
  const compiled = lab.compileOrganization({ descriptor: labFixtureGeneralistOrganization(), as: caller });
  assert.ok(compiled.ok && !compiled.duplicate);
  const duplicate = lab.compileOrganization({ descriptor: labFixtureGeneralistOrganization(), as: caller });
  assert.ok(duplicate.ok && duplicate.duplicate);
  const read = lab.getCompilation(String(compiled.compiled.contentDigest), caller);
  assert.ok(read.ok);
  assert.equal(read.compiled.isBaseline, true);
  const unknown = lab.getCompilation("0".repeat(64), caller);
  assert.ok(!unknown.ok && unknown.code === "compilation-unknown");
});

test("service: persistence restore round-trips the whole document (E6)", () => {
  const { service: lab, fakes } = service();
  const opened = lab.openSearch(request());
  assert.ok(opened.ok);
  const compiled = lab.compileOrganization({ descriptor: labFixtureGeneralistOrganization(), as: caller });
  assert.ok(compiled.ok);
  const evaluated = lab.evaluateOrganization({ descriptor: labFixtureGeneralistOrganization(), cycleId: labFixtureCycleId(), context: labFixtureContext(), suite: labFixtureSuite().ref, evidence: evidenceBundle, parameters, as: caller });
  assert.ok(evaluated.ok);
  const restored = new LabOrganizationService({ ports: fakes.ports });
  const result = restored.restore();
  assert.ok(result.ok);
  assert.deepEqual(result.counts, { searches: 1, compilations: 1, evidence: 1, gaps: 0 });
  // The restored session resumes the stream where it left off.
  const page = restored.nextCandidates({ searchId: opened.searchId, cursor: { kind: "search-cursor", searchId: opened.searchId, spaceDigest: opened.spaceDigest, nextIndex: 0 }, as: caller });
  assert.ok(page.ok);
  assert.equal(page.candidates[0]!.position, 0);
});

test("service: the document digest is a deterministic function of the state", () => {
  const first = service().service;
  const second = service().service;
  const a = first.openSearch(request());
  const b = second.openSearch(request());
  assert.ok(a.ok && b.ok);
  assert.equal(first.document().stateDigest, second.document().stateDigest);
  const pageA = first.nextCandidates({ searchId: a.searchId, cursor: a.cursor, limit: 3, as: caller });
  const pageB = second.nextCandidates({ searchId: b.searchId, cursor: b.cursor, limit: 3, as: caller });
  assert.ok(pageA.ok && pageB.ok);
  assert.equal(first.document().stateDigest, second.document().stateDigest);
  assert.notEqual(first.document().stateDigest, "");
});
