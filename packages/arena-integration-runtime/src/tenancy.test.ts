import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaAuthorizationScopeKey } from "@playliquid/arena-integration";
import { arenaDecisionDigestOf } from "../src/digest.ts";
import {
  createArenaRuntimeJourney,
  fixtureAskDigest,
  fixtureWalkedGapRecord,
} from "../src/fakes.ts";
import type { ArenaRuntimeJourney } from "../src/fakes.ts";
import { asTimestampMs } from "@playliquid/lab-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { TenantId } from "@playliquid/platform-contracts";
import type { ArenaEscalationCommand } from "../src/records.ts";

/**
 * TENANCY TESTS (PL-031, R20) — tenant isolation of the whole runtime
 * surface: registration is caller-tenant-scoped, intake resolves sources
 * only from the caller's registry view, and every read/drive of a case
 * checks platform-contracts' isolation oracle (cross-tenant access is a
 * typed refusal, E8 — never silent, never an error).
 */

const tenantA = asTenantId("tenant-alpha")!;
const tenantB = asTenantId("tenant-beta")!;
const operatorA = asSubjectId("operator-a")!;
const operatorB = asSubjectId("operator-b")!;

/** A second tenant's caller sharing tenant A's journey (separate registry view). */
function foreignCaller() {
  return { tenant: tenantB, subject: operatorB };
}

/** A decided command for a given tenant citing a given source key. */
function decidedCommandFor(tenant: TenantId, sourceKey: string, requestPayloadSeed: string): ArenaEscalationCommand {
  const journey: ArenaRuntimeJourney = createArenaRuntimeJourney();
  const requestPayload = fixtureAskDigest(requestPayloadSeed);
  const decidedAt = asTimestampMs(12_000)!;
  const requestKind = "result" as const;
  const endpoint = journey.endpoint;
  const authorization = { scopeKind: "arena-authorization-scope" as const, artifactClasses: [] as never[] };
  return {
    decidedBy: operatorA,
    decidedAt,
    decisionDigest: arenaDecisionDigestOf({
      tenant: String(tenant),
      decidedBy: String(operatorA),
      decidedAt,
      sourceKey,
      requestKind,
      requestPayload: String(requestPayload),
      endpointDigest: String(endpoint.endpointDigest),
      authorizationKey: arenaAuthorizationScopeKey(authorization),
    }),
    sourceKey: sourceKey as ArenaEscalationCommand["sourceKey"],
    requestKind,
    requestPayload,
    endpoint,
    authorization,
  };
}

test("tenancy: sources are filed under the CALLER's tenant only — a foreign tenant cannot see or cite them", () => {
  const journey = createArenaRuntimeJourney();
  const callerA = { tenant: tenantA, subject: operatorA };
  // The journey registered a gap-finding source for tenant A.
  const mine = journey.service.listSources(callerA);
  assert.equal(mine.length, 1);
  // A foreign tenant's listing is scoped to its own (empty) registry.
  const foreign = foreignCaller();
  assert.equal(journey.service.listSources(foreign).length, 0);
  // The foreign tenant citing A's source key gets the unknown-source
  // refusal — the registry view is structurally tenant-scoped (R20).
  const refused = journey.service.openEscalationCase(foreign, decidedCommandFor(tenantB, journey.gapSourceKey, "foreign-ask"));
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "unknown-source");
    assert.match(refused.detail, /tenant/);
  }
  // The same command from A's own caller opens the case fine.
  const opened = journey.service.openEscalationCase(callerA, decidedCommandFor(tenantA, journey.gapSourceKey, "foreign-ask"));
  assert.ok(opened.ok);
});

test("tenancy: an identical source registered by two tenants is TWO registry entries (content includes the tenant)", () => {
  const journey = createArenaRuntimeJourney();
  const callerA = { tenant: tenantA, subject: operatorA };
  const foreign = foreignCaller();
  const record = fixtureWalkedGapRecord("shared");
  const first = journey.service.registerSource(callerA, { kind: "gap-record", record });
  const second = journey.service.registerSource(foreign, { kind: "gap-record", record });
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.notEqual(String(first.source.sourceKey), String(second.source.sourceKey), "the source digest is tenant-scoped");
  assert.equal(journey.service.listSources(callerA).length, 2);
  assert.equal(journey.service.listSources(foreign).length, 1);
});

