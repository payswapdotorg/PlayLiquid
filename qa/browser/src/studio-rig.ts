/**
 * STUDIO JOURNEY RIG — the HOST side of the Game Studio journey (PL-043).
 *
 * The task order for this journey: "a host composes the Studio view models
 * over real package-system/runtime/tool-fabric/avatar/capability read
 * models". This rig IS that host: it assembles ONE authoritative
 * `StudioDataSnapshot` from the REAL sibling systems through their public
 * entrypoints only — sealed package records + release-gate verdicts + a
 * lockfile (`@playliquid/package-system`), a live interactive kernel
 * session driven through its public operations (`@playliquid/runtime-core`
 * over `@playliquid/runtime-contracts`), a real broker with a seeded grant
 * and tracked evaluations (`@playliquid/capability-broker`), the demo
 * avatar under a host restriction (`@playliquid/avatar-runtime` + R5
 * vocabulary of `@playliquid/game-contracts`) and a tool-fabric runtime
 * with two jobs (`@playliquid/tool-fabric-runtime` over game-ui's labeled
 * TEST-SUPPORT structural adapter).
 *
 * TEST-SUPPORT RIG (lock rule 44): nothing here is a production
 * integration — it is the same honesty class as game-ui's own demo
 * fixture, deliberately composed with DIFFERENT data (ids, versions,
 * seeds, scripts) so the journey proves the host seam independently of
 * the package's own tests.
 *
 * Determinism (E9): manual clocks everywhere, fixed seeds, a scripted
 * executor; calling {@link composeStudioJourneySnapshot} twice yields
 * deep-equal snapshots (asserted by the journey).
 */

import {
  LOCK_SCHEMA_VERSION,
  checkReleaseGate,
  parseSemver,
  sealPackageRecord,
} from "../../../packages/package-system/src/index.ts";
import type {
  PackageLock,
  PackageRecord,
  ReleaseGateResult,
  UnsealedPackageRecord,
} from "../../../packages/package-system/src/index.ts";
import {
  CounterWorldDriver,
  GrantTableCapabilityPort,
  InMemorySnapshotStore,
  ManualClock,
  avatarActor,
  createInteractiveRuntime,
  interactiveDescriptor,
  playerActor,
} from "../../../packages/runtime-core/src/index.ts";
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
} from "../../../packages/runtime-contracts/src/index.ts";
import type { IntentKind } from "../../../packages/runtime-contracts/src/index.ts";
import {
  DEMO_ACTOR,
  DEMO_MANIPULATION_CAPABILITY,
  DEMO_MOVEMENT_CAPABILITY,
  DEMO_SENSORY_OUTPUT_CAPABILITY,
  DEMO_SESSION,
  ManualBrokerClock,
  CapabilityBroker,
  actionRequest,
  brokerPolicy,
  demoCoverage,
  evaluationContext,
  grantId,
  moveIntent,
  seedGrants,
} from "../../../packages/capability-broker/src/index.ts";
import type { BrokerPolicy } from "../../../packages/capability-broker/src/index.ts";
import { demoAvatarDefinition } from "../../../packages/avatar-runtime/src/index.ts";
import type { HostRestriction } from "../../../packages/game-contracts/src/index.ts";
import {
  createFakeExecutor,
  createInMemoryArtifactExchange,
  createInMemoryClock,
  createInMemoryShapeCatalog,
  createToolFabricRuntime,
} from "../../../packages/tool-fabric-runtime/src/index.ts";
import type {
  ToolJobSnapshot,
  ToolRegistration,
} from "../../../packages/tool-fabric-runtime/src/index.ts";
import { LocalAdapter } from "../../../packages/game-ui/src/fakes.ts";
import type { JobEventLike } from "../../../packages/game-ui/src/view/tools-view.ts";
import type { SessionOperation } from "../../../packages/game-ui/src/view/runtime-view.ts";
import type { StudioDataSnapshot } from "../../../packages/game-ui/src/view/studio-view.ts";

/** The journey's own session id (kernel surface; distinct from the demo). */
export const JOURNEY_STUDIO_SESSION_ID = "journey-studio-session";

/** The host restriction applied to the journey's avatar (R5 vocabulary). */
export const JOURNEY_RESTRICTION: HostRestriction = {
  denied: ["audio"],
  approvalRequired: ["movement"],
  sandboxed: false,
};

// ---------------------------------------------------------------------------
// Packages surface (real seal + release-gate verdicts + a lockfile)
// ---------------------------------------------------------------------------

function journeyMetadata(licenseStatus: "verified" | "declared"): UnsealedPackageRecord["metadata"] {
  return {
    dependencies: [],
    providedCapabilities: [{ id: "game.journey/rules", version: parseSemver("2.1.0")! }],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: licenseStatus },
    provenance: {
      origin: { type: "original" },
      sourceCommit: null,
      transformationHistory: [{ kind: "author", description: "authored by the browser-journey host rig" }],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ["interactive", "simulation"], engines: [], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [],
    extensionPoints: [],
    overlay: null,
  };
}

