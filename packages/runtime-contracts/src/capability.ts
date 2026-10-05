/**
 * CAPABILITY-MEDIATED ACTION PROTOCOL (lock rules 4, 13, 14).
 *
 * Lock rule 4: the Capability Broker is THE runtime authorization boundary.
 * Lock rule 14: avatar intelligence never receives arbitrary engine
 * authority. Both rules are expressed structurally in the types below:
 *
 * - There is NO type in this package that hands an engine handle, raw system
 *   call, or state-mutation function to an avatar. An {@link ActionRequest}
 *   carries a {@link TypedIntent} (a proposal) plus the id of a
 *   {@link CapabilityGrant}; it carries no authority of its own.
 * - The only bridge from intent to state mutation is
 *   {@link resolveActionRequest}, a PURE function producing either a denial
 *   or a canonical {@link RuntimeCommandEnvelope} — which must still pass the
 *   command admission gate (commands.ts). The broker never bypasses the
 *   canonical path (E2).
 * - Authority lives in GRANTS. Grants are issued only by host game policy or
 *   the platform ({@link GrantIssuer}); this package defines no minting path
 *   an avatar could call, and the authoritative grant table is broker-owned
 *   state passed in as a read model.
 * - Budgets/rate limits (spec/architecture.md "Capability Broker") are data:
 *   a {@link CapabilityConstraint} plus a caller-supplied
 *   {@link BudgetLedger} read model; {@link consumeBudget} returns the next
 *   ledger PURELY (no mutation, no clock — ticks are inputs).
 */

import type {
  ActionRequestId,
  ActorRef,
  CapabilityGrantId,
  CapabilityId,
  CommandId,
  CommandKind,
  IntentKind,
  SessionEpoch,
  SessionId,
  Tick,
  Timestamp,
} from "./primitives.ts";
import type { IdempotencyKey } from "./idempotency.ts";
import type { RuntimeCommandEnvelope } from "./commands.ts";
import type { TypedIntent } from "./experience.ts";

/** Who may issue grants: the host game's policy, or the platform. */
export type GrantIssuer = "host-game-policy" | "platform";

/** Which actor holds the grant. */
export type GrantHolder = ActorRef;

/** Which session (and optionally which world slice) the grant may touch. */
export interface CapabilityScope {
  readonly sessionId: SessionId;
  /** Optional narrow world scope (entity/chunk/zone id string). */
  readonly worldScope?: string;
}

/** Declarative constraints attached to a grant (budgets/rate limits). */
export type CapabilityConstraint =
  | { readonly kind: "per-tick-count"; readonly max: number }
  | { readonly kind: "total-count"; readonly max: number }
  | { readonly kind: "rate-per-ticks"; readonly max: number; readonly windowTicks: number };

/**
 * A capability grant: the ONLY carrier of action authority in the protocol.
 * Immutable data; revocation is modelled by the issuer removing the grant
 * from the authoritative table (broker-owned state, passed in as read
 * models).
 */
export interface CapabilityGrant {
  readonly grantId: CapabilityGrantId;
  readonly holder: GrantHolder;
  readonly capability: CapabilityId;
  readonly scope: CapabilityScope;
  readonly constraints: readonly CapabilityConstraint[];
  /** Grant is void at ticks strictly greater than this (sim-time bound). */
  readonly expiresAfterTick?: Tick;
  readonly issuedBy: GrantIssuer;
  /** Epoch the grant was issued under; void once the session epoch moves on. */
  readonly epoch: SessionEpoch;
}

/**
 * Pure read model of budget consumption. `consumed` maps
 * grantId -> per-constraint counters. `anchorTick` is the tick the counter's
 * window is anchored at (the current tick for `per-tick-count`; the window
 * opening tick for `rate-per-ticks`; the first consumption tick for
 * `total-count`). A consumption at a tick EARLIER than the anchor is a time
 * regression and is refused.
 */
export interface BudgetLedger {
  readonly consumed: Readonly<Record<string, readonly BudgetCounter[]>>;
}

export interface BudgetCounter {
  readonly count: number;
  readonly anchorTick: Tick;
}

export const EMPTY_BUDGET_LEDGER: BudgetLedger = { consumed: {} };

/** Result of one pure budget consumption step. */
export type BudgetResult =
  | { readonly ok: true; readonly ledger: BudgetLedger }
  | {
      readonly ok: false;
      readonly reason: "budget-exhausted" | "tick-regression" | "unknown-constraint";
    };

/**
 * Pure budget step for one constraint of one grant at a given tick.
 * Window policy (deterministic, pure): a `rate-per-ticks` window opens
 * lazily at the first consumption tick and rolls over at the first
 * consumption at or beyond `anchorTick + windowTicks`, anchoring the new
 * window at that tick. Never mutates its inputs.
 */
export function consumeBudget(
  grant: CapabilityGrant,
  constraintIndex: number,
  ledger: BudgetLedger,
  tick: Tick,
): BudgetResult {
  const constraint = grant.constraints[constraintIndex];
  if (constraint === undefined) {
    return { ok: false, reason: "unknown-constraint" };
  }
  const perGrant = ledger.consumed[grant.grantId];
  const counter = perGrant?.[constraintIndex];
  if (counter !== undefined && tick < counter.anchorTick) {
    return { ok: false, reason: "tick-regression" };
  }
  let next: BudgetCounter;
  if (constraint.kind === "per-tick-count") {
    next =
      counter !== undefined && counter.anchorTick === tick
        ? { count: counter.count + 1, anchorTick: tick }
        : { count: 1, anchorTick: tick };
  } else if (constraint.kind === "total-count") {
    next = {
      count: (counter?.count ?? 0) + 1,
      anchorTick: counter?.anchorTick ?? tick,
    };
  } else {
    const inWindow =
      counter !== undefined && tick < counter.anchorTick + constraint.windowTicks;
    next = inWindow && counter !== undefined
      ? { count: counter.count + 1, anchorTick: counter.anchorTick }
      : { count: 1, anchorTick: tick };
  }
  if (next.count > constraint.max) {
    return { ok: false, reason: "budget-exhausted" };
  }
  const updated: BudgetCounter[] = [...(perGrant ?? [])];
  updated[constraintIndex] = next;
  return {
    ok: true,
    ledger: { consumed: { ...ledger.consumed, [grant.grantId]: updated } },
  };
}

