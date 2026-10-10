/**
 * Intake oracle tests (E1 admission, E8 refusals, E10 duplicate receipt):
 * the full admission decision table of admitLabEvaluation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { asEvaluationSeed, asTimestampMs } from "@playliquid/lab-contracts";
import { admitLabEvaluation } from "./intake.ts";
import {
  createEvidenceLedger,
  createSuiteDirectory,
  labFixtureContext,
  labFixtureEvidenceRecords,
  labFixtureSuite,
  labFixtureTeamOrganization,
} from "./fakes.ts";
import { evidenceBundleDigestOf, labEvaluationIdentityDigest } from "./digest.ts";
import type { LabEvaluationRequest } from "./records.ts";
import { MAX_TICK_BUDGET, MIN_TICK_BUDGET } from "./records.ts";

const tenant = asTenantId("tenant-intake")!;
const owner = asSubjectId("subject-requester")!;
const evidence = labFixtureEvidenceRecords();
const suite = labFixtureSuite();
const suites = createSuiteDirectory([suite]);
const ledger = createEvidenceLedger(evidence);

function request(over: Partial<LabEvaluationRequest> = {}): LabEvaluationRequest {
  return {
    tenant,
    owner,
    cycleId: evidence[0]!.cycleId,
    organization: labFixtureTeamOrganization(),
    evidence: {
      recordIds: evidence.map((record) => String(record.evidenceId)),
      declaredDigest: evidenceBundleDigestOf(evidence),
    },
    suite: suite.ref,
    context: labFixtureContext(),
    parameters: { seed: asEvaluationSeed("seed-intake")!, tickBudget: 8 },
    requestedAt: asTimestampMs(1_000)!,
    ...over,
  };
}

function admit(req: LabEvaluationRequest, known: Parameters<typeof admitLabEvaluation>[0]["known"] = []) {
  return admitLabEvaluation({
    request: req,
    ports: { suites: suites.resolver, evidence: ledger.view },
    admittedAt: 1_500,
    known,
  });
}

test("admits a well-formed evaluation and seals the content-addressed record", () => {
  const result = admit(request());
  assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.detail}`);
  const digest = labEvaluationIdentityDigest(request());
  assert.equal(String(result.record.identityDigest), String(digest));
  assert.equal(String(result.record.evaluationId), `lab-eval-${String(digest).slice(0, 54)}`);
  assert.equal(result.record.tenant, tenant);
  assert.equal(result.record.owner, owner);
  assert.deepEqual(
    result.record.evidenceRecordIds,
    evidence.map((record) => String(record.evidenceId)),
  );
  assert.equal(result.record.admittedAt, 1_500);
});

test("admission is deterministic: same content, same identity, forever", () => {
  const first = admit(request());
  const second = admit(request());
  assert.ok(first.ok && second.ok);
  assert.equal(String(first.record.identityDigest), String(second.record.identityDigest));
  assert.equal(String(first.record.evaluationId), String(second.record.evaluationId));
});

test("owner and request time are bookkeeping: identity excludes them", () => {
  const other = request({ owner: asSubjectId("subject-someone-else")!, requestedAt: asTimestampMs(2_000)! });
  assert.equal(
    String(labEvaluationIdentityDigest(other)),
    String(labEvaluationIdentityDigest(request())),
  );
});

test("seed and tick budget are identity inputs (E9)", () => {
  const otherSeed = request({ parameters: { seed: asEvaluationSeed("seed-other")!, tickBudget: 8 } });
  const otherBudget = request({ parameters: { seed: asEvaluationSeed("seed-intake")!, tickBudget: 9 } });
  assert.notEqual(String(labEvaluationIdentityDigest(otherSeed)), String(labEvaluationIdentityDigest(request())));
  assert.notEqual(String(labEvaluationIdentityDigest(otherBudget)), String(labEvaluationIdentityDigest(request())));
});

test("duplicate admission returns the E10 receipt of the first record", () => {
  const first = admit(request());
  assert.ok(first.ok);
  const duplicate = admit(request(), [first.record]);
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.code, "duplicate-evaluation");
  assert.equal(duplicate.recorded, first.record);
});

test("a malformed organization is refused", () => {
  const broken = request({ organization: { ...labFixtureTeamOrganization(), agents: [] } });
  const result = admit(broken);
  assert.ok(!result.ok);
  assert.equal(result.code, "invalid-organization");
});

test("an unknown suite pin is refused", () => {
  const result = admit(request({ suite: { ...suite.ref, contentDigest: "0".repeat(64) as never } }));
  assert.ok(!result.ok);
  assert.equal(result.code, "unknown-suite");
});

test("an unknown evidence record is refused", () => {
  const result = admit(
    request({
      evidence: {
        recordIds: ["evidence-std-1", "evidence-missing"],
        declaredDigest: evidenceBundleDigestOf(evidence),
      },
    }),
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "unknown-evidence");
});

test("a tampered declared evidence digest is refused (E8)", () => {
  const result = admit(
    request({
      evidence: {
        recordIds: evidence.map((record) => String(record.evidenceId)),
        declaredDigest: "a".repeat(64) as never,
      },
    }),
  );
  assert.ok(!result.ok);
  assert.equal(result.code, "evidence-digest-mismatch");
});

test("a swapped evidence record under an honest digest is refused (E8)", () => {
  const swapped = labFixtureEvidenceRecords(3, "swapped");
  const swappedLedger = createEvidenceLedger(swapped);
  const result = admitLabEvaluation({
    request: request({
      evidence: {
        recordIds: evidence.map((record) => String(record.evidenceId)),
        declaredDigest: evidenceBundleDigestOf(evidence),
      },
    }),
    ports: { suites: suites.resolver, evidence: swappedLedger.view },
    admittedAt: 1_500,
    known: [],
  });
  assert.ok(!result.ok);
  assert.equal(result.code, "unknown-evidence");
});

test("evidence bundle bounds are enforced", () => {
  const none = admit(request({ evidence: { recordIds: [], declaredDigest: evidenceBundleDigestOf([]) } }));
  assert.ok(!none.ok);
  assert.equal(none.code, "unknown-evidence");

  // 65 DISTINCT ids (normalizeEvidenceIds de-duplicates — duplicates alone
  // never exceed the bound); the bounds check fires before ledger resolution.
  const many: string[] = [];
  for (let index = 1; index <= 65; index += 1) {
    many.push(`evidence-std-many-${index}`);
  }
  const tooMany = admit(request({ evidence: { recordIds: many, declaredDigest: evidenceBundleDigestOf(evidence) } }));
  assert.ok(!tooMany.ok);
  assert.equal(tooMany.code, "unknown-evidence");
});

test("invalid parameters are refused (E9 seed and bounded tick budget)", () => {
  const emptySeed = admit(request({ parameters: { seed: "" as never, tickBudget: 8 } }));
  assert.ok(!emptySeed.ok);
  assert.equal(emptySeed.code, "invalid-parameters");

  const low = admit(request({ parameters: { seed: asEvaluationSeed("seed-intake")!, tickBudget: MIN_TICK_BUDGET - 1 } }));
  assert.ok(!low.ok);
  assert.equal(low.code, "invalid-parameters");

  const high = admit(request({ parameters: { seed: asEvaluationSeed("seed-intake")!, tickBudget: MAX_TICK_BUDGET + 1 } }));
  assert.ok(!high.ok);
  assert.equal(high.code, "invalid-parameters");

  const fractional = admit(request({ parameters: { seed: asEvaluationSeed("seed-intake")!, tickBudget: 7.5 } }));
  assert.ok(!fractional.ok);
  assert.equal(fractional.code, "invalid-parameters");
});

test("invalid tenant, owner, cycle and request times are refused", () => {
  const badTenant = admit(request({ tenant: "!!" as never }));
  assert.ok(!badTenant.ok);
  assert.equal(badTenant.code, "invalid-tenant");

  const badOwner = admit(request({ owner: "!!" as never }));
  assert.ok(!badOwner.ok);
  assert.equal(badOwner.code, "invalid-owner");

  const badCycle = admit(request({ cycleId: "!!" as never }));
  assert.ok(!badCycle.ok);
  assert.equal(badCycle.code, "invalid-cycle");

  const badTime = admitLabEvaluation({
    request: request(),
    ports: { suites: suites.resolver, evidence: ledger.view },
    admittedAt: Number.NaN,
    known: [],
  });
  assert.ok(!badTime.ok);
  assert.equal(badTime.code, "invalid-request-time");
});
