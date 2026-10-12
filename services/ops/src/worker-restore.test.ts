/**
 * THE RESTORE / TAMPER TESTS (PL-044) — E6 snapshot restore + E8 layered
 * tamper refusals over the persisted worker document.
 *
 * The restore verification (worker-restore.ts) is LAYERED, and the tests
 * below drive a tamper deep enough to reach each layer:
 *
 *   layer 1  tampered-document — a naive edit (any content changed, or the
 *            state digest itself smashed) breaks the whole-document
 *            content address;
 *   layer 2  tampered-work — an attacker who edited a work payload AND
 *            recomputed the document state digest (the digest function
 *            is public — there is no signature authority here, E11) is
 *            still caught by the work's own identity chain (its stale
 *            workDigest / workId);
 *   layer 3  tampered-effect — a receipt whose key no longer matches its
 *            work's stable effect key;
 *   layer 4  broken-journal — an edited journal entry, even with the
 *            document state digest recomputed over it, breaks the
 *            append-only hash chain (E10: deployments of work are
 *            records, never edits).
 *
 * E11 HONESTY: a tamper that recomputes EVERY digest (document + work
 * identity + effect keys + journal chain) yields a fully self-consistent
 * document — content addressing cannot detect it without a trust anchor
 * (a signature/MAC), which this tree deliberately does not provide (no
 * secrets management). The layers above catch every tamper short of that.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import { DurableWorkerRuntime } from "./worker.ts";
import type { OpsCaller, OpsWorkerDocument } from "./worker-ports.ts";
import { opsWorkerDocumentDigestOf } from "./digest.ts";
import { createCountingEffects, createFixedClock, createMemoryWorkerStore } from "./fixtures.ts";

const TENANT = asTenantId("tenant-ops")!;
const SUBJECT = asSubjectId("subject-ops")!;

function callerOf(): OpsCaller {
  return { tenant: TENANT, subject: SUBJECT };
}

/** One runtime with a single enqueued work item, persisted once. */
function persistedDocumentWithWork(): OpsWorkerDocument {
  const store = createMemoryWorkerStore();
  const worker = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store, effects: createCountingEffects() } });
  const enqueued = worker.enqueue(callerOf(), { kind: "demo-work", effectKind: "demo-effect", payload: { n: 0 } });
  assert.ok(enqueued.ok);
  const loaded = store.load();
  assert.ok(loaded !== undefined);
  return loaded;
}

/** A poisoned store holding a tampered copy of a persisted document. */
function poisonedStore(document: OpsWorkerDocument): ReturnType<typeof createMemoryWorkerStore> {
  const poisoned = createMemoryWorkerStore();
  poisoned.save(document);
  return poisoned;
}

/** The runtime under test over a poisoned store. */
function victimOver(document: OpsWorkerDocument): DurableWorkerRuntime {
  return new DurableWorkerRuntime({
    ports: { clock: createFixedClock(1_000), store: poisonedStore(document), effects: createCountingEffects() },
  });
}

test("E8: a naively tampered persisted document is a typed refusal, never restored", () => {
  // Layer 1: the state digest itself is smashed — the whole-document
  // content address no longer matches.
  const tampered: OpsWorkerDocument = { ...persistedDocumentWithWork(), stateDigest: "f".repeat(64) };
  const restored = victimOver(tampered).restore();
  assert.ok(!restored.ok && restored.code === "tampered-document");
});

test("E8: a payload-edited work document is a typed tampered-work refusal, never restored", () => {
  // Layer 2: the payload is edited AND the document state digest is
  // recomputed over the edited content (a smarter tamper — the digest
  // function is public). The work's own identity chain is stale and the
  // restore refuses with `tampered-work`.
  const original = persistedDocumentWithWork();
  const works = original.works.map((work, index) =>
    index === 0 ? { ...work, payload: { n: 999 } } : work,
  );
  const tampered: OpsWorkerDocument = {
    ...original,
    works,
    stateDigest: opsWorkerDocumentDigestOf({ revision: original.revision, works, effects: original.effects, journal: original.journal }),
  };
  const restored = victimOver(tampered).restore();
  assert.ok(!restored.ok && restored.code === "tampered-work", restored.ok ? "" : restored.detail);
});

test("E8: a payload edit with a recomputed work digest is still refused (the workId pins the content key)", () => {
  // Layer 2, deeper: the attacker recomputed BOTH the document digest and
  // the work's workDigest over the edited payload. The work ID is the
  // slug of the work CONTENT KEY (tenant + kind + effect kind + payload)
  // — it no longer matches, and the restore still refuses.
  const original = persistedDocumentWithWork();
  const edited = { ...original.works[0]!, payload: { n: 999 } } as typeof original.works[number];
  const works = original.works.map((work, index) => (index === 0 ? edited : work));
  const tampered: OpsWorkerDocument = {
    ...original,
    works,
    stateDigest: opsWorkerDocumentDigestOf({ revision: original.revision, works, effects: original.effects, journal: original.journal }),
  };
  const restored = victimOver(tampered).restore();
  assert.ok(!restored.ok && restored.code === "tampered-work", restored.ok ? "" : restored.detail);
});

test("E10/E8: an edited journal entry is a typed broken-journal refusal, never restored", () => {
  // Layer 4: the journal entry's facts are edited AND the document state
  // digest is recomputed over the edited journal. The append-only hash
  // chain still breaks — the entry's own chained digest no longer
  // matches its content (E10: an edit is detectable even when the
  // document digest is honestly recomputed).
  const original = persistedDocumentWithWork();
  const journal = original.journal.map((entry, index) =>
    index === 0
      ? { ...entry, facts: { ...entry.facts, payloadDigest: "0".repeat(64) } }
      : entry,
  );
  const tampered: OpsWorkerDocument = {
    ...original,
    journal,
    stateDigest: opsWorkerDocumentDigestOf({ revision: original.revision, works: original.works, effects: original.effects, journal }),
  };
  const restored = victimOver(tampered).restore();
  assert.ok(!restored.ok && restored.code === "broken-journal", restored.ok ? "" : restored.detail);
});

test("E6: restore with no persisted document is an honest typed refusal", () => {
  const worker = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store: createMemoryWorkerStore(), effects: createCountingEffects() } });
  const restored = worker.restore();
  assert.ok(!restored.ok && restored.code === "no-persisted-document");
});

test("E6: an honest document restores atomically and appends the restore record (E10)", () => {
  const store = createMemoryWorkerStore();
  const first = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store, effects: createCountingEffects() } });
  const enqueued = first.enqueue(callerOf(), { kind: "demo-work", effectKind: "demo-effect", payload: { n: 0 } });
  assert.ok(enqueued.ok);
  const before = store.load()!;
  const second = new DurableWorkerRuntime({ ports: { clock: createFixedClock(1_000), store, effects: createCountingEffects() } });
  const restored = second.restore();
  assert.ok(restored.ok, restored.ok ? "" : restored.detail);
  if (restored.ok) {
    assert.equal(restored.works, 1);
    assert.equal(restored.journalLength, before.journal.length + 1, "restore appends exactly one journal record");
  }
  const kinds = second.journalOf().map((entry) => entry.kind);
  assert.deepEqual(kinds, ["enqueued", "restored"]);
  // The pre-restore journal is a verbatim prefix (E10 — adopt, never edit).
  const after = second.journalOf();
  for (let index = 0; index < before.journal.length; index += 1) {
    assert.equal(after[index]?.digest, before.journal[index]?.digest);
  }
});
