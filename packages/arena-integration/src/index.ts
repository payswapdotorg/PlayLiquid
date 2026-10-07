/**
 * Public barrel of `@playliquid/arena-integration` (PL-007).
 *
 * The typed, provider-neutral integration contract layer between the Game
 * Engineering Lab and the external Arena (architecture.md §Arena; lock
 * rules 6, 32):
 *
 * - REQUEST side: frozen request-kind vocabulary + content-addressed wire
 *   request envelopes with authorization scopes (`request.ts`);
 * - RESPONSE side: typed envelopes for the three declared return classes
 *   (results / evidence / authorized artifacts) with a pure response
 *   validator (`response.ts`, `validate.ts`);
 * - INGESTION-ONLY handling: typed verdicts producing evidence packages
 *   for the Lab's normal evidence path — no type, port or function can
 *   mutate live PlayLiquid state from an Arena response (`ingestion.ts`);
 * - LIFECYCLE: frozen draft→…→ingested|rejected|expired state machine with
 *   idempotent send/ingest oracles (E6) and audit-tracked authorization
 *   decisions (`lifecycle.ts`, `authorization.ts`);
 * - TRANSPORT: the pure, provider-neutral `ArenaTransport` port with a
 *   deterministic in-memory fake (`transport.ts`);
 * - POLICY: the pure Lab usage-rule port with deterministic fakes
 *   (`policy.ts`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE CHANGE REQUEST — PENDING LAB-CONTRACTS SEAM (PL-006)
 * ────────────────────────────────────────────────────────────────────────────
 * This Work Order's base (c9cf856) does NOT contain `packages/lab-contracts`
 * (PL-006): the package was never delivered — no branch, no PR, no merge;
 * program/graph.json records PL-006 as BLOCKED and PL-007 as BLOCKED on it,
 * and the program frontier does not list PL-007 as dispatchable.
 *
 * The work order requires the Lab-side escalation request record to be
 * "built FROM lab-contracts' ArenaEscalationRef (never re-declared: import
 * and extend)". That import is impossible at this base. Per the
 * architecture-change rule (AGENTS.md, docs/handoff/EXECUTION-PLAN.md), the
 * affected path is STOPPED rather than escaped: this package does NOT
 * re-declare `ArenaEscalationRef`, the gap-ladder vocabulary, or the
 * canonical digest computation (package-system authority).
 *
 * When PL-006 lands, the TL should:
 * 1. add `"@playliquid/lab-contracts": "workspace:*"` to this package's
 *    dependencies (root lockfile is TL-owned) and re-run the gates;
 * 2. define `ArenaEscalationRequest = ArenaEscalationRef & ArenaRequestEnvelope`
 *    here (the envelope and every correlation pin — the request payload
 *    digest — already line up by design; no data migration);
 * 3. re-parent `ArenaContentDigest` and the "arena-external" provenance
 *    marker to the lab-contracts seam types (identical wire shapes).
 */

export {
  ARENA_CONTENT_DIGEST_PATTERN,
  ARENA_ENDPOINT_REF_KIND,
  ARENA_EXTERNAL_ORIGIN,
  arenaEndpointRefEquals,
  arenaEndpointRefKey,
  asArenaContentDigest,
  asArenaTimestampMs,
  frozenVocabulary,
  isArenaEndpointRef,
  isArenaExternalOriginMarker,
  isValidArenaContentDigest,
} from "./primitives.ts";
export type {
  ArenaContentDigest,
  ArenaEndpointRef,
  ArenaEndpointRefKind,
  ArenaExternalOriginMarker,
  ArenaTimestampMs,
} from "./primitives.ts";

export {
  ARENA_ARTIFACT_CLASSES,
  ARENA_AUTHORIZATION_DECISION_KIND,
  ARENA_AUTHORIZATION_SCOPE_KIND,
  ARENA_AUDIT_REJECTION_REASONS,
  ARENA_NO_ARTIFACTS_SCOPE,
  ARENA_POLICY_DENY_REASONS,
  EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG,
  appendArenaAuthorizationDecision,
  arenaAuthorizationScope,
  arenaAuthorizationScopeKey,
  asArenaPolicyId,
  isArenaArtifactClass,
  isArenaAuthorizationDecisionRecord,
  isArenaAuthorizationScope,
  isArenaPolicyDenyReason,
  scopeAllowsArtifact,
  validateArenaAuthorizationAuditLog,
} from "./authorization.ts";
export type {
  ArenaArtifactClass,
  ArenaAuditAppendResult,
  ArenaAuditRejectionReason,
  ArenaAuditValidation,
  ArenaAuthorizationAuditLog,
  ArenaAuthorizationDecisionContent,
  ArenaAuthorizationDecisionKind,
  ArenaAuthorizationDecisionRecord,
  ArenaAuthorizationScope,
  ArenaAuthorizationScopeKind,
  ArenaPolicyDenyReason,
  ArenaPolicyId,
} from "./authorization.ts";

