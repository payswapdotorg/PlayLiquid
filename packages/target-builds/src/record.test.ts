/**
 * Multi-target build record tests: content-addressed sealing, tamper
 * detection (E8), the canonical audit form and the target → build-document
 * digest mapping.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/build-orchestrator";
import { asEngineId } from "@playliquid/build-contracts";
import { computeRecordDigest, documentDigestMapping, mintRecordId, sealMultiTargetRecord, verifyMultiTargetRecord, canonicalRecordForm } from "./record.ts";
import type { MultiTargetBuildRecord } from "./record.ts";
import { outcomeOfResult } from "./outcomes.ts";
import { fixtureDigest } from "./fixtures.ts";
import type { TargetBuildResult } from "./outcomes.ts";

const tenant = asTenantId("tenant-alpha");
const playcanvas = asEngineId("playcanvas");
const digest = fixtureDigest("some-document");

function baseOutcome(target: string, documentDigest: string | null) {
  if (documentDigest === null) {
    return outcomeOfResult(target as never, playcanvas, { admitted: false, intakeRefusal: { code: "unresolvable-input", message: "x" } });
  }
  const result: TargetBuildResult = {
    admitted: true,
    phase: "succeeded",
    buildId: "bld-1",
    documentDigest,
    manifestDigest: fixtureDigest("manifest"),
    artifacts: [],
    stageDigests: [],
    evidence: [],
    failure: null,
    awaitingEvidence: false,
  };
  return outcomeOfResult(target as never, playcanvas, result);
}

function recordFixture(): MultiTargetBuildRecord {
  return sealMultiTargetRecord({
    kind: "multi-target-build-record",
    recordId: "mtb-1",
    tenant,
    requester: "builder-agent",
    planId: fixtureDigest("plan"),
    requestFingerprint: fixtureDigest("request"),
    verdict: "partial",
    outcomes: [baseOutcome("web", digest), baseOutcome("windows", null)],
    refusals: [{ target: "console", code: "sdk-gated", message: "gated" }],
    provenance: [],
    verification: [],
    completedAt: 1_700_000_000_000,
  });
}

test("a sealed record verifies against its content (E9)", () => {
  const record = recordFixture();
  assert.equal(verifyMultiTargetRecord(record), true);
  assert.equal(record.recordDigest, computeRecordDigest({ ...record, recordDigest: undefined } as never));
});

test("any tampered field breaks the seal (E8 tamper detection)", () => {
  for (const tamper of [
    (record: MultiTargetBuildRecord) => ({ ...record, verdict: "succeeded" as const }),
    (record: MultiTargetBuildRecord) => ({ ...record, tenant: asTenantId("tenant-beta") }),
    (record: MultiTargetBuildRecord) => ({ ...record, outcomes: record.outcomes.slice(0, 1) }),
    (record: MultiTargetBuildRecord) => ({ ...record, refusals: [] }),
  ]) {
    assert.equal(verifyMultiTargetRecord(tamper(recordFixture())), false);
  }
});

test("a mismatched digest string never verifies (fail closed)", () => {
  const record = recordFixture();
  assert.equal(verifyMultiTargetRecord({ ...record, recordDigest: fixtureDigest("forged") }), false);
  assert.equal(verifyMultiTargetRecord(null as never), false);
});

test("the canonical audit form is deterministic JSON", () => {
  const first = canonicalRecordForm(recordFixture());
  const second = canonicalRecordForm(recordFixture());
  assert.equal(first, second);
  const parsed = JSON.parse(first) as MultiTargetBuildRecord;
  assert.equal(parsed.kind, "multi-target-build-record");
  assert.equal(parsed.outcomes.length, 2);
});

test("documentDigestMapping maps every bound target to its build document digest", () => {
  const mapping = documentDigestMapping(recordFixture());
  assert.equal(mapping.web, digest);
  assert.equal(mapping.windows, null);
  assert.equal(Object.keys(mapping).length, 2);
});

test("mintRecordId is deterministic over its components and distinct otherwise (E9)", () => {
  const planId = fixtureDigest("plan");
  assert.equal(mintRecordId("tenant-a", planId, "builder", "n1"), mintRecordId("tenant-a", planId, "builder", "n1"));
  assert.notEqual(mintRecordId("tenant-a", planId, "builder", "n1"), mintRecordId("tenant-a", planId, "builder", "n2"));
  assert.notEqual(mintRecordId("tenant-a", planId, "builder", "n1"), mintRecordId("tenant-b", planId, "builder", "n1"));
  assert.notEqual(mintRecordId("tenant-a", planId, "builder", "n1"), mintRecordId("tenant-a", planId, "other", "n1"));
  assert.ok(mintRecordId("tenant-a", planId, "builder", "n1").startsWith("mtb-"));
});
