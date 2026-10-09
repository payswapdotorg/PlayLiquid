/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives the full PL-014 simulation story on the demo game:
 * 1. an uninterrupted reference run (commands at fixed due ticks);
 * 2. a live restore on a run that already continued past its own snapshot
 *    boundary, followed by the identical continuation (epoch-aware);
 * 3. a FRESH session — the replay re-execution entry — initialized from the
 *    ORIGINAL session's boundary snapshot under the original session id,
 *    then fed the same remaining commands;
 * 4. byte-level comparison of the event streams and world digests across
 *    all continuations, plus the order-oracle verdict on each log.
 *
 * Prints machine-readable JSON; exits non-zero on any unexpected outcome.
 * No IO beyond stdout; no clock, no randomness.
 */

import { asCommandId, asTimestamp } from "@playliquid/runtime-contracts";
import type { RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import { canonicalValueForm } from "@playliquid/game-ir";
import { createHash } from "node:crypto";
import { SimulationSession } from "./session.ts";
import { FixedClock, InMemorySnapshotStore } from "./fakes.ts";
import { DEMO_ACTOR_ID, demoEntityRefs, demoGameBinding, demoSeed, movePayload } from "./demo.ts";

/** Pre-boundary commands (due at/before the boundary tick 5). */
const PRE = [
  { nonce: "h-1", delta: [2, 0, 0] as const, dueTick: 3 },
  { nonce: "h-2", delta: [0, 3, 0] as const, dueTick: 5 },
];
/** Post-boundary commands (due after the boundary tick). */
const POST = [{ nonce: "h-3", delta: [-1, -1, 2] as const, dueTick: 7 }];

function envelope(sessionId: string, nonce: string, delta: readonly [number, number, number], epoch: number) {
  return {
    commandId: asCommandId(`cmd-${nonce}`),
    sessionId: sessionId as never,
    kind: "world.move" as never,
    epoch: epoch as never,
    actor: { actorClass: "avatar-agent" as const, actorId: DEMO_ACTOR_ID },
    origin: { kind: "broker-mediated" as const, grantId: "grant-demo-locomotion" as never },
    idempotencyKey: { scope: "command" as const, actor: DEMO_ACTOR_ID, nonce: nonce as never },
    issuedAt: asTimestamp(1),
    payload: movePayload(demoEntityRefs()[0]!, delta),
  };
}

function makeSession(id: string, store: InMemorySnapshotStore): SimulationSession {
  return new SimulationSession({
    sessionId: id as never,
    binding: demoGameBinding(id),
    ports: { clock: new FixedClock([1]), snapshotStore: store },
  });
}

function fingerprint(events: readonly RuntimeEventEnvelope<never>[]): string {
  return createHash("sha256")
    .update(
      events
        .map((event) =>
          JSON.stringify({
            eventId: event.eventId,
            kind: event.kind,
            seq: event.seq,
            tick: event.tick,
            cause: event.cause,
            payload: canonicalValueForm(event.payload as never),
          }),
        )
        .join("|"),
    )
    .digest("hex");
}

/** Runs the pre-boundary segment (tick 0..5) on a fresh session. */
function runPreBoundary(id: string, store: InMemorySnapshotStore): SimulationSession {
  const session = makeSession(id, store);
  session.begin(demoSeed());
  for (const command of PRE) {
    session.submitRecordedCommand(envelope(id, command.nonce, command.delta, 1), command.dueTick);
  }
  session.step({ op: "step", sessionId: session.sessionId, ticks: 5 });
  return session;
}

function continueScript(session: SimulationSession, id: string, epoch: number): void {
  for (const command of POST) {
    const submitted = session.submitRecordedCommand(
      envelope(id, command.nonce, command.delta, epoch),
      command.dueTick,
    );
    if (submitted.status !== "submitted") {
      throw new Error(`harness: continuation rejected: ${JSON.stringify(submitted)}`);
    }
  }
  session.step({ op: "step", sessionId: session.sessionId, ticks: 4 });
}

// 1. Uninterrupted reference run.
const clean = runPreBoundary("harness-clean", new InMemorySnapshotStore());
continueScript(clean, "harness-clean", 1);
const cleanStream = fingerprint(clean.eventLog as never);
const cleanWorld = clean.currentWorldDigest;

// 2. Live restore on a session that already continued past its own boundary.
const restoreSession = runPreBoundary("harness-restore", new InMemorySnapshotStore());
const ownBoundary = restoreSession.snapshot();
if (ownBoundary.status !== "snapshotted") throw new Error("harness: snapshot failed");
const boundarySeq = ownBoundary.snapshot.afterEventSeq;
continueScript(restoreSession, "harness-restore", 1);
const restored = restoreSession.restore({
  op: "restore",
  sessionId: restoreSession.sessionId,
  snapshotId: ownBoundary.snapshot.snapshotId,
});
if (restored.status !== "restored") throw new Error("harness: restore rejected");
continueScript(restoreSession, "harness-restore", restored.epoch);
const restoreStream = fingerprint(restoreSession.eventLog as never);

// 3. Fresh re-execution session: the ORIGINAL run (session id
// "harness-original") creates the boundary snapshot; a FRESH session under
// the SAME session id (new object, empty store, artifact passed directly)
// adopts it via beginFromSnapshot — exactly how the replay engine
// re-executes a recorded session.
const original = runPreBoundary("harness-original", new InMemorySnapshotStore());
const originalBoundary = original.snapshot();
if (originalBoundary.status !== "snapshotted") throw new Error("harness: original snapshot failed");
continueScript(original, "harness-original", 1);
const fresh = makeSession("harness-original", new InMemorySnapshotStore());
const begun = fresh.beginFromSnapshot(originalBoundary.snapshot, demoSeed());
if (begun.status !== "begun") throw new Error("harness: beginFromSnapshot rejected");
continueScript(fresh, "harness-original", 1);
const freshStream = fingerprint(fresh.readEvents(boundarySeq) as never);
const freshWorld = fresh.currentWorldDigest;
const originalPostBoundary = fingerprint(original.readEvents(boundarySeq) as never);

const report = {
  harness: "simulation/restore-and-reexecute",
  eventsCommitted: clean.eventLog.length,
  boundary: { tick: ownBoundary.snapshot.tick, afterEventSeq: boundarySeq, snapshotId: ownBoundary.snapshot.snapshotId },
  checks: {
    restoreContinueEqualsUninterrupted:
      restoreStream === cleanStream && restoreSession.currentWorldDigest === cleanWorld,
    freshWorldEqualsUninterrupted: freshWorld === cleanWorld,
    freshContinuationMatches: freshStream === originalPostBoundary,
    orderOracleClean: clean.checkEventStream().ok,
    orderOracleRestore: restoreSession.checkEventStream().ok,
  },
};

console.log(JSON.stringify(report, null, 2));

if (!report.checks.restoreContinueEqualsUninterrupted) {
  throw new Error("HARNESS FAIL: restore-then-continue diverged from the uninterrupted run");
}
if (!report.checks.freshWorldEqualsUninterrupted) {
  throw new Error("HARNESS FAIL: fresh-from-snapshot continuation diverged (world digest)");
}
if (!report.checks.freshContinuationMatches) {
  throw new Error("HARNESS FAIL: fresh-from-snapshot event continuation diverged");
}
if (report.checks.orderOracleClean !== true || report.checks.orderOracleRestore !== true) {
  throw new Error("HARNESS FAIL: order oracle rejected a committed log");
}
console.log("HARNESS PASS: deterministic run, byte-stable snapshot, restore-continue and fresh re-execution all agree");
