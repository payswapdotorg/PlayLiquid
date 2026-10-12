/**
 * THE E8 NEGATIVE CORPUS (PL-044, MANDATORY) — every hostile row is a
 * TYPED refusal that mutates nothing:
 *
 *   R1  tampered artifact digest (flipped hex char)  → unknown-artifact
 *   R2  missing license evidence (R19)              → license-unverified /
 *                                                     invalid-record
 *   R3  cross-tenant scope (R20, unit + grant)       → cross-tenant-scope
 *   R4  unknown health door                         → unknown-health-door
 *   R5  journal edit attempts (E10)                  → journal-immutable /
 *                                                     broken-chain
 *
 * plus the defense-in-depth rows (unknown target, unavailable profile,
 * rights outside the lattice, a lying registry door, honesty violations).
 * After EVERY refusal the good plan still verifies through the same
 * doors — refusals mutate nothing (E8).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createFixedClock } from "../../services/ops/src/index.ts";
import { asSubjectId, asTenantId } from "../../packages/platform-contracts/src/index.ts";
import { createRegistryIndex } from "../../packages/package-registry/src/index.ts";
import { createCorpusDoors, honestTopologyPlan, sealCorpusRecord } from "./corpus.ts";
import { verifyDeploymentPlan } from "./verifier.ts";
import type { DeploymentPlan } from "./model.ts";
import { deploymentPlanDigest } from "./model.ts";
import { DeploymentJournalService } from "./journal.ts";
import { appendDeploymentJournalEntry, deploymentJournalEntryOf, verifyDeploymentJournal } from "./journal.ts";
import {
  createHostileDoors,
  hostileDoorsWithBadRecord,
  lyingRegistryDoor,
  planWithCrossTenantScope,
  planWithTamperedArtifactDigest,
  planWithUnknownHealthDoor,
  recordWithEmptyHistory,
  recordWithUndisclosedModel,
  recordWithUnverifiedLicense,
  tamperedRecord,
  withUnitPatched,
} from "./fixtures.ts";

function doors() {
  return createCorpusDoors();
}

function clock() {
  return createFixedClock(10_000);
}

/** E8: a refusal must be typed and mutate nothing — the good plan still verifies. */
function assertRefusal(refused: ReturnType<typeof verifyDeploymentPlan>, code: string, label: string) {
  assert.ok(!refused.ok, `${label} must refuse`);
  assert.equal(refused.code, code, `${label} refusal code`);
  const stillGood = verifyDeploymentPlan(honestTopologyPlan(), { doors: doors(), clock: clock() });
  assert.ok(stillGood.ok, `${label} mutated nothing: the good plan still verifies (E8)`);
}

test("R1/E8: a tampered artifact digest (one flipped hex char) refuses unknown-artifact", () => {
  const tampered = planWithTamperedArtifactDigest("unit-ops-service");
  assertRefusal(verifyDeploymentPlan(tampered, { doors: doors(), clock: clock() }), "unknown-artifact", "flipped digest char");
});

test("R1/E8: a lying registry door resolving a tampered record refuses tampered-artifact", () => {
  const bad = tamperedRecord("playliquid.tampered");
  const plan = withUnitPatched(honestTopologyPlan(), "unit-ops-service", (unit) => ({ ...unit, artifactDigest: bad.identity.contentDigest }));
  const result = verifyDeploymentPlan(plan, { doors: { registry: lyingRegistryDoor(bad), cas: doors().cas, profiles: doors().profiles }, clock: clock() });
  assertRefusal(result, "tampered-artifact", "lying registry with a tampered record");
});

test("R2/E8/R19: an UNVERIFIED license refuses the release gate the verifier re-runs itself (relaxed registry admitted it)", () => {
  const bad = recordWithUnverifiedLicense("playliquid.unverified-license");
  const hostile = hostileDoorsWithBadRecord(bad);
  const plan = withUnitPatched(honestTopologyPlan(), "unit-ops-service", (unit) => ({ ...unit, artifactDigest: bad.identity.contentDigest }));
  const result = verifyDeploymentPlan(plan, { doors: hostile, clock: clock() });
  assert.ok(!result.ok && result.code === "license-unverified", `expected license-unverified, got ${result.ok ? "ok" : result.code}`);
  const stillGood = verifyDeploymentPlan(honestTopologyPlan(), { doors: doors(), clock: clock() });
  assert.ok(stillGood.ok);
});

