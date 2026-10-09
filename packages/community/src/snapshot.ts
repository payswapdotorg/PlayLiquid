/**
 * SNAPSHOT MACHINERY (E6/E10) — pure build/validate functions over the
 * community service's state document, used by `snapshot()`/`restore()`.
 *
 * Building is a projection of owned state into plain rows; validation is
 * DEEP: every contribution row must be structurally valid AND its id
 * must be the content address of its own submission identity; every
 * transition row must carry the content address of its own content. A
 * tampered snapshot (mutated row body, swapped id, forged record) is
 * refused — restore is whole-document or nothing.
 *
 * Purity: no IO (the store port owns persistence).
 */

import { contributionIdOf, isContributionTransitionRecord, submissionIdentityOf } from "./history.ts";
import type { ContributionRow, ContributionTransitionRecord, TransitionRow } from "./history.ts";
import { isContributionRecord, canTransitionContribution } from "./records.ts";
import type { ContributionRecord } from "./records.ts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";

/** The full serializable state of the community service at one revision. */
export interface CommunityStateDocument {
  readonly revision: number;
  readonly contributions: readonly ContributionRow[];
  readonly transitions: readonly TransitionRow[];
  readonly evidenceRegistry: readonly { readonly digest: string; readonly recordId: string }[];
}

/** The owned state pieces the document is built from. */
export interface StateProjection {
  readonly revision: number;
  readonly contributions: readonly ContributionRecord[];
  readonly transitions: readonly ContributionTransitionRecord[];
  readonly evidence: ReadonlyMap<string, string>;
}

/** Projects owned state into the serializable document (rows are shared
 * immutable values; the codec owns byte encoding). */
export function buildCommunityDocument(state: StateProjection): CommunityStateDocument {
  return {
    revision: state.revision,
    contributions: state.contributions.map((record) => ({
      contributionId: String(record.contributionId),
      tenant: String(record.tenant),
      contributor: String(record.contributor),
      kind: record.kind,
      payload: record.payload,
      provenance: record.provenance,
      gap: record.gap,
      status: record.status,
      submittedAt: record.submittedAt,
      decidedBy: record.decidedBy,
    })),
    transitions: state.transitions.map((entry) => ({
      recordId: String(entry.recordId),
      tenant: String(entry.tenant),
      contributionId: String(entry.contributionId),
      actor: String(entry.actor),
      from: entry.from,
      to: entry.to,
      reason: entry.reason,
      recordedAt: entry.recordedAt,
      decidedBy: entry.decidedBy,
    })),
    evidenceRegistry: [...state.evidence.entries()].map(([digest, recordId]) => ({ digest, recordId })),
  };
}

/** The validated state pieces a restore re-adopts, whole. */
export interface ValidatedState {
  readonly contributions: Map<string, ContributionRecord>;
  readonly transitions: ContributionTransitionRecord[];
  readonly evidence: Map<string, string>;
}

/**
 * Deep validation of one decoded document. Every row is structurally
 * guarded and content-address-checked; the workflow chain of every
 * contribution is verified (genesis first, consecutive steps, legal
 * transitions only, final status equals the last recorded step — a
 * tampered status/body/id is refused); orphan transitions are refused.
 * Failures are typed details, never exceptions.
 */
export function validateCommunityDocument(document: unknown):
  | { readonly ok: true; readonly revision: number; readonly state: ValidatedState }
  | { readonly ok: false; readonly detail: string } {
  if (typeof document !== "object" || document === null) {
    return { ok: false, detail: "document is not an object" };
  }
  const candidate = document as Partial<CommunityStateDocument>;
  if (
    typeof candidate.revision !== "number" ||
    !Array.isArray(candidate.contributions) ||
    !Array.isArray(candidate.transitions) ||
    !Array.isArray(candidate.evidenceRegistry)
  ) {
    return { ok: false, detail: "document is not a community state document" };
  }
  const contributions = new Map<string, ContributionRecord>();
  for (const row of candidate.contributions) {
    if (!isContributionRecord(row)) {
      return { ok: false, detail: "a contribution row is structurally invalid" };
    }
    const identity = submissionIdentityOf(
      row.tenant as TenantId,
      row.contributor as SubjectId,
      row.kind,
      row.payload,
      row.provenance.origin,
      row.provenance.aiGenerated,
      row.provenance.modelProvenance,
    );
    if (String(contributionIdOf(identity)) !== String(row.contributionId)) {
      return { ok: false, detail: "a contribution id does not address its own submission content (tampered)" };
    }
    contributions.set(String(row.contributionId), row);
  }
  const transitionsByContribution = new Map<string, ContributionTransitionRecord[]>();
  const transitions: ContributionTransitionRecord[] = [];
  for (const row of candidate.transitions) {
    if (!isContributionTransitionRecord(row)) {
      return {
        ok: false,
        detail: "a transition record is invalid or its id is not its content address (tampered)",
      };
    }
    transitions.push(row);
    const key = String(row.contributionId);
    const chain = transitionsByContribution.get(key) ?? [];
    chain.push(row);
    transitionsByContribution.set(key, chain);
  }
  // Workflow coherence per contribution: genesis, consecutive legal
  // steps, terminal status equals the last recorded step, same tenant.
  for (const row of candidate.contributions) {
    const key = String(row.contributionId);
    const chain = transitionsByContribution.get(key) ?? [];
    if (chain.length === 0) {
      return { ok: false, detail: "a contribution carries no recorded history (tampered)" };
    }
    const first = chain[0]!;
    if (first.from !== null || first.to !== "submitted" || first.tenant !== row.tenant) {
      return { ok: false, detail: "a contribution's history does not start at its genesis submission" };
    }
    for (let index = 1; index < chain.length; index += 1) {
      const previous = chain[index - 1]!;
      const current = chain[index]!;
      if (previous.to !== current.from || current.tenant !== row.tenant) {
        return { ok: false, detail: "a history chain is not consecutive within one tenant (tampered)" };
      }
      if (!canTransitionContribution(previous.to, current.to)) {
        return { ok: false, detail: "a history chain contains an illegal workflow step (tampered)" };
      }
    }
    const last = chain[chain.length - 1]!;
    if (last.to !== row.status) {
      return {
        ok: false,
        detail: "a contribution status does not match its recorded history (tampered)",
      };
    }
    transitionsByContribution.delete(key);
  }
  if (transitionsByContribution.size > 0) {
    return { ok: false, detail: "orphan transitions reference unknown contributions (tampered)" };
  }
  const evidence = new Map<string, string>();
  for (const entry of candidate.evidenceRegistry) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { digest?: unknown }).digest !== "string" ||
      typeof (entry as { recordId?: unknown }).recordId !== "string"
    ) {
      return { ok: false, detail: "an evidence registry row is malformed" };
    }
    evidence.set((entry as { digest: string }).digest, (entry as { recordId: string }).recordId);
  }
  return { ok: true, revision: candidate.revision, state: { contributions, transitions, evidence } };
}

/** Read-model deep copy (E8: no shared mutable state with the owner). */
export function cloneContribution(record: ContributionRecord): ContributionRecord {
  return structuredClone(record);
}
