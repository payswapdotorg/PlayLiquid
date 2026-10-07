/**
 * Profile record sealing — content-addressed, immutable records
 * (seal/append discipline, house pattern).
 *
 * The seal is the SHA-256 of a CANONICAL FORM of the record core:
 * - every object key is sorted (recursively) — key insertion order is
 *   never significant (E9, mirroring package-system's lock-fingerprint
 *   discipline);
 * - every declaration list is sorted — list order is never significant;
 * - GameIR values (vendor capability data) canonicalize through game-ir's
 *   `canonicalValueForm` — the kernel's own canonicalization authority;
 * - the spark properties serialize through a fixed-key construction.
 *
 * The digest format (`sha256:<64 hex>`) matches package-system's
 * `ContentDigest` wire format so build inputs pin profile records without
 * conversion. Package-system remains the CAS/artifact authority (E7);
 * this is record-integrity sealing, the game-ir house pattern (node:crypto
 * only, no other IO).
 */

import { createHash } from "node:crypto";
import { canonicalValueForm } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import type { SparkTargetProfile } from "@playliquid/runtime-contracts";
import { asProfileDigest } from "./primitives.ts";
import type { ProfileDigest } from "./primitives.ts";
import type { TargetProfileRecord, UnsealedTargetProfileRecord } from "./records.ts";

/** Deterministic, key-sorted JSON text of a JSON-safe value (order-insensitive for objects). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(",")}`;
}

function sparkForm(spark: SparkTargetProfile): unknown {
  return {
    profileId: spark.profileId,
    formFactor: spark.formFactor,
    orientation: spark.orientation,
    aspectRatio: spark.aspectRatio,
    boot: {
      firstPaintTargetMs: spark.boot.firstPaintTargetMs,
      firstInteractionTargetMs: spark.boot.firstInteractionTargetMs,
      entries: [...spark.boot.entries]
        .map((entry) => ({
          priority: entry.priority,
          assetRef: entry.assetRef,
          byteCeiling: entry.byteCeiling,
          requiredFor: entry.requiredFor,
        }))
        .sort((a, b) => a.priority - b.priority),
    },
    caching: spark.caching,
    streaming: spark.streaming,
    maxConcurrentStreams: spark.maxConcurrentStreams,
    pinnedAt: spark.pinnedAt,
  };
}

function vendorValueForm(value: GameIRValue | undefined): string | null {
  return value === undefined ? null : canonicalValueForm(value);
}

/** The canonical, order-insensitive form of a profile record (seal input). */
export function canonicalProfileForm(record: UnsealedTargetProfileRecord): string {
  const core = record as TargetProfileRecord;
  return stableStringify({
    profileId: core.profileId,
    target: core.target,
    version: core.version,
    formFactor: core.formFactor,
    orientation: core.orientation,
    aspectRatio: core.aspectRatio,
    capabilities: {
      render: core.capabilities.render,
      vramClass: core.capabilities.vramClass,
      inputModalities: [...core.capabilities.inputModalities].sort(),
      screen: {
        touch: core.capabilities.screen.touch,
        refreshHz: core.capabilities.screen.refreshHz ?? null,
      },
    },
    runtimePolicy: {
      runtimes: [...core.runtimePolicy.runtimes].sort(),
      policy: {
        policyId: core.runtimePolicy.policy.policyId,
        revisionDigest: core.runtimePolicy.policy.revisionDigest,
      },
    },
    engineBindings: {
      engines: [...core.engineBindings.engines].sort(),
      pinnedBindings:
        core.engineBindings.pinnedBindings === null
          ? null
          : [...core.engineBindings.pinnedBindings].sort(),
    },
    evaluationSuites: [...core.evaluationSuites]
      .map((suite) => ({ suiteId: suite.suiteId, suiteDigest: suite.suiteDigest }))
      .sort((a, b) => (a.suiteId < b.suiteId ? -1 : a.suiteId > b.suiteId ? 1 : 0)),
    supersedes: core.supersedes,
    spark: core.target === "spark" ? sparkForm(core.spark) : null,
    console:
      core.target === "console"
        ? {
            vendorSdk: {
              vendorId: core.console.vendorSdk.vendorId,
              sdkDigest: core.console.vendorSdk.sdkDigest,
              authorizationDigest: core.console.vendorSdk.authorizationDigest,
            },
            vendorCapabilities: vendorValueForm(core.console.vendorCapabilities),
          }
        : null,
  });
}

/** The sealed digest of an unsealed record's canonical form. */
export function computeProfileDigest(record: UnsealedTargetProfileRecord): ProfileDigest {
  const hex = createHash("sha256").update(canonicalProfileForm(record), "utf8").digest("hex");
  return asProfileDigest(`sha256:${hex}`);
}

/**
 * Seals an unsealed record: computes and attaches the profile digest.
 * Pure — the input is never mutated. Sealed records are immutable;
 * revisions APPEND a new sealed record referencing the old via
 * `supersedes`.
 */
export function sealTargetProfileRecord(record: UnsealedTargetProfileRecord): TargetProfileRecord {
  const digest = computeProfileDigest(record);
  return { ...(record as object), profileDigest: digest } as TargetProfileRecord;
}

/**
 * Verifies a sealed record's declared digest against its content (E8:
 * tampering with any sealed field breaks this). Pure integrity check.
 */
export function verifyTargetProfileDigest(record: TargetProfileRecord): boolean {
  if (typeof record.profileDigest !== "string") {
    return false;
  }
  const { profileDigest: _ignored, ...rest } = record as TargetProfileRecord & {
    profileDigest: string;
  };
  return record.profileDigest === computeProfileDigest(rest as UnsealedTargetProfileRecord);
}
