/**
 * RUNTIME RECORD VOCABULARY (PL-031) — escalation sources, the host's
 * decided escalation command, and the tracked escalation case.
 *
 * R18 discipline: the runtime NEVER decides to escalate. The only case-
 * opening input is {@link ArenaEscalationCommand} — a record of a host
 * policy decision (WHO decided, WHEN, with WHICH content-addressed digest).
 * A command whose decision does not verify is a typed
 * `undecided-escalation`/`tampered-decision-digest` refusal; there is no
 * door anywhere in this package that derives an escalation from gap state
 * on its own (lab-learning's summaries are recorded and typed — escalation
 * decisions are the host's).
 *
 * E6/E10 discipline: a case is CONTENT-ADDRESSED (its id and its external
 * escalation handle derive from the content key: tenant, source, ask,
 * endpoint, request kind, authorization scope — decision bookkeeping
 * deliberately excluded). Re-running the same decided escalation resumes
 * the SAME case as a typed duplicate receipt. The evolving orchestration
 * state (lifecycle, receipts, evidence) lives on the case but OUTSIDE the
 * identity digest.
 *
 * Passive data only: every record here is readonly and carries no callable
 * member; the only writes anywhere are appends/replacements inside the
 * service's own state (E1) — see no-mutation.test.ts.
 */

import type {
  ArenaAuthorizationScope,
  ArenaEndpointRef,
  ArenaEvidencePackage,
  ArenaIngestReceipt,
  ArenaLifecycleRecord,
  ArenaRequestKind,
  ArenaRequestRejectionReason,
  ArenaResponseEnvelope,
  ArenaSendReceipt,
} from "@playliquid/arena-integration";
import type { ArenaEscalationRequest } from "./escalation-request.ts";
import type { ContentDigest, TimestampMs } from "@playliquid/lab-contracts";
import type { CapabilityGapRecord } from "@playliquid/lab-contracts";
import type { GapLadderSummary } from "@playliquid/lab-learning";
import type { CapabilityGapFinding } from "@playliquid/lab-organization";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import type { ArenaCaseId, ArenaEscalationSourceKind, ArenaIntakeRefusalCode, ArenaSourceKey } from "./primitives.ts";

/** Structural kind marker of an {@link ArenaEscalationCase}. */
export type ArenaEscalationCaseKind = "arena-escalation-case";

/** Marker value for {@link ArenaEscalationCaseKind}. */
export const ARENA_ESCALATION_CASE_KIND: ArenaEscalationCaseKind = "arena-escalation-case";

/**
 * One registered escalation source — the runtime's typed view of the Lab's
 * gap state at one content state. Sources are REGISTERED BY THE HOST:
 * - `gap-finding` — a lab-organization finding PLUS the walked
 *   lab-contracts gap record that proves which rung the ladder reached (the
 *   finding alone is pre-ladder: Arena-first-resort is refused);
 * - `gap-record` — a lab-contracts gap record whose trail was walked;
 * - `gap-summary` — a lab-learning rung-classified recurring summary.
 *
 * `sourceDigest` is the content-addressed identity (tamper oracle input);
 * `sourceKey` is its slug and what commands cite.
 */
export type RegisteredEscalationSource = Readonly<{
  readonly tenant: TenantId;
  readonly sourceKind: ArenaEscalationSourceKind;
  readonly sourceDigest: ContentDigest;
  /** The registry slug of `sourceDigest` — what escalation commands cite. */
  readonly sourceKey: ArenaSourceKey;
}> &
  Readonly<
    | { readonly kind: "gap-finding"; readonly finding: CapabilityGapFinding; readonly record: CapabilityGapRecord }
    | { readonly kind: "gap-record"; readonly record: CapabilityGapRecord }
    | { readonly kind: "gap-summary"; readonly summary: GapLadderSummary }
  >;

/** The lab-learning rung-classified summary source form (typed at every rung). */
export type GapSummarySource = GapLadderSummary;

/** Submission form of {@link RegisteredEscalationSource} (tenant comes from the caller). */
export type EscalationSourceSubmission =
  | { readonly kind: "gap-finding"; readonly finding: CapabilityGapFinding; readonly record: CapabilityGapRecord }
  | { readonly kind: "gap-record"; readonly record: CapabilityGapRecord }
  | { readonly kind: "gap-summary"; readonly summary: GapLadderSummary };

/** Result of source registration (E10 receipt pattern: duplicates are idempotent). */
export type SourceRegistrationResult =
  | { readonly ok: true; readonly source: RegisteredEscalationSource; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: "invalid-source"; readonly detail: string };

/**
 * The host's DECIDED escalation command (R18). `decisionDigest` is the
 * content-addressed digest of the host policy's decision record; the intake
 * re-derives it from the command's decision fields and refuses a mismatch —
 * a decision that does not verify is no decision, and the runtime never
 * escalates without one.
 */
export interface ArenaEscalationCommand {
  readonly decidedBy: SubjectId;
  readonly decidedAt: TimestampMs;
  readonly decisionDigest: ContentDigest;
  readonly sourceKey: ArenaSourceKey;
  readonly requestKind: ArenaRequestKind;
  /** The content-addressed ask (bare-hex lab-contracts digest form). */
  readonly requestPayload: ContentDigest;
  readonly endpoint: ArenaEndpointRef;
  readonly authorization: ArenaAuthorizationScope;
  readonly expiresAt?: TimestampMs;
}

/** Result of the intake oracle (E10 receipt pattern: duplicates are idempotent). */
export type ArenaIntakeResult =
  | { readonly ok: true; readonly case: ArenaEscalationCase; readonly duplicate: boolean }
  | {
      readonly ok: false;
      readonly code: ArenaIntakeRefusalCode;
      readonly detail: string;
      readonly envelopeReasons?: readonly ArenaRequestRejectionReason[];
    };

/** One tracked escalation case — the runtime's single unit of durable state (E6). */
export interface ArenaEscalationCase {
  readonly caseKind: ArenaEscalationCaseKind;
  readonly caseId: ArenaCaseId;
  readonly tenant: TenantId;
  readonly decidedBy: SubjectId;
  readonly sourceKey: ArenaSourceKey;
  readonly sourceKind: ArenaEscalationSourceKind;
  readonly request: ArenaEscalationRequest;
  readonly lifecycle: ArenaLifecycleRecord;
  /** Durable send state (E6): the effective send receipt, once settled. */
  readonly sendReceipt?: ArenaSendReceipt;
  /** Durable response state: the last structurally-validated response envelope. */
  readonly response?: ArenaResponseEnvelope;
  /** Durable ingest state (E6): the effective ingest receipt, once settled. */
  readonly ingestReceipt?: ArenaIngestReceipt;
  /** The filed evidence package (admitted OR rejected-verdict — a refusal is evidence, E10). */
  readonly evidencePackage?: ArenaEvidencePackage;
  readonly openedAt: TimestampMs;
  /** Content-addressed identity over the IMMUTABLE case content (tamper oracle). */
  readonly caseDigest: ContentDigest;
}
