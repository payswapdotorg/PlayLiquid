/**
 * The tenant-scoped read model of the Spark runtime shell (PL-035) — the
 * lifecycle phase vocabulary and the view the shell's doors project.
 *
 * Extracted from runtime.ts (PLX-ARCH-003) so the shell mechanics file
 * stays within the architecture policy's file-size budget; the types are
 * unchanged and remain re-exported from the package barrel (index.ts) —
 * no public-surface change.
 */

/** The lifecycle phase of the shell (kernel phases stay authoritative). */
export type SparkRuntimePhase = "created" | "booted" | "live";

/** The tenant-scoped read model of the shell. */
export interface SparkRuntimeView {
  /** Discriminator: a view (never a refusal). */
  readonly ok: true;
  readonly sessionId: string;
  readonly phase: SparkRuntimePhase;
  readonly planDigest: string;
  readonly scheduleDigest: string;
  readonly cacheManifestDigest: string;
  readonly criticalBytes: number;
  readonly plannedFirstPaintMs: number;
  readonly plannedFirstInteractionMs: number;
  readonly deferredUnitCount: number;
  readonly streamedBatchCount: number;
  readonly bootRecordDigest: string | null;
}
