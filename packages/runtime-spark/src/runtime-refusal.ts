/**
 * The Spark runtime shell's typed refusal vocabulary (PL-035) — the
 * kebab-case refusal codes and the typed refusal shape (E8).
 *
 * Extracted from runtime.ts (PLX-ARCH-003) so the routing authority
 * (dispatch.ts) can reference the refusal shape without a module cycle
 * (runtime.ts imports dispatch.ts for the world door; dispatch.ts imports
 * these types). The types are unchanged and remain re-exported from
 * runtime.ts and the package barrel (index.ts) — no public-surface change.
 */

import type { SparkBootRejection } from "./boot-plan.ts";

/** Typed runtime refusal codes (kebab-case, E8). */
export type SparkRuntimeRefusalCode =
  | "invalid-tenant"
  | "cross-tenant"
  | "invalid-session"
  | "boot-refused"
  | "not-booted"
  | "already-booted"
  | "boot-record-immutable"
  | "stream-exhausted"
  | "source-refused"
  | "cache-refused"
  | "kernel-refused"
  /** ACR-001 (PLX-ARCH-003): the document DECLARES a non-spark delivery. */
  | "world-delivery-not-spark";

/** A typed runtime refusal. */
export interface SparkRuntimeRefusal<C = SparkRuntimeRefusalCode> {
  readonly ok: false;
  readonly code: C;
  readonly message: string;
  /** Aggregated planning rejections, when code is `boot-refused`. */
  readonly rejections?: readonly SparkBootRejection[];
}
