/**
 * CONTENT-ADDRESSED IDENTITY HELPERS (PL-028).
 *
 * Digest discipline (one authority per concern): the SERIALIZATION
 * authority is package-system's `canonicalJson` (community/replay
 * precedent); this package hashes at its own seam with node:crypto
 * SHA-256 exactly like @playliquid/replay's record sealing. lab-contracts
 * `ContentDigest` values are the 64-hex form; the evaluation SLUG id is
 * the first 54 hex characters of the identity digest prefixed
 * `lab-eval-` (63-char slug-form, game-contracts id rules), while the
 * FULL 64-hex digest travels alongside on the intake record — identity
 * checks always use the full digest, the slug is the human-diffable key.
 *
 * Pure module: deterministic functions of their inputs; no IO beyond the
 * hash computation itself (same standing as replay/src/record.ts).
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "@playliquid/package-system";
import { encodeGameIRValue } from "@playliquid/simulation";
import type { JsonSafe } from "@playliquid/simulation";
import type { GameIRValue } from "@playliquid/game-ir";
import type { CandidateEvaluationId, ContentDigest } from "@playliquid/lab-contracts";
import { asCandidateEvaluationId, asContentDigest } from "@playliquid/lab-contracts";
import type { ProjectEvidenceRecord } from "@playliquid/lab-contracts";
import type { LabEvaluationRequest } from "./records.ts";

/** Domain-separation tag for lab evaluation identities. */
const EVALUATION_TAG = "playliquid:lab-simulation:evaluation:1";

/** Domain-separation tag for evidence bundle digests. */
const EVIDENCE_TAG = "playliquid:lab-simulation:evidence-bundle:1";

/**
 * Recursively strips `undefined`-valued keys and returns a plain
 * JSON-safe view (package-system canonicalJson REJECTS undefined values —
 * the community package documents the same discipline). Deterministic on
 * every path: optional keys appear only when present.
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
export function labDigestOf(value: unknown): ContentDigest {
  const form = canonicalJson(jsonSafeOf(value));
  const hex = createHash("sha256").update(form, "utf8").digest("hex");
  return asContentDigest(hex)!;
}

/**
 * The full identity digest of an evaluation request: everything that
 * determines the RESULT — tenant, cycle, the WHOLE organization
 * descriptor, suite pin, evidence bundle digest, seed, tick budget and
 * search context. `owner` and `requestedAt` are deliberately EXCLUDED:
 * they are bookkeeping, not evaluation content (a different owner
 * re-admitting the same content gets the E10 duplicate receipt).
 */
export function labEvaluationIdentityDigest(request: LabEvaluationRequest): ContentDigest {
  return labDigestOf({
    tag: EVALUATION_TAG,
    tenant: String(request.tenant),
    cycleId: String(request.cycleId),
    organization: request.organization,
    suite: {
      suiteId: String(request.suite.suiteId),
      irVersion: request.suite.irVersion,
      contentDigest: String(request.suite.contentDigest),
    },
    evidenceBundleDigest: String(request.evidence.declaredDigest),
    seed: String(request.parameters.seed),
    tickBudget: request.parameters.tickBudget,
    context: request.context,
  });
}

/**
 * The slug-form evaluation id (`lab-eval-<54 hex>`) every record carries.
 * 54 hex chars = 216 bits of the SHA-256 identity — collision resistance
 * far beyond Lab scale; the full digest is carried on the record and is
 * what identity verification uses.
 */
export function labEvaluationSlugId(digest: ContentDigest): CandidateEvaluationId {
  const slug = `lab-eval-${digest.slice(0, 54)}`;
  const parsed = asCandidateEvaluationId(slug);
  if (parsed === undefined) {
    // Canonical prefix + hex slice — unreachable by construction.
    throw new Error(`lab-simulation: derived slug id failed to parse: ${slug}`);
  }
  return parsed;
}

/**
 * The recomputed bundle digest of resolved evidence records: the canonical
 * digest of the sorted (evidenceId, kind, source, contentDigest, summary,
 * observedAt) tuples. A declared digest that differs is a tamper signal
 * and the intake oracle refuses it (E8).
 */
export function evidenceBundleDigestOf(records: readonly ProjectEvidenceRecord[]): ContentDigest {
  const tuples = [...records]
    .map((record) => ({
      evidenceId: String(record.evidenceId),
      kind: record.kind,
      source: record.source,
      contentDigest: String(record.contentDigest),
      summary: record.summary,
      observedAt: Number(record.observedAt),
    }))
    .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  return labDigestOf({ tag: EVIDENCE_TAG, records: tuples });
}

/** Sorts and de-duplicates evidence record id strings (deterministic). */
export function normalizeEvidenceIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort();
}

/** Structural view of anything whose `result.payload` readings carry kernel values. */
interface ReadingCarrier {
  readonly result: {
    readonly payload: readonly { readonly metricId: unknown; readonly value: GameIRValue }[];
  };
}

/**
 * Digest view of one reading-bearing record: identical except every kernel
 * reading value is replaced by its tagged JSON-safe form (simulation codec
 * — the same authority replay's artifacts use), because bigint ints are
 * NOT canonicalizable and the digest form of a GameIRValue is its encoded
 * form. Pure transform; never mutates the input.
 */
function readingSafeView(record: ReadingCarrier): unknown {
  const payload = record.result.payload.map((reading) => ({
    ...reading,
    value: encodeGameIRValue(reading.value) as JsonSafe,
  }));
  return { ...record, result: { ...record.result, payload } };
}

/**
 * The state digest of one service document: canonical JSON over the stored
 * evaluations (request + sealed intake + run + canonical evaluation — with
 * kernel reading values encoded) and the replay id list (E6).
 */
export function labServiceStateDigestOf(input: {
  readonly evaluations: readonly {
    readonly request: LabEvaluationRequest;
    readonly intake: unknown;
    readonly run?: ReadingCarrier;
    readonly evaluation?: ReadingCarrier;
  }[];
  readonly replayIds: readonly string[];
}): ContentDigest {
  return labDigestOf({
    evaluations: input.evaluations.map((stored) => ({
      request: stored.request,
      intake: stored.intake,
      run: stored.run === undefined ? undefined : readingSafeView(stored.run),
      evaluation: stored.evaluation === undefined ? undefined : readingSafeView(stored.evaluation),
    })),
    replayIds: input.replayIds,
  });
}
