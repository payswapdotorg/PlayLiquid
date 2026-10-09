/**
 * TYPED INTENT ADMISSION — the multiplayer kernel's input valve (lock rule
 * 13: "AI emits typed intents; authoritative systems own state mutation";
 * architecture "Multiplayer": "Client sends input/intent. Server
 * validates/simulates and emits state/events").
 *
 * Clients (players, avatar agents, host authorities) submit
 * runtime-contracts {@link TypedIntent} PROPOSALS. An intent only becomes a
 * canonical {@link RuntimeCommandEnvelope} (and then a committed event)
 * after passing, in order:
 *
 * 1. SCHEMA — the intent kind is registered and the payload validates
 *    against its game-supplied {@link IntentSchema} (unknown kinds and
 *    malformed payloads are refused before anything else happens);
 * 2. POLICY — the origin is admitted by BOTH the intent's own
 *    {@link IntentAdmissionRule} AND the session's frozen
 *    {@link TopologyAdmissionRules} (e.g. `host-authority` exists only in
 *    client-server topology; peer-to-peer admits players and broker-mediated
 *    agents only);
 * 3. ORIGIN/ACTOR CONSISTENCY — the origin kind matches the actor class
 *    (`platform-system` origin needs a platform-system actor, etc.; the
 *    player/avatar-agent pairs are additionally enforced downstream by the
 *    bound `admitCommand` gate);
 * 4. EPOCH FRESHNESS — the issuer's observed epoch equals the session's
 *    current epoch (enforced by the bound `admitCommand` gate:
 *    `stale-epoch`);
 * 5. IDEMPOTENCY + RATE — key/fingerprint classification and per-actor
 *    per-tick caps, owned by the kernel (kernel.ts).
 *
 * Purity: this module is the pure validation half; the kernel owns tables.
 */

import type {
  CommandAdmissionPolicy,
  CommandId,
  CommandKind,
  CommandOrigin,
  CommandSequence,
  IdempotencyKey,
  IntentKind,
  RuntimeCommandEnvelope,
  RuntimeSessionPhase,
  RuntimeSessionSnapshotView,
  SessionEpoch,
  SessionId,
  Timestamp,
  TypedIntent,
} from "@playliquid/runtime-contracts";
import { admitCommand } from "@playliquid/runtime-contracts";
import type { CommandOriginKind, TopologyAdmissionRules } from "./topology.ts";
import { digestOf } from "./digest.ts";

// ---------------------------------------------------------------------------
// Schemas and admission rules
// ---------------------------------------------------------------------------

/**
 * Game-supplied payload schema for one intent kind: a pure type guard.
 * Payloads that fail the guard never reach the canonical command path.
 */
export interface IntentSchema<P = unknown> {
  readonly intentKind: IntentKind;
  readonly validate: (payload: unknown) => payload is P;
}

/** Per-intent-kind admission policy (game policy data). */
export interface IntentAdmissionRule {
  readonly intentKind: IntentKind;
  /** Canonical command kind this intent maps onto (E2: one path). */
  readonly commandKind: CommandKind;
  /** Origins that may submit this intent kind (intersected with topology). */
  readonly admittedOrigins: readonly CommandOriginKind[];
  /** Max submissions per actor per tick window (E8 rate discipline). */
  readonly maxPerTickPerActor: number;
}

/** A client/intelligence submission entering the admission pipeline. */
export interface IntentSubmission<P = unknown> {
  readonly intent: TypedIntent<P>;
  readonly origin: CommandOrigin;
  /** Session epoch the issuer observed when creating the submission. */
  readonly observedEpoch: SessionEpoch;
  readonly idempotencyKey: IdempotencyKey;
}

/** Pure validation failures of steps 1-3 above. */
export interface IntentValidationFailure {
  readonly code:
    | "unknown-intent-kind"
    | "payload-schema-violation"
    | "origin-not-admitted-by-intent-rule"
    | "origin-not-admitted-by-topology"
    | "origin-actor-inconsistent";
  readonly detail: string;
}

