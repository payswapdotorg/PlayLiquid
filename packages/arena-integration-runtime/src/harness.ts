/**
 * RUNTIME EVIDENCE HARNESS (PL-031; run: `node src/harness.ts`).
 *
 * Drives one full Arena escalation journey over the deterministic in-memory
 * fakes and prints machine-readable evidence of every work-order invariant
 * it crosses: decided-escalation intake (R18 — never auto-escalated), the
 * ACR-bridged request record, the content-addressed case (E6/E9), the
 * lifecycle drive through the transport port (one effective send), the
 * response tamper oracle (E8), ingestion-only evidence with epistemic labels
 * (E11), tenant scoping (R20), double-send idempotency, crash-resume
 * determinism (E6) and the un-decided/cross-tenant typed refusals. Exits
 * non-zero on any unexpected outcome. No IO beyond stdout; no clock, no
 * randomness, no network — the fake Arena answers from a pure responder.
 */

import { allowAllArenaPolicy, arenaAuthorizationScope, arenaAuthorizationScopeKey } from "@playliquid/arena-integration";
import type { ArenaContentDigest, ArenaTransport } from "@playliquid/arena-integration";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { arenaDecisionDigestOf } from "./digest.ts";
import { createArenaRuntimeJourney, createSteppingClock, fixtureAskDigest } from "./fakes.ts";
import { ArenaRuntimeService } from "./service.ts";

const steps: { readonly name: string; readonly actual: string }[] = [];
function record(name: string, actual: string): void {
  steps.push({ name, actual });
}

// ---------------------------------------------------------------------------
// 1. The happy journey: register -> decide -> open -> drive -> ingest -> label
// ---------------------------------------------------------------------------

const journey = createArenaRuntimeJourney({ requestKind: "artifact.skill" });
const opened = journey.service.openEscalationCase(
  journey.caller,
  journey.decidedCommand({ authorization: arenaAuthorizationScope(["skill"]) }),
);
if (!opened.ok) throw new Error(`harness: case opening refused: ${opened.detail}`);
record("intake-decided-escalation-opens-case", `caseId=${String(opened.case.caseId)}`);
record("intake-acr-bridged-request", `escalationId=${String(opened.case.request.escalationId)}`);

const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
if (!driven.ok) throw new Error(`harness: drive refused: ${driven.detail}`);
if (driven.outcome.status !== "ingested") throw new Error(`harness: expected ingested, got ${driven.outcome.status}`);
record("drive-lifecycle", driven.outcome.case.lifecycle.history.map((step) => step.to).join("->"));
record("drive-one-effective-send", String(journey.arena.sentEnvelopes().length));
record("ingest-evidence-package", `${driven.outcome.evidencePackage.verdict} results=${driven.outcome.evidencePackage.results.length} evidence=${driven.outcome.evidencePackage.evidence.length} artifacts=${driven.outcome.evidencePackage.artifacts.length}`);

const labels = journey.service.labeledEvidence(journey.caller, String(opened.case.caseId));
if (!labels.ok) throw new Error("harness: labeling refused");
record("epistemic-labels-e11", labels.labels.map((label) => label.externalClass).join(","));
const allExternal = labels.labels.every((label) => label.epistemic === "arena-external" && label.provenance.origin === "arena-external");
if (!allExternal) throw new Error("harness: a label lost its arena-external provenance");
record("epistemic-provenance-travels", "all-arena-external");

// ---------------------------------------------------------------------------
// 2. Double-send idempotency: re-drives of a terminal case never re-send
// ---------------------------------------------------------------------------

const reDrive = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
if (!reDrive.ok || reDrive.outcome.status !== "terminal") throw new Error("harness: re-drive should be terminal");
record("double-send-idempotency", `status=${reDrive.outcome.status} wire=${journey.arena.sentEnvelopes().length}`);

// ---------------------------------------------------------------------------
// 3. The un-decided escalation refusal (R18): the runtime never auto-escalates
// ---------------------------------------------------------------------------

const unDecided = journey.service.openEscalationCase(journey.caller, {
  ...journey.decidedCommand({ requestPayload: fixtureAskDigest("harness-undecided") }),
  decisionDigest: fixtureAskDigest("not-the-decision"),
});
record("un-decided-refusal-r18", unDecided.ok ? "opened" : unDecided.code);
if (unDecided.ok) throw new Error("harness: an un-decided escalation opened a case");

// ---------------------------------------------------------------------------
// 4. Cross-tenant refusal (R20)
// ---------------------------------------------------------------------------

const foreign = { tenant: asTenantId("tenant-foreign")!, subject: asSubjectId("operator-foreign")! };
const foreignRead = journey.service.getCase(foreign, String(opened.case.caseId));
record("cross-tenant-refusal-r20", foreignRead.ok ? "read" : foreignRead.code);
if (foreignRead.ok) throw new Error("harness: a foreign tenant read another tenant's case");

