/**
 * THE COMMUNITY SERVICE — the contribution-state authority (PL-032;
 * matrix design-intent row `community | Product | git-lineage, game-ir`).
 *
 * The service instance is the single mutable-state owner (E1): it owns
 * the contribution records, the append-only transition history, the
 * evidence registry and the revision. Clients receive read models and
 * typed admissions only; contribution facts are ONLY ever recorded here,
 * stamped with the platform authority marker (E8). This service tracks
 * CONTRIBUTION STATE ONLY — Git lineage semantics stay with git-lineage
 * and packaging with package-registry, both referenced through ports.
 *
 * Async/stateful discipline (spec/worker-contract.md), every item owned
 * and tested: MUTABLE STATE OWNER — this instance (persistence through
 * the CommunityStore port, time through ServiceClock, identity/maintainer
 * facts through SubjectDirectory, Lab gap facts through GapDirectory,
 * registry qualification through PackageRegistrySeam). COMMAND ADMISSION
 * — `submit` and `transition` are the only doors; each derives the
 * content-addressed evidence key, encounters the idempotency registry,
 * then runs the pure oracle (admission.ts) over facts derived from OWNED
 * state and ports. EVENT ORDER — transition records append in admission
 * order; a record's status advances 1:1 with its transition; the revision
 * advances 1:1 with every admitted mutation. IDEMPOTENCY KEY —
 * submissions: the content-addressed contribution id; transitions: the
 * content-addressed command key (history.ts); same key -> the recorded
 * receipt, never a second mutation (E10). STALE-RESULT RULE — reads
 * reflect current state; transition records never change after
 * recording. REPLAY/RESUME BOUNDARY — `snapshot()` persists a
 * content-addressed checkpoint (bigint-safe codec, ports.ts);
 * `restore()` re-adopts a stored document WHOLE after deep validation.
 * RETRY/CANCELLATION — a rejected command is not recorded, so a
 * corrected retry is a fresh encounter; a replayed admitted command
 * returns its receipt. Synchronous domain — nothing to cancel.
 *
 * Least privilege note: the frozen game-contracts capability vocabulary
 * has no "community" capability (lock 17), and that vocabulary is
 * outside this work order's write surface. Tenant isolation is therefore
 * enforced structurally (the platform-identity precedent): every record,
 * query and command is tenant-scoped, cross-tenant actors and
 * contributors are refused with typed codes, and maintainer facts arrive
 * through the SubjectDirectory seam. Recorded decision.
 */

import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import { adjudicateSubmission, adjudicateTransition, lineageBaseOf } from "./admission.ts";
import type {
  CommunityServicePolicy,
  ContributionRefusalCode,
  LineageBaseQualification,
  SubmissionFacts,
  SubmitContributionCommand,
  TransitionCommand,
  TransitionRefusalCode,
} from "./admission.ts";
import {
  contributionIdOf,
  submissionIdentityOf,
  submissionTransitionOf,
  transitionCommandKeyOf,
  transitionRecordIdOf,
} from "./history.ts";
import type { ContributionTransitionRecord } from "./history.ts";
import { isGameIRValue } from "@playliquid/game-ir";
import { decodeSnapshotDocument, encodeSnapshotDocument } from "./ports.ts";
import type {
  CommunityStore,
  GapDirectory,
  PackageRegistrySeam,
  ServiceClock,
  SubjectDirectory,
} from "./ports.ts";
import { buildCommunityDocument, cloneContribution, validateCommunityDocument } from "./snapshot.ts";
import { isContributionProvenanceInput } from "./records.ts";
import type { ContributionId, ContributionRecord } from "./records.ts";

/** Construction options (all ports + policy). */
export interface CommunityServiceOptions {
  readonly store: CommunityStore;
  readonly clock: ServiceClock;
  readonly directory: SubjectDirectory;
  readonly gaps: GapDirectory;
  readonly packages: PackageRegistrySeam;
  readonly policy: CommunityServicePolicy;
}

/** Admission result enriched with the recorded receipt (E10). */
export type SubmitResult =
  | { readonly accepted: true; readonly contribution: ContributionRecord }
  | {
      readonly accepted: false;
      readonly code: ContributionRefusalCode;
      readonly detail: string;
      /** The first receipt, when the refusal is a duplicate replay (E10). */
      readonly recorded?: ContributionTransitionRecord;
    };

/** Admission result of one workflow command (E10 receipt on replays). */
export type TransitionResult =
  | { readonly accepted: true; readonly record: ContributionTransitionRecord; readonly status: string }
  | {
      readonly accepted: false;
      readonly code: TransitionRefusalCode;
      readonly detail: string;
      readonly recorded?: ContributionTransitionRecord;
    };

/** Result of a snapshot or restore operation. */
export type SnapshotOutcome =
  | { readonly ok: true; readonly snapshotId: ContentDigest; readonly revision: number }
  | {
      readonly ok: false;
      readonly code: "empty-state" | "unknown-snapshot" | "malformed-snapshot";
      readonly detail: string;
    };

