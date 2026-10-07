/**
 * Deep clone-and-freeze helpers for immutable registry state (lock rule 8:
 * "Packages are immutable/versioned/addressable").
 *
 * The registry stores its OWN frozen copy of every published record so that
 * callers can never mutate the index through retained references; the
 * caller's input object is never frozen (cloning isolates it).
 *
 * Records are validated as canonical-JSON-safe (via
 * `validatePackageRecord` from `@playliquid/package-system`) BEFORE cloning,
 * so the traversal below is always finite, acyclic and plain.
 *
 * Internal module — not re-exported from the package index.
 */

/** Returns a deep, plain-structure clone of a JSON-safe value. */
export function deepClone<T extends object>(value: T): T {
  return structuredClone(value)
}

/** Recursively freezes a plain value in place; returns the same reference. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== null && typeof child === 'object') {
        deepFreeze(child)
      }
    }
    Object.freeze(value)
  }
  return value
}

/** Clones and freezes in one step; the registry's store-time transform. */
export function sealedCopy<T extends object>(value: T): T {
  return deepFreeze(deepClone(value))
}
