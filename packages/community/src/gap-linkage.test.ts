/**
 * R18 CAPABILITY-GAP LINKAGE tests. The typed link: a contribution may
 * cite the Lab-recorded gap it addresses; the Lab seam supplies ladder
 * facts (exists / resolved / blocked / community-rung-reached) and the
 * service refuses contributions against unknown, closed, or premature
 * gaps. The LADDER ITSELF is Lab-owned (lab-contracts) — this service
 * never mutates gap state and never names rungs; the link is opaque ids
 * plus seam facts. The Lab observes accepted contributions through its
 * own adapter (out of scope here by design).
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
  fakeGapLink,
  fakePayload,
  ids,
} from "./fakes.ts";

const tenant = ids.tenant("tenant-alpha");
const tenantB = ids.tenant("tenant-beta");
const contributor = ids.subject("player-one");
const maintainer = ids.subject("mod-one");

function makeService() {
  const store = createMemoryCommunityStore();
  const directory = createMemorySubjectDirectory();
  directory.register(tenant, contributor);
  directory.registerMaintainer(tenant, maintainer);
  const gaps = createMemoryGapDirectory();
  const service = new CommunityService({
    store: store.store,
    clock: createFixedClock().clock,
    directory: directory.directory,
    gaps: gaps.gaps,
    packages: createMemoryPackageRegistry().registry,
    policy: { maxOpenContributionsPerContributor: 10 },
  });
  return { store, directory, gaps, service };
}

function submitCommand(over: Partial<SubmitContributionCommand> = {}): SubmitContributionCommand {
  return {
    tenant,
    contributor,
    kind: "skill",
    payload: fakePayload({ title: "skill" }),
    provenance: { origin: { kind: "original" }, aiGenerated: false },
    ...over,
  };
}

test("gap linkage: a contribution against an open community-rung gap is recorded with its typed link", () => {
  const { service, gaps } = makeService();
  gaps.declare("gap-open", "cycle-1", { communityRungReached: true });
  const result = service.submit(submitCommand({ gap: fakeGapLink("gap-open", "cycle-1") }));
  assert.ok(result.accepted);
  assert.equal(String(result.contribution.gap?.gapId), "gap-open");
  assert.equal(String(result.contribution.gap?.cycleId), "cycle-1");
  // The Lab seam was consulted exactly once for the linked submission.
  assert.equal(gaps.reads(), 1);
});

test("gap linkage: unknown gaps refuse the submission", () => {
  const { service } = makeService();
  const result = service.submit(submitCommand({ gap: fakeGapLink("gap-404", "cycle-1") }));
  assert.ok(!result.accepted);
  assert.equal(result.code, "unknown-gap");
  assert.equal(service.contributionsOf(tenant).length, 0);
});

test("gap linkage: resolved gaps refuse further contributions (gap-not-open)", () => {
  const { service, gaps } = makeService();
  gaps.declare("gap-done", "cycle-1", { resolved: true, communityRungReached: true });
  const result = service.submit(submitCommand({ gap: fakeGapLink("gap-done", "cycle-1") }));
  assert.ok(!result.accepted);
  assert.equal(result.code, "gap-not-open");
});

test("gap linkage: blocked gaps refuse contributions (gap-not-open)", () => {
  const { service, gaps } = makeService();
  gaps.declare("gap-blocked", "cycle-1", { blocked: true, communityRungReached: true });
  const result = service.submit(submitCommand({ gap: fakeGapLink("gap-blocked", "cycle-1") }));
  assert.ok(!result.accepted);
  assert.equal(result.code, "gap-not-open");
});

test("gap linkage: gaps still at an earlier ladder rung refuse premature contributions", () => {
  const { service, gaps } = makeService();
  // The Lab reports the ladder has NOT walked to the community rung yet
  // (existing/alternate organizations or package capabilities are still
  // being tried — R18 resolution order).
  gaps.declare("gap-early", "cycle-1", { communityRungReached: false });
  const result = service.submit(submitCommand({ gap: fakeGapLink("gap-early", "cycle-1") }));
  assert.ok(!result.accepted);
  assert.equal(result.code, "gap-not-at-community-rung");
  assert.equal(service.contributionsOf(tenant).length, 0);
});

test("gap linkage: multiple contributions may address one open gap", () => {
  const { service, gaps } = makeService();
  gaps.declare("gap-contest", "cycle-1", { communityRungReached: true });
  const one = service.submit(submitCommand({ gap: fakeGapLink("gap-contest", "cycle-1"), payload: fakePayload({ title: "a" }) }));
  const two = service.submit(submitCommand({ gap: fakeGapLink("gap-contest", "cycle-1"), payload: fakePayload({ title: "b" }) }));
  assert.ok(one.accepted && two.accepted);
  const forGap = service.gapContributions(tenant, "gap-contest");
  assert.equal(forGap.length, 2);
  assert.deepEqual(
    forGap.map((record) => (record.payload as { fields: { title?: { value?: string } } }).fields.title?.value).sort(),
    ["a", "b"],
  );
});

test("gap linkage: unlinked submissions never consult the Lab seam", () => {
  const { service, gaps } = makeService();
  const result = service.submit(submitCommand());
  assert.ok(result.accepted);
  assert.equal(result.contribution.gap, undefined);
  assert.equal(gaps.reads(), 0);
});

test("gap linkage: gap queries are tenant-scoped", () => {
  const { service, gaps, directory } = makeService();
  gaps.declare("gap-scoped", "cycle-1", { communityRungReached: true });
  const other = ids.subject("player-two");
  directory.register(tenantB, other);
  assert.ok(service.submit(submitCommand({ gap: fakeGapLink("gap-scoped", "cycle-1") })).accepted);
  const foreign = service.submit(
    submitCommand({ tenant: tenantB, contributor: other, gap: fakeGapLink("gap-scoped", "cycle-1") }),
  );
  assert.ok(foreign.accepted, "the same gap may legitimately receive tenant-B contributions");
  assert.equal(service.gapContributions(tenant, "gap-scoped").length, 1);
  assert.equal(service.gapContributions(tenantB, "gap-scoped").length, 1);
});

test("gap linkage: accepting a linked contribution never mutates Lab gap state", () => {
  const { service, gaps } = makeService();
  gaps.declare("gap-accept", "cycle-1", { communityRungReached: true });
  const submitted = service.submit(submitCommand({ gap: fakeGapLink("gap-accept", "cycle-1") }));
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer });
  service.transition({ tenant, contributionId: id, kind: "review", actor: maintainer });
  const accepted = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(accepted.accepted);
  // The Lab seam exposes READS ONLY — the fake's facts table cannot be
  // written through the service (no mutation path exists by construction),
  // and the recorded facts are unchanged: the ladder is Lab-owned.
  const factsAfter = gaps.gaps.factsOf(fakeGapLink("gap-accept", "cycle-1"));
  assert.deepEqual(factsAfter, {
    exists: true,
    resolved: false,
    blocked: false,
    communityRungReached: true,
  });
  // The service consulted the seam only for the linked submission (1),
  // never during the workflow: acceptance is recorded here, the Lab's
  // rung bookkeeping happens in the Lab's own adapter.
  assert.equal(gaps.reads(), 2);
});

test("gap linkage: malformed gap links refuse the submission", () => {
  const { service } = makeService();
  const result = service.submit(
    submitCommand({ gap: { gapId: "not a slug", cycleId: "cycle-1" } as never }),
  );
  assert.ok(!result.accepted);
  assert.equal(result.code, "invalid-gap-link");
});
