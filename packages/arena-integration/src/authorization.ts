/**
 * ARENA AUTHORIZATION VOCABULARY (architecture.md §Arena; lock rules 6, 32).
 *
 * "Arena returns validated: results; evidence; capability/tool/skill/
 * knowledge artifacts WHERE EXPLICITLY AUTHORIZED."
 *
 * This module owns the frozen artifact-class vocabulary, the authorization
 * scopes that gate artifact return, and the append-only audit trail of
 * authorization decisions. Authorization here is about WHAT MAY CROSS THE
 * ARENA BOUNDARY — it is not the runtime Capability Broker permission
 * system (that authority belongs to packages/capability-broker, PL-026;
 * this package must not duplicate it).
 *
 * Purity: no IO, no clock, no randomness. Audit records are content-addressed
 * by caller-supplied digests; this module shape-validates them and checks
 * chain linkage structurally, but never computes digests (canonical
 * serialization authority is package-system, reached via the lab-contracts
 * seam — see the ACR note in `src/index.ts`).
 */

import { frozenVocabulary } from "./primitives.ts";
import { isArenaEndpointRef, isValidArenaContentDigest } from "./primitives.ts";
import type { ArenaContentDigest, ArenaEndpointRef, ArenaTimestampMs } from "./primitives.ts";
import type { Brand } from "@playliquid/game-contracts";

// ---------------------------------------------------------------------------
// Artifact classes (frozen — architecture.md §Arena return classes)
// ---------------------------------------------------------------------------

/**
 * The frozen vocabulary of Arena artifact classes. The set is closed:
 * extending it is a breaking contract change that requires an Architecture
 * Change Request, not a silent edit inside an implementation Work Order.
 */
export type ArenaArtifactClass = "capability" | "tool" | "skill" | "knowledge";

/** All valid {@link ArenaArtifactClass} values. */
export const ARENA_ARTIFACT_CLASSES = frozenVocabulary<ArenaArtifactClass>("arena-artifact-class", [
  "capability",
  "tool",
  "skill",
  "knowledge",
]);

/** Returns true when `value` is a valid {@link ArenaArtifactClass}. */
export function isArenaArtifactClass(value: unknown): value is ArenaArtifactClass {
  return ARENA_ARTIFACT_CLASSES.is(value);
}

// ---------------------------------------------------------------------------
// Authorization scopes (artifact return gates)
// ---------------------------------------------------------------------------

/** Structural kind marker of an {@link ArenaAuthorizationScope}. */
export type ArenaAuthorizationScopeKind = "arena-authorization-scope";

/** Marker value for {@link ArenaAuthorizationScopeKind}. */
export const ARENA_AUTHORIZATION_SCOPE_KIND: ArenaAuthorizationScopeKind = "arena-authorization-scope";

/**
 * The explicit authorization carried by an escalation request: WHICH Arena
 * artifact classes may be returned. The set is allow-list only — an empty
 * list authorizes NO artifact return, which is the default posture.
 * Results and evidence are baseline return classes (architecture.md §Arena)
 * and are not gated by this scope.
 */
export type ArenaAuthorizationScope = Readonly<{
  scopeKind: ArenaAuthorizationScopeKind;
  artifactClasses: readonly ArenaArtifactClass[];
}>;

/**
 * The default (most restrictive) scope: NO artifact return authorized.
 * Frozen: callers must never mutate it, only derive new scopes.
 */
export const ARENA_NO_ARTIFACTS_SCOPE: ArenaAuthorizationScope = Object.freeze({
  scopeKind: ARENA_AUTHORIZATION_SCOPE_KIND,
  artifactClasses: Object.freeze([] as readonly ArenaArtifactClass[]),
});

/** Returns true when `value` is structurally a valid {@link ArenaAuthorizationScope}. */
export function isArenaAuthorizationScope(value: unknown): value is ArenaAuthorizationScope {
  if (typeof value !== "object" || value === null) return false;
  const scope = value as Record<string, unknown>;
  if (scope.scopeKind !== ARENA_AUTHORIZATION_SCOPE_KIND) return false;
  if (!Array.isArray(scope.artifactClasses)) return false;
  const seen = new Set<string>();
  for (const entry of scope.artifactClasses) {
    if (!isArenaArtifactClass(entry)) return false;
    if (seen.has(entry)) return false; // duplicates are malformed, not "more authorized"
    seen.add(entry);
  }
  return true;
}

/** Builds a validated {@link ArenaAuthorizationScope} from artifact classes (deduplicated, order-preserving). */
export function arenaAuthorizationScope(artifactClasses: readonly ArenaArtifactClass[]): ArenaAuthorizationScope {
  const unique = [...new Set(artifactClasses)];
  return Object.freeze({
    scopeKind: ARENA_AUTHORIZATION_SCOPE_KIND,
    artifactClasses: Object.freeze(unique) as readonly ArenaArtifactClass[],
  });
}

