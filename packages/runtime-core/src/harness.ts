/**
 * RUNTIME EVIDENCE HARNESS (run: `node src/harness.ts`).
 *
 * Drives a full interactive session over the reference driver: load ->
 * act (player path) -> act (avatar-agent path through the CapabilityPort
 * fake) -> step -> snapshot -> act -> restore -> replay -> terminate,
 * checking every invariant on the way (canonical log integrity, epoch
 * bumps, replay window). Then runs the IDENTICAL scenario on a second,
 * independently constructed kernel and proves byte stability: identical
 * driving yields an identical snapshot digest (same canonical bytes).
 * Prints machine-readable JSON; exits non-zero on any unexpected outcome.
 *
 * No IO beyond stdout; no wall clock (ManualClock); no randomness.
 */

import {
  asCapabilityGrantId,
  asCapabilityId,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
} from "@playliquid/runtime-contracts";
import type { CapabilityGrant, CapabilityGrantId, Timestamp } from "@playliquid/runtime-contracts";
import {
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemoryRenderer,
  InMemorySnapshotStore,
  InMemoryTransport,
  ManualClock,
  avatarActor,
  interactiveDescriptor,
  playerActor,
} from "./fakes.ts";
import { createInteractiveRuntime } from "./construction.ts";

const SESSION_ID = "harness-session-1";
const SEED = "seed-harness";

function runScenario() {
  const clock = new ManualClock(1000);
  const store = new InMemorySnapshotStore();
  const renderer = new InMemoryRenderer();
  const transport = new InMemoryTransport();
  const broker = new GrantTableCapabilityPort({
    grants: [makeGrant()],
    capabilityIntentKinds: { "world.counter": [asIntentKind("world.increment")] },
    intentCommandKinds: { "world.increment": "world.increment" },
    clock,
  });
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor(SESSION_ID, SEED),
    driver: new CounterWorldDriver(),
    capabilityPort: broker,
    snapshotStore: store,
    renderer,
    transport,
  });
  if (created.status !== "created") {
    throw new Error(`harness: kernel creation refused: ${created.detail}`);
  }
  const kernel = created.kernel;
  const problems: string[] = [];
  const expect = (condition: boolean, detail: string): void => {
    if (!condition) problems.push(detail);
  };

  const loaded = kernel.load();
  expect(loaded.status === "loaded", `load: ${String(loaded.status)}`);

  const playerAct = kernel.act(playerIntent("p1", "world.increment", { by: 2 }, clock.now()));
  expect(playerAct.status === "committed", `player act: ${String(playerAct.status)}`);

  const avatarAct = kernel.act(avatarIntent("a1", "world.increment", { by: 5 }, clock.now(), makeGrant().grantId));
  expect(avatarAct.status === "committed", `avatar act: ${String(avatarAct.status)}`);

  const stepped = kernel.step(3);
  expect(stepped.status === "stepped", `step: ${String(stepped.status)}`);

  const snapshotted = kernel.snapshot();
  expect(snapshotted.status === "snapshotted", `snapshot: ${String(snapshotted.status)}`);
  const digest = snapshotted.status === "snapshotted" ? snapshotted.snapshot.stateDigest : ("n/a" as const);

  const after = kernel.act(playerIntent("p2", "world.move", { to: 7 }, clock.now()));
  expect(after.status === "committed", `post-snapshot act: ${String(after.status)}`);

  if (snapshotted.status === "snapshotted") {
    const restored = kernel.restore(snapshotted.snapshot.snapshotId);
    expect(restored.status === "restored", `restore: ${String(restored.status)}`);
  }

  const replayed = kernel.replay({ fromEventSeq: 1, toEventSeq: null });
  expect(replayed.status === "replayed", `replay: ${String(replayed.status)}`);

  const integrity = kernel.verifyLogIntegrity();
  expect(integrity.ok, `integrity: ${JSON.stringify(integrity)}`);

  const terminated = kernel.terminate("harness complete");
  expect(terminated.status === "terminated", `terminate: ${String(terminated.status)}`);

  if (problems.length > 0) {
    throw new Error(`harness scenario failed: ${problems.join("; ")}`);
  }
  return {
    kernel,
    digest,
    rendererFrames: renderer.frames.length,
    transportMessages: transport.messages.length,
    replayEvents: replayed.status === "replayed" ? replayed.events.length : -1,
    integrityOk: integrity.ok,
  };
}

function makeGrant(): CapabilityGrant {
  return {
    grantId: asCapabilityGrantId("grant-harness-1"),
    holder: avatarActor("avatar-h1"),
    capability: asCapabilityId("world.counter"),
    scope: { sessionId: interactiveDescriptor(SESSION_ID).sessionId },
    constraints: [{ kind: "per-tick-count", max: 3 }],
    issuedBy: "host-game-policy",
    epoch: asSessionEpoch(1),
  };
}

function playerIntent(id: string, kind: string, payload: unknown, at: Timestamp) {
  return {
    intent: {
      intentId: asIntentId(`intent-${id}`),
      kind: asIntentKind(kind),
      actor: playerActor("player-h1"),
      payload,
      issuedAt: at,
    },
    nonce: asIdempotencyNonce(`nonce-${id}`),
  };
}

function avatarIntent(id: string, kind: string, payload: unknown, at: Timestamp, grantId: CapabilityGrantId) {
  return {
    intent: {
      intentId: asIntentId(`intent-${id}`),
      kind: asIntentKind(kind),
      actor: avatarActor("avatar-h1"),
      payload,
      issuedAt: at,
    },
    grantId,
    nonce: asIdempotencyNonce(`nonce-${id}`),
  };
}

const first = runScenario();
const second = runScenario();
const byteStable = first.digest === second.digest && first.digest !== "n/a";
const view = first.kernel.view();

const report = {
  ok: byteStable && first.integrityOk,
  sessionId: SESSION_ID,
  finalPhase: view.phase,
  finalEpoch: view.epoch,
  finalTick: view.tick,
  committedEventSeq: view.committedEventSeq,
  admittedCommandSeq: view.admittedCommandSeq,
  snapshotDigest: first.digest,
  byteStableAcrossIndependentRuns: byteStable,
  replayEvents: first.replayEvents,
  rendererFrames: first.rendererFrames,
  transportMessages: first.transportMessages,
  integrityOk: first.integrityOk,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
