/**
 * Deterministic in-memory fixtures for the build-orchestrator perf suites
 * (PL-042). Everything the suites use comes from the package's PUBLIC
 * entrypoint (../src/index.ts) — the orchestrator service, its fakes and
 * its pure adjudication/planning functions. No deep imports, no sibling
 * packages, no network, no child processes.
 *
 * Digest discipline (E7/E9): every digest below is a REAL sha256 over a
 * local canonical JSON of the content it addresses (the repo's own
 * canonicalization rules: sorted keys, JSON.stringify scalars, preserved
 * array order). Package records are SEALED with the package-system
 * digest rule (sha256 over the record with the contentDigest field
 * removed) so the orchestrator's closure resolution accepts them, and
 * the lock fingerprint follows the lockfile rule (sha256 over the
 * id-sorted pin set). These fixtures therefore resolve, adjudicate and
 * build through the REAL authority paths — nothing is hand-waved.
 *
 * Brand casts: the contracts' nominal id types (ProfileInputId, BuildId,
 * …) are not re-exported through this package's barrel; string literals
 * are cast with `as never` at the boundary (the values are the plain
 * strings the validators check).
 */

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

/** Canonical JSON (sorted keys; the repo's own canonicalization rules). */
export function canonicalJsonOf(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((entry) => serialize(entry)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(",")}}`;
    }
    default:
      throw new Error(`cannot canonicalize ${String(typeof value)}`);
  }
}

/** Content digest: sha256 over the UTF-8 bytes of the canonical form. */
export function digestOf(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJsonOf(value), "utf8").digest("hex")}`;
}

/** The workload shape digest: sha256 hex of the canonical form. */
export function shapeDigestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJsonOf(value), "utf8").digest("hex");
}

/** Wall-clock now in fractional milliseconds. */
export function nowMs(): number {
  return performance.now();
}

/** Mean of a non-empty sample set. */
export function meanOf(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error("mean of empty sample set");
  return samples.reduce((total, value) => total + value, 0) / samples.length;
}