// ---------------------------------------------------------------------------
// 5. The tampered response digest refusal (E8): nothing is ingested
// ---------------------------------------------------------------------------

const tampering: ArenaTransport = {
  portKind: "arena-transport",
  async send(envelope) {
    const result = await journey.arena.send(envelope);
    if (!result.ok) return result;
    return { ok: true, response: { ...result.response, responseDigest: `sha256:${"0".repeat(64)}` as ArenaContentDigest } };
  },
};
const hostileService = new ArenaRuntimeService({
  ports: { clock: createSteppingClock(200_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: tampering },
});
if (!hostileService.restore().ok) throw new Error("harness: hostile service failed to restore");
const hostileOpened = hostileService.openEscalationCase(journey.caller, journey.decidedCommand({ requestPayload: fixtureAskDigest("harness-hostile"), requestKind: "result" }));
if (!hostileOpened.ok) throw new Error(`harness: hostile case refused: ${hostileOpened.detail}`);
const hostileDriven = await hostileService.driveCase(journey.caller, String(hostileOpened.case.caseId));
record("tampered-response-refusal-e8", hostileDriven.ok ? hostileDriven.outcome.status : hostileDriven.code);
if (!hostileDriven.ok || hostileDriven.outcome.status !== "tampered-response-digest") {
  throw new Error("harness: a tampered response was not refused");
}
if (hostileDriven.ok && (hostileDriven.outcome.case.evidencePackage !== undefined || hostileDriven.outcome.case.ingestReceipt !== undefined)) {
  throw new Error("harness: something from the tampered response was ingested");
}

// ---------------------------------------------------------------------------
// 6. Crash-resume determinism (E6): a fresh service over the same store
// ---------------------------------------------------------------------------

const resumed = new ArenaRuntimeService({
  ports: { clock: createSteppingClock(300_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: journey.arena },
});
const restore = resumed.restore();
record("resume-after-crash-e6", restore.ok ? `cases=${restore.cases} sources=${restore.sources}` : restore.code);
if (!restore.ok) throw new Error("harness: restore refused");
const resumedRead = resumed.getCase(journey.caller, String(opened.case.caseId));
record("resume-same-case-id", resumedRead.ok ? String(resumedRead.case.caseId) : resumedRead.code);
if (!resumedRead.ok || String(resumedRead.case.caseId) !== String(opened.case.caseId)) {
  throw new Error("harness: the resumed case identity diverged");
}
const secondJourney = createArenaRuntimeJourney({ requestKind: "artifact.skill" });
const secondOpened = secondJourney.service.openEscalationCase(secondJourney.caller, secondJourney.decidedCommand({ authorization: arenaAuthorizationScope(["skill"]) }));
record("determinism-e9-same-content-same-case", secondOpened.ok ? String(secondOpened.case.caseId) : secondOpened.code);
if (!secondOpened.ok || String(secondOpened.case.caseId) !== String(opened.case.caseId)) {
  throw new Error("harness: identical decided content produced a different case");
}

// ---------------------------------------------------------------------------
// 7. The intake decision pin: the runtime's own digest oracle recomputes the
//    host decision, and a forged digest never opens a case.
// ---------------------------------------------------------------------------

const command = journey.decidedCommand({ requestPayload: fixtureAskDigest("harness-reopen"), requestKind: "result" });
const recomputed = arenaDecisionDigestOf({
  tenant: String(journey.caller.tenant),
  decidedBy: String(command.decidedBy),
  decidedAt: command.decidedAt,
  sourceKey: String(command.sourceKey),
  requestKind: command.requestKind,
  requestPayload: String(command.requestPayload),
  endpointDigest: String(command.endpoint.endpointDigest),
  authorizationKey: arenaAuthorizationScopeKey(command.authorization),
});
if (recomputed !== command.decisionDigest) throw new Error("harness: the decision digest oracle diverged from the journey fixture");
const reopen = journey.service.openEscalationCase(journey.caller, command);
record("decision-digest-verifies", reopen.ok ? (reopen.duplicate ? "duplicate" : "opened") : reopen.code);
if (!reopen.ok) throw new Error(`harness: a verifying decision was refused: ${reopen.detail}`);
const withForgedDigest = journey.service.openEscalationCase(journey.caller, { ...command, decisionDigest: fixtureAskDigest("forged") });
record("forged-decision-refused", withForgedDigest.ok ? "opened" : withForgedDigest.code);
if (withForgedDigest.ok) throw new Error("harness: a forged decision digest opened a case");

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

for (const step of steps) {
  console.log(`[${step.name}] ${step.actual}`);
}
console.log("harness: OK — Arena runtime journey composed end-to-end, ingestion-only, tenant-scoped, resumable.");
