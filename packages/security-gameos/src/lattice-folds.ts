/**
 * LATTICE SHARED FOLDS (PL-041) — the adjudication result shapes and the
 * arm-shared pure helpers, split from lattice.ts for the 400-line ceiling
 * (the platform-economy service-types precedent).
 *
 * The effective right, the typed adjudication result (E8: refusals carry
 * frozen codes, never swallowed), the lattice input bundle, the suspension
 * lookup (R11 latest-ingestion-wins) and the binding folds live here so
 * every arm module shares ONE definition.
 *
 * Purity: types + pure folds only.
 */

import type { ScopedCapabilityGrant } from "@playliquid/platform-contracts";
import type { ActionDenialReason, ActionResolution } from "@playliquid/runtime-contracts";
import type {
  BrokerSnapshot,
  ElevatedReviewRight,
  HostBindingRecord,
  IntegrityRightsEntry,
  RefusalRecord,
  SessionBindingRecord,
} from "./ports.ts";
import type { LatticeRefusalCode, RightsRequest } from "./vocabulary.ts";

/** The integrity evidence note attached to a right/refusal (R11, probabilistic only). */
export interface IntegrityEvidenceNote {
  readonly verdictId: string;
  readonly verdictKind: string;
  readonly band: string;
  readonly confidence: { readonly lower: number; readonly upper: number };
}

/** One effective right, as adjudicated. */
export interface EffectiveRight {
  readonly tenant: string;
  readonly subject: string;
  readonly capability: string;
  readonly basis: readonly string[];
  readonly integrityEvidence?: IntegrityEvidenceNote;
}

/** Result of one adjudication. Refusals are typed, never swallowed (E8). */
export type AdjudicationResult =
  | { readonly granted: true; readonly right: EffectiveRight }
  | {
      readonly granted: false;
      readonly code: LatticeRefusalCode;
      readonly detail: string;
      readonly evidence: readonly string[];
      /** Set by the service when this refusal content was already ledgered (E10). */
      readonly recorded?: RefusalRecord;
    };

/** Everything the pure lattice needs (snapshots + owned state). */
export interface LatticeInputs {
  readonly platformGrants: readonly ScopedCapabilityGrant[];
  readonly broker: BrokerSnapshot;
  readonly bindings: readonly HostBindingRecord[];
  readonly sessions: readonly SessionBindingRecord[];
  readonly standings: readonly IntegrityRightsEntry[];
  readonly elevated: readonly ElevatedReviewRight[];
}

/** The subject's CURRENT standing entry (latest ingestion wins, E10). */
export function currentSuspension(
  tenant: string,
  subject: string,
  standings: readonly IntegrityRightsEntry[],
): IntegrityRightsEntry | undefined {
  let current: IntegrityRightsEntry | undefined;
  for (const entry of standings) {
    if (entry.tenant === tenant && entry.subject === subject && entry.disposition === "suspended") {
      current = entry;
    }
  }
  return current;
}

/** The refusal a suspended subject meets on an otherwise-granted arm (R11). */
export function suspended(entry: IntegrityRightsEntry | undefined): AdjudicationResult | undefined {
  if (entry === undefined) return undefined;
  return {
    granted: false,
    code: "suspended-by-integrity",
    detail: `integrity standing ${entry.verdictKind} (band ${entry.band}) suspends this right`,
    evidence: [`verdict:${entry.verdictId}`, `band:${entry.band}`],
  };
}

/** The granted result of one arm (probabilistic evidence attached when held). */
export function right(
  request: RightsRequest,
  capability: string,
  basis: readonly string[],
  suspension: IntegrityRightsEntry | undefined,
): AdjudicationResult {
  return {
    granted: true,
    right: {
      tenant: request.tenant,
      subject: request.subject,
      capability,
      basis,
      ...(suspension === undefined
        ? {}
        : {
            integrityEvidence: {
              verdictId: suspension.verdictId,
              verdictKind: suspension.verdictKind,
              band: suspension.band,
              confidence: suspension.confidence,
            },
          }),
    },
  };
}

/** The latest (tenant, host) binding — later registrations supersede (E10). */
export function latestBinding(
  bindings: readonly HostBindingRecord[],
  tenant: string,
  host: string,
): HostBindingRecord | undefined {
  let current: HostBindingRecord | undefined;
  for (const binding of bindings) {
    if (binding.tenant === tenant && binding.host === host) current = binding;
  }
  return current;
}

/** The latest session binding for one session id (E10). */
export function latestSession(
  sessions: readonly SessionBindingRecord[],
  sessionId: string,
): SessionBindingRecord | undefined {
  let current: SessionBindingRecord | undefined;
  for (const binding of sessions) {
    if (binding.sessionId === sessionId) current = binding;
  }
  return current;
}

/** The invalid-request refusal (an unknown arm or malformed capability). */
export function invalid(detail: string): AdjudicationResult {
  return { granted: false, code: "invalid-request", detail, evidence: [] };
}

/** Narrows a resolution to its denial reason (test support). */
export function denialReasonOf(resolution: ActionResolution<unknown>): ActionDenialReason | undefined {
  return resolution.status === "denied" ? resolution.reason : undefined;
}
