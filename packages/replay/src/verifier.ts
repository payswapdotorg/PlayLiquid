/**
 * THE PROBABILISTIC INTEGRITY VERIFIER (R11 — lock 29: competitive-integrity
 * signals are evidence/confidence, never magical certainty).
 *
 * The verifier port answers ONE question with typed evidence: does the
 * recorded replay re-execute to the same event stream? The reference
 * implementation here is deterministic and honest about what it checked:
 *
 * - it re-executes the record through the deterministic engine (E9);
 * - it samples K event sequence positions from the recorded witness — the
 *   sample is chosen by a SEEDED, deterministic sampler (same record →
 *   same sample, forever), defaulting to the full stream;
 * - it compares recorded vs re-executed canonical event bytes at every
 *   sampled position;
 * - the verdict carries an explicit CONFIDENCE = verified positions /
 *   total positions — the coverage of THIS check. A "match" verdict at
 *   confidence c means: every one of the K sampled events re-executed
 *   byte-identically, and c of the stream was looked at. It is evidence,
 *   not proof of capture honesty (the recorder could have captured
 *   anything); it is never presented as certainty.
 *
 * Verdict kinds:
 * - "match": all sampled positions agree. confidence = K/N (coverage).
 * - "divergence": at least one sampled position disagrees — the
 *   divergence is deterministically proven, so confidence in the verdict
 *   itself is 1; the evidence lists the divergent positions.
 * - "inconclusive": re-execution or witness loading failed (typed reason);
 *   confidence 0. Never guessed.
 *
 * Pure module: no IO. The sampling function is deterministic (E9).
 */

import type { ReplaySource } from "./source.ts";
import type { ReplayTargetLauncher } from "./reexecute.ts";
import { reExecuteReplay } from "./reexecute.ts";
import type { EventDivergence } from "./reexecute.ts";
import { eventEnvelopeForm } from "./event-witness.ts";
import { verifyEventWitness } from "./event-witness.ts";

/** One integrity verification request. */
export interface IntegrityVerificationRequest {
  readonly replayId: string;
  readonly source: ReplaySource;
  readonly launcher: ReplayTargetLauncher;
  /**
   * Fraction (0, 1] of event positions to verify byte-for-byte. Default 1
   * (exhaustive). Lower rates trade coverage for speed — the verdict's
   * confidence reports exactly what was covered.
   */
  readonly sampleRate?: number;
}

/** The typed R11 verdict. */
export type IntegrityVerdict =
  | {
      readonly kind: "match";
      /** Coverage of this check: sampled/total event positions. */
      readonly confidence: number;
      readonly sampledEventSeqs: readonly number[];
      readonly verifiedCount: number;
      readonly totalEventCount: number;
    }
  | {
      readonly kind: "divergence";
      /** The reported divergence is deterministically proven. */
      readonly confidence: number;
      readonly sampledEventSeqs: readonly number[];
      readonly divergences: readonly EventDivergence[];
      readonly totalEventCount: number;
    }
  | {
      readonly kind: "inconclusive";
      readonly confidence: number;
      readonly reason: { readonly code: string; readonly detail: string };
    };

/** The verifier port (PL-018 implements the service-backed one). */
export interface ReplayIntegrityVerifier {
  verify(request: IntegrityVerificationRequest): IntegrityVerdict;
}

/** FNV-1a 32-bit hash (deterministic, engine-independent). */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic sample of `sampleCount` distinct 1-based positions from
 * `count`. Same seed → same sample on every machine (E9). The sampler is
 * a deterministic selection strategy, NOT a general randomness authority
 * (the RNG port belongs to the runtimes).
 */
export function deterministicSample(seed: string, count: number, sampleCount: number): readonly number[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const target = Math.min(Math.max(sampleCount, 1), count);
  const chosen = new Set<number>();
  let attempt = 0;
  while (chosen.size < target && attempt < count * 8) {
    const draw = fnv1a32(`${seed}:${attempt}`) % count + 1;
    chosen.add(draw);
    attempt += 1;
  }
  let fill = 1;
  while (chosen.size < target && fill <= count) {
    chosen.add(fill);
    fill += 1;
  }
  return [...chosen].sort((a, b) => a - b);
}

/** Creates the reference deterministic integrity verifier. */
export function createReferenceIntegrityVerifier(): ReplayIntegrityVerifier {
  return {
    verify(request: IntegrityVerificationRequest): IntegrityVerdict {
      const run = reExecuteReplay({
        replayId: request.replayId,
        source: request.source,
        launcher: request.launcher,
      });
      if (run.status === "rejected") {
        return { kind: "inconclusive", confidence: 0, reason: { code: run.code, detail: run.detail } };
      }
      const record = request.source.loadReplay(request.replayId);
      if (record === undefined) {
        return { kind: "inconclusive", confidence: 0, reason: { code: "unknown-replay", detail: "record vanished during verification" } };
      }
      const witness = request.source.loadEventWitness(record.eventWitness);
      if (witness === undefined) {
        return { kind: "inconclusive", confidence: 0, reason: { code: "witness-missing", detail: `no event witness ${record.eventWitness}` } };
      }
      const witnessVerification = verifyEventWitness(witness);
      if (!witnessVerification.ok) {
        return { kind: "inconclusive", confidence: 0, reason: { code: "witness-unverifiable", detail: `${witnessVerification.code}: ${witnessVerification.detail}` } };
      }
      const total = witness.events.length;
      if (total === 0) {
        return { kind: "match", confidence: 1, sampledEventSeqs: [], verifiedCount: 0, totalEventCount: 0 };
      }
      const rate = request.sampleRate ?? 1;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > 1) {
        return { kind: "inconclusive", confidence: 0, reason: { code: "invalid-sample-rate", detail: `sampleRate must be within (0, 1], got ${String(rate)}` } };
      }
      const sampleCount = Math.max(1, Math.ceil(rate * total));
      const seed = `${record.eventWitness}:${record.replayId}`;
      const positions = deterministicSample(seed, total, sampleCount);
      const divergences: EventDivergence[] = [];
      for (const position of positions) {
        const index = position - 1;
        const recorded = witness.events[index];
        const reexecuted = run.events[index];
        const recordedForm = recorded === undefined ? "<absent>" : eventEnvelopeForm(recorded);
        const reexecutedForm = reexecuted === undefined ? "<absent>" : eventEnvelopeForm(reexecuted);
        if (recordedForm !== reexecutedForm) {
          divergences.push({
            seq: record.capture.fromEventSeq + index,
            recordedForm,
            reexecutedForm,
          });
        }
      }
      if (divergences.length > 0) {
        return {
          kind: "divergence",
          confidence: 1,
          sampledEventSeqs: positions.map((position) => record.capture.fromEventSeq + position - 1),
          divergences,
          totalEventCount: total,
        };
      }
      if (run.events.length !== total) {
        return {
          kind: "divergence",
          confidence: 1,
          sampledEventSeqs: positions.map((position) => record.capture.fromEventSeq + position - 1),
          divergences: [
            {
              seq: record.capture.fromEventSeq + Math.min(total, run.events.length),
              recordedForm: total > run.events.length ? "<present>" : "<absent>",
              reexecutedForm: total > run.events.length ? "<absent>" : "<present>",
            },
          ],
          totalEventCount: total,
        };
      }
      return {
        kind: "match",
        confidence: positions.length / total,
        sampledEventSeqs: positions.map((position) => record.capture.fromEventSeq + position - 1),
        verifiedCount: positions.length,
        totalEventCount: total,
      };
    },
  };
}
