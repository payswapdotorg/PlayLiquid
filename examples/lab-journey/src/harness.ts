/**
 * RUNTIME EVIDENCE HARNESS (PL-040) — `node src/harness.ts`.
 *
 * Runs the canonical Lab/Arena/Community journey once and prints its
 * evidence trail: the journal steps (append-only, hash-chained, E10), the
 * phase facts and the sealed document digest. Exits non-zero if any stage
 * of the journey refuses — the same honesty class as the sibling reference
 * examples (E11: this harness proves the walk runs; it fakes nothing).
 */

import { runCanonicalLabArenaJourney } from "./journey.ts";

const run = await runCanonicalLabArenaJourney();

console.log("=== Lab/Arena/Community canonical journey (PL-040) ===");
console.log(`tenant            : ${run.document.tenant}`);
console.log(`subject           : ${run.document.subject}`);
console.log(`journal entries   : ${run.journal.size()} (chain verified: ${String(run.journal.verify())})`);
for (const entry of run.journal.entries()) {
  console.log(`  #${String(entry.seq).padStart(2, "0")} @${entry.at} ${entry.step} ${entry.entryDigest.slice(7, 19)}`);
}
console.log("--- lab ---");
console.log(`search            : ${run.facts.lab.searchId} (stream ${String(run.facts.lab.streamSize)})`);
console.log(`gap               : ${run.facts.lab.gapId}`);
console.log(`rungs walked      : ${run.facts.lab.rungsWalked.join(" -> ")}`);
console.log(`learning records  : ${String(run.facts.lab.learningRecords.length)} (signals ${run.facts.lab.signalsDigest.slice(7, 19)})`);
console.log(`evidence rows     : ${String(run.facts.lab.evidenceRows.length)} (all ${run.facts.lab.evidenceRows[0]?.epistemic ?? "none"})`);
console.log("--- arena ---");
console.log(`case              : ${run.facts.arena.caseId} (duplicate: ${String(run.facts.arena.duplicate)})`);
console.log(`lifecycle         : ${run.facts.arena.lifecycleTrail.join(" -> ")}`);
console.log(`evidence verdict  : ${run.facts.arena.evidenceVerdict}`);
console.log(`labels            : ${run.facts.arena.labels.map((label) => label.externalClass).join(", ")}`);
console.log(`escalation ref    : ${run.facts.arena.escalationRef.escalationId}`);
console.log("--- community ---");
console.log(`contribution      : ${run.facts.community.contributionId}`);
console.log(`trail             : ${run.facts.community.trail.join(" -> ")}`);
console.log(`status            : ${run.facts.community.status}`);
console.log(`provenance        : ${run.facts.community.provenance.originKind} / ${run.facts.community.provenance.baseCoordinate}`);
console.log(`gap link (R18)    : exists=${String(run.facts.community.gapFacts.exists)} community-rung=${String(run.facts.community.gapFacts.communityRungReached)}`);
console.log("--- seal ---");
console.log(`journal head      : ${run.journal.headDigest()}`);
console.log(`document digest   : ${run.document.documentDigest}`);
