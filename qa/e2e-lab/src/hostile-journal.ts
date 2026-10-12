/**
 * THE HOSTILE JOURNAL (E10) + the content-addressed hostile-run seal (qa/e2e-lab).
 *
 * One append-only, hash-chained journal records every step of the adversarial
 * journey-scale walk in admission order, mirroring the evidence discipline of
 * examples/lab-journey's journal over the SAME single digest authority — but
 * with this suite's own domain-separation tag and a PURE chain oracle, so
 * the tamper negatives can re-derive ANY entry array (including a mutated
 * structural copy) and prove the chain catches the edit:
 *
 * - each entry carries its sequence number, the INJECTED clock's reading at
 *   record time, the step name, JSON-safe facts, the digest of the PREVIOUS
 *   entry (`""` anchors the first entry) and its own content-addressed
 *   digest (`@playliquid/package-system`'s `computeDigest`, E5/E7);
 * - entries are FROZEN at append time: there is no rewrite, reorder or
 *   delete operation anywhere in this module (E10);
 * - {@link verifyHostileChain} re-derives the whole chain over ANY entry
 *   array — the tamper oracle the negative tests point at mutated copies;
 * - the journal head + the sealed run digest make the E9 determinism claim
 *   checkable: run the hostile journey twice, compare.
 *
 * Pure in-memory evidence: no IO, no timers (the clock is injected), no
 * randomness (digests are content-derived).
 */

import { computeDigest } from "../../../packages/package-system/src/index.ts";

/** The hostile journal's domain-separation tag (≠ the example's). */
const HOSTILE_JOURNAL_TAG = "playliquid:qa-e2e-lab:hostile-journal:1";

/** One appended hostile-journal entry (frozen at append time; E10). */
export interface HostileJournalEntry {
  /** 1-based, strictly increasing admission order. */
  readonly seq: number;
  /** The injected hostile clock at record time (ms). */
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

/** The append-only journal of one hostile run. */
export interface HostileJournal {
  /** Append one step (the only write; the clock advances by the fixed step). */
  record(step: string, facts: unknown): void;
  /** The entries so far (frozen copy). */
  entries(): readonly HostileJournalEntry[];
  /** The chain head: the last entry's digest (or `""` when empty). */
  headDigest(): string;
  /** The entry count. */
  size(): number;
  /** Re-derives this journal's whole chain (the E10 tamper oracle). */
  verify(): boolean;
}

/** The content-addressed seal of one completed hostile run. */
export interface HostileRunSeal {
  readonly kind: "qa-e2e-lab-hostile-run";
  readonly tenant: string;
  readonly journalHead: string;
  readonly journalLength: number;
  /** The content-addressed digest of the seal (the E9 comparison key). */
  readonly sealDigest: string;
}

/**
 * Deep-copies + freezes JSON-safe facts at append time. The journal owns an
 * IMMUTABLE SNAPSHOT of every step's facts: a caller mutating the value it
 * passed can never reach into an already-recorded entry (E10).
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

/** Re-derives one entry's content-addressed digest (the chain's hash rule). */
function entryDigestOf(entry: HostileJournalEntry): string {
  return computeDigest({
    tag: HOSTILE_JOURNAL_TAG,
    seq: entry.seq,
    at: entry.at,
    step: entry.step,
    facts: entry.facts,
    prevDigest: entry.prevDigest,
  });
}

/**
 * THE PURE CHAIN ORACLE: re-derives every entry digest + link over ANY
 * entry array — the journal uses it on its own frozen trail, and the tamper
 * negatives point it at mutated structural copies (an edited fact, a
 * reordered trail, a swapped digest) to prove the chain catches the edit.
 */
export function verifyHostileChain(entries: readonly HostileJournalEntry[]): boolean {
  let previous = "";
  for (const entry of entries) {
    if (entry.prevDigest !== previous) return false;
    if (entryDigestOf(entry) !== entry.entryDigest) return false;
    previous = entry.entryDigest;
  }
  return true;
}

/**
 * Creates the hostile journal: a sequence-derived clock anchors every entry
 * (`at = startMs + seq * stepMs`) — no time is ever read; the timestamps are
 * content of the run, not environment (E9).
 */
export function createHostileJournal(startMs: number, stepMs: number): HostileJournal {
  const entries: HostileJournalEntry[] = [];
  return {
    record(step, facts) {
      const previous = entries[entries.length - 1];
      const prevDigest = previous === undefined ? "" : previous.entryDigest;
      const seq = entries.length + 1;
      const at = startMs + (seq - 1) * stepMs;
      const frozen = snapshotOf(facts);
      entries.push(
        Object.freeze({
          seq,
          at,
          step,
          facts: frozen,
          prevDigest,
          entryDigest: computeDigest({ tag: HOSTILE_JOURNAL_TAG, seq, at, step, facts: frozen, prevDigest }),
        }),
      );
    },
    entries: () => Object.freeze([...entries]),
    headDigest: () => (entries.length === 0 ? "" : entries[entries.length - 1]!.entryDigest),
    size: () => entries.length,
    verify: () => verifyHostileChain(entries),
  };
}

/** Seals the content-addressed digest of one completed hostile run (E9). */
export function sealHostileRun(input: {
  readonly tenant: string;
  readonly journal: HostileJournal;
  readonly phases: Readonly<Record<string, unknown>>;
}): HostileRunSeal {
  const content = {
    kind: "qa-e2e-lab-hostile-run" as const,
    tenant: input.tenant,
    phases: input.phases,
    journalHead: input.journal.headDigest(),
    journalLength: input.journal.size(),
  };
  return Object.freeze({ ...content, sealDigest: computeDigest({ tag: "playliquid:qa-e2e-lab:hostile-run-seal:1", run: content }) }) satisfies HostileRunSeal;
}

