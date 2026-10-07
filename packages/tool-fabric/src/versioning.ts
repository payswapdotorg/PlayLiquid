/**
 * Module role: the versioned tool-surface contract — the SurfaceVersion
 * every tool descriptor declares, pure parse/format helpers, and the
 * compatibility rules between a consumer-requested surface and a declared
 * surface. Consumers on a different MAJOR surface are never auto-coerced;
 * they receive a typed mismatch.
 *
 * Implements: PL-005 §3.A.4 (versioned surface); the tool-fabric contract
 * layer described in spec/architecture.md.
 */

import { snapshotRecord } from "./inspect.ts";

export interface SurfaceVersion {
  /** Breaking-change counter; different majors are always incompatible. */
  readonly major: number;
  /** Backward-compatible change counter within a major. */
  readonly minor: number;
}

export type SurfaceVersionRejectionCode =
  | "surface-version/not-an-object"
  | "surface-version/major-missing"
  | "surface-version/major-not-an-integer"
  | "surface-version/major-negative"
  | "surface-version/minor-missing"
  | "surface-version/minor-not-an-integer"
  | "surface-version/minor-negative"
  | "surface-version/parse-format";

export interface SurfaceVersionRejection {
  readonly code: SurfaceVersionRejectionCode;
  readonly message: string;
}

export type SurfaceVersionParse =
  | { readonly outcome: "ok"; readonly version: SurfaceVersion }
  | { readonly outcome: "rejected"; readonly rejection: SurfaceVersionRejection };

const SURFACE_VERSION_PATTERN = /^\d+\.\d+$/;

function reject(code: SurfaceVersionRejectionCode, message: string): SurfaceVersionParse {
  const rejection: SurfaceVersionRejection = { code, message };
  return { outcome: "rejected", rejection: Object.freeze(rejection) };
}

/** Validates an untrusted value as a SurfaceVersion. Total; never throws. */
export function validateSurfaceVersion(input: unknown): SurfaceVersionParse {
  const record = snapshotRecord(input);
  if (record === null) {
    return reject("surface-version/not-an-object", "surface version must be a non-array object");
  }
  const major = record["major"];
  if (typeof major !== "number") {
    return reject("surface-version/major-missing", "surface version major must be a number");
  }
  if (!Number.isInteger(major)) {
    return reject("surface-version/major-not-an-integer", "surface version major must be an integer");
  }
  if (major < 0) {
    return reject("surface-version/major-negative", "surface version major must be >= 0");
  }
  const minor = record["minor"];
  if (typeof minor !== "number") {
    return reject("surface-version/minor-missing", "surface version minor must be a number");
  }
  if (!Number.isInteger(minor)) {
    return reject("surface-version/minor-not-an-integer", "surface version minor must be an integer");
  }
  if (minor < 0) {
    return reject("surface-version/minor-negative", "surface version minor must be >= 0");
  }
  const version: SurfaceVersion = { major, minor };
  return { outcome: "ok", version: Object.freeze(version) };
}

/** Formats a surface version as "major.minor". */
export function formatSurfaceVersion(version: SurfaceVersion): string {
  return `${version.major}.${version.minor}`;
}

/** Parses "major.minor" text; typed rejection on bad format. Total; never throws. */
export function parseSurfaceVersion(text: string): SurfaceVersionParse {
  if (typeof text !== "string" || !SURFACE_VERSION_PATTERN.test(text)) {
    return reject("surface-version/parse-format", 'surface version text must look like "major.minor" with non-negative integers');
  }
  const parts = text.split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 0 || minor < 0) {
    return reject("surface-version/parse-format", 'surface version text must look like "major.minor" with non-negative integers');
  }
  const version: SurfaceVersion = { major, minor };
  return { outcome: "ok", version: Object.freeze(version) };
}

export type SurfaceMismatchCode = "surface/major-mismatch" | "surface/minor-too-new";

export interface SurfaceMismatch {
  readonly code: SurfaceMismatchCode;
  readonly requested: SurfaceVersion;
  readonly declared: SurfaceVersion;
  readonly message: string;
}

export type SurfaceCompatibility =
  | { readonly compatible: true; readonly requested: SurfaceVersion; readonly declared: SurfaceVersion }
  | { readonly compatible: false; readonly mismatch: SurfaceMismatch };

/**
 * Surface compatibility rules (binding, no auto-coercion):
 * 1. different major -> incompatible ("surface/major-mismatch"), in either
 *    direction — the fabric never coerces across majors;
 * 2. requested.minor > declared.minor -> incompatible
 *    ("surface/minor-too-new") — the consumer needs a newer minor;
 * 3. otherwise compatible (older requested minors are fine).
 */
export function checkSurfaceCompatibility(
  requested: SurfaceVersion,
  declared: SurfaceVersion,
): SurfaceCompatibility {
  if (requested.major !== declared.major) {
    const mismatch: SurfaceMismatch = {
      code: "surface/major-mismatch",
      requested,
      declared,
      message: `consumer requires surface ${formatSurfaceVersion(requested)} but the tool declares ${formatSurfaceVersion(declared)}; majors differ and are never auto-coerced`,
    };
    return { compatible: false, mismatch: Object.freeze(mismatch) };
  }
  if (requested.minor > declared.minor) {
    const mismatch: SurfaceMismatch = {
      code: "surface/minor-too-new",
      requested,
      declared,
      message: `consumer requires surface minor ${requested.minor} but the tool only declares ${formatSurfaceVersion(declared)}`,
    };
    return { compatible: false, mismatch: Object.freeze(mismatch) };
  }
  return { compatible: true, requested, declared };
}
