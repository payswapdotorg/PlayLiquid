/**
 * CONTENT-ADDRESSED IDENTITY HELPERS (PL-044) — services/ops own digest
 * seam.
 *
 * Digest discipline (one authority per concern — the
 * arena-integration-runtime precedent generalized): the SERIALIZATION
 * authority is package-system's `canonicalJson`; this tree hashes at its
 * own seam with node:crypto SHA-256 over domain-separated tags. Digests
 * are 64-hex bare strings. Slug ids are `<prefix>-<52 hex>` slices.
 *
 * Determinism (E9): every digest here is a pure function of its input
 * content. No IO beyond the hash computation, no clock, no randomness.
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "../../../packages/package-system/src/index.ts";

/** Domain-separation tag: work-item identity content. */
const WORK_TAG = "playliquid:ops:work:1";

/** Domain-separation tag: the work CONTENT KEY (the idempotency digest). */
const WORK_KEY_TAG = "playliquid:ops:work-key:1";

/** Domain-separation tag: lease identity. */
const LEASE_TAG = "playliquid:ops:lease:1";

/** Domain-separation tag: effect-key identity (the executor dedupe key). */
const EFFECT_KEY_TAG = "playliquid:ops:effect-key:1";

/** Domain-separation tag: journal-entry content. */
const JOURNAL_TAG = "playliquid:ops:journal:1";

/** Domain-separation tag: the whole worker service document. */
const WORKER_DOCUMENT_TAG = "playliquid:ops:worker-document:1";

/** Domain-separation tag: web host composition documents. */
const WEB_HOST_TAG = "playliquid:ops:web-host:1";

/**
 * Recursively strips `undefined`-valued keys (package-system canonicalJson
 * REJECTS undefined values — the arena-integration-runtime discipline).
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

/** Total structural check: canonical JSON of `value` is computable. */
export function isJsonSafe(value: unknown): boolean {
  if (value === undefined || typeof value === "function") return false;
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (typeof value !== "object" || value === null) return true;
  return Object.values(value as Record<string, unknown>).every(isJsonSafe);
}

/** sha256 hex (64 chars) over the canonical JSON of `value`. */
export function opsDigestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(jsonSafeOf(value)), "utf8").digest("hex");
}

/** Domain-separated sha256 hex over the canonical JSON of `{ tag, value }`. */
export function taggedDigestOf(tag: string, value: unknown): string {
  return opsDigestOf({ tag, value });
}

/** Structural check: a 64-hex bare digest. */
export function isDigestHex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** The work-item slug id (`ops-work-<52 hex>`). */
export function opsWorkIdOf(digest: string): string {
  return `ops-work-${digest.slice(0, 52)}`;
}

/** The lease slug id (`ops-lease-<52 hex>`). */
export function opsLeaseIdOf(digest: string): string {
  return `ops-lease-${digest.slice(0, 52)}`;
}

/** The effect-key digest of one logical work effect (executor dedupe key). */
export function opsEffectKeyOf(content: {
  readonly workId: string;
  readonly effectKind: string;
  readonly payloadDigest: string;
}): string {
  return taggedDigestOf(EFFECT_KEY_TAG, content);
}

/** The identity digest of a work item's IMMUTABLE content. */
export function opsWorkDigestOf(content: {
  readonly tenant: string;
  readonly enqueuedBy: string;
  readonly kind: string;
  readonly effectKind: string;
  readonly payload: unknown;
  readonly payloadDigest: string;
  readonly enqueuedAt: number;
}): string {
  return taggedDigestOf(WORK_TAG, content);
}

/**
 * The CONTENT KEY digest of a work submission: everything that determines
 * WHICH work this is (tenant, kind, effect kind, payload). Bookkeeping
 * (enqueuedBy, enqueuedAt) is deliberately EXCLUDED from the KEY — a
 * re-submission of the same content resumes the SAME work item (E6/E10,
 * the arena case-key discipline), while the immutable identity digest pins
 * the full admission record.
 */
export function opsWorkKeyOf(content: {
  readonly tenant: string;
  readonly kind: string;
  readonly effectKind: string;
  readonly payload: unknown;
}): string {
  return taggedDigestOf(WORK_KEY_TAG, content);
}

/** The identity digest of a lease (worker + work + instant). */
export function opsLeaseDigestOf(content: {
  readonly workId: string;
  readonly workerId: string;
  readonly leasedAt: number;
  readonly attempt: number;
}): string {
  return taggedDigestOf(LEASE_TAG, content);
}

/** The chained digest of one journal entry's content. */
export function opsJournalEntryDigestOf(content: unknown): string {
  return taggedDigestOf(JOURNAL_TAG, content);
}

/** The state digest of the whole worker service document (persistence view). */
export function opsWorkerDocumentDigestOf(content: unknown): string {
  return taggedDigestOf(WORKER_DOCUMENT_TAG, content);
}

/** The content digest of a web host composition document. */
export function opsWebHostDigestOf(content: unknown): string {
  return taggedDigestOf(WEB_HOST_TAG, content);
}