test("tenancy: CROSS-TENANT case reads are typed refusals (R20/E8)", async () => {
  const journey = createArenaRuntimeJourney();
  const callerA = { tenant: tenantA, subject: operatorA };
  const opened = journey.service.openEscalationCase(callerA, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const caseId = String(opened.case.caseId);
  const foreign = foreignCaller();
  const read = journey.service.getCase(foreign, caseId);
  assert.equal(read.ok, false);
  if (!read.ok) {
    assert.equal(read.code, "cross-tenant");
    assert.match(read.detail, /R20/);
  }
  // Drive.
  const driven = await journey.service.driveCase(foreign, caseId);
  assert.equal(driven.ok, false);
  if (!driven.ok) assert.equal(driven.code, "cross-tenant");
  // Epistemic labeling.
  const labels = journey.service.labeledEvidence(foreign, caseId);
  assert.equal(labels.ok, false);
  if (!labels.ok) assert.equal(labels.code, "cross-tenant");
  // The owning tenant still reads it fine.
  assert.ok(journey.service.getCase(callerA, caseId).ok);
});

test("tenancy: listCases is scoped to the caller's tenant", () => {
  const journey = createArenaRuntimeJourney();
  const callerA = { tenant: tenantA, subject: operatorA };
  const foreign = foreignCaller();
  const opened = journey.service.openEscalationCase(callerA, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const foreignOpened = journey.service.openEscalationCase(foreign, journey.decidedCommand({
    decidedBy: operatorB,
    requestPayload: fixtureAskDigest("foreign-own-ask"),
  }));
  // The foreign caller's command fails the decision gate (it was decided
  // for tenant A's content); a genuine foreign case needs its own registered
  // source. Register one and decide properly.
  const record = fixtureWalkedGapRecord("foreign-tenant");
  const registered = journey.service.registerSource(foreign, { kind: "gap-record", record });
  assert.ok(registered.ok);
  if (!registered.ok) return;
  const foreignCase = journey.service.openEscalationCase(foreign, decidedCommandFor(tenantB, String(registered.source.sourceKey), "foreign-own-ask"));
  assert.ok(foreignCase.ok && !foreignOpened.ok);
  assert.equal(journey.service.listCases(callerA).length, 1);
  assert.equal(journey.service.listCases(foreign).length, 1);
  assert.notEqual(String(journey.service.listCases(callerA)[0]?.caseId), String(journey.service.listCases(foreign)[0]?.caseId));
});

test("tenancy: tenant-scoped documents restore without cross-tenant leakage", () => {
  const journey = createArenaRuntimeJourney();
  const callerA = { tenant: tenantA, subject: operatorA };
  const foreign = foreignCaller();
  const openedA = journey.service.openEscalationCase(callerA, journey.decidedCommand());
  assert.ok(openedA.ok);
  const record = fixtureWalkedGapRecord("foreign-tenant-2");
  const registered = journey.service.registerSource(foreign, { kind: "gap-record", record });
  assert.ok(registered.ok);
  if (!registered.ok) return;
  const openedB = journey.service.openEscalationCase(foreign, decidedCommandFor(tenantB, String(registered.source.sourceKey), "foreign-own-ask-2"));
  assert.ok(openedB.ok);
  // The persisted document carries both tenants' state; listings stay scoped.
  const document = journey.service.document();
  assert.equal(document.cases.length, 2);
  assert.equal(document.sources.length, 2);
  assert.equal(journey.service.listCases(callerA).every((entry) => entry.tenant === tenantA), true);
  assert.equal(journey.service.listSources(foreign).every((entry) => entry.tenant === tenantB), true);
});
