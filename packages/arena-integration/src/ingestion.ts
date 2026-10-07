/**
 * ARENA RESPONSE INGESTION — INGESTION-ONLY (lock: Arena cannot directly
 * mutate PlayLiquid live state; lock rule 33's Arena-side analogue).
 *
 * "The response handling is INGESTION-ONLY — typed ingestion verdicts
 * (admitted/rejected with reasons) that produce evidence-package records
 * for the Lab to consume through its normal evidence path; there is NO
 * type, port, or function that mutates live PlayLiquid state from an
 * Arena response."
 *
 * How the lock is STRUCTURAL, not conventional:
 * - every exported function here is a pure fold over its arguments: it
 *   reads the prior ingest receipt (if any), validates, and RETURNS a new
 *   immutable {@link ArenaEvidencePackage} — there is no state parameter
 *   to mutate, no callback, no effect type, no `apply`/`commit` surface;
 * - {@link ArenaEvidencePackage} is a passive data record: all fields are
 *   readonly, it carries the `"arena-evidence-package"` marker and the
 *   `"arena-external"` provenance of everything it wraps, and it has NO
 *   function-typed members — verified by `no-mutation.test.ts`;
 * - the package is shaped as EVIDENCE for the Lab's normal evidence path
 *   (E11: validated evidence, never authority): what the Lab DOES with it
 *   is the Lab's own evidence-consumption authority, out of this package's
 *   scope by design.
 *
 * Idempotency (E6, worker-contract "Async/stateful work"):
 * - Ingest idempotency key: { request payload digest, response digest }.
 * - One response is ingested AT MOST ONCE effectively: a replayed response
 *   returns the FIRST evidence package unchanged (`duplicate-ingest`);
 * - the same key resolving to a DIFFERENT package is an `ingest-collision`
 *   and is REFUSED outright (E8: never silently executed as a second
 *   ingest) — no package is produced or replaced;
 * - mutable state owner: the Lab-side Arena runtime (PL-031) owns the
 *   receipt store; this module is the pure admission oracle it folds.
 *
 * Purity: no IO, no clock (time is caller-supplied), no randomness.
 */

import type { ArenaContentDigest, ArenaEndpointRef, ArenaTimestampMs } from "./primitives.ts";
import { validateArenaResponse } from "./validate.ts";
import type { ArenaResponseRejectionReason } from "./validate.ts";
import type { ArenaRequestEnvelope } from "./request.ts";
import type { ArenaArtifactPayload, ArenaEvidencePayload, ArenaResponseEnvelope, ArenaResultPayload } from "./response.ts";
import { isArenaResponseEnvelope } from "./response.ts";

// ---------------------------------------------------------------------------
// Evidence packages (the ONLY product of ingestion)
// ---------------------------------------------------------------------------

/** Structural kind marker of an {@link ArenaEvidencePackage}. */
export type ArenaEvidencePackageKind = "arena-evidence-package";

/** Marker value for {@link ArenaEvidencePackageKind}. */
export const ARENA_EVIDENCE_PACKAGE_KIND: ArenaEvidencePackageKind = "arena-evidence-package";

/** The typed ingestion verdict: admitted, or rejected with frozen-vocabulary reasons. */
export type ArenaIngestionVerdict = "admitted" | "rejected";

/**
 * The passive, immutable record the Lab consumes through its normal
 * evidence path. Admitted packages carry the VALIDATED payloads; rejected
 * packages carry no payload data — only the refusal reasons and the pins
 * (request payload digest, response digest, respondent endpoint) of what
 * was refused, because historical observations are immutable (E10) and a
 * refusal is itself evidence.
 *
 * The Lab's evidence store (not this package) pins the package's own
 * content digest when it files the record.
 */
export type ArenaEvidencePackage = Readonly<{
  packageKind: ArenaEvidencePackageKind;
  verdict: ArenaIngestionVerdict;
  requestPayload: ArenaContentDigest;
  responseDigest: ArenaContentDigest;
  respondent: ArenaEndpointRef;
  reasons: readonly ArenaResponseRejectionReason[];
  results: readonly ArenaResultPayload[];
  evidence: readonly ArenaEvidencePayload[];
  artifacts: readonly ArenaArtifactPayload[];
  ingestedAt?: ArenaTimestampMs;
}>;

// ---------------------------------------------------------------------------
// Ingest idempotency key (E6)
// ---------------------------------------------------------------------------

/** The idempotency key of one INGEST: one response to one request, ingested at most once effectively. */
export type ArenaIngestIdempotencyKey = Readonly<{
  requestPayload: ArenaContentDigest;
  responseDigest: ArenaContentDigest;
}>;

/** Derives the {@link ArenaIngestIdempotencyKey} of a response envelope. */
export function arenaIngestIdempotencyKey(response: ArenaResponseEnvelope): ArenaIngestIdempotencyKey {
  return Object.freeze({ requestPayload: response.requestPayload, responseDigest: response.responseDigest });
}

/** Structural equality of two {@link ArenaIngestIdempotencyKey}s. */
export function arenaIngestIdempotencyKeyEquals(a: ArenaIngestIdempotencyKey, b: ArenaIngestIdempotencyKey): boolean {
  return a.requestPayload === b.requestPayload && a.responseDigest === b.responseDigest;
}

/** Canonical string key of an {@link ArenaIngestIdempotencyKey} (maps, logs). */
export function arenaIngestIdempotencyKeyText(key: ArenaIngestIdempotencyKey): string {
  return `${key.requestPayload}:${key.responseDigest}`;
}

