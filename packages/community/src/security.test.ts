/**
 * THE E8 SECURITY BATTERY — negative paths for the trust model
 * ("third-party packages, AI-generated code, avatar brains and external
 * tools are untrusted until qualified", architecture "Security"):
 *
 * 1. forged provenance (tampered lineage node ids, non-kernel payloads,
 *    missing AI disclosure);
 * 2. cross-tenant injection attempts;
 * 3. history tampering (mutated snapshots, swapped record ids, mutated
 *    read-model copies leaking into owned state);
 * 4. unqualified-artifact promotion (accept refused while the lineage
 *    base is unpublished or provenance-failing);
 * 5. duplicate submission replays (E10 receipts, per-tenant scoping).
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
  fakeLineageNode,
  fakePayload,
  ids,
} from "./fakes.ts";
import { asContributionId } from "./records.ts";
import { computeDigest } from "@playliquid/package-system";

const tenant = ids.tenant("tenant-alpha");
const tenantB = ids.tenant("tenant-beta");
const contributor = ids.subject("player-one");
const maintainer = ids.subject("mod-one");

function makeService() {
  const store = createMemoryCommunityStore();
  const clock = createFixedClock();
  const directory = createMemorySubjectDirectory();
  directory.register(tenant, contributor);
  directory.registerMaintainer(tenant, maintainer);
  const packages = createMemoryPackageRegistry();
  const service = new CommunityService({
    store: store.store,
    clock: clock.clock,
    directory: directory.directory,
    gaps: createMemoryGapDirectory().gaps,
    packages: packages.registry,
    policy: { maxOpenContributionsPerContributor: 10 },
  });
  return { store, clock, directory, packages, service };
}

function submitCommand(over: Partial<SubmitContributionCommand> = {}): SubmitContributionCommand {
  return {
    tenant,
    contributor,
    kind: "package",
    payload: fakePayload({ title: "pack" }),
    provenance: { origin: { kind: "original" }, aiGenerated: false },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Forged provenance
// ---------------------------------------------------------------------------

test("security: a forged lineage node id is refused at intake", () => {
  const { service } = makeService();
  const real = fakeLineageNode("base-pack");
  const forged = { coordinate: real.coordinate, nodeId: computeDigest({ forged: "id" }) };
  const result = service.submit(
    submitCommand({ provenance: { origin: { kind: "lineage-derived", base: forged }, aiGenerated: false } }),
  );
  assert.ok(!result.accepted);
  assert.equal(result.code, "invalid-lineage-node");
  assert.equal(service.contributionsOf(tenant).length, 0);
});

test("security: a non-kernel payload is refused at intake", () => {
  const { service } = makeService();
  const result = service.submit(submitCommand({ payload: { definitely: "not a kernel value" } as never }));
  assert.ok(!result.accepted);
  assert.equal(result.code, "invalid-payload");
  assert.equal(service.contributionsOf(tenant).length, 0);
});

test("security: AI-generated content without disclosure is refused at intake", () => {
  const { service } = makeService();
  const result = service.submit(
    submitCommand({ provenance: { origin: { kind: "original" }, aiGenerated: true, modelProvenance: [] } }),
  );
  assert.ok(!result.accepted);
  assert.equal(result.code, "ai-disclosure-missing");
  assert.equal(service.contributionsOf(tenant).length, 0);
});

test("security: a malformed provenance object is refused, never recorded", () => {
  const { service } = makeService();
  const result = service.submit(submitCommand({ provenance: { origin: null } as never }));
  assert.ok(!result.accepted);
  assert.equal(result.code, "invalid-provenance");
  assert.equal(service.contributionsOf(tenant).length, 0);
});

// ---------------------------------------------------------------------------
// 2. Cross-tenant injection
// ---------------------------------------------------------------------------

test("security: cross-tenant submissions and foreign maintainer probes refuse without mutation", () => {
  const { service } = makeService();
  const foreignSubmit = service.submit(submitCommand({ tenant: tenantB }));
  assert.ok(!foreignSubmit.accepted && foreignSubmit.code === "unknown-contributor");
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const foreignMaintainer = ids.subject("mod-beta");
  const probe = service.transition({
    tenant,
    contributionId: submitted.contribution.contributionId,
    kind: "triage",
    actor: foreignMaintainer,
  });
  assert.ok(!probe.accepted);
  assert.ok(probe.code === "not-a-maintainer" || probe.code === "invalid-actor");
  assert.equal(service.contribution(tenant, submitted.contribution.contributionId)?.status, "submitted");
  assert.equal(service.contributionsOf(tenantB).length, 0);
});

// ---------------------------------------------------------------------------
// 3. History tampering
// ---------------------------------------------------------------------------

test("security: a tampered snapshot body is refused on restore", () => {
  const { service, store } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const snapshot = service.snapshot();
  assert.ok(snapshot.ok);
  // Tamper: change the recorded status inside the stored document bytes.
  const stored = store.store.load(snapshot.snapshotId)!;
  const tampered = stored.document.replace('"status":"submitted"', '"status":"accepted"');
  assert.notEqual(tampered, stored.document);
  // A second service sharing the tampered store entry must refuse the
  // restore whole — the contribution id no longer addresses its content.
  const evil = { ...stored, document: tampered };
  const directory = createMemorySubjectDirectory();
  directory.register(tenant, contributor);
  directory.registerMaintainer(tenant, maintainer);
  const victim = new CommunityService({
    store: { save: () => {}, list: () => [evil], load: () => evil },
    clock: createFixedClock().clock,
    directory: directory.directory,
    gaps: createMemoryGapDirectory().gaps,
    packages: createMemoryPackageRegistry().registry,
    policy: { maxOpenContributionsPerContributor: 10 },
  });
  const refused = victim.restore();
  assert.ok(!refused.ok);
  assert.equal(refused.code, "malformed-snapshot");
  // The victim's state stayed empty — no partial adoption.
  assert.equal(victim.contributionsOf(tenant).length, 0);
});

test("security: a swapped transition record id is refused on restore", () => {
  const { service, store } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const snapshot = service.snapshot();
  assert.ok(snapshot.ok);
  const stored = store.store.load(snapshot.snapshotId)!;
  // Swap the genesis record id with a foreign digest: the row's content
  // address no longer matches its id.
  const foreign = computeDigest({ foreign: true });
  const tampered = stored.document.replace(
    stored.document.match(/"recordId":"(sha256:[0-9a-f]{64})"/)![1]!,
    String(foreign),
  );
  assert.notEqual(tampered, stored.document);
  const evil = { ...stored, document: tampered };
  const directory = createMemorySubjectDirectory();
  directory.register(tenant, contributor);
  directory.registerMaintainer(tenant, maintainer);
  const victim = new CommunityService({
    store: { save: () => {}, list: () => [evil], load: () => evil },
    clock: createFixedClock().clock,
    directory: directory.directory,
    gaps: createMemoryGapDirectory().gaps,
    packages: createMemoryPackageRegistry().registry,
    policy: { maxOpenContributionsPerContributor: 10 },
  });
  const refused = victim.restore();
  assert.ok(!refused.ok);
  assert.equal(refused.code, "malformed-snapshot");
});

test("security: mutating a returned read model never touches owned state", () => {
  const { service } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const record = service.contribution(tenant, submitted.contribution.contributionId);
  assert.ok(record);
  // Mutate the COPY deeply (bypassing readonly at the type level — an
  // attacker does not respect types).
  const mutable = record as unknown as Record<string, unknown>;
  mutable.status = "accepted";
  mutable.payload = { kind: "string", value: "hacked" };
  (mutable.provenance as Record<string, unknown>).aiGenerated = true;
  // Owned state is untouched.
  const fresh = service.contribution(tenant, submitted.contribution.contributionId);
  assert.ok(fresh);
  assert.equal(fresh.status, "submitted");
  assert.equal((fresh.payload as { fields: { title?: { value?: string } } }).fields.title?.value, "pack");
  assert.equal(fresh.provenance.aiGenerated, false);
  // History entries are copies too.
  const history = service.history(tenant, submitted.contribution.contributionId);
  (history[0] as unknown as Record<string, unknown>).to = "accepted";
  assert.equal(service.history(tenant, submitted.contribution.contributionId)[0]!.to, "submitted");
});

// ---------------------------------------------------------------------------
// 4. Unqualified-artifact promotion
// ---------------------------------------------------------------------------

test("security: an unpublished lineage base cannot be promoted to accepted", () => {
  const { service } = makeService();
  const base = fakeLineageNode("unpublished-pack");
  const submitted = service.submit(
    submitCommand({ provenance: { origin: { kind: "lineage-derived", base }, aiGenerated: false } }),
  );
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer });
  service.transition({ tenant, contributionId: id, kind: "review", actor: maintainer });
  const promotion = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(!promotion.accepted);
  assert.equal(promotion.code, "unknown-lineage-base");
  assert.equal(service.contribution(tenant, id)?.status, "under-review");
});

test("security: a provenance-failing lineage base cannot be promoted to accepted", () => {
  const { service, packages } = makeService();
  const base = fakeLineageNode("failing-pack");
  packages.publish(base.coordinate, false);
  const submitted = service.submit(
    submitCommand({ provenance: { origin: { kind: "lineage-derived", base }, aiGenerated: false } }),
  );
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer });
  service.transition({ tenant, contributionId: id, kind: "review", actor: maintainer });
  const promotion = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(!promotion.accepted);
  assert.equal(promotion.code, "lineage-base-unqualified");
  // Rejection remains available to close the untrusted contribution.
  const rejected = service.transition({ tenant, contributionId: id, kind: "reject", actor: maintainer, reason: "unqualified base" });
  assert.ok(rejected.accepted);
});

test("security: accept before review is structurally impossible", () => {
  const { service } = makeService();
  const submitted = service.submit(submitCommand());
  assert.ok(submitted.accepted);
  const id = submitted.contribution.contributionId;
  const fromSubmitted = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(!fromSubmitted.accepted && fromSubmitted.code === "invalid-transition");
  service.transition({ tenant, contributionId: id, kind: "triage", actor: maintainer });
  const fromTriaged = service.transition({ tenant, contributionId: id, kind: "accept", actor: maintainer });
  assert.ok(!fromTriaged.accepted && fromTriaged.code === "invalid-transition");
  assert.equal(service.contribution(tenant, id)?.status, "triaged");
});

// ---------------------------------------------------------------------------
// 5. Duplicate submission replays
// ---------------------------------------------------------------------------

test("security: replaying a submission returns the first receipt and mutates nothing", () => {
  const { service } = makeService();
  const first = service.submit(submitCommand());
  assert.ok(first.accepted);
  const replay = service.submit(submitCommand());
  assert.ok(!replay.accepted);
  assert.equal(replay.code, "duplicate-contribution");
  assert.ok(replay.recorded !== undefined);
  assert.equal(replay.recorded!.to, "submitted");
  // Exactly one record, one history entry.
  assert.equal(service.contributionsOf(tenant).length, 1);
  assert.equal(service.history(tenant, first.contribution.contributionId).length, 1);
});

test("security: the same content under another tenant is NOT a duplicate", () => {
  const { service, directory } = makeService();
  const other = ids.subject("player-two");
  directory.register(tenantB, other);
  const one = service.submit(submitCommand());
  assert.ok(one.accepted);
  const two = service.submit(submitCommand({ tenant: tenantB, contributor: other }));
  assert.ok(two.accepted, "per-tenant scoping: distinct submission spaces");
  assert.notEqual(String(one.contribution.contributionId), String(two.contribution.contributionId));
});

test("security: a receipt is retrievable by submission digest (E10)", () => {
  const { service } = makeService();
  const first = service.submit(submitCommand());
  assert.ok(first.accepted);
  const receipt = service.receipt(first.contribution.contributionId);
  assert.ok(receipt);
  assert.equal(receipt.to, "submitted");
  assert.equal(receipt.decidedBy, "platform-authority");
  const unknown = service.receipt(asContributionId(computeDigest({ no: "such" }))!);
  assert.equal(unknown, undefined);
});
