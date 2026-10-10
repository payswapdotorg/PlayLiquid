/**
 * TENANCY TESTS — least-privilege and tenant isolation (PL-018; R20/E8).
 *
 * Cross-tenant probing is refused with the contracts oracle's own
 * codes (`tenant-mismatch` — auditable cross-tenant capability probing),
 * ungranted subjects are refused with `capability-not-granted`, and
 * every read door is tenant-scoped: a report/verdict/evidence record of
 * tenant A is invisible to a tenant-B reader even when both tenants
 * exist in one service instance.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { IntegrityService } from "./service.ts";
import {
  createFixedClock,
  createMemoryGrantDirectory,
  createMemoryIntegrityStore,
  humanLikeTrace,
  integrityAdminGrant,
  integritySubmitGrant,
  demoOperator,
  demoSubject,
  demoTenant,
} from "./fakes.ts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";

const tenantA = demoTenant;
const tenantB = asTenantId("tenant-beta")!;
const adminA = demoOperator;
const operatorA = asSubjectId("oper-demo-operator")!;
const subject = demoSubject;
const outsider = asSubjectId("oper-outsider")!;

function makeService() {
  const grants = createMemoryGrantDirectory();
  grants.grant(integrityAdminGrant(tenantA, adminA));
  grants.grant(integritySubmitGrant(tenantA, operatorA));
  grants.grant(integrityAdminGrant(tenantB, asSubjectId("oper-beta-admin")!));
  return {
    grants,
    service: new IntegrityService({
      store: createMemoryIntegrityStore().store,
      clock: createFixedClock().clock,
      grants: grants.grantsDirectory,
    }),
  };
}

function request(tenant: typeof tenantA) {
  return {
    tenant,
    subject,
    source: { replayId: `replay-demo-${String(tenant)}`, commandStream: humanLikeTrace() },
    claim: { claimKind: "unbacked", mode: "human" as const },
    capturedAt: 1_000,
  } as Parameters<IntegrityService["submitEvaluation"]>[1];
}

test("tenancy: a tenant-A operator cannot submit evaluations for tenant B", () => {
  const { service } = makeService();
  const cross = service.submitEvaluation(operatorA, request(tenantB));
  assert.ok(!cross.accepted);
  assert.equal(cross.code, "tenant-mismatch");
});

test("tenancy: an ungranted subject cannot submit at all", () => {
  const { service } = makeService();
  const refused = service.submitEvaluation(outsider, request(tenantA));
  assert.ok(!refused.accepted);
  assert.equal(refused.code, "capability-not-granted");
});

test("tenancy: a read-only grant cannot submit", () => {
  const { grants, service } = makeService();
  grants.grant({
    tenant: tenantA,
    subject: outsider,
    capability: "integrity",
    permissions: ["read"],
  });
  const refused = service.submitEvaluation(outsider, request(tenantA));
  assert.ok(!refused.accepted);
  assert.equal(refused.code, "permission-not-granted");
});

test("tenancy: an admin grant can submit and administer but tenant-B reads stay invisible", () => {
  const { service } = makeService();
  const accepted = service.submitEvaluation(operatorA, request(tenantA));
  assert.ok(accepted.accepted);
  const betaAdmin = asSubjectId("oper-beta-admin")!;
  const report = service.readReport(betaAdmin, tenantB, accepted.receipt.reportId);
  assert.ok(!report.ok);
  assert.equal(report.code, "report-not-found");
  const verdict = service.readVerdict(betaAdmin, tenantB, accepted.receipt.verdictId);
  assert.ok(!verdict.ok);
  assert.equal(verdict.code, "verdict-not-found");
  const evidence = service.readEvidence(betaAdmin, tenantB, accepted.receipt.evidenceIds[0]!);
  assert.ok(!evidence.ok);
  assert.equal(evidence.code, "evidence-not-found");
  const history = service.history(betaAdmin, tenantB);
  assert.ok(history.ok);
  assert.equal(history.receipts.length, 0);
});

test("tenancy: the same report id is readable by the owning tenant", () => {
  const { service } = makeService();
  const accepted = service.submitEvaluation(operatorA, request(tenantA));
  assert.ok(accepted.accepted);
  const report = service.readReport(adminA, tenantA, accepted.receipt.reportId);
  assert.ok(report.ok);
  assert.equal(report.report.reportId, accepted.receipt.reportId);
});

test("tenancy: snapshot/restore require the administer permission", () => {
  const { grants, service } = makeService();
  const submitterOnly = service.snapshot(operatorA, tenantA);
  assert.ok(!submitterOnly.ok);
  assert.equal(submitterOnly.code, "permission-not-granted");
  const granted = service.snapshot(adminA, tenantA);
  assert.ok(granted.ok);
  const restored = service.restore(outsider, tenantA, granted.snapshotId);
  assert.ok(!restored.ok);
  assert.equal(restored.code, "capability-not-granted");
  const ok = service.restore(adminA, tenantA, granted.snapshotId);
  assert.ok(ok.ok);
  grants.revokeAll();
});
