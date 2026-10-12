/**
 * THE REFUSAL LEDGER (PL-041, E10) — every denial the authority emits is
 * recorded append-only with its typed code and evidence; refusals are
 * first-class outputs, never swallowed (E8).
 *
 * Idempotency: the record id is the content digest of (tenant, subject,
 * code, detail, evidence). Appending the SAME refusal again returns the
 * recorded record (`duplicate: true`) and mutates nothing — a repeated
 * attack probe does not grow the ledger, and the first record stands
 * (E10: the history is never edited or re-ordered).
 *
 * Purity: pure folds over immutable records. No IO, no clock (time is
 * caller-supplied), no randomness.
 */

import { digestSlug } from "./digest.ts";
import type { RefusalRecord } from "./ports.ts";

/** The result of one ledger append (E10 idempotent-receipt pattern). */
export type LedgerAppendResult = {
  readonly record: RefusalRecord;
  readonly duplicate: boolean;
};

/** Derives the content-addressed refusal id (E9). */
export function refusalIdOf(
  tenant: string,
  subject: string,
  code: string,
  detail: string,
  evidence: readonly string[],
): string {
  return digestSlug({ tenant, subject, code, detail, evidence }, "refusal");
}

/** Builds (does not append) one refusal record. */
export function refusalRecordOf(input: {
  readonly tenant: string;
  readonly subject: string;
  readonly code: string;
  readonly detail: string;
  readonly evidence: readonly string[];
  readonly at: number;
  readonly revision: number;
}): RefusalRecord {
  return {
    refusalId: refusalIdOf(input.tenant, input.subject, input.code, input.detail, input.evidence),
    tenant: input.tenant,
    subject: input.subject,
    code: input.code,
    detail: input.detail,
    evidence: [...input.evidence],
    at: input.at,
    revision: input.revision,
  };
}

/**
 * Appends one refusal to the ledger, idempotently: a content-identical
 * refusal returns the recorded record (E10 — the first receipt stands).
 */
export function appendRefusal(
  ledger: readonly RefusalRecord[],
  record: RefusalRecord,
): LedgerAppendResult {
  const recorded = ledger.find((existing) => existing.refusalId === record.refusalId);
  if (recorded !== undefined) {
    return { record: recorded, duplicate: true };
  }
  return { record, duplicate: false };
}

/** The tenant-scoped ledger view (read fold). */
export function ledgerOf(ledger: readonly RefusalRecord[], tenant: string): readonly RefusalRecord[] {
  return ledger.filter((record) => record.tenant === tenant);
}

/** Asserts (test support) the ledger's append-only invariants hold on a slice. */
export function ledgerIsAppendOnly(before: readonly RefusalRecord[], after: readonly RefusalRecord[]): boolean {
  if (after.length < before.length) return false;
  for (let index = 0; index < before.length; index += 1) {
    const prior = before[index]!;
    const next = after[index]!;
    if (prior.refusalId !== next.refusalId || prior.revision !== next.revision) return false;
  }
  return true;
}
