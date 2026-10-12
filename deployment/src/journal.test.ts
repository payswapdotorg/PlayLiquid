/**
 * THE DEPLOYMENT JOURNAL TESTS (PL-044) — the append-only history (E10):
 * chained entries, idempotent duplicate seals, the refusing edit door,
 * tamper-refusing restore, and the E9 determinism of the chain.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createFixedClock } from "../../services/ops/src/index.ts";
import { appendDeploymentJournalEntry, DeploymentJournalService, deploymentJournalEntryOf, verifyDeploymentJournal, DEPLOYMENT_JOURNAL_GENESIS } from "./journal.ts";
import type { DeploymentJournalEntry } from "./journal.ts";

function clock() {
  return createFixedClock(10_000);
}

function aJournal(): readonly DeploymentJournalEntry[] {
  let journal: readonly DeploymentJournalEntry[] = [];
  journal = appendDeploymentJournalEntry(journal, { at: 1, kind: "verified", planId: "plan-a", planDigest: "a".repeat(64), sealDigest: "1".repeat(64) });
  journal = appendDeploymentJournalEntry(journal, { at: 2, kind: "refused", planId: "plan-b", planDigest: "b".repeat(64), refusal: { code: "unknown-artifact", detail: "refused" } });
  journal = appendDeploymentJournalEntry(journal, { at: 3, kind: "verified", planId: "plan-c", planDigest: "c".repeat(64), sealDigest: "3".repeat(64) });
  return journal;
}

test("the chain verifies: seq starts at 1, prevDigest links from genesis, digests recompute", () => {
  const journal = aJournal();
  const verification = verifyDeploymentJournal(journal);
  assert.ok(verification.ok);
  assert.equal(verification.length, 3);
  assert.equal(journal[0]?.prevDigest, DEPLOYMENT_JOURNAL_GENESIS);
  assert.equal(journal[2]?.prevDigest, journal[1]?.digest);
});

test("E9 determinism: the same appends rebuild the identical chain, run twice", () => {
  assert.deepEqual(aJournal(), aJournal());
  assert.equal(verifyDeploymentJournal(aJournal()).ok && verifyDeploymentJournal(aJournal()).ok, true);
});

test("E8/E10: any edit to a past entry breaks the chain — kind, plan, seal, facts, seq order", () => {
  const journal = aJournal();
  const edits: readonly DeploymentJournalEntry[][] = [
    journal.map((entry) => (entry.seq === 2 ? { ...entry, kind: "verified" } : entry)),
    journal.map((entry) => (entry.seq === 1 ? { ...entry, planId: "plan-forged" } : entry)),
    journal.map((entry) => (entry.seq === 3 ? { ...entry, sealDigest: "9".repeat(64) } : entry)),
    journal.map((entry) => (entry.seq === 2 ? { ...entry, facts: { injected: true } } : entry)),
    [journal[1] as DeploymentJournalEntry, journal[0] as DeploymentJournalEntry, journal[2] as DeploymentJournalEntry],
  ];
  for (const edited of edits) {
    const verification = verifyDeploymentJournal(edited);
    assert.ok(!verification.ok, "an edited journal must not verify");
    assert.ok(verification.code === "broken-chain" || verification.code === "broken-sequence");
  }
  const reMinted = journal.map((entry) => (entry.seq === 1 ? deploymentJournalEntryOf({ ...entry, at: entry.at + 1 }) : entry));
  assert.ok(!verifyDeploymentJournal(reMinted).ok, "re-minting an entry (fresh digest over new content) breaks the chain");
});

test("E10: the service appends only — re-recording the same seal is an idempotent duplicate that grows nothing", () => {
  const journal = new DeploymentJournalService(clock());
  const first = journal.record({ planDigest: "a".repeat(64), sealDigest: "1".repeat(64) }, { planId: "plan-a" });
  assert.ok(first.ok && !first.duplicate && first.entry.seq === 1);
  const duplicate = journal.record({ planDigest: "a".repeat(64), sealDigest: "1".repeat(64) }, { planId: "plan-a" });
  assert.ok(duplicate.ok && duplicate.duplicate);
  assert.equal(journal.entries().length, 1);
  const second = journal.record({ planDigest: "c".repeat(64), sealDigest: "3".repeat(64) }, { planId: "plan-c" });
  assert.ok(second.ok && !second.duplicate && second.entry.seq === 2);
});

test("E10: the amend door ALWAYS refuses, for every sequence and payload shape", () => {
  const journal = new DeploymentJournalService(clock());
  journal.record({ planDigest: "a".repeat(64), sealDigest: "1".repeat(64) }, { planId: "plan-a" });
  for (const attempt of [
    { seq: 1, patch: { planId: "plan-forged" } },
    { seq: 99, patch: {} },
    { seq: 0, patch: { sealDigest: "9".repeat(64) } },
  ]) {
    const refused = journal.amendEntry(attempt.seq, attempt.patch);
    assert.ok(!refused.ok && refused.code === "journal-immutable");
  }
  assert.ok(journal.verify().ok);
  assert.equal(journal.entries().length, 1);
});

test("E6/E10: restore adopts only a fully verifying chain — empty, tampered and re-minted journals refuse", () => {
  const journal = new DeploymentJournalService(clock());
  const empty = journal.restore([]);
  assert.ok(!empty.ok && empty.code === "empty-journal");
  const tampered = aJournal().map((entry) => (entry.seq === 2 ? { ...entry, at: 999 } : entry));
  const refused = journal.restore(tampered);
  assert.ok(!refused.ok && refused.code === "broken-chain");
  assert.equal(journal.entries().length, 0, "a refused restore adopts nothing");
  const adopted = journal.restore(aJournal());
  assert.ok(adopted.ok && adopted.entries === 3);
  assert.ok(journal.verify().ok);
});
