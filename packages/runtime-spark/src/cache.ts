/**
 * SPARK CACHE ADMISSION (R6 "aggressive caching"; R15).
 *
 * The cache admission model is content-addressed and digest-pinned:
 *
 * - a unit may be cached only when its recorded content digest matches
 *   the manifest rule (tampered content is refused, never repaired);
 * - the game-ir world `StreamingPolicy` is the authority for WHAT may
 *   be cached (R15 "chunks may be cached when the contract permits"):
 *   a unit under a world whose policy says `cacheable: false` must
 *   RE-VALIDATE on every use — caching it anyway is a typed
 *   `cache-rule-violation` refusal (E8);
 * - spark's aggressive default: worlds without an explicit streaming
 *   policy are cached (the profile's `caching: "aggressive"`, R6);
 * - an optional caller-supplied byte budget refuses writes that would
 *   overflow the cache (`cache-budget-exceeded`).
 *
 * Pure module: no IO, no clocks, no globals.
 */

import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { SparkBootPlan } from "./boot-plan.ts";
import type { SparkContentUnit } from "./content.ts";

/** Whether one unit's content may be admitted to the cache. */
export type SparkCacheAdmissionKind = "cache-eligible" | "must-revalidate";

/** One manifest rule: unit id + pinned digest + admission verdict. */
export interface SparkCacheRule {
  readonly unitId: string;
  readonly contentDigest: ContentDigest;
  readonly admission: SparkCacheAdmissionKind;
}

/** The typed aggressive-caching manifest over a whole boot plan. */
export interface SparkCacheManifest {
  /** Discriminator: a manifest (never a refusal). */
  readonly ok: true;
  readonly kind: "spark-cache-manifest";
  readonly rules: readonly SparkCacheRule[];
  readonly cacheableBytes: number;
  readonly manifestDigest: ContentDigest;
}

/** Typed cache-admission refusal codes (kebab-case, E8). */
export type SparkCacheRefusalCode =
  | "cache/unknown-unit"
  | "cache/content-digest-mismatch"
  | "cache-rule-violation"
  | "cache-budget-exceeded";

/** A typed cache admission refusal. */
export interface SparkCacheRefusal {
  readonly ok: false;
  readonly code: SparkCacheRefusalCode;
  readonly message: string;
}

function ruleOf(unit: SparkContentUnit): SparkCacheRule {
  return {
    unitId: unit.unitId,
    contentDigest: unit.contentDigest,
    admission: unit.cacheable ? "cache-eligible" : "must-revalidate",
  };
}

/**
 * Derives the cache manifest from a boot plan (critical + deferred units;
 * one rule per unit, digest-pinned). Deterministic (E9).
 */
export function buildSparkCacheManifest(plan: SparkBootPlan): SparkCacheManifest | SparkCacheRefusal {
  if (!Array.isArray(plan?.criticalUnits) || !Array.isArray(plan?.deferredUnits)) {
    return { ok: false, code: "cache/unknown-unit", message: "plan carries no content units" };
  }
  const rules = [...plan.criticalUnits, ...plan.deferredUnits].map(ruleOf);
  const cacheableBytes = [...plan.criticalUnits, ...plan.deferredUnits]
    .filter((unit) => unit.cacheable)
    .reduce((sum, unit) => sum + unit.bytes, 0);
  const manifest: Omit<SparkCacheManifest, "manifestDigest" | "ok"> = {
    kind: "spark-cache-manifest",
    rules,
    cacheableBytes,
  };
  return { ok: true, ...manifest, manifestDigest: computeDigest(manifest) };
}

/** A candidate cache entry (content-addressed by digest). */
export interface SparkCacheCandidate {
  readonly unitId: string;
  readonly contentDigest: ContentDigest;
  readonly bytes: number;
}

/** What a successful admission says. */
export interface SparkCacheAdmission {
  readonly ok: true;
  readonly rule: SparkCacheRule;
  /** Hit: serve the pinned bytes back. Miss: store-then-serve. */
  readonly action: "serve-from-cache" | "store-then-serve";
}

/**
 * THE cache admission oracle (pure). Check order is fixed and fail-closed:
 * rule lookup → digest pin (content tamper) → streaming-policy verdict
 * (cache-rule violation) → byte budget. Never mutates, never guesses.
 */
export function admitSparkCacheEntry(
  manifest: SparkCacheManifest,
  candidate: SparkCacheCandidate,
  options: {
    readonly cacheBudgetBytes?: number;
    readonly currentlyCachedBytes?: number;
    readonly presentInCache?: boolean;
  } = {},
): SparkCacheAdmission | SparkCacheRefusal {
  const rule = manifest?.rules?.find((entry) => entry.unitId === candidate?.unitId);
  if (rule === undefined) {
    return { ok: false, code: "cache/unknown-unit", message: `no cache rule for unit ${String(candidate?.unitId)}` };
  }
  if (rule.contentDigest !== candidate.contentDigest) {
    return {
      ok: false,
      code: "cache/content-digest-mismatch",
      message: `unit ${candidate.unitId} content digest does not match the pinned manifest rule (content tamper)`,
    };
  }
  if (rule.admission === "must-revalidate") {
    return {
      ok: false,
      code: "cache-rule-violation",
      message: `unit ${candidate.unitId} must re-validate every use (world streaming policy cacheable: false); caching it is refused`,
    };
  }
  if (options.cacheBudgetBytes !== undefined) {
    const current = options.currentlyCachedBytes ?? 0;
    if (current + candidate.bytes > options.cacheBudgetBytes) {
      return {
        ok: false,
        code: "cache-budget-exceeded",
        message: `caching unit ${candidate.unitId} (${String(candidate.bytes)} bytes) would exceed the cache budget ${String(options.cacheBudgetBytes)} bytes`,
      };
    }
  }
  return { ok: true, rule, action: options.presentInCache === true ? "serve-from-cache" : "store-then-serve" };
}

/** Recomputes a manifest's digest (tamper evidence, E8/E10). */
export function sparkCacheManifestDigestOf(manifest: SparkCacheManifest): ContentDigest {
  return computeDigest({
    kind: manifest.kind,
    rules: manifest.rules,
    cacheableBytes: manifest.cacheableBytes,
  });
}