/** True iff `scope` explicitly authorizes return of `artifactClass` artifacts. */
export function scopeAllowsArtifact(scope: ArenaAuthorizationScope, artifactClass: ArenaArtifactClass): boolean {
  return scope.artifactClasses.includes(artifactClass);
}

/** Canonical comparison key for a scope: sorted, joined artifact classes. */
export function arenaAuthorizationScopeKey(scope: ArenaAuthorizationScope): string {
  return [...scope.artifactClasses].sort().join("+");
}

// ---------------------------------------------------------------------------
// Policy deny reasons (frozen usage-rule vocabulary)
// ---------------------------------------------------------------------------

/**
 * The frozen vocabulary of reasons an Arena authorization policy may deny a
 * request candidate. Policies may not invent free-form deny reasons: the
 * Lab's usage rules speak in this closed vocabulary so audits stay
 * machine-checkable. Structural malformation (bad digests, bad scopes) is
 * refused by the envelope validators in `request.ts`, NOT by policy —
 * these reasons express Lab usage-rule ALLOWANCE only.
 */
export type ArenaPolicyDenyReason =
  | "request-kind-not-permitted"
  | "artifact-class-not-permitted"
  | "endpoint-not-permitted";

/** All valid {@link ArenaPolicyDenyReason} values. */
export const ARENA_POLICY_DENY_REASONS = frozenVocabulary<ArenaPolicyDenyReason>("arena-policy-deny-reason", [
  "request-kind-not-permitted",
  "artifact-class-not-permitted",
  "endpoint-not-permitted",
]);

/** Returns true when `value` is a valid {@link ArenaPolicyDenyReason}. */
export function isArenaPolicyDenyReason(value: unknown): value is ArenaPolicyDenyReason {
  return ARENA_POLICY_DENY_REASONS.is(value);
}

// ---------------------------------------------------------------------------
// Authorization decisions and the append-only audit trail
// ---------------------------------------------------------------------------

/** Identifier of an Arena authorization policy instance (the Lab's usage rules). */
export type ArenaPolicyId = Brand<string, "ArenaPolicyId">;

/** Parses and validates `text` as an {@link ArenaPolicyId} (house id-text rules). */
export function asArenaPolicyId(text: string): ArenaPolicyId | undefined {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text) ? (text as ArenaPolicyId) : undefined;
}

/** Structural kind marker of an {@link ArenaAuthorizationDecisionRecord}. */
export type ArenaAuthorizationDecisionKind = "arena-authorization-decision";

/** Marker value for {@link ArenaAuthorizationDecisionKind}. */
export const ARENA_AUTHORIZATION_DECISION_KIND: ArenaAuthorizationDecisionKind = "arena-authorization-decision";

/**
 * The decision content of one authorization event. `recordDigest` pins the
 * canonical form of the CONTENT (decision, reason, policy, escalation
 * correlation, endpoint, time) — the owner computes it with the
 * package-system canonical digest; this package validates shape and
 * uniqueness only.
 */
export type ArenaAuthorizationDecisionContent = Readonly<{
  decision: "allow" | "deny";
  reason?: ArenaPolicyDenyReason;
  policyId: ArenaPolicyId;
  requestPayload: ArenaContentDigest;
  endpoint: ArenaEndpointRef;
  decidedAt?: ArenaTimestampMs;
  recordDigest: ArenaContentDigest;
}>;

/** One audit-tracked authorization decision, as stored in the log. */
export type ArenaAuthorizationDecisionRecord = Readonly<
  ArenaAuthorizationDecisionContent & {
    recordKind: ArenaAuthorizationDecisionKind;
    seq: number;
    previousRecordDigest: ArenaContentDigest | null;
  }
>;

/** An append-only audit trail of Arena authorization decisions (E10: history is immutable). */
export type ArenaAuthorizationAuditLog = Readonly<{ entries: readonly ArenaAuthorizationDecisionRecord[] }>;

/** The empty audit log. */
export const EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG: ArenaAuthorizationAuditLog = Object.freeze({ entries: Object.freeze([]) });

/** Returns true when `value` is structurally a valid {@link ArenaAuthorizationDecisionRecord}. */
export function isArenaAuthorizationDecisionRecord(value: unknown): value is ArenaAuthorizationDecisionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.recordKind !== ARENA_AUTHORIZATION_DECISION_KIND) return false;
  if (record.decision !== "allow" && record.decision !== "deny") return false;
  if (record.decision === "deny" && record.reason !== undefined && !isArenaPolicyDenyReason(record.reason)) return false;
  if (typeof record.policyId !== "string" || asArenaPolicyId(record.policyId) === undefined) return false;
  if (typeof record.requestPayload !== "string" || !isValidArenaContentDigest(record.requestPayload)) return false;
  if (!isArenaEndpointRef(record.endpoint)) return false;
  if (record.decidedAt !== undefined && !(typeof record.decidedAt === "number" && Number.isSafeInteger(record.decidedAt) && record.decidedAt >= 0)) return false;
  if (typeof record.recordDigest !== "string" || !isValidArenaContentDigest(record.recordDigest)) return false;
  if (typeof record.seq !== "number" || !Number.isSafeInteger(record.seq) || record.seq < 0) return false;
  if (record.previousRecordDigest !== null) {
    if (typeof record.previousRecordDigest !== "string" || !isValidArenaContentDigest(record.previousRecordDigest)) return false;
  }
  return true;
}

