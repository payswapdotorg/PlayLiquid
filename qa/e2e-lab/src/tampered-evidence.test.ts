/**
 * TAMPERED EVIDENCE LEDGERS (PL-040 qa/e2e-lab negative class) — the Lab's
 * evidence + observation + learning trails attacked with hostile edits:
 *
 * - a TAMPERED EVIDENCE BUNDLE: an evaluation whose declared bundle digest
 *   does not match the records it cites is refused `evidence-digest-mismatch`
 *   (lab-simulation's own code, verbatim in `portCode` + detail, E8) and the
 *   recorded ledger does not grow;
 * - a FABRICATED EVIDENCE CITATION: a bundle citing a record id that is not
 *   in the ledger is refused `unknown-evidence` (verbatim);
 * - a FABRICATED OBSERVATION: calibrating against an outcome id that was
 *   never observed is refused `unknown-observation` (verbatim);
 * - a STRIPPED E11 MARKER: a run record whose labeled-estimate marker was
 *   forged into observed evidence cannot be calibrated
 *   (`estimate-label-missing`, verbatim — the epistemic classes are
 *   structurally disjoint, never silently coerced);
 * - a TAMPERED LEARNING RECORD: a structurally-edited copy fails the
 *   content-addressed identity oracle while the authentic record verifies;
 * - a TAMPERED HOSTILE JOURNAL: an edited fact, a reordered trail and a
 *   swapped digest all break the hash chain — the append-only discipline is
 *   tamper-evident, not merely asserted (E10).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrateLabEvaluation, labFixtureSuite } from "../../../packages/lab-simulation/src/index.ts";
import type { EvidenceBundleRef } from "../../../packages/lab-simulation/src/index.ts";
import { verifyLearningRecord } from "../../../packages/lab-learning/src/index.ts";
import type { LearningCycleRecord } from "../../../packages/lab-learning/src/index.ts";
import type { ContentDigest } from "../../../packages/lab-contracts/src/index.ts";
import { createHostileJournal, verifyHostileChain } from "./hostile-journal.ts";
import { createHostileWorld } from "./hostile-rig.ts";
import type { HostileWorldRig } from "./hostile-rig.ts";
import { CYCLE_ONE, EVALUATION_SEED, EVALUATION_TICK_BUDGET, OBSERVATION_ONE, SEARCH_SEED_ONE } from "./ids.ts";
import { assertRefusedWith, mutableEntriesOf, structuralCopyOf } from "./adversary-kit.ts";

/** Flips the last hex character of one bare-hex digest (a minimal tamper). */
function flipLastHex(digest: string): ContentDigest {
  return (digest.slice(0, -1) + (digest.endsWith("0") ? "1" : "0")) as ContentDigest;
}

/** One hostile world with an OPENED search and its stream paged (no evaluation yet). */
function openedSearch(world: HostileWorldRig): { searchId: string; baselinePosition: number } {
  const opened = world.stack.organization.openSearch(
    world.searchRequest({ cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 3, as: world.caller, now: world.stack.clock.now() }),
  );
  if (!opened.ok) throw new Error(`tampered: search refused: ${opened.detail}`);
  const stream = world.pageStream(opened.searchId, opened.cursor, world.caller);
  const baselinePosition = stream.find((candidate) => candidate.isBaseline)?.position ?? -1;
  if (baselinePosition < 0) throw new Error("tampered: no baseline candidate in the stream");
  return { searchId: opened.searchId, baselinePosition };
}

/** One hostile world with one loop cycle run (evidence + learning recorded). */
function cycledWorld(): HostileWorldRig {
  const world = createHostileWorld();
  const cycle = world.runHostileCycle({ cycleId: String(CYCLE_ONE), seed: SEARCH_SEED_ONE, maxAgents: 3 });
  if (cycle.gapIds.length === 0) throw new Error("tampered: no gap discovered");
  return world;
}

test("tampered evidence: a declared bundle digest that does not match its records is refused evidence-digest-mismatch (E8)", () => {
  const world = createHostileWorld();
  const { searchId, baselinePosition } = openedSearch(world);
  const bundle: EvidenceBundleRef = {
    recordIds: [...world.evidenceBundle.recordIds],
    declaredDigest: flipLastHex(world.evidenceBundle.declaredDigest),
  };
  const ledgerBefore = world.stack.organization.listEvidence(world.caller).length;
  const refused = world.stack.organization.evaluateCandidate({
    searchId, position: baselinePosition, suite: labFixtureSuite().ref, evidence: bundle,
    parameters: { seed: EVALUATION_SEED, tickBudget: EVALUATION_TICK_BUDGET }, as: world.caller,
  });
  const refusal = assertRefusedWith(refused, "evaluation-refused");
  assert.equal(refusal.portCode, "evidence-digest-mismatch", "the lab-simulation refusal code, verbatim in portCode");
  assert.ok(refusal.detail.includes("tampered evidence is refused (E8)"), "the port's verbatim detail flows through the door");
  assert.equal(
    world.stack.organization.listEvidence(world.caller).length,
    ledgerBefore,
    "the tampered evaluation recorded nothing (the ledger did not grow)",
  );
});

