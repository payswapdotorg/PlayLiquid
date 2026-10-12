/**
 * CONTENT-ADDRESSED IDENTITY HELPERS (PL-029).
 *
 * Digest discipline (one authority per concern — the lab-simulation
 * precedent): the SERIALIZATION authority is package-system's
 * `canonicalJson` (community/lab-simulation/replay precedent); this
 * package hashes at its own seam with node:crypto SHA-256. lab-contracts
 * `ContentDigest` is the 64-hex form. Slug ids are prefix + hex slice and
 * always fit the game-contracts 63-char id-text pattern:
 * - search id: `lab-search-<52 hex>` (63 chars);
 * - baseline organization id: `org-base-<54 hex>` (63 chars);
 * - candidate organization id: `org-cand-<54 hex>` (63 chars);
 * - gap record id: `gap-<54 hex>` (59 chars).
 *
 * Determinism (E9): every digest here is a pure function of its input
 * content. No IO beyond the hash computation itself (same standing as
 * lab-simulation/src/digest.ts).
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "@playliquid/package-system";
import type {
  CandidateEvaluationId,
  ContentDigest,
  GapRecordId,
  OrganizationId,
} from "@playliquid/lab-contracts";
import {
  asCandidateEvaluationId,
  asContentDigest,
  asGapRecordId,
  asOrganizationId,
} from "@playliquid/lab-contracts";

/** Domain-separation tag for search identities. */
const SEARCH_TAG = "playliquid:lab-organization:search:1";

/** Domain-separation tag for candidate organization content. */
const CANDIDATE_TAG = "playliquid:lab-organization:candidate:1";

/** Domain-separation tag for evaluation content keys. */
const EVALUATION_TAG = "playliquid:lab-organization:evaluation-key:1";

/** Domain-separation tag for capability-gap findings. */
const GAP_TAG = "playliquid:lab-organization:gap:1";

/**
 * Recursively strips `undefined`-valued keys (package-system canonicalJson
 * REJECTS undefined values — the lab-simulation discipline). Deterministic
 * on every path: optional keys appear only when present.
 */
export function jsonSafeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => jsonSafeOf(item));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) continue;
    out[key] = jsonSafeOf(nested);
  }
  return out;
}

/** sha256 hex (64 chars) over the canonical JSON of `value`. */
export function organizationDigestOf(value: unknown): ContentDigest {
  const form = canonicalJson(jsonSafeOf(value));
  const hex = createHash("sha256").update(form, "utf8").digest("hex");
  return asContentDigest(hex)!;
}

/**
 * The identity digest of a search request: everything that determines the
 * search SESSION — tenant, cycle, objective context, seed, canonical
 * catalogs/bounds, the current organization (the gap-ladder rung-1 anchor)
 * and the host restriction (the R5 body-projection input the session's
 * evaluations use). `owner` and `requestedAt` are bookkeeping and
 * deliberately EXCLUDED (a different owner re-opening the same content
 * resumes the same session; lab-simulation's identity discipline).
 */
export function searchIdentityDigest(input: {
  readonly tenant: string;
  readonly cycleId: string;
  readonly context: unknown;
  readonly seed: string;
  readonly bounds: unknown;
  readonly currentOrganization?: unknown;
  readonly restriction?: unknown;
}): ContentDigest {
  return organizationDigestOf({
    tag: SEARCH_TAG,
    tenant: input.tenant,
    cycleId: input.cycleId,
    context: input.context,
    seed: input.seed,
    bounds: input.bounds,
    currentOrganization: input.currentOrganization,
    restriction: input.restriction,
  });
}

/** The search session slug id (`lab-search-<52 hex>`, 63 chars). */
export function searchSlugId(digest: ContentDigest): string {
  return `lab-search-${digest.slice(0, 52)}`;
}

/** The candidate organization content digest (over the descriptor). */
export function candidateDigestOf(organization: unknown): ContentDigest {
  return organizationDigestOf({ tag: CANDIDATE_TAG, organization });
}

/** Parses a hex-slice organization id (`org-base-…`/`org-cand-…`). */
export function asSlugOrganizationId(text: string): OrganizationId | undefined {
  return asOrganizationId(text);
}

/** The baseline organization slug id (`org-base-<54 hex>`). */
export function baselineOrganizationId(digest: ContentDigest): OrganizationId {
  return asOrganizationId(`org-base-${digest.slice(0, 54)}`)!;
}

/** The candidate organization slug id (`org-cand-<54 hex>`). */
export function candidateOrganizationId(digest: ContentDigest): OrganizationId {
  return asOrganizationId(`org-cand-${digest.slice(0, 54)}`)!;
}

/**
 * The evaluation CONTENT KEY: everything that determines the recorded
 * outcome — tenant, cycle, candidate content, suite pin, evidence bundle
 * digest, seed, tick budget and objective context (the lab-simulation
 * identity discipline, keyed here by candidate digest). Identical key ⇒
 * the recorded outcome is replayed, never recomputed (E10).
 */
export function evaluationContentKeyOf(input: {
  readonly tenant: string;
  readonly cycleId: string;
  readonly candidateDigest: ContentDigest;
  readonly suite: unknown;
  readonly evidenceBundleDigest: string;
  readonly seed: string;
  readonly tickBudget: number;
  readonly context: unknown;
}): ContentDigest {
  return organizationDigestOf({
    tag: EVALUATION_TAG,
    tenant: input.tenant,
    cycleId: input.cycleId,
    candidateDigest: input.candidateDigest,
    suite: input.suite,
    evidenceBundleDigest: input.evidenceBundleDigest,
    seed: input.seed,
    tickBudget: input.tickBudget,
    context: input.context,
  });
}

/** Parses the gap record slug id (`gap-<54 hex>`). */
export function asGapSlugId(text: string): GapRecordId | undefined {
  return asGapRecordId(text);
}

/** The capability-gap record slug id (`gap-<54 hex>`). */
export function gapSlugId(digest: ContentDigest): GapRecordId {
  return asGapRecordId(`gap-${digest.slice(0, 54)}`)!;
}

/** The gap-finding content digest (dedupe key of recorded findings). */
export function gapFindingDigestOf(input: {
  readonly tenant: string;
  readonly missingCapability: string;
  readonly candidateDigest: ContentDigest;
}): ContentDigest {
  return organizationDigestOf({
    tag: GAP_TAG,
    tenant: input.tenant,
    missingCapability: input.missingCapability,
    candidateDigest: input.candidateDigest,
  });
}

/** Parses a candidate-evaluation id (read paths). */
export function asEvaluationSlugId(text: string): CandidateEvaluationId | undefined {
  return asCandidateEvaluationId(text);
}
