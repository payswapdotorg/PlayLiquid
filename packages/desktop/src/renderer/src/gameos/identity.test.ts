/**
 * PRODUCT IDENTITY + HOST FACTS TESTS (RW-001): pins the PlayLiquid GameOS
 * product identity vocabulary and the entry-routing URL helpers against a
 * stubbed window location (node has no DOM; the helpers only read
 * location.search/pathname). Also pins the honest no-build-commit path: in
 * the node test runtime `__PLAYLIQUID_GAMEOS_COMMIT__` is not defined, so
 * the local project identity refuses with undefined instead of
 * fabricating a revision (E11).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_MODEL_ROUTE,
  LOCAL_ROLE_VOCABULARY,
  LOCAL_SUBJECT,
  LOCAL_TENANT,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
  PRODUCT_WORDMARK,
  WORKBENCH_NAV_HINT,
  WORKBENCH_NAV_LABEL,
  WORKBENCH_QUERY_FLAG,
  buildCommitSha,
  localProjectIdentity,
  productHref,
  workbenchHref,
} from "./identity.ts";
import { asAgentRoleId } from "../../../../../lab-contracts/src/index.ts";
import { asZCodeModelRouteId } from "../../../../../lab-contracts/src/index.ts";
import { asSubjectId, asTenantId } from "../../../../../platform-contracts/src/index.ts";

/** Stubs the window location the URL helpers read (node has no DOM). */
function stubWindowLocation(search: string, pathname = "/index.html"): void {
  (globalThis as typeof globalThis & { window?: unknown }).window = {
    location: { search, pathname },
  };
}

test("the product identity vocabulary is the PlayLiquid GameOS product", () => {
  assert.equal(PRODUCT_NAME, "PlayLiquid GameOS");
  assert.equal(PRODUCT_TAGLINE, "The game engineering operating system");
});

test("the compact wordmark is the product's own first word", () => {
  assert.equal(PRODUCT_WORDMARK, "PlayLiquid");
  assert.ok(
    PRODUCT_NAME.startsWith(`${PRODUCT_WORDMARK} `),
    "the wordmark must stay derived from the product name",
  );
});

test("the agent-workspace escape hatch carries the frozen UX-001 vocabulary", () => {
  // The frozen cross-workstream contract (spec/ux/work-items.md): the
  // button label is EXACTLY "AI & Agents" — replacing the inherited
  // workbench label ("ZCode workbench") which named the upstream product
  // instead of the capability.
  assert.equal(WORKBENCH_NAV_LABEL, "AI & Agents");
  // The hint stays honest about what the button opens — no fabrication.
  assert.ok(WORKBENCH_NAV_HINT.startsWith("Open the agent workspace"));
  for (const word of ["models", "agents", "provider capabilities"]) {
    assert.ok(WORKBENCH_NAV_HINT.includes(word), `hint mentions ${word}`);
  }
  assert.ok(!WORKBENCH_NAV_HINT.includes("ZCode"), "no inherited branding in the hint");
  assert.ok(!WORKBENCH_NAV_LABEL.includes("ZCode"), "no inherited branding in the label");
});

test("the local tenancy facts are valid domain ids of the local operator", () => {
  assert.equal(asTenantId("tenant-playliquid-local"), LOCAL_TENANT);
  assert.equal(asSubjectId("subject-local-operator"), LOCAL_SUBJECT);
});

test("the host's model route + role vocabulary are valid opaque handles", () => {
  assert.equal(asZCodeModelRouteId("route-workbench-local"), LOCAL_MODEL_ROUTE);
  assert.deepEqual(
    LOCAL_ROLE_VOCABULARY,
    [asAgentRoleId("generalist"), asAgentRoleId("implementer")],
  );
});

test("without a build commit the host refuses a project revision honestly", () => {
  // In the node test runtime the vite define is absent: the host must NOT
  // fabricate a game identity (E11 — no invented data).
  assert.equal(buildCommitSha(), undefined);
  assert.equal(localProjectIdentity(), undefined);
});

test("the workbench flag URL adds the flag and preserves other parameters", () => {
  stubWindowLocation("?restoreSession=false&locale=en-US");
  assert.equal(workbenchHref(), "/index.html?restoreSession=false&locale=en-US&workbench=1");
});

test("the product URL removes the workbench flag and preserves other parameters", () => {
  stubWindowLocation("?workbench=1&supportsSettings=false");
  assert.equal(productHref(), "/index.html?supportsSettings=false");
});

test("workbench/product round trip over a bare location is idempotent", () => {
  stubWindowLocation("");
  const toWorkbench = workbenchHref();
  assert.equal(toWorkbench, "/index.html?workbench=1");
  // Simulate the navigation: the workbench URL becomes the current location.
  stubWindowLocation("?workbench=1");
  assert.equal(productHref(), "/index.html");
  assert.equal(WORKBENCH_QUERY_FLAG, "workbench");
});