export {
  ARENA_REQUEST_ENVELOPE_KIND,
  ARENA_REQUEST_KINDS,
  ARENA_REQUEST_REJECTION_REASONS,
  arenaSendIdempotencyKey,
  arenaSendIdempotencyKeyEquals,
  arenaSendIdempotencyKeyText,
  checkArenaRequestEnvelopeCoherence,
  isArenaRequestCycleContext,
  isArenaRequestEnvelope,
  isArenaRequestKind,
  requestKindArtifactClass,
} from "./request.ts";
export type {
  ArenaRequestCycleContext,
  ArenaRequestCoherence,
  ArenaRequestEnvelope,
  ArenaRequestEnvelopeKind,
  ArenaRequestKind,
  ArenaRequestRejectionReason,
  ArenaSendIdempotencyKey,
} from "./request.ts";

export {
  ARENA_ARTIFACT_RECORD_KIND,
  ARENA_EVIDENCE_RECORD_KIND,
  ARENA_RESPONSE_ENVELOPE_KIND,
  ARENA_RESULT_RECORD_KIND,
  arenaResponseResultContents,
  isArenaArtifactPayload,
  isArenaEvidencePayload,
  isArenaResponseEnvelope,
  isArenaResultPayload,
} from "./response.ts";
export type {
  ArenaArtifactPayload,
  ArenaArtifactRecordKind,
  ArenaEvidencePayload,
  ArenaEvidenceRecordKind,
  ArenaResponseEnvelope,
  ArenaResponseEnvelopeKind,
  ArenaResultPayload,
  ArenaResultRecordKind,
} from "./response.ts";

export {
  ARENA_RESPONSE_REJECTION_REASONS,
  isArenaResponseRejectionReason,
  validateArenaResponse,
} from "./validate.ts";
export type { ArenaResponseRejectionReason, ArenaResponseValidation } from "./validate.ts";

export {
  ARENA_EVIDENCE_PACKAGE_KIND,
  arenaEvidencePackageEquals,
  arenaIngestIdempotencyKey,
  arenaIngestIdempotencyKeyEquals,
  arenaIngestIdempotencyKeyText,
  settleArenaIngest,
} from "./ingestion.ts";
export type {
  ArenaEvidencePackage,
  ArenaEvidencePackageKind,
  ArenaIngestDisposition,
  ArenaIngestIdempotencyKey,
  ArenaIngestReceipt,
  ArenaIngestionVerdict,
} from "./ingestion.ts";

export {
  ARENA_LIFECYCLE_STATES,
  ARENA_LIFECYCLE_TRANSITIONS,
  advanceArenaLifecycle,
  canTransitionArenaLifecycle,
  expireArenaEscalation,
  initialArenaLifecycle,
  isArenaLifecycleState,
  settleArenaSend,
} from "./lifecycle.ts";
export type {
  ArenaLifecycleAdvanceResult,
  ArenaLifecycleAdvanceRefusal,
  ArenaLifecycleRecord,
  ArenaLifecycleState,
  ArenaLifecycleTransitionRecord,
  ArenaSendAttemptResult,
  ArenaSendDisposition,
  ArenaSendReceipt,
} from "./lifecycle.ts";

export {
  ARENA_TRANSPORT_ERROR_KINDS,
  ARENA_TRANSPORT_PORT_KIND,
  inMemoryArenaTransport,
  isArenaTransportErrorKind,
} from "./transport.ts";
export type {
  ArenaResponder,
  ArenaTransport,
  ArenaTransportError,
  ArenaTransportErrorKind,
  ArenaTransportPortKind,
  ArenaTransportResult,
} from "./transport.ts";

export { allowAllArenaPolicy, denyAllArenaPolicy, scopeLimitArenaPolicy } from "./policy.ts";
export type { ArenaAuthorizationPolicy, ArenaPolicyDecision, ArenaScopeLimitPolicyConfig } from "./policy.ts";
