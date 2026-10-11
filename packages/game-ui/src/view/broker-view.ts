/**
 * BROKER READ MODELS (pure): project capability-broker authoritative data
 * (PL-026) — the BrokerPolicy (coverage + restrictions), the active grant
 * table and broker evaluation outcomes — into the studio Capabilities
 * surface: capability coverage rows, restriction chips and grant rows.
 *
 * The broker is THE runtime permission authority (lock rule 4); this module
 * READS policy/grant state and never re-derives admission decisions (E5).
 * Pure module: no IO, no React.
 */

import type {
  BrokerPolicy,
  CapabilityBroker,
} from "@playliquid/capability-broker";
import type {
  ActionResolution,
  CapabilityGrant,
  CapabilityId,
  IntentKind,
} from "@playliquid/runtime-contracts";
import type { UiStatus } from "./status.ts";

/** One capability coverage row: the intents a capability authorizes. */
export interface CoverageRow {
  readonly capability: string;
  readonly intentKinds: readonly string[];
  readonly status: UiStatus;
}

/** One restriction chip (host-denied or approval-required). */
export interface RestrictionChip {
  readonly capability: string;
  readonly kind: "denied" | "approval-required";
}

/** One active grant row. */
export interface GrantRow {
  readonly grantId: string;
  readonly capability: string;
  readonly holder: string;
  readonly epoch: number;
  readonly expiresAfterTick: number | null;
}

/** One evaluation row of the capability timeline. */
export interface EvaluationRow {
  readonly intentKind: string;
  readonly status: UiStatus;
  readonly commandKind: string | null;
  readonly requestId: string;
}

/** The Capabilities surface view model. */
export interface BrokerView {
  readonly coverage: readonly CoverageRow[];
  readonly restrictions: readonly RestrictionChip[];
  readonly grants: readonly GrantRow[];
  readonly evaluations: readonly EvaluationRow[];
  readonly deniedCount: number;
}

function holderName(grant: CapabilityGrant): string {
  const holder = grant.holder as { actorId?: unknown; actorClass?: unknown };
  const actorId = typeof holder.actorId === "string" ? holder.actorId : String(holder.actorId ?? "unknown");
  return actorId;
}

/**
 * Project a broker policy (+ live broker instance when available) into the
 * Capabilities view. Coverage rows carry the intents each capability
 * authorizes; restrictions surface the R5 host restrictions the policy
 * enforces; grants come from the broker's authoritative table.
 */
export function projectBroker(
  policy: BrokerPolicy,
  broker?: CapabilityBroker,
  evaluations?: readonly { readonly intentKind: IntentKind; readonly resolution: ActionResolution }[],
): BrokerView {
  const coverage: CoverageRow[] = Object.keys(policy.capabilityIntentKinds)
    .sort()
    .map((capability) => {
      const intents = policy.capabilityIntentKinds[capability] ?? [];
      const denied = policy.restrictions.denied.some((id) => String(id) === capability);
      const approval = policy.restrictions.approvalRequired.some((id) => String(id) === capability);
      return {
        capability,
        intentKinds: intents.map(String),
        status: denied
          ? { label: "host-denied", tone: "error" } satisfies UiStatus
          : approval
            ? { label: "approval required", tone: "warn" } satisfies UiStatus
            : { label: "declared", tone: "info" } satisfies UiStatus,
      };
    });

  const restrictions: RestrictionChip[] = [
    ...policy.restrictions.denied.map((id) => ({ capability: String(id), kind: "denied" as const })),
    ...policy.restrictions.approvalRequired.map((id) => ({
      capability: String(id),
      kind: "approval-required" as const,
    })),
  ].sort((a, b) => a.capability.localeCompare(b.capability));

  const grants: GrantRow[] = (broker?.grants ?? [])
    .map((grant) => ({
      grantId: String(grant.grantId),
      capability: String(grant.capability),
      holder: holderName(grant),
      epoch: Number(grant.epoch),
      expiresAfterTick: grant.expiresAfterTick === undefined ? null : Number(grant.expiresAfterTick),
    }))
    .sort((a, b) => a.grantId.localeCompare(b.grantId));

  const evaluationRows: EvaluationRow[] = (evaluations ?? []).map(({ intentKind, resolution }) => ({
    intentKind: String(intentKind),
    status:
      resolution.status === "granted"
        ? { label: "granted", tone: "ok" } satisfies UiStatus
        : { label: "denied", tone: "error", note: String(resolution.reason) } satisfies UiStatus,
    commandKind:
      resolution.status === "granted" ? String(resolution.command.kind) : null,
    requestId: String(resolution.requestId),
  }));

  return {
    coverage,
    restrictions,
    grants,
    evaluations: evaluationRows,
    deniedCount: policy.restrictions.denied.length,
  };
}

/** Deterministic summary line for headers. */
export function brokerSummary(view: BrokerView): string {
  const capabilities = view.coverage.length;
  const grants = view.grants.length;
  return `${capabilities} capabilit${capabilities === 1 ? "y" : "ies"} · ${grants} active grant${grants === 1 ? "" : "s"} · ${view.deniedCount} host-denied`;
}

/** Re-exports for component typing. */
export type { CapabilityId };
