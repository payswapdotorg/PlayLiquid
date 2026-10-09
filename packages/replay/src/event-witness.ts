/**
 * THE RECORDED EVENT WITNESS (content-addressed, E2/E10).
 *
 * The event witness is the recorded half of a replay: the canonical event
 * envelopes produced by the captured range, in sequence order, plus a
 * per-event rolling digest CHAIN that makes the whole witness tamper-evident
 * (any mutation of any event — or of the order — changes every subsequent
 * chain link). Players consume the witness to watch a replay (R8); the
 * integrity verifier compares it against a re-executed stream (R11).
 *
 * Byte stability (E9): the canonical form is package-system `canonicalJson`
 * over the JSON-safe envelope encoding (artifact-codec.ts); the chain is
 * sha256 over `previous:form` pairs. Identical events yield identical bytes
 * and digests on every machine.
 *
 * Purity: no IO.
 */

import { createHash } from "node:crypto";
import { canonicalJson, computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { RuntimeEventEnvelope } from "@playliquid/runtime-contracts";
import type { GameIRValue } from "@playliquid/game-ir";
import { encodeEventEnvelope, decodeEventEnvelope } from "./artifact-codec.ts";
import type { JsonSafe } from "./artifact-codec.ts";

/** The sealed, content-addressed event witness artifact. */
export interface EventWitnessArtifact {
  readonly witnessDigest: ContentDigest;
  /** Canonical bytes of the encoded event list. */
  readonly form: string;
  /** The recorded events, in ascending contiguous sequence order. */
  readonly events: readonly RuntimeEventEnvelope<GameIRValue>[];
  /**
   * Rolling digest chain: chain[i] = sha256(chain[i-1] + ":" + form(events[i])),
   * anchored at chain[-1] = "" (so chain[0] = sha256(":" + form(events[0]))).
   */
  readonly chain: readonly string[];
}

/** Typed verification result for an event witness. */
export type EventWitnessVerification =
  | { readonly ok: true; readonly witnessDigest: ContentDigest; readonly eventCount: number }
  | {
      readonly ok: false;
      readonly code: "malformed-events" | "form-mismatch" | "digest-mismatch" | "chain-mismatch";
      readonly detail: string;
    };

/** Canonical bytes of one event envelope (the chain's per-event unit). */
export function eventEnvelopeForm(event: RuntimeEventEnvelope<GameIRValue>): string {
  return canonicalJson(encodeEventEnvelope(event));
}

function validateEvents(events: readonly RuntimeEventEnvelope<GameIRValue>[]): string | null {
  let expected: number | null = null;
  const sessionIds = new Set<string>();
  for (const event of events) {
    const seq = Number(event.seq);
    if (!Number.isInteger(seq) || seq < 1) {
      return `event seq malformed: ${String(event.seq)}`;
    }
    if (expected !== null && seq !== expected) {
      return `event seq must be contiguous ascending: expected ${expected}, got ${seq}`;
    }
    expected = seq + 1;
    sessionIds.add(String(event.sessionId));
    if (sessionIds.size > 1) {
      return "event witness mixes sessions";
    }
  }
  return null;
}

function computeChain(events: readonly RuntimeEventEnvelope<GameIRValue>[]): string[] {
  const chain: string[] = [];
  let previous = "";
  for (const event of events) {
    previous = createHash("sha256").update(`${previous}:${eventEnvelopeForm(event)}`, "utf8").digest("hex");
    chain.push(previous);
  }
  return chain;
}

/**
 * Seals the recorded events into a content-addressed witness. Events must
 * be contiguous ascending by seq and single-session (the capture range is
 * one session's lineage). Throws on violation (fail closed at write time).
 */
export function sealEventWitness(events: readonly RuntimeEventEnvelope<GameIRValue>[]): EventWitnessArtifact {
  const violation = validateEvents(events);
  if (violation !== null) {
    throw new RangeError(`event-witness: ${violation}`);
  }
  const value: JsonSafe = events.map((event) => encodeEventEnvelope(event));
  const form = canonicalJson(value);
  return {
    witnessDigest: computeDigest(value),
    form,
    events,
    chain: computeChain(events),
  };
}

/**
 * Verifies an event witness end-to-end: events re-encode to the recorded
 * form byte-for-byte, the digest addresses the form, and every chain link
 * recomputes. Pure, never throws (typed result).
 */
export function verifyEventWitness(artifact: EventWitnessArtifact): EventWitnessVerification {
  const violation = validateEvents(artifact.events);
  if (violation !== null) {
    return { ok: false, code: "malformed-events", detail: violation };
  }
  const value: JsonSafe = artifact.events.map((event) => encodeEventEnvelope(event));
  const form = canonicalJson(value);
  if (form !== artifact.form) {
    return { ok: false, code: "form-mismatch", detail: "canonical form does not match the recorded events" };
  }
  const digest = computeDigest(value);
  if (digest !== artifact.witnessDigest) {
    return { ok: false, code: "digest-mismatch", detail: "witness digest does not address the canonical form" };
  }
  const chain = computeChain(artifact.events);
  if (chain.length !== artifact.chain.length || chain.some((link, index) => link !== artifact.chain[index])) {
    return { ok: false, code: "chain-mismatch", detail: "rolling digest chain does not match the recorded events" };
  }
  return { ok: true, witnessDigest: artifact.witnessDigest, eventCount: artifact.events.length };
}

/** Decodes a witness's typed events from its canonical form. */
export function decodeEventWitnessForm(form: string): readonly RuntimeEventEnvelope<GameIRValue>[] {
  const parsed: unknown = JSON.parse(form);
  if (!Array.isArray(parsed)) {
    throw new TypeError("event-witness: form is not an array");
  }
  const events = parsed.map((item) => decodeEventEnvelope(item as JsonSafe));
  const violation = validateEvents(events);
  if (violation !== null) {
    throw new RangeError(`event-witness: ${violation}`);
  }
  return events;
}

/**
 * The chain link covering the event at index `index` (0-based) — the
 * tamper-evidence unit the integrity verifier compares per sampled event.
 */
export function witnessChainLink(artifact: EventWitnessArtifact, index: number): string | undefined {
  return artifact.chain[index];
}
