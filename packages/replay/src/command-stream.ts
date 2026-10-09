/**
 * THE RECORDED COMMAND STREAM (content-addressed, E9/E10).
 *
 * A replay's command stream is the ordered log of the commands that were
 * ADMITTED through the canonical admission gate during the captured range
 * (E2: the envelope level — every entry re-admits through the same gate on
 * re-execution; there is no second command channel). Each entry records:
 *
 * - `admissionSeq`: the per-session admission sequence number the live run
 *   assigned — re-feeding entries IN THIS ORDER reproduces the identical
 *   (dueTick, assignedSeq) scheduling inside the deterministic queue;
 * - `dueTick`: the logical tick the command was scheduled to execute at;
 * - `envelope`: the canonical `RuntimeCommandEnvelope` (payload in the
 *   GameIR value language).
 *
 * The artifact's canonical form is package-system `canonicalJson` over the
 * JSON-safe encoding; its digest is `computeDigest` of that form — identical
 * entries yield identical bytes and identical digests on every machine.
 * {@link verifyCommandStream} recomputes form+digest and fails closed.
 *
 * Pure module: no IO.
 */

import { canonicalJson, computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { RuntimeCommandEnvelope } from "@playliquid/runtime-contracts";
import type { GameIRValue } from "@playliquid/game-ir";
import { encodeCommandEnvelope, decodeCommandEnvelope } from "./artifact-codec.ts";
import type { JsonSafe } from "./artifact-codec.ts";

/** One admitted command as recorded for replay. */
export interface RecordedCommand {
  /** Per-session admission sequence (unique, strictly ascending in the stream). */
  readonly admissionSeq: number;
  /** Logical tick the command is due to execute at. */
  readonly dueTick: number;
  readonly envelope: RuntimeCommandEnvelope<GameIRValue>;
}

/** The sealed, content-addressed command stream artifact. */
export interface CommandStreamArtifact {
  readonly streamDigest: ContentDigest;
  /** Canonical bytes (canonicalJson of the JSON-safe encoding). */
  readonly form: string;
  /** The typed entries, in admission order. */
  readonly entries: readonly RecordedCommand[];
}

/** Typed verification result for a command stream artifact. */
export type CommandStreamVerification =
  | { readonly ok: true; readonly streamDigest: ContentDigest }
  | {
      readonly ok: false;
      readonly code: "malformed-entries" | "form-mismatch" | "digest-mismatch";
      readonly detail: string;
    };

function encodeEntry(entry: RecordedCommand): JsonSafe {
  return {
    s: entry.admissionSeq,
    d: entry.dueTick,
    c: encodeCommandEnvelope(entry.envelope),
  };
}

function validateEntries(entries: readonly RecordedCommand[]): string | null {
  let previous = 0;
  const commandIds = new Set<string>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.admissionSeq) || entry.admissionSeq <= previous) {
      return `admissionSeq must be a positive integer strictly ascending, got ${entry.admissionSeq} after ${previous}`;
    }
    previous = entry.admissionSeq;
    if (!Number.isInteger(entry.dueTick) || entry.dueTick < 1) {
      return `dueTick must be a positive integer, got ${entry.dueTick}`;
    }
    if (typeof entry.envelope.commandId !== "string" || entry.envelope.commandId.length === 0) {
      return "envelope commandId missing";
    }
    if (commandIds.has(entry.envelope.commandId)) {
      return `duplicate commandId ${entry.envelope.commandId}`;
    }
    commandIds.add(entry.envelope.commandId);
  }
  return null;
}

/**
 * Seals the recorded commands into a content-addressed artifact. Entries
 * are sorted by admissionSeq (the canonical stream order). Throws on
 * structurally invalid entries (fail closed at write time).
 */
export function sealCommandStream(entries: readonly RecordedCommand[]): CommandStreamArtifact {
  const sorted = [...entries].sort((a, b) => a.admissionSeq - b.admissionSeq);
  const violation = validateEntries(sorted);
  if (violation !== null) {
    throw new RangeError(`command-stream: ${violation}`);
  }
  const value: JsonSafe = sorted.map((entry) => encodeEntry(entry));
  const form = canonicalJson(value);
  return {
    streamDigest: computeDigest(value),
    form,
    entries: sorted,
  };
}

/**
 * Verifies a command stream artifact end-to-end: entries re-encode to the
 * recorded canonical form byte-for-byte and the digest addresses it. Pure,
 * never throws (typed result).
 */
export function verifyCommandStream(artifact: CommandStreamArtifact): CommandStreamVerification {
  const violation = validateEntries(artifact.entries);
  if (violation !== null) {
    return { ok: false, code: "malformed-entries", detail: violation };
  }
  const value: JsonSafe = artifact.entries.map((entry) => encodeEntry(entry));
  const form = canonicalJson(value);
  if (form !== artifact.form) {
    return { ok: false, code: "form-mismatch", detail: "canonical form does not match the recorded entries" };
  }
  const digest = computeDigest(value);
  if (digest !== artifact.streamDigest) {
    return { ok: false, code: "digest-mismatch", detail: "stream digest does not address the canonical form" };
  }
  return { ok: true, streamDigest: artifact.streamDigest };
}

/** Decodes a command stream's typed entries from its canonical form. */
export function decodeCommandStreamForm(form: string): readonly RecordedCommand[] {
  const parsed: unknown = JSON.parse(form);
  if (!Array.isArray(parsed)) {
    throw new TypeError("command-stream: form is not an array");
  }
  const entries: RecordedCommand[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      throw new TypeError("command-stream: malformed entry");
    }
    const node = item as { [key: string]: unknown };
    if (typeof node.s !== "number" || !Number.isInteger(node.s) || node.s < 1) {
      throw new TypeError("command-stream: malformed admissionSeq");
    }
    if (typeof node.d !== "number" || !Number.isInteger(node.d) || node.d < 1) {
      throw new TypeError("command-stream: malformed dueTick");
    }
    if (node.c === undefined) {
      throw new TypeError("command-stream: missing envelope");
    }
    entries.push({
      admissionSeq: node.s,
      dueTick: node.d,
      envelope: decodeCommandEnvelope(node.c as JsonSafe),
    });
  }
  const violation = validateEntries(entries);
  if (violation !== null) {
    throw new RangeError(`command-stream: ${violation}`);
  }
  return entries;
}
