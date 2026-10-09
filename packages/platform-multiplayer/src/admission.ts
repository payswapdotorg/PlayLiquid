/**
 * PLATFORM SESSION ADMISSION BINDING — the kernel-side half of
 * platform-contracts' admission administration shapes.
 *
 * The pure oracle `decideAdmission` (platform-contracts multiplayer.ts)
 * decides over {@link SessionAdmissionFacts}; the authority kernel OWNS
 * those facts (roster, capacity, admission mode, invite list) and derives
 * them from its own state via {@link deriveAdmissionFacts}. Nothing a
 * client sends can influence the facts.
 *
 * Kernel-level refusals beyond the platform oracle's codes:
 * - `session-inactive` — admission before `open()` or after termination;
 * - `session-mismatch` — the request names a different session;
 * - `already-enrolled` — the subject is already in the roster (a second
 *   join is a protocol misuse, not a silent no-op).
 *
 * Tenant isolation (R20): the platform oracle's `tenant-mismatch` refusal
 * is surfaced verbatim — a request from another tenant is never redirected.
 *
 * Purity: types + a pure facts-derivation function. The roster itself is
 * kernel-owned mutable state (E1: one owner).
 */

import { asMatchSessionId, decideAdmission } from "@playliquid/platform-contracts";
import type {
  MatchSessionId,
  MultiplayerServicePolicy,
  SessionAdmissionDecision,
  SessionAdmissionFacts,
  SessionAdmissionRequest,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";
import type { SessionId } from "@playliquid/runtime-contracts";

/** Kernel-level admission refusal codes (platform codes flow through too). */
export type ParticipantRefusalCode =
  | "session-inactive"
  | "session-mismatch"
  | "already-enrolled"
  | "tenant-mismatch"
  | "session-full"
  | "not-invited"
  | "malformed-facts";

/** Result of one participant admission request. */
export type ParticipantAdmissionResult =
  | { readonly admitted: true; readonly subject: SubjectId }
  | { readonly admitted: false; readonly code: ParticipantRefusalCode; readonly detail: string };

/** Everything the kernel knows when deriving admission facts. */
export interface AdmissionFactsInput {
  readonly session: SessionId;
  readonly tenant: TenantId;
  readonly capacity: number;
  readonly enrolled: number;
  readonly admission: MultiplayerServicePolicy["admission"];
  readonly invitedSubjects: readonly SubjectId[];
}

/**
 * Bridge the kernel's runtime {@link SessionId} into the platform
 * {@link MatchSessionId} space. Both are branded strings over the same id
 * text; the cast crosses the two contract packages' id spaces at their
 * documented binding point (this package).
 */
export function bridgeMatchSessionId(session: SessionId): MatchSessionId | undefined {
  return asMatchSessionId(String(session));
}

/**
 * Derive the platform admission facts from kernel-owned state. Pure: the
 * kernel passes its own roster/capacity numbers; clients never supply
 * facts. Capacity comes from the game's multiplayer policy; enrollment
 * from the roster length; the admission mode and invite list from the
 * session configuration.
 */
export function deriveAdmissionFacts(input: AdmissionFactsInput): SessionAdmissionFacts | undefined {
  const session = bridgeMatchSessionId(input.session);
  if (session === undefined) return undefined;
  return {
    session,
    tenant: input.tenant,
    capacity: input.capacity,
    enrolled: input.enrolled,
    admission: input.admission,
    invitedSubjects: input.invitedSubjects,
  };
}

/**
 * Run the bound platform admission oracle over derived facts, adding the
 * kernel-level guards (session identity, activity, duplicate enrollment).
 * Pure; the kernel mutates its roster only on `admitted: true`.
 */
export function adjudicateParticipantAdmission(
  request: SessionAdmissionRequest,
  facts: SessionAdmissionFacts | undefined,
  sessionActive: boolean,
  alreadyEnrolled: (subject: SubjectId) => boolean,
): ParticipantAdmissionResult {
  if (!sessionActive) {
    return {
      admitted: false,
      code: "session-inactive",
      detail: "session is not open for admissions",
    };
  }
  if (facts === undefined) {
    return {
      admitted: false,
      code: "malformed-facts",
      detail: "kernel session id is not valid platform id text",
    };
  }
  if (request.session !== facts.session) {
    return {
      admitted: false,
      code: "session-mismatch",
      detail: `request targets session ${String(request.session)}, not this session`,
    };
  }
  if (alreadyEnrolled(request.subject)) {
    return {
      admitted: false,
      code: "already-enrolled",
      detail: `subject ${String(request.subject)} is already enrolled`,
    };
  }
  const decision: SessionAdmissionDecision = decideAdmission(request, facts);
  if (decision.admitted) {
    return { admitted: true, subject: request.subject };
  }
  return {
    admitted: false,
    code: decision.code,
    detail: `platform admission oracle refused: ${decision.code}`,
  };
}
