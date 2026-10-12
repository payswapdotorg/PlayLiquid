import { test } from "node:test";
import assert from "node:assert/strict";
import { allowAllArenaPolicy, arenaAuthorizationScope } from "@playliquid/arena-integration";
import type { ArenaTransport } from "@playliquid/arena-integration";
import { epistemicClassOf } from "@playliquid/lab-contracts";
import { arenaResponseDigestOf } from "../src/digest.ts";
import { createArenaRuntimeJourney, createSteppingClock } from "../src/fakes.ts";
import { ArenaRuntimeService } from "../src/service.ts";
import { asArenaEstimate, isArenaEstimate, isArenaLabeledPayload, labelArenaEvidencePackage } from "../src/epistemic.ts";

/**
 * EPISTEMIC LABELING TESTS (PL-031, E11) — the labeling fold over ingested
 * Arena content: every payload carries the arena-external marker, its
 * external class and full provenance; the estimate re-label is one-way; and
 * an Arena record can NEVER silently present as Lab-internal evidence
 * (lab-contracts' honesty oracle classifies it "unlabeled").
 */

test("epistemic: an admitted package labels all three declared classes with full provenance", async () => {
  const journey = createArenaRuntimeJourney({ requestKind: "artifact.skill" });
  const opened = journey.service.openEscalationCase(
    journey.caller,
    journey.decidedCommand({ authorization: arenaAuthorizationScope(["skill"]) }),
  );
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "ingested");
  if (!driven.ok || driven.outcome.status !== "ingested") return;
  const labels = labelArenaEvidencePackage(driven.outcome.evidencePackage, driven.outcome.case.request);
  const classes = labels.map((label) => label.externalClass);
  assert.deepEqual(classes, ["external-validated-result", "external-evidence", "external-authorized-artifact"]);
  for (const label of labels) {
    assert.ok(isArenaLabeledPayload(label));
    assert.equal(label.epistemic, "arena-external");
    assert.equal(label.provenance.origin, "arena-external");
    assert.equal(label.provenance.respondent.endpointDigest, journey.endpoint.endpointDigest);
    assert.equal(String(label.provenance.requestPayload), String(driven.outcome.case.request.cycle.requestPayload));
    assert.equal(typeof label.provenance.authorizationKey, "string");
    assert.equal(label.estimateMethod, undefined, "only estimates carry a method");
  }
});

test("epistemic: a rejected-verdict package labels to the empty list", async () => {
  const journey = createArenaRuntimeJourney();
  const labels = journey.service.labeledEvidence(journey.caller, "no-such-case");
  // Unknown case is a typed refusal, not silent emptiness.
  assert.equal(labels.ok, false);
  // An admitted case with NO evidence package yet labels empty (total).
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const empty = journey.service.labeledEvidence(journey.caller, String(opened.case.caseId));
  assert.ok(empty.ok);
  if (empty.ok) assert.deepEqual(empty.labels, []);
});

test("epistemic: the estimate re-label is one-way and method-pinned", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "ingested");
  if (!driven.ok || driven.outcome.status !== "ingested") return;
  const [result] = labelArenaEvidencePackage(driven.outcome.evidencePackage, driven.outcome.case.request);
  assert.ok(result !== undefined && result.externalClass === "external-validated-result");
  const estimate = asArenaEstimate(result!, "expert-judgment");
  assert.ok(estimate !== undefined);
  if (estimate === undefined) return;
  assert.equal(estimate.externalClass, "external-estimate");
  assert.equal(estimate.estimateMethod, "expert-judgment");
  assert.ok(isArenaEstimate(estimate));
  assert.equal(isArenaEstimate(result!), false, "a validated result is not an estimate");
  // Relabeling an estimate again refuses — the label never compounds.
  assert.equal(asArenaEstimate(estimate, "expert-judgment"), undefined);
  // The marker never changes: even an external estimate stays arena-external.
  assert.equal(estimate.epistemic, "arena-external");
});

test("epistemic: an Arena record NEVER classifies as Lab-internal evidence (structural disjointness, E11)", async () => {
  const journey = createArenaRuntimeJourney({ requestKind: "artifact.skill" });
  const opened = journey.service.openEscalationCase(
    journey.caller,
    journey.decidedCommand({ authorization: arenaAuthorizationScope(["skill"]) }),
  );
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "ingested");
  if (!driven.ok || driven.outcome.status !== "ingested") return;
  const labels = labelArenaEvidencePackage(driven.outcome.evidencePackage, driven.outcome.case.request);
  const estimate = asArenaEstimate(labels[0]!, "expert-judgment");
  assert.ok(estimate !== undefined);
  // lab-contracts' honesty oracle: Lab-internal classes are "observation"
  // (observed-evidence) and "estimate" (labeled-estimate). Every Arena
  // product — validated results, evidence, artifacts AND external estimates
  // — classifies "unlabeled": the arena-external marker is disjoint from
  // both Lab-internal markers, so nothing from Arena can silently present
  // as either (negative-tested).
  for (const label of [...labels, estimate!]) {
    assert.equal(epistemicClassOf(label), "unlabeled");
  }
  assert.equal(epistemicClassOf(driven.outcome.evidencePackage), "unlabeled");
  // And the Arena evidence package itself carries no internal marker.
  assert.notEqual((driven.outcome.evidencePackage as { epistemic?: string }).epistemic, "observed-evidence");
  assert.notEqual((driven.outcome.evidencePackage as { epistemic?: string }).epistemic, "labeled-estimate");
});

test("epistemic: an artifact outside the request scope is never labeled (defense in depth)", async () => {
  const journey = createArenaRuntimeJourney({ requestKind: "artifact.skill" });
  // The case authorizes skill artifacts; a hostile Arena returns a
  // KNOWLEDGE artifact instead (digest-correct, structurally valid).
  const smuggler: ArenaTransport = {
    portKind: "arena-transport",
    async send(envelope) {
      const result = await journey.arena.send(envelope);
      if (!result.ok) return result;
      const base = result.response;
      const content = {
        envelopeKind: base.envelopeKind,
        requestPayload: base.requestPayload,
        respondent: base.respondent,
        results: base.results,
        evidence: base.evidence,
        artifacts: [
          {
            recordKind: "arena-artifact" as const,
            origin: "arena-external" as const,
            artifactClass: "knowledge" as const,
            artifact: base.artifacts[0]?.artifact ?? base.results[0]!.content,
          },
        ],
      };
      return { ok: true, response: { ...content, responseDigest: arenaResponseDigestOf(content) } };
    },
  };
  const service = new ArenaRuntimeService({
    ports: { clock: createSteppingClock(120_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: smuggler },
  });
  assert.equal(service.restore().ok, true);
  const opened = service.openEscalationCase(
    journey.caller,
    journey.decidedCommand({ authorization: arenaAuthorizationScope(["skill"]) }),
  );
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok);
  if (!driven.ok) return;
  // arena-integration's validator refuses the smuggled artifact: the package
  // is the rejected verdict and labels to the empty list.
  assert.equal(driven.outcome.status, "response-rejected");
  if (driven.outcome.status !== "response-rejected") return;
  assert.deepEqual(driven.outcome.reasons, ["artifact-not-authorized"]);
  const pkg = driven.outcome.case.evidencePackage;
  assert.ok(pkg !== undefined);
  const labels = labelArenaEvidencePackage(pkg, driven.outcome.case.request);
  assert.equal(labels.length, 0, "a rejected package labels to nothing");
});