export type IntentValidation = { readonly ok: true } | { readonly ok: false; readonly failure: IntentValidationFailure };

/** Schema/rule alignment check used at kernel open (1:1, no orphans). */
export function intentKindsAligned(
  schemas: readonly IntentSchema[],
  rules: readonly IntentAdmissionRule[],
): boolean {
  const schemaKinds = new Set(schemas.map((schema) => String(schema.intentKind)));
  const ruleKinds = new Set(rules.map((rule) => String(rule.intentKind)));
  if (schemaKinds.size !== rules.length || ruleKinds.size !== schemas.length) return false;
  for (const kind of schemaKinds) {
    if (!ruleKinds.has(kind)) return false;
  }
  return true;
}

/**
 * Pure validation of steps 1-3. The kernel calls this before idempotency,
 * rate limiting and the bound `admitCommand` gate (steps 4-5).
 */
export function validateIntentSubmission(
  submission: IntentSubmission,
  schemas: readonly IntentSchema[],
  rules: readonly IntentAdmissionRule[],
  topology: TopologyAdmissionRules,
): IntentValidation {
  const kind = String(submission.intent.kind);
  const schema = schemas.find((candidate) => String(candidate.intentKind) === kind);
  const rule = rules.find((candidate) => String(candidate.intentKind) === kind);
  if (schema === undefined || rule === undefined) {
    return {
      ok: false,
      failure: {
        code: "unknown-intent-kind",
        detail: `intent kind ${kind} is not registered in this session`,
      },
    };
  }
  if (!schema.validate(submission.intent.payload)) {
    return {
      ok: false,
      failure: {
        code: "payload-schema-violation",
        detail: `intent ${String(submission.intent.intentId)} payload failed the schema for ${kind}`,
      },
    };
  }
  if (!rule.admittedOrigins.includes(submission.origin.kind)) {
    return {
      ok: false,
      failure: {
        code: "origin-not-admitted-by-intent-rule",
        detail: `origin ${submission.origin.kind} may not submit intent kind ${kind}`,
      },
    };
  }
  if (!topology.admittedOrigins.includes(submission.origin.kind)) {
    return {
      ok: false,
      failure: {
        code: "origin-not-admitted-by-topology",
        detail: `origin ${submission.origin.kind} is not admitted under topology ${topology.topology}`,
      },
    };
  }
  const inconsistency = originActorInconsistency(submission);
  if (inconsistency !== undefined) {
    return { ok: false, failure: inconsistency };
  }
  return { ok: true };
}

/**
 * Origin/actor-class consistency for the pairs the bound admission gate
 * does not cover: platform-system and host-authority origins must come
 * from actors of the matching class (players and avatar agents are already
 * enforced by `admitCommand`).
 */
function originActorInconsistency(submission: IntentSubmission): IntentValidationFailure | undefined {
  const origin = submission.origin.kind;
  const actorClass = submission.intent.actor.actorClass;
  if (origin === "platform-system" && actorClass !== "platform-system") {
    return {
      code: "origin-actor-inconsistent",
      detail: `platform-system origin requires a platform-system actor, got ${actorClass}`,
    };
  }
  if (origin === "host-authority" && actorClass !== "host-authority") {
    return {
      code: "origin-actor-inconsistent",
      detail: `host-authority origin requires a host-authority actor, got ${actorClass}`,
    };
  }
  return undefined;
}

/**
 * Derive the canonical {@link CommandAdmissionPolicy} from the intent
 * rules: every registered command kind is admitted in `ready` (queued for
 * the first tick) and `running` (live play). This is the E2 bridge from the
 * multiplayer intent vocabulary onto the runtime command admission gate.
 */
export function deriveCommandAdmissionPolicy(
  rules: readonly IntentAdmissionRule[],
): CommandAdmissionPolicy {
  const policy: Record<string, readonly RuntimeSessionPhase[]> = {};
  for (const rule of rules) {
    policy[String(rule.commandKind)] = ["ready", "running"];
  }
  return policy;
}

