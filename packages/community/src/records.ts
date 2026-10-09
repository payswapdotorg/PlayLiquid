/**
 * CONTRIBUTION RECORDS — the typed vocabulary of the community
 * contribution service (PL-032; spec/architecture.md "Community":
 * "Users can contribute: issues, replay-backed reports, code, packages,
 * assets, skills, levels, dialogue, voice/performance, reviews, PRs and
 * tests. Contribution artifacts preserve provenance and normal Git
 * lifecycle.").
 *
 * This package tracks CONTRIBUTION STATE ONLY. It is not a second Git:
 * git-lineage (PL-012) owns lineage semantics and package-registry
 * (PL-011) owns packaging — both are referenced through their public
 * vocabulary and behind read-only ports, never re-implemented here.
 *
 * Vocabulary in this module:
 * - the frozen CONTRIBUTION KINDS (the architecture's community list,
 *   normalized to singular kebab-case slugs);
 * - the frozen contribution state machine
 *   submitted -> triaged -> under-review -> accepted/rejected/withdrawn
 *   with its stepwise transition table and command/from-state mapping;
 * - typed provenance: contributor subject (platform-contracts branded
 *   primitives — the same vocabulary platform-identity serves through a
 *   SubjectDirectory seam), origin lineage (git-lineage LineageNode
 *   values: content-addressed over package-system coordinates), AI
 *   disclosure (package-system ModelProvenanceEntry), content digests
 *   (package-system computeDigest — the single digest authority, E5/E7);
 * - the R18 typed capability-gap link (opaque Lab ids; the Lab owns the
 *   ladder, this seam only validates reference text shape).
 *
 * Purity: types + guards + frozen tables. No IO, no clock, no globals.
 */

import { isLineageNode } from "@playliquid/git-lineage";
import type { LineageNode } from "@playliquid/git-lineage";
import { isContentDigest } from "@playliquid/package-system";
import type { ContentDigest, ModelProvenanceEntry, ModelUsage } from "@playliquid/package-system";
import { isGameIRValue } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import type { PlatformAuthorityMarker, SubjectId, TenantId, TimestampMs } from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Contribution kinds (frozen; architecture "Community")
// ---------------------------------------------------------------------------

/** The contribution kinds the platform admits (architecture "Community"). */
export const CONTRIBUTION_KINDS = [
  "issue",
  "replay-backed-report",
  "code",
  "package",
  "asset",
  "skill",
  "level",
  "dialogue",
  "voice-performance",
  "review",
  "pull-request",
  "test",
] as const;

/** One kind of community contribution. */
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

