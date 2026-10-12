/**
 * SERVICE DOOR TYPES (PL-031) — the typed results of every
 * {@link "./service.ts".ArenaRuntimeService} door.
 *
 * Honest-outcome discipline: drive results that describe a legitimate end or
 * intermediate state (policy denial, response rejection, transport error,
 * expiry, terminal) are STATUSES, not refusals — the runtime reports them
 * truthfully (E11). Typed refusals (unknown/cross-tenant/tampered/collision)
 * follow the house `{ ok: false; code; detail }` shape with the frozen
 * vocabulary in primitives.ts.
 */

import type {
  ArenaEvidencePackage,
  ArenaLifecycleState,
  ArenaPolicyDenyReason,
  ArenaRequestRejectionReason,
  ArenaResponseRejectionReason,
  ArenaTransportErrorKind,
} from "@playliquid/arena-integration";
import type { ArenaLabeledPayload } from "./epistemic.ts";
import type { ArenaCaseRefusalCode, ArenaIntakeRefusalCode, SourceRegistrationRefusalCode } from "./primitives.ts";
import type { ArenaEscalationCase } from "./records.ts";
import type { RegisteredEscalationSource } from "./records.ts";

/** Result of the source-registration door. */
export type RegisterSourceDoorResult =
  | { readonly ok: true; readonly source: RegisteredEscalationSource; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: SourceRegistrationRefusalCode; readonly detail: string };

/** Result of the case-opening door. */
export type OpenCaseDoorResult =
  | { readonly ok: true; readonly case: ArenaEscalationCase; readonly duplicate: boolean }
  | {
      readonly ok: false;
      readonly code: ArenaIntakeRefusalCode;
      readonly detail: string;
      readonly envelopeReasons?: readonly ArenaRequestRejectionReason[];
    };

/** Result of tenant-scoped case reads. */
export type CaseReadResult =
  | { readonly ok: true; readonly case: ArenaEscalationCase }
  | { readonly ok: false; readonly code: "unknown-case" | "cross-tenant" | "tampered-case"; readonly detail: string };

/** Result of the epistemic-labeling door (total: absent evidence labels empty). */
export type LabeledEvidenceResult =
  | { readonly ok: true; readonly labels: readonly ArenaLabeledPayload[] }
  | { readonly ok: false; readonly code: "unknown-case" | "cross-tenant" | "tampered-case"; readonly detail: string };

/**
 * The honest outcome of one orchestration drive. The runtime reports what
 * happened and never re-throws transport or Arena-side failures as
 * exceptions; every outcome carries the (updated) case.
 */
export type DriveCaseOutcome =
  | { readonly status: "ingested"; readonly case: ArenaEscalationCase; readonly evidencePackage: ArenaEvidencePackage }
  | { readonly status: "policy-denied"; readonly case: ArenaEscalationCase; readonly reason: ArenaPolicyDenyReason }
  | { readonly status: "response-rejected"; readonly case: ArenaEscalationCase; readonly reasons: readonly ArenaResponseRejectionReason[] }
  | { readonly status: "tampered-response-digest"; readonly case: ArenaEscalationCase }
  | { readonly status: "transport-error"; readonly case: ArenaEscalationCase; readonly errorKind: ArenaTransportErrorKind }
  | { readonly status: "expired"; readonly case: ArenaEscalationCase }
  | { readonly status: "terminal"; readonly case: ArenaEscalationCase; readonly state: ArenaLifecycleState };

/** Result of the orchestration drive door. */
export type DriveCaseResult =
  | { readonly ok: true; readonly outcome: DriveCaseOutcome }
  | { readonly ok: false; readonly code: ArenaCaseRefusalCode; readonly detail: string };

/** Result of document restore (E6 snapshot restore; E8 tamper refusal). */
export type RestoreDoorResult =
  | { readonly ok: true; readonly cases: number; readonly sources: number }
  | { readonly ok: false; readonly code: "no-persisted-document" | "tampered-document"; readonly detail: string };
