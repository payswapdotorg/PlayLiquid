/**
 * Target profile records — the typed record layer per the architecture:
 * "Game = versioned composition of packages + target profile + runtime
 * policy", and lock rule 16: "Spark is a target profile, not a second
 * game model."
 *
 * Structural treatment (the union does the enforcing):
 * - a `spark` record CANNOT be constructed without its spark properties
 *   (the runtime-contracts `SparkTargetProfile` — 9:16, mobile-first,
 *   minimal critical boot, aggressive caching; reused, never redefined);
 * - a `console` record CANNOT be constructed without the
 *   authorized-vendor-SDK marker (R12 "where toolchains permit", lock
 *   rule 24) — an unsigned console record does not exist structurally;
 * - every other target carries the plain core.
 *
 * Records are content-addressed and immutable: `profileDigest` seals the
 * content (digest.ts), and revisions APPEND via `supersedes` — never
 * mutate (seal/append discipline, house pattern).
 *
 * Runtime policy bindings and the profile base (`formFactor`,
 * `orientation`, `aspectRatio`, `profileId`) ride the runtime-contracts
 * vocabulary — the Experience Protocol a target profile binds to (a
 * `LoadOperation` references `targetProfile` by exactly this id).
 */

import { isGameIRValue } from "@playliquid/game-ir";
import type { GameIRValue } from "@playliquid/game-ir";
import type { RuntimePolicyRef, SparkTargetProfile, TargetProfile } from "@playliquid/runtime-contracts";
import { isValidDigest, validateSparkProfile } from "@playliquid/runtime-contracts";
import type { ProfileDigest, VendorId } from "./primitives.ts";
import { isNonEmptyIdText, isProfileDigest, isValidEngineId } from "./primitives.ts";
import type { TargetCapabilities } from "./capabilities.ts";
import { isTargetCapabilities } from "./capabilities.ts";
import type { EngineBindingCompatibility } from "./engine-seam.ts";
import { isEngineBindingCompatibility } from "./engine-seam.ts";
import type { TargetId } from "./taxonomy.ts";
import { isTargetId } from "./taxonomy.ts";

/** The two Experience Protocol runtime implementations (architecture "Runtime"). */
export const RUNTIME_KINDS = Object.freeze(["interactive", "simulation"] as const);

/** A runtime kind. */
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

/** Type guard: a known runtime kind. */
export function isRuntimeKind(value: unknown): value is RuntimeKind {
  return typeof value === "string" && (RUNTIME_KINDS as readonly string[]).includes(value);
}

/** The runtime policy binding: which runtimes the profile serves, under which policy. */
export interface RuntimePolicyBinding {
  /** Non-empty subset of the frozen runtime kinds. */
  readonly runtimes: readonly RuntimeKind[];
  /** The runtime policy declaration (runtime-contracts vocabulary). */
  readonly policy: RuntimePolicyRef;
}

/**
 * A content-addressed reference to a GameIR evaluation suite. The kernel
 * owns suite semantics; this is the minimal structural reference (the
 * same shape family package-system's lockfile seam carries).
 */
export interface EvaluationSuiteRef {
  readonly suiteId: string;
  readonly suiteDigest: ProfileDigest;
}

/** Type guard: a structurally valid evaluation-suite reference. */
export function isEvaluationSuiteRef(value: unknown): value is EvaluationSuiteRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<EvaluationSuiteRef>;
  return isNonEmptyIdText(candidate.suiteId) && isProfileDigest(candidate.suiteDigest);
}

/**
 * The authorized-vendor-SDK marker console records require (R12, lock
 * rule 24). All three fields are structurally required — a marker without
 * the vendor's authorized SDK digest or without an authorization digest
 * cannot exist.
 */
export interface AuthorizedVendorSdkMarker {
  readonly vendorId: VendorId;
  /** Digest of the authorized vendor SDK/toolchain. */
  readonly sdkDigest: ProfileDigest;
  /** Digest of the vendor authorization. */
  readonly authorizationDigest: ProfileDigest;
}

