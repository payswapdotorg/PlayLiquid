import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowAllArenaPolicy,
  arenaAuthorizationScope,
  denyAllArenaPolicy,
} from "@playliquid/arena-integration";
import type { ArenaContentDigest, ArenaTransport } from "@playliquid/arena-integration";
import { asTimestampMs } from "@playliquid/lab-contracts";
import { arenaResponseDigestOf } from "../src/digest.ts";
import {
  createArenaRuntimeJourney,
  createSteppingClock,
} from "../src/fakes.ts";
import { ArenaRuntimeService } from "../src/service.ts";

/**
 * ORCHESTRATION TESTS (PL-031, E6/E8/E9) — the lifecycle drive: arena-
 * integration's own state machine, driven through the transport port, with
 * the send ledger, the response tamper oracle, honest intermediate states,
 * terminal immutability and crash-resume determinism.
 */

test("orchestration: one drive walks draft→authorized→sent→responded→ingested and files admitted evidence", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok);
  if (!driven.ok) return;
  assert.equal(driven.outcome.status, "ingested");
  if (driven.outcome.status !== "ingested") return;
  assert.equal(driven.outcome.case.lifecycle.state, "ingested");
  assert.deepEqual(
    driven.outcome.case.lifecycle.history.map((step) => step.to),
    ["authorized", "sent", "responded", "ingested"],
  );
  assert.equal(driven.outcome.evidencePackage.verdict, "admitted");
  assert.ok(driven.outcome.evidencePackage.results.length >= 1);
  assert.equal(journey.arena.sentEnvelopes().length, 1);
});

test("orchestration: DOUBLE-SEND idempotency — a re-run of a sent case does not re-send", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const first = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(first.ok && first.outcome.status === "ingested");
  for (let index = 0; index < 3; index += 1) {
    const again = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
    assert.ok(again.ok);
    if (again.ok) assert.equal(again.outcome.status, "terminal");
  }
  assert.equal(journey.arena.sentEnvelopes().length, 1, "the wire saw exactly one envelope");
  assert.equal(journey.store.load()?.sendLedger.length, 1, "exactly one effective send receipt");
});

test("orchestration: a second case over the same send key is refused (duplicate-send / send-collision)", async () => {
  const journey = createArenaRuntimeJourney({ requestKind: "artifact.skill" });
  const command = journey.decidedCommand({ authorization: arenaAuthorizationScope(["skill"]) });
  const first = journey.service.openEscalationCase(journey.caller, command);
  assert.ok(first.ok);
  if (!first.ok) return;
  // Same ask + endpoint, but a different request kind: a DIFFERENT envelope
  // under the SAME send key → send-collision (E8: refused, never a second
  // effective send).
  const conflicting = journey.service.openEscalationCase(journey.caller, journey.decidedCommand({
    requestKind: "artifact.knowledge",
    authorization: arenaAuthorizationScope(["knowledge"]),
  }));
  assert.ok(conflicting.ok);
  if (!conflicting.ok) return;
  const firstDrive = await journey.service.driveCase(journey.caller, String(first.case.caseId));
  assert.ok(firstDrive.ok && firstDrive.outcome.status === "ingested");
  const secondDrive = await journey.service.driveCase(journey.caller, String(conflicting.case.caseId));
  assert.ok(secondDrive.ok === false);
  if (!secondDrive.ok) {
    assert.equal(secondDrive.code, "send-collision");
    assert.match(secondDrive.detail, /E8/);
  }
  assert.equal(journey.arena.sentEnvelopes().length, 1);
});

