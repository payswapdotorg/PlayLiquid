/**
 * COMPOSITION READ MODELS (pure): the package composition of the OPEN
 * project — one row per pinned package coordinate (kind, id, semantic
 * version and content digest — the exact pin), with the pinned package's
 * release-gate verdict (package-system's R19 fail-closed
 * provenance/licensing gate) and its failure summary when blocked.
 *
 * The projection renders what the authoritative read model carries; it
 * never re-runs the gate (the registry's read doors own the verdict) and
 * never fabricates pins. Absence is honest: no open project (or a
 * project that pins nothing) projects the typed empty view (E11).
 *
 * Pure module: no IO, no React, no clock.
 */

import { formatSemver } from "../../../../package-system/src/index.ts";
import type { WorldProjectDetail } from "./projects-snapshot.ts";

/** One composition pin row (the exact coordinate + the gate verdict). */
export interface CompositionPinRowView {
  readonly packageId: string;
  readonly kind: string;
  /** The pinned semantic version, formatted "major.minor.patch[-pre…]" (package-system). */
  readonly versionText: string;
  /** Short content digest of the pinned package (display form). */
  readonly digest: string;
  readonly releaseGate: "pass" | "blocked";
  readonly failureSummary: string | null;
}

/** The Composition surface of the open project. */
export interface CompositionView {
  readonly rows: readonly CompositionPinRowView[];
  readonly totalPins: number;
  readonly blockedPins: number;
  readonly passedPins: number;
}

/** Short content digest (keeps the `sha256:` prefix, 12 hex). */
function shortDigest(digest: string): string {
  const bare = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return `sha256:${bare.slice(0, 12)}`;
}

/**
 * Project the open project's detail payload into the Composition view.
 * Rows enumerate in (packageId, version) order — deterministic (E9).
 */
export function projectComposition(detail: WorldProjectDetail | undefined): CompositionView {
  if (detail === undefined) {
    return {
      rows: [],
      totalPins: 0,
      blockedPins: 0,
      passedPins: 0,
    } satisfies CompositionView;
  }
  const rows = [...detail.composition]
    .sort(
      (a, b) =>
        a.coordinate.id.localeCompare(b.coordinate.id) ||
        formatSemver(a.coordinate.version).localeCompare(formatSemver(b.coordinate.version)),
    )
    .map((pin): CompositionPinRowView => ({
      packageId: pin.coordinate.id,
      kind: pin.coordinate.kind,
      versionText: formatSemver(pin.coordinate.version),
      digest: shortDigest(pin.coordinate.contentDigest),
      releaseGate: pin.releaseGate,
      failureSummary: pin.failureSummary,
    }));
  const blocked = rows.filter((row) => row.releaseGate === "blocked");
  return {
    rows,
    totalPins: rows.length,
    blockedPins: blocked.length,
    passedPins: rows.length - blocked.length,
  } satisfies CompositionView;
}

/** Deterministic summary line for the Composition surface. */
export function compositionSummary(view: CompositionView): string {
  if (view.totalPins === 0) return "no package pins";
  return `${view.totalPins} pin${view.totalPins === 1 ? "" : "s"} · ${view.blockedPins} gate-blocked · ${view.passedPins} passing · release gates fail closed (R19)`;
}
