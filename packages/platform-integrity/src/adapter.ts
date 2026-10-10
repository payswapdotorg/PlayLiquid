/**
 * THE REWARD INTEGRITY ADAPTER — the economy settlement seam (PL-018 for
 * PL-017; the seam platform-economy defined as its RewardIntegrityPort).
 *
 * packages/platform-economy/src/integrity-port.ts (PL-017) declared the
 * competitive-integrity dependency of the economy module as a PORT — a
 * pure interface the HOST wires when PL-018 merges. This module is that
 * wiring target: `createRewardIntegrityAdapter` produces an object
 * STRUCTURALLY IDENTICAL to the economy port (same `confidenceFor`
 * field, same query/reading shapes — the branded types all come from
 * @playliquid/platform-contracts, so structural typing holds at the host
 * composition site). The integrity package deliberately does NOT import
 * platform-economy: the dependency direction is economy → integrity
 * seam, wired by the host, never a back-import.
 *
 * Honesty rules (E11 / R11 — the reading carries evidence/confidence
 * only, never a verdict):
 * - `undefined` when the subject has no recorded verdict: the truthful
 *   "no integrity evidence available" — the request-carried confidence
 *   stands (the port's documented default).
 * - `undefined` when the latest verdict's confidence band is `wide`: a
 *   wide-band verdict cannot honestly be summarized as one scalar —
 *   withholding the override is the honest choice, never a fabricated
 *   point estimate.
 * - Otherwise the reading is the risk complement (1 − riskScore) of the
 *   latest recorded verdict, with `evidenceDigest` pinning the full
 *   verdict record (the interval, the band and every citation stay
 *   auditable through the pinned content).
 *
 * Purity: no IO — the adapter is a closure over the service and the
 * reading subject's grant context.
 */

import type {
  ContentDigest,
  GameEventKind,
  SubjectId,
  TenantId,
} from "@playliquid/platform-contracts";
import type { IntegrityService } from "./service.ts";
import { digestOf } from "./digest.ts";

/**
 * What the economy authority asks the integrity seam. Structurally
 * identical to platform-economy's RewardIntegrityQuery (same field
 * names, same branded types from platform-contracts).
 */
export interface RewardIntegrityQueryLike {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
  readonly eventKind: GameEventKind;
  readonly sourceEventDigest: ContentDigest;
  readonly outcomeEvidence: ContentDigest;
}

/**
 * One integrity reading: confidence in [0, 1] plus the content-addressed
 * audit reference to the verdict the reading came from. Structurally
 * identical to platform-economy's RewardIntegrityReading.
 */
export interface RewardIntegrityReadingLike {
  readonly confidence: number;
  readonly evidenceDigest?: ContentDigest;
}

/** Construction inputs: the service to read and the reading subject. */
export interface RewardIntegrityAdapterOptions {
  readonly service: IntegrityService;
  /** The subject exercising its `read` grant (least privilege, R20). */
  readonly reader: SubjectId;
}

/** The port-shaped adapter handle. */
export interface RewardIntegrityAdapter {
  readonly confidenceFor: (query: RewardIntegrityQueryLike) => RewardIntegrityReadingLike | undefined;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Creates the host-wiring adapter. The subject-level lookup is
 * deliberate and documented: verdicts are tenant+subject scoped; the
 * query's event-kind and digests are the economy side's own audit
 * material and are preserved in the pinned verdict's citations, not
 * re-correlated here (event-scoped standing is a future refinement of
 * the seam, recorded in the package limitations).
 */
export function createRewardIntegrityAdapter(
  options: RewardIntegrityAdapterOptions,
): RewardIntegrityAdapter {
  const { service, reader } = options;
  return {
    confidenceFor(query: RewardIntegrityQueryLike): RewardIntegrityReadingLike | undefined {
      const standing = service.standingFor(reader, query.tenant, query.subject);
      if (!standing.ok) return undefined;
      const verdict = standing.verdict;
      if (verdict.band === "wide") return undefined;
      return {
        confidence: round6(1 - verdict.risk.riskScore),
        evidenceDigest: digestOf(verdict),
      };
    },
  };
}
