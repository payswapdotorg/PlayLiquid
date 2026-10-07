/**
 * Test-support helpers — deterministic synthetic payloads.
 *
 * Not exported from the package index (test-only, mirroring the
 * `test-fixtures.ts` convention of `@playliquid/package-system`).
 */

/** Deterministic pseudo-random payload (xorshift32). No literals needed. */
export function syntheticBytes(length: number, seed = 0x9e3779b9): Uint8Array {
  const bytes = new Uint8Array(length)
  let state = seed >>> 0
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    bytes[index] = state & 0xff
  }
  return bytes
}
