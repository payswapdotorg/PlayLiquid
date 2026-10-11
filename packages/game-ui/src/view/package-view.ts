/**
 * PACKAGE READ MODELS (pure): project package-system authoritative records
 * — PackageRecord identity/metadata (PL-011) plus the provenance/licensing
 * release gate verdict (R19) and lockfile pins — into typed view models for
 * the studio's Packages surface. The UI never re-derives gate verdicts or
 * sorts by raw strings; this module is the single projection owner (E5).
 *
 * Pure module: no IO, no React, no clock.
 */

import type {
  PackageRecord,
  ReleaseGateResult,
} from "@playliquid/package-system";
import { canonicalPins, formatSemver } from "@playliquid/package-system";
import type { PackageLock } from "@playliquid/package-system";
import type { Digest } from "@playliquid/runtime-contracts";
import { licenseStatus, releaseGateStatus } from "./status.ts";

/** One dependency row of the package inspector. */
export interface PackageDependencyRow {
  readonly id: string;
  readonly constraint: string;
  readonly optional: boolean;
  readonly kind: string | null;
}

/** One pinned coordinate of the owning lockfile. */
export interface LockPinRow {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

/** The Packages inspector view model for one package record. */
export interface PackageCardView {
  readonly id: string;
  readonly kind: string;
  readonly version: string;
  readonly contentDigest: string;
  readonly spdx: string;
  readonly license: ReturnType<typeof licenseStatus>;
  readonly gate: ReturnType<typeof releaseGateStatus>;
  readonly gateReasons: readonly { readonly code: string; readonly message: string }[];
  readonly dependencies: readonly PackageDependencyRow[];
  readonly artifactCount: number;
  readonly runtimes: readonly string[];
  readonly engines: readonly string[];
  readonly targets: readonly string[];
  readonly parentLineage: boolean;
}

/** The Packages surface: one card per record + the lock pins summary. */
export interface PackagesView {
  readonly cards: readonly PackageCardView[];
  readonly lockPins: readonly LockPinRow[];
  readonly blockedCount: number;
}

function shortDigest(digest: string): string {
  // Package-system stores digests WITH the algorithm prefix ("sha256:<hex>");
  // strip it before slicing so the short form never renders doubled.
  const bare = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return `sha256:${bare.slice(0, 12)}`;
}

function pinRows(lock: PackageLock | undefined): readonly LockPinRow[] {
  if (lock === undefined) return [];
  return canonicalPins(lock).map((pin) => ({
    id: pin.id,
    version: formatSemver(pin.version),
    digest: shortDigest(pin.contentDigest),
  }));
}

/**
 * Project package records + gate verdicts + (optional) the owning lockfile
 * into the Packages view. `gateResults` is keyed by package id; a missing
 * entry renders as an unknown gate (fail-closed presentation: blocked).
 */
export function projectPackages(
  records: readonly PackageRecord[],
  gateResults: Readonly<Record<string, ReleaseGateResult>>,
  lock?: PackageLock,
): PackagesView {
  const cards = records.map((record) => {
    const identity = record.identity;
    const metadata = record.metadata;
    const gate = gateResults[identity.id];
    const gateView = releaseGateStatus(gate?.pass ?? false);
    return {
      id: identity.id,
      kind: identity.kind,
      version: formatSemver(identity.version),
      contentDigest: shortDigest(identity.contentDigest),
      spdx: metadata.license.spdxExpression,
      license: licenseStatus(metadata.license.status),
      gate: gateView,
      gateReasons: (gate?.reasons ?? []).map((reason) => ({
        code: reason.code,
        message: reason.message,
      })),
      dependencies: metadata.dependencies.map((dependency) => ({
        id: dependency.id,
        constraint: dependency.constraint,
        optional: dependency.optional,
        kind: dependency.kind,
      })),
      artifactCount: metadata.artifacts.length,
      runtimes: [...metadata.compatibility.runtimes].sort(),
      engines: [...metadata.compatibility.engines].sort(),
      targets: metadata.compatibility.targets.map((target) => String(target)),
      parentLineage: metadata.lineage.parent !== null,
    } satisfies PackageCardView;
  });
  const sorted = [...cards].sort((a, b) => a.id.localeCompare(b.id));
  return {
    cards: sorted,
    lockPins: pinRows(lock),
    blockedCount: sorted.filter((card) => card.gate.tone === "error").length,
  } satisfies PackagesView;
}

/** Deterministic summary line for headers ("N packages · M blocked"). */
export function packagesSummary(view: PackagesView): string {
  const total = view.cards.length;
  const blocked = view.blockedCount;
  const pins = view.lockPins.length;
  return `${total} package${total === 1 ? "" : "s"} · ${blocked} gate-blocked · ${pins} lock pin${pins === 1 ? "" : "s"}`;
}

/** Type re-export so components/tests can name the digest brand. */
export type { Digest };