/** Percentile by nearest-rank over sorted samples (p in (0, 100]). */
export function percentileOf(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error("percentile of empty sample set");
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

/** Logs one measured metric line (the suite's observable evidence). */
export function logMetric(metric: string, scale: string, elapsedMs: number, count: number, extra = ""): void {
  const rate = elapsedMs <= 0 ? Number.POSITIVE_INFINITY : (count * 1000) / elapsedMs;
  const detail = extra === "" ? "" : ` ${extra}`;
  console.log(`[perf] ${metric} | ${scale} | ${count.toLocaleString("en-US")} ops | ${elapsedMs.toFixed(1)} ms | ${rate.toLocaleString("en-US", { maximumFractionDigits: 0 })} ops/s${detail}`);
}

/** The pinned semver every fixture record publishes. */
const VERSION = { major: 1, minor: 0, patch: 0, prerelease: [] as readonly string[], build: [] as readonly string[] };

/** The non-console targets of the frozen 11-target taxonomy (R12). */
export const FANOUT_TARGETS: readonly string[] = [
  "web",
  "spark",
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
  "steamdeck",
  "xr",
  "dedicated-server",
] as const;

/** Options of {@link perfPackageRecord}. */
export interface PerfRecordOptions {
  /** `declared` (unverified) fails the R19 provenance gate on purpose. */
  readonly licenseStatus?: "verified" | "declared";
  /** Upward dependencies (id list; all pinned in the same lock). */
  readonly dependsOn?: readonly string[];
}

/** A minimal gate-passing package record, sealed with its REAL content digest. */
export function perfPackageRecord(id: string, options: PerfRecordOptions = {}) {
  const unsealed = {
    identity: { kind: "assets" as const, id, version: VERSION },
    metadata: {
      dependencies: (options.dependsOn ?? []).map((dependencyId) => ({
        id: dependencyId,
        constraint: "^1.0.0",
        kind: "assets" as const,
        optional: false,
      })),
      providedCapabilities: [],
      requiredCapabilities: [],
      permissions: [],
      license: { spdxExpression: "Apache-2.0", status: options.licenseStatus ?? "verified" },
      provenance: {
        origin: { type: "original" as const },
        sourceCommit: "0123456789abcdef0123456789abcdef01234567",
        transformationHistory: [{ kind: "author" as const, description: "authored for perf fixtures" }],
        modelProvenance: [],
        generatedByAi: false,
      },
      lineage: { origin: null, parent: null },
      compatibility: { runtimes: ["interactive"], engines: ["native"], targets: [] },
      resources: {},
      evaluationSuites: [],
      artifacts: [],
      extensionPoints: [],
      overlay: null,
    },
  };
  // The package-system seal rule: digest over the record minus contentDigest.
  const contentDigest = digestOf({
    identity: { kind: unsealed.identity.kind, id: unsealed.identity.id, version: unsealed.identity.version },
    metadata: unsealed.metadata,
  });
  return { ...unsealed, identity: { ...unsealed.identity, contentDigest } };
}

/** A lock pinning exactly `records` (pins sorted by id, like the authority). */
export function perfLock(records: readonly ReturnType<typeof perfPackageRecord>[]) {
  return {
    lockVersion: 1 as const,
    packages: [...records]
      .sort((a, b) => (a.identity.id < b.identity.id ? -1 : a.identity.id > b.identity.id ? 1 : 0))
      .map((record) => ({
        kind: record.identity.kind,
        id: record.identity.id,
        version: record.identity.version,
        contentDigest: record.identity.contentDigest,
        resolvedFrom: "perf-fixture-registry",
      })),
    hostCapabilities: [],
  };
}

/** The lockfile fingerprint rule: digest over the id-sorted pin set. */
export function perfLockFingerprint(lock: ReturnType<typeof perfLock>): string {
  return digestOf({
    lockVersion: lock.lockVersion,
    packages: lock.packages.map((pin) => ({
      kind: pin.kind,
      id: pin.id,
      version: pin.version,
      contentDigest: pin.contentDigest,
    })),
    hostCapabilities: [],
  });
}

/** Options of {@link perfBuildInputs}. */
export interface PerfInputsOptions {
  /** The frozen-taxonomy target this profile builds for. */
  readonly target: string;
  /** Distinct content per fan-out slot (deterministic digests). */
  readonly slot: number;
}

/** Structurally valid build inputs for one fan-out slot (web-class, no vendor gate). */
export function perfBuildInputs(lock: ReturnType<typeof perfLock>, options: PerfInputsOptions) {
  const slot = options.slot;
  return {
    gameIr: { digest: digestOf({ perf: "game-ir", slot }) },
    packageLock: { lockFingerprint: perfLockFingerprint(lock), pinnedPackageCount: lock.packages.length },
    targetProfile: {
      profileId: `perf-profile-${slot}` as never,
      profileDigest: digestOf({ perf: "target-profile", target: options.target, slot }),
      target: options.target as never,
      vendorGate: { kind: "none" as const },
    },
    engineBinding: {
      engineId: "native" as never,
      bindingDigest: digestOf({ perf: "engine-binding", slot }),
      supportedTargets: [options.target as never],
    },
    toolchain: {
      profileId: "perf-toolchain" as never,
      profileDigest: digestOf({ perf: "toolchain", operations: ["build", "test", "package"] }),
      citesToolOperations: ["build", "test", "package"] as never,
    },
  };
}

/** A well-formed build request over the given inputs (unique nonce). */
export function perfBuildRequest(inputs: ReturnType<typeof perfBuildInputs>, nonce: string) {
  return {
    kind: "request-build" as const,
    idempotency: { scope: "build-request" as const, requester: "perf-builder" as never, nonce: nonce as never },
    inputs,
    parameters: { kind: "record" as const, fields: { slot: { kind: "int" as const, value: 1n } } },
    requestedAt: 1_700_000_000_000,
  };
}

/** The content digests a build source must resolve for `inputs` (plus the lock). */
export function resolvableDigestsOf(inputs: ReturnType<typeof perfBuildInputs>): readonly string[] {
  return [inputs.gameIr.digest, inputs.targetProfile.profileDigest, inputs.engineBinding.bindingDigest, inputs.toolchain.profileDigest];
}
