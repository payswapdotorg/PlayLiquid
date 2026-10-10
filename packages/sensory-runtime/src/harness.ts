/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives the full PL-027 sensory-runtime story over the REAL
 * avatar-runtime composition and the REAL capability broker from the
 * sibling packages:
 * 1. compose a demo avatar with vision+audio+proprioception channels
 *    (avatar-runtime composition, restriction projection included);
 * 2. bind seeded producers (E9: identical seeds, identical frames);
 * 3. poll under the injected clock: frames admit through the codecs,
 *    land in the content-addressed history with 64-hex digests;
 * 4. R5 restriction: a denied channel produces NOTHING and is recorded
 *    as POLICY (channel-restricted), never silently dropped;
 * 5. E10 idempotency: re-polling the identical frame returns the
 *    recorded receipt — no second mutation;
 * 6. E9 epoch monotonicity: a regressed producer epoch is refused;
 * 7. E8 refusal: a malformed frame and a capability/channel mismatch
 *    are typed refusals;
 * 8. the perception seam: the history feeds avatar-runtime's
 *    SensorInputPort.poll() and the PL-026 driver cycle consumes it
 *    through the REAL broker — audio+proprioception perceived (the
 *    digest-pinned vision envelope is the driver's own R5 filter input),
 *    a scripted claim granted and emitted as `world.move`;
 * 9. determinism: a second identically-wired world produces identical
 *    digests, records and driver output.
 *
 * Prints machine-readable JSON; exits non-zero on any unexpected
 * outcome. No IO beyond stdout; no clock reads (ManualClock); no
 * randomness (SeededStream).
 */

import { asDigest, asSessionEpoch, asSessionId, asTick } from "@playliquid/runtime-contracts";
import { CapabilityBroker, ManualBrokerClock, makeGrant } from "@playliquid/capability-broker";
import { deriveBrokerPolicy } from "@playliquid/capability-broker";
import { demoCoverage, demoGameDocument } from "@playliquid/capability-broker";
import { AvatarRuntime, composeAvatar } from "@playliquid/avatar-runtime";
import {
  InMemoryActuatorOutput,
  InMemoryAvatarMemory,
  ScriptedIntelligence,
} from "@playliquid/avatar-runtime";
import type { ComposeAvatarInput } from "@playliquid/avatar-runtime";
import { asAgentId, asAvatarId } from "@playliquid/game-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { InMemorySensoryHistory, ManualClock, SeededProducer } from "./fakes.ts";
import type { RawProducerFrame } from "./codec.ts";
import { SensorHistoryInput } from "./perception.ts";
import { SensoryService } from "./service.ts";

const TENANT = asTenantId("tenant-harness")!;
const SUBJECT = asSubjectId("subject-harness")!;
const SESSION = asSessionId("sensory-harness");
const ACTOR = { actorClass: "avatar-agent" as const, actorId: "demo-avatar" as never };
const D = asDigest("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

function pkg(packageId: string): { packageId: string; version: string } {
  return { packageId, version: "1.0.0" };
}

/** A harness avatar with three sensory channels. */
function harnessAvatarInput(): ComposeAvatarInput {
  return {
    avatarId: asAvatarId("harness-avatar") as never,
    agent: asAgentId("harness-agent"),
    body: {
      subRecordVersion: { subRecord: "body", version: 1, revisionDigest: D },
      geometry: pkg("asset.body.geometry"),
      skeleton: pkg("asset.body.skeleton"),
      animation: pkg("asset.body.animation"),
      physics: pkg("asset.body.physics"),
      appearance: pkg("asset.body.appearance"),
    },
    sensors: {
      subRecordVersion: { subRecord: "sensors", version: 1, revisionDigest: D },
      channels: [
        { capability: "vision", channel: "vision.main" },
        { capability: "audio", channel: "audio.main" },
        { capability: "proprioception", channel: "proprio.main" },
      ],
    },
    actuators: {
      subRecordVersion: { subRecord: "actuators", version: 1, revisionDigest: D },
      actuators: [{ capability: "movement", serves: ["move.to" as never] }],
    },
    memory: {
      subRecordVersion: { subRecord: "memory", version: 1, revisionDigest: D },
      topology: "local",
      persistence: "session",
    },
    intelligence: {
      subRecordVersion: { subRecord: "intelligence", version: 1, revisionDigest: D },
      cognitiveSubstrate: pkg("brain.substrate.cognitive"),
      skills: [pkg("skill.navigation")],
    },
  } as unknown as ComposeAvatarInput;
}

/** Compose once per world (valid fixture — a failure here is a test bug). */
function composedDefinition() {
  const composed = composeAvatar(harnessAvatarInput());
  if (!composed.ok) throw new Error(composed.detail);
  return composed.definition;
}

interface World {
  readonly service: SensoryService;
  readonly vision: SeededProducer;
  readonly audio: SeededProducer;
  readonly proprio: SeededProducer;
  readonly history: InMemorySensoryHistory;
  readonly clock: ManualClock;
}

function wire(): World {
  const history = new InMemorySensoryHistory();
  const clock = new ManualClock(1000);
  const service = new SensoryService({ history, clock });
  const vision = new SeededProducer({ channel: "vision.main", capability: "vision", seed: 42 });
  const audio = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 43 });
  const proprio = new SeededProducer({ channel: "proprio.main", capability: "proprioception", seed: 44 });
  const registered = service.registerHost(
    { tenant: TENANT, subject: SUBJECT },
    {
      tenant: TENANT,
      avatarKey: "harness-avatar",
      definition: composedDefinition(),
      restriction: { denied: ["vision"], approvalRequired: [], sandboxed: false },
      producers: [vision, audio, proprio],
    },
  );
  if (!registered.ok) throw new Error(registered.detail);
  return { service, vision, audio, proprio, history, clock };
}

