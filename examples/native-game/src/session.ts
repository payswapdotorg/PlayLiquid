/**
 * LUMEN RUN — runtime session wiring (PL-037).
 *
 * Composes the Interactive Runtime kernel (PL-013) for one session of
 * the game: the session descriptor is digest-pinned to the composed game
 * (GameRefSummary over the GameIR composition digests), the driver is
 * the real Lumen Run simulation, and every host concern is an injected
 * port — runtime-core's own in-memory fakes (renderer, input source,
 * transport, snapshot store, manual clock) plus the GrantTable capability
 * port implementing the avatar-agent mediation seam (lock rule 14: the
 * companion may only act through a host-issued grant).
 *
 * The session is SEEDED (E9): the determinism seed rides the descriptor
 * and drives the world's initial variance; identical seeds produce
 * identical trajectories. The `act` inputs are TypedIntents —
 * client-side PROPOSALS the authoritative kernel validates, simulates
 * and journals (lock rule 13; R9 client-intent/server-authoritative
 * discipline).
 */

import type { GameIRDocument, GameIRValue } from "../../../packages/game-ir/src/index.ts";
import { computeDigest } from "../../../packages/package-system/src/index.ts";
import {
  GrantTableCapabilityPort,
  InMemoryInputSource,
  InMemoryRenderer,
  InMemorySnapshotStore,
  InMemoryTransport,
  ManualClock,
  createInteractiveRuntime,
} from "../../../packages/runtime-core/src/index.ts";
import type { InteractiveRuntimeKernel } from "../../../packages/runtime-core/src/index.ts";
import type { ActInput } from "../../../packages/runtime-core/src/index.ts";
import {
  asActorId,
  asCapabilityGrantId,
  asCapabilityId,
  asDeterminismSeed,
  asDigest,
  asGameIrDigest,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionId,
  asTargetProfileId,
  asTimestamp,
  makeSessionDescriptor,
} from "../../../packages/runtime-contracts/src/index.ts";
import type { JsonSafe } from "../../../packages/replay/src/index.ts";
import type {
  ActorRef,
  CapabilityGrant,
  DeterminismSeed,
  IntentKind,
  RuntimeSessionDescriptor,
  SessionEpoch,
  Tick,
  TypedIntent,
} from "../../../packages/runtime-contracts/src/index.ts";
import { COMPANION_ACTOR } from "./ids.ts";
import { LumenRunDriver } from "./driver.ts";
import type { LumenRunWorld } from "./driver.ts";
import { toWire } from "./events.ts";
import { bareDigest } from "./ids.ts";

/** The grant the host game policy issues to the companion avatar. */
export const COMPANION_GRANT_ID = asCapabilityGrantId("grant-companion-move")!;

/** Everything the scripted playthrough needs from one wired session. */
export interface LumenSession {
  readonly kernel: InteractiveRuntimeKernel<LumenRunWorld>;
  readonly descriptor: RuntimeSessionDescriptor;
  readonly clock: ManualClock;
  readonly inputSource: InMemoryInputSource;
  readonly renderer: InMemoryRenderer;
  readonly transport: InMemoryTransport;
  readonly snapshots: InMemorySnapshotStore;
  readonly capabilityPort: GrantTableCapabilityPort;
}

function hexOf(packaged: string): string {
  const bare = bareDigest(packaged);
  if (bare === null) throw new Error("digest projection failed");
  return bare;
}

/**
 * The digest-pinned GameRefSummary of one composed game: the full
 * document digest, the entry world's content digest and the runtime
 * policy digest (the capability-declaration nodes).
 */
export function gameRefOf(document: GameIRDocument) {
  const worldNode = document.nodes.find((node) => node.kind === "world" && node.world === document.entry.world);
  if (worldNode === undefined) {
    throw new Error(`lumen-run: entry world ${String(document.entry.world)} has no world node`);
  }
  const policyNodes = document.nodes.filter((node) => node.kind === "capability-declaration");
  const documentDigest = computeDigest({
    irVersion: document.irVersion,
    identity: document.identity,
    lifecycle: document.lifecycle ?? "active",
    entry: document.entry,
    nodes: document.nodes.map((node) => (node.kind === "entity" ? { ...node, state: "projected" } : node)),
  });
  return {
    gameDigest: asGameIrDigest(hexOf(documentDigest)),
    world: {
      worldId: document.entry.world as string,
      revisionDigest: asDigest(hexOf(computeDigest(worldNode))),
    },
    policy: {
      policyId: "lumen-run-policy",
      revisionDigest: asDigest(hexOf(computeDigest(policyNodes))),
    },
  };
}

