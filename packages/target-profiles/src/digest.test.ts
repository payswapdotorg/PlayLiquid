/**
 * Profile digest integrity: seal/append discipline, order invariance
 * (E9), and tamper detection (E8).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProfileDigest, sealTargetProfileRecord, verifyTargetProfileDigest } from "./digest.ts";
import type { UnsealedTargetProfileRecord } from "./records.ts";
import { validateTargetProfileRecord } from "./records.ts";
import { fixtureWebRecord } from "./fixtures.ts";

test("sealed fixture records verify against their content", () => {
  const record = fixtureWebRecord();
  assert.equal(verifyTargetProfileDigest(record), true);
  assert.equal(validateTargetProfileRecord(record).ok, true);
});

test("sealing is pure: the unsealed input is never mutated", () => {
  const record = fixtureWebRecord();
  const unsealed = { ...record } as unknown as UnsealedTargetProfileRecord;
  delete (unsealed as Partial<Record<string, unknown>>).profileDigest;
  const sealed = sealTargetProfileRecord(unsealed);
  assert.equal("profileDigest" in unsealed, false);
  assert.equal(typeof sealed.profileDigest, "string");
  assert.equal(verifyTargetProfileDigest(sealed), true);
});

test("tampering with any sealed field breaks verification (E8)", () => {
  const record = fixtureWebRecord();
  assert.equal(verifyTargetProfileDigest({ ...record, version: "9.9.9" }), false);
  assert.equal(
    verifyTargetProfileDigest({
      ...record,
      capabilities: { ...record.capabilities, vramClass: "high" },
    }),
    false,
  );
  assert.equal(
    verifyTargetProfileDigest({ ...record, engineBindings: { ...record.engineBindings, engines: [] } }),
    false,
  );
  assert.equal(verifyTargetProfileDigest({ ...record, supersedes: record.profileDigest }), false);
});

test("digest computation is declaration-order invariant (E9)", () => {
  const record = fixtureWebRecord();
  const reordered = {
    ...record,
    // Lists with different order must seal identically.
    engineBindings: {
      pinnedBindings: null,
      engines: [...record.engineBindings.engines].reverse(),
    },
    capabilities: {
      ...record.capabilities,
      inputModalities: [...record.capabilities.inputModalities].reverse(),
    },
  };
  const a = { ...record } as unknown as UnsealedTargetProfileRecord;
  delete (a as Partial<Record<string, unknown>>).profileDigest;
  const b = reordered as unknown as UnsealedTargetProfileRecord;
  delete (b as Partial<Record<string, unknown>>).profileDigest;
  assert.equal(computeProfileDigest(a), computeProfileDigest(b));
});

test("different content seals to different digests", () => {
  const record = fixtureWebRecord();
  const a = { ...record } as unknown as UnsealedTargetProfileRecord;
  delete (a as Partial<Record<string, unknown>>).profileDigest;
  const b = { ...record, version: "1.0.1" } as unknown as UnsealedTargetProfileRecord;
  delete (b as Partial<Record<string, unknown>>).profileDigest;
  assert.notEqual(computeProfileDigest(a), computeProfileDigest(b));
});

test("revisions append: a superseding record seals and verifies on its own", () => {
  const first = fixtureWebRecord();
  const revisionUnsealed = {
    ...first,
    version: "1.0.1",
    supersedes: first.profileDigest,
  } as unknown as UnsealedTargetProfileRecord;
  delete (revisionUnsealed as Partial<Record<string, unknown>>).profileDigest;
  const revision = sealTargetProfileRecord(revisionUnsealed);
  assert.equal(verifyTargetProfileDigest(revision), true);
  assert.equal(validateTargetProfileRecord(revision).ok, true);
  assert.equal(revision.supersedes, first.profileDigest);
  // The first record remains intact (immutable history).
  assert.equal(verifyTargetProfileDigest(first), true);
});

test("digests use the sha256:<hex> wire format shared with package-system", () => {
  const record = fixtureWebRecord();
  assert.match(record.profileDigest, /^sha256:[0-9a-f]{64}$/);
});