function journeyPackages(): {
  readonly records: readonly PackageRecord[];
  readonly gateResults: Readonly<Record<string, ReleaseGateResult>>;
  readonly lock: PackageLock;
} {
  const gameRecord = sealPackageRecord({
    identity: { kind: "game", id: "game.journey-run", version: parseSemver("2.3.0")! },
    metadata: journeyMetadata("verified"),
  } satisfies UnsealedPackageRecord);
  // Deliberately DECLARED-only licensing: the release gate must block this
  // row (R19 — provenance/licensing is a release gate, E8 surfaces it).
  const assetRecord = sealPackageRecord({
    identity: { kind: "assets", id: "asset.journey-kit", version: parseSemver("1.1.0")! },
    metadata: journeyMetadata("declared"),
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
// Session surface (the real kernel, driven through public operations)
// ---------------------------------------------------------------------------

function journeySession(): {
  readonly session: StudioDataSnapshot["session"];
  readonly operations: readonly SessionOperation[];
  readonly observation: StudioDataSnapshot["observation"];
} {
  const clock = new ManualClock(2_000);
  const grant = {
    grantId: asCapabilityGrantId("grant-journey-kernel"),
    holder: avatarActor("journey-avatar"),
    capability: asCapabilityId("world.counter"),
    scope: { sessionId: asSessionId(JOURNEY_STUDIO_SESSION_ID) },
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
    descriptor: interactiveDescriptor(JOURNEY_STUDIO_SESSION_ID, "journey-studio-seed"),
    driver: new CounterWorldDriver(),
    capabilityPort,
    snapshotStore: new InMemorySnapshotStore(),
  });
  if (created.status !== "created") {
    throw new Error(`studio journey rig: kernel creation refused: ${created.detail}`);
  }
  const kernel = created.kernel;
  const operations: SessionOperation[] = [];
  operations.push(kernel.load());
  operations.push(
    kernel.act({
      intent: {
        intentId: asIntentId("intent-journey-p1"),
        kind: asIntentKind("world.increment"),
        actor: playerActor("journey-player"),
        payload: { by: 3 },
        issuedAt: clock.now(),
      },
      nonce: asIdempotencyNonce("journey-nonce-p1"),
    }),
  );
  operations.push(
    kernel.act({
      intent: {
        intentId: asIntentId("intent-journey-a1"),
        kind: asIntentKind("world.increment"),
        actor: avatarActor("journey-avatar"),
        payload: { by: 7 },
        issuedAt: clock.now(),
      },
      grantId: grant.grantId,
      nonce: asIdempotencyNonce("journey-nonce-a1"),
    }),
  );
  operations.push(kernel.step(4));
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
// Broker surface (real policy + broker + one granted + one denied evaluation)
// ---------------------------------------------------------------------------

function journeyBroker(): {
  readonly policy: BrokerPolicy;
  readonly broker: CapabilityBroker;
  readonly evaluations: readonly { readonly intentKind: IntentKind; readonly resolution: ReturnType<CapabilityBroker["evaluate"]> }[];
} {
  const policyResult = brokerPolicy(demoCoverage(), {
    denied: [DEMO_SENSORY_OUTPUT_CAPABILITY],
    approvalRequired: [DEMO_MANIPULATION_CAPABILITY],
  });
  if (!policyResult.ok) {
    throw new Error(`studio journey rig: broker policy invalid: ${policyResult.detail}`);
  }
  const broker = new CapabilityBroker({
    policy: policyResult.policy,
    clock: new ManualBrokerClock(0),
    commandIdPrefix: "journey",
  });
  const movementGrant = {
    grantId: grantId("grant-journey-movement"),
    holder: DEMO_ACTOR,
    capability: DEMO_MOVEMENT_CAPABILITY,
    scope: { sessionId: DEMO_SESSION },
    constraints: [],
    issuedBy: "host-game-policy" as const,
    epoch: asSessionEpoch(1),
  };
  seedGrants(broker, [movementGrant]);
  const context = evaluationContext(DEMO_SESSION, 1, asTick(5));
  // The granted move (a seeded grant the broker accepts).
  const granted = broker.evaluate(
    actionRequest(
      DEMO_SESSION,
      DEMO_ACTOR,
      moveIntent(DEMO_ACTOR, "journey-1"),
      movementGrant.grantId,
      "journey-1",
    ),
    context,
  );
  // The denied speak (an unknown grant id — the typed E8 refusal path).
  const denied = broker.evaluate(
    actionRequest(
      DEMO_SESSION,
      DEMO_ACTOR,
      {
        intentId: asIntentId("intent-journey-speak"),
        kind: asIntentKind("speak.say"),
        actor: DEMO_ACTOR,
        payload: { text: "journey" },
        issuedAt: asTimestamp(10),
      },
      grantId("grant-journey-missing"),
      "journey-2",
    ),
    context,
  );
  return {
    policy: policyResult.policy,
    broker,
    evaluations: [
      { intentKind: asIntentKind("move.to"), resolution: granted },
      { intentKind: asIntentKind("speak.say"), resolution: denied },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tools surface (real tool-fabric runtime + the labeled structural adapter)
// ---------------------------------------------------------------------------

async function journeyTools(): Promise<{
  readonly registrations: readonly ToolRegistration[];
  readonly jobs: readonly ToolJobSnapshot[];
  readonly events: readonly JobEventLike[];
}> {
  const events: JobEventLike[] = [];
  const clock = createInMemoryClock(0);
  const executor = createFakeExecutor(() => clock.now());
  const shapeCatalog = createInMemoryShapeCatalog();
  const diceInput = { shapeId: "journey.studio/dice-input", revision: 1 };
  const packInput = { shapeId: "journey.studio/pack-input", revision: 1 };
  shapeCatalog.register(diceInput, () => []);
  shapeCatalog.register(packInput, () => []);
  const runtime = createToolFabricRuntime({
    clock,
    executor,
    shapeCatalog,
    artifactExchange: createInMemoryArtifactExchange(),
    eventSink: { emit: (event) => events.push(event) },
  });

  // game-ui's labeled TEST-SUPPORT structural adapter (never a production
  // integration — lock rule 44).
  const adapter = new LocalAdapter({
    id: "fabric.journey",
    label: "Journey Studio Fabric",
    offeredCapabilities: ["tool-fabric.invoke"],
  });
  const ready = adapter.markReady();
  if (ready.outcome !== "ok") {
    throw new Error(`studio journey rig: adapter never leaves registered: ${ready.message}`);
  }

  const diceDescriptor = {
    identity: { namespace: "journey.studio", name: "dice-roll" },
    surfaceVersion: { major: 2, minor: 0 },
    title: "Journey Dice",
    description: "Deterministic journey dice roll over the tool fabric.",
    inputShape: diceInput,
    outputShape: { shapeId: "journey.studio/dice-output", revision: 1 },
    capabilities: [],
  };
  const packDescriptor = {
    identity: { namespace: "journey.studio", name: "pack-audit" },
    surfaceVersion: { major: 1, minor: 0 },
    title: "Journey Pack Audit",
    description: "Deterministic journey pack audit over the tool fabric.",
    inputShape: packInput,
    outputShape: { shapeId: "journey.studio/pack-output", revision: 1 },
    capabilities: [],
  };
  for (const descriptor of [diceDescriptor, packDescriptor]) {
    const check = runtime.registerTool({ descriptor, adapter, dispatchCapability: "tool-fabric.invoke" });
    if (check.outcome !== "ok") {
      throw new Error(
        `studio journey rig: tool registration rejected: ${check.rejections.map((item) => item.message).join("; ")}`,
      );
    }
  }

  const first = await runtime.enqueueJob({
    jobId: "journey-job-dice-1",
    call: {
      kind: "tool-call-request",
      callId: "journey-call-1",
      tool: diceDescriptor.identity,
      surfaceVersion: diceDescriptor.surfaceVersion,
      input: { sides: 6, rolls: 2 },
      requiredCapabilities: [],
    },
    maxAttempts: 3,
  });
  if (first.outcome !== "admitted") throw new Error(`studio journey rig: dice job not admitted`);
  await runtime.pumpJobs();

  // The scripted refusal: the executor refuses, the job surfaces the typed
  // executor/adapter-refused state (E8 — never a silent failure).
  executor.scriptNextResult({
    outcome: "refused",
    code: "executor/adapter-refused",
    message: "scripted refusal (journey evidence)",
  });
  const audit = await runtime.enqueueJob({
    jobId: "journey-job-pack-1",
    call: {
      kind: "tool-call-request",
      callId: "journey-call-pack",
      tool: packDescriptor.identity,
      surfaceVersion: packDescriptor.surfaceVersion,
      input: { pack: "asset.journey-kit" },
      requiredCapabilities: [],
    },
    maxAttempts: 1,
  });
  if (audit.outcome !== "admitted") throw new Error(`studio journey rig: pack job not admitted`);
  await runtime.pumpJobs();

  return { registrations: runtime.listTools(), jobs: runtime.jobSnapshots(), events };
}

/**
 * Compose ONE authoritative studio snapshot from the real sibling
 * systems. Deterministic (E9): same call → deep-equal snapshot.
 */
export async function composeStudioJourneySnapshot(): Promise<StudioDataSnapshot> {
  const packages = journeyPackages();
  const session = journeySession();
  const broker = journeyBroker();
  const tools = await journeyTools();
  return Object.freeze({
    packages: packages.records,
    gateResults: packages.gateResults,
    lock: packages.lock,
    session: session.session,
    operations: session.operations,
    observation: session.observation,
    avatars: [demoAvatarDefinition()],
    restriction: JOURNEY_RESTRICTION,
    policy: broker.policy,
    broker: broker.broker,
    evaluations: broker.evaluations,
    registrations: tools.registrations,
    jobs: tools.jobs,
    events: tools.events,
  } satisfies StudioDataSnapshot);
}
