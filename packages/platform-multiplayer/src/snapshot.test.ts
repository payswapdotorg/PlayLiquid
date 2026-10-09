/**
 * Snapshot / restore / replay tests: byte-stable documents (E9), content-
 * addressed ids, epoch advancement on restore (stale-result rule), replay
 * boundaries (R8 seam, `validateReplayPlan`), restore-after-terminate
 * misuse, and idempotency across restore (E6 durability).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthoritySessionKernel } from "./kernel.ts";
import type {
  AuthoritySessionKernelOptions,
  IntentSubmitResult,
  RestoreResult,
  ReplayResult,
} from "./kernel.ts";
import {
  FAKE_PROTECTED_GRANT_KINDS,
  createFakeGamePolicy,
  createFakeIntentRules,
  createFakeIntentSchemas,
  createFakeSimulator,
  createFixedClock,
  createMemorySessionStore,
  createRecordingScheduler,
  createRecordingTransport,
} from "./fakes.ts";
import type { FakeAuthorityState } from "./fakes.ts";
import {
  decodeSnapshotDocument,
  documentSnapshotId,
  documentSubjects,
  encodeSnapshotDocument,
} from "./snapshot.ts";
import type { AuthoritySnapshotDocument, SnapshotDecodeResult } from "./snapshot.ts";
import { sha256Hex } from "./digest.ts";
import { validateEventStream } from "@playliquid/runtime-contracts";
import {
  asActorId,
  asDeterminismSeed,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
  asSessionId,
  asSnapshotId,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";

const tenant = asTenantId("tenant-alpha")!;
const subjectOne = asSubjectId("player-one")!;
const subjectTwo = asSubjectId("player-two")!;

interface Kit {
  readonly kernel: AuthoritySessionKernel<FakeAuthorityState>;
  readonly transport: ReturnType<typeof createRecordingTransport>;
  readonly store: ReturnType<typeof createMemorySessionStore>;
  readonly clock: ReturnType<typeof createFixedClock>;
  readonly scheduler: ReturnType<typeof createRecordingScheduler>;
}

function buildKernel(
  seed: string,
  over: Partial<AuthoritySessionKernelOptions<FakeAuthorityState>> = {},
): Kit {
  const transport = createRecordingTransport();
  const store = createMemorySessionStore();
  const clock = createFixedClock();
  const scheduler = createRecordingScheduler();
  const kernel = new AuthoritySessionKernel<FakeAuthorityState>({
    sessionId: asSessionId("session-royale-1"),
    tenant,
    gamePolicy: createFakeGamePolicy(),
    servicePolicy: { topology: "authoritative-server", competitiveUse: true, admission: "open" },
    simulator: createFakeSimulator(),
    intentSchemas: createFakeIntentSchemas(),
    intentRules: createFakeIntentRules(),
    transport: transport.transport,
    store: store.store,
    clock: clock.clock,
    scheduler: scheduler.scheduler,
    determinism: asDeterminismSeed(seed),
    tickIntervalMs: 50,
    protectedGrantKinds: FAKE_PROTECTED_GRANT_KINDS,
    ...over,
  });
  return { kernel, transport, store, clock, scheduler };
}

function drive(kit: Kit): void {
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  kit.kernel.admitParticipant({ tenant, subject: subjectTwo });
  kit.kernel.submitIntent(intent("player:player-one", "n-1", { dx: 1, dy: 2 }));
  kit.kernel.submitIntent(intent("player:player-two", "n-2", { dx: 3, dy: 0 }));
  kit.kernel.advanceTicks(1);
  kit.clock.advance(50);
  kit.kernel.submitIntent(intent("player:player-one", "n-3", { dx: 0, dy: 1 }));
  kit.kernel.advanceTicks(1);
}

function intent(actorId: string, nonce: string, payload: { dx: number; dy: number }) {
  return {
    intent: {
      intentId: asIntentId(`intent-${nonce}`),
      kind: asIntentKind("match.move"),
      actor: { actorClass: "player" as const, actorId: asActorId(actorId) },
      payload,
      issuedAt: asTimestamp(0),
    },
    origin: { kind: "player-input" as const },
    observedEpoch: asSessionEpoch(1),
    idempotencyKey: {
      scope: "command" as const,
      actor: asActorId(actorId),
      nonce: asIdempotencyNonce(nonce),
    },
  };
}

function intentRejected(result: IntentSubmitResult): string {
  if (result.status !== "rejected") assert.fail(`expected a rejection, got ${result.status}`);
  return result.code;
}

function restoreRefused(result: RestoreResult): string {
  if (result.ok) assert.fail("expected a restore refusal");
  return result.code;
}

function replayRefused(result: ReplayResult): string {
  if (result.ok) assert.fail("expected a replay refusal");
  return result.code;
}

function decodeRefused(result: SnapshotDecodeResult): string {
  if (result.ok) assert.fail("expected a decode refusal");
  return result.code;
}

test("determinism: identical runs produce byte-identical snapshot documents (E9)", () => {
  const first = buildKernel("seed-alpha");
  const second = buildKernel("seed-alpha");
  drive(first);
  drive(second);
  const a = first.kernel.snapshot();
  const b = second.kernel.snapshot();
  assert.ok(a.ok && b.ok);
  const textA = first.store.records()[0]?.document;
  const textB = second.store.records()[0]?.document;
  assert.equal(textA, textB, "canonical documents are byte-stable");
  assert.equal(a.snapshot.snapshotId, b.snapshot.snapshotId, "content-addressed ids collapse");
  assert.ok(String(a.snapshot.stateDigest).length === 64);
});

test("determinism: a different seed produces a different document", () => {
  const first = buildKernel("seed-alpha");
  const second = buildKernel("seed-beta");
  drive(first);
  drive(second);
  assert.notEqual(
    first.kernel.authorityState()?.drift,
    second.kernel.authorityState()?.drift,
    "precondition: the two seeds drift differently",
  );
  first.kernel.snapshot();
  second.kernel.snapshot();
  assert.notEqual(
    first.store.records()[0]?.document,
    second.store.records()[0]?.document,
  );
});

test("determinism: identical runs produce identical event streams", () => {
  const first = buildKernel("seed-alpha");
  const second = buildKernel("seed-alpha");
  drive(first);
  drive(second);
  assert.deepEqual(first.kernel.eventLog(), second.kernel.eventLog());
});

test("snapshot: store save is idempotent for identical content", () => {
  const kit = buildKernel("seed-alpha");
  drive(kit);
  const first = kit.kernel.snapshot();
  const second = kit.kernel.snapshot();
  assert.ok(first.ok && second.ok);
  assert.equal(first.snapshot.snapshotId, second.snapshot.snapshotId);
  assert.equal(kit.store.records().length, 1, "content-addressed saves collapse");
  assert.equal(
    String(second.snapshot.afterEventSeq),
    String(kit.kernel.eventLog().length),
    "boundary covers the committed head",
  );
});

test("snapshot: encode/decode round-trips byte-stably; corrupt bytes fail closed", () => {
  const kit = buildKernel("seed-alpha");
  drive(kit);
  assert.ok(kit.kernel.snapshot().ok);
  const text = kit.store.records()[0]?.document ?? "";
  const decoded = decodeSnapshotDocument<FakeAuthorityState>(text);
  assert.ok(decoded.ok);
  assert.equal(encodeSnapshotDocument(decoded.document), text, "re-encoding is byte-stable");
  assert.deepEqual(
    documentSubjects(decoded.document).map(String),
    ["player-one", "player-two"],
  );
  assert.equal(decodeRefused(decodeSnapshotDocument("this is not json")), "corrupt-snapshot");
  assert.equal(decodeRefused(decodeSnapshotDocument('{"version": 2}')), "corrupt-snapshot");
});

test("restore: resumes the world and advances the epoch (stale-result rule)", () => {
  const kit = buildKernel("seed-alpha");
  drive(kit);
  assert.ok(kit.kernel.snapshot().ok);
  const snapshotId = kit.store.records()[0]?.snapshot.snapshotId;
  const restored = kit.kernel.restore(snapshotId!);
  assert.ok(restored.ok);
  assert.equal(restored.sessionView.epoch, 2, "restore advances the epoch");
  assert.equal(restored.sessionView.phase, "ready");
  assert.equal(restored.resumedFromTick, 2);
  // Pre-restore results are stale: a new intent must observe the new epoch.
  const stale = kit.kernel.submitIntent(intent("player:player-one", "n-9", { dx: 1, dy: 0 }));
  assert.equal(intentRejected(stale), "stale-epoch", "old-epoch submissions are stale");
  const fresh = kit.kernel.submitIntent({
    ...intent("player:player-one", "n-9", { dx: 1, dy: 0 }),
    observedEpoch: asSessionEpoch(2),
  });
  assert.equal(fresh.status, "admitted");
});

test("restore: the resumed world evolves identically to an uninterrupted control", () => {
  const kit = buildKernel("seed-alpha");
  const control = buildKernel("seed-alpha");
  drive(kit);
  drive(control);
  assert.ok(kit.kernel.snapshot().ok);
  const snapshotId = kit.store.records()[0]?.snapshot.snapshotId;
  assert.ok(kit.kernel.restore(snapshotId!).ok);
  kit.kernel.submitIntent({
    ...intent("player:player-one", "n-10", { dx: 2, dy: 2 }),
    observedEpoch: asSessionEpoch(2),
  });
  control.kernel.submitIntent(intent("player:player-one", "n-10", { dx: 2, dy: 2 }));
  kit.kernel.advanceTicks(1);
  control.kernel.advanceTicks(1);
  assert.deepEqual(kit.kernel.authorityState()?.positions, control.kernel.authorityState()?.positions);
  assert.deepEqual(kit.kernel.authorityState()?.scores, control.kernel.authorityState()?.scores);
});

test("restore: idempotency tables survive (E6 durable admissions)", () => {
  const kit = buildKernel("seed-alpha");
  kit.kernel.open();
  kit.kernel.admitParticipant({ tenant, subject: subjectOne });
  kit.kernel.submitIntent(intent("player:player-one", "n-1", { dx: 1, dy: 0 }));
  assert.ok(kit.kernel.snapshot().ok);
  const snapshotId = kit.store.records()[0]?.snapshot.snapshotId;
  assert.ok(kit.kernel.restore(snapshotId!).ok);
  const retry = kit.kernel.submitIntent({
    ...intent("player:player-one", "n-1", { dx: 1, dy: 0 }),
    observedEpoch: asSessionEpoch(2),
  });
  assert.equal(retry.status, "duplicate", "the pre-restore admission is remembered");
});

test("restore: refuses unknown snapshots, foreign snapshots and terminal sessions", () => {
  const kit = buildKernel("seed-alpha");
  kit.kernel.open();
  assert.equal(restoreRefused(kit.kernel.restore(asSnapshotId("deadbeef"))), "unknown-snapshot");

  const other = buildKernel("seed-alpha", { sessionId: asSessionId("session-royale-2") });
  other.kernel.open();
  other.kernel.admitParticipant({ tenant, subject: subjectOne });
  assert.ok(other.kernel.snapshot().ok);
  const foreignId = other.store.records()[0]?.snapshot.snapshotId;
  assert.equal(restoreRefused(kit.kernel.restore(foreignId!)), "unknown-snapshot", "store is session-scoped");

  kit.kernel.admitParticipant({ tenant, subject: subjectTwo });
  assert.ok(kit.kernel.snapshot().ok);
  const ownId = kit.store.records()[0]?.snapshot.snapshotId;
  assert.ok(kit.kernel.restore(ownId!).ok);

  kit.kernel.terminate("done");
  assert.equal(
    restoreRefused(kit.kernel.restore(ownId!)),
    "session-terminal",
    "restore-after-terminate is refused (misuse)",
  );
});

test("replay: the full log validates from seq 1; snapshots open later boundaries (R8)", () => {
  const kit = buildKernel("seed-alpha");
  drive(kit);
  const fromStart = kit.kernel.replay();
  assert.ok(fromStart.ok);
  assert.equal(fromStart.fromSeq, 1);
  assert.equal(fromStart.events.length, kit.kernel.eventLog().length);
  const commandIds = kit.kernel
    .eventLog()
    .flatMap((event) => (event.cause.kind === "command" ? [event.cause.commandId] : []));
  assert.ok(
    validateEventStream([...fromStart.events], { startAtSeq: 1, admittedCommandIds: commandIds }).ok,
  );

  assert.ok(kit.kernel.snapshot().ok);
  const boundary = kit.store.records()[0]?.snapshot;
  const afterBoundary = kit.kernel.replay(boundary?.snapshotId);
  assert.ok(afterBoundary.ok);
  assert.equal(afterBoundary.fromSeq, String(boundary?.afterEventSeq) === "0" ? 1 : Number(boundary?.afterEventSeq) + 1);
  assert.equal(afterBoundary.events.length, 0, "head boundary replays nothing new");

  assert.equal(replayRefused(kit.kernel.replay(asSnapshotId("nope"))), "unknown-snapshot");
});

test("document: snapshot ids equal the document digest (content addressing)", () => {
  const kit = buildKernel("seed-alpha");
  drive(kit);
  assert.ok(kit.kernel.snapshot().ok);
  const text = kit.store.records()[0]?.document ?? "";
  const record = kit.store.records()[0]?.snapshot;
  assert.equal(String(record?.snapshotId), sha256Hex(text));
  assert.equal(String(documentSnapshotId(text)), String(record?.snapshotId));
  const decoded = decodeSnapshotDocument(text) as { ok: boolean; document?: AuthoritySnapshotDocument };
  assert.ok(decoded.ok);
  assert.equal(decoded.document?.kind, "platform-multiplayer-authority-session");
  assert.equal(decoded.document?.version, 1);
});