interface CommunityState {
  revision: number;
  contributions: Map<string, ContributionRecord>;
  transitions: ContributionTransitionRecord[];
  evidence: Map<string, string>;
}

/** The community contribution service. Construct, then submit commands. */
export class CommunityService {
  private readonly clock: ServiceClock;
  private readonly options: CommunityServiceOptions;
  private readonly state: CommunityState = {
    revision: 0,
    contributions: new Map(),
    transitions: [],
    evidence: new Map(),
  };

  constructor(options: CommunityServiceOptions) {
    this.options = options;
    this.clock = options.clock;
  }

  // -----------------------------------------------------------------------
  // Commands (typed admission, tenant scoping, E10 idempotency)
  // -----------------------------------------------------------------------

  /** Submit one contribution through the full intake pipeline. */
  submit(command: SubmitContributionCommand): SubmitResult {
    // Structural gates first: the content-addressed id can only be
    // derived over kernel-valid, canonicalizable content. The pure
    // oracle re-adjudicates every rule for typed coverage.
    if (!isGameIRValue(command.payload) || !isContributionProvenanceInput(command.provenance)) {
      const structural = adjudicateSubmission(command, this.options.policy, this.factsFor(command, false));
      if (structural.accepted) {
        // Unreachable: the oracle refuses exactly what the guards refuse.
        return { accepted: false, code: "invalid-payload", detail: "payload is not a game-ir kernel value" };
      }
      return structural;
    }
    const identity = submissionIdentityOf(
      command.tenant,
      command.contributor,
      command.kind,
      command.payload,
      command.provenance.origin,
      command.provenance.aiGenerated,
      command.provenance.modelProvenance ?? [],
    );
    const contributionId = contributionIdOf(identity);
    const genesisRecordId = this.state.evidence.get(String(contributionId));
    if (genesisRecordId !== undefined) {
      const recorded = this.transitionByRecordId(genesisRecordId);
      return {
        accepted: false,
        code: "duplicate-contribution",
        detail: "submission digest was already recorded (E10: the first receipt stands)",
        recorded,
      };
    }
    const admission = adjudicateSubmission(command, this.options.policy, this.factsFor(command, false));
    if (!admission.accepted) return admission;
    const now = this.clock.now();
    const record: ContributionRecord = {
      contributionId,
      tenant: command.tenant,
      contributor: command.contributor,
      kind: command.kind,
      payload: command.payload,
      provenance: {
        contributor: command.contributor,
        origin: command.provenance.origin,
        contentDigest: contributionId,
        aiGenerated: command.provenance.aiGenerated,
        modelProvenance: identity.modelProvenance,
      },
      gap: command.gap,
      status: "submitted",
      submittedAt: now,
      decidedBy: "platform-authority",
    };
    this.state.contributions.set(String(contributionId), record);
    const genesis = submissionTransitionOf(command.tenant, contributionId, command.contributor, now);
    this.state.transitions.push(genesis);
    this.state.evidence.set(String(contributionId), String(genesis.recordId));
    this.state.revision += 1;
    return { accepted: true, contribution: cloneContribution(record) };
  }

  /** Drive one workflow command through the transition pipeline. */
  transition(command: TransitionCommand): TransitionResult {
    const commandKey = transitionCommandKeyOf(command);
    const seenRecordId = this.state.evidence.get(String(commandKey));
    if (seenRecordId !== undefined) {
      const recorded = this.transitionByRecordId(seenRecordId);
      return {
        accepted: false,
        code: "duplicate-transition",
        detail: "transition command was already recorded (E10: the first receipt stands)",
        recorded,
      };
    }
    const record = this.recordIn(command.tenant, command.contributionId);
    const base = record === undefined ? undefined : lineageBaseOf(record);
    const lineageBase: LineageBaseQualification | undefined =
      command.kind === "accept" && base !== undefined
        ? this.options.packages.qualificationOf(base)
        : undefined;
    const admission = adjudicateTransition(command, {
      record,
      actorTenant: this.options.directory.tenantOf(command.actor),
      actorIsMaintainer:
        record === undefined ? false : this.options.directory.isMaintainer(record.tenant, command.actor),
      lineageBase,
    });
    if (!admission.accepted) return admission;
    const now = this.clock.now();
    const transition: ContributionTransitionRecord = {
      tenant: command.tenant,
      contributionId: command.contributionId,
      actor: command.actor,
      from: record!.status,
      to: admission.to,
      reason: command.reason,
      recordedAt: now,
      recordId: transitionRecordIdOf({
        tenant: command.tenant,
        contributionId: command.contributionId,
        actor: command.actor,
        from: record!.status,
        to: admission.to,
        reason: command.reason,
        recordedAt: now,
      }),
      decidedBy: "platform-authority",
    };
    const updated: ContributionRecord = { ...record!, status: admission.to };
    this.state.contributions.set(String(command.contributionId), updated);
    this.state.transitions.push(transition);
    this.state.evidence.set(String(commandKey), String(transition.recordId));
    this.state.revision += 1;
    return { accepted: true, record: { ...transition }, status: admission.to };
  }

