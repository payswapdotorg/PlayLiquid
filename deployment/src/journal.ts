/**
 * THE DEPLOYMENT JOURNAL (PL-044) — the append-only history of
 * deployments (E10): deployments are RECORDS, never edits.
 *
 * Every verification outcome (verified or refused) appends exactly one
 * journal entry. Entries are chained: each entry's digest covers its own
 * content plus the previous entry's digest (a hash chain — the
 * work-journal discipline of services/ops, which generalizes the
 * arena-integration-runtime audit log), so:
 *
 *   - any edit, removal, reordering or re-minting of a past entry breaks
 *     the chain and is a typed refusal on verification/restore — never
 *     silently adopted (E8);
 *   - the service's own `amendEntry` door is a TYPED REFUSAL by
 *     construction: there is no edit path, only append.
 *
 * Idempotency (E10): re-recording the SAME seal is an honest duplicate
 * receipt that grows nothing — re-verifying a committed deployment does
 * not duplicate history.
 *
 * Purity: the entry constructors and verifiers are pure; the service
 * (the single mutable-state owner, E1) appends only.
 */

import { deployJournalEntryDigestOf } from "./digest.ts";

/** Every deployment-journal entry kind (frozen vocabulary). */
export const DEPLOYMENT_JOURNAL_ENTRY_KINDS = Object.freeze(["verified", "refused"] as const);

/** One deployment-journal entry kind. */
export type DeploymentJournalEntryKind = (typeof DEPLOYMENT_JOURNAL_ENTRY_KINDS)[number];

/** Type guard over {@link DeploymentJournalEntryKind}. */
export function isDeploymentJournalEntryKind(value: unknown): value is DeploymentJournalEntryKind {
  return typeof value === "string" && (DEPLOYMENT_JOURNAL_ENTRY_KINDS as readonly string[]).includes(value);
}

/** One append-only deployment record (E10). */
export interface DeploymentJournalEntry {
  /** 1-based sequence number, strictly increasing, no gaps. */
  readonly seq: number;
  /** The port-supplied instant, recorded verbatim. */
  readonly at: number;
  readonly kind: DeploymentJournalEntryKind;
  readonly planId: string;
  readonly planDigest: string;
  /** The seal digest (verified entries). */
  readonly sealDigest?: string;
  /** The typed refusal (refused entries; code verbatim, E8). */
  readonly refusal?: { readonly code: string; readonly detail: string };
  /** The digest of the previous entry ("0".repeat(64) for the first). */
  readonly prevDigest: string;
  /** The chained content digest of THIS entry. */
  readonly digest: string;
  /** Additional typed facts (JSON-safe). */
  readonly facts: Readonly<Record<string, unknown>>;
}

/** The zero-digest anchoring the first entry's chain. */
export const DEPLOYMENT_JOURNAL_GENESIS = "0".repeat(64);

/** The journal chain verification's refusal codes (frozen). */
export type DeploymentJournalRefusalCode = "empty-journal" | "broken-sequence" | "broken-chain" | "unknown-entry-kind";

/** Result of the chain verification (total, never throws). */
export type DeploymentJournalVerification =
  | { readonly ok: true; readonly length: number; readonly lastDigest: string }
  | { readonly ok: false; readonly code: DeploymentJournalRefusalCode; readonly detail: string };

/** Result of the restore door (E6; a tampered journal is never adopted). */
export type DeploymentJournalRestoreResult =
  | { readonly ok: true; readonly entries: number }
  | { readonly ok: false; readonly code: "empty-journal" | DeploymentJournalRefusalCode; readonly detail: string };

/** Computes one chained journal entry (pure; E9 deterministic). */
export function deploymentJournalEntryOf(content: {
  readonly seq: number;
  readonly at: number;
  readonly kind: DeploymentJournalEntryKind;
  readonly planId: string;
  readonly planDigest: string;
  readonly sealDigest?: string;
  readonly refusal?: { readonly code: string; readonly detail: string };
  readonly prevDigest: string;
  readonly facts?: Readonly<Record<string, unknown>>;
}): DeploymentJournalEntry {
  const facts = content.facts ?? {};
  const digest = deployJournalEntryDigestOf({
    seq: content.seq,
    at: content.at,
    kind: content.kind,
    planId: content.planId,
    planDigest: content.planDigest,
    sealDigest: content.sealDigest,
    refusal: content.refusal,
    prevDigest: content.prevDigest,
    facts,
  });
  return Object.freeze({ ...content, facts, digest });
}

/** Appends one entry to a journal (pure — returns the new journal). */
export function appendDeploymentJournalEntry(
  journal: readonly DeploymentJournalEntry[],
  entry: Omit<DeploymentJournalEntry, "seq" | "prevDigest" | "digest" | "facts"> & { readonly facts?: Readonly<Record<string, unknown>> },
): readonly DeploymentJournalEntry[] {
  const last = journal[journal.length - 1];
  const next = deploymentJournalEntryOf({
    ...entry,
    seq: journal.length + 1,
    prevDigest: last === undefined ? DEPLOYMENT_JOURNAL_GENESIS : last.digest,
  });
  return Object.freeze([...journal, next]);
}

/**
 * Verifies a whole journal: sequence starts at 1 and increments by one,
 * every entry kind is known, the hash chain links, and every entry's
 * digest still matches its own content (any edit breaks it — E8/E10).
 */