interface Evidence {
  readonly composed: boolean;
  readonly seededDeterminism: boolean;
  readonly admittedDigestsAreHex64: boolean;
  readonly visionRestrictedPolicy: string;
  readonly visionHistoryEmpty: boolean;
  readonly idempotentReceipt: string;
  readonly historySizeAfterReplay: number;
  readonly appendedAtFirstPoll: number;
  readonly restrictedChannelsAtFirstPoll: readonly string[];
  readonly epochRegression: string;
  readonly malformedRefusal: string;
  readonly mismatchRefusal: string;
  readonly crossTenantRefusal: string;
  readonly seamFeedsDriver: readonly number[];
  readonly driverEmittedKinds: readonly string[];
  readonly deterministicReplay: boolean;
}

function drive(world: World): {
  pollReport: ReturnType<World["service"]["poll"]>;
  seamCounts: [number, number];
  emittedKinds: readonly string[];
} {
  world.vision.emit(asSessionEpoch(1), asTick(1));
  world.audio.emit(asSessionEpoch(1), asTick(1));
  world.proprio.emit(asSessionEpoch(1), asTick(1));
  const pollReport = world.service.poll({ tenant: TENANT, subject: SUBJECT }, asSessionEpoch(1), asTick(1));

  // The perception seam + the PL-026 driver over the REAL broker.
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  const broker = new CapabilityBroker({ policy: derived.policy, clock: new ManualBrokerClock(10) });
  broker.admit({
    grant: makeGrant({
      grantId: "grant-move" as never,
      holder: ACTOR,
      scope: { sessionId: SESSION },
      constraints: [{ kind: "total-count", max: 1 }],
    }),
  });
  const sensors = new SensorHistoryInput({ tenant: TENANT, history: world.history });
  const memory = new InMemoryAvatarMemory();
  const intelligence = new ScriptedIntelligence(ACTOR, [
    { intentKind: "move.to", nonce: "m-1", grantId: "grant-move", payload: { to: [1, 2] } },
  ]);
  const actuators = new InMemoryActuatorOutput();
  const driver = new AvatarRuntime({
    definition: composedDefinition(),
    restriction: { denied: ["vision"], approvalRequired: [], sandboxed: false },
    sessionId: SESSION,
    actor: ACTOR,
    broker,
    ports: { sensors, memory, intelligence, actuators },
  });
  const report = driver.cycle({ epoch: asSessionEpoch(1), tick: asTick(1) });
  return {
    pollReport,
    seamCounts: [report.perceived, report.filtered],
    emittedKinds: actuators.commands.map((command) => String(command.kind)),
  };
}