test("orchestration: POLICY DENIAL ends the case rejected with an audit-tracked decision", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  // Rebuild the service with a deny-all policy over the same store.
  const denying = new ArenaRuntimeService({
    ports: {
      clock: createSteppingClock(20_000),
      store: journey.store,
      policy: denyAllArenaPolicy("lab-usage-rules-deny", "request-kind-not-permitted"),
      transport: journey.arena,
    },
  });
  assert.equal(denying.restore().ok, true);
  const driven = await denying.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok);
  if (!driven.ok) return;
  assert.equal(driven.outcome.status, "policy-denied");
  if (driven.outcome.status !== "policy-denied") return;
  assert.equal(driven.outcome.reason, "request-kind-not-permitted");
  assert.equal(driven.outcome.case.lifecycle.state, "rejected");
  assert.equal(journey.arena.sentEnvelopes().length, 0, "a denied escalation never crosses the wire");
  // Terminal: re-drives are honest no-ops.
  const again = await denying.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(again.ok);
  if (again.ok) assert.equal(again.outcome.status, "terminal");
});

test("orchestration: a TRANSPORT ERROR leaves the case durably sent and resumable", async () => {
  const journey = createArenaRuntimeJourney();
  const endpoint = journey.endpoint;
  let attempts = 0;
  const flaky: ArenaTransport = {
    portKind: "arena-transport",
    async send(envelope) {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false, error: { errorKind: "arena-unreachable", endpoint } };
      }
      return journey.arena.send(envelope);
    },
  };
  const service = new ArenaRuntimeService({
    ports: {
      clock: createSteppingClock(30_000),
      store: journey.store,
      policy: allowAllArenaPolicy("lab-usage-rules-fixture"),
      transport: flaky,
    },
  });
  assert.equal(service.restore().ok, true);
  const opened = service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const first = await service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.outcome.status, "transport-error");
  if (first.outcome.status !== "transport-error") return;
  assert.equal(first.outcome.errorKind, "arena-unreachable");
  assert.equal(first.outcome.case.lifecycle.state, "sent", "durable intermediate state (E6)");
  assert.equal(first.outcome.case.sendReceipt !== undefined, true);
  // The retry re-submits the SAME envelope; the Arena side dedupes by
  // content key — one EFFECTIVE send, two wire attempts.
  const second = await service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(second.ok && second.outcome.status === "ingested");
  assert.equal(attempts, 2);
  assert.equal(journey.arena.sentEnvelopes().length, 1, "the deterministic fake answers the same content key");
});

test("orchestration: a non-envelope transport payload is an honest protocol violation, the case stays sent", async () => {
  const journey = createArenaRuntimeJourney();
  const garbage: ArenaTransport = {
    portKind: "arena-transport",
    async send() {
      return { ok: true, response: "not-an-envelope" as never };
    },
  };
  const service = new ArenaRuntimeService({
    ports: { clock: createSteppingClock(30_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: garbage },
  });
  assert.equal(service.restore().ok, true);
  const opened = service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok);
  if (!driven.ok) return;
  assert.equal(driven.outcome.status, "transport-error");
  if (driven.outcome.status !== "transport-error") return;
  assert.equal(driven.outcome.errorKind, "arena-protocol-violation");
  assert.equal(driven.outcome.case.lifecycle.state, "sent", "sent→rejected does not exist; the send receipt stands (E6)");
});

test("orchestration: EXPIRY — a case past its caller-owned deadline expires, never ingests", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand({ expiresAt: asTimestampMs(13_000)! }));
  assert.ok(opened.ok);
  if (!opened.ok) return;
  // A service whose clock is past the deadline.
  const late = new ArenaRuntimeService({
    ports: { clock: { now: () => 50_000 }, store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: journey.arena },
  });
  assert.equal(late.restore().ok, true);
  const driven = await late.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok);
  if (!driven.ok) return;
  assert.equal(driven.outcome.status, "expired");
  if (driven.outcome.status === "expired") assert.equal(driven.outcome.case.lifecycle.state, "expired");
  assert.equal(journey.arena.sentEnvelopes().length, 0);
});

test("orchestration: an artifact-kind escalation ingests authorized artifacts end-to-end", async () => {
  const journey = createArenaRuntimeJourney({ requestKind: "artifact.skill" });
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand({ authorization: arenaAuthorizationScope(["skill"]) }));
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "ingested");
  if (!driven.ok || driven.outcome.status !== "ingested") return;
  assert.equal(driven.outcome.evidencePackage.artifacts.length, 1);
  assert.equal(driven.outcome.evidencePackage.artifacts[0]?.artifactClass, "skill");
});

