/**
 * qa/performance — REPLAY suite (PL-014 surface; PL-042).
 *
 * WHAT IS MEASURED (E11 honesty): content-addressed replay COMMAND STREAM
 * throughput over @playliquid/replay's PUBLIC entrypoint — sealing
 * (canonical JSON + sha256 over the JSON-safe encoding) and verifying
 * (re-encode + form compare + digest compare) CommandStreamArtifacts of
 * A x C shape: 50 artifacts x 200 recorded commands = 10,000 commands,
 * each a canonical broker-mediated move envelope with a payload in the
 * GameIR value language (simulation's own movePayload fixture). Tampered
 * artifacts are verified too — the typed `digest-mismatch` refusals are
 * COUNTED, never swallowed (E8).
 *
 * The workload is fixed-shape; sealing the same stream twice must produce
 * the identical stream digest (determinism assert).
 */

import { sealCommandStream, verifyCommandStream } from "../../../packages/replay/src/index.ts";
import type { CommandStreamArtifact, RecordedCommand } from "../../../packages/replay/src/index.ts";
import { demoEntityRefs, movePayload } from "../../../packages/simulation/src/index.ts";
import { PERFORMANCE_BUDGETS } from "./budgets.ts";
import type { MetricMeasurement } from "./budgets.ts";
import { logMetric, nowMs, shapeDigestOf } from "./perf-kit.ts";

const ARTIFACTS = 50;
const COMMANDS_PER_ARTIFACT = 200;
const TAMPERED_VERIFICATIONS = 1_000;

/** One deterministic recorded move command (admission seq 1..C). */
function recordedCommands(artifactIndex: number, count: number): RecordedCommand[] {
  const entity = demoEntityRefs()[0];
  if (entity === undefined) throw new Error("demo entity refs are empty");
  const commands: RecordedCommand[] = [];
  for (let i = 0; i < count; i += 1) {
    const dx = ((i * 7 + artifactIndex * 3) % 64) - 32;
    const dy = ((i * 11 + artifactIndex * 5) % 64) - 32;
    commands.push({
      admissionSeq: i + 1,
      dueTick: i + 1,
      envelope: {
        commandId: `perf-replay-${artifactIndex}-${i}` as never,
        sessionId: "perf-replay-session" as never,
        kind: "world.move" as never,
        epoch: 1 as never,
        actor: { actorClass: "avatar-agent" as const, actorId: "perf-replay-actor" as never },
        origin: { kind: "broker-mediated" as const, grantId: "perf-replay-grant" as never },
        idempotencyKey: { scope: "command" as const, actor: "perf-replay-actor" as never, nonce: `perf-replay-nonce-${artifactIndex}-${i}` as never },
        issuedAt: 1 as never,
        payload: movePayload(entity, [dx, dy, 0]),
      },
    });
  }
  return commands;
}

/** Seals + verifies A artifacts x C commands; returns metrics + digests. */
function runArtifactWorkload(): { metrics: MetricMeasurement[]; streamDigests: string[] } {
  const streams = Array.from({ length: ARTIFACTS }, (_, index) => recordedCommands(index, COMMANDS_PER_ARTIFACT));

  const sealStarted = nowMs();
  const artifacts: CommandStreamArtifact[] = [];
  for (const stream of streams) {
    artifacts.push(sealCommandStream(stream));
  }
  const sealElapsed = nowMs() - sealStarted;

  const verifyStarted = nowMs();
  let okCount = 0;
  for (const artifact of artifacts) {
    const verification = verifyCommandStream(artifact);
    if (verification.ok) okCount += 1;
    else throw new Error(`honest artifact failed verification: ${verification.code}`);
  }
  const verifyElapsed = nowMs() - verifyStarted;
  assertCounts(okCount, ARTIFACTS);

  const total = ARTIFACTS * COMMANDS_PER_ARTIFACT;
  logMetric("command-stream sealing", "50 artifacts x 200 recorded commands", sealElapsed, total);
  logMetric("command-stream verification", "50 artifacts x 200 recorded commands", verifyElapsed, total);
  return {
    metrics: [
      {
        metric: "replay.sealArtifacts",
        scale: `${String(ARTIFACTS)} artifacts x ${String(COMMANDS_PER_ARTIFACT)} commands (10,000 commands)`,
        count: total,
        measuredMs: sealElapsed,
        budgetMs: PERFORMANCE_BUDGETS.replay.sealArtifactsMs,
        detail: `${String(Math.round((total * 1000) / sealElapsed))} commands/s sealed`,
      },
      {
        metric: "replay.verifyArtifacts",
        scale: `${String(ARTIFACTS)} artifacts x ${String(COMMANDS_PER_ARTIFACT)} commands (10,000 commands)`,
        count: total,
        measuredMs: verifyElapsed,
        budgetMs: PERFORMANCE_BUDGETS.replay.verifyArtifactsMs,
        detail: `${String(Math.round((total * 1000) / verifyElapsed))} commands/s verified`,
      },
    ],
    streamDigests: artifacts.map((artifact) => artifact.streamDigest).sort(),
  };
}

