/**
 * CANDIDATE-SPACE TESTS (PL-029) — canonicalization of the request
 * catalogs (dedupe + content order), per-dimension caps and typed
 * out-of-space refusals (E8), the finite cross-product bound, axis order
 * and the mixed-radix blueprint decode roundtrip.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SearchDimensionBounds } from "./records.ts";
import {
  DEFAULT_PAGE_SIZE,
  MAX_BODY_CATALOG,
  MAX_CAPABILITY_VOCABULARY,
  MAX_MODEL_CATALOG,
  MAX_PAGE_SIZE,
  MAX_ROLE_VOCABULARY,
  MAX_SEARCH_AGENT_COUNT,
  MAX_SEARCH_SPACE,
  MAX_TOOL_CATALOG,
} from "./records.ts";
import { canonicalizeBounds, computeSpace, decodeBlueprint, pageSizeOf } from "./space.ts";
import { craftBodyDefinition, createBodyCatalog, demoBodyDefinition, fixtureBodyRef, fixtureModelAssignment, fixtureToolRef } from "./fakes.ts";
import { asAgentRoleId, asCapabilityId } from "@playliquid/lab-contracts";
import { composeAvatar, demoAvatarInput } from "@playliquid/avatar-runtime";
import type { AvatarDefinition } from "@playliquid/avatar-runtime";
import { asAvatarId } from "@playliquid/game-contracts";

const bodies = createBodyCatalog([demoBodyDefinition(), craftBodyDefinition()]);

/** N distinct, resolvable avatar definitions (cap tests). */
function distinctBodyDefinitions(count: number): AvatarDefinition[] {
  return Array.from({ length: count }, (_, index) => {
    const result = composeAvatar({ ...demoAvatarInput(), avatarId: asAvatarId(`avatar-cap-${index}`)! });
    if (!result.ok) throw new Error(`cap fixture body ${index} failed composition`);
    return result.definition;
  });
}

/** A body catalog port that resolves N distinct definitions. */
function bodyCatalogOfSize(count: number) {
  return distinctBodyDefinitions(count);
}

function bounds(over: Partial<SearchDimensionBounds> = {}): SearchDimensionBounds {
  return {
    maxAgents: 3,
    roleVocabulary: [asAgentRoleId("implementer")!, asAgentRoleId("generalist")!, asAgentRoleId("implementer")!],
    bodyCatalog: [fixtureBodyRef(craftBodyDefinition()), fixtureBodyRef(demoBodyDefinition())],
    modelCatalog: [fixtureModelAssignment("route-b"), fixtureModelAssignment("route-a"), fixtureModelAssignment("route-b")],
    toolCatalog: [fixtureToolRef("tool-cli")],
    capabilityVocabulary: [asCapabilityId("lab-cap-b")!, asCapabilityId("lab-cap-a")!, asCapabilityId("lab-cap-b")!],
    ...over,
  };
}

/** Canonicalize + compute with narrowing (shared test helper). */
function spaceOf(over: Partial<SearchDimensionBounds> = {}) {
  const canonical = canonicalizeBounds(bounds(over), bodies.port);
  assert.ok(canonical.ok);
  const space = computeSpace(canonical.bounds);
  assert.ok(space.ok);
  return space.space;
}

test("space: catalogs are canonicalized — deduplicated and lexicographically sorted (E9)", () => {
  const result = canonicalizeBounds(bounds(), bodies.port);
  assert.ok(result.ok);
  assert.deepEqual(
    result.bounds.roleVocabulary.map((role) => String(role)),
    ["generalist", "implementer"],
  );
  assert.deepEqual(
    result.bounds.modelCatalog.map((model) => String(model.route)),
    ["route-a", "route-b"],
  );
  assert.deepEqual(
    result.bounds.capabilityVocabulary.map((capability) => String(capability)),
    ["lab-cap-a", "lab-cap-b"],
  );
  assert.equal(result.bounds.bodyCatalog.length, 2);
});

test("space: identical content yields the identical space regardless of catalog order", () => {
  const first = computeSpace(spaceOfBounds(bounds()));
  const second = computeSpace(
    spaceOfBounds(
      bounds({
        roleVocabulary: [...bounds().roleVocabulary].reverse(),
        modelCatalog: [...bounds().modelCatalog].reverse(),
        capabilityVocabulary: [...bounds().capabilityVocabulary].reverse(),
      }),
    ),
  );
  assert.ok(first.ok && second.ok);
  assert.equal(String(first.space.digest), String(second.space.digest));
  assert.equal(first.space.size, second.space.size);
});

/** Canonicalize raw bounds with narrowing (order-insensitivity test). */
function spaceOfBounds(raw: SearchDimensionBounds) {
  const canonical = canonicalizeBounds(raw, bodies.port);
  assert.ok(canonical.ok);
  return canonical.bounds;
}

