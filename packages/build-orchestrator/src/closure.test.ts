/**
 * Package-closure adjudication tests (R19 build gate): fail-closed
 * composition of lock loading, fingerprint integrity, deterministic
 * resolution and the provenance/licensing gate — plus the provenance
 * aggregation helpers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDigest, computeLockFingerprint } from "@playliquid/package-system";
import type { ContentDigest, PackageLock } from "@playliquid/package-system";
import { createFakeBuildSource } from "./fakes.ts";
import {
  adjudicateClosure,
  closureModelProvenance,
  closureProvenance,
  closureRecords,
} from "./closure.ts";
import {
  fixtureLock,
  fixturePackageRecord,
  fixtureRecords,
} from "./fixtures.ts";

function locksOf(...locks: readonly PackageLock[]): Map<ContentDigest, PackageLock> {
  const map = new Map<ContentDigest, PackageLock>();
  for (const lock of locks) {
    map.set(computeLockFingerprint(lock), lock);
  }
  return map;
}

test("a sound lock resolves and passes the R19 gate", () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const admission = adjudicateClosure(createFakeBuildSource({ records, locks: locksOf(lock) }), computeLockFingerprint(lock));
  assert.equal(admission.ok, true);
  if (admission.ok) {
    assert.equal(admission.closure.lockFingerprint, computeLockFingerprint(lock));
    assert.equal(admission.closure.provenanceGate.pass, true);
    assert.equal(closureRecords(admission.closure).length, records.length);
    assert.equal(closureProvenance(admission.closure).length, records.length);
  }
});

test("an unresolvable lock fingerprint is a typed lock-unavailable refusal", () => {
  const records = fixtureRecords();
  const lock = fixtureLock(records);
  const admission = adjudicateClosure(createFakeBuildSource({ records, locks: locksOf(lock) }), fixtureDigestOf("never-pinned"));
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.code, "lock-unavailable");
    assert.match(admission.message, /no longer resolvable/);
  }
});

test("a tampered lock under a stale fingerprint fails the integrity check", () => {
  const records = fixtureRecords();
  const honestLock = fixtureLock(records);
  const tamperedLock = fixtureLock([fixturePackageRecord("fixture-extra-pack")]);
  const pinned = computeLockFingerprint(honestLock);
  // The lock table serves DIFFERENT content under the pinned fingerprint.
  const admission = adjudicateClosure(
    createFakeBuildSource({ records: [...records, ...fixtureRecords()], locks: new Map([[pinned, tamperedLock]]) }),
    pinned,
  );
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.code, "lock-fingerprint-mismatch");
    assert.match(admission.message, /tamper check/);
  }
});

test("a declared (unverified) license fails the R19 gate with per-package reasons", () => {
  const records = [
    fixturePackageRecord("fixture-assets-pack"),
    fixturePackageRecord("fixture-unlicensed-pack", { licenseStatus: "declared" }),
  ];
  const lock = fixtureLock(records);
  const admission = adjudicateClosure(createFakeBuildSource({ records, locks: locksOf(lock) }), computeLockFingerprint(lock));
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.code, "provenance-gate-failed");
    assert.equal(admission.provenanceReasons?.length ?? 0, 1);
    assert.equal(admission.provenanceReasons?.[0]?.packageId, "fixture-unlicensed-pack");
    assert.match(admission.message, /R19 fail-closed/);
  }
});

test("model provenance is aggregated across the closure (R19 transparency)", () => {
  const records = [
    fixturePackageRecord("fixture-assets-pack"),
    fixturePackageRecord("fixture-ai-pack", { generatedByAi: true }),
  ];
  const lock = fixtureLock(records);
  const admission = adjudicateClosure(createFakeBuildSource({ records, locks: locksOf(lock) }), computeLockFingerprint(lock));
  assert.equal(admission.ok, true);
  if (admission.ok) {
    const aggregation = closureModelProvenance(admission.closure);
    assert.equal(aggregation.generatedByAi, true);
    assert.equal(aggregation.entries.length, 1);
    assert.equal(aggregation.entries[0]?.model, "fixture-model");
  }
  // A closure without AI participation reports it truthfully.
  const humanOnly = adjudicateClosure(
    createFakeBuildSource({ records: fixtureRecords(), locks: locksOf(fixtureLock(fixtureRecords())) }),
    computeLockFingerprint(fixtureLock(fixtureRecords())),
  );
  assert.equal(humanOnly.ok, true);
  if (humanOnly.ok) {
    const aggregation = closureModelProvenance(humanOnly.closure);
    assert.equal(aggregation.generatedByAi, false);
    assert.equal(aggregation.entries.length, 0);
  }
});

test("a lock pinning an unknown package is a resolution failure (package-system's own code)", () => {
  const known = fixtureRecords();
  const ghostLock: PackageLock = fixtureLock([fixturePackageRecord("fixture-ghost-pack")]);
  const admission = adjudicateClosure(
    createFakeBuildSource({ records: known, locks: locksOf(ghostLock) }),
    computeLockFingerprint(ghostLock),
  );
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.code, "resolution-failed");
    assert.equal(typeof admission.resolutionCode, "string");
  }
});

/** A digest-derived content digest (fixtures never hand-write digests). */
function fixtureDigestOf(seed: string): ContentDigest {
  return computeDigest({ fixture: seed });
}
