/**
 * State document + snapshot tests (E6): content-addressed snapshots and
 * the fail-closed restore verification chain.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import { BUILD_ORCHESTRATOR_AUTHORITY } from "./events.ts";
import type { BuildEvent } from "./events.ts";
import { snapshotOf, verifySnapshot } from "./document.ts";
import type { BuildOrchestratorDocument, StoredBuildSnapshot } from "./document.ts";
import { asTenantId } from "./tenancy.ts";

function event(buildId: string, sequence: number): BuildEvent {
  return {
    kind: "build-orchestrator-event",
    authority: BUILD_ORCHESTRATOR_AUTHORITY,
    tenant: asTenantId("tenant-a"),
    buildId,
    sequence,
    at: 1_000 + sequence,
    type: "phase-transition",
    phase: "queued",
    detail: { from: "queued", to: "resolve" },
  };
}

function document(over: Partial<BuildOrchestratorDocument> = {}): BuildOrchestratorDocument {
  return {
    revision: 2,
    tenants: ["tenant-a"],
    encounters: [],
    builds: [],
    events: [event("bld-a", 1), event("bld-a", 2)],
    limitations: [],
    ...over,
  };
}

test("snapshotOf is content-addressed and deterministic", () => {
  const first = snapshotOf(document());
  const second = snapshotOf(document());
  assert.equal(first.snapshotId, second.snapshotId);
  assert.equal(first.revision, 2);
  // The document payload is canonical JSON: byte-stable across serializations.
  assert.equal(first.document, canonicalJson(document()));
  assert.equal(first.snapshotId, computeDigest(first.document));
});

test("any state change moves the snapshot id", () => {
  const base = snapshotOf(document());
  const bumped = snapshotOf(document({ revision: 3 }));
  const extraEvent = snapshotOf(document({ events: [event("bld-a", 1), event("bld-a", 2), event("bld-a", 3)] }));
  assert.notEqual(base.snapshotId, bumped.snapshotId);
  assert.notEqual(base.snapshotId, extraEvent.snapshotId);
});

test("a sound snapshot verifies and yields the parsed document", () => {
  const snapshot = snapshotOf(document());
  const verification = verifySnapshot(snapshot);
  assert.equal(verification.ok, true);
  if (verification.ok) {
    assert.equal(verification.document.revision, 2);
    assert.equal(verification.document.events.length, 2);
  }
});

test("non-JSON and non-document snapshots are refused as malformed", () => {
  const malformed = verifySnapshot({ snapshotId: computeDigest("x"), revision: 0, document: "{not json" });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.equal(malformed.code, "snapshot-malformed");
  }
  const notADocument = verifySnapshot({
    snapshotId: computeDigest(canonicalJson({ hello: "world" })),
    revision: 0,
    document: canonicalJson({ hello: "world" }),
  });
  assert.equal(notADocument.ok, false);
  if (!notADocument.ok) {
    assert.equal(notADocument.code, "snapshot-malformed");
  }
});

test("a tampered document fails its content address (digest mismatch)", () => {
  const snapshot = snapshotOf(document());
  const parsed = JSON.parse(snapshot.document) as BuildOrchestratorDocument;
  const tamperedDoc: BuildOrchestratorDocument = { ...parsed, revision: 999 };
  const tampered: StoredBuildSnapshot = {
    snapshotId: snapshot.snapshotId,
    revision: snapshot.revision,
    document: canonicalJson(tamperedDoc),
  };
  const verification = verifySnapshot(tampered);
  assert.equal(verification.ok, false);
  if (!verification.ok) {
    assert.equal(verification.code, "snapshot-digest-mismatch");
    assert.match(verification.message, /content-addressed/);
  }
});

test("an append-only violation inside an otherwise-valid snapshot is refused", () => {
  const snapshot = snapshotOf(document());
  const parsed = JSON.parse(snapshot.document) as BuildOrchestratorDocument;
  // Break the per-build sequence discipline but RE-COMPUTE the content
  // address, so the refusal provably comes from the log discipline, not
  // the digest check.
  const resealedDoc: BuildOrchestratorDocument = {
    ...parsed,
    events: [event("bld-a", 1), { ...event("bld-a", 7) }],
  };
  const resealed: StoredBuildSnapshot = {
    snapshotId: computeDigest(canonicalJson(resealedDoc)) as ContentDigest,
    revision: snapshot.revision,
    document: canonicalJson(resealedDoc),
  };
  const verification = verifySnapshot(resealed);
  assert.equal(verification.ok, false);
  if (!verification.ok) {
    assert.equal(verification.code, "event-log-corrupt");
    assert.match(verification.message, /append-only/);
  }
});
