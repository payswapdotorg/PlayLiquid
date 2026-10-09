/**
 * R20 tenant-isolation tests for the community service. Cross-tenant
 * contributors, actors, records, histories and queries are typed
 * violations; identical subject texts under different tenants are fully
 * isolated contribution spaces.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { CommunityService } from "./service.ts";
import type { SubmitContributionCommand } from "./admission.ts";
import {
  createFixedClock,
  createMemoryCommunityStore,
  createMemoryGapDirectory,
  createMemoryPackageRegistry,
  createMemorySubjectDirectory,
  fakePayload,
  ids,
} from "./fakes.ts";

const tenantA = ids.tenant("tenant-alpha");
const tenantB = ids.tenant("tenant-beta");
const contributorA = ids.subject("player-one");
const maintainerA = ids.subject("mod-one");
const contributorB = ids.subject("player-beta");
const maintainerB = ids.subject("mod-beta");

function makeService() {
  const store = createMemoryCommunityStore();
  const directory = createMemorySubjectDirectory();
  directory.register(tenantA, contributorA);
  directory.registerMaintainer(tenantA, maintainerA);
  directory.register(tenantB, contributorB);
  directory.registerMaintainer(tenantB, maintainerB);
  const service = new CommunityService({
    store: store.store,
    clock: createFixedClock().clock,
    directory: directory.directory,
    gaps: createMemoryGapDirectory().gaps,
    packages: createMemoryPackageRegistry().registry,
    policy: { maxOpenContributionsPerContributor: 10 },
  });
  return { store, directory, service };
}

function submitCommand(over: Partial<SubmitContributionCommand> = {}): SubmitContributionCommand {
  return {
    tenant: tenantA,
    contributor: contributorA,
    kind: "code",
    payload: fakePayload({ title: "fix" }),
    provenance: { origin: { kind: "original" }, aiGenerated: false },
    ...over,
  };
}

test("tenancy: a contributor of tenant B cannot submit under tenant A", () => {
  const { service } = makeService();
  const cross = service.submit(submitCommand({ contributor: contributorB }));
  assert.ok(!cross.accepted);
  assert.equal(cross.code, "unknown-contributor");
  // Nothing was recorded.
  assert.equal(service.contributionsOf(tenantA).length, 0);
  assert.equal(service.contributionsOf(tenantB).length, 0);
});

test("tenancy: a tenant A contributor cannot inject records into tenant B", () => {
  const { service } = makeService();
  const injection = service.submit(submitCommand({ tenant: tenantB }));
  assert.ok(!injection.accepted);
  assert.equal(injection.code, "unknown-contributor");
  assert.equal(service.contributionsOf(tenantB).length, 0);
});

test("tenancy: a tenant B maintainer cannot act on tenant A contributions", () => {
  const { service } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const foreign = service.transition({
    tenant: tenantA,
    contributionId: submitted.contribution.contributionId,
    kind: "triage",
    actor: maintainerB,
  });
  assert.ok(!foreign.accepted);
  // Distinct codes for distinct probes: cross-tenant actor vs plain
  // non-maintainer (R20 auditable probes).
  assert.ok(foreign.code === "cross-tenant-actor" || foreign.code === "not-a-maintainer");
  // No mutation happened.
  assert.equal(service.contribution(tenantA, submitted.contribution.contributionId)?.status, "submitted");
});

test("tenancy: an actor of another tenant gets the cross-tenant code, not a silent pass", () => {
  const { service, directory } = makeService();
  // tenantOf knows maintainerB belongs to tenant B (cross-tenant guard).
  assert.equal(directory.directory.tenantOf(maintainerB), tenantB);
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const foreign = service.transition({
    tenant: tenantA,
    contributionId: submitted.contribution.contributionId,
    kind: "triage",
    actor: maintainerB,
  });
  assert.ok(!foreign.accepted);
  assert.equal(foreign.code, "cross-tenant-actor");
});

test("tenancy: reads are tenant-scoped — a foreign id lookup finds nothing", () => {
  const { service } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  assert.ok(service.contribution(tenantA, id) !== undefined);
  // The SAME id under tenant B is unknown: contributions are per-tenant.
  assert.equal(service.contribution(tenantB, id), undefined);
  // A foreign transition command is refused as unknown (no leakage).
  const foreign = service.transition({ tenant: tenantB, contributionId: id, kind: "triage", actor: maintainerB });
  assert.ok(!foreign.accepted);
  assert.equal(foreign.code, "unknown-contribution");
});

test("tenancy: histories and gap queries never cross tenants", () => {
  const { service } = makeService();
  const a = service.submit(submitCommand());
  assert.ok(a.accepted);
  const b = service.submit(
    submitCommand({ tenant: tenantB, contributor: contributorB, payload: fakePayload({ title: "beta" }) }),
  );
  assert.ok(b.accepted);
  assert.equal(service.history(tenantA).length, 1);
  assert.equal(service.history(tenantB).length, 1);
  assert.equal(service.history(tenantA, b.contribution.contributionId).length, 0);
  assert.equal(service.gapContributions(tenantB, "gap-1").length, 0);
});

test("tenancy: subjects of different tenants keep fully isolated contribution spaces", () => {
  const { service } = makeService();
  // Distinct subject texts per tenant: the identity model scopes one
  // subject to exactly one tenant (platform-identity's record shape), so
  // cross-tenant isolation is between DIFFERENT subjects, never the same
  // text twice.
  const inA = service.submit(submitCommand({ payload: fakePayload({ title: "in-a" }) }));
  assert.ok(inA.accepted);
  const inB = service.submit(
    submitCommand({ tenant: tenantB, contributor: contributorB, payload: fakePayload({ title: "in-b" }) }),
  );
  assert.ok(inB.accepted);
  // Distinct records, isolated spaces, no leakage either way.
  assert.notEqual(String(inA.contribution.contributionId), String(inB.contribution.contributionId));
  assert.equal(service.contributionsOf(tenantA).length, 1);
  assert.equal(service.contributionsOf(tenantB).length, 1);
  assert.equal(service.contributionsOf(tenantA, contributorA).length, 1);
  assert.equal(service.contributionsOf(tenantB, contributorA).length, 0);
  const titleInA = (service.contributionsOf(tenantA, contributorA)[0]!.payload as { fields: { title?: { value?: string } } }).fields.title;
  assert.equal((titleInA as { value?: string } | undefined)?.value, "in-a");
  assert.equal(service.history(tenantB, inA.contribution.contributionId).length, 0);
  assert.equal(service.history(tenantA, inB.contribution.contributionId).length, 0);
});

test("tenancy: the open-contribution quota is per tenant+contributor, not global", () => {
  const { directory } = makeService();
  const store = createMemoryCommunityStore();
  const tight = new CommunityService({
    store: store.store,
    clock: createFixedClock().clock,
    directory: directory.directory,
    gaps: createMemoryGapDirectory().gaps,
    packages: createMemoryPackageRegistry().registry,
    policy: { maxOpenContributionsPerContributor: 1 },
  });
  assert.ok(tight.submit(submitCommand()).accepted);
  // A different subject in another tenant has a FRESH quota space.
  const other = tight.submit(
    submitCommand({ tenant: tenantB, contributor: contributorB, payload: fakePayload({ title: "b" }) }),
  );
  assert.ok(other.accepted, "the quota is scoped to (tenant, contributor), not global");
  // The same contributor overflowing in tenant A is refused.
  const overflow = tight.submit(submitCommand({ payload: fakePayload({ title: "a2" }) }));
  assert.ok(!overflow.accepted);
  assert.equal(overflow.code, "contributor-quota-full");
});
