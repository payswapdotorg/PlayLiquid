/**
 * CONTENT-ADDRESSED IDENTITY HELPERS (PL-044) — the deployment tree's own
 * digest seam.
 *
 * Digest discipline (one authority per concern — the services/ops
 * precedent): the SERIALIZATION authority is package-system's
 * `canonicalJson`; this tree hashes at its own seam with node:crypto
 * SHA-256 over domain-separated tags. Deployment plans, seals and journal
 * entries are content-addressed here; ARTIFACT digests are NOT minted
 * here — they are PL-011 package-registry/artifact-store content digests
 * (`sha256:<64 hex>`, package-system's `ContentDigest` wire format),
 * consumed and verified, never re-implemented.
 *
 * Determinism (E9): every digest here is a pure function of its input
 * content. No IO beyond the hash computation, no clock, no randomness.
 */

import { createHash } from "node:crypto";
import { canonicalJson, isContentDigest } from "../../packages/package-system/src/index.ts";

/** Domain-separation tag: the deployment plan identity content. */
const PLAN_TAG = "playliquid:deployment:plan:1";

/** Domain-separation tag: the verified-plan seal. */
const SEAL_TAG = "playliquid:deployment:seal:1";

/** Domain-separation tag: deployment-journal entry content. */
const JOURNAL_TAG = "playliquid:deployment:journal:1";

/** Domain-separation tag: the whole deployment manifest document. */
const MANIFEST_TAG = "playliquid:deployment:manifest:1";

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

/** sha256 hex (64 chars, bare) over the canonical JSON of `value`. */
export function deployDigestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(jsonSafeOf(value)), "utf8").digest("hex");
}

/** Domain-separated sha256 hex over the canonical JSON of `{ tag, value }`. */
export function taggedDigestOf(tag: string, value: unknown): string {
  return deployDigestOf({ tag, value });
}

/** Structural check: a bare 64-hex digest (this seam's local format). */
export function isSealDigestHex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Structural check: a PL-011 artifact content digest
 * (`sha256:<64 hex>`, package-system's `ContentDigest`). Re-exported from
 * the authority — never re-implemented.
 */
export { isContentDigest };

/** The identity digest of a deployment plan's canonical content (E9). */
export function deployPlanDigestOf(planContent: unknown): string {
  return taggedDigestOf(PLAN_TAG, planContent);
}

/** The seal digest of one verified plan at one instant (E9). */
export function deploySealDigestOf(sealContent: unknown): string {
  return taggedDigestOf(SEAL_TAG, sealContent);
}

/** The chained digest of one deployment-journal entry's content. */
export function deployJournalEntryDigestOf(content: unknown): string {
  return taggedDigestOf(JOURNAL_TAG, content);
}

/** The content digest of a whole deployment manifest document. */
export function deployManifestDigestOf(content: unknown): string {
  return taggedDigestOf(MANIFEST_TAG, content);
}
