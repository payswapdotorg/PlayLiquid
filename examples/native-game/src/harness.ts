/**
 * LUMEN RUN — the runtime evidence harness (PL-037; `node src/harness.ts`).
 *
 * Runs the canonical scripted playthrough end to end over the REAL
 * platform authorities (composition → packages → spark build → the full
 * Experience Protocol → replay re-execution → platform submissions) and
 * prints the evidence trail. Exits non-zero if any stage refuses.
 *
 * Deterministic (E9): two runs print byte-identical evidence.
 */

import { runLumenSparkBuild } from "./build.ts";
import { runCanonicalPlaythrough } from "./playthrough.ts";
import { intFieldOf } from "./outcomes.ts";

function line(text = ""): void {
  process.stdout.write(`${text}\n`);
}

async function main(): Promise<void> {
  line("== LUMEN RUN — native GameOS reference game (PL-037) ==");

  const run = await runCanonicalPlaythrough();
  const { composition, session, commands, events, sealed, verdict, renders, platform } = run;

  line();
  line("-- composition (GameIR-direct; sha256:* digests) --");
  line(`game-ir:        ${composition.gameIrDigest}`);
  line(`lock:           ${composition.lockFingerprint}`);
  line(`composition:    ${composition.compositionDigest}`);
  line(`packages:       ${composition.packages.records.map((record) => record.identity.id).join(", ")}`);
  line(`profile (R6):   spark · critical ${String(composition.spark.criticalBytes)}B · deferred ${String(composition.spark.deferredUnitCount)} unit(s)`);
  line(`planned boot:   first-paint ${String(composition.spark.plannedFirstPaintMs)}ms · first-interaction ${String(composition.spark.plannedFirstInteractionMs)}ms`);

  line();
  line("-- spark build (build-orchestrator staged pipeline) --");
  const build = await runLumenSparkBuild({
    document: composition.document,
    lock: composition.packages.lock,
    records: composition.packages.records,
    identity: { requester: "lumen-run-builder", nonce: "lumen-spark-build-1", requestedAt: 1_700_000_000_000 },
  });
  if (!build.ok) {
    line(`spark build REFUSED: ${build.code} — ${build.message}`);
    process.exitCode = 1;
    return;
  }
  line(`build:          ${String(build.buildId)} → ${build.phase} (${build.classification})`);
  line(`manifest:       ${String(build.buildManifestDigest)}`);
  line(`outputs:        ${String(build.artifactCount)} artifact(s) · ${String(build.eventCount)} build event(s)`);

  line();
  line("-- the canonical playthrough (Experience Protocol, all nine verbs) --");
  line(renders.start);
  line();
  line(renders.complete);
  line();
  const view = session.kernel.view();
  line(`session:        ${String(view.sessionId)} · terminated at tick ${String(view.tick)} · epoch ${String(view.epoch)}`);
  line(`commands:       ${String(commands.length)} recorded (admission seq 1..${String(commands.at(-1)?.admissionSeq ?? 0)})`);
  line(`events:         ${String(events.length)} committed (seq 1..${String(events.at(-1) ? Number(events.at(-1)!.seq) : 0)})`);
  const completed = events.find((event) => String(event.kind) === "run.completed");
  line(`outcome:        score ${String(completed === undefined ? "n/a" : intFieldOf(completed.payload, "score"))} (authoritative, R9)`);

  line();
  line("-- replay (R8) + competitive integrity (R11) --");
  line(`replay record:  ${sealed.record.replayId}`);
  line(`stream digest:  ${sealed.stream.streamDigest} (${String(sealed.stream.entries.length)} commands)`);
  line(`witness:        ${sealed.witness.witnessDigest} (${String(sealed.witness.events.length)} events)`);
  line(`verdict:        ${verdict.kind} · confidence ${String(verdict.confidence)} · verified ${String(verdict.kind === "match" ? verdict.verifiedCount : 0)}/${String(verdict.kind === "match" ? verdict.totalEventCount : 0)} positions`);
  if (!platform.integrity.accepted) throw new Error("integrity evaluation refused");
  line(`integrity:      report ${platform.integrity.receipt.reportId} · verdict ${platform.integrity.verdict.verdictId} · enforcement ${String(platform.integrity.receipt.enforcement)}`);

  line();
  line("-- platform outcomes (R9/R10/R11, from authoritative events only) --");
  if (!platform.leaderboard.accepted) throw new Error("leaderboard refused");
  line(`leaderboard:    ${String(platform.leaderboard.receipt.subject)} scored ${String(platform.leaderboard.receipt.score)} (decided by ${String(platform.leaderboard.receipt.decidedBy)})`);
  if (!platform.settlement.accepted) throw new Error("settlement refused");
  line(`economy:        +${String(platform.settlement.receipt.quantity)} ${platform.settlement.receipt.entitlementKind} → balance ${String(platform.settlement.receipt.balanceAfter)} (settled by platform, R10)`);
  const unlocked = platform.achievements.flatMap((result) => (result.accepted ? result.outcomes.filter((outcome) => outcome.applied && outcome.justUnlocked) : []));
  line(`achievements:   ${unlocked.length === 0 ? "none" : unlocked.map((outcome) => String(outcome.achievement)).join(", ")} unlocked`);
  if (!platform.social.accepted) throw new Error("social refused");
  line(`social:         ${String(platform.social.recorded.length)} relation change(s) recorded`);

  line();
  line("-- restored world (the restore verb rewinds to the final snapshot) --");
  line(renders.restored);
  line();
  line("EVIDENCE OK — all stages green.");
}

void main().catch((error: unknown) => {
  process.stdout.write(`HARNESS FAILURE: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
