/**
 * THE REWARD INTEGRITY PORT — the competitive-integrity seam (PL-017 for
 * PL-018, not yet merged).
 *
 * spec/module-dependency-matrix.md design intent row
 * `economy | Platform | platform-contracts, integrity` names integrity as
 * an economy dependency; the integrity package (PL-018) does not exist
 * yet. Per the work order this dependency is therefore a PORT, defined
 * here as a pure interface the host wires later — NOT a second integrity
 * authority and NOT a dependency on a nonexistent package.
 *
 * Semantics (architecture "Competitive Integrity", R11 / lock rules):
 * - A reading is EVIDENCE/CONFIDENCE only — it carries no verdict, no
 *   enforcement decision, no certainty claim. The words `verdict`,
 *   `certain`, `cheater` and friends are deliberately unrepresentable.
 * - The economy service consults the port BEFORE settlement and lets a
 *   port-supplied confidence OVERRIDE the request-carried one: the
 *   platform owns validation (R10); a game's self-declared confidence is
 *   never the last word once authoritative evidence exists.
 * - `undefined` means "no integrity evidence available" (the host has not
 *   wired PL-018, or no report covers the query). In that case the
 *   request-carried report-time confidence stands — a truthful default,
 *   never a fabricated one (E11).
 *
 * Purity: interfaces + one structural guard. The port performs no IO in
 * this package; real adapters (reading the platform integrity service)
 * are host concerns.
 */

import type {
  ContentDigest,
  GameEventKind,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Query + reading shapes
// ---------------------------------------------------------------------------

/**
 * What the economy authority asks the integrity seam: one subject's
 * integrity standing for one declared event occurrence backed by one
 * authoritative outcome.
 */
export interface RewardIntegrityQuery {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly eventKind: GameEventKind;
  readonly sourceEventDigest: ContentDigest;
  readonly outcomeEvidence: ContentDigest;
}

/**
 * One integrity reading: a confidence in [0, 1] plus an optional
 * content-addressed audit reference to the report the reading came from.
 * Evidence/confidence only — never a verdict (R11).
 */
export interface RewardIntegrityReading {
  readonly confidence: number;
  readonly evidenceDigest?: ContentDigest;
}

/** Returns true when `value` is a structurally valid {@link RewardIntegrityReading}. */
export function isRewardIntegrityReading(value: unknown): value is RewardIntegrityReading {
  if (typeof value !== "object" || value === null) return false;
  const reading = value as Record<string, unknown>;
  if (typeof reading.confidence !== "number" || !Number.isFinite(reading.confidence)) return false;
  if (reading.confidence < 0 || reading.confidence > 1) return false;
  if (reading.evidenceDigest !== undefined) {
    return typeof reading.evidenceDigest === "string" && /^[0-9a-f]{64}$/.test(reading.evidenceDigest);
  }
  return true;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * THE integrity-evidence seam consulted before settlement. The host wires
 * the real adapter when PL-018 merges; tests and the harness wire
 * deterministic fakes (fakes.ts). Returning `undefined` is a legitimate,
 * typed outcome: "no evidence for this query".
 */
export interface RewardIntegrityPort {
  readonly confidenceFor: (query: RewardIntegrityQuery) => RewardIntegrityReading | undefined;
}
