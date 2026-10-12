/**
 * SERVICE DOOR CONTRACTS (PL-041) — the typed results of the
 * {@link RightsAuthority} doors, split from service.ts for the
 * 400-line ceiling (the platform-economy precedent).
 *
 * Every refusal carries a frozen code; the domain-module shapes live
 * with their authorities (lattice/admission/entitlement/integrity/
 * escalation); this module holds only the service-level composites.
 *
 * Purity: types only.
 */

import type { HostRestriction } from "@playliquid/game-contracts";
import type { AvatarDefinition } from "@playliquid/avatar-runtime";
import type { EscalationRightResult } from "./escalation.ts";
import type { StandingIngestionResult } from "./integrity-rights.ts";
import type { HostBindingRecord, RefusalRecord, RightsStateDocument, SessionBindingRecord } from "./ports.ts";
import type { RightsDoorRefusalCode } from "./vocabulary.ts";

/** Generic refusal arm shared by every admin/auditor door. */
export type RightsDoorRefusal = { readonly ok: false; readonly code: RightsDoorRefusalCode; readonly detail: string };

/** Result of registering one (tenant, host) avatar binding (R5). */
export type BindingResult =
  | { readonly ok: true; readonly binding: HostBindingRecord; readonly duplicate: boolean }
  | RightsDoorRefusal;

/** Result of binding one runtime session to a tenant (R20). */
export type SessionBindingResult =
  | { readonly ok: true; readonly binding: SessionBindingRecord; readonly duplicate: boolean }
  | RightsDoorRefusal;

/** Result of the standing-ingestion door (R11). */
export type StandingDoorResult = StandingIngestionResult | RightsDoorRefusal;

/** Result of the escalation-right mint door (PL-031). */
export type EscalationDoorResult = EscalationRightResult | RightsDoorRefusal;

/** Result of a state snapshot. */
export type SnapshotResult =
  | { readonly ok: true; readonly snapshotId: string; readonly revision: number }
  | RightsDoorRefusal;

/** Result of a state restore. */
export type RestoreResult = { readonly ok: true; readonly revision: number } | RightsDoorRefusal;

/** Result of the tenant-scoped refusal-ledger read (E10 view). */
export type LedgerReadResult = { readonly ok: true; readonly records: readonly RefusalRecord[] } | RightsDoorRefusal;

/** The tenant-scoped lattice read model (auditor view). */
export interface LatticeStateView {
  readonly bindings: readonly HostBindingRecord[];
  readonly sessions: readonly SessionBindingRecord[];
  readonly standings: RightsStateDocument["standings"];
  readonly elevated: RightsStateDocument["elevated"];
}

/** Result of the lattice read door. */
export type LatticeStateResult = { readonly ok: true; readonly state: LatticeStateView } | RightsDoorRefusal;

/** Input of the avatar-binding registration door. */
export interface AvatarBindingInput {
  readonly tenant: string;
  readonly host: string;
  readonly definition: AvatarDefinition;
  readonly restriction: HostRestriction;
}
