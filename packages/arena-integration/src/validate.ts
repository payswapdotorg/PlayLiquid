/**
 * PURE ARENA RESPONSE VALIDATOR (E11 — validated evidence, never authority).
 *
 * "Responses are VALIDATED records: a pure response validator checks
 * authorization scopes (artifacts returned only where explicitly
 * authorized), evidence linkage, and request-digest matching."
 *
 * Everything the Arena sends is UNTRUSTED external input (architecture
 * "Security"; lock rule 6: Arena is an external human-capability
 * provider). This module is the single admission oracle for response
 * ENVELOPES: it takes the raw response and the request envelope that
 * produced it, and returns a typed verdict. It performs no IO, keeps no
 * state, reads no clock, and NEVER turns a valid response into anything
 * other than validated DATA — authority over what the verdict MEANS for
 * PlayLiquid state stays with the Lab's evidence path (`ingestion.ts`
 * produces evidence packages; nothing here can touch live state).
 *
 * Rejection reasons are a frozen vocabulary so refusals are machine-
 * checkable and auditable (E8: negative tests are mandatory).
 */

import { frozenVocabulary } from "./primitives.ts";
import { isArenaResponseEnvelope, arenaResponseResultContents } from "./response.ts";
import type { ArenaResponseEnvelope } from "./response.ts";
import { isArenaRequestEnvelope, requestKindArtifactClass } from "./request.ts";

// ---------------------------------------------------------------------------
// Rejection reasons (frozen vocabulary)
// ---------------------------------------------------------------------------

/**
 * The frozen vocabulary of response-validation refusals:
 * - `malformed-request` / `malformed-response` — structural guards failed;
 * - `request-digest-mismatch` — the response does not answer the request
 *   payload it was validated against (digest pin mismatch);
 * - `respondent-mismatch` — the response claims a different endpoint than
 *   the one the request targeted;
 * - `artifact-not-authorized` — an artifact payload whose class is not in
 *   the request's explicit authorization scope;
 * - `evidence-linkage-broken` — evidence substantiates a result content
 *   digest that is not among the response's own result payloads;
 * - `request-kind-incoherent` — the response returns artifacts while the
 *   request kind asks for none (defense in depth on top of scope checks).
 */
export type ArenaResponseRejectionReason =
  | "malformed-request"
  | "malformed-response"
  | "request-digest-mismatch"
  | "respondent-mismatch"
  | "artifact-not-authorized"
  | "evidence-linkage-broken"
  | "request-kind-incoherent";

/** All valid {@link ArenaResponseRejectionReason} values. */
export const ARENA_RESPONSE_REJECTION_REASONS = frozenVocabulary<ArenaResponseRejectionReason>(
  "arena-response-rejection-reason",
  [
    "malformed-request",
    "malformed-response",
    "request-digest-mismatch",
    "respondent-mismatch",
    "artifact-not-authorized",
    "evidence-linkage-broken",
    "request-kind-incoherent",
  ],
);

/** Returns true when `value` is a valid {@link ArenaResponseRejectionReason}. */
export function isArenaResponseRejectionReason(value: unknown): value is ArenaResponseRejectionReason {
  return ARENA_RESPONSE_REJECTION_REASONS.is(value);
}

// ---------------------------------------------------------------------------
// Validation verdict
// ---------------------------------------------------------------------------

/**
 * The typed verdict of {@link validateArenaResponse}. On success the
 * structurally-narrowed envelope is returned as VALIDATED DATA; on failure
 * the frozen-vocabulary reasons say exactly which invariants broke.
 */
export type ArenaResponseValidation =
  | { readonly valid: true; readonly response: ArenaResponseEnvelope }
  | { readonly valid: false; readonly reasons: readonly ArenaResponseRejectionReason[] };

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

/**
 * Validates one raw Arena response against the request envelope that
 * produced it. Pure: same inputs, same verdict, no side effects.
 *
 * Invariants enforced (in order):
 * 1. structural shape of both request and response (provenance markers
 *    `"arena-external"` included — structurally invalid without them);
 * 2. request-digest matching: the response must answer exactly the
 *    request payload digest it was sent for;
 * 3. respondent matching: the answering endpoint must be the endpoint the
 *    request targeted (digest-pinned identity equality);
 * 4. authorization scopes: every returned artifact's class must be
 *    explicitly authorized by the request scope;
 * 5. evidence linkage: every evidence `substantiates` digest must resolve
 *    against the response's own result contents;
 * 6. request-kind coherence: artifact payloads are only acceptable when
 *    the request kind actually asks for artifacts (the scope check above
 *    remains the authorization authority; this is defense in depth).
 */
export function validateArenaResponse(response: unknown, request: unknown): ArenaResponseValidation {
  const reasons: ArenaResponseRejectionReason[] = [];
  if (!isArenaRequestEnvelope(request)) {
    return { valid: false, reasons: Object.freeze(["malformed-request"]) };
  }
  if (!isArenaResponseEnvelope(response)) {
    return { valid: false, reasons: Object.freeze(["malformed-response"]) };
  }

  if (response.requestPayload !== request.cycle.requestPayload) {
    reasons.push("request-digest-mismatch");
  }
  if (response.respondent.endpointDigest !== request.endpoint.endpointDigest) {
    reasons.push("respondent-mismatch");
  }

  const authorizedClasses = request.cycle.authorization.artifactClasses;
  const requestWantsArtifacts = requestKindArtifactClass(request.requestKind) !== undefined;
  for (const artifact of response.artifacts) {
    if (!authorizedClasses.includes(artifact.artifactClass)) {
      reasons.push("artifact-not-authorized");
    }
    if (!requestWantsArtifacts) {
      reasons.push("request-kind-incoherent");
    }
  }

  const resultContents = new Set<string>(arenaResponseResultContents(response));
  for (const evidence of response.evidence) {
    for (const digest of evidence.substantiates) {
      if (!resultContents.has(digest)) {
        reasons.push("evidence-linkage-broken");
      }
    }
  }

  if (reasons.length > 0) {
    return { valid: false, reasons: Object.freeze([...new Set(reasons)]) };
  }
  return { valid: true, response };
}
