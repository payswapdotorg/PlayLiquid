/**
 * DETERMINISM TESTS (E9) — the canonical journey run TWICE must produce the
 * IDENTICAL evidence: same journal (every entry, every digest), same chain
 * head, same content-addressed journey document (PL-040).
 *
 * Anything derived from a wall clock, a random source or object-identity
 * iteration anywhere in the walked surfaces would surface here — the
 * digests are content-derived over the canonical JSON of every recorded
 * fact, and the document seal pins the whole run.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCanonicalLabArenaJourney } from "./journey.ts";

test("determinism (E9): the canonical journey run twice seals the identical document", async () => {
  const first = await runCanonicalLabArenaJourney();
  const second = await runCanonicalLabArenaJourney();
  assert.deepEqual(first.document, second.document, "the journey documents are deep-equal");
  assert.equal(first.document.documentDigest, second.document.documentDigest);
});

test("determinism (E9): the append-only journals are entry-for-entry identical", async () => {
  const first = await runCanonicalLabArenaJourney();
  const second = await runCanonicalLabArenaJourney();
  assert.equal(first.journal.size(), second.journal.size());
  assert.deepEqual(first.journal.entries(), second.journal.entries(), "same steps, same facts, same digests, same order");
  assert.equal(first.journal.headDigest(), second.journal.headDigest(), "the chain heads match");
  assert.equal(first.journal.verify() && second.journal.verify(), true, "both chains re-verify");
});

test("determinism (E9): the phase facts are stable across runs", async () => {
  const first = await runCanonicalLabArenaJourney();
  const second = await runCanonicalLabArenaJourney();
  assert.deepEqual(first.facts, second.facts, "the typed facts projections are deep-equal");
  assert.equal(
    first.facts.lab.signalsDigest,
    second.facts.lab.signalsDigest,
    "the learning signals fold digests identically",
  );
  assert.equal(
    first.facts.community.contributionId,
    second.facts.community.contributionId,
    "the contribution id is content-addressed identically",
  );
});
