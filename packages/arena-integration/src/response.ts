/**
 * ARENA RESPONSE CONTRACTS — the three declared return classes
 * (architecture.md §Arena; R18/E11; lock rule 32).
 *
 * "Arena returns validated: results; evidence; capability/tool/skill/
 * knowledge artifacts where explicitly authorized."
 *
 * Every payload record is content-addressed (caller-pinned digests in the
 * package-system wire shape) and provenance-marked with the shared
 * `"arena-external"` marker, so anything that entered PlayLiquid from the
 * Arena side is recognizable FOREVER — validated records, never authority
 * (E11). The response ENVELOPE correlates back to exactly one request
 * payload digest and one digest-pinned respondent endpoint.
 *
 * These are passive DATA records. They carry no commands, no effects and
 * no mutation surface: the only way their contents reach the Lab is through
 * the ingestion verdicts in `ingestion.ts`, which produce evidence
 * packages for the Lab's normal evidence path (lock: Arena cannot directly
 * mutate PlayLiquid live state — structural, see `no-mutation.test.ts`).
 *
 * Purity: no IO, no clock, no randomness.
 */

import { isArenaEndpointRef, isArenaExternalOriginMarker, isValidArenaContentDigest } from "./primitives.ts";
import type { ArenaContentDigest, ArenaEndpointRef, ArenaExternalOriginMarker } from "./primitives.ts";
import { isArenaArtifactClass } from "./authorization.ts";
import type { ArenaArtifactClass } from "./authorization.ts";

// ---------------------------------------------------------------------------
// Result payloads (baseline return class)
// ---------------------------------------------------------------------------

/** Structural kind marker of an {@link ArenaResultPayload}. */
export type ArenaResultRecordKind = "arena-result";

/** Marker value for {@link ArenaResultRecordKind}. */
export const ARENA_RESULT_RECORD_KIND: ArenaResultRecordKind = "arena-result";

/**
 * One Arena work product / answer, addressed by the content digest of its
 * canonical form. Results are the baseline return class (architecture.md
 * §Arena) and are not gated by artifact authorization scopes.
 */
export type ArenaResultPayload = Readonly<{
  recordKind: ArenaResultRecordKind;
  origin: ArenaExternalOriginMarker;
  content: ArenaContentDigest;
}>;

/** Returns true when `value` is structurally a valid {@link ArenaResultPayload}. */
export function isArenaResultPayload(value: unknown): value is ArenaResultPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.recordKind === ARENA_RESULT_RECORD_KIND &&
    isArenaExternalOriginMarker(record.origin) &&
    typeof record.content === "string" &&
    isValidArenaContentDigest(record.content)
  );
}

// ---------------------------------------------------------------------------
// Evidence payloads (baseline return class)
// ---------------------------------------------------------------------------

/** Structural kind marker of an {@link ArenaEvidencePayload}. */
export type ArenaEvidenceRecordKind = "arena-evidence";

/** Marker value for {@link ArenaEvidenceRecordKind}. */
export const ARENA_EVIDENCE_RECORD_KIND: ArenaEvidenceRecordKind = "arena-evidence";

/**
 * One evidence bundle returned by the Arena: a non-empty list of
 * content-addressed evidence artifacts, plus the content digests of the
 * RESULT payloads (within the same response) that this evidence
 * substantiates. `substantiates` may be empty — standalone evidence is
 * legitimate (e.g. an evidence-kind request) — but every non-empty entry
 * must resolve against the response's own result set (checked by the
 * response validator in `validate.ts`).
 */
export type ArenaEvidencePayload = Readonly<{
  recordKind: ArenaEvidenceRecordKind;
  origin: ArenaExternalOriginMarker;
  evidence: readonly ArenaContentDigest[];
  substantiates: readonly ArenaContentDigest[];
}>;