test("orchestration: an unknown case id is a typed refusal", async () => {
  const journey = createArenaRuntimeJourney();
  const unknown = await journey.service.driveCase(journey.caller, "arena-case-doesnotexist");
  assert.ok(unknown.ok === false);
  if (!unknown.ok) assert.equal(unknown.code, "unknown-case");
});

test("orchestration: TAMPERED RESPONSE DIGEST — the case ends rejected, nothing is ingested (E8)", async () => {
  const journey = createArenaRuntimeJourney();
  // A hostile Arena: answers with a well-formed envelope whose declared
  // digest does NOT pin its content.
  const tampering: ArenaTransport = {
    portKind: "arena-transport",
    async send(envelope) {
      const result = await journey.arena.send(envelope);
      if (!result.ok) return result;
      return { ok: true, response: { ...result.response, responseDigest: `sha256:${"0".repeat(64)}` as ArenaContentDigest } };
    },
  };
  const service = new ArenaRuntimeService({
    ports: { clock: createSteppingClock(40_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: tampering },
  });
  assert.equal(service.restore().ok, true);
  const opened = service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok);
  if (!driven.ok) return;
  assert.equal(driven.outcome.status, "tampered-response-digest");
  if (driven.outcome.status !== "tampered-response-digest") return;
  assert.equal(driven.outcome.case.lifecycle.state, "rejected", "the tamper oracle ends the case rejected");
  assert.equal(driven.outcome.case.evidencePackage, undefined, "nothing from the tampered response is ingested");
  assert.equal(driven.outcome.case.ingestReceipt, undefined);
  assert.deepEqual(
    driven.outcome.case.lifecycle.history.map((step) => `${step.from}->${step.to}`),
    ["draft->authorized", "authorized->sent", "sent->responded", "responded->rejected"],
  );
  // Terminal: a re-drive is an honest no-op, never a re-send.
  const again = await service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(again.ok && again.outcome.status === "terminal");
});

test("orchestration: RESPONSE-VALIDATION FAILURE — the rejected-verdict evidence package is filed (E10)", async () => {
  const journey = createArenaRuntimeJourney();
  // A misbehaving Arena: claims a different respondent than the endpoint
  // the request targeted (arena-integration's validator refuses it).
  const imposter = { refKind: "arena-endpoint" as const, endpointDigest: `sha256:${"e".repeat(64)}` as ArenaContentDigest };
  const misleading: ArenaTransport = {
    portKind: "arena-transport",
    async send(envelope) {
      const result = await journey.arena.send(envelope);
      if (!result.ok) return result;
      const base = result.response;
      const content = {
        envelopeKind: base.envelopeKind,
        requestPayload: base.requestPayload,
        respondent: imposter,
        results: base.results,
        evidence: base.evidence,
        artifacts: base.artifacts,
      };
      // Digest-correct over the lying content: the tamper oracle PASSES and
      // the validator must be the one to refuse.
      return { ok: true, response: { ...content, responseDigest: arenaResponseDigestOf(content) } };
    },
  };
  const service = new ArenaRuntimeService({
    ports: { clock: createSteppingClock(50_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: misleading },
  });
  assert.equal(service.restore().ok, true);
  const opened = service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok);
  if (!driven.ok) return;
  assert.equal(driven.outcome.status, "response-rejected");
  if (driven.outcome.status !== "response-rejected") return;
  assert.deepEqual(driven.outcome.reasons, ["respondent-mismatch"]);
  assert.equal(driven.outcome.case.lifecycle.state, "rejected");
  const pkg = driven.outcome.case.evidencePackage;
  assert.ok(pkg !== undefined && pkg.verdict === "rejected", "a refusal is evidence (E10)");
  if (pkg !== undefined && pkg.verdict === "rejected") {
    assert.deepEqual(pkg.reasons, ["respondent-mismatch"]);
    assert.equal(pkg.results.length, 0, "a rejected package carries no payload data");
  }
});

