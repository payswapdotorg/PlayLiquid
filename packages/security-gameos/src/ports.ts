/**
 * PORTS + STATE DOCUMENT (PL-041, E6/E10) — the host-owned effect seams
 * and the serializable whole-state document.
 *
 * The authority is pure: persistence, time, its own role grants, the
 * platform grant directory, the capability-broker snapshot, the package
 * registry/CAS reads, the economy entitlement reads, the integrity
 * standing reads and the arena escalation-case reads ALL arrive through
 * these injected interfaces. Read ports are READ-ONLY by construction —
 * no port here can mutate a sibling service's live state.
 *
 * The state document is the whole-authority snapshot (E10): append-only
 * histories (ledger, standings, elevated rights, bindings) plus the
 * revision counter; restoring adopts the WHOLE document — there is no
 * partial apply, and a tampered document never re-enters.
 *
 * Purity: interfaces + structural data + one structural guard. No IO.
 */

import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import type { IntegrityRiskVerdict, SettlementEligibilityDeclaration } from "@playliquid/platform-contracts";
import type { EntitlementGrantId } from "@playliquid/platform-contracts";
import type { EntitlementView } from "@playliquid/platform-economy";
import type { RegistryReadAccess } from "@playliquid/package-registry";
import type { ArtifactStore } from "@playliquid/artifact-store";
import type { AvatarDefinition } from "@playliquid/avatar-runtime";
import type { BrokerPolicy } from "@playliquid/capability-broker";
import type { BudgetLedger, CapabilityGrant } from "@playliquid/runtime-contracts";
import type { HostRestriction } from "@playliquid/game-contracts";
import type { RightsAuthorityGrant } from "./vocabulary.ts";

// ---------------------------------------------------------------------------
// Core ports (time + durability + the authority's own role seam)
// ---------------------------------------------------------------------------

/** The only time source the authority will ever consult (E9). */
export interface RightsClockPort {
  readonly now: () => number;
}

/** One durable, content-addressed whole-state snapshot. */
export interface StoredRightsSnapshot {
  readonly snapshotId: string;
  readonly revision: number;
  readonly document: RightsStateDocument;
}

/** The durability port. Real adapters are host concerns. */
export interface RightsStorePort {
  readonly save: (snapshot: StoredRightsSnapshot) => void;
  readonly list: () => readonly StoredRightsSnapshot[];
  readonly load: (snapshotId: string) => StoredRightsSnapshot | undefined;
}

/** The authority's own role seam (R20): current role grants. */
export interface RightsAdminDirectory {
  readonly grants: () => readonly RightsAuthorityGrant[];
}

// ---------------------------------------------------------------------------
// Read-only composition ports (the sibling authorities)
// ---------------------------------------------------------------------------

/** The platform least-privilege seam: current platform capability grants. */
export interface PlatformGrantDirectory {
  readonly grants: () => readonly ScopedCapabilityGrant[];
}

/** A consistent read snapshot of the capability broker's authoritative state. */
export interface BrokerSnapshot {
  readonly grants: readonly CapabilityGrant[];
  readonly policy: BrokerPolicy;
  readonly ledger: BudgetLedger;
}

/** The capability broker seam (read-only — the broker stays the owner). */
export interface BrokerSnapshotPort {
  readonly snapshot: () => BrokerSnapshot;
}

/** The package registry read seam (RegistryReadAccess-compatible, read-only). */
export interface RegistryReadPort extends RegistryReadAccess {}

/** The CAS artifact store seam (verification reads only). */
export interface ArtifactsPort extends ArtifactStore {}

/** One entitlement as the economy surfaces it (read model). */
export type EntitlementRead = EntitlementView;

/** The economy seam (R10): declarations + entitlement reads, never mutations. */
export interface EconomyReadPort {
  /** The tenant's admitted settlement declarations (the game-declared event kinds). */
  readonly declarationsOf: (tenant: string) => readonly SettlementEligibilityDeclaration[];
  /** One entitlement's record in the tenant, or `undefined` when not recorded there. */
  readonly entitlementIn: (tenant: string, entitlement: EntitlementGrantId) => EntitlementRead | undefined;
}

/** The integrity standing seam (R11): the subject's latest recorded verdict. */
export type StandingRead =
  | { readonly ok: true; readonly verdict: IntegrityRiskVerdict }
  | { readonly ok: false; readonly code: "no-recorded-verdict" };

/** The integrity standing seam (read-only). */
export interface IntegrityStandingPort {
  readonly standingFor: (tenant: string, subject: string) => StandingRead;
}

/** One arena escalation case as the rights authority reads it (passive data). */
export interface EscalationCaseReadRecord {
  readonly caseId: string;
  readonly tenant: string;
  readonly decidedBy: string;
  /** The arena lifecycle state text (`ingested` is the mint precondition). */
  readonly state: string;
  /** The case's content-addressed identity digest (the evidence pin). */
  readonly caseDigest: string;
}

