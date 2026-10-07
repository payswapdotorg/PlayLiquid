/**
 * BEHAVIORAL EVIDENCE RECORD CONTRACTS (R11 / E11 refinement, PL-009).
 *
 * Architecture "Competitive Integrity": "The platform evaluates
 * bot/automation/AI-assisted play using behavioral evidence such as
 * trajectories, timing and outcome patterns."
 *
 * This module types the EVIDENCE CARRIERS of that evaluation. Evidence is
 * digest-pinned and opaque here: a {@link BehavioralEvidenceRecord} carries
 * the kind of behavior observed, the digest of the opaque payload the
 * detector produced, the digest of the authoritative source the payload was
 * derived from, and nothing else. Raw arrays of floats are NEVER contract
 * data — contracts reference content-addressed payloads (lock rule 9) and
 * leave interpretation to the integrity service (PL-018).
 *
 * Downstream citation discipline (E11): verdicts
 * (integrity-verdicts.ts) and enforcement decisions
 * (integrity-enforcement.ts) cite evidence through
 * {@link EvidenceCitation} — id + payload digest — so every statement
 * about a subject stays traceable to pinned content.
 *
 * Purity: pure types + pure guards + one pure citation matcher. No IO, no
 * clock reads (timestamps are caller-supplied), no detection algorithms.
 */

import { isValidIdText } from "@playliquid/game-contracts";
import type { Brand } from "@playliquid/game-contracts";
import type { ContentDigest, SubjectId, TenantId, TimestampMs } from "./primitives.ts";
import { isValidContentDigest } from "./primitives.ts";

/** Identifier of one behavioral evidence record. */
export type EvidenceRecordId = Brand<string, "EvidenceRecordId">;

/** Parses and validates `text` as an {@link EvidenceRecordId}. */
export function asEvidenceRecordId(text: string): EvidenceRecordId | undefined {
  return isValidIdText(text) ? (text as EvidenceRecordId) : undefined;
}

// ---------------------------------------------------------------------------
// Evidence kind vocabulary (frozen — architecture wording)
// ---------------------------------------------------------------------------

/**
 * The behavioral evidence kinds the platform analyzes: trajectories,
 * timing and outcome patterns. Frozen table: adding a kind is a contract
 * change, not an implementation detail.
 */
export type BehavioralEvidenceKind = "trajectory" | "timing" | "outcome-pattern";

/** All valid {@link BehavioralEvidenceKind} values. */
export const BEHAVIORAL_EVIDENCE_KINDS: readonly BehavioralEvidenceKind[] = Object.freeze([
  "trajectory",
  "timing",
  "outcome-pattern",
]);

/** Returns true when `value` is a valid {@link BehavioralEvidenceKind}. */
export function isBehavioralEvidenceKind(value: unknown): value is BehavioralEvidenceKind {
  return typeof value === "string" && (BEHAVIORAL_EVIDENCE_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Evidence record
// ---------------------------------------------------------------------------

/**
 * Disjoint record marker: only platform-side evidence ingestion may
 * structurally produce this literal. Game/client-originated data never
 * carries it (mirrors the authority-marker pattern in primitives.ts).
 */
export type EvidenceRecordMarker = "integrity-evidence";

/**
 * One behavioral evidence record: kind + digest-pinned opaque payload +
 * digest-pinned authoritative source. The payload itself (and any float
 * array inside it) lives in content-addressed storage — never here.
 */
export interface BehavioralEvidenceRecord {
  readonly recordKind: EvidenceRecordMarker;
  readonly evidenceId: EvidenceRecordId;
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly kind: BehavioralEvidenceKind;
  /** Digest of the opaque detector payload (content-addressed, lock 9). */
  readonly payloadDigest: ContentDigest;
  /**
   * Digest of the declared payload schema/shape the payload was checked
   * against before admission. Optional: raw telemetry may be shapeless.
   */
  readonly shapeDigest?: ContentDigest;
  /** Digest of the authoritative source (replay, session record, QA run). */
  readonly sourceDigest: ContentDigest;
  /** When the evidence was captured — ALWAYS caller-supplied (purity). */
  readonly capturedAt: TimestampMs;
}

/** Returns true when `value` is a structurally valid {@link BehavioralEvidenceRecord}. */
export function isBehavioralEvidenceRecord(value: unknown): value is BehavioralEvidenceRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.recordKind !== "integrity-evidence") return false;
  if (typeof record.evidenceId !== "string" || record.evidenceId.length === 0) return false;
  if (typeof record.subject !== "string" || record.subject.length === 0) return false;
  if (!isBehavioralEvidenceKind(record.kind)) return false;
  if (typeof record.payloadDigest !== "string" || !isValidContentDigest(record.payloadDigest)) {
    return false;
  }
  if (typeof record.sourceDigest !== "string" || !isValidContentDigest(record.sourceDigest)) {
    return false;
  }
  if (record.shapeDigest !== undefined) {
    if (typeof record.shapeDigest !== "string" || !isValidContentDigest(record.shapeDigest)) {
      return false;
    }
  }
  return typeof record.capturedAt === "number" && Number.isSafeInteger(record.capturedAt) && record.capturedAt >= 0;
}

// ---------------------------------------------------------------------------
// Citations (how verdicts and decisions reference evidence)
// ---------------------------------------------------------------------------

/**
 * How a verdict or enforcement decision cites one evidence record: the
 * evidence id plus the payload digest it was issued against. The digest
 * pin means a citation can never silently drift to different content.
 */
export interface EvidenceCitation {
  readonly evidenceId: EvidenceRecordId;
  readonly payloadDigest: ContentDigest;
}

/** Returns true when `value` is a structurally valid {@link EvidenceCitation}. */
export function isEvidenceCitation(value: unknown): value is EvidenceCitation {
  if (typeof value !== "object" || value === null) return false;
  const citation = value as Record<string, unknown>;
  if (typeof citation.evidenceId !== "string" || citation.evidenceId.length === 0) return false;
  return typeof citation.payloadDigest === "string" && isValidContentDigest(citation.payloadDigest);
}

/**
 * Pure citation matcher: a citation cites `record` iff ids match AND the
 * cited digest equals the record's payload digest. A stale citation
 * (digest of older payload content) never matches — evidence-before-
 * enforcement chains stay honest (E11).
 */
export function citationMatchesRecord(
  citation: EvidenceCitation,
  record: BehavioralEvidenceRecord,
): boolean {
  return citation.evidenceId === record.evidenceId && citation.payloadDigest === record.payloadDigest;
}

/**
 * Pure resolution of a citation against a body of records: the unique
 * record the citation pins, or `undefined` when no record matches (unknown
 * id or stale digest).
 */
export function resolveEvidenceCitation(
  citation: EvidenceCitation,
  records: readonly BehavioralEvidenceRecord[],
): BehavioralEvidenceRecord | undefined {
  return records.find((record) => citationMatchesRecord(citation, record));
}
