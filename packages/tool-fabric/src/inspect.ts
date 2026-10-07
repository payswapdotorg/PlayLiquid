/**
 * Module role: internal, never-throwing inspection helpers shared by the
 * tool-fabric validators. NOT part of the public package surface (not
 * re-exported from src/index.ts).
 *
 * Implements: PL-005 §3.A.1/§3.A.2 validator totality — "typed rejections,
 * never thrown exceptions" — even for hostile inputs (throwing getters,
 * proxy traps).
 */

/**
 * Plain own-enumerable snapshot of `input`, or null when `input` is not a
 * readable, non-array object. Unreadable properties degrade to "absent" and
 * unreadable key sets degrade to "not an object", so validators built on
 * snapshots can never throw.
 */
export function snapshotRecord(input: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  try {
    const snapshot: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      try {
        snapshot[key] = (input as Record<string, unknown>)[key];
      } catch {
        /* unreadable property — treated as absent */
      }
    }
    return snapshot;
  } catch {
    return null;
  }
}