/** Type guard: a member of the frozen contribution-kind vocabulary. */
export function isContributionKind(value: unknown): value is ContributionKind {
  return typeof value === "string" && (CONTRIBUTION_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Contribution lifecycle (frozen state machine)
// ---------------------------------------------------------------------------

/** The contribution workflow states (work-order PL-032 state machine). */
export const CONTRIBUTION_STATUSES = [
  "submitted",
  "triaged",
  "under-review",
  "accepted",
  "rejected",
  "withdrawn",
] as const;

/** One contribution lifecycle state. */
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

/** Type guard: a member of the frozen status vocabulary. */
export function isContributionStatus(value: unknown): value is ContributionStatus {
  return typeof value === "string" && (CONTRIBUTION_STATUSES as readonly string[]).includes(value);
}

/**
 * The frozen stepwise transition table (the house state-machine pattern,
 * mirroring lab-contracts' gap ladder discipline). The work order's
 * literal chain: submitted -> triaged -> under-review ->
 * accepted/rejected/withdrawn — the three terminal verdicts are exits
 * of under-review ONLY, and they are TERMINAL: a closed contribution
 * is never reopened; corrected work is a NEW submission with fresh
 * provenance (E10: history stays immutable).
 */
export const CONTRIBUTION_TRANSITIONS: Readonly<Record<ContributionStatus, readonly ContributionStatus[]>> =
  Object.freeze({
    submitted: Object.freeze(["triaged"] as const),
    triaged: Object.freeze(["under-review"] as const),
    "under-review": Object.freeze(["accepted", "rejected", "withdrawn"] as const),
    accepted: Object.freeze([] as const),
    rejected: Object.freeze([] as const),
    withdrawn: Object.freeze([] as const),
  });

/** Returns true when `from -> to` is a legal workflow step. */
export function canTransitionContribution(from: ContributionStatus, to: ContributionStatus): boolean {
  return CONTRIBUTION_TRANSITIONS[from].includes(to);
}

/** Returns true when `status` accepts no further transitions (terminal). */
export function isTerminalContributionStatus(status: ContributionStatus): boolean {
  return CONTRIBUTION_TRANSITIONS[status].length === 0;
}

/** The maintainer/contributor transition commands the service admits. */
export const TRANSITION_COMMANDS = ["triage", "review", "accept", "reject", "withdraw"] as const;

/** One workflow command kind. */
export type TransitionCommandKind = (typeof TRANSITION_COMMANDS)[number];

/** Type guard: a member of the frozen command vocabulary. */
export function isTransitionCommandKind(value: unknown): value is TransitionCommandKind {
  return typeof value === "string" && (TRANSITION_COMMANDS as readonly string[]).includes(value);
}

/**
 * The frozen command/from-state table: each command names the states it
 * may be issued from (the work order's literal chain — every verdict
 * command, including withdraw, is an under-review exit). `withdraw` is
 * the contributor's own right; the verdict commands are maintainer
 * rights.
 */
export const COMMAND_FROM_STATES: Readonly<Record<TransitionCommandKind, readonly ContributionStatus[]>> =
  Object.freeze({
    triage: Object.freeze(["submitted"] as const),
    review: Object.freeze(["triaged"] as const),
    accept: Object.freeze(["under-review"] as const),
    reject: Object.freeze(["under-review"] as const),
    withdraw: Object.freeze(["under-review"] as const),
  });

// ---------------------------------------------------------------------------
// Reference ids (typed, opaque)
// ---------------------------------------------------------------------------

/**
 * The canonical id-text grammar (mirrors @playliquid/game-contracts'
 * frozen `ID_TEXT_PATTERN`; mirrored locally as a validation regex because
 * game-contracts is not a declared dependency of this module — the Lab
 * owns gap-record semantics, this seam only validates reference text).
 */
export const REFERENCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

declare const gapIdTag: unique symbol;

/** An opaque Lab capability-gap record id (R18 link, Lab-owned). */
export type GapId = string & { readonly [gapIdTag]: "GapId" };

/** Parses and validates `text` as a {@link GapId}. */
export function asGapId(text: string): GapId | undefined {
  return REFERENCE_ID_PATTERN.test(text) ? (text as GapId) : undefined;
}

declare const cycleIdTag: unique symbol;

/** An opaque Lab cycle id (R18 link, Lab-owned). */
export type CycleId = string & { readonly [cycleIdTag]: "CycleId" };

/** Parses and validates `text` as a {@link CycleId}. */
export function asCycleId(text: string): CycleId | undefined {
  return REFERENCE_ID_PATTERN.test(text) ? (text as CycleId) : undefined;
}

/**
 * The R18 typed capability-gap link: WHICH Lab-recorded gap this
 * contribution addresses. The ladder itself (existing organization ->
 * alternate organization -> package/platform capability ->
 * user/community contribution -> Arena -> blocked) is owned entirely by
 * lab-contracts; this link carries NO ladder semantics — only the opaque
 * ids. Ladder facts arrive through the read-only GapDirectory port.
 */
export interface CapabilityGapLink {
  readonly gapId: GapId;
  readonly cycleId: CycleId;
}

/** Type guard: a structurally valid {@link CapabilityGapLink}. */
export function isCapabilityGapLink(value: unknown): value is CapabilityGapLink {
  if (typeof value !== "object" || value === null) return false;
  const link = value as Record<string, unknown>;
  return (
    typeof link.gapId === "string" &&
    asGapId(link.gapId) !== undefined &&
    typeof link.cycleId === "string" &&
    asCycleId(link.cycleId) !== undefined
  );
}

declare const contributionIdTag: unique symbol;

/**
 * A contribution id: the package-system content digest
 * (`sha256:<64 hex>`) of the submission's provenance-bearing identity
 * (see history.ts `contributionIdOf`). Content addressing makes ids
 * tamper-evident: a record whose id does not address its own submission
 * content is structurally invalid (E5/E10).
 */
export type ContributionId = ContentDigest & { readonly [contributionIdTag]: "ContributionId" };

/** Parses and validates `text` as a {@link ContributionId}. */
export function asContributionId(text: string): ContributionId | undefined {
  return isContentDigest(text) ? (text as ContributionId) : undefined;
}

// ---------------------------------------------------------------------------
// Provenance (typed chains; R19 discipline at the seam)
// ---------------------------------------------------------------------------

/**
 * Where the contributed content originates. `original` is first-party
 * work; `lineage-derived` cites its base through git-lineage's
 * LineageNode vocabulary — a content-addressed node over an exact
 * package-system PackageCoordinate (the coordinate pins the base
 * package's own content digest, so the citation is exact).
 */
export type ContributionOrigin =
  | { readonly kind: "original" }
  | { readonly kind: "lineage-derived"; readonly base: LineageNode };

/** Type guard: a structurally valid {@link ContributionOrigin}. */
export function isContributionOrigin(value: unknown): value is ContributionOrigin {
  if (typeof value !== "object" || value === null) return false;
  const origin = value as Record<string, unknown>;
  if (origin.kind === "original") return true;
  if (origin.kind !== "lineage-derived") return false;
  // isLineageNode recomputes the node's content address: a forged node id
  // fails here (E8 forged-provenance negative path).
  return isLineageNode(origin.base);
}

/** Provenance input submitted with a contribution. */
export interface ContributionProvenanceInput {
  readonly origin: ContributionOrigin;
  /** Honest AI disclosure (lock 11: provenance is first-class). */
  readonly aiGenerated: boolean;
  /** Model provenance entries — REQUIRED when `aiGenerated` (E8). */
  readonly modelProvenance?: readonly ModelProvenanceEntry[];
}

/** The AI-participation usage vocabulary (package-system provenance). */
export const MODEL_USAGE_KINDS: readonly ModelUsage[] = Object.freeze([
  "generation",
  "assistance",
  "transformation",
]);

/**
 * Type guard: a structurally valid package-system model-provenance
 * entry (plain JSON shape — also guarantees canonicalizability of the
 * disclosure inside the submission digest input).
 */
export function isModelProvenanceEntry(value: unknown): value is ModelProvenanceEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.model === "string" &&
    entry.model.length > 0 &&
    typeof entry.provider === "string" &&
    entry.provider.length > 0 &&
    typeof entry.usage === "string" &&
    (MODEL_USAGE_KINDS as readonly string[]).includes(entry.usage) &&
    typeof entry.disclosed === "boolean"
  );
}