test("tampered evidence: a bundle citing a record that is not in the ledger is refused unknown-evidence (verbatim)", () => {
  const world = createHostileWorld();
  const { searchId, baselinePosition } = openedSearch(world);
  const fabricated: EvidenceBundleRef = {
    recordIds: ["evidence-qa-hostile-999"],
    declaredDigest: world.evidenceBundle.declaredDigest,
  };
  const refused = world.stack.organization.evaluateCandidate({
    searchId, position: baselinePosition, suite: labFixtureSuite().ref, evidence: fabricated,
    parameters: { seed: EVALUATION_SEED, tickBudget: EVALUATION_TICK_BUDGET }, as: world.caller,
  });
  const refusal = assertRefusedWith(refused, "evaluation-refused");
  assert.equal(refusal.portCode, "unknown-evidence");
  assert.ok(refusal.detail.includes("evidence-qa-hostile-999"), "the refusal names the fabricated citation");
});

test("tampered observations: calibrating against an outcome that was never observed is refused unknown-observation (verbatim)", () => {
  const world = cycledWorld();
  const evidence = world.stack.organization.listEvidence(world.caller);
  const evaluationId = evidence[0]?.evaluationId;
  if (evaluationId === undefined) throw new Error("tampered: no evaluation to calibrate");
  const refused = world.stack.simulation.calibrate({
    evaluationId, as: world.caller, observedOutcomeIds: ["observation-never-recorded"],
  });
  assertRefusedWith(refused, "unknown-observation");
});

test("tampered evidence (E11): a run whose labeled-estimate marker was forged into observed evidence cannot be calibrated", () => {
  const world = cycledWorld();
  const evidence = world.stack.organization.listEvidence(world.caller);
  const run = evidence[0]?.run;
  if (run === undefined) throw new Error("tampered: no recorded run");
  // The attacker's edit: strip the labeled-estimate marker and claim the
  // simulation output is observed evidence. The calibration oracle refuses.
  // (A spread copy, not a JSON copy: run records carry bigint game-ir
  // readings — only the marker is replaced, the payload reference is kept.)
  const forged = { ...run, result: { ...run.result, epistemic: "observed-evidence" as never } };
  const refused = calibrateLabEvaluation({
    run: forged,
    observedOutcomeIds: [OBSERVATION_ONE],
    observations: () => undefined, // never reached: the label check fires first
    calibratedAt: 5_000,
  });
  const refusal = assertRefusedWith(refused, "estimate-label-missing");
  assert.ok(refusal.detail.includes("stripped or forged estimate"), "the refusal states the E11 marker discipline");
});

test("tampered evidence: the recorded evidence rows are frozen and fail closed on hostile edits (E10)", () => {
  const world = cycledWorld();
  const rows = world.stack.organization.listEvidence(world.caller);
  assert.ok(rows.length >= 2, "the cycle recorded its evaluations");
  for (const row of rows) {
    assert.equal(Object.isFrozen(row), true, "each recorded evidence row is frozen at seal time");
    assert.throws(
      () => {
        (row as { contentKey?: string }).contentKey = "forged-content-key";
      },
      TypeError,
      "a hostile edit of a sealed evidence row throws in strict mode",
    );
  }
});

test("tampered learning records: a structurally-edited copy fails the identity oracle while the authentic record verifies", () => {
  const world = cycledWorld();
  const records = world.stack.learning.listLearningCycles(world.caller);
  const authentic = records[0];
  if (authentic === undefined) throw new Error("tampered: no learning record");
  assert.equal(verifyLearningRecord(authentic), true, "the authentic record's identity digest re-derives");

  const digestTampered: LearningCycleRecord = { ...structuralCopyOf(authentic), identityDigest: "ab".repeat(32) as never };
  assert.equal(verifyLearningRecord(digestTampered), false, "a forged identity digest does not verify");

  const contentTampered: LearningCycleRecord = { ...structuralCopyOf(authentic), tenant: "tenant-qa-forged" as never };
  assert.equal(verifyLearningRecord(contentTampered), false, "an edited content field breaks the recomputed identity");
});

test("tampered journal (E10): an edited fact, a reordered trail and a swapped digest all break the hash chain", () => {
  const journal = createHostileJournal(2_000, 7);
  journal.record("hostile-step-one", { note: "first" });
  journal.record("hostile-step-two", { note: "second" });
  journal.record("hostile-step-three", { note: "third" });
  const entries = journal.entries();
  assert.equal(journal.verify(), true, "the pristine chain re-derives");
  assert.equal(Object.isFrozen(entries[0]), true, "journal entries are frozen at append time");

  const edited = mutableEntriesOf(entries);
  edited[1]!.facts = { note: "second (tampered)" };
  assert.equal(verifyHostileChain(edited), false, "an edited fact breaks the chain");

  const reordered = mutableEntriesOf(entries);
  const first = reordered[0]!;
  reordered[0] = reordered[1]!;
  reordered[1] = first;
  assert.equal(verifyHostileChain(reordered), false, "a reordered trail breaks the chain");

  const digestSwapped = mutableEntriesOf(entries);
  digestSwapped[2]!.entryDigest = digestSwapped[1]!.entryDigest;
  assert.equal(verifyHostileChain(digestSwapped), false, "a swapped digest breaks the chain");

  assert.equal(verifyHostileChain(mutableEntriesOf(entries)), true, "a byte-identical copy still verifies");
});
