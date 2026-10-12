/**
 * Multi-target build request tests: total structural validation (E1/E8),
 * the canonical target enumeration (E9), the content fingerprint (E9) and
 * the per-target nonce derivation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asBuildNonce, asRequesterId, asToolOperationId, asToolchainProfileId } from "@playliquid/build-contracts";
import type { BuildParameters } from "@playliquid/build-contracts";
import { computeLockFingerprint } from "@playliquid/package-system";
import {
  canonicalTargets,
  computeMultiTargetRequestFingerprint,
  multiTargetEncounterKey,
  perTargetNonce,
  validateMultiTargetBuildRequest,
} from "./request.ts";
import type { MultiTargetBuildRequest } from "./request.ts";
import { fixtureDigest, fixtureLock, fixtureRecords, fixtureVendorSdkEvidence } from "./fixtures.ts";

const lock = fixtureLock(fixtureRecords());

function parameters(): BuildParameters {
  return { kind: "record", fields: { "include-debug": { kind: "bool", value: false } } };
}

function wellFormed(overrides: Partial<MultiTargetBuildRequest> = {}): MultiTargetBuildRequest {
  return {
    kind: "multi-target-build-request",
    requester: asRequesterId("builder-agent"),
    nonce: asBuildNonce("mtb-nonce-0001"),
    pins: {
      gameIr: fixtureDigest("game-ir-composition"),
      packageLock: { lockFingerprint: computeLockFingerprint(lock), pinnedPackageCount: lock.packages.length },
      toolchain: {
        profileId: asToolchainProfileId("multi-target-toolchain"),
        profileDigest: fixtureDigest("toolchain-profile"),
        citesToolOperations: ["build", "test", "package"].map((operation) => asToolOperationId(operation)),
      },
    },
    targets: ["web", "windows"],
    parameters: parameters(),
    requestedAt: 1_700_000_000_000,
    ...overrides,
  };
}

test("a well-formed multi-target request validates ok", () => {
  const validation = validateMultiTargetBuildRequest(wellFormed());
  assert.equal(validation.ok, true);
});

test("non-objects and wrong kinds are refused (total; never throws)", () => {
  for (const hostile of [null, undefined, 42, "request", {}]) {
    const validation = validateMultiTargetBuildRequest(hostile as MultiTargetBuildRequest);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.equal(validation.reasons[0]?.code, "invalid-requester");
    }
  }
});

test("each invalid field yields its typed violation code (reasons aggregate)", () => {
  const validation = validateMultiTargetBuildRequest(
    wellFormed({
      requester: "" as never,
      nonce: "" as never,
      pins: { gameIr: "not-a-digest" } as never,
      targets: [],
      parameters: { kind: "bool", value: true } as never,
      requestedAt: -1,
    }),
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.deepEqual(
      validation.reasons.map((reason) => reason.code),
      ["invalid-requester", "invalid-nonce", "invalid-pins", "invalid-targets", "invalid-parameters", "invalid-requested-at"],
    );
  }
});

test("a malformed evidence pool is refused fail-closed (E8)", () => {
  const validation = validateMultiTargetBuildRequest(
    wellFormed({ evidence: [fixtureVendorSdkEvidence("vendor-x"), null as never] }),
  );
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reasons.some((reason) => reason.code === "invalid-evidence"), true);
  }
});

test("a passing vendor evidence pool validates", () => {
  const validation = validateMultiTargetBuildRequest(
    wellFormed({ evidence: [fixtureVendorSdkEvidence("vendor-x")] }),
  );
  assert.equal(validation.ok, true);
});

test("canonicalTargets deduplicates and sorts lexicographically (E9)", () => {
  assert.deepEqual(canonicalTargets(wellFormed({ targets: ["windows", "web", "windows", "android"] })), [
    "android",
    "web",
    "windows",
  ]);
});

test("the content fingerprint is deterministic over content only (E9)", () => {
  const base = wellFormed();
  assert.equal(computeMultiTargetRequestFingerprint(base), computeMultiTargetRequestFingerprint(base));
  // The identity fields are NOT content: replays and re-runs map to the same plan.
  assert.equal(
    computeMultiTargetRequestFingerprint(wellFormed({ requester: asRequesterId("other-agent"), nonce: asBuildNonce("other-nonce"), requestedAt: 42 })),
    computeMultiTargetRequestFingerprint(base),
  );
  // The out-of-band evidence pool is NOT content (E6: same plan, better evidence).
  assert.equal(computeMultiTargetRequestFingerprint(wellFormed({ evidence: [fixtureVendorSdkEvidence("vendor-x")] })), computeMultiTargetRequestFingerprint(base));
  // Order-insensitive target enumeration.
  assert.equal(computeMultiTargetRequestFingerprint(wellFormed({ targets: ["windows", "web"] })), computeMultiTargetRequestFingerprint(base));
});

test("the content fingerprint changes when the content changes", () => {
  const base = computeMultiTargetRequestFingerprint(wellFormed());
  assert.notEqual(computeMultiTargetRequestFingerprint(wellFormed({ targets: ["web"] })), base);
  assert.notEqual(
    computeMultiTargetRequestFingerprint(wellFormed({ parameters: { kind: "record", fields: { "include-debug": { kind: "bool", value: true } } } })),
    base,
  );
  assert.notEqual(
    computeMultiTargetRequestFingerprint(
      wellFormed({ pins: { gameIr: fixtureDigest("other-composition"), packageLock: { lockFingerprint: computeLockFingerprint(lock), pinnedPackageCount: 0 }, toolchain: { profileId: asToolchainProfileId("other-toolchain"), profileDigest: fixtureDigest("toolchain-profile"), citesToolOperations: [] } } }),
    ),
    base,
  );
});

test("the encounter key is tenant-scoped and compositional (R20/E6)", () => {
  const a = multiTargetEncounterKey("tenant-a", wellFormed());
  const b = multiTargetEncounterKey("tenant-b", wellFormed());
  assert.notEqual(a, b);
  assert.equal(a, "tenant-a|builder-agent|mtb-nonce-0001");
  assert.notEqual(a, multiTargetEncounterKey("tenant-a", wellFormed({ nonce: asBuildNonce("mtb-nonce-0002") })));
  assert.notEqual(a, multiTargetEncounterKey("tenant-a", wellFormed({ requester: asRequesterId("other-agent") })));
});

test("the per-target nonce is deterministic and names its target", () => {
  const request = wellFormed();
  assert.equal(perTargetNonce(request, "web"), "mtb-nonce-0001#web");
  assert.equal(perTargetNonce(request, "windows"), "mtb-nonce-0001#windows");
  assert.notEqual(perTargetNonce(request, "web"), perTargetNonce(request, "windows"));
  // Long nonces degrade to a deterministic digest form instead of exceeding the id budget.
  const long = wellFormed({ nonce: asBuildNonce("n".repeat(300)) });
  const derived = perTargetNonce(long, "web");
  assert.ok(derived.startsWith("mtb#"));
  assert.ok(derived.length <= 256);
});
