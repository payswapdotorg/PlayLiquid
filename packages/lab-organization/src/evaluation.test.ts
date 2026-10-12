/**
 * EVALUATION-WIRING TESTS (PL-029) — candidates compile → lab-simulation
 * evaluation requests → immutable evidence records through the REAL PL-028
 * engine: content-keyed idempotency (E10 replay), estimate labeling (E11),
 * port-refusal surfacing and record immutability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { asAgentRoleId, asCapabilityId, asEvaluationSeed, asMemoryStoreId, asOrganizationId, asReviewGateId } from "@playliquid/lab-contracts";
import { asAgentId } from "@playliquid/game-contracts";
import type { OrganizationDescriptor } from "@playliquid/lab-contracts";
import { asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import { LabSimulationService } from "@playliquid/lab-simulation";
import { createLabSimulationFakes, evidenceBundleDigestOf, labFixtureContext, labFixtureCycleId, labFixtureEvidenceRecords, labFixtureForeignMetricSuite, labFixtureGeneralistOrganization, labFixtureSuite } from "@playliquid/lab-simulation";
import { compileOrganization, evaluateThroughPort } from "./index.ts";
import type { CompileOptions } from "./compile.ts";
import type { StoredCandidateEvidence } from "./ports.ts";
import { createBodyCatalog, fixtureModelAssignment } from "./fakes.ts";
import { evaluationContentKeyOf } from "./digest.ts";

const tenant = asTenantId("tenant-evaluation")!;
const subject = asSubjectId("subject-evaluation")!;
const caller = { tenant, subject };
const evidence = labFixtureEvidenceRecords();
const evidenceBundle = {
  recordIds: evidence.map((record) => String(record.evidenceId)),
  declaredDigest: evidenceBundleDigestOf(evidence),
};

function labService(): LabSimulationService {
  const fakes = createLabSimulationFakes({ suites: [labFixtureSuite(), labFixtureForeignMetricSuite()] });
  return new LabSimulationService({ ports: fakes.ports });
}

function compiledOrganization(over: Partial<OrganizationDescriptor> = {}): ReturnType<typeof compileOrganization> {
  const lead = asAgentId("agent-eval-lead")!;
  const store = asMemoryStoreId("memory-eval")!;
  const descriptor: OrganizationDescriptor = {
    id: asOrganizationId("org-eval")!,
    agents: [{ agent: lead, roles: [asAgentRoleId("generalist")!], model: fixtureModelAssignment() }],
    capabilities: [{ capability: asCapabilityId("lab-cap-engineering")!, assignedTo: [lead] }],
    tools: [],
    topology: [],
    memory: { stores: [{ storeId: store, scope: "agent-private", owner: lead }], access: [{ store, agent: lead, mode: "read-write" }] },
    humanParticipation: { mode: "none", participants: [] },
    budget: [],
    scheduling: { mode: "event-driven" },
    review: { gates: [{ gateId: asReviewGateId("gate-eval")!, reviewers: [lead] }] },
    ...over,
  };
  const options: CompileOptions = { ports: { bodies: createBodyCatalog().port } };
  return compileOrganization(descriptor, options);
}

const input = (over: Record<string, unknown> = {}) => ({
  compiled: compiledOrganization().ok ? (compiledOrganization() as { compiled: unknown }).compiled : undefined,
  caller,
  cycleId: labFixtureCycleId(),
  context: labFixtureContext(),
  suite: labFixtureSuite().ref,
  evidence: evidenceBundle,
  parameters: { seed: asEvaluationSeed("seed-eval-1")!, tickBudget: 12 },
  port: labService(),
  known: [] as readonly StoredCandidateEvidence[],
  now: 1_000,
  ...over,
});

test("evaluation: a candidate runs through the real PL-028 engine as a labeled estimate (E11)", () => {
  const result = evaluateThroughPort(input() as never);
  assert.ok(result.ok);
  assert.equal(result.replayed, false);
  assert.equal(result.evidence.run.result.epistemic, "labeled-estimate");
  assert.equal(result.evidence.run.result.method, "simulation");
  assert.ok(result.evidence.run.replay.replayId.length > 0);
  assert.equal(String(result.evidence.tenant), String(tenant));
  assert.equal(result.evidence.tickBudget, 12);
});

test("evaluation: re-evaluating identical candidate+seed replays the recorded outcome (E10)", () => {
  const port = labService();
  const first = evaluateThroughPort({ ...input(), port } as never);
  assert.ok(first.ok);
  const second = evaluateThroughPort({ ...input(), port, known: [first.evidence] } as never);
  assert.ok(second.ok);
  assert.equal(second.replayed, true);
  assert.equal(String(second.evidence.contentKey), String(first.evidence.contentKey));
  assert.equal(String(second.evidence.evaluationId), String(first.evidence.evaluationId));
  assert.equal(second.evidence.run.replay.replayId, first.evidence.run.replay.replayId);
  assert.equal(second.evidence.recordedAt, first.evidence.recordedAt);
});

test("evaluation: the content key covers candidate, seed, budget, suite and evidence", () => {
  const base = input();
  const keyOf = (over: Record<string, unknown>) =>
    evaluationContentKeyOf({
      tenant: String(tenant),
      cycleId: String(labFixtureCycleId()),
      candidateDigest: (base.compiled as { readonly contentDigest: string }).contentDigest as never,
      suite: base.suite,
      evidenceBundleDigest: String(evidenceBundle.declaredDigest),
      seed: String(base.parameters.seed),
      tickBudget: base.parameters.tickBudget,
      context: base.context,
      ...over,
    });
  const original = keyOf({});
  assert.equal(String(keyOf({})), String(original));
  assert.notEqual(String(keyOf({ seed: "seed-eval-2" })), String(original));
  assert.notEqual(String(keyOf({ tickBudget: 24 })), String(original));
  assert.notEqual(String(keyOf({ candidateDigest: "0".repeat(64) })), String(original));
  assert.notEqual(String(keyOf({ evidenceBundleDigest: "1".repeat(64) })), String(original));
});

test("evaluation: different content keys evaluate independently through one engine", () => {
  const port = labService();
  const first = evaluateThroughPort({ ...input(), port } as never);
  const second = evaluateThroughPort({ ...input(), port, parameters: { seed: asEvaluationSeed("seed-eval-2")!, tickBudget: 12 } } as never);
  assert.ok(first.ok && second.ok);
  assert.equal(second.replayed, false);
  assert.notEqual(String(second.evidence.contentKey), String(first.evidence.contentKey));
  assert.notEqual(String(second.evidence.evaluationId), String(first.evidence.evaluationId));
});

test("evaluation: a tampered evidence digest surfaces the engine refusal (E8)", () => {
  const tampered = evaluateThroughPort({
    ...input(),
    evidence: { recordIds: evidenceBundle.recordIds, declaredDigest: "9".repeat(64) as never },
  } as never);
  assert.ok(!tampered.ok);
  assert.equal(tampered.code, "evaluation-refused");
  assert.equal(tampered.portCode, "evidence-digest-mismatch");
});

test("evaluation: an unmeasured suite metric is honestly refused (E11)", () => {
  const foreign = evaluateThroughPort({ ...input(), suite: labFixtureForeignMetricSuite().ref } as never);
  assert.ok(!foreign.ok);
  assert.equal(foreign.code, "evaluation-refused");
  assert.equal(foreign.portCode, "unmeasurable-metric");
});

test("evaluation: an invalid record time is a typed refusal (never a clock)", () => {
  for (const bad of [-1, 1.5, Number.NaN]) {
    const result = evaluateThroughPort({ ...input(), now: bad } as never);
    assert.ok(!result.ok);
    assert.equal(result.code, "invalid-request-time");
  }
});

test("evaluation: recorded evidence records are sealed (immutable, E10)", () => {
  const result = evaluateThroughPort(input() as never);
  assert.ok(result.ok);
  assert.ok(Object.isFrozen(result.evidence));
  assert.ok(Object.isFrozen(result.evidence.run));
  assert.throws(() => {
    (result.evidence as { tickBudget: number }).tickBudget = 999;
  });
  assert.equal(result.evidence.run.statistics.completedWork >= 0, true);
});

test("evaluation: the generalist baseline (lock 26) is evaluable through the engine", () => {
  const options: CompileOptions = { ports: { bodies: createBodyCatalog().port } };
  const compiled = compileOrganization(labFixtureGeneralistOrganization(), options);
  assert.ok(compiled.ok);
  const result = evaluateThroughPort({ ...input(), compiled: compiled.compiled } as never);
  assert.ok(result.ok);
  assert.equal(result.evidence.run.result.epistemic, "labeled-estimate");
});
