/**
 * ARENA ESCALATION REQUEST CONTRACTS — the provider-neutral wire side
 * (architecture.md §Arena; R18; lock rules 6, 21, 32).
 *
 * "PlayLiquid sends a typed provider-neutral escalation request."
 *
 * Two layers are deliberately kept apart:
 *
 * 1. The WIRE ENVELOPE ({@link ArenaRequestEnvelope}) — what crosses the
 *    {@link "./transport.ts".ArenaTransport} port: a frozen request-kind
 *    vocabulary, the requesting cycle context (content-addressed request
 *    payload, content-addressed capability-gap summary, authorization
 *    scopes for artifact return) and the digest-pinned target endpoint.
 *    This layer is fully owned by this package and is provider-neutral:
 *    no Arena vendor vocabulary, no transport details, no Lab-internal
 *    taxonomy.
 *
 * 2. The LAB-SIDE ESCALATION REQUEST RECORD — the full typed shape the
 *    Lab assembles, built FROM lab-contracts' `ArenaEscalationRef`
 *    (the "arena-external" marker + opaque escalation id + content-addressed
 *    request digest). PL-006 is NOT MERGED at the pinned base of this Work
 *    Order, so that record is intentionally NOT defined here: re-declaring
 *    `ArenaEscalationRef` or the gap-ladder vocabulary locally would create
 *    a parallel authority. See the Architecture Change Request note in
 *    `src/index.ts`.
 *
 * Correlation design: the request payload digest is THE shared pin. The
 * Lab-side ref (when PL-006 lands) and every record in this package
 * (envelope, lifecycle, audit, responses, evidence packages) correlate
 * through the same content digest, so the future
 * `ArenaEscalationRequest = ArenaEscalationRef & ArenaRequestEnvelope`
 * composes without rework and without leaking the Lab's internal escalation
 * id onto the provider-facing wire.
 *
 * Purity: no IO, no clock, no randomness.
 */

import { frozenVocabulary } from "./primitives.ts";
import { isArenaEndpointRef, isValidArenaContentDigest } from "./primitives.ts";
import type { ArenaContentDigest, ArenaEndpointRef } from "./primitives.ts";
import { isArenaAuthorizationScope, scopeAllowsArtifact } from "./authorization.ts";
import type { ArenaArtifactClass, ArenaAuthorizationScope } from "./authorization.ts";

// ---------------------------------------------------------------------------
// Request kinds (frozen vocabulary)
// ---------------------------------------------------------------------------

/**
 * The frozen vocabulary of Arena request kinds. Kinds are derived from the
 * declared Arena return classes (architecture.md §Arena: results; evidence;
 * capability/tool/skill/knowledge artifacts): a request kind states WHAT
 * the Arena is asked to return. Extending this union is a breaking contract
 * change requiring an Architecture Change Request.
 */
export type ArenaRequestKind =
  | "result"
  | "evidence"
  | "artifact.capability"
  | "artifact.tool"
  | "artifact.skill"
  | "artifact.knowledge";

/** All valid {@link ArenaRequestKind} values. */
export const ARENA_REQUEST_KINDS = frozenVocabulary<ArenaRequestKind>("arena-request-kind", [
  "result",
  "evidence",
  "artifact.capability",
  "artifact.tool",
  "artifact.skill",
  "artifact.knowledge",
]);

/** Returns true when `value` is a valid {@link ArenaRequestKind}. */
export function isArenaRequestKind(value: unknown): value is ArenaRequestKind {
  return ARENA_REQUEST_KINDS.is(value);
}

/** The artifact class a request kind asks for, or `undefined` for non-artifact kinds. */
export function requestKindArtifactClass(kind: ArenaRequestKind): ArenaArtifactClass | undefined {
  if (kind === "artifact.capability") return "capability";
  if (kind === "artifact.tool") return "tool";
  if (kind === "artifact.skill") return "skill";
  if (kind === "artifact.knowledge") return "knowledge";
  return undefined;
}

// ---------------------------------------------------------------------------
// Requesting cycle context
// ---------------------------------------------------------------------------

/**
 * The requesting cycle context an escalation carries (work order scope):
 * the content-addressed request payload (what the Arena is asked to
 * execute), the content-addressed capability-gap summary (Lab-pinned
 * record of WHY the Lab escalated — the gap-ladder vocabulary itself is
 * lab-contracts' and stays behind the digest), and the authorization
 * scopes gating artifact return.
 */
export type ArenaRequestCycleContext = Readonly<{
  requestPayload: ArenaContentDigest;
  gapSummary: ArenaContentDigest;
  authorization: ArenaAuthorizationScope;
}>;

/** Returns true when `value` is structurally a valid {@link ArenaRequestCycleContext}. */
export function isArenaRequestCycleContext(value: unknown): value is ArenaRequestCycleContext {
  if (typeof value !== "object" || value === null) return false;
  const cycle = value as Record<string, unknown>;
  return (
    typeof cycle.requestPayload === "string" &&
    isValidArenaContentDigest(cycle.requestPayload) &&
    typeof cycle.gapSummary === "string" &&
    isValidArenaContentDigest(cycle.gapSummary) &&
    isArenaAuthorizationScope(cycle.authorization)
  );
}

