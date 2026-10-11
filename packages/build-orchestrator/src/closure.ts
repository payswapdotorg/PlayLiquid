/**
 * Package-closure adjudication (resolve stage) — the R19 build gate.
 *
 * One authority per concern: closure RESOLUTION is package-system's
 * `resolve` reached through the registry seam (never re-implemented here),
 * and the provenance/licensing GATE is build-contracts'
 * `checkBuildProvenanceGate` — itself an aggregation of package-system's
 * release gate. This module composes them fail-closed:
 *
 *   load pinned lock → resolve closure → R19 gate over EVERY locked record.
 *
 * A closure containing unauthorized or unprovenanced inputs is a TYPED
 * refusal (`provenance-gate-failed` with per-package reasons) — the build
 * never proceeds silently (R19: provenance/licensing is a release/build
 * gate). Tampered digests, missing packages, cycles and unpinned
 * dependencies surface as package-system's own typed resolution codes.
 */

import { computeLockFingerprint } from "@playliquid/package-system";
import type { ContentDigest, PackageLock, PackageRecord, ProvenanceRecord, ModelProvenanceEntry } from "@playliquid/package-system";
import { computeDigest } from "@playliquid/package-system";
import type { Resolution } from "@playliquid/package-system";
import { checkBuildProvenanceGate } from "@playliquid/build-contracts";
import type { BuildProvenanceGateResult } from "@playliquid/build-contracts";
import type { BuildSourcePort } from "./ports.ts";

/** The adjudicated package closure of one build (resolve-stage outcome). */
export interface BuildClosure {
  /** The lock as loaded through the source seam. */
  readonly lock: PackageLock;
  /** Recomputed fingerprint — MUST equal the pinned input (integrity). */
  readonly lockFingerprint: ContentDigest;
  /** package-system's deterministic resolution (records + graph). */
  readonly resolution: Resolution;
  /** The R19 gate verdict over every locked record (pass required). */
  readonly provenanceGate: BuildProvenanceGateResult;
  /** Digest of the closure record (manifest step material, E9). */
  readonly closureDigest: ContentDigest;
}

/** Why closure adjudication refused. Typed; first failure wins. */
export type ClosureRefusalCode =
  | "lock-unavailable"
  | "lock-fingerprint-mismatch"
  | "resolution-failed"
  | "provenance-gate-failed";

/** The typed refusal of closure adjudication. */
export interface ClosureRefusal {
  readonly ok: false;
  readonly code: ClosureRefusalCode;
  readonly message: string;
  /** package-system's resolution code, when the refusal is a resolution failure. */
  readonly resolutionCode?: string;
  /** Per-package R19 gate reasons, when the refusal is the provenance gate. */
  readonly provenanceReasons?: BuildProvenanceGateResult["reasons"];
}

/** The result of closure adjudication. */
export type ClosureAdmission =
  | { readonly ok: true; readonly closure: BuildClosure }
  | ClosureRefusal;

/** The records of a resolved closure, in resolution order. */
export function closureRecords(closure: BuildClosure): readonly PackageRecord[] {
  return closure.resolution.packages.map((entry) => entry.record);
}

/** The provenance records retained from every locked package (R19 evidence). */
export function closureProvenance(closure: BuildClosure): readonly ProvenanceRecord[] {
  return closureRecords(closure).map((record) => record.metadata.provenance);
}

/** AI-participation aggregation across the closure (R19 model provenance). */
export function closureModelProvenance(closure: BuildClosure): {
  readonly entries: readonly ModelProvenanceEntry[];
  readonly generatedByAi: boolean;
} {
  const entries: ModelProvenanceEntry[] = [];
  let generatedByAi = false;
  for (const record of closureRecords(closure)) {
    const provenance = record.metadata.provenance;
    entries.push(...provenance.modelProvenance);
    if (provenance.generatedByAi) {
      generatedByAi = true;
    }
  }
  return { entries, generatedByAi };
}

/**
 * Adjudicates the package closure of one admitted build (pure composition
 * over the source seam). Fail-closed check order: lock availability →
 * lock fingerprint integrity → deterministic resolution → R19 gate.
 */
export function adjudicateClosure(
  source: BuildSourcePort,
  lockFingerprint: ContentDigest,
): ClosureAdmission {
  const lock = source.loadLock(lockFingerprint);
  if (lock === null) {
    return {
      ok: false,
      code: "lock-unavailable",
      message: `the pinned package lock ${lockFingerprint} is no longer resolvable through the build source`,
    };
  }
  const recomputed = computeLockFingerprint(lock);
  if (recomputed !== lockFingerprint) {
    return {
      ok: false,
      code: "lock-fingerprint-mismatch",
      message: `lock content hashes to ${recomputed} but the build pins ${lockFingerprint} (tamper check, E8)`,
    };
  }
  const resolution = source.resolveClosure(lock);
  if (!resolution.ok) {
    return {
      ok: false,
      code: "resolution-failed",
      message: `package closure resolution failed: ${resolution.message}`,
      resolutionCode: resolution.code,
    };
  }
  const records = resolution.packages.map((entry) => entry.record);
  const provenanceGate = checkBuildProvenanceGate(records);
  if (!provenanceGate.pass) {
    return {
      ok: false,
      code: "provenance-gate-failed",
      message: `closure contains ${provenanceGate.reasons.length} provenance/licensing gate violation(s) (R19 fail-closed)`,
      provenanceReasons: provenanceGate.reasons,
    };
  }
  const closureDigest = computeDigest({
    lockFingerprint,
    packages: resolution.packages.map((entry) => ({
      id: entry.pin.id,
      version: entry.pin.version,
      contentDigest: entry.pin.contentDigest,
    })),
    topologicalOrder: resolution.topologicalOrder,
  });
  return {
    ok: true,
    closure: { lock, lockFingerprint, resolution, provenanceGate, closureDigest },
  };
}