function assertCounts(actual: number, expected: number): void {
  if (actual !== expected) throw new Error(`expected ${String(expected)} verifications, got ${String(actual)}`);
}

/** Verifies tampered artifacts; typed refusals counted (E8, never swallowed). */
function runTamperedWorkload(): MetricMeasurement {
  const honest = sealCommandStream(recordedCommands(0, 20));
  const tampered: CommandStreamArtifact = {
    ...honest,
    streamDigest: `sha256:${"0".repeat(64)}`,
  };
  const started = nowMs();
  let refusals = 0;
  const codes = new Set<string>();
  for (let i = 0; i < TAMPERED_VERIFICATIONS; i += 1) {
    const verification = verifyCommandStream(tampered);
    if (!verification.ok) {
      refusals += 1;
      codes.add(verification.code);
    }
  }
  const elapsed = nowMs() - started;
  if (refusals !== TAMPERED_VERIFICATIONS) throw new Error(`only ${String(refusals)} tampered verifications refused`);
  if (codes.size !== 1 || !codes.has("digest-mismatch")) throw new Error(`unexpected refusal codes: ${[...codes].join(", ")}`);
  logMetric("typed digest-mismatch refusals", "1,000 verifications of a tampered stream digest", elapsed, TAMPERED_VERIFICATIONS);
  return {
    metric: "replay.tamperedVerify",
    scale: `${String(TAMPERED_VERIFICATIONS)} verifications of a tampered artifact digest`,
    count: TAMPERED_VERIFICATIONS,
    measuredMs: elapsed,
    budgetMs: PERFORMANCE_BUDGETS.replay.tamperedVerifyMs,
    detail: "typed digest-mismatch refusals, counted, never swallowed (E8)",
  };
}

/** The full suite measurement (workloads + the determinism repeat). */
export function measureReplay(): {
  readonly suite: string;
  readonly metrics: readonly MetricMeasurement[];
  readonly shapeDigest: string;
  readonly determinism: { readonly repeated: boolean; readonly digest: string };
} {
  const workload = runArtifactWorkload();
  const tampered = runTamperedWorkload();
  // Determinism: sealing the same stream twice must produce identical bytes.
  const stream = recordedCommands(7, 40);
  const sealedA = sealCommandStream(stream);
  const sealedB = sealCommandStream(stream);
  if (sealedA.streamDigest !== sealedB.streamDigest || sealedA.form !== sealedB.form) {
    throw new Error("replay determinism violated: sealing the same stream twice differs");
  }
  const digest = shapeDigestOf({
    suite: "qa/performance/replay",
    artifacts: ARTIFACTS,
    commandsPerArtifact: COMMANDS_PER_ARTIFACT,
    sampleStreamDigest: sealedA.streamDigest,
  });
  return {
    suite: "replay",
    metrics: [...workload.metrics, tampered],
    shapeDigest: digest,
    determinism: { repeated: true, digest: sealedA.streamDigest },
  };
}