/** Type guard: a structurally valid vendor SDK marker. */
export function isAuthorizedVendorSdkMarker(value: unknown): value is AuthorizedVendorSdkMarker {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AuthorizedVendorSdkMarker>;
  return (
    isNonEmptyIdText(candidate.vendorId) &&
    isProfileDigest(candidate.sdkDigest) &&
    isProfileDigest(candidate.authorizationDigest)
  );
}

/** Console-specific properties. The vendor marker is REQUIRED (structural). */
export interface ConsoleTargetProperties {
  readonly vendorSdk: AuthorizedVendorSdkMarker;
  /**
   * Vendor-specified capability data, carried as an opaque GameIR record
   * value (the kernel value language) — content-addressed into the
   * profile digest, never interpreted by contracts.
   */
  readonly vendorCapabilities?: GameIRValue;
}

/** The core every target profile record carries (extends the runtime-contracts base). */
export interface TargetProfileRecordCore extends TargetProfile {
  readonly target: TargetId;
  /** Revision label of this profile record (opaque; the digest pins it). */
  readonly version: string;
  readonly capabilities: TargetCapabilities;
  readonly runtimePolicy: RuntimePolicyBinding;
  readonly engineBindings: EngineBindingCompatibility;
  readonly evaluationSuites: readonly EvaluationSuiteRef[];
  /** Content digest sealing this record (content-addressed, immutable). */
  readonly profileDigest: ProfileDigest;
  /** The record this revision supersedes (append discipline); `null` for the first. */
  readonly supersedes: ProfileDigest | null;
}

/**
 * A target profile record. The union enforces the architecture locks:
 * spark properties and the console vendor marker are structurally
 * required — they cannot be forgotten, only refused. The spark member
 * also narrows its core delivery fields to the R6 shape (9:16 portrait
 * mobile-first).
 */
export type TargetProfileRecord =
  | (TargetProfileRecordCore & {
      readonly target: "spark";
      readonly formFactor: "mobile-first";
      readonly orientation: "portrait";
      readonly aspectRatio: "9:16";
      readonly spark: SparkTargetProfile;
    })
  | (TargetProfileRecordCore & { readonly target: "console"; readonly console: ConsoleTargetProperties })
  | (TargetProfileRecordCore & { readonly target: Exclude<TargetId, "spark" | "console"> });

/** The spark member of the record union. */
export type SparkTargetProfileRecord = Extract<TargetProfileRecord, { readonly target: "spark" }>;
/** The console member of the record union. */
export type ConsoleTargetProfileRecord = Extract<TargetProfileRecord, { readonly target: "console" }>;
/** The plain (non-spark, non-console) members of the record union. */
export type PlainTargetProfileRecord = Extract<
  TargetProfileRecord,
  { readonly target: Exclude<TargetId, "spark" | "console"> }
>;

/** A record before sealing (no `profileDigest` yet). */
export type UnsealedTargetProfileRecord = DistributiveOmit<TargetProfileRecord, "profileDigest">;

/** Distributive `Omit` (applies per union member). */
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** Stable validation codes for {@link validateTargetProfileRecord}. */
export type TargetProfileErrorCode =
  | "invalid-target"
  | "invalid-version"
  | "invalid-capabilities"
  | "invalid-runtime-policy"
  | "invalid-engine-bindings"
  | "invalid-evaluation-suites"
  | "invalid-digest"
  | "invalid-supersedes"
  | "spark-properties-mismatch"
  | "spark-boot-invalid"
  | "console-vendor-marker-missing"
  | "console-vendor-capabilities-invalid"
  | "xr-form-factor-mismatch"
  | "dedicated-server-not-headless";

/** One validation failure. */
export interface TargetProfileValidationFailure {
  readonly code: TargetProfileErrorCode;
  readonly message: string;
}

/** Result of {@link validateTargetProfileRecord}. Fails closed; aggregates reasons. */
export type TargetProfileValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly TargetProfileValidationFailure[] };