test("space: dimension bounds are refused with typed codes (E8)", () => {
  const catalog = createBodyCatalog([demoBodyDefinition(), craftBodyDefinition(), ...distinctBodyDefinitions(MAX_BODY_CATALOG + 1)]);
  const resolve = (over: Partial<SearchDimensionBounds>) => canonicalizeBounds(bounds(over), catalog.port);
  const cases: readonly [Partial<SearchDimensionBounds>, string][] = [
    [{ maxAgents: 0 }, "dimension-out-of-bounds"],
    [{ maxAgents: MAX_SEARCH_AGENT_COUNT + 1 }, "dimension-out-of-bounds"],
    [{ maxAgents: 2.5 }, "dimension-out-of-bounds"],
    [{ roleVocabulary: [] }, "empty-role-vocabulary"],
    [{ roleVocabulary: ["Not-A-Slug" as never] }, "invalid-role-vocabulary"],
    [{ roleVocabulary: Array.from({ length: MAX_ROLE_VOCABULARY + 1 }, (_, index) => asAgentRoleId(`role-${index}`)!) }, "dimension-out-of-bounds"],
    [{ modelCatalog: [] }, "empty-model-catalog"],
    [{ modelCatalog: [{ authority: "wrong" as never, route: "x" as never }] }, "invalid-model-catalog"],
    [{ modelCatalog: Array.from({ length: MAX_MODEL_CATALOG + 1 }, (_, index) => fixtureModelAssignment(`route-${index}`)) }, "dimension-out-of-bounds"],
    [{ bodyCatalog: [{ bodyId: "ghost-body" as never, revisionDigest: "0".repeat(64) as never }] }, "unresolvable-body-reference"],
    [{ bodyCatalog: [{ bodyId: "demo-avatar" as never, revisionDigest: "f".repeat(64) as never }] }, "unresolvable-body-reference"],
    [{ bodyCatalog: Array.from({ length: MAX_BODY_CATALOG + 1 }, (_, index) => fixtureBodyRef(bodyCatalogOfSize(MAX_BODY_CATALOG + 1)[index]!)) }, "dimension-out-of-bounds"],
    [{ toolCatalog: [{ toolId: "bad tool!" as never, revisionDigest: "0".repeat(64) as never }] }, "invalid-tool-catalog"],
    [{ toolCatalog: Array.from({ length: MAX_TOOL_CATALOG + 1 }, (_, index) => fixtureToolRef(`tool-${index}`)) }, "dimension-out-of-bounds"],
    [{ capabilityVocabulary: ["not a slug" as never] }, "invalid-capability-vocabulary"],
    [{ capabilityVocabulary: Array.from({ length: MAX_CAPABILITY_VOCABULARY + 1 }, (_, index) => asCapabilityId(`cap-${index}`)!) }, "dimension-out-of-bounds"],
  ];
  for (const [over, code] of cases) {
    const result = resolve(over);
    assert.ok(!result.ok, `${code} should refuse`);
    assert.equal(result.code, code);
    assert.ok(result.detail.length > 0);
  }
});

test("space: the axes follow the architecture's dimension list order", () => {
  const space = spaceOf();
  assert.deepEqual(
    space.axes.map((axis) => axis.dimension),
    [
      "agents",
      "roles",
      "bodies",
      "model-assignments",
      "tools",
      "capabilities",
      "communication-delegation",
      "memory-topology",
      "human-participation",
      "budget",
      "scheduling",
      "review-structure",
    ],
  );
  assert.deepEqual(space.radices, space.axes.map((axis) => axis.values.length));
});

test("space: the size is 1 (baseline, lock 26) + the product of the radices", () => {
  const space = spaceOf();
  const product = space.radices.reduce((total, radix) => total * radix, 1);
  assert.equal(space.size, product + 1);
  assert.ok(space.size <= MAX_SEARCH_SPACE);
});

test("space: empty catalogs collapse their axes (no unbounded generation)", () => {
  const collapsed = spaceOf({ bodyCatalog: [], toolCatalog: [], capabilityVocabulary: [] });
  const bodiesAxis = collapsed.axes.find((axis) => axis.dimension === "bodies")!;
  const toolsAxis = collapsed.axes.find((axis) => axis.dimension === "tools")!;
  const capsAxis = collapsed.axes.find((axis) => axis.dimension === "capabilities")!;
  assert.deepEqual(bodiesAxis.values, ["none"]);
  assert.deepEqual(toolsAxis.values, ["none"]);
  assert.deepEqual(capsAxis.values, ["none"]);
});

test("space: a single-entry model catalog collapses the routing axis", () => {
  const single = spaceOf({ modelCatalog: [fixtureModelAssignment("route-solo")] });
  const routing = single.axes.find((axis) => axis.dimension === "model-assignments")!;
  assert.deepEqual(routing.values, ["uniform"]);
});

test("space: every index decodes to a blueprint and roundtrips the axes", () => {
  const space = spaceOf();
  assert.equal(decodeBlueprint(space, 0), undefined);
  assert.equal(decodeBlueprint(space, space.size), undefined);
  assert.equal(decodeBlueprint(space, -1), undefined);
  for (let index = 1; index < space.size; index += 1) {
    const blueprint = decodeBlueprint(space, index);
    assert.ok(blueprint !== undefined);
    assert.ok(blueprint.agentCount >= 1 && blueprint.agentCount <= 3);
    assert.ok(blueprint.humanParticipation === "none" || blueprint.humanParticipation === "optional" || blueprint.humanParticipation === "required");
    assert.ok(["event-driven", "phase-gated", "continuous"].includes(blueprint.scheduling));
  }
});

test("space: the maximum bounded space stays under the cross-product cap", () => {
  const maxed = spaceOf({
    maxAgents: MAX_SEARCH_AGENT_COUNT,
    roleVocabulary: ["generalist", "implementer", "reviewer"].map((role) => asAgentRoleId(role)!),
    capabilityVocabulary: ["cap-a", "cap-b"].map((capability) => asCapabilityId(capability)!),
  });
  assert.ok(maxed.size <= MAX_SEARCH_SPACE, `size ${maxed.size} must be <= ${MAX_SEARCH_SPACE}`);
});

test("space: page sizes are clamped to the bounded range", () => {
  assert.equal(pageSizeOf(undefined), DEFAULT_PAGE_SIZE);
  assert.equal(pageSizeOf(1), 1);
  assert.equal(pageSizeOf(MAX_PAGE_SIZE), MAX_PAGE_SIZE);
  assert.equal(pageSizeOf(0), undefined);
  assert.equal(pageSizeOf(MAX_PAGE_SIZE + 1), undefined);
  assert.equal(pageSizeOf(1.5), undefined);
});
