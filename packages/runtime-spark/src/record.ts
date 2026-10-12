/**
 * THE SPARK BOOT RECORD (PL-035 first-interaction evidence, E10).
 *
 * The immutable witness of the interaction-ready transition: boot plan
 * applied → first command accepted. Carries:
 * - the boot plan digest (what loaded now);
 * - the stream-schedule and cache-manifest digests (what streams later
 *   and what may cache);
 * - the accepted-first-command digest and its sequence;
 * - the deterministic critical-boot ordering (unit ids in boot order);
 * - the injected-clock timestamps of boot, interaction-ready and the
 *   accepted first interaction.
 *
 * E10 discipline: a record is sealed ONCE (`sparkBootRecordDigestOf`
 * recomputes the content digest; `verifySparkBootRecord` refuses any
 * tampered record). Re-recording over an existing record is a typed
 * `boot-record-immutable` refusal (runtime.ts enforces it).
 *
 * Pure module: no IO, no clocks, no globals.
 */

import { computeDigest } from "@playliquid/package-system";
import type { ContentDigest } from "@playliquid/package-system";
import type { TenantId } from "@playliquid/platform-contracts";
import type { SessionId } from "@playliquid/runtime-contracts";

/** The immutable first-interaction evidence record. */
export interface SparkBootRecord {
  readonly kind: "spark-boot-record";
  readonly tenant: TenantId;
  readonly sessionId: SessionId;
  readonly profileId: "spark";
  readonly planDigest: ContentDigest;
  readonly scheduleDigest: ContentDigest;
  readonly cacheManifestDigest: ContentDigest;
  readonly criticalBytes: number;
  /** Digest of the FIRST accepted command (command id + sequence + intent). */
  readonly firstCommandDigest: ContentDigest;
  readonly firstCommandKind: string;
  readonly firstCommandSeq: number;
  /** Deterministic boot ordering evidence (critical unit ids, boot order). */
  readonly bootOrdering: readonly string[];
  readonly bootedAt: number;
  readonly interactionReadyAt: number;
  readonly firstInteractionAt: number;
  readonly recordDigest: ContentDigest;
}

/** The digest input of a boot record (everything except itself). */
function recordDigestInput(record: Omit<SparkBootRecord, "recordDigest">): unknown {
  return {
    kind: record.kind,
    tenant: record.tenant,
    sessionId: record.sessionId,
    profileId: record.profileId,
    planDigest: record.planDigest,
    scheduleDigest: record.scheduleDigest,
    cacheManifestDigest: record.cacheManifestDigest,
    criticalBytes: record.criticalBytes,
    firstCommandDigest: record.firstCommandDigest,
    firstCommandKind: record.firstCommandKind,
    firstCommandSeq: record.firstCommandSeq,
    bootOrdering: [...record.bootOrdering],
    bootedAt: record.bootedAt,
    interactionReadyAt: record.interactionReadyAt,
    firstInteractionAt: record.firstInteractionAt,
  };
}

/** Seals a boot record: computes and appends the content digest (E10). */
export function sealSparkBootRecord(record: Omit<SparkBootRecord, "recordDigest">): SparkBootRecord {
  return { ...record, recordDigest: computeDigest(recordDigestInput(record)) };
}

/** Recomputes a boot record's content digest (tamper evidence). */
export function sparkBootRecordDigestOf(record: SparkBootRecord): ContentDigest {
  return computeDigest(recordDigestInput(record));
}

/** Verifies a boot record against its own content digest (E10 immutability). */
export function verifySparkBootRecord(record: SparkBootRecord): true | { readonly ok: false; readonly message: string } {
  if (record?.recordDigest !== sparkBootRecordDigestOf(record)) {
    return {
      ok: false,
      message: `boot record digest mismatch for session ${String(record?.sessionId)} (tampered evidence is refused, E10)`,
    };
  }
  return true;
}

/**
 * The deterministic digest of one accepted command: command id, sequence
 * and intent identity (kind + actor). Same command ⇒ same digest (E9).
 */
export function sparkFirstCommandDigestOf(command: {
  readonly commandId: string;
  readonly commandSeq: number;
  readonly commandKind: string;
  readonly actorId: string;
  readonly intentId: string;
}): ContentDigest {
  return computeDigest({
    commandId: command.commandId,
    commandSeq: command.commandSeq,
    commandKind: command.commandKind,
    actorId: command.actorId,
    intentId: command.intentId,
  });
}
