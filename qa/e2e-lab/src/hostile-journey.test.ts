/**
 * THE HOSTILE JOURNEY (E5/E9/E10/E11) — the adversarial walk itself, over
 * the SAME public surfaces as the canonical example but under the hostile
 * world's DIFFERENT fixtures (qa/browser's independently-seeded precedent):
 * the full thesis run — Lab gap ladder (attempted rungs) → Arena
 * adjudication → Community curation (an AI-DISCLOSED contribution) — with
 * every step recorded into the append-only hash-chained hostile journal,
 * the run sealed content-addressed, and the WHOLE run repeated twice with
 * identical evidence (E9).
 *
 * E11 (honesty): the journey runs the REAL Lab/Arena/Community services +
 * ports in-process under `node --test`. There is no DOM, no rendering, no
 * browser process and no network anywhere in this suite — the Arena wire
 * terminates at arena-integration's deterministic in-memory transport fake
 * and the community ports are the package's own deterministic fakes. The
 * first test asserts the no-DOM fact executably.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asContributionId } from "../../../packages/community/src/index.ts";
import { verifyLearningRecord } from "../../../packages/lab-learning/src/index.ts";
import { runHostileJourney } from "./hostile-journey.ts";
import { factsOf } from "./adversary-kit.ts";

test("hostile journey (E11): runs the real services + ports in-process — no DOM, no network, no rendering", async () => {
  const globals = globalThis as Record<string, unknown>;
  assert.equal(globals.window, undefined, "no DOM window in this runtime");
  assert.equal(globals.document, undefined, "no DOM document in this runtime");
  const run = await runHostileJourney();
  assert.equal(run.seal.kind, "qa-e2e-lab-hostile-run");
  assert.ok(run.seal.sealDigest.startsWith("sha256:"), "the hostile run is content-addressed (the single digest authority)");
});

test("hostile journey (E5): the Lab phase walks the real loop over different fixtures", async () => {
  const run = await runHostileJourney();
  const lab = run.facts.lab;
  assert.ok(lab.searchId.startsWith("lab-search-"), "a real search session was opened");
  assert.ok(lab.streamSize > 1, "the seeded candidate stream emitted more than the baseline");
  assert.equal(lab.evidenceRows.length, 2, "the baseline + spread evaluations were recorded");
  assert.ok(
    lab.evidenceRows.every((row) => row.epistemic === "labeled-estimate" && row.method === "simulation"),
    "E11: every PL-028 evaluation is a labeled estimate by type — never ground truth",
  );
  assert.deepEqual(
    lab.learningRecords.map((record) => record.sequence),
    [1, 2],
    "both cycles sealed learning records, monotonically",
  );
  assert.match(lab.signalsDigest, /^[0-9a-f]{64}$/, "the signals fold carries its bare-hex content-addressed digest (E9)");
  assert.notEqual(lab.guidanceDigests.observed, lab.guidanceDigests.estimate, "the disjoint E11 guidance classes digest differently");
  assert.deepEqual(
    lab.rungsWalked,
    ["alternate-organization", "package-platform-capability", "user-community-contribution", "arena-escalation"],
    "the hostile route walks every rung ATTEMPTED — a different ladder route than the example's",
  );
});

test("hostile journey (E5): the Arena + Community phases close the thesis loop", async () => {
  const run = await runHostileJourney();
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
  assert.equal(arena.escalationRef.external, "arena-external", "the ladder's arena rung carries the provider-neutral ref (lock 32)");

  const community = run.facts.community;
  assert.equal(community.status, "accepted", "the hostile contribution reached the accepted verdict");
  assert.deepEqual(
    community.trail,
    ["null->submitted", "submitted->triaged", "triaged->under-review", "under-review->accepted"],
    "the frozen workflow walked submit → triage → review → accept (E10 history)",
  );
  assert.equal(community.aiGenerated, true, "the hostile contribution is AI-DISCLOSED — a different class than the example's");
  assert.equal(community.gapId, run.facts.lab.gapId, "the R18 gap link points at the discovered gap");
  assert.equal(community.gapFacts.exists, true, "the Lab-backed seam resolved the linked gap");
  assert.equal(community.gapFacts.communityRungReached, true, "the ladder had walked to the community rung");
  assert.equal(community.gapFacts.resolved, false, "the gap stays open — the hostile route left it unresolved");
});

test("hostile journey (E10): the journal is append-only, hash-chained, and records the refusals it met", async () => {
  const run = await runHostileJourney();
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
  assert.ok(skip, "the authoritative rung-skip refusal the walk met is recorded evidence");
  assert.equal(factsOf(skip).code, "rung-skip", "E8: the refusal code, verbatim, in the trail");
  const sealed = entries[entries.length - 1]!;
  assert.equal(sealed.step, "hostile-run-sealed");
  assert.equal(factsOf(sealed).sealDigest, run.seal.sealDigest, "the sealed run digest is the journal's last recorded fact");
});

test("hostile journey (E10): the packages' own trails stay append-only through the walk", async () => {
  const run = await runHostileJourney();
  // The Arena runtime persisted a fresh content-addressed document at every
  // mutation: snapshots only ever GROW, and no state digest repeats.
  const snapshots = run.arenaRig.store.snapshots();
  assert.ok(snapshots.length >= 5, "every durable mutation persisted a snapshot (E6)");
  assert.equal(
    new Set(snapshots.map((snapshot) => snapshot.stateDigest)).size,
    snapshots.length,
    "every persisted state digest is distinct — no rewrite ever reused an address",
  );
  // The sealed learning records verify against their own identity digests.
  const records = run.world.stack.learning.listLearningCycles(run.world.caller);
  assert.equal(records.length, 2, "both cycles' learning records are live");
  assert.ok(records.every((record) => verifyLearningRecord(record)), "every sealed record verifies (the lab-learning tamper oracle)");
  // The community history is exactly the walked workflow, once each. The
  // history door is typed over the package's own branded ContributionId —
  // the walked id is parsed with the package's own `asContributionId`
  // (an ad-hoc object cast would never equal the recorded string id and
  // silently read an empty history).
  const contributionId = asContributionId(run.facts.community.contributionId);
  assert.ok(contributionId !== undefined, "the walked contribution id parses as the package's own typed id");
  const history = run.communityRig.service.history(run.world.caller.tenant, contributionId);
  assert.equal(history.length, 4, "submitted + triaged + reviewed + accepted, exactly once each");
  assert.equal(new Set(history.map((entry) => entry.recordId)).size, history.length, "no hidden retry, no duplicated transition (E10)");
});

test("hostile journey (E9): the same run twice produces the identical journal + seal", async () => {
  const first = await runHostileJourney();
  const second = await runHostileJourney();
  assert.equal(first.journal.size(), second.journal.size());
  assert.deepEqual(first.journal.entries(), second.journal.entries(), "same steps, same facts, same digests, same order");
  assert.equal(first.journal.headDigest(), second.journal.headDigest(), "the chain heads match");
  assert.equal(first.seal.sealDigest, second.seal.sealDigest, "the content-addressed seals match");
  assert.deepEqual(first.facts, second.facts, "the typed facts projections are deep-equal");
  assert.equal(first.facts.community.contributionId, second.facts.community.contributionId, "the contribution id is content-addressed identically");
});