/** Reasons an audit-log append or validation can be refused (frozen vocabulary). */
export type ArenaAuditRejectionReason = "malformed-record" | "seq-mismatch" | "chain-link-broken" | "duplicate-record-digest";

/** All valid {@link ArenaAuditRejectionReason} values. */
export const ARENA_AUDIT_REJECTION_REASONS = frozenVocabulary<ArenaAuditRejectionReason>("arena-audit-rejection-reason", [
  "malformed-record",
  "seq-mismatch",
  "chain-link-broken",
  "duplicate-record-digest",
]);

/** Outcome of {@link appendArenaAuthorizationDecision}: the extended log, or a typed refusal. */
export type ArenaAuditAppendResult =
  | { readonly ok: true; readonly log: ArenaAuthorizationAuditLog; readonly record: ArenaAuthorizationDecisionRecord }
  | { readonly ok: false; readonly reason: ArenaAuditRejectionReason };

/**
 * Purely appends one authorization decision to the audit log. The caller
 * supplies the decision CONTENT (with its owner-computed `recordDigest`
 * over the content fields); `seq` and `previousRecordDigest` are derived
 * from the log so the chain can never be mis-linked by accident. Appends
 * never mutate the input log (E10: historical evidence is immutable) — a
 * new log value is returned.
 */
export function appendArenaAuthorizationDecision(
  log: ArenaAuthorizationAuditLog,
  content: ArenaAuthorizationDecisionContent,
): ArenaAuditAppendResult {
  if (content.decision === "deny" && content.reason !== undefined && !isArenaPolicyDenyReason(content.reason)) {
    return { ok: false, reason: "malformed-record" };
  }
  if (asArenaPolicyId(content.policyId) === undefined) return { ok: false, reason: "malformed-record" };
  if (!isValidArenaContentDigest(content.requestPayload)) return { ok: false, reason: "malformed-record" };
  if (!isArenaEndpointRef(content.endpoint)) return { ok: false, reason: "malformed-record" };
  if (!isValidArenaContentDigest(content.recordDigest)) return { ok: false, reason: "malformed-record" };
  const last = log.entries.length > 0 ? log.entries[log.entries.length - 1] : undefined;
  if (last !== undefined && last.recordDigest === content.recordDigest) return { ok: false, reason: "duplicate-record-digest" };
  for (const entry of log.entries) {
    if (entry.recordDigest === content.recordDigest) return { ok: false, reason: "duplicate-record-digest" };
  }
  const record: ArenaAuthorizationDecisionRecord = Object.freeze({
    ...content,
    recordKind: ARENA_AUTHORIZATION_DECISION_KIND,
    seq: log.entries.length,
    previousRecordDigest: last === undefined ? null : last.recordDigest,
  });
  return {
    ok: true,
    log: Object.freeze({ entries: Object.freeze([...log.entries, record]) }),
    record,
  };
}

/** Outcome of {@link validateArenaAuthorizationAuditLog}. */
export type ArenaAuditValidation = { readonly valid: true } | { readonly valid: false; readonly reasons: readonly ArenaAuditRejectionReason[] };

/**
 * Validates the structural integrity of an authorization audit chain:
 * contiguous sequence numbers starting at 0, coherent previous-digest
 * links, unique record digests, and well-formed records. Tampering,
 * reordering or dropping entries makes the log invalid.
 *
 * Scope note: this checks chain LINKAGE and record shape. Cryptographic
 * binding of a `recordDigest` to its record content is the digest
 * authority's job (package-system canonical digests, reached via the
 * lab-contracts seam once PL-006 lands) and is intentionally not
 * re-implemented here.
 */
export function validateArenaAuthorizationAuditLog(log: ArenaAuthorizationAuditLog): ArenaAuditValidation {
  const reasons: ArenaAuditRejectionReason[] = [];
  const seen = new Set<string>();
  let expectedPrevious: string | null = null;
  for (let index = 0; index < log.entries.length; index += 1) {
    const entry = log.entries[index];
    if (!isArenaAuthorizationDecisionRecord(entry)) {
      reasons.push("malformed-record");
      continue;
    }
    if (entry.seq !== index) reasons.push("seq-mismatch");
    const previous = entry.previousRecordDigest;
    if ((previous === null && expectedPrevious !== null) || (previous !== null && previous !== expectedPrevious)) {
      reasons.push("chain-link-broken");
    }
    if (seen.has(entry.recordDigest)) reasons.push("duplicate-record-digest");
    seen.add(entry.recordDigest);
    expectedPrevious = entry.recordDigest;
  }
  return reasons.length > 0 ? { valid: false, reasons: Object.freeze([...new Set(reasons)]) } : { valid: true };
}
