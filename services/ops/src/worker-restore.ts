/**
 * RESTORE VERIFICATION (PL-044) — the LAYERED content verification a
 * persisted worker document must pass before restore() adopts ANY of it
 * (E6 snapshot restore; E8: a tampered document is a typed refusal, never
 * restored). Extracted from worker.ts for file hygiene (no cycles: only
 * leaf-ward siblings).
 *
 * The layers (first refusal wins; restore is atomic — nothing is adopted
 * unless everything verifies):
 *
 *  1. WHOLE DOCUMENT: the recomputed state digest (over revision + works
 *     + effects + journal) must equal the stored `stateDigest`. A naive
 *     edit of any content breaks this layer (`tampered-document`).
 *  2. PER WORK: every work item's `workDigest` must still pin its
 *     admission content AND its `workId` must still be the slug of its
 *     content key (tenant + kind + effect kind + payload). The second
 *     check catches the SMARTER tamper — an attacker who edited a payload
 *     AND recomputed the document digest (the digest function is public,
 *     E11: there is no signature authority here) is still caught while
 *     the work's own identity chain is stale (`tampered-work`).
 *  3. PER EFFECT: every receipt's `effectKey` must be the stable effect
 *     key of the work it cites (`tampered-effect`).
 *  4. JOURNAL: the append-only hash chain must verify — seq/kinds/links/
 *     per-entry digests (`broken-journal`).
 *
 * Purity: no IO, no clock (all inputs are values).
 */

import {
  isDigestHex,
  opsEffectKeyOf,
  opsWorkDigestOf,
  opsWorkIdOf,
  opsWorkKeyOf,
  opsWorkerDocumentDigestOf,
} from "./digest.ts";
import { verifyWorkJournal } from "./work-journal.ts";
import { isWorkState } from "./worker-ports.ts";
import type { EffectRecord, OpsWorkerDocument, WorkRecord } from "./worker-ports.ts";

/** The result of the layered restore verification (typed, total). */
export type RestoreVerification =
  | { readonly ok: true; readonly document: OpsWorkerDocument }
  | { readonly ok: false; readonly code: "no-persisted-document" | "tampered-document" | "tampered-work" | "tampered-effect" | "broken-journal"; readonly detail: string };

/** Verifies one persisted document end-to-end (pure, never throws). */
export function verifyRestorableDocument(document: OpsWorkerDocument | undefined): RestoreVerification {
  if (document === undefined) {
    return { ok: false, code: "no-persisted-document", detail: "no persisted document to restore" };
  }
  const digest = opsWorkerDocumentDigestOf({
    revision: document.revision,
    works: document.works,
    effects: document.effects,
    journal: document.journal,
  });
  if (digest !== document.stateDigest) {
    return {
      ok: false,
      code: "tampered-document",
      detail: "the persisted document no longer matches its content-addressed state digest (E8)",
    };
  }
  for (const work of document.works) {
    if (!isWorkState(work.state) || !workIdentityVerifies(work)) {
      return {
        ok: false,
        code: "tampered-work",
        detail: `persisted work ${String(work.workId)} no longer matches its content-addressed identity (E8)`,
      };
    }
  }
  for (const receipt of document.effects) {
    if (!effectVerifies(receipt, document.works)) {
      return {
        ok: false,
        code: "tampered-effect",
        detail: `persisted effect receipt ${String(receipt.effectKey)} does not match its work's stable effect key (E8)`,
      };
    }
  }
  const journal = verifyWorkJournal(document.journal);
  if (!journal.ok) {
    return { ok: false, code: "broken-journal", detail: `the persisted journal is broken: ${journal.detail}` };
  }
  return { ok: true, document };
}

/** The immutable admission content still pins the work's identity digest. */
export function workIdentityVerifies(record: WorkRecord): boolean {
  const digestMatches = opsWorkDigestOf({
    tenant: String(record.tenant),
    enqueuedBy: String(record.enqueuedBy),
    kind: record.kind,
    effectKind: record.effectKind,
    payload: record.payload,
    payloadDigest: record.payloadDigest,
    enqueuedAt: record.enqueuedAt,
  }) === record.workDigest;
  // Layer-2b: the work id must still be the slug of the work CONTENT KEY
  // (tenant + kind + effect kind + payload) — catches edits that
  // recomputed the work digest but not the content-addressed id.
  const idMatches = record.workId === opsWorkIdOf(opsWorkKeyOf({
    tenant: String(record.tenant),
    kind: record.kind,
    effectKind: record.effectKind,
    payload: record.payload,
  }));
  return digestMatches && idMatches;
}

/** The receipt's key is the stable effect key of the work it cites. */
function effectVerifies(receipt: EffectRecord, works: readonly WorkRecord[]): boolean {
  const work = works.find((item) => item.workId === receipt.workId);
  return (
    work !== undefined &&
    isDigestHex(receipt.effectKey) &&
    receipt.effectKey === opsEffectKeyOf({ workId: work.workId, effectKind: work.effectKind, payloadDigest: work.payloadDigest })
  );
}
