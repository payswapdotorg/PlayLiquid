/**
 * CONTENT-ADDRESSED IDENTITY HELPERS (PL-031).
 *
 * Digest discipline (one authority per concern — the lab-organization /
 * lab-simulation precedent): the SERIALIZATION authority is package-system's
 * `canonicalJson`; this package hashes at its own seam with node:crypto
 * SHA-256. lab-contracts `ContentDigest` is the 64-hex bare form;
 * arena-integration `ArenaContentDigest` is the package-system wire form
 * `sha256:<64 hex>`. The two FORMS are bridged here (the pending PL-007 ACR
 * re-parenting made concrete) — no third digest shape exists in this package.
 *
 * Slug ids are `<prefix>-<52 hex>` slices and always fit the game-contracts
 * 63-char id-text pattern:
 * - escalation case id: `arena-case-<52 hex>` (62 chars);
 * - external escalation handle: `arena-esc-<52 hex>` (62 chars);
 * - escalation source key: `arena-src-<52 hex>` (62 chars).
 *
 * Determinism (E9): every digest here is a pure function of its input
 * content. No IO beyond the hash computation itself (same standing as
 * lab-organization/src/digest.ts).
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "@playliquid/package-system";
import type { ArenaContentDigest } from "@playliquid/arena-integration";
import { isValidArenaContentDigest } from "@playliquid/arena-integration";
import type { ContentDigest, TimestampMs } from "@playliquid/lab-contracts";
import { asContentDigest, asTimestampMs, isValidContentDigest } from "@playliquid/lab-contracts";
import type { ArenaCaseId, ArenaSourceKey } from "./primitives.ts";
import { asArenaCaseId, asArenaSourceKey } from "./primitives.ts";

/** Domain-separation tag for escalation-case identity content. */
const CASE_TAG = "playliquid:arena-runtime:case:1";

/** Domain-separation tag for the case CONTENT KEY (the idempotency key digest). */
const CASE_KEY_TAG = "playliquid:arena-runtime:case-key:1";

/** Domain-separation tag for the response-envelope digest pin. */
const RESPONSE_TAG = "playliquid:arena-runtime:response:1";

/** Domain-separation tag for host decision records. */
const DECISION_TAG = "playliquid:arena-runtime:decision:1";

/** Domain-separation tag for audit-record content. */
const AUDIT_TAG = "playliquid:arena-runtime:audit:1";

/** Domain-separation tag for registered escalation sources. */
const SOURCE_TAG = "playliquid:arena-runtime:source:1";

/** Domain-separation tag for the whole service document. */
const DOCUMENT_TAG = "playliquid:arena-runtime:document:1";

/**
 * Recursively strips `undefined`-valued keys (package-system canonicalJson
 * REJECTS undefined values — the lab-simulation/lab-organization
 * discipline). Deterministic on every path: optional keys appear only when
 * present.
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

/** sha256 hex (64 chars, bare lab-contracts form) over the canonical JSON of `value`. */
export function runtimeDigestOf(value: unknown): ContentDigest {
  const form = canonicalJson(jsonSafeOf(value));
  const hex = createHash("sha256").update(form, "utf8").digest("hex");
  return asContentDigest(hex)!;
}

/** sha256 hex (64 chars, bare lab-contracts form) over the canonical JSON of `value` with a domain tag. */
function taggedDigestOf(tag: string, value: unknown): ContentDigest {
  return runtimeDigestOf({ tag, value });
}

// ---------------------------------------------------------------------------
// Digest FORM bridging (arena-integration `sha256:<hex>` <-> lab-contracts hex)
// ---------------------------------------------------------------------------

/** The arena-integration wire form (`sha256:<hex>`) of a lab-contracts digest. */
export function arenaDigestOf(digest: ContentDigest): ArenaContentDigest | undefined {
  return isValidContentDigest(digest) ? (`sha256:${digest}` as ArenaContentDigest) : undefined;
}

/** The lab-contracts bare-hex form of an arena-integration wire digest. */
export function contentDigestOf(digest: ArenaContentDigest | string): ContentDigest | undefined {
  if (typeof digest !== "string" || !digest.startsWith("sha256:")) return undefined;
  const bare = digest.slice("sha256:".length);
  return isValidContentDigest(bare) ? (bare as ContentDigest) : undefined;
}

// ---------------------------------------------------------------------------
// Slug ids
// ---------------------------------------------------------------------------

/** The escalation case slug id (`arena-case-<52 hex>`). */
export function arenaCaseIdOf(digest: ContentDigest): ArenaCaseId {
  return asArenaCaseId(`arena-case-${digest.slice(0, 52)}`)!;
}

/** The external escalation handle slug (`arena-esc-<52 hex>`). */
export function arenaEscalationHandleOf(digest: ContentDigest): string {
  return `arena-esc-${digest.slice(0, 52)}`;
}

/** The escalation source key slug (`arena-src-<52 hex>`). */
export function arenaSourceKeyOf(digest: ContentDigest): ArenaSourceKey {
  return asArenaSourceKey(`arena-src-${digest.slice(0, 52)}`)!;
}

