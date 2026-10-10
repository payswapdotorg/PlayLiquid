/**
 * BEHAVIORAL OBSERVATIONS — the deterministic feature layer (PL-018).
 *
 * Architecture "Competitive Integrity": "The platform evaluates
 * bot/automation/AI-assisted play using behavioral evidence such as
 * trajectories, timing and outcome patterns."
 *
 * This module turns TYPED, VERIFIED input records into typed, JSON-safe,
 * digest-pinnable OBSERVATIONS. It performs NO detection and makes NO
 * claims: every field is a plain statistic of the input (counts, means,
 * shares). Interpretation happens in signals.ts under a policy; the
 * observations themselves are the pinned payload a
 * BehavioralEvidenceRecord addresses (payloadDigest = digestOf the
 * observation object — PL-009 integrity-evidence.ts: raw float arrays are
 * NEVER contract data, content-addressed payloads are).
 *
 * Inputs are consumed READ-ONLY (R8 integrity lane: evidence extraction):
 * - the recorded command stream entries from @playliquid/replay
 *   (CommandStreamArtifact.entries — already fail-closed-verified by
 *   admission before extraction);
 * - the re-execution comparison verdict from @playliquid/replay's
 *   verifier (match/divergence/inconclusive with explicit coverage).
 *
 * Determinism (E9): every statistic is a pure arithmetic function of the
 * input in input order. No sampling, no randomness, no clock reads. The
 * same trace yields byte-identical observations, forever.
 *
 * Purity: no IO.
 */

import type { RecordedCommand } from "@playliquid/replay";
import type { IntegrityVerdict } from "@playliquid/replay";
import type { CommandOrigin } from "@playliquid/runtime-contracts";

// ---------------------------------------------------------------------------
// Timing observations (kind: "timing")
// ---------------------------------------------------------------------------

/** Plain statistics of WHEN commands were issued and scheduled. */
export interface TimingObservations {
  readonly observationKind: "timing";
  /** Number of commands in the trace (N). */
  readonly commandCount: number;
  /** Number of consecutive issued-at gaps (N - 1). */
  readonly gapCount: number;
  /** Mean inter-command issued-at gap in ms (0 when no gaps). */
  readonly meanGapMs: number;
  /** Coefficient of variation of the gaps (population; 0 when regular). */
  readonly gapCv: number;
  /** Share of gaps equal to the modal gap (burst/regularity concentration). */
  readonly modalGapShare: number;
  /** Coefficient of variation of commands per due tick (burstiness). */
  readonly tickPressureCv: number;
  /** Maximum commands scheduled for one due tick. */
  readonly maxCommandsPerTick: number;
}

// ---------------------------------------------------------------------------
// Trajectory observations (kind: "trajectory")
// ---------------------------------------------------------------------------

/** Plain statistics of WHAT the subject's command path looks like. */
export interface TrajectoryObservations {
  readonly observationKind: "trajectory";
  /** Number of commands in the trace (N; the bigram count is N - 1). */
  readonly commandCount: number;
  /** Distinct command kinds / N (vocabulary variety). */
  readonly distinctKindShare: number;
  /** Shannon entropy of the kind distribution, normalized to [0, 1]. */
  readonly kindEntropyShare: number;
  /** Share of the dominant consecutive kind pair (scripted loop shape). */
  readonly dominantBigramShare: number;
  /** Share of commands entering through broker-mediated avatar origins. */
  readonly brokerMediatedShare: number;
  /** Share of commands entering through player-input origins. */
  readonly playerInputShare: number;
  /** Distinct actor ids seen in the trace. */
  readonly distinctActors: number;
}

// ---------------------------------------------------------------------------
// Outcome observations (kind: "outcome-pattern")
// ---------------------------------------------------------------------------

/**
 * The JSON-safe summary of one replay re-execution comparison: whether the
 * recorded event stream re-executed identically, at what explicit coverage,
 * with how many divergent positions. This is outcome evidence about the
 * AUTHORITATIVENESS of the captured session — divergence is deterministically
 * proven by the replay verifier, never guessed.
 */
export interface OutcomeObservations {
  readonly observationKind: "outcome-pattern";
  readonly reexecutionKind: "match" | "divergence" | "inconclusive";
  /** The verifier's own confidence: coverage of the check, in [0, 1]. */
  readonly coverage: number;
  /** Divergent event positions (empty unless divergence). */
  readonly divergentPositions: readonly number[];
  /** Total event positions in the recorded witness (0 when unknown). */
  readonly totalEventCount: number;
}

/** The union of observable evidence payloads. */
export type BehavioralObservations = TimingObservations | TrajectoryObservations | OutcomeObservations;

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationCv(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  if (average === 0) {
    // All-zero series is perfectly regular; CV is undefined, treated as 0.
    return 0;
  }
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(average);
}

