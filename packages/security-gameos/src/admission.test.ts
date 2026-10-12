/**
 * ADMISSION TESTS (PL-041 composing PL-011) — the fail-closed package
 * admission gates over the REAL registry + CAS + release-gate oracles,
 * through the REAL rig: the passing pin, the digest-mismatch pin, the
 * missing package, the unlicensed record, the provenance gap, the
 * corrupted CAS bytes, the malformed requests, the role gate — every
 * refusal typed (E8) and recorded in the ledger (E10).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { admitPackageRecord, createSecurityRig } from "./index.ts";
import type { SecurityRig } from "./index.ts";
import { RIG_ADMIN, RIG_AUDITOR, RIG_OUTSIDER, RIG_TENANT, RIG_FOREIGN_TENANT } from "./rig.ts";

const rig: SecurityRig = await createSecurityRig();

function pin(record: SecurityRig["packages"]["good"], digest = record.identity.contentDigest) {
  return {
    tenant: RIG_TENANT,
    kind: record.identity.kind,
    id: record.identity.id,
    version: "1.0.0",
    contentDigest: digest,
  };
}

test("admission: the gate-passing record is admitted", () => {
  const result = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, pin(rig.packages.good));
  assert.ok(result.admitted);
  assert.equal(result.record.identity.id, "asset.rig-kit");
  assert.equal(result.verifiedArtifacts, 0);
});

test("admission: a pinned digest that does not match the registry record is refused digest-mismatch", () => {
  const forged = `sha256:${"a".repeat(64)}`;
  const result = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, pin(rig.packages.good, forged));
  assert.ok(!result.admitted);
  assert.equal(result.code, "digest-mismatch");
  assert.ok(result.detail.includes("expects digest"));
});

test("admission: an unpublished coordinate is refused missing-package", () => {
  const result = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, {
    tenant: RIG_TENANT,
    kind: "assets",
    id: "asset.rig-never-published",
    version: "1.0.0",
    contentDigest: `sha256:${"1".repeat(64)}`,
  });
  assert.ok(!result.admitted);
  assert.equal(result.code, "missing-package");
});

test("admission: an unlicensed record is refused license-unverified (R19, verbatim)", () => {
  const result = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, pin(rig.packages.unlicensed));
  assert.ok(!result.admitted);
  assert.equal(result.code, "license-unverified");
  assert.ok(result.reasons?.some((reason) => reason.code === "license-unverified"));
});

test("admission: a provenance gap is refused provenance-incomplete (R19, verbatim)", () => {
  const result = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, pin(rig.packages.provenanceGap));
  assert.ok(!result.admitted);
  assert.equal(result.code, "provenance-incomplete");
  assert.ok(result.reasons?.some((reason) => reason.code === "provenance-incomplete"));
});

test("admission: corrupted CAS bytes fail closed with integrity (E10, verbatim)", () => {
  rig.blobStore.corruptChunkForTests(rig.packages.good.identity.contentDigest, 0);
  const result = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, pin(rig.packages.good));
  assert.ok(!result.admitted);
  assert.equal(result.code, "integrity");
});

test("admission: malformed pins are refused invalid-request (fail-closed shape gates)", () => {
  const badDigest = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, pin(rig.packages.good, "not-a-digest"));
  assert.ok(!badDigest.admitted && badDigest.code === "invalid-request");

  const badVersion = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, {
    ...pin(rig.packages.good),
    version: "not.semver",
  });
  assert.ok(!badVersion.admitted && badVersion.code === "invalid-request");

  const noTenant = rig.authority.admitPackage(RIG_ADMIN, RIG_TENANT, {
    ...pin(rig.packages.good),
    tenant: "",
  });
  assert.ok(!noTenant.admitted && noTenant.code === "invalid-request");
});

test("admission: a subject without the rights-admin role is refused not-authorized", () => {
  const result = rig.authority.admitPackage(RIG_OUTSIDER, RIG_TENANT, pin(rig.packages.unlicensed));
  assert.ok(!result.admitted);
  assert.equal(result.code, "not-authorized");
});

test("admission: the rights-admin role of ANOTHER tenant never admits here (R20)", () => {
  const result = rig.authority.admitPackage(RIG_ADMIN, RIG_FOREIGN_TENANT, {
    ...pin(rig.packages.unlicensed),
    tenant: RIG_FOREIGN_TENANT,
  });
  assert.ok(!result.admitted);
  assert.equal(result.code, "not-authorized");
  assert.ok(result.detail.includes("cross-tenant-request"));
});

test("admission E10: every admission refusal is recorded in the ledger with its typed code", () => {
  const ledger = rig.authority.ledger(RIG_AUDITOR, RIG_TENANT);
  assert.ok(ledger.ok);
  const codes = new Set(ledger.records.map((record) => record.code));
  for (const code of [
    "digest-mismatch",
    "missing-package",
    "license-unverified",
    "provenance-incomplete",
    "integrity",
    "not-authorized",
  ]) {
    assert.ok(codes.has(code), `ledger is missing a ${code} record`);
  }
  // …and every record carries the refusal evidence (E8: typed, not swallowed).
  for (const record of ledger.records) {
    assert.ok(typeof record.refusalId === "string" && record.refusalId.startsWith("refusal-"));
    assert.ok(record.tenant === RIG_TENANT);
  }
});

test("admission E9: the pure gate is deterministic (same pin → deep-equal verdict)", () => {
  const deps = { registry: rig.registry, artifacts: rig.artifacts };
  const first = admitPackageRecord(pin(rig.packages.unlicensed), deps);
  const second = admitPackageRecord(pin(rig.packages.unlicensed), deps);
  assert.deepEqual(first, second);
  assert.ok(!first.admitted && first.code === "license-unverified");
});
