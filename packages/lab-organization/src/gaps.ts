/**
 * CAPABILITY-GAP AWARENESS (PL-029) — typed gap findings resolved through
 * lab-contracts' FROZEN gap ladder (R18; lock rules 30/31/32; spec/
 * architecture.md "Capability gaps": existing organization → alternate
 * organization → package/platform capability → user/community contribution
 * → Arena → blocked).
 *
 * This module CONSUMES the ladder authority (lab-contracts gap-ladder.ts)
 * and never re-implements it:
 *
 * - {@link detectCapabilityGaps} — pure detection: every capability a
 *   CANDIDATE organization allocates that the CURRENT organization lacks
 *   is a typed {@link CapabilityGapFinding}. Findings are returned and
 *   recorded, never silently skipped (lock 30: explicit and auditable);
 * - {@link openGapFromFinding} — the finding becomes a lab-contracts
 *   {@link CapabilityGapRecord} whose trail STARTS at rung 1
 *   (existing-organization, disposition `unavailable`, outcome
 *   `unresolved` — the current organization lacks the capability by
 *   construction of the finding);
 * - {@link advanceGapResolution} — one rung at a time through
 *   lab-contracts' own stepwise transition oracle; `blocked` is a TYPED
 *   TERMINAL (the ladder refuses anything after it with
 *   `blocked-is-terminal`), Arena-first is refused with
 *   `arena-first-resort`, rung skipping with `rung-skip`, and a resolved
 *   gap takes no further rungs (`gap-already-resolved`).
 *
 * Arena appears ONLY as the provider-neutral `ArenaEscalationRef` (lock
 * 32): this package builds NO escalation request and performs NO Arena
 * call — arena-integration (PL-007) owns the wire, and PL-031 owns the
 * runtime integration (deliberate deferral, E11).
 *
 * Pure module: no IO, no clocks (openedAt is caller-supplied), no network.
 */

import type {
  CapabilityGapRecord,
  ContentDigest,
  GapRecordId,
  GapRungAttempt,
  GapRungOutcome,
  LabCycleId,
  OrganizationDescriptor,
  OrganizationId,
  TimestampMs,
} from "@playliquid/lab-contracts";
import { appendGapRungAttempt, validateGapRecord } from "@playliquid/lab-contracts";
import type { GapDoorRefusalCode } from "./records.ts";
import { candidateDigestOf, gapFindingDigestOf, gapSlugId } from "./digest.ts";

/** One typed capability-gap finding (detection output, pre-record). */
export interface CapabilityGapFinding {
  /** The capability the candidate requires and the current org lacks. */
  readonly missingCapability: string;
  readonly currentOrganization: OrganizationId;
  readonly candidateOrganization: OrganizationId;
  readonly candidateDigest: ContentDigest;
}

/**
 * Detects the typed capability gaps between the current organization and
 * one candidate: every capability the candidate allocates that the current
 * organization lacks. Pure; deterministic (candidate declaration order).
 */
export function detectCapabilityGaps(input: {
  readonly current: OrganizationDescriptor;
  readonly candidate: OrganizationDescriptor;
}): readonly CapabilityGapFinding[] {
  const held = new Set(input.current.capabilities.map((allocation) => String(allocation.capability)));
  const candidateDigest = candidateDigestOf(input.candidate);
  const findings: CapabilityGapFinding[] = [];
  for (const allocation of input.candidate.capabilities) {
    if (!held.has(String(allocation.capability))) {
      findings.push({
        missingCapability: String(allocation.capability),
        currentOrganization: input.current.id,
        candidateOrganization: input.candidate.id,
        candidateDigest,
      });
    }
  }
  return Object.freeze(findings);
}

/** Input of {@link openGapFromFinding}. */
export interface OpenGapInput {
  readonly finding: CapabilityGapFinding;
  readonly tenant: string;
  readonly cycleId: LabCycleId;
  /** Caller-supplied open time (no clock authority here). */
  readonly openedAt: TimestampMs;
}

/** Result of {@link openGapFromFinding}. */
export type OpenGapResult =
  | { readonly ok: true; readonly gap: CapabilityGapRecord; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: GapDoorRefusalCode; readonly detail: string };

/**
 * Opens (or returns the already-recorded) gap record of one finding: the
 * trail starts at the existing-organization rung — attempted honestly as
 * `unavailable`/`unresolved`, because the finding IS the proof that the
 * current organization lacks the capability. The record is validated
 * against lab-contracts' own gap validator before it is returned.
 */
export function openGapFromFinding(input: OpenGapInput, known: readonly CapabilityGapRecord[]): OpenGapResult {
  const gapId = gapSlugId(
    gapFindingDigestOf({
      tenant: input.tenant,
      missingCapability: input.finding.missingCapability,
      candidateDigest: input.finding.candidateDigest,
    }),
  );
  const existing = known.find((gap) => String(gap.gapId) === String(gapId));
  if (existing !== undefined) {
    return { ok: true, gap: existing, duplicate: true };
  }
  const gap: CapabilityGapRecord = {
    gapId,
    cycleId: input.cycleId,
    missingCapability: input.finding.missingCapability,
    summary: `candidate ${String(input.finding.candidateOrganization)} requires ${input.finding.missingCapability} which organization ${String(input.finding.currentOrganization)} lacks`,
    openedAt: input.openedAt,
    attempts: [
      {
        rung: "existing-organization",
        disposition: "unavailable",
        outcome: "unresolved",
        organization: input.finding.currentOrganization,
      },
    ],
  };
  const validation = validateGapRecord(gap);
  if (!validation.ok) {
    return {
      ok: false,
      code: "invalid-attempt",
      detail: `generated gap record failed lab-contracts validation: ${validation.violations[0]?.code ?? "violations"}`,
    };
  }
  return { ok: true, gap, duplicate: false };
}

/** Result of {@link advanceGapResolution}. */
export type GapAdvanceResult =
  | { readonly ok: true; readonly gap: CapabilityGapRecord }
  | { readonly ok: false; readonly code: GapDoorRefusalCode; readonly detail: string };

/**
 * Advances one gap record along the frozen ladder by EXACTLY ONE rung —
 * the lab-contracts state machine (appendGapRungAttempt) is the single
 * transition authority; this wrapper only surfaces its typed refusals.
 * `blocked` is terminal: no rung may follow it.
 */
export function advanceGapResolution(gap: CapabilityGapRecord, attempt: GapRungAttempt): GapAdvanceResult {
  const advanced = appendGapRungAttempt(gap, attempt);
  if (!advanced.ok) {
    return { ok: false, code: advanced.code, detail: advanced.detail };
  }
  return { ok: true, gap: advanced.gap };
}

/** Parses a gap record id (read paths). */
export function asGapRecordId(text: string): GapRecordId | undefined {
  return text.length > 0 && text.length <= 63 && /^[a-z0-9-]+$/.test(text) ? (text as GapRecordId) : undefined;
}

/** Type re-export for callers building rung attempts (typed at every rung). */
export type { GapRungAttempt, GapRungOutcome };