/**
 * The host game policy's per-epoch companion grant (lock rule 14: the
 * avatar may only act through a host-issued grant; grants are epoch-
 * scoped — a reset/restore voids the previous epoch's grant).
 */
export function companionGrant(sessionId: string, epoch: SessionEpoch): CapabilityGrant {
  return {
    grantId: COMPANION_GRANT_ID,
    holder: { actorClass: "avatar-agent", actorId: asActorId(COMPANION_ACTOR) },
    capability: asCapabilityId("lumen.companion.move"),
    scope: { sessionId: asSessionId(sessionId) },
    constraints: [{ kind: "total-count", max: 32 }],
    issuedBy: "host-game-policy",
    epoch,
  };
}

/** Wires one interactive session of the game over the composed document. */
export function createLumenSession(options: {
  readonly document: GameIRDocument;
  readonly seed: string;
  readonly sessionId?: string;
}): LumenSession {
  const clock = new ManualClock(0);
  const inputSource = new InMemoryInputSource();
  const renderer = new InMemoryRenderer();
  const transport = new InMemoryTransport();
  const snapshots = new InMemorySnapshotStore();
  const sessionId = asSessionId(options.sessionId ?? "sess-lumen-run-1");
  const seed: DeterminismSeed = asDeterminismSeed(options.seed);

  const capabilityPort = new GrantTableCapabilityPort({
    capabilityIntentKinds: { "lumen.companion.move": [asIntentKind("run.companion.move")] },
    intentCommandKinds: { "run.companion.move": "run.companion.move" },
    clock,
  });

  const descriptor = makeSessionDescriptor({
    sessionId,
    game: gameRefOf(options.document),
    role: "interactive",
    determinism: seed,
    targetProfile: asTargetProfileId("spark"),
    provisionedAt: asTimestamp(0),
    initialEpoch: 1,
  });

  const creation = createInteractiveRuntime<LumenRunWorld>({
    descriptor,
    driver: new LumenRunDriver(options.document),
    capabilityPort,
    snapshotStore: snapshots,
    renderer,
    inputSource,
    transport,
  });
  if (creation.status !== "created") {
    throw new Error(`kernel creation refused: ${creation.detail}`);
  }
  return { kernel: creation.kernel, descriptor, clock, inputSource, renderer, transport, snapshots, capabilityPort };
}

// ---------------------------------------------------------------------------
// Client-intent builders (R9: the client submits PROPOSALS, never outcomes)
// ---------------------------------------------------------------------------

/**
 * Builds a typed intent — the only thing an untrusted client may submit.
 * The payload rides the JSON-safe tagged transport form ({@link toWire}):
 * the kernel fingerprints intent payloads with `canonicalJson`, and the
 * value language's bigint ints are not JSON-safe (the projection is one
 * way; the driver decodes through `fromWire` before reading).
 */
export function playerIntent(actor: ActorRef, kind: string, payload: GameIRValue, issuedAt: number, seq: number): TypedIntent<JsonSafe> {
  return {
    intentId: asIntentId(`intent-${String(seq).padStart(4, "0")}`),
    kind: asIntentKind(kind),
    actor,
    payload: toWire(payload),
    issuedAt: asTimestamp(issuedAt),
  };
}

/** Builds one act input (intent + idempotency nonce; grant for avatar agents). */
export function actInput(intent: TypedIntent<JsonSafe>, nonce: string, grantId?: string): ActInput {
  return {
    intent,
    nonce: asIdempotencyNonce(nonce),
    ...(grantId === undefined ? {} : { grantId: asCapabilityGrantId(grantId) }),
  };
}

export type { IntentKind, Tick };