test("R2/E8/R19: a record with literally NO license cannot even be admitted — the registry refuses it structurally", () => {
  const missing = sealCorpusRecord("playliquid.no-license", { license: { spdxExpression: "", status: "unknown" } });
  const relaxed = createRegistryIndex({ enforceReleaseGate: false });
  const published = relaxed.publish(missing);
  assert.ok(!published.ok);
  assert.equal(published.code, "invalid-record");
});

test("R2/E8/R19: an empty transformation history refuses provenance-incomplete", () => {
  const bad = recordWithEmptyHistory("playliquid.no-history");
  const hostile = hostileDoorsWithBadRecord(bad);
  const plan = withUnitPatched(honestTopologyPlan(), "unit-build-orchestrator", (unit) => ({ ...unit, artifactDigest: bad.identity.contentDigest }));
  const result = verifyDeploymentPlan(plan, { doors: hostile, clock: clock() });
  assert.ok(!result.ok && result.code === "provenance-incomplete", `expected provenance-incomplete, got ${result.ok ? "ok" : result.code}`);
});

test("R2/E8/R19: undisclosed AI generation refuses model-provenance-missing", () => {
  const bad = recordWithUndisclosedModel("playliquid.undisclosed-model");
  const hostile = hostileDoorsWithBadRecord(bad);
  const plan = withUnitPatched(honestTopologyPlan(), "unit-web-host", (unit) => ({ ...unit, artifactDigest: bad.identity.contentDigest }));
  const result = verifyDeploymentPlan(plan, { doors: hostile, clock: clock() });
  assert.ok(!result.ok && result.code === "model-provenance-missing", `expected model-provenance-missing, got ${result.ok ? "ok" : result.code}`);
});

test("R3/E8/R20: a unit of ANOTHER tenant refuses cross-tenant-scope", () => {
  const foreign = asTenantId("tenant-foreign")!;
  const plan: DeploymentPlan = { ...honestTopologyPlan(), units: honestTopologyPlan().units.map((unit, index) => (index === 0 ? { ...unit, tenant: foreign } : unit)) };
  assertRefusal(verifyDeploymentPlan(plan, { doors: doors(), clock: clock() }), "cross-tenant-scope", "foreign-tenant unit");
});

test("R3/E8/R20: a foreign-tenant GRANT inside a unit refuses cross-tenant-scope", () => {
  const plan = planWithCrossTenantScope("unit-platform-economy", "tenant-foreign");
  assertRefusal(verifyDeploymentPlan(plan, { doors: doors(), clock: clock() }), "cross-tenant-scope", "foreign-tenant grant");
});

test("R3/E8/R20: a submitter without a rights-admin grant refuses not-authorized; a foreign grant refuses cross-tenant-request", () => {
  const noGrant: DeploymentPlan = { ...honestTopologyPlan(), submittedBy: { subject: honestTopologyPlan().submittedBy.subject, grants: [] } };
  assertRefusal(verifyDeploymentPlan(noGrant, { doors: doors(), clock: clock() }), "not-authorized", "unauthorized submitter");
  const foreignGrant: DeploymentPlan = {
    ...honestTopologyPlan(),
    submittedBy: { subject: honestTopologyPlan().submittedBy.subject, grants: [{ tenant: asTenantId("tenant-foreign")!, subject: honestTopologyPlan().submittedBy.subject, role: "rights-admin" }] },
  };
  assertRefusal(verifyDeploymentPlan(foreignGrant, { doors: doors(), clock: clock() }), "cross-tenant-request", "foreign rights-admin grant");
});

test("R4/E8: an unknown readiness door refuses unknown-health-door; an empty or duplicated gate list refuses too", () => {
  assertRefusal(verifyDeploymentPlan(planWithUnknownHealthDoor("unit-web-host"), { doors: doors(), clock: clock() }), "unknown-health-door", "unknown door");
  const empty = withUnitPatched(honestTopologyPlan(), "unit-web-host", (unit) => ({ ...unit, healthGates: [] }));
  assertRefusal(verifyDeploymentPlan(empty, { doors: doors(), clock: clock() }), "invalid-plan", "empty gate list");
  const duplicated = withUnitPatched(honestTopologyPlan(), "unit-web-host", (unit) => ({ ...unit, healthGates: ["web-host-composition", "web-host-composition"] }));
  assertRefusal(verifyDeploymentPlan(duplicated, { doors: doors(), clock: clock() }), "duplicate-health-door", "duplicated door");
});

