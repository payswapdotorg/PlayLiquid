/**
 * THE WORK JOURNAL (PL-044) — the append-only history of the durable
 * worker runtime (E10): deployments of work are RECORDS, never edits.
 *
 * Every state transition of every work item appends exactly one journal
 * entry. Entries are chained: each entry's digest covers its own content
 * plus the previous entry's digest (a hash chain — the
 * arena-integration-runtime audit-log discipline), and the whole journal
 * is part of the content-addressed service document, so:
 *
 *   - a crash-resume ADOPTS the journal verbatim and only APPENDS after
 *     it (the pre-crash journal is always a strict prefix of the resumed
 *     journal — tested);
 *   - any edit, removal, reordering or re-minting of a past entry breaks
 *     the chain and is a typed `broken-journal` refusal on restore —
 *     never silently adopted (E8).
 *
 * Purity: pure functions over plain data; no IO, no clock (timestamps are
 * caller-supplied values recorded verbatim).
 */

import { opsJournalEntryDigestOf } from "./digest.ts";

/** Every journal entry kind (frozen vocabulary). */
export const WORK_JOURNAL_ENTRY_KINDS = Object.freeze([
  "enqueued",
  "leased",
  "lease-reclaimed",
  "lease-expired",
  "heartbeat",
  "effect-intended",
  "effect-performed",
  "effect-duplicate",
  "effect-refused",
  "completed",
  "failed",
  "restored",
] as const);

/** One journal entry kind. */
export type WorkJournalEntryKind = (typeof WORK_JOURNAL_ENTRY_KINDS)[number];

/** Type guard over {@link WorkJournalEntryKind}. */
export function isWorkJournalEntryKind(value: unknown): value is WorkJournalEntryKind {
  return typeof value === "string" && (WORK_JOURNAL_ENTRY_KINDS as readonly string[]).includes(value);
}

/** One append-only journal entry (E10). */
export interface WorkJournalEntry {
  /** 1-based sequence number, strictly increasing, no gaps. */
  readonly seq: number;
  /** The port-supplied instant, recorded verbatim. */
  readonly at: number;
  readonly kind: WorkJournalEntryKind;
  /** The work item this entry is about (empty for runtime-level entries). */
  readonly workId: string;
  /** The digest of the previous entry ("0".repeat(64) for the first). */
  readonly prevDigest: string;
  /** The chained content digest of THIS entry. */
  readonly digest: string;
  /** Additional typed facts (JSON-safe; e.g. workerId, refusal codes). */
  readonly facts: Readonly<Record<string, unknown>>;
}

/** The zero-digest anchoring the first entry's chain. */
export const JOURNAL_GENESIS_DIGEST = "0".repeat(64);

/** Result of the journal chain verification (total, never throws). */
export type JournalVerification =
  | { readonly ok: true; readonly length: number; readonly lastDigest: string }
  | { readonly ok: false; readonly code: WorkJournalRefusalCode; readonly detail: string };

/** The journal's own frozen refusal codes. */
export type WorkJournalRefusalCode = "empty-journal" | "broken-sequence" | "broken-chain" | "unknown-entry-kind";

/** Computes one chained journal entry (pure). */
export function journalEntryOf(content: {
  readonly seq: number;
  readonly at: number;
  readonly kind: WorkJournalEntryKind;
  readonly workId: string;
  readonly prevDigest: string;
  readonly facts?: Readonly<Record<string, unknown>>;
}): WorkJournalEntry {
  const facts = content.facts ?? {};
  const digest = opsJournalEntryDigestOf({
    seq: content.seq,
    at: content.at,
    kind: content.kind,
    workId: content.workId,
    prevDigest: content.prevDigest,
    facts,
  });
  return Object.freeze({ ...content, facts, digest });
}

/** Appends one entry to a journal (pure — returns the new journal). */
export function appendJournalEntry(
  journal: readonly WorkJournalEntry[],
  entry: Omit<WorkJournalEntry, "seq" | "prevDigest" | "digest">,
): readonly WorkJournalEntry[] {
  const last = journal[journal.length - 1];
  const next = journalEntryOf({
    seq: journal.length + 1,
    at: entry.at,
    kind: entry.kind,
    workId: entry.workId,
    prevDigest: last === undefined ? JOURNAL_GENESIS_DIGEST : last.digest,
    facts: entry.facts,
  });
  return Object.freeze([...journal, next]);
}

/**
 * Verifies a whole journal: sequence starts at 1 and increments by one,
 * every entry kind is known, the hash chain links, and every entry's
 * digest still matches its own content (any edit breaks it — E8/E10).
 */
export function verifyWorkJournal(journal: readonly WorkJournalEntry[]): JournalVerification {
  if (journal.length === 0) return { ok: false, code: "empty-journal", detail: "the journal has no entries" };
  let previous = JOURNAL_GENESIS_DIGEST;
  for (let index = 0; index < journal.length; index += 1) {
    const entry = journal[index];
    if (entry === undefined) return { ok: false, code: "broken-sequence", detail: `journal slot ${index} is absent` };
    if (entry.seq !== index + 1) {
      return { ok: false, code: "broken-sequence", detail: `entry ${index} carries seq ${String(entry.seq)}, expected ${String(index + 1)}` };
    }
    if (!isWorkJournalEntryKind(entry.kind)) {
      return { ok: false, code: "unknown-entry-kind", detail: `entry ${String(entry.seq)} has unknown kind ${String(entry.kind)}` };
    }
    if (entry.prevDigest !== previous) {
      return { ok: false, code: "broken-chain", detail: `entry ${String(entry.seq)} does not chain to its predecessor` };
    }
    const recomputed = opsJournalEntryDigestOf({
      seq: entry.seq,
      at: entry.at,
      kind: entry.kind,
      workId: entry.workId,
      prevDigest: entry.prevDigest,
      facts: entry.facts,
    });
    if (recomputed !== entry.digest) {
      return {
        ok: false,
        code: "broken-chain",
        detail: `entry ${String(entry.seq)} no longer matches its content digest (an edit was attempted — E10)`,
      };
    }
    previous = entry.digest;
  }
  return { ok: true, length: journal.length, lastDigest: previous };
}
