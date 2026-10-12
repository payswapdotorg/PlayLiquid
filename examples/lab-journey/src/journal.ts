/**
 * THE JOURNEY JOURNAL (E10) + the content-addressed journey document (PL-040).
 *
 * One append-only, hash-chained journal records every step of the canonical
 * Lab/Arena/Community journey in admission order:
 *
 * - each entry carries its sequence number, the INJECTED clock's reading at
 *   record time, the step name, JSON-safe facts, the digest of the PREVIOUS
 *   entry (a hash chain — `""` anchors the first entry) and its own
 *   content-addressed digest (`@playliquid/package-system`'s `computeDigest`,
 *   the single digest authority, E5/E7);
 * - entries are FROZEN the moment they are appended: there is no rewrite,
 *   reorder or delete operation anywhere in this module (E10);
 * - `verify()` re-derives the whole chain — used by the tests to prove the
 *   append-only discipline is tamper-evident, not merely asserted;
 * - the journal's HEAD digest and the journey document's digest make the
 *   E9 determinism claim checkable: run the journey twice, compare digests.
 *
 * Pure in-memory evidence: no IO, no timers (the clock is injected), no
 * randomness (digests are content-derived).
 */

import { computeDigest } from "../../../packages/package-system/src/index.ts";

/**
 * Deep-copies + freezes JSON-safe facts at append time. The journal owns an
 * IMMUTABLE SNAPSHOT of every step's facts: a caller mutating the value it
 * passed (e.g. pushing to the same array later in the walk) can never reach
 * into an already-recorded entry (E10 — the entry digest pins the frozen
 * copy, and the harness's chain verification proves it).
 */
function snapshotOf(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(snapshotOf));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = snapshotOf(nested);
    }
    return Object.freeze(out);
  }
  return value;
}

/** One appended journal entry (frozen at append time; E10). */
export interface JourneyJournalEntry {
  /** 1-based, strictly increasing admission order. */
  readonly seq: number;
  /** The injected journey clock at record time (ms). */
  readonly at: number;
  /** The step's name (phase-qualified, stable vocabulary). */
  readonly step: string;
  /** JSON-safe facts captured at the step. */
  readonly facts: unknown;
  /** The digest of the previous entry; `""` anchors the first entry. */
  readonly prevDigest: string;
  /** The content-addressed digest of this entry. */
  readonly entryDigest: string;
}

/** The append-only journal of one journey run. */
export interface JourneyJournal {
  /** Append one step (the only write; the clock advances by the fixed step). */
  record(step: string, facts: unknown): void;
  /** The entries so far (frozen copy). */
  entries(): readonly JourneyJournalEntry[];
  /** The chain head: the last entry's digest (or `""` when empty). */
  headDigest(): string;
  /** The entry count. */
  size(): number;
  /** Re-derives every entry digest + link — the E10 tamper oracle. */
  verify(): boolean;
}

/** The content-addressed journey document (the sealed run's product). */
export interface JourneyDocument {
  readonly kind: "lab-arena-community-journey";
  readonly tenant: string;
  readonly subject: string;
  readonly phases: Readonly<Record<string, unknown>>;
  /** The journal chain head at seal time (E10 evidence trail). */
  readonly journalHead: string;
  readonly journalLength: number;
  /** The content-addressed digest of this document (the seal). */
  readonly documentDigest: string;
}

/**
 * Creates the journey journal: a sequence-derived clock anchors every entry
 * (`at = startMs + seq * stepMs`) — no time is ever read; the timestamps are
 * content of the run, not environment (E9).
 */
export function createJourneyJournal(startMs: number, stepMs: number): JourneyJournal {
  const entries: JourneyJournalEntry[] = [];
  return {
    record(step, facts) {
      const previous = entries[entries.length - 1];
      const prevDigest = previous === undefined ? "" : previous.entryDigest;
      const seq = entries.length + 1;
      const at = startMs + (seq - 1) * stepMs;
      const entry: JourneyJournalEntry = Object.freeze({
        seq,
        at,
        step,
        facts: snapshotOf(facts),
        prevDigest,
        entryDigest: computeDigest({ tag: "playliquid:lab-journey:journal-entry:1", seq, at, step, facts: snapshotOf(facts), prevDigest }),
      });
      entries.push(entry);
    },
    entries: () => Object.freeze([...entries]),
    headDigest: () => (entries.length === 0 ? "" : entries[entries.length - 1]!.entryDigest),
    size: () => entries.length,
    verify() {
      let previous = "";
      for (const entry of entries) {
        if (entry.prevDigest !== previous) return false;
        const rederived = computeDigest({
          tag: "playliquid:lab-journey:journal-entry:1",
          seq: entry.seq,
          at: entry.at,
          step: entry.step,
          facts: entry.facts,
          prevDigest: entry.prevDigest,
        });
        if (rederived !== entry.entryDigest) return false;
        previous = entry.entryDigest;
      }
      return true;
    },
  };
}

/** Seals the content-addressed journey document (the run's durable product). */
export function sealJourneyDocument(input: {
  readonly tenant: string;
  readonly subject: string;
  readonly phases: Readonly<Record<string, unknown>>;
  readonly journal: JourneyJournal;
}): JourneyDocument {
  const content = {
    kind: "lab-arena-community-journey" as const,
    tenant: input.tenant,
    subject: input.subject,
    phases: input.phases,
    journalHead: input.journal.headDigest(),
    journalLength: input.journal.size(),
  };
  return Object.freeze({ ...content, documentDigest: computeDigest({ tag: "playliquid:lab-journey:document:1", document: content }) });
}
