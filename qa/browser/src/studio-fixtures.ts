/**
 * STUDIO JOURNEY FIXTURES (PL-043) — the fixture construction half of the
 * studio rig (see studio-rig.ts for the journey composition and the
 * packages surface): the real sibling-system read models a HOST assembles
 * for the Game Studio surfaces —
 * - the session surface: a live interactive kernel session driven through
 *   `@playliquid/runtime-core`'s public operations over
 *   `@playliquid/runtime-contracts`;
 * - the broker surface: a real `@playliquid/capability-broker` with a
 *   seeded grant, one granted and one DENIED evaluation;
 * - the tools surface: a `@playliquid/tool-fabric-runtime` with two jobs
 *   over game-ui's labeled TEST-SUPPORT structural adapter, one of them
 *   scriptedly refused (E8);
 * - the avatar under the journey's host restriction
 *   (`@playliquid/avatar-runtime` + `@playliquid/game-contracts`).
 *
 * TEST-SUPPORT RIG (lock rule 44): deliberately composed with DIFFERENT
 * data (ids, versions, seeds, scripts) than game-ui's own demo fixture so
 * the journey proves the host seam independently.
 *
 * Determinism (E9): manual clocks, fixed seeds, a scripted executor;
 * constructing the fixtures twice yields deep-equal values.
 */

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
import { LocalAdapter } from "./studio-ui.ts";
import type {
  JobEventLike,
  SessionOperation,
  StudioDataSnapshot,
} from "./studio-ui.ts";

/** The journey's own session id (kernel surface; distinct from the demo). */
export const JOURNEY_STUDIO_SESSION_ID = "journey-studio-session";

/** The host restriction applied to the journey's avatar (R5 vocabulary). */
export const JOURNEY_RESTRICTION: HostRestriction = {
  denied: ["audio"],
  approvalRequired: ["movement"],
  sandboxed: false,
};

// ---------------------------------------------------------------------------
// Session surface (the real kernel, driven through public operations)
// ---------------------------------------------------------------------------

/** The kernel session walk: load → player act → avatar act → step → observe. */
export function journeySession(): {
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

/** The broker walk: one granted move, one DENIED speak (typed E8 refusal). */
export function journeyBroker(): {
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

/** The tools walk: one succeeded dice job, one scriptedly REFUSED audit job. */
export async function journeyTools(): Promise<{
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

/** The demo avatar under the journey restriction (the R5 surface input). */
export function journeyAvatar(): ReturnType<typeof demoAvatarDefinition> {
  return demoAvatarDefinition();
}
