/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives the full PL-014 replay story on the demo game through the public
 * surface only (no internal-module reach-ins):
 * 1. captures a scripted run as a snapshot-boundary replay record
 *    (command stream + event witness + provenance, all content-addressed);
 * 2. re-executes the record against a FRESH simulation session through the
 *    canonical command admission gate and compares event streams
 *    byte-for-byte;
 * 3. runs the R11 reference verifier at full coverage AND at a sampled
 *    rate (verdict + confidence);
 * 4. attempts two attacks: a mutated command stream (must diverge) and a
 *    record rewrite (must be refused — E10);
 * 5. appends a derivation and confirms the source record is untouched.
 *
 * Prints machine-readable JSON; exits non-zero on any unexpected outcome.
 * No IO beyond stdout; no clock, no randomness.
 */

import type { RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import { InMemoryReplayStore } from "./fakes.ts";
import { InMemoryDerivationLedger, sealReplayDerivation } from "./derivation.ts";
import { computeDigest } from "@playliquid/package-system";
import { sealCommandStream } from "./command-stream.ts";
import { sealEventWitness } from "./event-witness.ts";
import { sealReplayRecord } from "./record.ts";
import { reExecuteReplay, compareEventStreams } from "./reexecute.ts";
import { createReferenceIntegrityVerifier } from "./verifier.ts";
import {
  captureBoundaryScenario,
  makeSimulationLauncher,
  moveEnvelope,
} from "./test-fixtures.ts";
import type { RecordedCommand } from "./command-stream.ts";

// 1-2. Capture and honest re-execution.
const scenario = captureBoundaryScenario("harness-replay");
const { launcher } = makeSimulationLauncher();
const run = reExecuteReplay({ replayId: scenario.record.replayId, source: scenario.store, launcher });
if (run.status !== "re-executed") {
  throw new Error(`HARNESS FAIL: honest replay was not re-executable: ${JSON.stringify(run)}`);
}
const equality = compareEventStreams(
  scenario.recordedEvents as readonly RuntimeEventEnvelope<never>[],
  run.events as readonly RuntimeEventEnvelope<never>[],
);

// 3. R11 verdicts at two coverages.
const verifier = createReferenceIntegrityVerifier();
const full = verifier.verify({ replayId: scenario.record.replayId, source: scenario.store, launcher });
const sampled = verifier.verify({ replayId: scenario.record.replayId, source: scenario.store, launcher, sampleRate: 0.5 });

// 4a. Mutated command stream (honestly re-sealed, referenced by an
// internally-consistent attack record) must DIVERGE from the witness.
const mutatedCommands: readonly RecordedCommand[] = scenario.recordedCommands.map((entry, index) =>
  index === 0
    ? { ...entry, envelope: moveEnvelope(String(scenario.record.sessionId), "r-3", [6, 6, 6]) }
    : entry,
);
const mutatedStream = sealCommandStream(mutatedCommands);
const attackRecord = sealReplayRecord({
  sessionId: scenario.record.sessionId,
  game: scenario.record.game,
  determinism: scenario.record.determinism,
  capture: scenario.record.capture,
  commandStream: mutatedStream.streamDigest,
  eventWitness: scenario.record.eventWitness,
  provenance: scenario.record.provenance,
});
const attackStore = new InMemoryReplayStore();
attackStore.putCommandStream(mutatedStream);
attackStore.putEventWitness(sealEventWitness(scenario.recordedEvents as readonly RuntimeEventEnvelope<never>[]));
attackStore.putReplay(attackRecord);
const attackVerdict = verifier.verify({ replayId: attackRecord.replayId, source: attackStore, launcher });

// 4b. Record rewrite attempt must be REFUSED (E10).
let rewriteRefused = false;
try {
  scenario.store.putReplay({ ...scenario.record, eventWitness: "sha256:" + "9".repeat(64) });
} catch {
  rewriteRefused = true;
}

// 5. Derivation appends without touching the source.
const sourceBefore = JSON.stringify(scenario.store.loadReplay(scenario.record.replayId));
const ledger = new InMemoryDerivationLedger((id) => scenario.store.loadReplay(id) !== undefined);
const report = sealReplayDerivation({
  sourceReplayId: scenario.record.replayId,
  kind: "harness-report",
  artifactDigest: computeDigest({ verdict: full.kind }),
  derivedAt: 42 as never,
  derivedBy: "replay-harness",
});
const appended = ledger.append(report);
const sourceAfter = JSON.stringify(scenario.store.loadReplay(scenario.record.replayId));

const reportJson = {
  harness: "replay/capture-reexecute-verify",
  replayId: scenario.record.replayId,
  capture: {
    boundarySeq: scenario.boundarySeq,
    events: scenario.recordedEvents.length,
    commands: scenario.recordedCommands.length,
    finalTick: scenario.finalTick,
  },
  checks: {
    reexecutionByteEqual: equality.equal,
    fullVerdictMatch: full.kind === "match",
    fullConfidence: full.kind === "match" ? full.confidence : null,
    sampledVerdictMatch: sampled.kind === "match",
    sampledConfidence: sampled.kind === "match" ? sampled.confidence : null,
    mutatedStreamDiverges: attackVerdict.kind === "divergence",
    recordRewriteRefused: rewriteRefused,
    derivationAppended: appended.ok,
    sourceUntouched: sourceBefore === sourceAfter,
  },
};

console.log(JSON.stringify(reportJson, null, 2));

if (!reportJson.checks.reexecutionByteEqual) {
  throw new Error("HARNESS FAIL: re-execution diverged from the recorded witness");
}
if (!reportJson.checks.fullVerdictMatch || reportJson.checks.fullConfidence !== 1) {
  throw new Error("HARNESS FAIL: full-coverage integrity verdict was not a confident match");
}
if (!reportJson.checks.sampledVerdictMatch || (reportJson.checks.sampledConfidence ?? 0) >= 1) {
  throw new Error("HARNESS FAIL: sampled verdict did not report partial coverage");
}
if (!reportJson.checks.mutatedStreamDiverges) {
  throw new Error("HARNESS FAIL: the mutated command stream was NOT detected as divergence");
}
if (!reportJson.checks.recordRewriteRefused) {
  throw new Error("HARNESS FAIL: the store accepted a record rewrite (E10 violation)");
}
if (!reportJson.checks.derivationAppended || !reportJson.checks.sourceUntouched) {
  throw new Error("HARNESS FAIL: derivation append mutated or was refused");
}
console.log("HARNESS PASS: capture, content-addressed re-execution, R11 verdicts, attack detection and E10 immutability all agree");
