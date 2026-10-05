/**
 * Package identity primitives: package kinds and package ids.
 *
 * Spec: spec/package-contract.md "Required identity: package kind; package id".
 *
 * The package kinds enumerate the reusable composition units of the GameOS
 * architecture (spec/architecture.md "Game model" and "Package Graph"):
 * games are compositions of world/assets/avatar content; systems/mechanics
 * and evaluation suites are reusable GameIR content; overlays are the narrow
 * override packages the architecture explicitly supports.
 *
 * Package ids use a lowercase, npm-compatible grammar so that PlayLiquid
 * packages can live in ordinary package registries without renaming.
 */

/** Every reusable composition unit kind. */
export const PACKAGE_KINDS = [
  'game',
  'world',
  'assets',
  'avatar',
  'system',
  'overlay',
  'evaluation-suite',
] as const

/** A package kind. */
export type PackageKind = (typeof PACKAGE_KINDS)[number]

/** A package id: lowercase, optionally scoped (`@scope/name`). */
export type PackageId = string

const MAX_PACKAGE_ID_LENGTH = 214

const PACKAGE_ID_PATTERN = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** Runtime type guard for {@link PackageKind}. */
export function isPackageKind(value: unknown): value is PackageKind {
  return (
    typeof value === 'string' &&
    (PACKAGE_KINDS as readonly string[]).includes(value)
  )
}

/** A parsed package id. */
export interface ParsedPackageId {
  /** Scope segment without the leading `@` and trailing `/`, or `null`. */
  readonly scope: string | null
  /** Name segment. */
  readonly name: string
}

/** Parses a package id. Returns `null` for invalid input. */
export function parsePackageId(id: PackageId): ParsedPackageId | null {
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > MAX_PACKAGE_ID_LENGTH
  ) {
    return null
  }
  if (!PACKAGE_ID_PATTERN.test(id)) {
    return null
  }
  if (id.startsWith('@')) {
    const separator = id.indexOf('/')
    const scope = id.slice(1, separator)
    const name = id.slice(separator + 1)
    return { scope, name }
  }
  return { scope: null, name: id }
}

/** Serializes a parsed id back to its canonical string. */
export function formatPackageId(parsed: ParsedPackageId): string {
  return parsed.scope === null ? parsed.name : `@${parsed.scope}/${parsed.name}`
}

/** Type guard: a well-formed package id. */
export function isPackageId(value: unknown): value is PackageId {
  return parsePackageId(value as string) !== null
}
