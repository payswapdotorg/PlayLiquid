/**
 * Semantic version contract for PlayLiquid packages.
 *
 * Spec: spec/package-contract.md "Required identity: semantic version".
 *
 * Implements SemVer 2.0.0 parsing and precedence (semver.org §11), plus the
 * minimal dependency-constraint grammar supported by package metadata:
 *
 *   - `"*"`      any version
 *   - `"1.2.3"`  exact version (build metadata significant for equality)
 *   - `"^1.2.3"` caret: changes up to the leftmost non-zero component
 *   - `"~1.2.3"` tilde: patch-level changes
 *
 * All functions are pure and total: parsing failures are reported as `null`
 * or `false`, never by throwing.
 */

/** A parsed SemVer 2.0.0 version. */
export interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
  readonly build: readonly string[]
}

/** A dependency constraint in the v1 grammar documented above. */
export type SemverRange = string

/** Parsed form of a {@link SemverRange}. */
export type SemverRangeAst =
  | { readonly kind: 'any' }
  | { readonly kind: 'exact'; readonly version: SemanticVersion }
  | { readonly kind: 'caret'; readonly base: SemanticVersion }
  | { readonly kind: 'tilde'; readonly base: SemanticVersion }

// Official SemVer 2.0.0 regular expression (semver.org), adapted to named groups.
const SEMVER_PATTERN =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/** Parses a strict SemVer 2.0.0 string. Returns `null` for invalid input. */
export function parseSemver(value: string): SemanticVersion | null {
  const match = SEMVER_PATTERN.exec(value)
  if (match?.groups === undefined) {
    return null
  }
  const groups = match.groups
  const prerelease = groups.prerelease === undefined ? [] : groups.prerelease.split('.')
  const build = groups.build === undefined ? [] : groups.build.split('.')
  return {
    major: Number.parseInt(groups.major ?? '0', 10),
    minor: Number.parseInt(groups.minor ?? '0', 10),
    patch: Number.parseInt(groups.patch ?? '0', 10),
    prerelease,
    build,
  }
}

/** Serializes a parsed version back to its canonical SemVer string. */
export function formatSemver(version: SemanticVersion): string {
  let result = `${version.major}.${version.minor}.${version.patch}`
  if (version.prerelease.length > 0) {
    result += `-${version.prerelease.join('.')}`
  }
  if (version.build.length > 0) {
    result += `+${version.build.join('.')}`
  }
  return result
}

/** Type guard for values that are already parsed versions. */
export function isSemanticVersion(value: unknown): value is SemanticVersion {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<SemanticVersion>
  return (
    typeof candidate.major === 'number' &&
    typeof candidate.minor === 'number' &&
    typeof candidate.patch === 'number' &&
    Array.isArray(candidate.prerelease) &&
    Array.isArray(candidate.build)
  )
}

function isNumericIdentifier(identifier: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(identifier)
}

function comparePrerelease(
  left: readonly string[],
  right: readonly string[],
): -1 | 0 | 1 {
  if (left.length === 0 && right.length === 0) {
    return 0
  }
  // A version without prerelease has higher precedence.
  if (left.length === 0) {
    return 1
  }
  if (right.length === 0) {
    return -1
  }
  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index += 1) {
    const a = left[index] ?? ''
    const b = right[index] ?? ''
    if (a === b) {
      continue
    }
    const aNumeric = isNumericIdentifier(a)
    const bNumeric = isNumericIdentifier(b)
    if (aNumeric && bNumeric) {
      const aNumber = Number.parseInt(a, 10)
      const bNumber = Number.parseInt(b, 10)
      return aNumber < bNumber ? -1 : 1
    }
    if (aNumeric) {
      return -1 // numeric identifiers have lower precedence than alphanumeric
    }
    if (bNumeric) {
      return 1
    }
    return a < b ? -1 : 1
  }
  // All shared identifiers equal: the longer list has higher precedence.
  return left.length < right.length ? -1 : 1
}

/**
 * Compares two versions by SemVer precedence (build metadata is ignored).
 */
export function compareSemver(a: SemanticVersion, b: SemanticVersion): -1 | 0 | 1 {
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1
  }
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

/** Parses a constraint in the v1 grammar. Returns `null` for invalid input. */
export function parseSemverRange(range: SemverRange): SemverRangeAst | null {
  if (range === '*') {
    return { kind: 'any' }
  }
  if (range.startsWith('^')) {
    const base = parseSemver(range.slice(1))
    return base === null ? null : { kind: 'caret', base }
  }
  if (range.startsWith('~')) {
    const base = parseSemver(range.slice(1))
    return base === null ? null : { kind: 'tilde', base }
  }
  const version = parseSemver(range)
  return version === null ? null : { kind: 'exact', version }
}

/** Upper bound (exclusive) of a caret range. */
function caretUpperBound(base: SemanticVersion): SemanticVersion {
  if (base.major > 0) {
    return { major: base.major + 1, minor: 0, patch: 0, prerelease: [], build: [] }
  }
  if (base.minor > 0) {
    return { major: 0, minor: base.minor + 1, patch: 0, prerelease: [], build: [] }
  }
  return { major: 0, minor: 0, patch: base.patch + 1, prerelease: [], build: [] }
}

/** Upper bound (exclusive) of a tilde range. */
function tildeUpperBound(base: SemanticVersion): SemanticVersion {
  return { major: base.major, minor: base.minor + 1, patch: 0, prerelease: [], build: [] }
}

function samePrecedenceTuple(a: SemanticVersion, b: SemanticVersion): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch
}

/**
 * Evaluates a parsed constraint against a parsed version.
 *
 * - `any` admits everything (including prereleases).
 * - `exact` requires the canonical string to match exactly (build metadata
 *   is significant).
 * - `caret`/`tilde` admit versions within the range bounds; a prerelease
 *   version is admitted only when its `[major, minor, patch]` tuple equals
 *   the range's base tuple (mirrors npm's prerelease-range behavior).
 */
export function satisfiesParsed(
  version: SemanticVersion,
  range: SemverRangeAst,
): boolean {
  if (range.kind === 'any') {
    return true
  }
  if (range.kind === 'exact') {
    return formatSemver(version) === formatSemver(range.version)
  }
  if (version.prerelease.length > 0) {
    if (
      range.base.prerelease.length === 0 ||
      !samePrecedenceTuple(version, range.base)
    ) {
      return false
    }
  }
  if (compareSemver(version, range.base) < 0) {
    return false
  }
  const upper =
    range.kind === 'caret' ? caretUpperBound(range.base) : tildeUpperBound(range.base)
  return compareSemver(version, upper) < 0
}

/**
 * Convenience wrapper: parses the constraint, then evaluates it.
 * Unparseable constraints satisfy nothing (fail closed).
 */
export function semverSatisfies(
  version: SemanticVersion,
  range: SemverRange,
): boolean {
  const parsed = parseSemverRange(range)
  return parsed !== null && satisfiesParsed(version, parsed)
}
