/**
 * Service state document + snapshot tests (E6): content-addressed snapshot
 * roundtrip, tamper detection and torn-snapshot refusal (never healed, E8).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@playliquid/build-orchestrator";
import { asEngineId } from "@playliquid/build-contracts";
import { snapshotOfDocument, verifyMultiTargetSnapshot, isMultiTargetDocument } from "./snapshot.ts";
import type { MultiTargetBuildsDocument } from "./snapshot.ts";

const tenant = asTenantId("tenant-alpha");

function documentFixture(): MultiTargetBuildsDocument {
  return {
    revision: 3,
    tenants: ["tenant-alpha"],
    encounters: [{ key: "tenant-alpha|builder-agent|n1", tenant, requester: "builder-agent", nonce: "n1", requestFingerprint: "sha256:" + "a".repeat(64), recordId: "mtb-1" }],
    plans: [
      {
        kind: "multi-target-fanout-plan",
        planId: "sha256:" + "b".repeat(64),
        tenant,
        requestFingerprint: "sha256:" + "a".repeat(64),
        entries: [],
        refusals: [],
      },
    ],
    outcomes: [
      {
        kind: "durable-target-outcome",
        planKey: `sha256:${"b".repeat(64)}|web`,
        storeKey: "mtb-1#web",
        originRecordId: "mtb-1",
        target: "web",
        engineId: asEngineId("playcanvas"),
        result: { admitted: false, intakeRefusal: { code: "invalid-command", message: "x" } },
        snapshot: null,
        recordedAt: 5,
      },
    ],
    records: [
      {
        kind: "multi-target-build-record",
        recordId: "mtb-1",
        tenant,
        requester: "builder-agent",
        planId: "sha256:" + "b".repeat(64),
        requestFingerprint: "sha256:" + "a".repeat(64),
        verdict: "refused",
        outcomes: [],
        refusals: [],
        provenance: [],
        verification: [],
        recordDigest: "sha256:" + "c".repeat(64),
        completedAt: 6,
      },
    ],
  };
}

test("a snapshot roundtrips through its content address (E6)", () => {
  const snapshot = snapshotOfDocument(documentFixture());
  const verification = verifyMultiTargetSnapshot(snapshot);
  assert.equal(verification.ok, true);
  if (verification.ok) {
    assert.deepEqual(verification.document, documentFixture());
  }
});

test("a tampered document fails the digest check (E8; never healed)", () => {
  const snapshot = snapshotOfDocument(documentFixture());
  const parsed = JSON.parse(snapshot.document) as MultiTargetBuildsDocument;
  const tamperedDocument: MultiTargetBuildsDocument = { ...parsed, revision: 99 };
  const tampered = { ...snapshot, document: JSON.stringify(tamperedDocument) };
  const verification = verifyMultiTargetSnapshot(tampered);
  assert.equal(verification.ok, false);
  if (!verification.ok) {
    assert.equal(verification.code, "snapshot-digest-mismatch");
  }
});

test("invalid JSON and wrong shapes are refused snapshot-malformed (total; no throws)", () => {
  const notJson = verifyMultiTargetSnapshot({ snapshotId: "sha256:" + "0".repeat(64), revision: 1, document: "{not json" });
  assert.equal(notJson.ok, false);
  if (!notJson.ok) {
    assert.equal(notJson.code, "snapshot-malformed");
  }
  const wrongShape = verifyMultiTargetSnapshot({ snapshotId: "sha256:" + "0".repeat(64), revision: 1, document: JSON.stringify({ hello: "world" }) });
  assert.equal(wrongShape.ok, false);
  if (!wrongShape.ok) {
    assert.equal(wrongShape.code, "snapshot-malformed");
  }
});

test("isMultiTargetDocument guards the structural essentials (restore input is untrusted)", () => {
  assert.equal(isMultiTargetDocument(documentFixture()), true);
  assert.equal(isMultiTargetDocument(null), false);
  assert.equal(isMultiTargetDocument("junk"), false);
  assert.equal(isMultiTargetDocument({ revision: -1, tenants: [], encounters: [], plans: [], outcomes: [], records: [] }), false);
  assert.equal(isMultiTargetDocument({ revision: 1, tenants: [], encounters: [null], plans: [], outcomes: [], records: [] }), false);
  assert.equal(isMultiTargetDocument({ revision: 1, tenants: [], encounters: [], plans: ["plan"], outcomes: [], records: [] }), false);
  assert.equal(isMultiTargetDocument({ revision: 1, tenants: [], encounters: [], plans: [], outcomes: ["outcome"], records: [] }), false);
  assert.equal(isMultiTargetDocument({ revision: 1, tenants: [], encounters: [], plans: [], outcomes: [], records: [{}] }), false);
});
