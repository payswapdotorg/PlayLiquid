/**
 * DEMO STUDIO FIXTURE (harness + tests + web preview mount): ONE
 * authoritative `StudioDataSnapshot` assembled from the REAL sibling
 * systems — sealed package records + release-gate verdicts + a lock
 * (package-system), a live interactive kernel session driven through its
 * public operations (runtime-core over runtime-contracts), a real broker
 * with a seeded grant table and two evaluations (capability-broker), the
 * composed demo avatar under a host restriction (avatar-runtime +
 * game-contracts R5) and a tool-fabric runtime with two registered demo
 * tools and three jobs (tool-fabric-runtime).
 *
 * TEST-SUPPORT / DEMO FIXTURE ONLY (lock rule 44): nothing here is a
 * production integration. Every object is REAL sibling-package data — the
 * only local double is the structural Adapter ({@link LocalAdapter}) used
 * to register the demo tools (game-ui does not depend on
 * engine-adapter-contract; the seam is consumed through registrations).
 *
 * Async because tool-job admission/pumping is await-based in the fabric
 * runtime; the result is a plain frozen data snapshot afterwards.
 */

import {
  LOCK_SCHEMA_VERSION,
  checkReleaseGate,
  parseSemver,
  sealPackageRecord,
} from "@playliquid/package-system";
import type {
  PackageArtifact,
  PackageLock,
  PackageMetadata,
  PackageRecord,
  ReleaseGateResult,
  UnsealedPackageRecord,
} from "@playliquid/package-system";
import {
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemorySnapshotStore,
  ManualClock,
  avatarActor as kernelAvatarActor,
  createInteractiveRuntime,
  interactiveDescriptor,
  playerActor,
} from "@playliquid/runtime-core";
import type { SessionOperation } from "../view/runtime-view.ts";
import {
  asCapabilityGrantId,
  asCapabilityId,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
  asSessionId,
  asTick,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import type { ActionResolution, IntentKind } from "@playliquid/runtime-contracts";
import {
  CapabilityBroker,
  DEMO_ACTOR,
  DEMO_MANIPULATION_CAPABILITY,
  DEMO_MOVEMENT_CAPABILITY,
  DEMO_SENSORY_OUTPUT_CAPABILITY,
  DEMO_SESSION,
  ManualBrokerClock,
  actionRequest,
  brokerPolicy,
  demoCoverage,
  evaluationContext,
  grantId,
  moveIntent,
  seedGrants,
} from "@playliquid/capability-broker";
import type { BrokerPolicy } from "@playliquid/capability-broker";
import { demoAvatarDefinition } from "@playliquid/avatar-runtime";
import type { HostRestriction } from "@playliquid/game-contracts";
import {
  createFakeExecutor,
  createInMemoryArtifactExchange,
  createInMemoryClock,
  createInMemoryShapeCatalog,
  createToolFabricRuntime,
} from "@playliquid/tool-fabric-runtime";
import type {
  ToolJobSnapshot,
  ToolRegistration,
} from "@playliquid/tool-fabric-runtime";
import type { JobEventLike } from "../view/tools-view.ts";
import { LocalAdapter } from "../fakes.ts";
import type { StudioDataSnapshot } from "../view/studio-view.ts";

/** Demo session id (kernel surface). */
export const DEMO_STUDIO_SESSION_ID = "studio-demo-session";

// ---------------------------------------------------------------------------
// Packages surface
// ---------------------------------------------------------------------------

function demoMetadata(licenseStatus: "verified" | "declared"): PackageMetadata {
  return {
    dependencies: [],
    providedCapabilities: [{ id: "game.demo/rules", version: parseSemver("1.0.0")! }],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: licenseStatus },
    provenance: {
      origin: { type: "original" },
      sourceCommit: null,
      transformationHistory: [{ kind: "author", description: "authored in the Game Studio demo" }],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ["interactive", "simulation"], engines: [], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [{ storage: "inline", base64: "ZGVtbw==", mediaType: "text/plain" } as PackageArtifact],
    extensionPoints: [],
    overlay: null,
  };
}

function demoDerivativeMetadata(): PackageMetadata {
  const base = {
    kind: "assets" as const,
    id: "asset.base-kit",
    version: parseSemver("0.8.0")!,
    contentDigest: `sha256:${"a".repeat(64)}`,
  };
  const origin = demoMetadata("declared");
  return {
    ...origin,
    lineage: { origin: base, parent: base },
    provenance: {
      ...origin.provenance,
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    },
  };
}

function demoPackages(): {
  readonly records: readonly PackageRecord[];
  readonly gateResults: Readonly<Record<string, ReleaseGateResult>>;
  readonly lock: PackageLock;
} {
  const gameRecord = sealPackageRecord({
    identity: { kind: "game", id: "game.demo-arena", version: parseSemver("1.2.0")! },
    metadata: demoMetadata("verified"),
  } satisfies UnsealedPackageRecord);
  const assetRecord = sealPackageRecord({
    identity: { kind: "assets", id: "asset.demo-kit", version: parseSemver("0.9.0")! },
    metadata: demoDerivativeMetadata(),
  } satisfies UnsealedPackageRecord);
  const records = [gameRecord, assetRecord];
  const gateResults: Record<string, ReleaseGateResult> = {};
  for (const record of records) {
    gateResults[record.identity.id] = checkReleaseGate(record);
  }
  const lock: PackageLock = {
    lockVersion: LOCK_SCHEMA_VERSION,
    packages: records.map((record) => ({
      kind: record.identity.kind,
      id: record.identity.id,
      version: record.identity.version,
      contentDigest: record.identity.contentDigest,
    })),
    hostCapabilities: [],
  };
  return { records, gateResults, lock };
}

// ---------------------------------------------------------------------------
// Session surface (runtime-core kernel, public operations only)
// ---------------------------------------------------------------------------

function demoKernel() {
  const clock = new ManualClock(1000);
  const grant = {
    grantId: asCapabilityGrantId("grant-studio-kernel"),
    holder: kernelAvatarActor("studio-avatar"),
    capability: asCapabilityId("world.counter"),
    scope: { sessionId: asSessionId(DEMO_STUDIO_SESSION_ID) },
    constraints: [],
    issuedBy: "host-game-policy" as const,
    epoch: asSessionEpoch(1),
  };
  const capabilityPort = new GrantTableCapabilityPort({
    grants: [grant],
    capabilityIntentKinds: { "world.counter": [asIntentKind("world.increment")] },
    intentCommandKinds: { "world.increment": "world.increment" },
    clock,
  });
  const created = createInteractiveRuntime({
    descriptor: interactiveDescriptor(DEMO_STUDIO_SESSION_ID, "studio-demo-seed"),
    driver: new CounterWorldDriver(),
    capabilityPort,
    snapshotStore: new InMemorySnapshotStore(),
  });
  if (created.status !== "created") {
    throw new Error(`demo fixture: kernel creation refused: ${created.detail}`);
  }
  return { kernel: created.kernel, clock, grantId: grant.grantId };
}

function demoSession() {
  const { kernel, clock, grantId } = demoKernel();
  const operations: SessionOperation[] = [];
  operations.push(kernel.load());
  operations.push(
    kernel.act({
      intent: {
        intentId: asIntentId("intent-studio-p1"),
        kind: asIntentKind("world.increment"),
        actor: playerActor("studio-player"),
        payload: { by: 2 },
        issuedAt: clock.now(),
      },
      nonce: asIdempotencyNonce("studio-nonce-p1"),
    }),
  );
  operations.push(
    kernel.act({
      intent: {
        intentId: asIntentId("intent-studio-a1"),
        kind: asIntentKind("world.increment"),
        actor: kernelAvatarActor("studio-avatar"),
        payload: { by: 5 },
        issuedAt: clock.now(),
      },
      grantId,
      nonce: asIdempotencyNonce("studio-nonce-a1"),
    }),
  );
  operations.push(kernel.step(3));
  const observed = kernel.observe(0);
  operations.push(observed);
  operations.push(kernel.snapshot());
  operations.push(kernel.replay({ fromEventSeq: 1, toEventSeq: null }));
  return {
    session: kernel.view(),
    operations,
    observation: observed.status === "observed" ? observed.observation : undefined,
  };
}

// ---------------------------------------------------------------------------
// Broker surface (capability-broker: real policy + broker + evaluations)
// ---------------------------------------------------------------------------

function demoBroker() {
  const policyResult = brokerPolicy(demoCoverage(), {
    denied: [DEMO_SENSORY_OUTPUT_CAPABILITY],
    approvalRequired: [DEMO_MANIPULATION_CAPABILITY],
  });
  if (!policyResult.ok) {
    throw new Error(`demo fixture: broker policy invalid: ${policyResult.detail}`);
  }
  const policy: BrokerPolicy = policyResult.policy;
  const broker = new CapabilityBroker({
    policy,
    clock: new ManualBrokerClock(0),
    commandIdPrefix: "studio",
  });
  const movementGrant = {
    grantId: grantId("grant-studio-movement"),
    holder: DEMO_ACTOR,
    capability: DEMO_MOVEMENT_CAPABILITY,
    scope: { sessionId: DEMO_SESSION },
    constraints: [],
    issuedBy: "host-game-policy" as const,
    epoch: asSessionEpoch(1),
  };
  seedGrants(broker, [movementGrant]);
  const context = evaluationContext(DEMO_SESSION, 1, asTick(5));
  const granted = broker.evaluate(
    actionRequest(DEMO_SESSION, DEMO_ACTOR, moveIntent(DEMO_ACTOR, "studio-1"), movementGrant.grantId, "studio-1"),
    context,
  );
  const denied = broker.evaluate(
    actionRequest(
      DEMO_SESSION,
      DEMO_ACTOR,
      {
        intentId: asIntentId("intent-studio-speak"),
        kind: asIntentKind("speak.say"),
        actor: DEMO_ACTOR,
        payload: { text: "hello" },
        issuedAt: asTimestamp(10),
      },
      grantId("grant-studio-missing"),
      "studio-2",
    ),
    context,
  );
  const evaluations: readonly { readonly intentKind: IntentKind; readonly resolution: ActionResolution }[] = [
    { intentKind: asIntentKind("move.to"), resolution: granted },
    { intentKind: asIntentKind("speak.say"), resolution: denied },
  ];
  return { policy, broker, evaluations };
}

// ---------------------------------------------------------------------------
// Tools surface (tool-fabric-runtime + local structural adapter)
// ---------------------------------------------------------------------------

async function demoTools(): Promise<{
  readonly registrations: readonly ToolRegistration[];
  readonly jobs: readonly ToolJobSnapshot[];
  readonly events: readonly JobEventLike[];
}> {
  const events: JobEventLike[] = [];
  const clock = createInMemoryClock(0);
  const executor = createFakeExecutor(() => clock.now());
  const shapeCatalog = createInMemoryShapeCatalog();
  const diceInput = { shapeId: "studio.demo/dice-roll-input", revision: 1 };
  const weatherInput = { shapeId: "studio.demo/weather-input", revision: 1 };
  shapeCatalog.register(diceInput, () => []);
  shapeCatalog.register(weatherInput, () => []);
  const runtime = createToolFabricRuntime({
    clock,
    executor,
    shapeCatalog,
    artifactExchange: createInMemoryArtifactExchange(),
    eventSink: { emit: (event) => events.push(event) },
  });

  const adapter = new LocalAdapter({
    id: "fabric.demo",
    label: "Studio Demo Fabric",
    offeredCapabilities: ["tool-fabric.invoke"],
  });
  const ready = adapter.markReady();
  if (ready.outcome !== "ok") {
    throw new Error(`demo fixture: adapter never leaves registered: ${ready.message}`);
  }

  const diceDescriptor = {
    identity: { namespace: "studio.demo", name: "dice-roll" },
    surfaceVersion: { major: 1, minor: 2 },
    title: "Dice Roll",
    description: "Deterministic demo dice roll over the tool fabric.",
    inputShape: diceInput,
    outputShape: { shapeId: "studio.demo/dice-roll-output", revision: 1 },
    capabilities: [],
  };
  const weatherDescriptor = {
    identity: { namespace: "studio.demo", name: "weather-sim" },
    surfaceVersion: { major: 1, minor: 0 },
    title: "Weather Sim",
    description: "Deterministic demo weather simulation over the tool fabric.",
    inputShape: weatherInput,
    outputShape: { shapeId: "studio.demo/weather-output", revision: 1 },
    capabilities: [],
  };
  for (const descriptor of [diceDescriptor, weatherDescriptor]) {
    const check = runtime.registerTool({ descriptor, adapter, dispatchCapability: "tool-fabric.invoke" });
    if (check.outcome !== "ok") {
      throw new Error(
        `demo fixture: tool registration rejected: ${check.rejections.map((item) => item.message).join("; ")}`,
      );
    }
  }

  const diceCall = (callId: string) => ({
    kind: "tool-call-request" as const,
    callId,
    tool: diceDescriptor.identity,
    surfaceVersion: diceDescriptor.surfaceVersion,
    input: { sides: 6, rolls: 2 },
    requiredCapabilities: [],
  });

  const first = await runtime.enqueueJob({ jobId: "studio-job-dice-1", call: diceCall("studio-call-1"), maxAttempts: 3 });
  if (first.outcome !== "admitted") throw new Error(`demo fixture: dice job 1 not admitted: ${String(first.outcome)}`);
  await runtime.pumpJobs();

  executor.scriptNextResult({
    outcome: "refused",
    code: "executor/adapter-refused",
    message: "scripted refusal (demo evidence)",
  });
  const weather = await runtime.enqueueJob({
    jobId: "studio-job-weather-1",
    call: {
      kind: "tool-call-request",
      callId: "studio-call-weather",
      tool: weatherDescriptor.identity,
      surfaceVersion: weatherDescriptor.surfaceVersion,
      input: { region: "demo-north" },
      requiredCapabilities: [],
    },
    maxAttempts: 1,
  });
  if (weather.outcome !== "admitted") throw new Error(`demo fixture: weather job not admitted: ${String(weather.outcome)}`);
  await runtime.pumpJobs();

  const second = await runtime.enqueueJob({ jobId: "studio-job-dice-2", call: diceCall("studio-call-2"), maxAttempts: 3 });
  if (second.outcome !== "admitted") throw new Error(`demo fixture: dice job 2 not admitted: ${String(second.outcome)}`);

  return { registrations: runtime.listTools(), jobs: runtime.jobSnapshots(), events };
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/** The host restriction applied to the demo avatar (R5 vocabulary). */
export const DEMO_RESTRICTION: HostRestriction = {
  denied: ["audio"],
  approvalRequired: ["speech"],
  sandboxed: false,
};

/**
 * Build the ONE demo studio snapshot. Deterministic: same data every run
 * (manual clocks, fixed seeds, scripted refusal).
 */
export async function demoStudioSnapshot(): Promise<StudioDataSnapshot> {
  const packages = demoPackages();
  const session = demoSession();
  const broker = demoBroker();
  const tools = await demoTools();
  return Object.freeze({
    packages: packages.records,
    gateResults: packages.gateResults,
    lock: packages.lock,
    session: session.session,
    operations: session.operations,
    observation: session.observation,
    avatars: [demoAvatarDefinition()],
    restriction: DEMO_RESTRICTION,
    policy: broker.policy,
    broker: broker.broker,
    evaluations: broker.evaluations,
    registrations: tools.registrations,
    jobs: tools.jobs,
    events: tools.events,
  } satisfies StudioDataSnapshot);
}
