/**
 * SEARCH TRAVERSAL + GENERATION TESTS (PL-029) — the seeded stride walk
 * is a bijection over the finite space, the generalist baseline appears
 * exactly once (lock 26), every generated candidate is organization-valid
 * by construction AND compiles against the body catalog, and the same
 * request content always yields the identical sequence (E9).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asAgentRoleId, asCapabilityId, asEvaluationSeed, validateOrganization } from "@playliquid/lab-contracts";
import type { SearchDimensionBounds } from "./records.ts";
import { compileOrganization } from "./compile.ts";
import { candidateAtSpaceIndex } from "./generate.ts";
import { baselinePositionOf, enumerateTraversal, spaceIndexOf, traversalOf } from "./search.ts";
import type { SearchTraversal } from "./search.ts";
import { computeSpace } from "./space.ts";
import { canonicalizeBounds } from "./space.ts";
import { craftBodyDefinition, createBodyCatalog, demoBodyDefinition, fixtureBodyRef, fixtureModelAssignment, fixtureToolRef } from "./fakes.ts";

const bodies = createBodyCatalog([demoBodyDefinition(), craftBodyDefinition()]);

function bounds(): SearchDimensionBounds {
  return {
    maxAgents: 3,
    roleVocabulary: [asAgentRoleId("generalist")!, asAgentRoleId("implementer")!, asAgentRoleId("reviewer")!],
    bodyCatalog: [fixtureBodyRef(demoBodyDefinition()), fixtureBodyRef(craftBodyDefinition())],
    modelCatalog: [fixtureModelAssignment("route-a"), fixtureModelAssignment("route-b")],
    toolCatalog: [fixtureToolRef("tool-fabric-editor"), fixtureToolRef("tool-fabric-cli")],
    capabilityVocabulary: [asCapabilityId("lab-cap-engineering")!, asCapabilityId("lab-cap-art")!],
  };
}

const canonical = canonicalizeBounds(bounds(), bodies.port);
assert.ok(canonical.ok);
const space = computeSpace(canonical.bounds);
assert.ok(space.ok);

test("search: the seeded traversal is a bijection over the space", () => {
  for (const seedText of ["seed-alpha", "seed-beta", "seed-gamma", "pl-029"]) {
    const traversal = traversalOf(space.space, asEvaluationSeed(seedText)!);
    const visited = new Set<number>();
    for (let position = 0; position < space.space.size; position += 1) {
      const index = spaceIndexOf(traversal, position);
      assert.ok(!visited.has(index), `position ${position} revisited index ${index}`);
      visited.add(index);
    }
    assert.equal(visited.size, space.space.size);
  }
});

test("search: the traversal is a pure function of (space digest, seed) — E9", () => {
  const first = traversalOf(space.space, asEvaluationSeed("seed-alpha")!);
  const second = traversalOf(space.space, asEvaluationSeed("seed-alpha")!);
  assert.deepEqual(second, first);
  const other = traversalOf(space.space, asEvaluationSeed("seed-beta")!);
  assert.ok(other.start !== first.start || other.stride !== first.stride);
});

test("search: the baseline appears exactly once and its position solves the walk", () => {
  const traversal = traversalOf(space.space, asEvaluationSeed("seed-alpha")!);
  const baselinePosition = baselinePositionOf(traversal);
  assert.equal(spaceIndexOf(traversal, baselinePosition), 0);
  const candidates = enumerateTraversal(space.space, traversal);
  const baselines = candidates.filter((candidate) => candidate.isBaseline);
  assert.equal(baselines.length, 1);
  assert.equal(baselines[0]!.position, baselinePosition);
  assert.equal(baselines[0]!.spaceIndex, 0);
  assert.equal(baselines[0]!.blueprint, undefined);
});

test("search: two identical requests yield the identical candidate sequence (E9)", () => {
  const first = enumerateTraversal(space.space, traversalOf(space.space, asEvaluationSeed("seed-alpha")!));
  const second = enumerateTraversal(space.space, traversalOf(space.space, asEvaluationSeed("seed-alpha")!));
  assert.deepEqual(
    second.map((candidate) => String(candidate.contentDigest)),
    first.map((candidate) => String(candidate.contentDigest)),
  );
  assert.deepEqual(
    second.map((candidate) => candidate.spaceIndex),
    first.map((candidate) => candidate.spaceIndex),
  );
});

test("search: a different seed walks the same space in a different order, same set", () => {
  const first = enumerateTraversal(space.space, traversalOf(space.space, asEvaluationSeed("seed-alpha")!));
  const second = enumerateTraversal(space.space, traversalOf(space.space, asEvaluationSeed("seed-beta")!));
  const order = first.map((candidate) => String(candidate.contentDigest));
  const other = second.map((candidate) => String(candidate.contentDigest));
  assert.notDeepEqual(other, order);
  assert.deepEqual([...other].sort(), [...order].sort());
});

test("search: every generated candidate is organization-valid by construction", () => {
  for (let index = 0; index < space.space.size; index += 1) {
    const candidate = candidateAtSpaceIndex(space.space, index);
    assert.ok(candidate !== undefined);
    const validation = validateOrganization(candidate.organization);
    assert.ok(validation.ok, `space index ${index} failed: ${validation.ok ? "" : validation.violations.map((violation) => violation.code).join(",")}`);
    assert.equal(String(candidate.contentDigest).length, 64);
  }
});

test("search: every generated candidate compiles against the body catalog (finite vocabulary)", () => {
  for (let index = 0; index < space.space.size; index += 1) {
    const candidate = candidateAtSpaceIndex(space.space, index);
    assert.ok(candidate !== undefined);
    const compiled = compileOrganization(candidate.organization, { ports: { bodies: bodies.port }, capabilities: canonical.bounds.capabilityVocabulary });
    assert.ok(compiled.ok, `space index ${index} failed to compile`);
  }
});

test("search: candidates are content-distinct across the whole space", () => {
  const digests = new Set<string>();
  const ids = new Set<string>();
  for (let index = 0; index < space.space.size; index += 1) {
    const candidate = candidateAtSpaceIndex(space.space, index);
    digests.add(String(candidate!.contentDigest));
    ids.add(String(candidate!.organization.id));
  }
  assert.equal(digests.size, space.space.size);
  assert.equal(ids.size, space.space.size);
});

test("search: bodies bind round-robin only when the catalog is non-empty", () => {
  let roundRobinWithBodies = 0;
  for (let index = 1; index < space.space.size; index += 1) {
    const candidate = candidateAtSpaceIndex(space.space, index);
    if (candidate!.blueprint?.bodyBinding !== "round-robin") continue;
    roundRobinWithBodies += 1;
    assert.ok(candidate!.organization.agents.every((agent) => agent.body !== undefined));
    const bodyIds = candidate!.organization.agents.map((agent) => String(agent.body!.bodyId));
    assert.ok(bodyIds.every((bodyId) => canonical.bounds.bodyCatalog.some((ref) => String(ref.bodyId) === bodyId)));
  }
  assert.ok(roundRobinWithBodies > 0);

  const noBodiesBounds = canonicalizeBounds({ ...bounds(), bodyCatalog: [] }, bodies.port);
  assert.ok(noBodiesBounds.ok);
  const noBodies = computeSpace(noBodiesBounds.bounds);
  assert.ok(noBodies.ok);
  for (let index = 1; index < noBodies.space.size; index += 1) {
    const candidate = candidateAtSpaceIndex(noBodies.space, index);
    assert.ok(candidate!.organization.agents.every((agent) => agent.body === undefined));
  }
});

test("search: the traversal tolerates position overflow without leaving the space", () => {
  const traversal: SearchTraversal = traversalOf(space.space, asEvaluationSeed("seed-alpha")!);
  const wrapped = spaceIndexOf(traversal, traversal.size + 5);
  assert.equal(wrapped, spaceIndexOf(traversal, 5));
  assert.ok(wrapped >= 0 && wrapped < traversal.size);
  assert.equal(candidateAtSpaceIndex(space.space, -1), undefined);
  assert.equal(candidateAtSpaceIndex(space.space, space.space.size), undefined);
});