/** An action request: intent + grant reference. Authority-free by itself. */
export interface ActionRequest<P = unknown> {
  readonly requestId: ActionRequestId;
  readonly sessionId: SessionId;
  readonly actor: ActorRef;
  readonly intent: TypedIntent<P>;
  /** The grant under which the actor claims the capability. */
  readonly grantId: CapabilityGrantId;
  readonly idempotencyKey: IdempotencyKey;
}

/** Denial reasons emitted at the boundary. */
export type ActionDenialReason =
  | "grant-not-found"
  | "grant-holder-mismatch"
  | "grant-wrong-session"
  | "grant-expired-tick"
  | "grant-epoch-stale"
  | "intent-kind-outside-grant"
  | "budget-exhausted";

/** Typed resolution of an action request at the broker boundary. */
export type ActionResolution<P = unknown> =
  | {
      readonly status: "granted";
      readonly requestId: ActionRequestId;
      /**
       * The canonical command the broker derived from the intent. It still
       * has to pass command admission (commands.ts); the broker does not
       * bypass the canonical path (E2).
       */
      readonly command: RuntimeCommandEnvelope<P>;
    }
  | {
      readonly status: "denied";
      readonly requestId: ActionRequestId;
      readonly reason: ActionDenialReason;
      readonly detail: string;
    };

/**
 * Inputs for {@link resolveActionRequest}: the authoritative grant table (a
 * pure read model owned by the broker), the current session epoch/tick, the
 * capability -> intent-kind coverage map, and the current budget ledger.
 */
export interface BrokerContext {
  readonly grants: readonly CapabilityGrant[];
  readonly epoch: SessionEpoch;
  readonly tick: Tick;
  /** capabilityId -> intent kinds it authorizes. */
  readonly capabilityIntentKinds: Readonly<Record<string, readonly IntentKind[]>>;
  readonly ledger: BudgetLedger;
}

/**
 * PURE boundary evaluation (lock rule 4). Checks, in order: grant existence,
 * holder, session scope, tick expiry, epoch freshness, intent-kind coverage,
 * then every budget constraint. On success derives the canonical command
 * envelope (command id, kind and issue time are CALLER-SUPPLIED — this
 * function generates nothing). The produced command carries
 * `origin: broker-mediated`, which is exactly what command admission demands
 * from avatar agents (lock rule 14).
 */
export function resolveActionRequest<P>(
  request: ActionRequest<P>,
  context: BrokerContext,
  commandId: CommandId,
  commandKind: CommandKind,
  issuedAt: Timestamp,
): { readonly resolution: ActionResolution<P>; readonly ledger: BudgetLedger } {
  const grant = context.grants.find((g) => g.grantId === request.grantId);
  if (grant === undefined) {
    return deny(request, context, "grant-not-found", "no such grant in the authoritative table");
  }
  if (
    grant.holder.actorId !== request.actor.actorId ||
    grant.holder.actorClass !== request.actor.actorClass
  ) {
    return deny(request, context, "grant-holder-mismatch", "grant is held by a different actor");
  }
  if (grant.scope.sessionId !== request.sessionId) {
    return deny(request, context, "grant-wrong-session", "grant is scoped to another session");
  }
  if (grant.expiresAfterTick !== undefined && context.tick > grant.expiresAfterTick) {
    return deny(
      request,
      context,
      "grant-expired-tick",
      `grant is void after tick ${String(grant.expiresAfterTick)}`,
    );
  }
  if (grant.epoch !== context.epoch) {
    return deny(
      request,
      context,
      "grant-epoch-stale",
      `grant issued under epoch ${String(grant.epoch)}, session is at ${String(context.epoch)}`,
    );
  }
  const allowedKinds = context.capabilityIntentKinds[grant.capability];
  if (allowedKinds === undefined || !allowedKinds.includes(request.intent.kind)) {
    return deny(
      request,
      context,
      "intent-kind-outside-grant",
      `capability ${String(grant.capability)} does not cover intent kind ${String(request.intent.kind)}`,
    );
  }
  let ledger = context.ledger;
  for (let i = 0; i < grant.constraints.length; i += 1) {
    const step = consumeBudget(grant, i, ledger, context.tick);
    if (!step.ok) {
      return deny(
        request,
        context,
        "budget-exhausted",
        `constraint ${i} refused consumption: ${step.reason}`,
      );
    }
    ledger = step.ledger;
  }
  return {
    resolution: {
      status: "granted",
      requestId: request.requestId,
      command: {
        commandId,
        sessionId: request.sessionId,
        kind: commandKind,
        epoch: context.epoch,
        actor: request.actor,
        origin: { kind: "broker-mediated", grantId: grant.grantId },
        idempotencyKey: request.idempotencyKey,
        issuedAt,
        payload: request.intent.payload,
      },
    },
    ledger,
  };
}

function deny<P>(
  request: ActionRequest<P>,
  context: BrokerContext,
  reason: ActionDenialReason,
  detail: string,
): { readonly resolution: ActionResolution<P>; readonly ledger: BudgetLedger } {
  return {
    resolution: { status: "denied", requestId: request.requestId, reason, detail },
    ledger: context.ledger,
  };
}
