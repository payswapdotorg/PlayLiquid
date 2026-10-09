/**
 * CONTRIBUTION HISTORY (E10) — append-only transition records and the
 * content-addressed submission identity.
 *
 * Every state change the community service admits is recorded as an
 * immutable, append-only {@link ContributionTransitionRecord} stamped
 * with the platform authority marker (E8: only this service decides
 * contribution facts). Records are CONTENT-ADDRESSED: the record id is
 * package-system's digest of the record's own content, so any tampering
 * with a record's body (or its id) is structurally detectable — the same
 * discipline git-lineage applies to lineage node ids.
 *
 * Digest composition (E5/E7 — each authority hashes at its own seam, this
 * package hashes nothing itself):
 * - the PAYLOAD is hashed by game-ir's `hashGameIRValue` over the
 *   kernel's canonical value form (the kernel's own bigint-safe rules);
 * - the submission ENVELOPE (tenant, contributor, kind, payload digest,
 *   origin, AI disclosure, model provenance) is then digested by
 *   package-system's `computeDigest` over canonical JSON. The result is
 *   the contribution id — the E10 idempotency key: one digest, one
 *   contribution record; a replay returns the recorded receipt.
 *
 * Digest-input discipline: package-system's canonical JSON refuses
 * `undefined` values, so optional keys are included only when present,
 * deterministically on every path.
 *
 * Purity: types + pure digest derivation. No IO.
 */

import { computeDigest, isContentDigest } from "@playliquid/package-system";
import type { ContentDigest, ModelProvenanceEntry } from "@playliquid/package-system";
import { hashGameIRValue } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import type { PlatformAuthorityMarker, SubjectId, TenantId, TimestampMs } from "@playliquid/platform-contracts";
import type {
  CapabilityGapLink,
  ContributionId,
  ContributionKind,
  ContributionOrigin,
  ContributionProvenance,
  ContributionStatus,
} from "./records.ts";
import { asContributionId } from "./records.ts";

// ---------------------------------------------------------------------------
// Submission identity (content-addressed idempotency, E10)
// ---------------------------------------------------------------------------

/** Domain-separation tag for contribution submission identities. */
const CONTRIBUTION_TAG = "playliquid:community:contribution:1";

/** The provenance-bearing identity of one submission (gap link excluded). */
export interface SubmissionIdentity {
  readonly tenant: TenantId;
  readonly contributor: SubjectId;
  readonly kind: ContributionKind;
  /** game-ir's hash of the payload (the kernel's canonical value form). */
  readonly payloadDigest: string;
  readonly origin: ContributionOrigin;
  readonly aiGenerated: boolean;
  /** Normalized to an empty array when no entries were disclosed. */
  readonly modelProvenance: readonly ModelProvenanceEntry[];
}

/**
 * The content address of a submission: package-system's canonical-JSON
 * SHA-256 over `{ tag, tenant, contributor, kind, payloadDigest, origin,
 * aiGenerated, modelProvenance }`. The gap link is deliberately EXCLUDED:
 * it is routing metadata, not provenance — the same artifact from the
 * same contributor with the same origin is one submission, and its
 * resubmission is a duplicate replay (E10).
 */
export function contributionIdOf(identity: SubmissionIdentity): ContributionId {
  const digest = computeDigest({
    tag: CONTRIBUTION_TAG,
    tenant: String(identity.tenant),
    contributor: String(identity.contributor),
    kind: identity.kind,
    payloadDigest: identity.payloadDigest,
    origin: identity.origin,
    aiGenerated: identity.aiGenerated,
    modelProvenance: identity.modelProvenance,
  });
  return asContributionId(digest)!;
}

/**
 * Derives the submission identity of one validated payload — the payload
 * digest comes from game-ir's kernel-form hashing (bigint-safe).
 */
export function submissionIdentityOf(
  tenant: TenantId,
  contributor: SubjectId,
  kind: ContributionKind,
  payload: GameIRValue,
  origin: ContributionOrigin,
  aiGenerated: boolean,
  modelProvenance: readonly ModelProvenanceEntry[],
): SubmissionIdentity {
  return {
    tenant,
    contributor,
    kind,
    payloadDigest: hashGameIRValue(payload),
    origin,
    aiGenerated,
    modelProvenance,
  };
}

// ---------------------------------------------------------------------------
// Append-only transition records (E10)
// ---------------------------------------------------------------------------

/** Domain-separation tag for transition records. */
const TRANSITION_TAG = "playliquid:community:transition:1";

/** Domain-separation tag for transition COMMANDS (E10 idempotency keys). */
const TRANSITION_COMMAND_TAG = "playliquid:community:transition-command:1";

