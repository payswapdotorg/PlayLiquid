/**
 * ECONOMY SERVICE DOOR CONTRACTS (PL-017) — the result/option shapes of
 * the service's public doors, split from service.ts for the 400-line
 * ceiling and shared with the internal application engine (apply.ts).
 *
 * The domain-module shapes live with their authorities: lifecycle door
 * results in lifecycle.ts, ledger door results in ledger.ts, policy
 * admission in policies.ts, settlement admission in settlement.ts.
 * This module holds only the service-level composites.
 *
 * Purity: types only.
 */

import type {
  EntitlementGrant,
  EntitlementLifecycleRecord,
} from "@playliquid/platform-contracts";
import type { RegisteredRewardPolicy } from "./policies.ts";
import type { SettlementReceipt } from "./records.ts";
import type { EntitlementProvenance } from "./records.ts";
import type { ContentDigest } from "@playliquid/platform-contracts";
import type {
  EconomyStore,
  EconomyValueResolver,
  GrantDirectory,
  ServiceClock,
} from "./ports.ts";
import type { RewardIntegrityPort } from "./integrity-port.ts";

/** Construction options of the economy service. */
export interface EconomyServiceOptions {
  readonly store: EconomyStore;
  readonly clock: ServiceClock;
  readonly grants: GrantDirectory;
  /** The PL-018 seam: consulted before settlement (host wires the real adapter later). */
  readonly integrity: RewardIntegrityPort;
  /** The magnitude seam: digest-pinned values resolve to quantities here. */
  readonly values: EconomyValueResolver;
}

/** Settlement result: admission plus the receipt, or the recorded one (E10). */
export type SettleEventResult =
  | { readonly accepted: true; readonly receipt: SettlementReceipt }
  | { readonly accepted: false; readonly code: string; readonly detail: string; readonly recorded?: SettlementReceipt };

/** Generic refusal result for administration and queries. */
export type EconomyRefusal = { readonly ok: false; readonly code: string; readonly detail: string };

/** Result of policy registration (typed conflicts, never silent overwrite). */
export type RegisterPolicyResult =
  | { readonly ok: true; readonly registered: RegisteredRewardPolicy }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/** Result of snapshot/restore. */
export type SnapshotResult =
  | { readonly ok: true; readonly snapshotId: ContentDigest; readonly revision: number }
  | EconomyRefusal;

/** One entitlement as a read model (grant + lifecycle + provenance). */
export interface EntitlementView {
  readonly grant: EntitlementGrant;
  readonly lifecycle: EntitlementLifecycleRecord;
  readonly provenance: EntitlementProvenance;
}