test("orchestration: RESUME-AFTER-CRASH — a fresh service over the same store resumes deterministically (E6)", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  // Simulate a crash after the send became durable: the store already holds
  // the sent case; a NEW service instance (new process) restores it.
  const crashAfterSend: ArenaTransport = {
    portKind: "arena-transport",
    async send(envelope) {
      const result = await journey.arena.send(envelope);
      return result.ok
        ? { ok: false, error: { errorKind: "arena-timeout", endpoint: journey.endpoint } }
        : { ok: false, error: { errorKind: "arena-unreachable", endpoint: journey.endpoint } };
    },
  };
  const crashed = new ArenaRuntimeService({
    ports: { clock: createSteppingClock(60_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: crashAfterSend },
  });
  assert.equal(crashed.restore().ok, true, "the crashed process restores the persisted case table");
  const first = await crashed.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(first.ok && first.outcome.status === "transport-error");
  const resumed = new ArenaRuntimeService({
    ports: { clock: createSteppingClock(70_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: journey.arena },
  });
  const restore = resumed.restore();
  assert.ok(restore.ok);
  if (restore.ok) assert.equal(restore.cases, 1);
  const second = await resumed.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(second.ok && second.outcome.status === "ingested");
  if (!second.ok || second.outcome.status !== "ingested") return;
  assert.equal(String(second.outcome.case.caseId), String(opened.case.caseId), "the SAME case resumes");
  // The crash window (request delivered, response lost) makes the resume
  // re-submit the SAME envelope — the Arena side dedupes by content key, so
  // there is still exactly ONE effective send (one receipt in the ledger).
  const wire = journey.arena.sentEnvelopes();
  assert.equal(wire.length, 2, "the retry crossed the wire once more");
  assert.deepEqual(wire[0], wire[1], "the retry re-submitted the SAME envelope");
  assert.equal(journey.store.load()?.sendLedger.length, 1, "one EFFECTIVE send receipt stands (E6)");
  assert.equal(journey.store.load()?.cases.length, 1);
});

test("orchestration: the response digest pin is deterministic across the whole journey (E9)", async () => {
  const first = createArenaRuntimeJourney();
  const second = createArenaRuntimeJourney();
  const a = first.service.openEscalationCase(first.caller, first.decidedCommand());
  const b = second.service.openEscalationCase(second.caller, second.decidedCommand());
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(String(a.case.caseId), String(b.case.caseId), "same decided content, same case identity");
  assert.equal(String(a.case.caseDigest), String(b.case.caseDigest));
  const da = await first.service.driveCase(first.caller, String(a.case.caseId));
  const db = await second.service.driveCase(second.caller, String(b.case.caseId));
  assert.ok(da.ok && db.ok);
  if (!da.ok || !db.ok) return;
  if (da.outcome.status !== "ingested" || db.outcome.status !== "ingested") assert.fail("both journeys should ingest");
  assert.equal(String(da.outcome.evidencePackage.responseDigest), String(db.outcome.evidencePackage.responseDigest));
  const labelsA = first.service.labeledEvidence(first.caller, String(a.case.caseId));
  const labelsB = second.service.labeledEvidence(second.caller, String(b.case.caseId));
  assert.ok(labelsA.ok && labelsB.ok);
  if (labelsA.ok && labelsB.ok) {
    assert.deepEqual(labelsA.labels, labelsB.labels, "epistemic labels are content-derived (E9)");
  }
});

test("orchestration: restore refuses a tampered persisted document (E8)", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "ingested");
  // Tamper with the last snapshot: mutate the persisted case content without
  // re-addressing the document.
  const snapshots = journey.store.snapshots();
  const last = snapshots[snapshots.length - 1]!;
  const tamperedCase = { ...last.cases[0]!, sourceKey: "arena-src-tampered" as never };
  journey.store.save({
    ...last,
    cases: [tamperedCase, ...last.cases.slice(1)],
  });
  const foreign = new ArenaRuntimeService({
    ports: { clock: createSteppingClock(80_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: journey.arena },
  });
  const restore = foreign.restore();
  assert.equal(restore.ok, false);
  if (!restore.ok) assert.equal(restore.code, "tampered-document");
});