/** Type guard: a structurally valid {@link ContributionProvenanceInput}. */
export function isContributionProvenanceInput(value: unknown): value is ContributionProvenanceInput {
  if (typeof value !== "object" || value === null) return false;
  const provenance = value as Record<string, unknown>;
  if (!isContributionOrigin(provenance.origin)) return false;
  if (typeof provenance.aiGenerated !== "boolean") return false;
  if (provenance.modelProvenance !== undefined && !Array.isArray(provenance.modelProvenance)) return false;
  if (Array.isArray(provenance.modelProvenance)) {
    if (!provenance.modelProvenance.every((entry) => isModelProvenanceEntry(entry))) return false;
  }
  return true;
}

/** The recorded provenance of one contribution (immutable once recorded). */
export interface ContributionProvenance {
  /** The contributor-of-record: platform subject within one tenant. */
  readonly contributor: SubjectId;
  readonly origin: ContributionOrigin;
  /** Content digest of the submission identity (the record's own id). */
  readonly contentDigest: ContentDigest;
  readonly aiGenerated: boolean;
  readonly modelProvenance: readonly ModelProvenanceEntry[];
}

/** Type guard: a structurally valid {@link ContributionProvenance}. */
export function isContributionProvenance(value: unknown): value is ContributionProvenance {
  if (typeof value !== "object" || value === null) return false;
  const provenance = value as Record<string, unknown>;
  return (
    typeof provenance.contributor === "string" &&
    isContributionOrigin(provenance.origin) &&
    isContentDigest(provenance.contentDigest) &&
    typeof provenance.aiGenerated === "boolean" &&
    Array.isArray(provenance.modelProvenance)
  );
}

// ---------------------------------------------------------------------------
// The contribution record
// ---------------------------------------------------------------------------

/** Maximum length of a free-text transition reason. */
export const MAX_REASON_LENGTH = 512;

/** One community contribution: typed record with provenance and state. */
export interface ContributionRecord {
  /** Content address of the submission identity (tamper-evident). */
  readonly contributionId: ContributionId;
  readonly tenant: TenantId;
  readonly contributor: SubjectId;
  readonly kind: ContributionKind;
  /** The contributed semantic content (kernel value form, E9-stable). */
  readonly payload: GameIRValue;
  readonly provenance: ContributionProvenance;
  /** The R18 link, when this contribution addresses a Lab gap. */
  readonly gap?: CapabilityGapLink;
  readonly status: ContributionStatus;
  readonly submittedAt: TimestampMs;
  /** Only the community service decides contribution facts (E8). */
  readonly decidedBy: PlatformAuthorityMarker;
}

/**
 * Type guard: a structurally valid {@link ContributionRecord}. Shallow:
 * payload deep-validation and id/content-address coherence are verified
 * by the service on restore (history.ts machinery), keeping this guard
 * total and cheap for untyped input.
 */
export function isContributionRecord(value: unknown): value is ContributionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    asContributionId(String(record.contributionId)) !== undefined &&
    typeof record.tenant === "string" &&
    typeof record.contributor === "string" &&
    isContributionKind(record.kind) &&
    isGameIRValue(record.payload) &&
    isContributionProvenance(record.provenance) &&
    (record.gap === undefined || isCapabilityGapLink(record.gap)) &&
    isContributionStatus(record.status) &&
    typeof record.submittedAt === "number" &&
    record.decidedBy === "platform-authority"
  );
}