/**
 * The content address of one transition COMMAND — the E10 idempotency
 * key for workflow commands: `tenant, contributionId, kind, actor,
 * reason` (the clock-time is deliberately excluded; a replayed command
 * is the same command). The service registers this key when a command
 * is admitted and returns the recorded receipt on encounter.
 */
export function transitionCommandKeyOf(command: {
  readonly tenant: TenantId;
  readonly contributionId: ContributionId;
  readonly kind: string;
  readonly actor: SubjectId;
  readonly reason?: string;
}): ContentDigest {
  const input: Record<string, unknown> = {
    tag: TRANSITION_COMMAND_TAG,
    tenant: String(command.tenant),
    contributionId: String(command.contributionId),
    kind: command.kind,
    actor: String(command.actor),
  };
  if (command.reason !== undefined) input.reason = command.reason;
  return computeDigest(input);
}

/** The content a transition record id addresses. */
export interface TransitionRecordContent {
  readonly tenant: TenantId;
  readonly contributionId: ContributionId;
  /** The subject whose command caused the transition. */
  readonly actor: SubjectId;
  readonly from: ContributionStatus | null;
  readonly to: ContributionStatus;
  readonly reason?: string;
  readonly recordedAt: TimestampMs;
}

/** Deterministic content-addressed id of one transition record. */
export function transitionRecordIdOf(content: TransitionRecordContent): ContentDigest {
  const input: Record<string, unknown> = {
    tag: TRANSITION_TAG,
    tenant: String(content.tenant),
    contributionId: String(content.contributionId),
    actor: String(content.actor),
    from: content.from,
    to: content.to,
    recordedAt: content.recordedAt,
  };
  if (content.reason !== undefined) input.reason = content.reason;
  return computeDigest(input);
}

/**
 * One immutable, append-only transition record. `recordId` is the content
 * address of the record's own content — structurally tamper-evident.
 */
export interface ContributionTransitionRecord extends TransitionRecordContent {
  readonly recordId: ContentDigest;
  /** Only the community service decides contribution facts (E8). */
  readonly decidedBy: PlatformAuthorityMarker;
}

/** Builds the genesis record of one submission (from: null -> submitted). */
export function submissionTransitionOf(
  tenant: TenantId,
  contributionId: ContributionId,
  contributor: SubjectId,
  recordedAt: TimestampMs,
): ContributionTransitionRecord {
  const content: TransitionRecordContent = {
    tenant,
    contributionId,
    actor: contributor,
    from: null,
    to: "submitted",
    recordedAt,
  };
  return { ...content, recordId: transitionRecordIdOf(content), decidedBy: "platform-authority" };
}

/**
 * Type guard: a structurally valid {@link ContributionTransitionRecord}
 * WHOSE record id is the content address of its own content. A mutated
 * record body, a swapped id, or a forged record fails here — the history
 * tampering negative path (E8/E10).
 */
export function isContributionTransitionRecord(value: unknown): value is ContributionTransitionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.decidedBy !== "platform-authority") return false;
  if (typeof record.tenant !== "string" || typeof record.actor !== "string") return false;
  if (typeof record.contributionId !== "string" || asContributionId(record.contributionId) === undefined) {
    return false;
  }
  if (record.from !== null && typeof record.from !== "string") return false;
  if (typeof record.to !== "string") return false;
  if (record.reason !== undefined && typeof record.reason !== "string") return false;
  if (typeof record.recordedAt !== "number") return false;
  if (typeof record.recordId !== "string" || !isContentDigest(record.recordId)) return false;
  const content: TransitionRecordContent = {
    tenant: record.tenant as TenantId,
    contributionId: record.contributionId as ContributionId,
    actor: record.actor as SubjectId,
    from: record.from as ContributionStatus | null,
    to: record.to as ContributionStatus,
    reason: record.reason as string | undefined,
    recordedAt: record.recordedAt as TimestampMs,
  };
  return record.recordId === transitionRecordIdOf(content);
}

// ---------------------------------------------------------------------------
// Snapshot document rows (E6 resumability seam; plain JSON forms)
// ---------------------------------------------------------------------------

/** One serialized contribution row (snapshot form; ids as strings). */
export interface ContributionRow {
  readonly contributionId: string;
  readonly tenant: string;
  readonly contributor: string;
  readonly kind: string;
  readonly payload: GameIRValue;
  readonly provenance: ContributionProvenance;
  readonly gap?: CapabilityGapLink;
  readonly status: string;
  readonly submittedAt: number;
  readonly decidedBy: string;
}

/** One serialized transition record row (snapshot form). */
export interface TransitionRow {
  readonly recordId: string;
  readonly tenant: string;
  readonly contributionId: string;
  readonly actor: string;
  readonly from: string | null;
  readonly to: string;
  readonly reason?: string;
  readonly recordedAt: number;
  readonly decidedBy: string;
}
