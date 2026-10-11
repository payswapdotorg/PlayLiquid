/**
 * Tenancy vocabulary tests (R20): tenant id well-formedness and the
 * tenant-scoped encounter key composition.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, isTenantId, tenantEncounterKey } from "./tenancy.ts";

test("well-formed tenant ids are accepted", () => {
  assert.equal(isTenantId(asTenantId("org")), true);
  assert.equal(isTenantId(asTenantId("studio-x")), true);
  assert.equal(isTenantId(asTenantId("tenant-1")), true);
  assert.equal(isTenantId(asTenantId("a".repeat(64))), true);
});

test("malformed tenant ids are rejected (total; never throws)", () => {
  assert.equal(isTenantId(undefined), false);
  assert.equal(isTenantId(null), false);
  assert.equal(isTenantId(42), false);
  assert.equal(isTenantId(""), false);
  // Uppercase, leading digit, punctuation and over-length slugs are refused.
  assert.equal(isTenantId(asTenantId("Studio-X")), false);
  assert.equal(isTenantId(asTenantId("1studio")), false);
  assert.equal(isTenantId(asTenantId("studio_x")), false);
  assert.equal(isTenantId(asTenantId("a".repeat(65))), false);
});

test("the encounter key is tenant-scoped and compositional", () => {
  const a = tenantEncounterKey(asTenantId("tenant-a"), "build-request", "builder-agent", "nonce-1");
  const b = tenantEncounterKey(asTenantId("tenant-b"), "build-request", "builder-agent", "nonce-1");
  assert.notEqual(a, b);
  assert.equal(a, "tenant-a|build-request|builder-agent|nonce-1");
  // Every component participates: any variation yields a distinct key.
  assert.notEqual(a, tenantEncounterKey(asTenantId("tenant-a"), "build-cancel", "builder-agent", "nonce-1"));
  assert.notEqual(a, tenantEncounterKey(asTenantId("tenant-a"), "build-request", "other-agent", "nonce-1"));
  assert.notEqual(a, tenantEncounterKey(asTenantId("tenant-a"), "build-request", "builder-agent", "nonce-2"));
});
