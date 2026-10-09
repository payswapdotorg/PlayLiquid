/**
 * REPLAY DERIVATIONS (E10 — historical evidence is immutable; derivations
 * append, they never rewrite).
 *
 * A derivation is any artifact DERIVED from a replay record: a highlight
 * clip, a QA diff report, an integrity verdict, a Lab counterfactual
 * summary. Derivations reference their SOURCE record by identity and the
 * derived artifact by content digest; the derivation ledger is append-only
 * — there is deliberately no update or delete operation in the port, and
 * the in-memory fake additionally refuses unknown sources and conflicting
 * rewrites of an existing derivation id.
 *
 * The SOURCE record is never touched by derivation: sealing a derivation
 * reads the source identity only (see fakes.ts for the behavioral test
 * surface).
 *
 * Pure model + an in-memory fake: no IO.
 */

import { createHash } from "node:crypto";
import { canonicalJson, isContentDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { Timestamp } from "@playliquid/runtime-contracts";

/** An append-only derivation of a replay record. */
export interface ReplayDerivation {
  /** `replaydrv-<sha256 of the canonical derivation form>`. */
  readonly derivationId: string;
  /** The source record this derivation was computed from (immutable). */
  readonly sourceReplayId: string;
  /** Free-form derivation kind label (e.g. "integrity-report"). */
  readonly kind: string;
  /** Content digest of the derived artifact's own bytes. */
  readonly artifactDigest: ContentDigest;
  /** Caller-supplied timestamp (injected clock). */
  readonly derivedAt: Timestamp;
  /** Deriving actor description. */
  readonly derivedBy: string;
}

/** The derivation ledger port: append + read, nothing else (E10). */
export interface DerivationLedger {
  append(derivation: ReplayDerivation): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string };
  /** Derivations of one source record, in append order. */
  listBySource(replayId: string): readonly ReplayDerivation[];
}

/** Pure structural validation of a derivation. */
export function validateReplayDerivation(derivation: ReplayDerivation): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string } {
  if (typeof derivation.sourceReplayId !== "string" || derivation.sourceReplayId.length === 0) {
    return { ok: false, code: "source-missing", detail: "derivation must reference its source replay" };
  }
  if (typeof derivation.kind !== "string" || derivation.kind.length === 0) {
    return { ok: false, code: "kind-missing", detail: "derivation kind label missing" };
  }
  if (!isContentDigest(derivation.artifactDigest)) {
    return { ok: false, code: "artifact-digest-malformed", detail: "derived artifact reference must be a content digest" };
  }
  if (typeof derivation.derivedBy !== "string" || derivation.derivedBy.length === 0) {
    return { ok: false, code: "derived-by-missing", detail: "deriving actor missing" };
  }
  return { ok: true };
}

/** Seals a derivation: derives its content-addressed identity and freezes it. */
export function sealReplayDerivation(input: Omit<ReplayDerivation, "derivationId">): ReplayDerivation {
  const candidate: ReplayDerivation = { derivationId: "", ...input };
  const validation = validateReplayDerivation(candidate);
  if (!validation.ok) {
    throw new RangeError(`replay-derivation: ${validation.code}: ${validation.detail}`);
  }
  const form = canonicalJson(input as unknown as Record<string, unknown>);
  const hex = createHash("sha256").update(form, "utf8").digest("hex");
  return Object.freeze({ derivationId: `replaydrv-${hex}`, ...input });
}

/**
 * The in-memory derivation ledger: append-only, order-preserving. Refuses
 * derivations of unknown source records and conflicting rewrites of an
 * existing derivation identity (same id, different content).
 */
export class InMemoryDerivationLedger implements DerivationLedger {
  private readonly derivations = new Map<string, ReplayDerivation>();
  private readonly bySource = new Map<string, string[]>();
  private readonly hasSource: (replayId: string) => boolean;

  constructor(hasSource: (replayId: string) => boolean) {
    this.hasSource = hasSource;
  }

  append(derivation: ReplayDerivation): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string } {
    const validation = validateReplayDerivation(derivation);
    if (!validation.ok) {
      return validation;
    }
    if (!this.hasSource(derivation.sourceReplayId)) {
      return { ok: false, code: "unknown-source", detail: `no replay record ${derivation.sourceReplayId}` };
    }
    const existing = this.derivations.get(derivation.derivationId);
    if (existing !== undefined) {
      if (
        existing.sourceReplayId !== derivation.sourceReplayId ||
        existing.kind !== derivation.kind ||
        existing.artifactDigest !== derivation.artifactDigest ||
        existing.derivedBy !== derivation.derivedBy
      ) {
        return { ok: false, code: "derivation-rewrite", detail: `refusing rewrite of derivation ${derivation.derivationId}` };
      }
      return { ok: true };
    }
    this.derivations.set(derivation.derivationId, derivation);
    const order = this.bySource.get(derivation.sourceReplayId) ?? [];
    order.push(derivation.derivationId);
    this.bySource.set(derivation.sourceReplayId, order);
    return { ok: true };
  }

  listBySource(replayId: string): readonly ReplayDerivation[] {
    const order = this.bySource.get(replayId) ?? [];
    return order.map((id) => this.derivations.get(id)).filter((d): d is ReplayDerivation => d !== undefined);
  }

  /** Number of derivations held. */
  get size(): number {
    return this.derivations.size;
  }
}