/** Returns true when `value` is structurally a valid {@link ArenaEvidencePayload}. */
export function isArenaEvidencePayload(value: unknown): value is ArenaEvidencePayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.recordKind !== ARENA_EVIDENCE_RECORD_KIND) return false;
  if (!isArenaExternalOriginMarker(record.origin)) return false;
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) return false;
  if (!Array.isArray(record.substantiates)) return false;
  for (const digest of record.evidence) {
    if (typeof digest !== "string" || !isValidArenaContentDigest(digest)) return false;
  }
  for (const digest of record.substantiates) {
    if (typeof digest !== "string" || !isValidArenaContentDigest(digest)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Artifact payloads (authorized return class)
// ---------------------------------------------------------------------------

/** Structural kind marker of an {@link ArenaArtifactPayload}. */
export type ArenaArtifactRecordKind = "arena-artifact";

/** Marker value for {@link ArenaArtifactRecordKind}. */
export const ARENA_ARTIFACT_RECORD_KIND: ArenaArtifactRecordKind = "arena-artifact";

/**
 * One Arena-returned artifact of a declared class (capability / tool /
 * skill / knowledge), addressed by a digest-pinned reference to the
 * artifact package. Artifacts are the ONLY gated return class: the
 * response validator refuses any artifact whose class is not explicitly
 * authorized by the request's scope ("artifacts returned only where
 * explicitly authorized").
 *
 * The artifact reference is deliberately opaque: package identity,
 * provenance and licensing flow through the package system's own gates
 * (provenance/licensing is a release/build gate — lock rule 11); this
 * contract only pins WHAT came back and FROM WHERE.
 */
export type ArenaArtifactPayload = Readonly<{
  recordKind: ArenaArtifactRecordKind;
  origin: ArenaExternalOriginMarker;
  artifactClass: ArenaArtifactClass;
  artifact: ArenaContentDigest;
}>;

/** Returns true when `value` is structurally a valid {@link ArenaArtifactPayload}. */
export function isArenaArtifactPayload(value: unknown): value is ArenaArtifactPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.recordKind === ARENA_ARTIFACT_RECORD_KIND &&
    isArenaExternalOriginMarker(record.origin) &&
    isArenaArtifactClass(record.artifactClass) &&
    typeof record.artifact === "string" &&
    isValidArenaContentDigest(record.artifact)
  );
}

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

/** Structural kind marker of an {@link ArenaResponseEnvelope}. */
export type ArenaResponseEnvelopeKind = "arena-response";

/** Marker value for {@link ArenaResponseEnvelopeKind}. */
export const ARENA_RESPONSE_ENVELOPE_KIND: ArenaResponseEnvelopeKind = "arena-response";

/**
 * The typed envelope for everything one Arena response carries. The
 * envelope is itself content-addressed via the caller-pinned
 * `responseDigest`, correlates to exactly one request payload digest, and
 * names the digest-pinned endpoint that responded.
 */
export type ArenaResponseEnvelope = Readonly<{
  envelopeKind: ArenaResponseEnvelopeKind;
  requestPayload: ArenaContentDigest;
  respondent: ArenaEndpointRef;
  results: readonly ArenaResultPayload[];
  evidence: readonly ArenaEvidencePayload[];
  artifacts: readonly ArenaArtifactPayload[];
  responseDigest: ArenaContentDigest;
}>;

/** Returns true when `value` is structurally a valid {@link ArenaResponseEnvelope}. */
export function isArenaResponseEnvelope(value: unknown): value is ArenaResponseEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.envelopeKind !== ARENA_RESPONSE_ENVELOPE_KIND) return false;
  if (typeof envelope.requestPayload !== "string" || !isValidArenaContentDigest(envelope.requestPayload)) return false;
  if (!isArenaEndpointRef(envelope.respondent)) return false;
  if (typeof envelope.responseDigest !== "string" || !isValidArenaContentDigest(envelope.responseDigest)) return false;
  if (!Array.isArray(envelope.results) || !Array.isArray(envelope.evidence) || !Array.isArray(envelope.artifacts)) {
    return false;
  }
  for (const record of envelope.results) {
    if (!isArenaResultPayload(record)) return false;
  }
  for (const record of envelope.evidence) {
    if (!isArenaEvidencePayload(record)) return false;
  }
  for (const record of envelope.artifacts) {
    if (!isArenaArtifactPayload(record)) return false;
  }
  return true;
}

/** The content digests of every result payload in `envelope` (evidence-linkage resolution set). */
export function arenaResponseResultContents(envelope: ArenaResponseEnvelope): readonly ArenaContentDigest[] {
  return envelope.results.map((record) => record.content);
}
