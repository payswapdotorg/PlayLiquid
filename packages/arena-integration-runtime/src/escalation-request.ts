/**
 * THE LAB-SIDE ESCALATION REQUEST RECORD — the pending PL-007 Architecture
 * Change Request seam, resolved FROM THE RUNTIME LAYER (PL-031).
 *
 * packages/arena-integration (PL-007) could not build its Lab-side escalation
 * request record at its pinned base because packages/lab-contracts (PL-006)
 * had not landed; per its `src/index.ts` ACR note, the intended record is
 *
 *     ArenaEscalationRequest = ArenaEscalationRef & ArenaRequestEnvelope
 *
 * with the request-payload digest as THE shared correlation pin. lab-contracts
 * has since merged, so THIS package — whose write surface it is — imports
 * and extends instead of re-declaring:
 *
 * - {@link ArenaEscalationRequest} intersects lab-contracts'
 *   `ArenaEscalationRef` (the "arena-external" trust-boundary marker, the
 *   opaque external escalation handle, the content digest of the typed
 *   escalation request artifact) with arena-integration's
 *   `ArenaRequestEnvelope` (the provider-neutral wire envelope). Neither
 *   vocabulary is re-declared here.
 * - the correlation pin is made CONCRETE: the ref's `requestDigest` (bare
 *   64-hex lab-contracts form) must be the SAME digest as the envelope's
 *   `cycle.requestPayload` (the `sha256:<hex>` package-system wire form).
 *   {@link checkArenaEscalationRequestCoherence} refuses a mismatch with
 *   `digest-pin-mismatch`, plus every arena-integration envelope coherence
 *   rule (artifact-scope-missing, payload-gap-summary-collision,
 *   malformed-envelope).
 * - {@link arenaRequestEnvelopeOf} builds the wire envelope;
 *   {@link bridgeArenaEscalationRequest} attaches the external ref, deriving
 *   the opaque external escalation handle deterministically from the case
 *   CONTENT KEY digest (E9: same decided content, same handle — Arena
 *   treats it as the escalation's opaque identifier).
 *
 * packages/arena-integration itself is NEVER modified (the frozen write
 * surface rule); when the TL re-parents that package onto lab-contracts in a
 * later governance wave, this bridge collapses to a re-export.
 *
 * Purity: no IO, no clock, no randomness.
 */

import type { ArenaAuthorizationScope, ArenaRequestEnvelope } from "@playliquid/arena-integration";
import { checkArenaRequestEnvelopeCoherence, isArenaRequestEnvelope } from "@playliquid/arena-integration";
import type { ArenaContentDigest, ArenaEndpointRef, ArenaRequestKind } from "@playliquid/arena-integration";
import type { ArenaEscalationRef } from "@playliquid/lab-contracts";
import { asArenaEscalationId, isArenaEscalationRef } from "@playliquid/lab-contracts";
import type { ContentDigest } from "@playliquid/lab-contracts";
import { arenaEscalationHandleOf, contentDigestOf } from "./digest.ts";

/** The Lab-side escalation request record (ACR-bridged; see module doc). */
export type ArenaEscalationRequest = ArenaEscalationRef & ArenaRequestEnvelope;

/** Reasons an escalation request record can fail its coherence oracle (frozen). */
export type ArenaEscalationRequestIncoherenceReason =
  | "malformed-escalation-ref"
  | "malformed-envelope"
  | "digest-pin-mismatch"
  | "artifact-scope-missing"
  | "payload-gap-summary-collision";

/** Outcome of {@link checkArenaEscalationRequestCoherence}. */
export type ArenaEscalationRequestCoherence =
  | { readonly coherent: true }
  | { readonly coherent: false; readonly reasons: readonly ArenaEscalationRequestIncoherenceReason[] };

/**
 * The coherence oracle over the bridged record: the external ref must be
 * structurally valid (lab-contracts' own guard), the wire envelope must be
 * structurally valid AND coherent by arena-integration's own oracle, and the
 * two correlation pins must name the SAME digest (the ACR's "every
 * correlation pin already lines up by design", now checked rather than
 * assumed).
 */
export function checkArenaEscalationRequestCoherence(value: unknown): ArenaEscalationRequestCoherence {
  if (!isArenaEscalationRef(value) || !isArenaRequestEnvelope(value)) {
    const reasons: ArenaEscalationRequestIncoherenceReason[] = [];
    if (!isArenaEscalationRef(value)) reasons.push("malformed-escalation-ref");
    if (!isArenaRequestEnvelope(value)) reasons.push("malformed-envelope");
    return { coherent: false, reasons: Object.freeze(reasons) };
  }
  const envelope = value as ArenaRequestEnvelope;
  const pinned = contentDigestOf(envelope.cycle.requestPayload);
  if (pinned === undefined || pinned !== value.requestDigest) {
    return { coherent: false, reasons: Object.freeze(["digest-pin-mismatch"]) };
  }
  const coherence = checkArenaRequestEnvelopeCoherence(envelope);
  if (!coherence.coherent) {
    // Arena-integration's reasons are already the frozen vocabulary this
    // union mirrors one-for-one (malformed-envelope included above).
    return { coherent: false, reasons: Object.freeze([...coherence.reasons]) };
  }
  return { coherent: true };
}

/** Input of {@link arenaRequestEnvelopeOf}. */
export interface ArenaRequestEnvelopeInput {
  /** The content-addressed ask (bare-hex lab-contracts digest form). */
  readonly requestPayload: ContentDigest;
  /** The content-addressed capability-gap summary (bare-hex form). */
  readonly gapSummary: ContentDigest;
  readonly requestKind: ArenaRequestKind;
  readonly authorization: ArenaAuthorizationScope;
  readonly endpoint: ArenaEndpointRef;
}

/** Builds the provider-neutral wire envelope (arena-integration's vocabulary). */
export function arenaRequestEnvelopeOf(input: ArenaRequestEnvelopeInput): ArenaRequestEnvelope {
  const requestPayload = `sha256:${input.requestPayload}` as ArenaContentDigest;
  const gapSummary = `sha256:${input.gapSummary}` as ArenaContentDigest;
  return Object.freeze({
    envelopeKind: "arena-request",
    requestKind: input.requestKind,
    cycle: Object.freeze({
      requestPayload,
      gapSummary,
      authorization: input.authorization,
    }),
    endpoint: input.endpoint,
  });
}

/**
 * Attaches the external escalation ref to a wire envelope: the marker, the
 * opaque handle derived from the case content key (E9), and the SAME request
 * digest in the lab-contracts bare-hex form. The result is coherent by
 * construction when the envelope already passed
 * {@link checkArenaRequestEnvelopeCoherence}.
 */
export function bridgeArenaEscalationRequest(
  envelope: ArenaRequestEnvelope,
  requestDigest: ContentDigest,
  caseKeyDigest: ContentDigest,
): ArenaEscalationRequest {
  const escalationId = asArenaEscalationId(arenaEscalationHandleOf(caseKeyDigest))!;
  return Object.freeze({
    external: "arena-external" as const,
    escalationId,
    requestDigest,
    ...envelope,
  });
}