/** The read result of the arena seam: verbatim PL-031 case-read codes. */
export type EscalationCaseRead =
  | { readonly ok: true; readonly record: EscalationCaseReadRecord }
  | { readonly ok: false; readonly code: "unknown-case" | "cross-tenant" };

/** The arena escalation seam (ingestion-only reads; never mutations). */
export interface EscalationCasesPort {
  readonly caseOf: (tenant: string, caseId: string) => EscalationCaseRead;
}

// ---------------------------------------------------------------------------
// The state document (E10 append-only histories + revision)
// ---------------------------------------------------------------------------

/** One (tenant, host) avatar binding: the composed definition + the R5 restriction. */
export interface HostBindingRecord {
  readonly tenant: string;
  readonly host: string;
  readonly definition: AvatarDefinition;
  readonly restriction: HostRestriction;
  readonly registeredAt: number;
  readonly revision: number;
}

/** One (tenant, sessionId) runtime-session binding (R20). */
export interface SessionBindingRecord {
  readonly tenant: string;
  readonly sessionId: string;
  readonly boundAt: number;
  readonly revision: number;
}

/** Disposition of one ingested integrity standing (R11 — probabilistic, never certainty). */
export type StandingDisposition = "suspended" | "flagged" | "held-clear";

/**
 * One integrity-derived lattice entry. STRUCTURALLY carries the verdict
 * kind, the DERIVED confidence band and the aggregate interval — and
 * NOTHING that could represent certainty (no boolean guilt field exists
 * anywhere on this type, by construction).
 */
export interface IntegrityRightsEntry {
  readonly entryId: string;
  readonly tenant: string;
  readonly subject: string;
  readonly verdictId: string;
  readonly disposition: StandingDisposition;
  readonly verdictKind: string;
  readonly band: string;
  readonly confidence: { readonly lower: number; readonly upper: number };
  readonly ingestedAt: number;
  readonly revision: number;
}

/** One elevated review right minted from an ingested arena escalation case. */
export interface ElevatedReviewRight {
  readonly rightId: string;
  readonly tenant: string;
  readonly subject: string;
  readonly caseId: string;
  readonly evidenceDigest: string;
  readonly mintedAt: number;
  readonly revision: number;
}

/** One append-only refusal-ledger record (E10; refusals are first-class). */
export interface RefusalRecord {
  readonly refusalId: string;
  readonly tenant: string;
  readonly subject: string;
  readonly code: string;
  readonly detail: string;
  readonly evidence: readonly string[];
  readonly at: number;
  readonly revision: number;
}

/** The whole-state document (snapshot payload). */
export interface RightsStateDocument {
  readonly documentKind: "rights-state";
  readonly revision: number;
  readonly bindings: readonly HostBindingRecord[];
  readonly sessions: readonly SessionBindingRecord[];
  readonly standings: readonly IntegrityRightsEntry[];
  readonly elevated: readonly ElevatedReviewRight[];
  readonly ledger: readonly RefusalRecord[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns true when `value` is structurally a {@link RightsStateDocument}. */
export function isRightsStateDocument(value: unknown): value is RightsStateDocument {
  if (!isPlainObject(value)) return false;
  const document = value as Record<string, unknown>;
  if (document.documentKind !== "rights-state") return false;
  if (typeof document.revision !== "number" || !Number.isSafeInteger(document.revision)) return false;
  if (!Array.isArray(document.bindings) || !Array.isArray(document.sessions)) return false;
  if (!Array.isArray(document.standings) || !Array.isArray(document.elevated)) return false;
  if (!Array.isArray(document.ledger)) return false;
  const refusalFields = ["refusalId", "tenant", "subject", "code", "detail", "at", "revision"];
  return document.ledger.every((entry) => {
    if (!isPlainObject(entry)) return false;
    return (
      refusalFields.every((field) => field in entry) &&
      Array.isArray((entry as Record<string, unknown>).evidence)
    );
  });
}

// ---------------------------------------------------------------------------
// Service construction
// ---------------------------------------------------------------------------

/** Construction options: the injected ports (all of them). */
export interface RightsServiceOptions {
  readonly clock: RightsClockPort;
  readonly store: RightsStorePort;
  readonly admins: RightsAdminDirectory;
  readonly platformGrants: PlatformGrantDirectory;
  readonly broker: BrokerSnapshotPort;
  readonly registry: RegistryReadPort;
  readonly artifacts: ArtifactsPort;
  readonly economy: EconomyReadPort;
  readonly integrity: IntegrityStandingPort;
  readonly escalations: EscalationCasesPort;
}
