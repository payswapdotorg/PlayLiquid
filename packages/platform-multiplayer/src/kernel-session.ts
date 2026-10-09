/**
 * SESSION OPERATIONS — open, read models, platform admission, intent
 * admission and fixed-tick stepping for the authority kernel (split from
 * kernel.ts for the repository's 400-line ceiling). All state lives on
 * the {@link KernelOperationContext}; the kernel instance owns it.
 */

import { isTerminalSessionPhase } from "@playliquid/runtime-contracts";
import type { RuntimeSessionSnapshotView, Tick } from "@playliquid/runtime-contracts";
import { asActorId, asEventKind, asTick } from "@playliquid/runtime-contracts";
import type {
  MatchSessionId,
  SessionAdmissionRequest,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";
import {
  adjudicateParticipantAdmission,
  bridgeMatchSessionId,
  deriveAdmissionFacts,
} from "./admission.ts";
import type { ParticipantAdmissionResult } from "./admission.ts";
import { deriveCommandAdmissionPolicy, intentKindsAligned, planIntentAdmission } from "./intents.ts";
import type { IntentSubmission } from "./intents.ts";
import { admitEffect } from "./effects.ts";
import { resolveMultiplayerConfiguration } from "./topology.ts";
import type { ParticipantView, AdmittedIntent } from "./ports.ts";
import { validateEventStream } from "@playliquid/runtime-contracts";
import { asCommandId } from "@playliquid/runtime-contracts";
import type {
  AuthoritySessionKernelOptions,
  IntentSubmitResult,
  OpenResult,
  TickResult,
} from "./kernel-types.ts";
import {
  emitEvent,
  recordRefusal,
  systemCause,
  transitionPhase,
  failSession,
  type KernelOperationContext,
} from "./kernel-ops.ts";

/** Open the session: resolve configuration, initialize the seam, emit. */
export function openSession<S>(context: KernelOperationContext<S>): OpenResult {
  if (context.state.phase !== "provisioning") {
    return { ok: false, code: "already-open", detail: `session is ${context.state.phase}` };
  }
  if (!intentKindsAligned(context.options.intentSchemas, context.options.intentRules)) {
    failSession(context, "intent schemas and admission rules are not 1:1 aligned");
    return {
      ok: false,
      code: "intent-rules-misaligned",
      detail: "every intent kind needs exactly one schema and one rule",
    };
  }
  const resolution = resolveMultiplayerConfiguration(
    context.options.gamePolicy,
    context.options.servicePolicy,
  );
  if (!resolution.ok) {
    failSession(context, `configuration refused: ${resolution.code}`);
    return { ok: false, code: resolution.code, detail: resolution.detail };
  }
  context.configuration = resolution.configuration;
  for (const binding of context.options.gamePolicy.bindings) {
    if (binding.capability === "multiplayer") {
      context.bindings.set(String(binding.eventKind), binding.outcomeClassification);
    }
  }
  if (!transitionPhase(context, "loading") || !transitionPhase(context, "ready")) {
    return { ok: false, code: "bad-options", detail: "phase machine refused the open path" };
  }
  context.state.simulatorState = context.options.simulator.initial({
    sessionId: context.options.sessionId,
    determinism: context.options.determinism,
  });
  emitEvent(
    context,
    asEventKind("platform.multiplayer.session.opened"),
    systemCause(),
    {
      tenant: String(context.options.tenant),
      topology: context.configuration.topology,
      competitiveUse: context.configuration.servicePolicy.competitiveUse,
    },
    context.state.tick,
  );
  context.options.transport.deliver({
    kind: "session-opened",
    sessionId: context.options.sessionId,
    epoch: context.state.epoch,
    topology: context.configuration.topology,
  });
  return { ok: true, sessionView: sessionViewOf(context) };
}

/** Authoritative read model (runtime-contracts shape). */
export function sessionViewOf<S>(
  context: KernelOperationContext<S>,
): RuntimeSessionSnapshotView {
  return {
    sessionId: context.options.sessionId,
    phase: context.state.phase,
    role: "simulation",
    epoch: context.state.epoch,
    tick: context.state.tick,
    committedEventSeq: context.state.events.length,
    admittedCommandSeq: context.state.admittedCommandSeq,
  };
}

/** Admit one participant via the bound platform admission oracle. */
export function admitParticipantOp<S>(
  context: KernelOperationContext<S>,
  request: { readonly tenant: TenantId; readonly subject: SubjectId },
): ParticipantAdmissionResult {
  const state = context.state;
  const active = state.phase === "ready" || state.phase === "running";
  const matchSession: MatchSessionId | undefined = bridgeMatchSessionId(context.options.sessionId);
  if (matchSession === undefined) {
    const result: ParticipantAdmissionResult = {
      admitted: false,
      code: "malformed-facts",
      detail: "kernel session id is not valid platform id text",
    };
    recordRefusal(context, "admission", result.code, result.detail);
    return result;
  }
  const facts = deriveAdmissionFacts({
    session: context.options.sessionId,
    tenant: context.options.tenant,
    capacity: context.configuration?.capacity ?? 0,
    enrolled: state.participants.length,
    admission: context.options.servicePolicy.admission,
    invitedSubjects: context.options.invitedSubjects ?? [],
  });
  const platformRequest: SessionAdmissionRequest = {
    tenant: request.tenant,
    session: matchSession,
    subject: request.subject,
  };
  const result = adjudicateParticipantAdmission(
    platformRequest,
    facts,
    active,
    (subject) => state.participants.some((participant) => participant.subject === subject),
  );
  if (!result.admitted) {
    recordRefusal(context, "admission", result.code, result.detail);
    context.options.transport.deliver({
      kind: "participant-refused",
      sessionId: context.options.sessionId,
      subject: request.subject,
      code: result.code,
      detail: result.detail,
    });
    return result;
  }
  const participant: ParticipantView = {
    subject: request.subject,
    actor: { actorClass: "player", actorId: asActorId(`player:${String(request.subject)}`) },
    joinedAtTick: state.tick,
  };
  state.participants.push(participant);
  context.options.transport.deliver({
    kind: "participant-admitted",
    sessionId: context.options.sessionId,
    subject: participant.subject,
    actor: participant.actor,
  });
  return result;
}

/** Submit one intent through the full admission pipeline. */
export function submitIntentOp<S, P>(
  context: KernelOperationContext<S>,
  submission: IntentSubmission<P>,
): IntentSubmitResult {
  if (context.configuration === undefined) {
    return { status: "rejected", code: "session-not-open", detail: "session has not opened" };
  }
  const key = submission.idempotencyKey;
  const keyString = `${key.scope}:${String(key.actor)}:${String(key.nonce)}`;
  const plan = planIntentAdmission({
    submission,
    schemas: context.options.intentSchemas,
    rules: context.options.intentRules,
    topology: context.configuration.rules,
    sessionView: sessionViewOf(context),
    commandPolicy: context.commandPolicy,
    recorded: context.state.idempotency.get(keyString),
    usedThisTick:
      context.state.perTickIntentCounts.get(String(submission.intent.actor.actorId)) ?? 0,
    sessionId: context.options.sessionId,
    now: () => context.options.clock.now(),
  });
  if (plan.plan === "reject") {
    const kind = plan.code === "idempotency-collision" ? "idempotency" : "intent";
    recordRefusal(context, kind, plan.code, plan.detail);
    context.options.transport.deliver({
      kind: "intent-refused",
      sessionId: context.options.sessionId,
      code: plan.code,
      detail: plan.detail,
    });
    return { status: "rejected", code: plan.code, detail: plan.detail };
  }
  if (plan.plan === "duplicate") {
    return {
      status: "duplicate",
      commandId: plan.commandId,
      firstReceipt: plan.commandId,
      receiptEpoch: context.state.epoch,
    };
  }
  const state = context.state;
  state.admittedCommandSeq = plan.assignedSeq;
  state.idempotency.set(plan.keyString, {
    fingerprint: plan.fingerprint,
    commandId: String(plan.commandId),
  });
  state.pending.push({
    envelope: plan.envelope,
    intent: submission.intent,
    assignedSeq: plan.assignedSeq,
  });
  state.perTickIntentCounts.set(
    plan.actorKey,
    (state.perTickIntentCounts.get(plan.actorKey) ?? 0) + 1,
  );
  return {
    status: "admitted",
    commandId: plan.commandId,
    assignedSeq: plan.assignedSeq,
    queuedForTick: asTick(state.tick + 1),
    receiptEpoch: state.epoch,
  };
}

/** Advance `count` fixed ticks through the authoritative seam. */
export function advanceTicksOp<S>(
  context: KernelOperationContext<S>,
  count: number,
): TickResult {
  const state = context.state;
  if (context.configuration === undefined || state.simulatorState === undefined) {
    return { ok: false, code: "session-not-open", detail: "session has not opened" };
  }
  if (isTerminalSessionPhase(state.phase)) {
    return { ok: false, code: "session-terminal", detail: `session is ${state.phase}` };
  }
  if (state.phase === "failed") {
    return { ok: false, code: "session-failed", detail: "session failed; no further stepping" };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, code: "session-failed", detail: "tick count must be a positive integer" };
  }
  const fromTick = state.tick;
  let emitted = 0;
  if (state.phase === "ready" && !transitionPhase(context, "running")) {
    return { ok: false, code: "session-failed", detail: "could not enter running" };
  }
  for (let index = 0; index < count; index += 1) {
    const nextTick = asTick(state.tick + 1);
    const due: readonly AdmittedIntent[] = state.pending.map((entry) => ({
      commandId: entry.envelope.commandId,
      assignedSeq: entry.assignedSeq,
      intent: entry.intent,
    }));
    const step = context.options.simulator.step({
      state: state.simulatorState,
      tick: nextTick,
      intents: due,
      participants: [...state.participants],
    });
    const segmentStart = state.events.length + 1;
    const admittedCommandIds = new Set(
      [...state.idempotency.values()].map((value) => value.commandId),
    );
    const committed = [];
    for (const effect of step.effects) {
      const admission = admitEffect(effect, {
        bindings: context.bindings,
        rules: context.configuration.rules,
        admittedCommandIds,
        protectedGrantKinds: context.options.protectedGrantKinds,
      });
      if (!admission.admitted) {
        recordRefusal(context, "effect", admission.code, admission.detail);
        continue;
      }
      if (admission.grant !== undefined) {
        const kinds = state.protectedGrants.get(admission.grant.actorId) ?? new Set();
        kinds.add(admission.grant.kind);
        state.protectedGrants.set(admission.grant.actorId, kinds);
      }
      committed.push(
        emitEvent(context, admission.kind, admission.cause, admission.payload, nextTick),
      );
    }
    state.simulatorState = step.state;
    state.tick = nextTick;
    state.pending.length = 0;
    state.perTickIntentCounts.clear();
    if (committed.length > 0) {
      const validation = validateEventStream(committed, {
        startAtSeq: segmentStart,
        admittedCommandIds: [...admittedCommandIds].map((id) => asCommandId(id)),
      });
      if (!validation.ok) {
        failSession(context, `event stream invariant violated: ${validation.code}`);
        return { ok: false, code: "session-failed", detail: validation.detail };
      }
      context.options.transport.deliver({
        kind: "events",
        sessionId: context.options.sessionId,
        epoch: state.epoch,
        events: [...committed],
      });
      emitted += committed.length;
    }
  }
  context.options.scheduler?.nextTickDue({
    sessionId: context.options.sessionId,
    completedTick: state.tick,
    nextTick: asTick(state.tick + 1),
    tickIntervalMs: context.options.tickIntervalMs,
  });
  return { ok: true, fromTick, toTick: state.tick, eventsEmitted: emitted };
}

/** Recompute the derived command policy (used by the kernel constructor). */
export function commandPolicyOf<S>(context: { options: AuthoritySessionKernelOptions<S> }) {
  return deriveCommandAdmissionPolicy(context.options.intentRules);
}

/** Tick cast helper re-export for settlement operations. */
export function tickOf(n: number): Tick {
  return asTick(n);
}
