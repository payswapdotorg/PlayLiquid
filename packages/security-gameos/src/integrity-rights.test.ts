/**
 * INTEGRITY-RIGHTS TESTS (PL-041 composing PL-018, R11) — the verdict →
 * lattice-entry fold: the disposition mapping, the PROBABILISTIC evidence
 * (band + interval), the structural certainty ban (no forbidden field
 * can appear on a minted entry), the idempotent re-ingestion (E10), the
 * new-verdict-append semantics, and the rig's real suspended/clear
 * standings driving actual refusals through the lattice.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { dispositionOf, foldStanding, standingEntryId, suspendsFor } from "./index.ts";
import type { IntegrityRightsEntry } from "./index.ts";
import { FORBIDDEN_VERDICT_FIELDS } from "@playliquid/platform-contracts";
import type { IntegrityRiskVerdict } from "@playliquid/platform-contracts";
import { createSecurityRig } from "./index.ts";
import type { SecurityRig } from "./index.ts";
import { RIG_AUDITOR, RIG_CLEAN_SUBJECT, RIG_SUSPENDED_SUBJECT, RIG_TENANT, RIG_HOST } from "./rig.ts";

const tenant = "tenant-integrity";
const subject = "actr-integrity-one";

function verdict(over: Partial<IntegrityRiskVerdict> = {}): IntegrityRiskVerdict {
  return {
    verdictId: "iverd-0001" as IntegrityRiskVerdict["verdictId"],
    tenant: tenant as IntegrityRiskVerdict["tenant"],
    subject: subject as IntegrityRiskVerdict["subject"],
    reportRef: "irep-0001" as IntegrityRiskVerdict["reportRef"],
    kind: "pronounced-deviation-observed",
    risk: { riskScore: 0.83, confidence: { level: 0.95, lowerBound: 0.72, upperBound: 0.94 } },
    band: "moderate",
    evidence: [{ evidenceId: "iev-0001", payloadDigest: "a".repeat(64) } as unknown as IntegrityRiskVerdict["evidence"][number]],
    decidedBy: "platform-authority",
    ...over,
  };
}

test("integrity: the disposition mapping is the frozen verdict table", () => {
  assert.equal(dispositionOf("pronounced-deviation-observed"), "suspended");
  assert.equal(dispositionOf("deviation-observed"), "flagged");
  assert.equal(dispositionOf("consistent-with-declared-mode"), "held-clear");
  assert.equal(dispositionOf("inconclusive"), "held-clear");
});

test("integrity: the fold carries the verdict kind, the DERIVED band and the aggregate interval", () => {
  const result = foldStanding(tenant, subject, verdict(), [], 5_000);
  assert.ok(result.ok);
  assert.equal(result.entry.disposition, "suspended");
  assert.equal(result.entry.verdictKind, "pronounced-deviation-observed");
  assert.equal(result.entry.band, "moderate");
  assert.deepEqual(result.entry.confidence, { lower: 0.72, upper: 0.94 });
  assert.ok(suspendsFor(result.entry));
});

test("integrity R11: certainty is STRUCTURALLY unrepresentable on the minted entry", () => {
  const result = foldStanding(tenant, subject, verdict(), [], 5_000);
  assert.ok(result.ok);
  const entry: IntegrityRightsEntry = result.entry;
  for (const key of Object.keys(entry)) {
    assert.ok(
      !FORBIDDEN_VERDICT_FIELDS.includes(key),
      `entry carries forbidden certainty field ${key}`,
    );
  }
  // and the evidence is only ever (kind, band, interval) — no boolean claim.
  assert.equal(typeof entry.disposition, "string");
  assert.equal(typeof entry.band, "string");
  assert.equal(typeof entry.confidence.lower, "number");
  assert.equal(typeof entry.confidence.upper, "number");
});

test("integrity E10: re-ingesting the same verdict returns the recorded entry (idempotent)", () => {
  const first = foldStanding(tenant, subject, verdict(), [], 5_000);
  assert.ok(first.ok && !first.duplicate);
  const history: IntegrityRightsEntry[] = first.ok ? [first.entry] : [];
  const second = foldStanding(tenant, subject, verdict(), history, 9_000);
  assert.ok(second.ok);
  assert.ok(second.duplicate);
  assert.equal(second.entry.entryId, first.ok ? first.entry.entryId : "");
  assert.equal(second.entry.ingestedAt, first.ok ? first.entry.ingestedAt : -1);
  assert.equal(history.length, 1);
});

test("integrity E10: a NEW verdict for the same subject APPENDS and becomes the standing", () => {
  const first = foldStanding(tenant, subject, verdict(), [], 5_000);
  assert.ok(first.ok);
  const history: IntegrityRightsEntry[] = first.ok ? [first.entry] : [];
  const second = foldStanding(
    tenant,
    subject,
    verdict({ verdictId: "iverd-0002" as IntegrityRiskVerdict["verdictId"], kind: "consistent-with-declared-mode", band: "narrow" }),
    history,
    6_000,
  );
  assert.ok(second.ok && !second.duplicate);
  history.push(second.entry);
  assert.equal(history.length, 2);
  assert.ok(!suspendsFor(second.entry));
  // the entry ids are content-derived from the verdict (E9).
  assert.notEqual(second.entry.entryId, history[0]!.entryId);
  assert.equal(
    standingEntryId(tenant, subject, "iverd-0001", "suspended"),
    history[0]!.entryId,
  );
});

test("integrity: the entry id is content-derived and deterministic (E9)", () => {
  const left = standingEntryId(tenant, subject, "iverd-0001", "suspended");
  const right = standingEntryId(tenant, subject, "iverd-0001", "suspended");
  assert.equal(left, right);
  assert.notEqual(left, standingEntryId(tenant, subject, "iverd-0001", "flagged"));
  assert.notEqual(left, standingEntryId("tenant-other", subject, "iverd-0001", "suspended"));
});

// ---------------------------------------------------------------------------
// Through the REAL rig (PL-018 service composed read-only)
// ---------------------------------------------------------------------------

const rig: SecurityRig = await createSecurityRig();

test("integrity rig: the suspended subject's rights are refused with the verdict's probabilistic evidence", () => {
  const state = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(state.ok);
  const entry = state.state.standings.find((item) => item.subject === RIG_SUSPENDED_SUBJECT);
  assert.ok(entry);
  assert.equal(entry.disposition, "suspended");
  assert.ok(entry.confidence.lower <= entry.confidence.upper);
  assert.ok(["wide", "moderate", "narrow"].includes(entry.band));

  const refusal = rig.authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_SUSPENDED_SUBJECT,
    capability: { kind: "avatar", capability: "movement", host: RIG_HOST },
  });
  assert.ok(!refusal.granted);
  assert.equal(refusal.code, "suspended-by-integrity");
  assert.ok(refusal.evidence.includes(`verdict:${entry.verdictId}`));
  assert.ok(refusal.evidence.includes(`band:${entry.band}`));
});

test("integrity rig: the clear subject's rights stay granted (a hold does not remove)", () => {
  const state = rig.authority.latticeState(RIG_AUDITOR, RIG_TENANT);
  assert.ok(state.ok);
  const entry = state.state.standings.find((item) => item.subject === RIG_CLEAN_SUBJECT);
  assert.ok(entry);
  assert.ok(!suspendsFor(entry));

  const granted = rig.authority.decide({
    tenant: RIG_TENANT,
    subject: RIG_CLEAN_SUBJECT,
    capability: { kind: "avatar", capability: "movement", host: RIG_HOST },
  });
  assert.ok(granted.granted);
});