// ---------------------------------------------------------------------------
// Admission planning (the pure pipeline the kernel applies)
// ---------------------------------------------------------------------------

/** Inputs to {@link planIntentAdmission} (kernel-owned read models). */
export interface IntentAdmissionPlanInput<P> {
  readonly submission: IntentSubmission<P>;
  readonly schemas: readonly IntentSchema[];
  readonly rules: readonly IntentAdmissionRule[];
  readonly topology: TopologyAdmissionRules;
  readonly sessionView: RuntimeSessionSnapshotView;
  readonly commandPolicy: CommandAdmissionPolicy;
  /** Recorded first encounter for the submission's idempotency key, if any. */
  readonly recorded: { readonly fingerprint: string; readonly commandId: string } | undefined;
  /** Submissions the actor already used in the current tick window. */
  readonly usedThisTick: number;
  readonly sessionId: SessionId;
  readonly now: () => Timestamp;
}

/** The plan the kernel applies. */
export type IntentAdmissionPlan =
  | { readonly plan: "reject"; readonly code: string; readonly detail: string }
  | { readonly plan: "duplicate"; readonly commandId: CommandId }
  | {
      readonly plan: "admit";
      readonly envelope: RuntimeCommandEnvelope;
      readonly commandId: CommandId;
      readonly assignedSeq: CommandSequence;
      readonly actorKey: string;
      readonly keyString: string;
      readonly fingerprint: string;
    };

/**
 * The pure admission pipeline (schema -> policy -> consistency ->
 * idempotency -> rate -> the bound `admitCommand` gate). The kernel
 * supplies its read models and applies the returned plan to its state.
 */
export function planIntentAdmission<P>(
  input: IntentAdmissionPlanInput<P>,
): IntentAdmissionPlan {
  const submission = input.submission;
  const validation = validateIntentSubmission(
    submission,
    input.schemas,
    input.rules,
    input.topology,
  );
  if (!validation.ok) {
    return { plan: "reject", code: validation.failure.code, detail: validation.failure.detail };
  }
  const rule = input.rules.find(
    (candidate) => String(candidate.intentKind) === String(submission.intent.kind),
  );
  if (rule === undefined) {
    return { plan: "reject", code: "unknown-intent-kind", detail: "rule vanished" };
  }
  const key = submission.idempotencyKey;
  const keyString = `${key.scope}:${String(key.actor)}:${String(key.nonce)}`;
  const fingerprint = String(
    digestOf({ kind: String(submission.intent.kind), payload: submission.intent.payload }),
  );
  if (input.recorded !== undefined) {
    if (input.recorded.fingerprint === fingerprint) {
      return { plan: "duplicate", commandId: input.recorded.commandId as CommandId };
    }
    return {
      plan: "reject",
      code: "idempotency-collision",
      detail: `idempotency key collision on ${String(submission.intent.intentId)}`,
    };
  }
  const actorKey = String(submission.intent.actor.actorId);
  if (input.usedThisTick >= rule.maxPerTickPerActor) {
    return {
      plan: "reject",
      code: "rate-limit-exceeded",
      detail: `actor ${actorKey} exceeded ${rule.maxPerTickPerActor} intents in the current tick window`,
    };
  }
  const commandId = `cmd:${keyString}` as CommandId;
  const envelope: RuntimeCommandEnvelope = {
    commandId,
    sessionId: input.sessionId,
    kind: rule.commandKind,
    epoch: submission.observedEpoch,
    actor: submission.intent.actor,
    origin: submission.origin,
    idempotencyKey: key,
    issuedAt: input.now(),
    payload: submission.intent.payload,
  };
  const admission = admitCommand(input.sessionView, input.commandPolicy, envelope);
  if (admission.status === "rejected") {
    return { plan: "reject", code: admission.code, detail: admission.detail };
  }
  return {
    plan: "admit",
    envelope,
    commandId,
    assignedSeq: admission.assignedSeq,
    actorKey,
    keyString,
    fingerprint,
  };
}