// ---------------------------------------------------------------------------
// Ingest receipts and the settle oracle
// ---------------------------------------------------------------------------

/** The stored record of one effective ingest (owned by the Lab-side Arena runtime, PL-031). */
export type ArenaIngestReceipt = Readonly<{
  key: ArenaIngestIdempotencyKey;
  evidencePackage: ArenaEvidencePackage;
}>;

/** The disposition of one ingest attempt (house pattern: first receipt stands, collisions refused). */
export type ArenaIngestDisposition =
  | { readonly status: "ingested"; readonly receipt: ArenaIngestReceipt }
  | { readonly status: "duplicate-ingest"; readonly receipt: ArenaIngestReceipt }
  | { readonly status: "ingest-collision"; readonly key: ArenaIngestIdempotencyKey }
  | { readonly status: "not-ingestible" };

/** Structural equality of two {@link ArenaEvidencePackage}s (field-by-field, order-sensitive for arrays). */
export function arenaEvidencePackageEquals(a: ArenaEvidencePackage, b: ArenaEvidencePackage): boolean {
  return (
    a.packageKind === b.packageKind &&
    a.verdict === b.verdict &&
    a.requestPayload === b.requestPayload &&
    a.responseDigest === b.responseDigest &&
    a.respondent.endpointDigest === b.respondent.endpointDigest &&
    a.ingestedAt === b.ingestedAt &&
    a.reasons.length === b.reasons.length &&
    a.reasons.every((reason, index) => reason === b.reasons[index]) &&
    a.results.length === b.results.length &&
    a.results.every((record, index) => record.content === b.results[index]?.content) &&
    a.evidence.length === b.evidence.length &&
    a.evidence.every((record, index) =>
      record.evidence.length === b.evidence[index]?.evidence.length &&
      record.evidence.every((digest, digestIndex) => digest === b.evidence[index]?.evidence[digestIndex]),
    ) &&
    a.artifacts.length === b.artifacts.length &&
    a.artifacts.every((record, index) => record.artifact === b.artifacts[index]?.artifact && record.artifactClass === b.artifacts[index]?.artifactClass)
  );
}

/**
 * The pure ingest oracle: folds one raw Arena response against the request
 * envelope that produced it and the prior ingest receipt (if any).
 *
 * - raw value is not a structurally valid response envelope →
 *   `not-ingestible`: no key, no package — garbage has no trustworthy pins,
 *   so the caller logs it out-of-band instead of filing evidence;
 * - no prior receipt → `ingested`: the response is validated and a new
 *   evidence package (admitted or rejected, with reasons) is produced;
 * - prior receipt with the SAME key and a deep-equal package →
 *   `duplicate-ingest`: the FIRST package stands, nothing new is produced;
 * - prior receipt with the same key but a DIFFERENT package →
 *   `ingest-collision`: refused outright (E8), no package leaves the
 *   oracle, the prior receipt is not replaced.
 *
 * This function never mutates its inputs and never performs IO; the
 * caller-owned receipt store decides how dispositions are persisted.
 */
export function settleArenaIngest(
  prior: ArenaIngestReceipt | undefined,
  response: unknown,
  request: ArenaRequestEnvelope,
  now?: ArenaTimestampMs,
): ArenaIngestDisposition {
  if (!isArenaResponseEnvelope(response)) {
    return { status: "not-ingestible" };
  }
  const key = arenaIngestIdempotencyKey(response);
  if (prior !== undefined && arenaIngestIdempotencyKeyEquals(prior.key, key)) {
    const candidate = buildEvidencePackage(response, request, now);
    return arenaEvidencePackageEquals(prior.evidencePackage, candidate)
      ? { status: "duplicate-ingest", receipt: prior }
      : { status: "ingest-collision", key };
  }
  const evidencePackage = buildEvidencePackage(response, request, now);
  return { status: "ingested", receipt: { key, evidencePackage } };
}

/** Builds the evidence package for a structurally valid response envelope (validation decides the verdict). */
function buildEvidencePackage(
  response: ArenaResponseEnvelope,
  request: ArenaRequestEnvelope,
  now: ArenaTimestampMs | undefined,
): ArenaEvidencePackage {
  const validation = validateArenaResponse(response, request);
  if (validation.valid) {
    return Object.freeze({
      packageKind: ARENA_EVIDENCE_PACKAGE_KIND,
      verdict: "admitted",
      requestPayload: response.requestPayload,
      responseDigest: response.responseDigest,
      respondent: response.respondent,
      reasons: Object.freeze([] as readonly ArenaResponseRejectionReason[]),
      results: Object.freeze([...response.results]),
      evidence: Object.freeze([...response.evidence]),
      artifacts: Object.freeze([...response.artifacts]),
      ...(now === undefined ? {} : { ingestedAt: now }),
    });
  }
  return Object.freeze({
    packageKind: ARENA_EVIDENCE_PACKAGE_KIND,
    verdict: "rejected",
    requestPayload: response.requestPayload,
    responseDigest: response.responseDigest,
    respondent: response.respondent,
    reasons: Object.freeze([...validation.reasons]),
    results: Object.freeze([] as readonly ArenaResultPayload[]),
    evidence: Object.freeze([] as readonly ArenaEvidencePayload[]),
    artifacts: Object.freeze([] as readonly ArenaArtifactPayload[]),
    ...(now === undefined ? {} : { ingestedAt: now }),
  });
}