/** Share of the modal (most frequent) value; generic over value type. */
function modalShare<T>(values: readonly T[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<T, number>();
  let modal = 0;
  for (const value of values) {
    const next = (counts.get(value) ?? 0) + 1;
    counts.set(value, next);
    if (next > modal) modal = next;
  }
  return modal / values.length;
}

function normalizedEntropy(texts: readonly string[]): number {
  if (texts.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
  if (counts.size <= 1) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / texts.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy / Math.log2(counts.size);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Extractors (pure; input order is the canonical admission order)
// ---------------------------------------------------------------------------

/**
 * Timing statistics of a verified recorded command stream. Issued-at gaps
 * are expected non-decreasing (admission enforces this BEFORE extraction;
 * a non-monotonic trace never reaches here).
 */
export function extractTimingObservations(
  entries: readonly RecordedCommand[],
): TimingObservations {
  const gaps: number[] = [];
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]!;
    const current = entries[index]!;
    gaps.push(current.envelope.issuedAt - previous.envelope.issuedAt);
  }
  const perTick = new Map<number, number>();
  for (const entry of entries) {
    perTick.set(entry.dueTick, (perTick.get(entry.dueTick) ?? 0) + 1);
  }
  const tickCounts = [...perTick.keys()]
    .sort((a, b) => a - b)
    .map((tick) => perTick.get(tick) ?? 0);
  return {
    observationKind: "timing",
    commandCount: entries.length,
    gapCount: gaps.length,
    meanGapMs: round(mean(gaps)),
    gapCv: round(populationCv(gaps)),
    modalGapShare: round(modalShare(gaps)),
    tickPressureCv: round(populationCv(tickCounts)),
    maxCommandsPerTick: tickCounts.length === 0 ? 0 : Math.max(...tickCounts),
  };
}

/**
 * Trajectory statistics of a verified recorded command stream: the shape
 * of the subject's path through command space (vocabulary variety,
 * repetition structure, provenance composition).
 */
export function extractTrajectoryObservations(
  entries: readonly RecordedCommand[],
): TrajectoryObservations {
  const kinds = entries.map((entry) => String(entry.envelope.kind));
  const bigrams: string[] = [];
  for (let index = 1; index < kinds.length; index += 1) {
    bigrams.push(`${kinds[index - 1]!}>${kinds[index]!}`);
  }
  const origins = entries.map((entry) => entry.envelope.origin);
  const actors = new Set(entries.map((entry) => String(entry.envelope.actor.actorId)));
  return {
    observationKind: "trajectory",
    commandCount: entries.length,
    distinctKindShare: round(new Set(kinds).size / Math.max(1, kinds.length)),
    kindEntropyShare: round(normalizedEntropy(kinds)),
    dominantBigramShare: round(modalShare(bigrams)),
    brokerMediatedShare: round(shareOfOrigin(origins, "broker-mediated")),
    playerInputShare: round(shareOfOrigin(origins, "player-input")),
    distinctActors: actors.size,
  };
}

function shareOfOrigin(origins: readonly CommandOrigin[], kind: CommandOrigin["kind"]): number {
  if (origins.length === 0) return 0;
  const matches = origins.filter((origin) => origin.kind === kind).length;
  return matches / origins.length;
}

/**
 * Outcome summary of one replay re-execution comparison verdict. The
 * verdict's own confidence (coverage) is preserved verbatim — the
 * observations never state more than the verifier actually checked.
 */
export function extractOutcomeObservations(verdict: IntegrityVerdict): OutcomeObservations {
  switch (verdict.kind) {
    case "match":
      return {
        observationKind: "outcome-pattern",
        reexecutionKind: "match",
        coverage: round(verdict.confidence),
        divergentPositions: [],
        totalEventCount: verdict.totalEventCount,
      };
    case "divergence":
      return {
        observationKind: "outcome-pattern",
        reexecutionKind: "divergence",
        coverage: round(verdict.confidence),
        divergentPositions: verdict.divergences.map((item) => item.seq).sort(
          (a, b) => a - b,
        ),
        totalEventCount: verdict.totalEventCount,
      };
    case "inconclusive":
      return {
        observationKind: "outcome-pattern",
        reexecutionKind: "inconclusive",
        coverage: round(verdict.confidence),
        divergentPositions: [],
        totalEventCount: 0,
      };
  }
}

/** Returns true when `value` is structurally an observation payload. */
export function isBehavioralObservations(value: unknown): value is BehavioralObservations {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.observationKind === "timing" ||
    candidate.observationKind === "trajectory" ||
    candidate.observationKind === "outcome-pattern"
  );
}
