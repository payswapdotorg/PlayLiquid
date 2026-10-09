/**
 * IN-MEMORY FAKES + GrantTable-COMPATIBLE TEST DOUBLE.
 *
 * STATUS: TEST SUPPORT ONLY (lock rule 44: no hidden mocks presented as
 * production). Nothing here is a production integration.
 *
 * No parallel authority is built:
 * - {@link ManualBrokerClock} is the deterministic injected time authority.
 * - {@link createGrantTableBroker} adapts the OPTIONS SHAPE of
 *   runtime-core's `GrantTableCapabilityPort` fake
 *   (`{ grants?, capabilityIntentKinds, intentCommandKinds, clock }`) into a
 *   real {@link CapabilityBroker}. runtime-core is deliberately NOT a
 *   dependency of this package (module matrix: capability-broker's
 *   dependencies are game-ir + runtime-contracts), so the compatibility is
 *   proven structurally: any valid GrantTable options object is a valid
 *   `createGrantTableBroker` input, and the produced broker satisfies the
 *   `CapabilityPort` seam shape (compat.test.ts).
 * - Fixtures (`avatarActor`, `capId`, `makeGrant`, `moveIntent`,
 *   `actionRequest`) build contract-typed test data with minimal noise.
 */

import {
  asActionRequestId,
  asActorId,
  asCapabilityGrantId,
  asCapabilityId,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
  asSessionId,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import type {
  ActionRequest,
  ActorRef,
  CapabilityGrant,
  CapabilityGrantId,
  CapabilityId,
  IdempotencyKey,
  IntentKind,
  SessionEpoch,
  SessionId,
  Tick,
  TypedIntent,
} from "@playliquid/runtime-contracts";
import { CapabilityBroker } from "./broker.ts";
import type { BrokerClockPort } from "./broker.ts";
import { brokerPolicy } from "./policy.ts";

/** Deterministic, manually advanced clock (the injected time authority). */
export class ManualBrokerClock implements BrokerClockPort {
  #now: number;
  constructor(startMs = 0) {
    this.#now = startMs;
  }
  now(): ReturnType<BrokerClockPort["now"]> {
    return asTimestamp(this.#now);
  }
  advance(ms: number): void {
    this.#now += ms;
  }
}

/**
 * Options shape mirroring runtime-core's `GrantTableOptions` (structural
 * mirror — see fakes.ts module docs). Any object runtime-core tests would
 * pass to `new GrantTableCapabilityPort(...)` is a valid input here.
 */
export interface GrantTableCompatibleOptions {
  /** Grant read model (broker-owned state; tests may issue/revoke). */
  readonly grants?: readonly CapabilityGrant[];
  /** capabilityId -> intent kinds it authorizes. */
  readonly capabilityIntentKinds: Readonly<Record<string, readonly IntentKind[]>>;
  /** intent kind -> command kind the derived command carries. */
  readonly intentCommandKinds: Readonly<Record<string, string>>;
  readonly clock: BrokerClockPort;
}

/**
 * The GrantTable-style test double: a real CapabilityBroker constructed
 * from GrantTable-shaped options. Evaluation behavior matches the
 * runtime-core fake (deterministic `cmd-<n>` ids, clock-supplied issue
 * times, delegation to the contract's pure evaluator).
 */
export function createGrantTableBroker(options: GrantTableCompatibleOptions): CapabilityBroker {
  const coverage = Object.entries(options.capabilityIntentKinds).map(([capability, intentKinds]) => ({
    capability: asCapabilityId(capability),
    intentKinds: intentKinds.map((kind) => String(kind)),
    commandKindByIntent: Object.fromEntries(
      intentKinds.map((kind) => [String(kind), options.intentCommandKinds[String(kind)] ?? ""]),
    ),
  }));
  const policy = brokerPolicy(coverage);
  if (!policy.ok) {
    throw new Error(`GrantTable options are not a valid broker policy: ${policy.detail}`);
  }
  return new CapabilityBroker({
    policy: policy.policy,
    clock: options.clock,
    grants: options.grants,
    commandIdPrefix: "cmd",
  });
}

/** Convenience avatar-agent actor reference (mirrors runtime-core fakes). */
export function avatarActor(actorId: string): ActorRef {
  return { actorClass: "avatar-agent", actorId: asActorId(actorId) };
}

/** Convenience host-authority actor reference (grant issuer side). */
export function hostAuthority(actorId: string): ActorRef {
  return { actorClass: "host-authority", actorId: asActorId(actorId) };
}

/** Capability id helper. */
export function capId(value: string): CapabilityId {
  return asCapabilityId(value);
}

/** Grant id helper. */
export function grantId(value: string): CapabilityGrantId {
  return asCapabilityGrantId(value);
}

/** Deterministic movement intent fixture. */
export function moveIntent(actor: ActorRef, nonce: string): TypedIntent<{ to: [number, number] }> {
  return {
    intentId: asIntentId(`intent-${nonce}`),
    kind: asIntentKind("move.to"),
    actor,
    payload: { to: [2, 2] },
    issuedAt: asTimestamp(10),
  };
}

/** Deterministic action request fixture. */
export function actionRequest<P>(
  sessionId: SessionId,
  actor: ActorRef,
  intent: TypedIntent<P>,
  grant: CapabilityGrantId,
  nonce: string,
): ActionRequest<P> {
  return {
    requestId: asActionRequestId(`req-${nonce}`),
    sessionId,
    actor,
    intent,
    grantId: grant,
    idempotencyKey: idempotencyKey(actor, nonce),
  };
}

/** Action-scope idempotency key helper. */
export function idempotencyKey(actor: ActorRef, nonce: string): IdempotencyKey {
  return { scope: "action", actor: actor.actorId, nonce: asIdempotencyNonce(nonce) };
}

/** Deterministic session-scoped grant fixture. */
export function makeGrant(over: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    grantId: grantId("grant-1"),
    holder: avatarActor("avatar-1"),
    capability: capId("avatar.movement"),
    scope: { sessionId: asSessionId("s-1") },
    constraints: [],
    issuedBy: "host-game-policy",
    epoch: asSessionEpoch(1),
    ...over,
  };
}

/** Grant-table seeding helper mirroring the runtime-core fake's API. */
export function seedGrants(broker: CapabilityBroker, grants: readonly CapabilityGrant[]): void {
  for (const grant of grants) {
    const result = broker.admit({ grant });
    if (!result.ok) {
      throw new Error(`seed grant ${String(grant.grantId)} refused: ${result.detail}`);
    }
  }
}

/** Evaluation context fixture. */
export function evaluationContext(sessionId: SessionId, epoch: number, tick: Tick): {
  sessionId: SessionId;
  epoch: SessionEpoch;
  tick: Tick;
} {
  return { sessionId, epoch: asSessionEpoch(epoch), tick };
}