// ---------------------------------------------------------------------------
// Identity digests + tamper oracles
// ---------------------------------------------------------------------------

/** The immutable identity content a case's digest pins (evolving orchestration state excluded). */
export interface ArenaCaseIdentityContent {
  readonly caseId: string;
  readonly tenant: string;
  readonly sourceKey: string;
  readonly sourceKind: string;
  readonly request: unknown;
  readonly openedAt: number;
}

/** The content-addressed identity digest of a case's IMMUTABLE content. */
export function arenaCaseDigestOf(content: ArenaCaseIdentityContent): ContentDigest {
  return taggedDigestOf(CASE_TAG, content);
}

/** The content-addressed identity digest of a case's IMMUTABLE content (input form). */
export interface ArenaCaseKeyContent {
  readonly tenant: string;
  readonly sourceKey: string;
  readonly requestKind: string;
  readonly requestPayload: string;
  readonly endpointDigest: string;
  readonly authorizationKey: string;
}

/**
 * The CONTENT KEY digest of an escalation: everything that determines WHICH
 * escalation this is (tenant, source, ask, endpoint, kind, authorization
 * scope). Decision bookkeeping (decidedBy/decidedAt) is deliberately EXCLUDED
 * — a re-run of the same decided content resumes the SAME case (E6, the
 * lab-organization search-identity discipline). Case ids and external
 * escalation handles derive from this digest.
 */
export function arenaCaseKeyDigestOf(content: ArenaCaseKeyContent): ContentDigest {
  return taggedDigestOf(CASE_KEY_TAG, content);
}

/** The content-addressed digest of a host's escalation-decision record. */
export function arenaDecisionDigestOf(content: {
  readonly tenant: string;
  readonly decidedBy: string;
  readonly decidedAt: number;
  readonly sourceKey: string;
  readonly requestKind: string;
  readonly requestPayload: string;
  readonly endpointDigest: string;
  readonly authorizationKey: string;
}): ContentDigest {
  return taggedDigestOf(DECISION_TAG, content);
}

/** The content-addressed digest of one audit-tracked authorization decision. */
export function arenaAuditRecordDigestOf(content: Record<string, unknown>): ContentDigest {
  return taggedDigestOf(AUDIT_TAG, content);
}

/** The identity digest of a registered escalation source (per-kind content). */
export function arenaSourceDigestOf(content: unknown): ContentDigest {
  return taggedDigestOf(SOURCE_TAG, content);
}

/** The state digest of the whole service document (persistence view, E6). */
export function arenaDocumentDigestOf(content: unknown): ContentDigest {
  return taggedDigestOf(DOCUMENT_TAG, content);
}

/**
 * Computes the canonical response digest of a response envelope's content
 * (every field EXCEPT the declared `responseDigest` itself) in the
 * arena-integration wire form. The runtime's PINNED RULE: the responseDigest
 * of every response this runtime accepts is this value.
 */
export function arenaResponseDigestOf(content: {
  readonly envelopeKind: string;
  readonly requestPayload: string;
  readonly respondent: unknown;
  readonly results: readonly unknown[];
  readonly evidence: readonly unknown[];
  readonly artifacts: readonly unknown[];
}): ArenaContentDigest {
  return `sha256:${taggedDigestOf(RESPONSE_TAG, content)}` as ArenaContentDigest;
}

/**
 * The response-envelope TAMPER ORACLE (E8): recomputes the canonical digest
 * of the response's content (EVERY own field EXCEPT the declared
 * `responseDigest` itself — including any field this type does not name, so
 * smuggled content breaks the pin too) and compares it with the declared
 * digest.
 *
 * This is the pin arena-integration deliberately could not implement (no
 * digest authority at its PL-007 base) and the runtime now owns. Host-side
 * providers adopt the same rule; a mismatch is a typed
 * tampered-response-digest refusal and NOTHING from the response is ingested.
 */
export function arenaResponseDigestMatches(response: {
  readonly envelopeKind: string;
  readonly requestPayload: string;
  readonly respondent: unknown;
  readonly results: readonly unknown[];
  readonly evidence: readonly unknown[];
  readonly artifacts: readonly unknown[];
  readonly responseDigest: string;
}): boolean {
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response)) {
    if (key === "responseDigest") continue;
    content[key] = value;
  }
  return (
    arenaResponseDigestOf(content as Parameters<typeof arenaResponseDigestOf>[0]) === response.responseDigest
  );
}

/** Nominal re-validation of a caller-supplied timestamp (whole milliseconds). */
export function validTimestamp(value: number): TimestampMs | undefined {
  return asTimestampMs(value);
}

/** Structural check: `value` is a well-formed lab-contracts content digest. */
export function isContentDigestValue(value: unknown): value is ContentDigest {
  return typeof value === "string" && isValidContentDigest(value);
}

/** Structural check: `value` is a well-formed arena-integration wire digest. */
export function isArenaDigestValue(value: unknown): value is ArenaContentDigest {
  return typeof value === "string" && isValidArenaContentDigest(value);
}
