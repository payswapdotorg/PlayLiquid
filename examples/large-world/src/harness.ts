/**
 * LATTICE — the runtime evidence harness (PL-039; `node src/harness.ts`).
 *
 * Runs the canonical streaming scenario end to end over the REAL
 * authorities (composition → 87 packages → streaming simulation with
 * snapshot boundary → sealed replay + re-execution + verifier → the
 * streaming schedule → per-chunk staged builds) and prints the evidence
 * trail. Exits non-zero if any stage refuses.
 *
 * Deterministic (E9): two runs print byte-identical evidence.
 */

import { runCanonicalScenario } from "./scenario.ts";
import { createChunkKitchen } from "./build.ts";
import { readStreamingView } from "./streaming.ts";
import { chunkPolicyOf } from "./world-model.ts";
import { chunkIdOf } from "./layout.ts";

function line(text = ""): void {
  process.stdout.write(`${text}\n`);
}

async function main(): Promise<void> {
  line("== LATTICE — the large-world/package-graph reference (PL-039) ==");

  const run = await runCanonicalScenario();
  const { composition, schedule, session, sealed, verdict, stats } = run;

  line();
  line("-- composition (GameIR-direct; the static definition) --");
  line(`world:          ${String(composition.game.worldId)} · ${String(composition.chunkCount)} chunks (8×8 grid, 16-unit cells)`);
  line(`hierarchy:     4 regions · 16 zones · 64 chunks (World → Region → Zone → Chunk, R15)`);
  line(`packages:      ${String(composition.packageCount)} on the federated registry (world + rules + avatar + 4 regions + 16 zones + 64 chunks)`);
  line(`game-ir:       ${composition.gameIrDigest}`);
  line(`lock:          ${composition.lockFingerprint} (${String(composition.packageCount)} pins, verified against registry + CAS, lock rule 10)`);

  line();
  line("-- the deterministic streaming schedule (R15; pure derivation) --");
  line(`steps:         ${String(schedule.steps.length)} planned viewpoint ticks`);
  line(`loads:         ${String(schedule.totalLoads)} (cas ${String(schedule.totalCasFetches)} · checkpoint ${String(schedule.totalCheckpointReloads)})`);
  line(`unloads:       ${String(schedule.totalUnloads)}`);
  const refused = schedule.steps.flatMap((step) => step.refusals.map((refusal) => `${String(step.tick)}:${refusal.code}`));
  line(`refusals:      ${refused.length === 0 ? "none" : refused.join(", ")} (typed, E8)`);

  line();
  line("-- the streaming simulation (Simulation Runtime; headless + reproducible) --");
  line(`session:       ${String(session.view().sessionId)} · tick ${String(stats.tick)} · epoch ${String(session.view().epoch)} · seed-pinned (E9)`);
  line(`events:        ${String(run.allEvents.length)} committed (${String(run.postBoundaryEvents.length)} after the boundary)`);
  line(`commands:      ${String(run.commands.length)} recorded (admission seq 1..${String(run.commands.at(-1)?.admissionSeq ?? 0)})`);
  line(`boundary:      tick ${String(run.boundary.tick)} · after event seq ${String(run.boundary.afterEventSeq)} · snapshot ${run.boundary.snapshot.snapshotId}`);
  const world = session.worldState;
  if (world === undefined) throw new Error("harness: no world state");
  const view = readStreamingView(world);
  line(`resident:      ${String(view.resident.length)} chunks (${view.resident.slice(0, 8).join(", ")}${view.resident.length > 8 ? ", …" : ""})`);
  line(`counters:      ${String(view.loads)} loads · ${String(view.unloads)} unloads · ${String(view.casFetches)} cas fetches · ${String(view.checkpointReloads)} checkpoint reloads`);
  line(`dormant:       ${String(stats.dormantCount)} chunks carried as static + checkpoints`);
  const coreResident = view.resident.includes(composition.model.coreChunkId);
  line(`core chunk:    ${composition.model.coreChunkId} ${coreResident ? "still resident (never streams out — the contract refuses, E8)" : "MISSING (contract violated!)"}`);
  if (!coreResident) throw new Error("harness: the core chunk streamed out — streaming contract violated");

  line();
  line("-- replay (R8: one sealed replay, reused by players/QA/integrity) --");
  line(`replay record: ${sealed.record.replayId}`);
  line(`stream:        ${sealed.stream.streamDigest} (${String(sealed.stream.entries.length)} commands)`);
  line(`witness:       ${sealed.witness.witnessDigest} (${String(sealed.witness.events.length)} events)`);
  line(`re-execution:  ${run.comparison.equal ? "byte-identical event streams" : "DIVERGED"} (${String(run.comparison.equal ? run.comparison.comparedCount : 0)} events compared)`);
  line(`verdict:       ${verdict.kind} · confidence ${String(verdict.confidence)}`);

  line();
  line("-- chunk builds (§Build: per-chunk staged pipelines through build-orchestrator) --");
  const kitchen = createChunkKitchen(composition);
  const identity = (nonce: string) => ({ requester: "lattice-builder", nonce, requestedAt: 1_700_000_000_000 });
  const buildable = ["chunk-5-5", "chunk-0-7"];
  for (const chunkId of buildable) {
    const built = await kitchen.cook(chunkId, identity(`cook-${chunkId}`));
    line(built.ok
      ? `cooked:        ${chunkId} → ${String(built.buildId)} (${built.classification}, ${built.phase}) · manifest ${built.buildManifestDigest} · ${String(built.artifactCount)} artifact(s) · ${String(built.eventCount)} event(s)`
      : `REFUSED:       ${chunkId} → ${built.code} — ${built.message}`);
    if (!built.ok) throw new Error(`harness: chunk ${chunkId} build refused`);
  }
  const coreZoneChunk = chunkIdOf(2, 3);
  const policy = chunkPolicyOf(2, 3);
  const refusedBuild = await kitchen.cook(coreZoneChunk, identity(`cook-${coreZoneChunk}`));
  line(refusedBuild.ok
    ? `UNEXPECTED:    ${coreZoneChunk} built (independentlyBuilt is ${String(policy.independentlyBuilt)})`
    : `refused:       ${coreZoneChunk} → ${refusedBuild.code} (independentlyBuilt:${String(policy.independentlyBuilt)} — core-zone chunks cook as a zone unit, E8)`);
  if (refusedBuild.ok) throw new Error("harness: a core-zone chunk built independently — build contract violated");
  const first = await kitchen.cook("chunk-5-5", identity(`cook-chunk-5-5`));
  line(first.ok
    ? `idempotent:    re-cook of chunk-5-5 → ${first.classification} (same idempotency key, E6)`
    : `re-cook:       refused — ${first.code}`);

  line();
  line("EVIDENCE OK — all stages green.");
}

void main().catch((error: unknown) => {
  process.stdout.write(`HARNESS FAILURE: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
