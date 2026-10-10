/**
 * APPEND-ONLY EVIDENCE LEDGER (E10) — immutable, content-addressed exchange
 * records for the Blender adapter. Every dispatch/outcome pair is recorded
 * exactly once as a frozen record whose identity is a digest pinning its
 * content; records are never edited and content-identical appends return
 * the original record (content-addressed idempotency). The ledger itself is
 * a pure in-memory structure owned by the adapter instance (E1: one owner
 * per mutable state — the append list); persistence is a host concern.
 *
 * Implements: PL-025 evidence discipline (E10: append-only evidence;
 * digest-pinned; historical evidence is immutable).
 */

import { contentDigestOf } from "./digest.ts";

/** One immutable exchange record: the dispatch as received + the result. */
export interface BlenderExchangeRecord {
  readonly kind: "blender-exchange-record";
  /** Content-addressed identity of this record (digest-pinned). */
  readonly recordDigest: string;
  readonly sequence: number;
  /** The dispatch envelope as observed (commandId, capability, payload). */
  readonly commandId: string;
  readonly capability: string;
  readonly payloadDigest: string;
  readonly outcome: "ok" | "refused" | "failed";
  readonly refusalCode?: string;
  readonly errorCode?: string;
  /** AdapterAuthority stamp of the result (authoritative outcomes only). */
  readonly authorityDigest: string;
}

/** The append entry (recordDigest + sequence are derived, never supplied). */
export type BlenderExchangeAppendEntry = Omit<BlenderExchangeRecord, "recordDigest" | "sequence">;

/** Read-only view over the append-only ledger. */
export interface BlenderEvidenceLedger {
  /** All records in append order (frozen copies). */
  readonly records: readonly BlenderExchangeRecord[];
  /** Finds a record by digest identity; undefined when absent. */
  findByDigest(digest: string): BlenderExchangeRecord | undefined;
  /** The full ledger digest: content digest of the record digest list. */
  readonly ledgerDigest: string;
}

/** The ledger plus its append-only write surface (adapter-internal). */
export interface BlenderEvidenceAppender extends BlenderEvidenceLedger {
  /** Appends (or returns the content-identical original); never edits. */
  append(entry: BlenderExchangeAppendEntry): BlenderExchangeRecord;
}

/** Creates the append-only evidence ledger (pure; one instance per adapter). */
export function createBlenderEvidenceLedger(): BlenderEvidenceAppender {
  const records: BlenderExchangeRecord[] = [];
  const byDigest = new Map<string, BlenderExchangeRecord>();

  function append(entry: BlenderExchangeAppendEntry): BlenderExchangeRecord {
    // Content identity is SEQUENCE-FREE: the entry content alone decides
    // whether this append is a duplicate. Sequence is ledger position
    // metadata assigned only to genuinely new records.
    const contentDigest = contentDigestOf(entry);
    const existing = byDigest.get(contentDigest);
    if (existing !== undefined) {
      // Content-addressed duplicate: return the original, append nothing (E10).
      return existing;
    }
    const record: BlenderExchangeRecord = Object.freeze({
      ...entry,
      sequence: records.length,
      recordDigest: contentDigestOf({ ...entry, sequence: records.length }),
    });
    records.push(record);
    // Both identities index the same immutable record: the sequence-free
    // content digest (duplicate detection) and the pinned record digest
    // (the published, sequence-carrying identity).
    byDigest.set(contentDigest, record);
    byDigest.set(record.recordDigest, record);
    return record;
  }

  return Object.freeze({
    append,
    get records(): readonly BlenderExchangeRecord[] {
      return Object.freeze([...records]);
    },
    findByDigest(digest: string): BlenderExchangeRecord | undefined {
      return byDigest.get(digest);
    },
    get ledgerDigest(): string {
      return contentDigestOf(records.map((record) => record.recordDigest));
    },
  });
}