function main(): Evidence {
  const world = wire();

  // Seeded determinism: two producers, same seed, same frames.
  const twinVision = new SeededProducer({ channel: "vision.main", capability: "vision", seed: 42 });
  world.vision.emit(asSessionEpoch(1), asTick(1));
  twinVision.emit(asSessionEpoch(1), asTick(1));
  const seededDeterminism =
    JSON.stringify(world.vision.poll()[0]?.payload) === JSON.stringify(twinVision.poll()[0]?.payload);

  const first = drive(world);
  const okPoll = first.pollReport.ok;
  const report = okPoll ? first.pollReport.reports[0] : undefined;
  const pollAppended = okPoll ? first.pollReport.reports[0]?.appended ?? -1 : -1;

  const records = world.history.read(TENANT);
  // game-ir's hashGameIRValue is the kernel's digest authority: BARE 64-hex.
  const admittedDigestsAreHex64 = records.every((record) => /^[0-9a-f]{64}$/.test(record.contentDigest));
  const visionRestrictedPolicy = report?.policyEvents.find((event) => event.kind === "channel-restricted")?.kind ?? "none";
  const visionHistoryEmpty = world.history.readChannel(TENANT, "vision.main").length === 0;
  const restrictedChannelsAtFirstPoll = report?.restrictedChannels ?? [];

  // E10 idempotency: replay the IDENTICAL audio frame verbatim (a fresh
  // same-seed producer's first frame is byte-identical to the admitted one).
  const twinAudio = new SeededProducer({ channel: "audio.main", capability: "audio", seed: 43 });
  twinAudio.emit(asSessionEpoch(1), asTick(1));
  const replayedFrame = twinAudio.poll()[0] as RawProducerFrame;
  const audioBefore = world.history.readChannel(TENANT, "audio.main").length;
  world.audio.enqueueRaw(replayedFrame);
  world.service.poll({ tenant: TENANT, subject: SUBJECT }, asSessionEpoch(1), asTick(2));
  const audioAfter = world.history.readChannel(TENANT, "audio.main").length;
  const idempotentReceipt =
    audioBefore === audioAfter ? "recorded-receipt" : `mutated(${audioBefore}->${audioAfter})`;
  // 2 admitted at the first poll (vision restricted) + 0 on the replay.
  const historySizeAfterReplay = world.history.size;
  const appendedAtFirstPoll = pollAppended;

  // E9: epoch regression refused.
  world.audio.enqueueRaw({ channel: "audio.main", capability: "audio", epoch: asSessionEpoch(0), tick: asTick(3), payload: { kind: "audio-frame", frame: 9, level: 0.5 } });
  const regressionPoll = world.service.poll({ tenant: TENANT, subject: SUBJECT }, asSessionEpoch(2), asTick(3));
  const regressionReport = regressionPoll.ok ? regressionPoll.reports[0] : undefined;
  const epochRegression = regressionReport?.policyEvents.find((event) => event.kind === "epoch-regression")
    ? "epoch-regression"
    : "none";

  // E8 refusals: malformed frame + capability mismatch.
  world.audio.enqueueRaw({ channel: "audio.main", capability: "audio", epoch: asSessionEpoch(2), tick: asTick(4), payload: { kind: "audio-frame", frame: -1, level: 0.5 } });
  const malformedPoll = world.service.poll({ tenant: TENANT, subject: SUBJECT }, asSessionEpoch(2), asTick(4));
  const malformedReport = malformedPoll.ok ? malformedPoll.reports[0] : undefined;
  const malformedRefusal = malformedReport?.refusals[0]?.code ?? "none";

  world.audio.enqueueRaw({ channel: "audio.main", capability: "audio", epoch: asSessionEpoch(2), tick: asTick(5), payload: { kind: "visual-field", width: 1, height: 1, cells: [0.5] } });
  const mismatchPoll = world.service.poll({ tenant: TENANT, subject: SUBJECT }, asSessionEpoch(2), asTick(5));
  const mismatchReport = mismatchPoll.ok ? mismatchPoll.reports[0] : undefined;
  const mismatchRefusal = mismatchReport?.refusals[0]?.code ?? "none";

  // R20: cross-tenant read refused.
  const otherTenant = asTenantId("tenant-other")!;
  const cross = world.service.historyOf({ tenant: otherTenant, subject: SUBJECT }, TENANT);
  const crossTenantRefusal = cross.ok ? "leaked" : cross.code;

  // Deterministic replay of the whole story.
  const twinWorld = wire();
  const twinFirst = drive(twinWorld);
  const twinRecords = twinWorld.history.read(TENANT);
  const deterministicReplay =
    JSON.stringify(twinRecords.map((record) => [String(record.recordId), record.channel])) ===
      JSON.stringify(records.slice(0, twinRecords.length).map((record) => [String(record.recordId), record.channel])) &&
    JSON.stringify(twinFirst.emittedKinds) === JSON.stringify(first.emittedKinds) &&
    twinFirst.seamCounts[0] === first.seamCounts[0] &&
    twinFirst.seamCounts[1] === first.seamCounts[1];

  return {
    composed: true,
    seededDeterminism,
    admittedDigestsAreHex64,
    visionRestrictedPolicy,
    visionHistoryEmpty,
    idempotentReceipt,
    historySizeAfterReplay,
    appendedAtFirstPoll,
    restrictedChannelsAtFirstPoll,
    epochRegression,
    malformedRefusal,
    mismatchRefusal,
    crossTenantRefusal,
    seamFeedsDriver: first.seamCounts,
    driverEmittedKinds: first.emittedKinds,
    deterministicReplay,
  };
}

const evidence = main();
const ok =
  evidence.composed &&
  evidence.seededDeterminism &&
  evidence.admittedDigestsAreHex64 &&
  evidence.visionRestrictedPolicy === "channel-restricted" &&
  evidence.visionHistoryEmpty &&
  evidence.idempotentReceipt === "recorded-receipt" &&
  evidence.historySizeAfterReplay === 2 &&
  evidence.appendedAtFirstPoll === 2 &&
  JSON.stringify(evidence.restrictedChannelsAtFirstPoll) === '["vision.main"]' &&
  evidence.epochRegression === "epoch-regression" &&
  evidence.malformedRefusal === "malformed-payload" &&
  evidence.mismatchRefusal === "capability-payload-mismatch" &&
  evidence.crossTenantRefusal === "cross-tenant" &&
  JSON.stringify(evidence.seamFeedsDriver) === "[2,0]" &&
  JSON.stringify(evidence.driverEmittedKinds) === '["world.move"]' &&
  evidence.deterministicReplay;

console.log(JSON.stringify({ workOrder: "PL-027", package: "sensory-runtime", ok, evidence }, null, 2));
if (!ok) {
  process.exitCode = 1;
}
