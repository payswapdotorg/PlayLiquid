/**
 * Derivation ledger tests (E10): append-only semantics, unknown-source
 * refusal, rewrite refusal, order preservation, and source immutability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asTimestamp } from "@playliquid/runtime-contracts";
import { computeDigest } from "@playliquid/package-system";
import { InMemoryDerivationLedger, sealReplayDerivation } from "./derivation.ts";
import { captureOriginScenario } from "./test-fixtures.ts";

function derivation(sourceReplayId: string, kind: string, salt: string) {
  return sealReplayDerivation({
    sourceReplayId,
    kind,
    artifactDigest: computeDigest({ kind, salt }),
    derivedAt: asTimestamp(2000),
    derivedBy: "integrity-service",
  });
}

test("derivation: appends accumulate per source in append order", () => {
  const scenario = captureOriginScenario("s-derivation");
  const ledger = new InMemoryDerivationLedger((id) => scenario.store.loadReplay(id) !== undefined);
  const first = derivation(scenario.record.replayId, "highlight", "one");
  const second = derivation(scenario.record.replayId, "integrity-report", "two");
  assert.equal(ledger.append(first).ok, true);
  assert.equal(ledger.append(second).ok, true);
  const listed = ledger.listBySource(scenario.record.replayId);
  assert.deepEqual(
    listed.map((d) => d.derivationId),
    [first.derivationId, second.derivationId],
  );
  assert.equal(ledger.size, 2);
});

test("derivation: derivations of unknown source records are refused", () => {
  const scenario = captureOriginScenario("s-derivation-2");
  const ledger = new InMemoryDerivationLedger((id) => scenario.store.loadReplay(id) !== undefined);
  const orphan = derivation("replay-" + "0".repeat(64), "highlight", "x");
  const verdict = ledger.append(orphan);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "unknown-source");
  assert.deepEqual(ledger.listBySource(orphan.sourceReplayId), []);
});

test("derivation: conflicting rewrites of an existing derivation are refused (E10)", () => {
  const scenario = captureOriginScenario("s-derivation-3");
  const ledger = new InMemoryDerivationLedger((id) => scenario.store.loadReplay(id) !== undefined);
  const original = derivation(scenario.record.replayId, "highlight", "one");
  assert.equal(ledger.append(original).ok, true);
  // Same identity is IMPOSSIBLE to forge with different content (the id is
  // content-addressed), so we attack through the ledger directly: a
  // hand-built derivation reusing the id with different fields.
  const forged = {
    derivationId: original.derivationId,
    sourceReplayId: original.sourceReplayId,
    kind: "highlight-v2",
    artifactDigest: computeDigest({ kind: "highlight", salt: "other" }),
    derivedAt: original.derivedAt,
    derivedBy: original.derivedBy,
  };
  const verdict = ledger.append(forged);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "derivation-rewrite");
  // Idempotent re-append of the SAME derivation stays accepted.
  assert.equal(ledger.append(original).ok, true);
  assert.equal(ledger.size, 1);
});

test("derivation: malformed derivations fail validation", () => {
  assert.throws(() =>
    sealReplayDerivation({
      sourceReplayId: "replay-" + "1".repeat(64),
      kind: "",
      artifactDigest: computeDigest({ kind: "x" }),
      derivedAt: asTimestamp(1),
      derivedBy: "someone",
    }),
  );
  assert.throws(() =>
    sealReplayDerivation({
      sourceReplayId: "replay-" + "1".repeat(64),
      kind: "ok",
      artifactDigest: "not-a-digest",
      derivedAt: asTimestamp(1),
      derivedBy: "someone",
    }),
  );
  assert.throws(() =>
    sealReplayDerivation({
      sourceReplayId: "",
      kind: "ok",
      artifactDigest: computeDigest({ kind: "x" }),
      derivedAt: asTimestamp(1),
      derivedBy: "someone",
    }),
  );
});

test("derivation: appending never mutates the source record (E10)", () => {
  const scenario = captureOriginScenario("s-derivation-4");
  const before = JSON.stringify(scenario.record);
  const ledger = new InMemoryDerivationLedger((id) => scenario.store.loadReplay(id) !== undefined);
  for (let i = 0; i < 3; i += 1) {
    const ok = ledger.append(derivation(scenario.record.replayId, "note", `n-${i}`));
    assert.equal(ok.ok, true);
  }
  const after = JSON.stringify(scenario.store.loadReplay(scenario.record.replayId));
  assert.equal(after, before);
});

test("derivation: sealed derivations are frozen", () => {
  const d = derivation("replay-" + "2".repeat(64), "highlight", "s");
  assert.throws(() => {
    (d as unknown as { kind: string }).kind = "tampered";
  }, TypeError);
});
