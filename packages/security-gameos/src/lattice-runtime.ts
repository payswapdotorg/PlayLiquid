/**
 * THE RUNTIME ARM (PL-041, R20) — the broker-mediated avatar-action
 * adjudication, split from lattice.ts for the 400-line ceiling.
 *
 * Delegates to runtime-contracts' pure `resolveActionRequest` boundary
 * evaluator over the broker's grant/policy/ledger snapshot —
 * ActionDenialReason codes VERBATIM. The probe passes the SNAPSHOT ledger
 * and discards the returned one: the broker's live budget state is never
 * consumed by an adjudication (read-only composition).
 *
 * The session must be bound to the requesting tenant first (R20:
 * `session-unbound` / `cross-tenant-request` fire STRUCTURALLY, before
 * any grant check could pass).
 *
 * Purity: no IO, no clock, no randomness. Same inputs → same result (E9).
 */

import { grantsForActor } from "@playliquid/capability-broker";
import { commandKindForIntent } from "@playliquid/capability-broker";
import { resolveActionRequest } from "@playliquid/runtime-contracts";
import type { ActionDenialReason } from "@playliquid/runtime-contracts";
import {
  asActionRequestId,
  asActorId,
  asCommandId,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionEpoch,
  asSessionId,
  asTick,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import type { AdjudicationResult, LatticeInputs } from "./lattice-folds.ts";
import { invalid, latestSession, right, suspended } from "./lattice-folds.ts";
import type { RightsRequest } from "./vocabulary.ts";
import type { IntegrityRightsEntry } from "./ports.ts";

const ACTOR_CLASSES: readonly string[] = ["player", "avatar-agent", "platform-system", "host-authority"];

/** Adjudicates the runtime arm (module-local; dispatched by `adjudicate`). */
export function adjudicateRuntime(
  request: RightsRequest,
  inputs: LatticeInputs,
  suspension: IntegrityRightsEntry | undefined,
): AdjudicationResult {
  const capability = request.capability;
  if (capability.kind !== "runtime") return invalid("dispatch mismatch");
  if (!ACTOR_CLASSES.includes(capability.actorClass)) {
    return invalid(`actor class ${JSON.stringify(capability.actorClass)} is not a runtime actor class`);
  }
  // R20: the session must be bound to the requesting tenant first —
  // structurally, before any grant check could pass.
  const binding = latestSession(inputs.sessions, capability.session.sessionId);
  if (binding === undefined) {
    return {
      granted: false,
      code: "session-unbound",
      detail: `session ${capability.session.sessionId} is not bound to any tenant`,
      evidence: [`session:${capability.session.sessionId}`],
    };
  }
  if (binding.tenant !== request.tenant) {
    return {
      granted: false,
      code: "cross-tenant-request",
      detail: `session ${capability.session.sessionId} is bound to another tenant`,
      evidence: [`session:${capability.session.sessionId}`, `tenant:${request.tenant}`],
    };
  }
  const { broker } = inputs;
  const intentKindText =
    capability.intentKind ?? broker.policy.capabilityIntentKinds[capability.capability]?.[0];
  if (intentKindText === undefined) {
    // No intent kind is covered by this capability under the broker's
    // own policy — the frozen evaluator's code for that condition.
    return {
      granted: false,
      code: "grant-not-found",
      detail: `capability ${capability.capability} has no coverage under the broker policy`,
      evidence: [`capability:${capability.capability}`],
    };
  }
  const commandKind = commandKindForIntent(broker.policy, asIntentKind(intentKindText));
  if (commandKind === undefined) {
    return {
      granted: false,
      code: "intent-kind-outside-grant",
      detail: `intent kind ${intentKindText} has no command mapping in the broker policy`,
      evidence: [`intent:${intentKindText}`],
    };
  }
  const candidates = candidateGrants(request, capability, broker);
  if (candidates.length === 0) {
    return {
      granted: false,
      code: "grant-not-found",
      detail: "no grant in the authoritative table covers this actor, session and capability",
      evidence: [`capability:${capability.capability}`, `session:${capability.session.sessionId}`],
    };
  }
  let firstDenial: { reason: ActionDenialReason; detail: string } | undefined;
  for (const grantId of candidates) {
    const { resolution } = resolveActionRequest(
      probeRequest(request, capability, grantId, intentKindText),
      {
        grants: broker.grants,
        epoch: asSessionEpoch(capability.session.epoch),
        tick: asTick(capability.session.tick),
        capabilityIntentKinds: broker.policy.capabilityIntentKinds,
        ledger: broker.ledger,
      },
      asCommandId("rights-probe"),
      commandKind,
      asTimestamp(0),
    );
    if (resolution.status === "granted") {
      return (
        suspended(suspension) ??
        right(request, `runtime:${capability.capability}`, [
          `grant:${String(grantId)}`,
          `intent:${intentKindText}`,
          `session:${capability.session.sessionId}`,
          "adjudicated-by:resolveActionRequest",
        ], suspension)
      );
    }
    firstDenial ??= { reason: resolution.reason, detail: resolution.detail };
  }
  const denial = firstDenial!;
  return {
    granted: false,
    code: denial.reason,
    detail: `broker boundary evaluation refused: ${denial.detail}`,
    evidence: [`capability:${capability.capability}`, `intent:${intentKindText}`],
  };
}

function candidateGrants(
  request: RightsRequest,
  capability: Extract<RightsRequest["capability"], { kind: "runtime" }>,
  broker: LatticeInputs["broker"],
): readonly string[] {
  if (capability.claimedGrantId !== undefined) {
    // A claimed grant is probed EXACTLY as claimed — holder/session/epoch
    // mismatches are the frozen evaluator's own typed refusals.
    return [capability.claimedGrantId];
  }
  const actor = { actorClass: capability.actorClass as "avatar-agent", actorId: asActorId(request.subject) };
  const scoped = grantsForActor({ grants: broker.grants }, actor, asSessionId(capability.session.sessionId));
  return scoped
    .filter((grant) => String(grant.capability) === capability.capability)
    .map((grant) => String(grant.grantId));
}

function probeRequest(
  request: RightsRequest,
  capability: Extract<RightsRequest["capability"], { kind: "runtime" }>,
  grantId: string,
  intentKindText: string,
): Parameters<typeof resolveActionRequest>[0] {
  return {
    requestId: asActionRequestId("rights-probe-request"),
    sessionId: asSessionId(capability.session.sessionId),
    actor: { actorClass: capability.actorClass as "avatar-agent", actorId: asActorId(request.subject) },
    intent: {
      intentId: asIntentId("rights-probe-intent"),
      kind: asIntentKind(intentKindText),
      actor: { actorClass: capability.actorClass as "avatar-agent", actorId: asActorId(request.subject) },
      payload: { kind: "unit" },
      issuedAt: asTimestamp(0),
    },
    grantId: grantId as Parameters<typeof resolveActionRequest>[0]["grantId"],
    idempotencyKey: {
      scope: "action",
      actor: asActorId(request.subject),
      nonce: asIdempotencyNonce("rights-probe"),
    },
  };
}
