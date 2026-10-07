/**
 * REPLAY PROVENANCE LINKAGE CONTRACTS (R8 refinement, PL-009).
 *
 * Replay records reference the AUTHORITATIVE runtime/session records by
 * digest — they never re-declare session state. Standings, scores and
 * every other session fact stay owned by their authoritative records
 * (multiplayer.ts / runtime-contracts); a
 * {@link ReplayProvenanceLink} pins, by content digest, WHICH
 * authoritative records the replay was captured from.
 *
 * {@link provenanceMatchesDescriptor} is the pure coherence check
 * against the canonical {@link ReplayArtifactDescriptor}: the link must
 * pin the same artifact digest, the same tenant, and — when either side
 * names a session — the SAME session. A link claiming a session (or
 * digest) the canonical record does not carry is a mismatch, never a
 * silent merge of two truths (E1: one owner per session fact).
 *
 * Purity: pure types + pure guards + one pure coherence check. No IO.
 */

import type { ContentDigest, TenantId } from "./primitives.ts";
import { isValidContentDigest } from "./primitives.ts";
import type { MatchSessionId } from "./multiplayer.ts";
import type { ReplayId, ReplayArtifactDescriptor } from "./replay.ts";

/**
 * Digest-pinned linkage from one replay artifact to the authoritative
 * records it was captured from. Reference-only: no session state is
 * re-declared here — digests point at the authoritative content.
 */
export interface ReplayProvenanceLink {
  readonly replayId: ReplayId;
  /** Pins the replay artifact CONTENT (equals the descriptor's digest). */
  readonly replayDigest: ContentDigest;
  readonly tenant: TenantId;
  /** The session, if any — reference only, must cohere with the descriptor. */
  readonly session?: MatchSessionId;
  /** Digest of the authoritative SESSION record. */
  readonly sessionRecordDigest: ContentDigest;
  /** Digest of the authoritative RUNTIME record the capture ran under. */
  readonly runtimeRecordDigest: ContentDigest;
  /** Digest of the capture policy in force when the artifact was sealed. */
  readonly capturePolicyDigest: ContentDigest;
}

/** Returns true when `value` is a structurally valid {@link ReplayProvenanceLink}. */
export function isReplayProvenanceLink(value: unknown): value is ReplayProvenanceLink {
  if (typeof value !== "object" || value === null) return false;
  const link = value as Record<string, unknown>;
  if (typeof link.replayId !== "string" || link.replayId.length === 0) return false;
  if (typeof link.replayDigest !== "string" || !isValidContentDigest(link.replayDigest)) return false;
  if (typeof link.sessionRecordDigest !== "string" || !isValidContentDigest(link.sessionRecordDigest)) {
    return false;
  }
  if (typeof link.runtimeRecordDigest !== "string" || !isValidContentDigest(link.runtimeRecordDigest)) {
    return false;
  }
  if (typeof link.capturePolicyDigest !== "string" || !isValidContentDigest(link.capturePolicyDigest)) {
    return false;
  }
  if (link.session !== undefined && (typeof link.session !== "string" || link.session.length === 0)) {
    return false;
  }
  return true;
}

/**
 * Pure coherence check against the canonical descriptor. The link is
 * coherent iff it pins the SAME artifact (replay id + content digest),
 * the SAME tenant, and a session reference that agrees with the
 * descriptor's (both undefined, or equal). Anything else is a mismatch:
 * provenance may never quietly re-scope an artifact to another session,
 * tenant or content revision.
 */
export function provenanceMatchesDescriptor(
  link: ReplayProvenanceLink,
  descriptor: ReplayArtifactDescriptor,
): boolean {
  if (link.replayId !== descriptor.replayId) return false;
  if (link.replayDigest !== descriptor.digest) return false;
  if (link.tenant !== descriptor.tenant) return false;
  return link.session === descriptor.session;
}

/**
 * Pure resolution of the authoritative-record digests a link pins, as a
 * stable, digest-only tuple — the reference shape downstream consumers
 * (integrity evidence, QA assertions) cite. Pure projection; the link
 * itself is unchanged.
 */
export function authoritativeRecordRefs(link: ReplayProvenanceLink): {
  readonly sessionRecordDigest: ContentDigest;
  readonly runtimeRecordDigest: ContentDigest;
  readonly capturePolicyDigest: ContentDigest;
} {
  return {
    sessionRecordDigest: link.sessionRecordDigest,
    runtimeRecordDigest: link.runtimeRecordDigest,
    capturePolicyDigest: link.capturePolicyDigest,
  };
}
