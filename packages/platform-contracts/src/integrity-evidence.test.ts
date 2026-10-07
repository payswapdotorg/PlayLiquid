import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId, asSubjectId, asContentDigest, asTimestampMs } from "./primitives.ts";
import {
  asEvidenceRecordId,
  BEHAVIORAL_EVIDENCE_KINDS,
  isBehavioralEvidenceKind,
  isBehavioralEvidenceRecord,
  isEvidenceCitation,
  citationMatchesRecord,
  resolveEvidenceCitation,
} from "./integrity-evidence.ts";
import type { BehavioralEvidenceRecord, EvidenceCitation } from "./integrity-evidence.ts";

const tenant = asTenantId("tenant-alpha")!;
const subject = asSubjectId("player-one")!;
const evidenceId = asEvidenceRecordId("ev-0001")!;
const capturedAt = asTimestampMs(1_000)!;

// Digests assembled at runtime from fragments — never secret-shaped literals.
const payloadDigest = asContentDigest("ab".repeat(32))!;
const shapeDigest = asContentDigest("cd".repeat(32))!;
const sourceDigest = asContentDigest("ef".repeat(32))!;
const otherDigest = asContentDigest("12".repeat(32))!;

function record(overrides: Partial<BehavioralEvidenceRecord> = {}): BehavioralEvidenceRecord {
  const full: BehavioralEvidenceRecord = {
    recordKind: "integrity-evidence",
    evidenceId,
    tenant,
    subject,
    kind: "trajectory",
    payloadDigest,
    shapeDigest,
    sourceDigest,
    capturedAt,
  };
  return { ...full, ...overrides };
}

test("integrity-evidence: kind vocabulary is frozen and exhaustive", () => {
  assert.ok(Object.isFrozen(BEHAVIORAL_EVIDENCE_KINDS));
  assert.deepEqual([...BEHAVIORAL_EVIDENCE_KINDS], ["trajectory", "timing", "outcome-pattern"]);
  assert.ok(isBehavioralEvidenceKind("trajectory"));
  assert.ok(isBehavioralEvidenceKind("timing"));
  assert.ok(isBehavioralEvidenceKind("outcome-pattern"));
  // Unknown evidence kinds are refused (negative path).
  assert.equal(isBehavioralEvidenceKind("psychic-trace"), false);
  assert.equal(isBehavioralEvidenceKind(""), false);
});

test("integrity-evidence: well-formed records validate", () => {
  for (const kind of BEHAVIORAL_EVIDENCE_KINDS) {
    assert.ok(isBehavioralEvidenceRecord(record({ kind })), `${kind} should validate`);
  }
  // Shape digest is optional.
  assert.ok(isBehavioralEvidenceRecord(record({ shapeDigest: undefined })));
  assert.ok(asEvidenceRecordId("ev-0042"));
  assert.equal(asEvidenceRecordId("NOT AN ID"), undefined);
});

test("integrity-evidence: records without the disjoint marker are refused", () => {
  // A game-declared payload posing as evidence fails the marker check.
  const imposter = { ...record(), recordKind: "game-declared" };
  assert.equal(isBehavioralEvidenceRecord(imposter), false);
  assert.equal(isBehavioralEvidenceRecord({ ...record(), recordKind: undefined }), false);
});

test("integrity-evidence: malformed digests, kinds and timestamps never validate", () => {
  assert.equal(isBehavioralEvidenceRecord(record({ payloadDigest: "junk" as never })), false);
  assert.equal(isBehavioralEvidenceRecord(record({ sourceDigest: "junk" as never })), false);
  assert.equal(isBehavioralEvidenceRecord(record({ shapeDigest: "junk" as never })), false);
  assert.equal(isBehavioralEvidenceRecord(record({ kind: "vibes" as never })), false);
  assert.equal(isBehavioralEvidenceRecord(record({ evidenceId: "" as never })), false);
  assert.equal(isBehavioralEvidenceRecord(record({ capturedAt: -1 as never })), false);
  assert.equal(isBehavioralEvidenceRecord(record({ capturedAt: 1.5 as never })), false);
  assert.equal(isBehavioralEvidenceRecord(null), false);
});

test("integrity-evidence: citations are id + digest pins", () => {
  const citation: EvidenceCitation = { evidenceId, payloadDigest };
  assert.ok(isEvidenceCitation(citation));
  assert.ok(citationMatchesRecord(citation, record()));
  // A citation with a stale digest does NOT match the record.
  const stale: EvidenceCitation = { evidenceId, payloadDigest: otherDigest };
  assert.equal(citationMatchesRecord(stale, record()), false);
  // A citation of another id does not match either.
  const foreign: EvidenceCitation = {
    evidenceId: asEvidenceRecordId("ev-9999")!,
    payloadDigest,
  };
  assert.equal(citationMatchesRecord(foreign, record()), false);
  assert.equal(isEvidenceCitation({ evidenceId, payloadDigest: "junk" }), false);
  assert.equal(isEvidenceCitation({ evidenceId: "", payloadDigest }), false);
});

test("integrity-evidence: citation resolution is unique and digest-pinned", () => {
  const body = [record(), record({ evidenceId: asEvidenceRecordId("ev-0002")!, payloadDigest: otherDigest })];
  const resolved = resolveEvidenceCitation({ evidenceId, payloadDigest }, body);
  assert.ok(resolved !== undefined);
  assert.equal(resolved.evidenceId, evidenceId);
  // Stale digest resolves to nothing — the chain refuses to guess.
  assert.equal(resolveEvidenceCitation({ evidenceId, payloadDigest: otherDigest }, body), undefined);
  assert.equal(resolveEvidenceCitation({ evidenceId: asEvidenceRecordId("ev-nope")!, payloadDigest }, body), undefined);
});

test("integrity-evidence: records are readonly data (E1 compile check)", () => {
  const evidence: BehavioralEvidenceRecord = record();
  // @ts-expect-error — E1: contract fields are readonly
  evidence.kind = "timing";
  // readonly is a compile-time guarantee; runtime deep-freezing is the
  // owning service's job (this package is pure data).
  assert.equal(evidence.evidenceId, evidenceId);
});