test("E8: an unknown target refuses unknown-target; an unpublished profile bundle refuses profile-unavailable", () => {
  const offTaxonomy = withUnitPatched(honestTopologyPlan(), "unit-web-host", (unit) => ({ ...unit, target: "gamecube" as DeploymentPlan["units"][number]["target"] }));
  assertRefusal(verifyDeploymentPlan(offTaxonomy, { doors: doors(), clock: clock() }), "unknown-target", "off-taxonomy target");
  const noBundle = createHostileDoors([], []);
  const result = verifyDeploymentPlan(honestTopologyPlan(), { doors: noBundle, clock: clock() });
  assert.ok(!result.ok && result.code === "profile-unavailable", `expected profile-unavailable, got ${result.ok ? "ok" : result.code}`);
});

test("E8/R20: a rights scope outside the lattice refuses invalid-rights-scope", () => {
  const outside = withUnitPatched(honestTopologyPlan(), "unit-platform-integrity", (unit) => ({
    ...unit,
    rightsScope: [{ tenant: unit.tenant, subject: unit.rightsScope[0]?.subject ?? asSubjectId("subject-x")!, capability: "root" as never, permissions: ["escalate" as never] }],
  }));
  assertRefusal(verifyDeploymentPlan(outside, { doors: doors(), clock: clock() }), "invalid-rights-scope", "grant outside the lattice");
});

test("E11/E8: a plan claiming network/infrastructure refuses honesty-violation", () => {
  const dishonest = { ...honestTopologyPlan(), truth: { realInfrastructure: false, network: true, containers: false, secretsManagement: false } };
  assertRefusal(verifyDeploymentPlan(dishonest, { doors: doors(), clock: clock() }), "honesty-violation", "network claim");
});

test("R5/E8/E10: journal edit attempts are typed refusals that mutate nothing", () => {
  const journal = new DeploymentJournalService(clock());
  const verified = verifyDeploymentPlan(honestTopologyPlan(), { doors: doors(), clock: clock() });
  assert.ok(verified.ok);
  const recorded = journal.record(verified.seal, honestTopologyPlan());
  assert.ok(recorded.ok && !recorded.duplicate);
  const second = journal.record({ planDigest: "c".repeat(64), sealDigest: "3".repeat(64) }, { planId: "plan-c" });
  assert.ok(second.ok && second.entry.seq === 2);
  // The service's edit door refuses by construction…
  const amend = journal.amendEntry(1, { planId: "plan-forged" });
  assert.ok(!amend.ok && amend.code === "journal-immutable");
  // …and the pure chain verifier refuses an edited copy…
  const edited = journal.entries().map((entry) => (entry.seq === 1 ? { ...entry, planId: "plan-forged" } : entry));
  const chain = verifyDeploymentJournal(edited);
  assert.ok(!chain.ok && chain.code === "broken-chain");
  // …and a removed entry…
  const removed = journal.entries().slice(1);
  const sequence = verifyDeploymentJournal(removed);
  assert.ok(!sequence.ok && sequence.code === "broken-sequence");
  // …while the LIVE journal still verifies untouched.
  assert.ok(journal.verify().ok);
  assert.equal(journal.entries().length, 2);
  assert.equal(journal.entries()[0]?.planId, honestTopologyPlan().planId);
});

test("E8: refusals are recorded as refused journal entries with the code verbatim (E10), and a broken journal never restores", () => {
  const journal = new DeploymentJournalService(clock());
  const tampered = planWithTamperedArtifactDigest("unit-ops-service");
  const refusal = verifyDeploymentPlan(tampered, { doors: doors(), clock: clock() });
  assert.ok(!refusal.ok);
  const recorded = journal.recordRefusal({ planId: tampered.planId, planDigest: deploymentPlanDigest(tampered) }, { code: refusal.code, detail: refusal.detail });
  assert.ok(recorded.ok && recorded.entry.kind === "refused");
  assert.equal(recorded.entry.refusal?.code, "unknown-artifact");
  // A second entry makes the chain two-long; editing the FIRST now breaks it…
  const grown = appendDeploymentJournalEntry(journal.entries(), { at: 10_500, kind: "refused", planId: "plan-y", planDigest: "d".repeat(64), refusal: { code: "cross-tenant-scope", detail: "y" } });
  const broken = grown.map((entry) => (entry.seq === 1 ? deploymentJournalEntryOf({ ...entry, at: entry.at + 5 }) : entry));
  const restore = journal.restore(broken);
  assert.ok(!restore.ok && restore.code === "broken-chain");
  // The honest journal (append-only) restores cleanly.
  const clean = journal.restore(appendDeploymentJournalEntry(journal.entries(), { at: 11_000, kind: "refused", planId: "plan-x", planDigest: "0".repeat(64), refusal: { code: "not-authorized", detail: "x" } }));
  assert.ok(clean.ok && clean.entries === 2);
});
