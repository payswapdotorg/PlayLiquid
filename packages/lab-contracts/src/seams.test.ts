import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asAgentBodyId,
  asAgentToolId,
  asZCodeModelRouteId,
  isAgentBodyRef,
  isAgentToolRef,
  isZCodeModelAssignmentRef,
} from "./seams.ts";
import type { AgentBodyRef, AgentToolRef, ZCodeModelAssignmentRef, ZCodeModelRouteId } from "./seams.ts";
import { fixtureDigest, fixtureModelRoute } from "./fixtures.ts";

test("seams: ZCode model route ids are opaque slugs minted outside the Lab (lock 5)", () => {
  assert.equal(asZCodeModelRouteId("route-default"), "route-default");
  assert.equal(asZCodeModelRouteId("not/slug"), undefined);
  assert.equal(asZCodeModelRouteId(""), undefined);
});

test("seams: a ZCode model assignment requires the routing authority marker", () => {
  assert.ok(isZCodeModelAssignmentRef(fixtureModelRoute()));
  assert.equal(fixtureModelRoute().authority, "zcode-model-routing");
  // Missing marker literal -> not an assignment ref.
  assert.equal(isZCodeModelAssignmentRef({ route: "route-default" }), false);
  assert.equal(isZCodeModelAssignmentRef({ authority: "lab-model-routing", route: "route-default" }), false);
  assert.equal(isZCodeModelAssignmentRef(null), false);
});

test("seams: a raw string cannot be passed off as a model route (compile-time)", () => {
  // @ts-expect-error — plain strings must go through asZCodeModelRouteId
  const route: ZCodeModelRouteId = "route-default";
  assert.equal(typeof route, "string");
});

test("seams: agent body refs are digest-pinned opaque references", () => {
  const body: AgentBodyRef = {
    bodyId: asAgentBodyId("body-sentinel")!,
    revisionDigest: fixtureDigest("body-sentinel"),
  };
  assert.ok(isAgentBodyRef(body));
  assert.equal(isAgentBodyRef({ bodyId: "body-sentinel", revisionDigest: "not-a-digest" }), false);
  assert.equal(isAgentBodyRef({ bodyId: "", revisionDigest: fixtureDigest("x") }), false);
  assert.equal(isAgentBodyRef(null), false);
});

test("seams: agent tool refs are digest-pinned provider-neutral references (lock 21)", () => {
  const tool: AgentToolRef = {
    toolId: asAgentToolId("tool-compiler")!,
    revisionDigest: fixtureDigest("tool-compiler"),
  };
  assert.ok(isAgentToolRef(tool));
  assert.equal(isAgentToolRef({ toolId: "tool-compiler", revisionDigest: "0".repeat(63) }), false);
  assert.equal(isAgentToolRef(null), false);
});

test("seams: the model assignment carries no model or provider vocabulary (lock 5)", () => {
  const assignment: ZCodeModelAssignmentRef = fixtureModelRoute();
  const keys = Object.keys(assignment).sort();
  // The ONLY fields are the authority marker and the opaque route id.
  assert.deepEqual(keys, ["authority", "route"]);
  for (const value of [assignment.authority, assignment.route]) {
    assert.equal(typeof value, "string");
  }
});