/** Pure structural validation of a target profile record. */
export function validateTargetProfileRecord(record: TargetProfileRecord): TargetProfileValidation {
  const reasons: TargetProfileValidationFailure[] = [];
  if (!isTargetId(record?.target)) {
    reasons.push({ code: "invalid-target", message: "target is not in the frozen taxonomy" });
    return { ok: false, reasons };
  }
  if (!isNonEmptyIdText(record.version)) {
    reasons.push({ code: "invalid-version", message: "version label is empty" });
  }
  if (!isTargetCapabilities(record.capabilities)) {
    reasons.push({ code: "invalid-capabilities", message: "capability descriptor is structurally invalid" });
  }
  const policy = record.runtimePolicy;
  if (
    !Array.isArray(policy?.runtimes) ||
    policy.runtimes.length === 0 ||
    !policy.runtimes.every((kind) => isRuntimeKind(kind)) ||
    !isNonEmptyIdText(policy?.policy?.policyId) ||
    typeof policy?.policy?.revisionDigest !== "string" ||
    !isValidDigest(policy.policy.revisionDigest)
  ) {
    reasons.push({ code: "invalid-runtime-policy", message: "runtime policy binding is structurally invalid" });
  }
  const bindings = record.engineBindings;
  if (
    !isEngineBindingCompatibility(bindings) ||
    !Array.isArray(bindings?.engines) ||
    bindings.engines.length === 0 ||
    !bindings.engines.every((engine) => isValidEngineId(engine))
  ) {
    reasons.push({ code: "invalid-engine-bindings", message: "engine-binding compatibility declaration is invalid or empty" });
  }
  if (
    !Array.isArray(record.evaluationSuites) ||
    !record.evaluationSuites.every((suite) => isEvaluationSuiteRef(suite))
  ) {
    reasons.push({ code: "invalid-evaluation-suites", message: "evaluation-suite references are invalid" });
  }
  if (!isProfileDigest(record.profileDigest)) {
    reasons.push({ code: "invalid-digest", message: "profile digest is not well-formed" });
  }
  if (record.supersedes !== null && (!isProfileDigest(record.supersedes) || record.supersedes === record.profileDigest)) {
    reasons.push({ code: "invalid-supersedes", message: "supersedes must be null or a well-formed digest other than the record's own" });
  }

  if (record.target === "spark") {
    const spark = record.spark;
    if (
      record.formFactor !== "mobile-first" ||
      record.orientation !== "portrait" ||
      record.aspectRatio !== "9:16" ||
      spark.profileId !== record.profileId
    ) {
      reasons.push({
        code: "spark-properties-mismatch",
        message: "spark record must be 9:16 portrait mobile-first with matching spark profile id (R6, lock 16)",
      });
    }
    const boot = validateSparkProfile(spark);
    if (!boot.ok) {
      reasons.push({ code: "spark-boot-invalid", message: `spark boot budget invalid: ${boot.code}` });
    }
  }

  if (record.target === "console") {
    if (!isAuthorizedVendorSdkMarker(record.console?.vendorSdk)) {
      reasons.push({
        code: "console-vendor-marker-missing",
        message: "console record requires the authorized-vendor-SDK marker (R12, lock 24)",
      });
    }
    const vendorCapabilities = record.console?.vendorCapabilities;
    if (vendorCapabilities !== undefined && (!isGameIRValue(vendorCapabilities) || vendorCapabilities.kind !== "record")) {
      reasons.push({
        code: "console-vendor-capabilities-invalid",
        message: "vendor capability data must be a GameIR record value",
      });
    }
  }

  if (record.target === "xr" && record.formFactor !== "xr") {
    reasons.push({ code: "xr-form-factor-mismatch", message: "xr target requires the xr form factor" });
  }
  if (record.target === "dedicated-server") {
    if (record.formFactor !== "headless-server" || record.capabilities.render !== "none") {
      reasons.push({ code: "dedicated-server-not-headless", message: "dedicated-server must be headless with no render API" });
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
