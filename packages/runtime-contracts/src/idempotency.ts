/**
 * IDEMPOTENCY AND STALE-RESULT SEMANTIC CONTRACTS.
 *
 * Async/stateful documentation (worker-contract "Async/stateful work"), the
 * portions owned by this module:
 *
 * - Idempotency key: a triple { scope, actor, nonce } — see
 *   {@link IdempotencyKey}. Two requests carrying the SAME key are the same
 *   request IF AND ONLY IF their payload fingerprints match
 *   ({@link classifyEncounter}). Equal keys with DIFFERENT fingerprints are
 *   a COLLISION: the request is refused, never silently executed as a
 *   second behavior (E8 anti-gaming).
 * - Stale-result rule: results (command receipts, action resolutions, job
 *   results) carry the session EPOCH they were produced under. Once the
 *   authoritative runtime advances the epoch (reset/restore), any result
 *   from an older epoch is STALE: it must be discarded by consumers, and
 *   `applyStaleResultRule` is the pure oracle for that decision.
 * - Mutable state owner: the AUTHORITATIVE RUNTIME owns the idempotency
 *   table (key -> first receipt) and the session epoch. Everything here is
 *   a pure function over caller-supplied read models.
 * - Retry semantics: retries re-submit the SAME idempotency key; the first
 *   receipt is returned for duplicates. No key rotation on retry.
 */

import type {
  ActorId,
  IdempotencyNonce,
  SessionEpoch,
} from "./primitives.ts";

/** Where an idempotency key applies. */
export type IdempotencyScope =
  | "command"
  | "action"
  | "job-enqueue"
  | "job-checkpoint";

/**
 * Typed idempotency key. Equality is STRUCTURAL over all three fields
 * ({@link idempotencyKeyEquals}). The nonce is opaque to the platform;
 * actors choose it (e.g. a client-generated UUID) and MUST reuse it across
 * retries of the same logical request.
 */
export interface IdempotencyKey {
  readonly scope: IdempotencyScope;
  readonly actor: ActorId;
  readonly nonce: IdempotencyNonce;
}

/** Structural equality of two idempotency keys. */
export function idempotencyKeyEquals(a: IdempotencyKey, b: IdempotencyKey): boolean {
  return a.scope === b.scope && a.actor === b.actor && a.nonce === b.nonce;
}

/**
 * Opaque fingerprint of a request payload (e.g. a digest string). The
 * platform never interprets it; it only compares fingerprints for equality
 * when the same key is presented twice.
 */
export type PayloadFingerprint = string;

/** Outcome of a repeated key presentation. */
export type EncounterClassification =
  | { readonly classification: "first" }
  | { readonly classification: "duplicate"; readonly firstFingerprint: PayloadFingerprint }
  | {
      readonly classification: "collision";
      readonly firstFingerprint: PayloadFingerprint;
      readonly repeatedFingerprint: PayloadFingerprint;
    };

/**
 * Classify an encounter with an idempotency key against the recorded first
 * encounter. PURE. Rules:
 * - different keys -> "first" (nothing to compare; caller records it);
 * - same key, same fingerprint -> "duplicate": return the first receipt;
 * - same key, different fingerprint -> "collision": REFUSE. The stored
 *   first fingerprint is returned for audit; it is never overwritten.
 */
export function classifyEncounter(
  recorded: { readonly key: IdempotencyKey; readonly fingerprint: PayloadFingerprint },
  presented: { readonly key: IdempotencyKey; readonly fingerprint: PayloadFingerprint },
): EncounterClassification {
  if (!idempotencyKeyEquals(recorded.key, presented.key)) {
    return { classification: "first" };
  }
  if (recorded.fingerprint === presented.fingerprint) {
    return { classification: "duplicate", firstFingerprint: recorded.fingerprint };
  }
  return {
    classification: "collision",
    firstFingerprint: recorded.fingerprint,
    repeatedFingerprint: presented.fingerprint,
  };
}

/**
 * A result tagged with the session epoch it was produced under. Every
 * async result in this protocol carries `epoch` for exactly this rule.
 */
export interface EpochedResult {
  readonly epoch: SessionEpoch;
}

/** Disposition of a result against the current session epoch. */
export type StaleResultDisposition =
  | { readonly stale: false; readonly disposition: "current" }
  | { readonly stale: true; readonly disposition: "superseded" };

/**
 * THE STALE-RESULT RULE (pure oracle). A result produced under epoch E is
 * stale once the session epoch is E' > E (the authoritative runtime bumped
 * the epoch via reset/restore between production and consumption). Stale
 * results are discarded — never applied, never re-ordered, never merged.
 * Results from a FUTURE epoch (E > E') indicate a protocol violation and
 * are treated as stale as well (fail closed).
 */
export function applyStaleResultRule(
  result: EpochedResult,
  currentEpoch: SessionEpoch,
): StaleResultDisposition {
  if (result.epoch === currentEpoch) {
    return { stale: false, disposition: "current" };
  }
  return { stale: true, disposition: "superseded" };
}

/**
 * Convenience: fold the stale-result rule over a batch. Pure. Returns only
 * the current (non-stale) results, preserving order.
 */
export function retainCurrentResults<T extends EpochedResult>(
  results: readonly T[],
  currentEpoch: SessionEpoch,
): readonly T[] {
  return results.filter((r) => !applyStaleResultRule(r, currentEpoch).stale);
}
