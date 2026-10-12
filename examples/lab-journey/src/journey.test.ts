/**
 * THE CANONICAL JOURNEY TESTS (E5/E10/E11) — the reference walk asserted
 * step by step over the REAL public surfaces (PL-040).
 *
 * What this file IS: end-to-end proof that `runCanonicalLabArenaJourney()`
 * walks the whole product thesis in-process over the real services and
 * ports (lab-organization/search + lab-simulation + lab-learning +
 * arena-integration-runtime + community), recording every step into the
 * append-only hash-chained journal and sealing a content-addressed
 * document.
 *
 * What this file is NOT (E11, stated plainly): there is no DOM, no
 * rendering, no network and no real Arena provider anywhere here — the
 * Arena wire terminates at arena-integration's deterministic in-memory
 * transport fake, and the community ports are the package's own
 * deterministic fakes. The first test asserts the no-DOM fact executably.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCanonicalLabArenaJourney } from "./journey.ts";

test("canonical journey (E11): runs real services + real ports in-process — no DOM, no network, no rendering", async () => {
  const globals = globalThis as Record<string, unknown>;
  assert.equal(globals.window, undefined, "no DOM window in this runtime");
  assert.equal(globals.document, undefined, "no DOM document in this runtime");
  const run = await runCanonicalLabArenaJourney();
  assert.equal(run.document.kind, "lab-arena-community-journey");
  assert.ok(run.document.documentDigest.startsWith("sha256:"), "the journey document is content-addressed");
});

test("canonical journey (E5): the Lab phase walks the real loop end-to-end", async () => {
  const run = await runCanonicalLabArenaJourney();
  const lab = run.facts.lab;
  assert.ok(lab.searchId.startsWith("lab-search-"), "a real search session was opened");
  assert.ok(lab.streamSize > 1, "the seeded candidate stream emitted more than the baseline");
  assert.equal(lab.evidenceRows.length, 2, "the baseline + spread evaluations were recorded");
  assert.ok(
    lab.evidenceRows.every((row) => row.epistemic === "labeled-estimate" && row.method === "simulation"),
    "E11: every PL-028 evaluation is a labeled estimate by type — never ground truth",
  );
  assert.equal(lab.learningRecords.length, 2, "both cycles sealed learning records");
  assert.deepEqual(
    lab.learningRecords.map((record) => record.sequence),
    [1, 2],
    "the learning fold advances monotonically",
  );
  assert.match(lab.signalsDigest, /^[0-9a-f]{64}$/, "the signals fold carries its bare-hex content-addressed digest (E9)");
  assert.notEqual(lab.guidanceDigests.observed, lab.guidanceDigests.estimate, "the disjoint E11 guidance classes digest differently");
  assert.deepEqual(
    lab.rungsWalked,
    ["alternate-organization", "package-platform-capability", "user-community-contribution", "arena-escalation"],
    "the ladder advanced ONE RUNG AT A TIME after the existing organization",
  );
});

test("canonical journey (E5): the Arena phase adjudicates the decided escalation end-to-end", async () => {
  const run = await runCanonicalLabArenaJourney();
  const arena = run.facts.arena;
  assert.equal(arena.duplicate, false, "the decided escalation opened a fresh case");
  assert.deepEqual(
    arena.lifecycleTrail,
    ["draft->authorized", "authorized->sent", "sent->responded", "responded->ingested"],
    "the case drove through the full arena-integration lifecycle to INGESTED",
  );
  assert.equal(arena.evidenceVerdict, "admitted", "the evidence package was admitted");
  assert.ok(
    arena.labels.every((label) => label.epistemic === "arena-external"),
    "E11: every ingested payload carries the structurally-disjoint arena-external marker",
  );
  assert.ok(
    arena.labels.some((label) => label.externalClass === "external-validated-result") &&
      arena.labels.some((label) => label.externalClass === "external-evidence"),
    "the declared return classes are labeled",
  );
  assert.equal(arena.escalationRef.external, "arena-external", "the ladder's arena rung carries the provider-neutral ref (lock 32)");
  assert.ok(arena.escalationRef.escalationId.startsWith("arena-esc-"));
});

test("canonical journey (E5): the Community phase curates the Arena outcome — the thesis loop closed", async () => {
  const run = await runCanonicalLabArenaJourney();
  const community = run.facts.community;
  assert.equal(community.status, "accepted", "the contribution reached the accepted verdict");
  assert.deepEqual(
    community.trail,
    ["null->submitted", "submitted->triaged", "triaged->under-review", "under-review->accepted"],
    "the frozen workflow walked submit → triage → review → accept (E10 history)",
  );
  assert.equal(community.provenance.originKind, "lineage-derived", "the provenance chain cites its lineage base");
  assert.ok(community.provenance.baseCoordinate.length > 0, "the base coordinate is content-addressed");
  assert.equal(community.provenance.aiGenerated, false, "the Arena outcome honestly discloses no AI generation");
  assert.equal(community.provenance.gapId, run.facts.lab.gapId, "the R18 gap link points at the discovered gap");
  assert.equal(community.gapFacts.exists, true, "the Lab-backed seam resolved the linked gap");
  assert.equal(community.gapFacts.communityRungReached, true, "the ladder had walked to the community rung");
  assert.equal(community.gapFacts.resolved, false, "the gap stays open — the ladder walked past community to Arena");
});

test("canonical journey (E10): the journal is append-only, hash-chained and verifies", async () => {
  const run = await runCanonicalLabArenaJourney();
  const entries = run.journal.entries();
  assert.ok(entries.length >= 20, "every user-visible step landed in the journal");
  assert.equal(run.journal.verify(), true, "the whole chain re-derives (the tamper oracle)");
  let previous = "";
  for (const entry of entries) {
    assert.equal(entry.prevDigest, previous, `entry ${String(entry.seq)} chains onto its predecessor`);
    assert.equal(entry.seq, entries.indexOf(entry) + 1, "sequence numbers are admission order");
    previous = entry.entryDigest;
  }
  assert.equal(new Set(entries.map((entry) => entry.entryDigest)).size, entries.length, "no two entries share a digest");
  const skip = entries.find((entry) => entry.step === "gap-rung-skip-refused");
  assert.ok(skip, "the authoritative rung-skip refusal is recorded evidence");
  assert.equal((skip.facts as { code: string }).code, "rung-skip", "E8: the refusal code, verbatim");
  const sealed = entries[entries.length - 1]!;
  assert.equal(sealed.step, "journey-sealed");
  assert.equal(
    (sealed.facts as { documentDigest: string }).documentDigest,
    run.document.documentDigest,
    "the sealed document digest is the journal's last recorded fact",
  );
});
