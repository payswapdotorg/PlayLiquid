/**
 * FORGE — the append-only workflow journal (PL-038; E10).
 *
 * Every stage of the engine-native workflow appends immutable,
 * content-addressed entries here. The journal is the E10 discipline the
 * product thesis requires: historical evidence is immutable, appends are
 * idempotent (a content-identical re-append returns the ORIGINAL receipt,
 * never a second entry), edits are refused with typed codes, and the whole
 * chain is verifiable from a snapshot (each entry digest chains over its
 * predecessor — a tampered snapshot is detectable, never silently trusted).
 *
 * Determinism (E9): entry digests are content-derived through
 * package-system's canonical digest (the single hashing authority, E7);
 * `at` readings come from the injected workflow clock, never Date.now().
 *
 * Pure in-memory structure: persistence is a host concern (E11).
 */

import { computeDigest } from "../../../packages/package-system/src/index.ts";
import type { ContentDigest } from "../../../packages/package-system/src/index.ts";

/** One immutable journal entry (sequence + digests are derived, never supplied). */
export interface WorkflowJournalEntry {
  readonly kind: "workflow-journal-entry";
  /** Content-addressed identity of this entry (chained over the predecessor). */
  readonly entryDigest: ContentDigest;
  /** Ledger position; assigned only to genuinely new appends. */
  readonly sequence: number;
  /** Workflow stage the entry belongs to ("document" | "authoring" | "content" | "adjudication" | "build" | "seal"). */
  readonly stage: string;
  /** What happened ("tool-call", "package-published", "phase-transition", ...). */
  readonly event: string;
  /** The injected-clock reading (E9). */
  readonly at: number;
  /** JSON-safe evidence detail. */
  readonly detail: unknown;
}

/** The append material (entryDigest + sequence are derived). */
export type WorkflowJournalAppend = Omit<WorkflowJournalEntry, "kind" | "entryDigest" | "sequence">;

/** A typed journal refusal (E8: edits never happen, they are refused). */
export interface JournalRefusal {
  readonly ok: false;
  readonly code: "journal/append-only" | "journal/chain-broken";
  readonly message: string;
}

/** The result of one append: a first entry, or the idempotent original. */
export type JournalAppendResult =
  | { readonly ok: true; readonly classification: "first"; readonly entry: WorkflowJournalEntry }
  | { readonly ok: true; readonly classification: "duplicate"; readonly entry: WorkflowJournalEntry }
  | JournalRefusal;

/** Chain verification over a snapshot (the tamper detector). */
export type JournalVerification = { readonly ok: true; readonly entryCount: number } | JournalRefusal;

/** The sequence-free content identity of an append (duplicate detection). */
function contentDigestOf(append: WorkflowJournalAppend): ContentDigest {
  return computeDigest({ stage: append.stage, event: append.event, at: append.at, detail: append.detail });
}

/** The published identity: content PLUS the chain position. */
function chainedDigestOf(append: WorkflowJournalAppend, sequence: number, predecessor: ContentDigest | null): ContentDigest {
  return computeDigest({ content: contentDigestOf(append), sequence, predecessor });
}

/** Re-derives the chain over a snapshot of entries; the FIRST break wins. */
export function verifyJournalChain(entries: readonly unknown[]): JournalVerification {
  let predecessor: ContentDigest | null = null;
  for (let index = 0; index < entries.length; index += 1) {
    const candidate = entries[index];
    if (typeof candidate !== "object" || candidate === null) {
      return { ok: false, code: "journal/chain-broken", message: `entry ${String(index)} is not a journal entry object` };
    }
    const record = candidate as Partial<WorkflowJournalEntry>;
    const expected = chainedDigestOf(
      { stage: String(record.stage), event: String(record.event), at: Number(record.at), detail: record.detail },
      index,
      predecessor,
    );
    if (record.entryDigest !== expected || record.sequence !== index) {
      return {
        ok: false,
        code: "journal/chain-broken",
        message: `entry ${String(index)} does not match its chained digest (tampered or reordered evidence; E10)`,
      };
    }
    predecessor = expected;
  }
  return { ok: true, entryCount: entries.length };
}

/** The append-only workflow journal (one instance per workflow run). */
export interface WorkflowJournal {
  /** Appends (or returns the content-identical original; E10 idempotency). */
  append(append: WorkflowJournalAppend): JournalAppendResult;
  /** A typed refusal — history is never edited, never truncated. */
  revise(): JournalRefusal;
  /** The chain verification over the current snapshot (E10 tamper detector). */
  verify(): JournalVerification;
  /** Frozen snapshot in append order. */
  snapshot(): readonly WorkflowJournalEntry[];
  /** Content digest over the entry digest list (E9: derived, never stored). */
  readonly journalDigest: ContentDigest;
}

/** Creates an empty append-only workflow journal. */
export function createWorkflowJournal(): WorkflowJournal {
  const entries: WorkflowJournalEntry[] = [];
  const byContent = new Map<ContentDigest, WorkflowJournalEntry>();

  function append(append: WorkflowJournalAppend): JournalAppendResult {
    const content = contentDigestOf(append);
    const existing = byContent.get(content);
    if (existing !== undefined) {
      return { ok: true, classification: "duplicate", entry: existing };
    }
    const predecessor = entries.length === 0 ? null : (entries[entries.length - 1]?.entryDigest ?? null);
    const entry: WorkflowJournalEntry = Object.freeze({
      kind: "workflow-journal-entry",
      entryDigest: chainedDigestOf(append, entries.length, predecessor),
      sequence: entries.length,
      stage: append.stage,
      event: append.event,
      at: append.at,
      detail: append.detail,
    });
    entries.push(entry);
    byContent.set(content, entry);
    return { ok: true, classification: "first", entry };
  }

  return Object.freeze({
    append,
    revise: (): JournalRefusal => ({
      ok: false,
      code: "journal/append-only",
      message: "the workflow journal is append-only (E10): entries are never edited, rewritten or removed",
    }),
    verify: () => verifyJournalChain(entries),
    snapshot: () => Object.freeze([...entries]),
    get journalDigest(): ContentDigest {
      return computeDigest(entries.map((entry) => entry.entryDigest));
    },
  });
}