  // -----------------------------------------------------------------------
  // Read models (tenant-scoped, deep copies only)
  // -----------------------------------------------------------------------

  /** One contribution by id, tenant-scoped. */
  contribution(tenant: TenantId, contributionId: ContributionId): ContributionRecord | undefined {
    const record = this.recordIn(tenant, contributionId);
    return record === undefined ? undefined : cloneContribution(record);
  }

  /** All contributions of one tenant, optionally one contributor's. */
  contributionsOf(tenant: TenantId, contributor?: SubjectId): readonly ContributionRecord[] {
    return [...this.state.contributions.values()]
      .filter(
        (record) =>
          record.tenant === tenant && (contributor === undefined || record.contributor === contributor),
      )
      .map((record) => cloneContribution(record));
  }

  /** The contributions linked to one capability gap, tenant-scoped. */
  gapContributions(tenant: TenantId, gapId: string): readonly ContributionRecord[] {
    return [...this.state.contributions.values()]
      .filter((record) => record.tenant === tenant && record.gap !== undefined && String(record.gap.gapId) === gapId)
      .map((record) => cloneContribution(record));
  }

  /** The append-only transition history, tenant-scoped (E10). */
  history(tenant: TenantId, contributionId?: ContributionId): readonly ContributionTransitionRecord[] {
    return this.state.transitions
      .filter(
        (entry) =>
          entry.tenant === tenant && (contributionId === undefined || entry.contributionId === contributionId),
      )
      .map((entry) => ({ ...entry }));
  }

  /** The recorded receipt of one evidence key, if any (E10). */
  receipt(key: ContentDigest | ContributionId): ContributionTransitionRecord | undefined {
    const recordId = this.state.evidence.get(String(key));
    return recordId === undefined ? undefined : this.transitionByRecordId(recordId);
  }

  // -----------------------------------------------------------------------
  // Snapshot / restore (E6 resumability seam)
  // -----------------------------------------------------------------------

  /** Persist a content-addressed checkpoint of all state. */
  snapshot(): SnapshotOutcome {
    if (this.state.contributions.size === 0) {
      return { ok: false, code: "empty-state", detail: "nothing to snapshot" };
    }
    const bytes = encodeSnapshotDocument(
      buildCommunityDocument({
        revision: this.state.revision,
        contributions: [...this.state.contributions.values()],
        transitions: this.state.transitions,
        evidence: this.state.evidence,
      }),
    );
    const snapshotId = computeDigest({ tag: "playliquid:community:snapshot:1", document: bytes });
    this.options.store.save({ snapshotId, revision: this.state.revision, document: bytes });
    return { ok: true, snapshotId, revision: this.state.revision };
  }

  /** Re-adopt a stored snapshot document (whole, deep-validated). */
  restore(snapshotId?: ContentDigest): SnapshotOutcome {
    const stored = snapshotId === undefined ? this.options.store.list().at(-1) : this.options.store.load(snapshotId);
    if (stored === undefined) {
      return { ok: false, code: "unknown-snapshot", detail: "no stored snapshot to restore" };
    }
    let parsed: unknown;
    try {
      parsed = decodeSnapshotDocument(stored.document);
    } catch {
      return { ok: false, code: "malformed-snapshot", detail: "stored document is not valid JSON" };
    }
    const validated = validateCommunityDocument(parsed);
    if (!validated.ok) {
      return { ok: false, code: "malformed-snapshot", detail: validated.detail };
    }
    this.state.contributions = validated.state.contributions;
    this.state.transitions = validated.state.transitions;
    this.state.evidence = validated.state.evidence;
    this.state.revision = validated.revision;
    return { ok: true, snapshotId: stored.snapshotId, revision: stored.revision };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private factsFor(command: SubmitContributionCommand, submissionSeen: boolean): SubmissionFacts {
    return {
      contributorExists: this.options.directory.exists(command.tenant, command.contributor),
      contributorTenant: this.options.directory.tenantOf(command.contributor),
      submissionSeen,
      openContributionsOfContributor: this.openCountOf(command.tenant, command.contributor),
      gap: command.gap === undefined ? undefined : this.options.gaps.factsOf(command.gap),
    };
  }

  private recordIn(tenant: TenantId, contributionId: ContributionId): ContributionRecord | undefined {
    const record = this.state.contributions.get(String(contributionId));
    return record !== undefined && record.tenant === tenant ? record : undefined;
  }

  private transitionByRecordId(recordId: string): ContributionTransitionRecord | undefined {
    const found = this.state.transitions.find((entry) => String(entry.recordId) === recordId);
    return found === undefined ? undefined : { ...found };
  }

  private openCountOf(tenant: TenantId, contributor: SubjectId): number {
    let count = 0;
    for (const record of this.state.contributions.values()) {
      if (
        record.tenant === tenant &&
        record.contributor === contributor &&
        !isTerminalStatus(record.status)
      ) {
        count += 1;
      }
    }
    return count;
  }
}

function isTerminalStatus(status: string): boolean {
  return status === "accepted" || status === "rejected" || status === "withdrawn";
}