export function verifyDeploymentJournal(journal: readonly DeploymentJournalEntry[]): DeploymentJournalVerification {
  if (journal.length === 0) return { ok: false, code: "empty-journal", detail: "the deployment journal has no entries" };
  let previous = DEPLOYMENT_JOURNAL_GENESIS;
  for (let index = 0; index < journal.length; index += 1) {
    const entry = journal[index];
    if (entry === undefined) return { ok: false, code: "broken-sequence", detail: `journal slot ${String(index)} is absent` };
    if (entry.seq !== index + 1) {
      return { ok: false, code: "broken-sequence", detail: `entry ${String(index)} carries seq ${String(entry.seq)}, expected ${String(index + 1)}` };
    }
    if (!isDeploymentJournalEntryKind(entry.kind)) {
      return { ok: false, code: "unknown-entry-kind", detail: `entry ${String(entry.seq)} has unknown kind ${String(entry.kind)}` };
    }
    if (entry.prevDigest !== previous) {
      return { ok: false, code: "broken-chain", detail: `entry ${String(entry.seq)} does not chain to its predecessor` };
    }
    const recomputed = deployJournalEntryDigestOf({
      seq: entry.seq,
      at: entry.at,
      kind: entry.kind,
      planId: entry.planId,
      planDigest: entry.planDigest,
      sealDigest: entry.sealDigest,
      refusal: entry.refusal,
      prevDigest: entry.prevDigest,
      facts: entry.facts,
    });
    if (recomputed !== entry.digest) {
      return { ok: false, code: "broken-chain", detail: `entry ${String(entry.seq)} no longer matches its content digest (an edit was attempted — E10)` };
    }
    previous = entry.digest;
  }
  return { ok: true, length: journal.length, lastDigest: previous };
}

/** Result of the record doors. */
export type DeploymentRecordResult =
  | { readonly ok: true; readonly entry: DeploymentJournalEntry; readonly duplicate: boolean }
  | { readonly ok: false; readonly code: "journal-immutable" | "invalid-record"; readonly detail: string };

/**
 * THE deployment journal service — the single mutable-state owner (E1).
 * Appends only: there is NO edit door that succeeds. Re-recording a seal
 * already recorded is an idempotent duplicate receipt (E10) that appends
 * nothing.
 */
export class DeploymentJournalService {
  private journal: readonly DeploymentJournalEntry[] = [];
  private readonly clock: { now(): number };

  constructor(clock: { now(): number }) {
    this.clock = clock;
  }

  /** Restores a whole journal (E6): only a fully verifying chain adopts. */
  restore(journal: readonly DeploymentJournalEntry[]): DeploymentJournalRestoreResult {
    const verification = verifyDeploymentJournal(journal);
    if (!verification.ok) return { ok: false, code: verification.code, detail: verification.detail };
    this.journal = Object.freeze([...journal]);
    return { ok: true, entries: this.journal.length };
  }

  /** Records one VERIFIED plan (append-only, E10; duplicates grow nothing). */
  record(seal: { readonly planDigest: string; readonly sealDigest: string }, plan: { readonly planId: string }): DeploymentRecordResult {
    const duplicate = this.journal.some((entry) => entry.kind === "verified" && entry.sealDigest === seal.sealDigest);
    if (duplicate) {
      const existing = this.journal.find((entry) => entry.kind === "verified" && entry.sealDigest === seal.sealDigest);
      return { ok: true, entry: existing as DeploymentJournalEntry, duplicate: true };
    }
    this.journal = appendDeploymentJournalEntry(this.journal, {
      at: this.clock.now(),
      kind: "verified",
      planId: plan.planId,
      planDigest: seal.planDigest,
      sealDigest: seal.sealDigest,
      facts: {},
    });
    return { ok: true, entry: this.journal[this.journal.length - 1] as DeploymentJournalEntry, duplicate: false };
  }

  /** Records one refused verification attempt (append-only; code verbatim, E8). */
  recordRefusal(plan: { readonly planId: string; readonly planDigest: string }, refusal: { readonly code: string; readonly detail: string }): DeploymentRecordResult {
    this.journal = appendDeploymentJournalEntry(this.journal, {
      at: this.clock.now(),
      kind: "refused",
      planId: plan.planId,
      planDigest: plan.planDigest,
      refusal: { code: refusal.code, detail: refusal.detail },
      facts: {},
    });
    return { ok: true, entry: this.journal[this.journal.length - 1] as DeploymentJournalEntry, duplicate: false };
  }

  /**
   * The edit door that REFUSES by construction (E10): deployments are
   * records, never edits. Kept as an explicit typed refusal so callers
   * cannot silently mutate history.
   */
  amendEntry(seq: number, patch: Readonly<Record<string, unknown>>): DeploymentRecordResult {
    return { ok: false, code: "journal-immutable", detail: `entry ${String(seq)} cannot be amended (${Object.keys(patch).join(", ") || "no fields"}): the deployment journal is append-only (E10) — record a NEW entry instead` };
  }

  /** Read-only snapshot. */
  entries(): readonly DeploymentJournalEntry[] {
    return Object.freeze([...this.journal]);
  }

  /** Chain verification of the live journal. */
  verify(): DeploymentJournalVerification {
    return verifyDeploymentJournal(this.journal);
  }
}