// ---------------------------------------------------------------------------
// Wire request envelope
// ---------------------------------------------------------------------------

/** Structural kind marker of an {@link ArenaRequestEnvelope}. */
export type ArenaRequestEnvelopeKind = "arena-request";

/** Marker value for {@link ArenaRequestEnvelopeKind}. */
export const ARENA_REQUEST_ENVELOPE_KIND: ArenaRequestEnvelopeKind = "arena-request";

/**
 * The provider-neutral wire envelope PlayLiquid sends to the external
 * Arena. It carries the request kind, the cycle context and the
 * digest-pinned target endpoint. It deliberately carries NO provider
 * names, NO transport details and NO Lab-internal escalation ids.
 */
export type ArenaRequestEnvelope = Readonly<{
  envelopeKind: ArenaRequestEnvelopeKind;
  requestKind: ArenaRequestKind;
  cycle: ArenaRequestCycleContext;
  endpoint: ArenaEndpointRef;
}>;

/** Returns true when `value` is structurally a valid {@link ArenaRequestEnvelope}. */
export function isArenaRequestEnvelope(value: unknown): value is ArenaRequestEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Record<string, unknown>;
  return (
    envelope.envelopeKind === ARENA_REQUEST_ENVELOPE_KIND &&
    isArenaRequestKind(envelope.requestKind) &&
    isArenaRequestCycleContext(envelope.cycle) &&
    isArenaEndpointRef(envelope.endpoint)
  );
}

// ---------------------------------------------------------------------------
// Envelope coherence (kind ↔ scope, digest sanity)
// ---------------------------------------------------------------------------

/** Reasons an envelope can fail coherence checking (frozen vocabulary). */
export type ArenaRequestRejectionReason = "artifact-scope-missing" | "payload-gap-summary-collision" | "malformed-envelope";

/** All valid {@link ArenaRequestRejectionReason} values. */
export const ARENA_REQUEST_REJECTION_REASONS = frozenVocabulary<ArenaRequestRejectionReason>("arena-request-rejection-reason", [
  "artifact-scope-missing",
  "payload-gap-summary-collision",
  "malformed-envelope",
]);

/** Outcome of {@link checkArenaRequestEnvelopeCoherence}. */
export type ArenaRequestCoherence =
  | { readonly coherent: true }
  | { readonly coherent: false; readonly reasons: readonly ArenaRequestRejectionReason[] };

/**
 * Coherence oracle over a well-formed envelope: an `artifact.*` request
 * kind MUST carry an authorization scope that explicitly authorizes return
 * of that artifact class ("artifacts returned only where explicitly
 * authorized" — architecture.md §Arena), and the request payload and gap
 * summary must be pinned by DIFFERENT digests (they are different
 * documents; equal digests would be a content-addressing collision).
 */
export function checkArenaRequestEnvelopeCoherence(value: unknown): ArenaRequestCoherence {
  if (!isArenaRequestEnvelope(value)) return { coherent: false, reasons: Object.freeze(["malformed-envelope"]) };
  const reasons: ArenaRequestRejectionReason[] = [];
  const artifactClass = requestKindArtifactClass(value.requestKind);
  if (artifactClass !== undefined && !scopeAllowsArtifact(value.cycle.authorization, artifactClass)) {
    reasons.push("artifact-scope-missing");
  }
  if (value.cycle.requestPayload === value.cycle.gapSummary) {
    reasons.push("payload-gap-summary-collision");
  }
  return reasons.length > 0 ? { coherent: false, reasons: Object.freeze(reasons) } : { coherent: true };
}

// ---------------------------------------------------------------------------
// Send idempotency key (E6)
// ---------------------------------------------------------------------------

/**
 * The idempotency key of one SEND: one request payload, to one endpoint,
 * sent at most once effectively. Retries re-submit the same envelope and
 * are answered by the first send (duplicate); the same key with a
 * different envelope is a collision and is REFUSED (E8: never silently
 * executed as a second send) — see `settleArenaSend` in `lifecycle.ts`.
 */
export type ArenaSendIdempotencyKey = Readonly<{
  endpoint: ArenaEndpointRef;
  requestPayload: ArenaContentDigest;
}>;

/** Derives the {@link ArenaSendIdempotencyKey} of an envelope. */
export function arenaSendIdempotencyKey(envelope: ArenaRequestEnvelope): ArenaSendIdempotencyKey {
  return Object.freeze({ endpoint: envelope.endpoint, requestPayload: envelope.cycle.requestPayload });
}

/** Structural equality of two {@link ArenaSendIdempotencyKey}s. */
export function arenaSendIdempotencyKeyEquals(a: ArenaSendIdempotencyKey, b: ArenaSendIdempotencyKey): boolean {
  return a.endpoint.endpointDigest === b.endpoint.endpointDigest && a.requestPayload === b.requestPayload;
}

/** Canonical string key of an {@link ArenaSendIdempotencyKey} (maps, logs). */
export function arenaSendIdempotencyKeyText(key: ArenaSendIdempotencyKey): string {
  return `${key.endpoint.endpointDigest}:${key.requestPayload}`;
}
