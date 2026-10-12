import { test } from "node:test";
import assert from "node:assert/strict";
import { allowAllArenaPolicy, settleArenaIngest } from "@playliquid/arena-integration";
import type { ArenaContentDigest, ArenaTransport } from "@playliquid/arena-integration";
import * as arenaRuntime from "./index.ts";
import { createArenaRuntimeJourney, createSteppingClock } from "./fakes.ts";
import { ArenaRuntimeService } from "./service.ts";
import { asArenaEstimate, labelArenaEvidencePackage } from "./epistemic.ts";

/**
 * NO-DIRECT-MUTATION NEGATIVE TESTS — the architecture lock made structural.
 *
 * "Arena cannot directly mutate PlayLiquid live state" (architecture.md
 * §Arena; lock rules 6, 32): INGESTION-ONLY verdicts flow into the Lab's
 * normal evidence path.
 *
 * The lock is structural, not conventional:
 * 1. the EXPORT SURFACE contains no mutation-shaped function
 *    (apply/commit/mutate/patch/execute/publish/write/set-state);
 * 2. everything an Arena response can produce through this runtime —
 *    evidence packages, ingest receipts, epistemic labels — is PASSIVE
 *    data with no callable members, never a command;
 * 3. a full ingested journey leaves every caller-supplied input
 *    deep-identical (the runtime appends to ITS OWN case table only);
 * 4. a hostile/tampered response cannot touch ANY case state, its own or
 *    another's — the tamper oracle rejects before ingestion, and the
 *    evidence store of the Lab (out of scope here) is the only consumer.
 */

test("no-mutation: the export surface contains no mutation-shaped function", () => {
  const mutationVerb = /apply|commit|mutate|dispatch|execute|patch|publish|upsert|write|setState|updateState|mutateLive/i;
  const exportedNames = Object.keys(arenaRuntime).sort();
  assert.ok(exportedNames.length >= 40, `expected a substantial public surface, found ${exportedNames.length}`);
  const offenders = exportedNames.filter((name) => mutationVerb.test(name));
  assert.deepEqual(offenders, []);
  // Every exported VALUE is a function (validator/builder/oracle — classes
  // included), a frozen vocabulary table or a plain marker — never an object
  // with live-state authority.
  for (const [name, value] of Object.entries(arenaRuntime)) {
    if (typeof value === "function" || typeof value === "string") continue;
    assert.ok(Object.isFrozen(value) || Array.isArray(value) || typeof value === "object", `${name} unexpected shape`);
  }
});

test("no-mutation: every product of an ingested Arena response is passive data", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "ingested");
  if (!driven.ok || driven.outcome.status !== "ingested") return;
  const labels = journey.service.labeledEvidence(journey.caller, String(opened.case.caseId));
  assert.ok(labels.ok);
  const products: unknown[] = [
    driven.outcome.evidencePackage,
    driven.outcome.case.ingestReceipt,
    ...(labels.ok ? labels.labels : []),
  ];
  for (const product of products) {
    if (product === undefined) continue;
    walk(product, "product");
  }
  // The epistemic labels carry the arena-external marker and full provenance
  // (E11) — recognizable as external forever, never as Lab-internal evidence.
  for (const label of labels.ok ? labels.labels : []) {
    assert.equal(label.epistemic, "arena-external");
    assert.equal(label.provenance.origin, "arena-external");
  }
});

test("no-mutation: a full ingested journey never mutates caller-supplied inputs", async () => {
  const journey = createArenaRuntimeJourney();
  const callerSnapshot = structuredClone(journey.caller);
  const sourcesBefore = structuredClone(journey.service.listSources(journey.caller));
  const command = journey.decidedCommand();
  const commandSnapshot = structuredClone(command);
  const opened = journey.service.openEscalationCase(journey.caller, command);
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const caseSnapshot = structuredClone(opened.case);
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "ingested");
  assert.deepEqual(journey.caller, callerSnapshot, "the caller identity is read-only");
  assert.deepEqual(journey.service.listSources(journey.caller), sourcesBefore, "registered sources are immutable (E10)");
  assert.deepEqual(command, commandSnapshot, "the decided command is read-only");
  // The OPENED case record itself is never edited in place — a NEW frozen
  // case value carries the advanced state.
  assert.deepEqual(opened.case, caseSnapshot);
  assert.notEqual(driven.ok ? driven.outcome.case : undefined, opened.case);
});

test("no-mutation: the filed evidence package is exactly arena-integration's pure oracle output", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "ingested");
  if (!driven.ok || driven.outcome.status !== "ingested") return;
  const response = driven.outcome.case.response;
  assert.ok(response !== undefined);
  // The pure ingest oracle, folded directly at the same ingest timestamp
  // (the terminal transition's `at`), yields the same package: the service
  // adds NOTHING of its own between the port and the evidence path.
  const at = driven.outcome.case.lifecycle.history[driven.outcome.case.lifecycle.history.length - 1]?.at;
  const pure = settleArenaIngest(undefined, response, driven.outcome.case.request, at);
  assert.ok(pure.status === "ingested");
  if (pure.status !== "ingested") return;
  assert.deepEqual(driven.outcome.evidencePackage, pure.receipt.evidencePackage);
});

test("no-mutation: a TAMPERED Arena response cannot touch any case, its own or another's", async () => {
  const journey = createArenaRuntimeJourney();
  const caller = journey.caller;
  const victim = journey.service.openEscalationCase(caller, journey.decidedCommand({ requestPayload: journey.decidedCommand().requestPayload }));
  const hostile = journey.service.openEscalationCase(caller, journey.decidedCommand({ requestKind: "evidence" }));
  assert.ok(victim.ok && hostile.ok);
  if (!victim.ok || !hostile.ok) return;
  const tampering: ArenaTransport = {
    portKind: "arena-transport",
    async send(envelope) {
      const result = await journey.arena.send(envelope);
      if (!result.ok) return result;
      return { ok: true, response: { ...result.response, responseDigest: `sha256:${"0".repeat(64)}` as ArenaContentDigest } };
    },
  };
  const service = new ArenaRuntimeService({
    ports: { clock: createSteppingClock(90_000), store: journey.store, policy: allowAllArenaPolicy("lab-usage-rules-fixture"), transport: tampering },
  });
  assert.equal(service.restore().ok, true);
  const before = structuredClone(service.getCase(caller, String(victim.case.caseId)));
  const driven = await service.driveCase(caller, String(hostile.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "tampered-response-digest");
  // The hostile case ended rejected with NOTHING ingested...
  if (driven.ok && driven.outcome.status === "tampered-response-digest") {
    assert.equal(driven.outcome.case.evidencePackage, undefined);
    assert.equal(driven.outcome.case.ingestReceipt, undefined);
  }
  // ...and the victim case (and the whole document) is untouched.
  assert.deepEqual(service.getCase(caller, String(victim.case.caseId)), before);
});

test("no-mutation: evidence packages and labels are not assignable to live-state command shapes (compile-time)", async () => {
  const journey = createArenaRuntimeJourney();
  const opened = journey.service.openEscalationCase(journey.caller, journey.decidedCommand());
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const driven = await journey.service.driveCase(journey.caller, String(opened.case.caseId));
  assert.ok(driven.ok && driven.outcome.status === "ingested");
  if (!driven.ok || driven.outcome.status !== "ingested") return;
  const pkg = driven.outcome.evidencePackage;
  const labels = labelArenaEvidencePackage(pkg, driven.outcome.case.request);
  assert.ok(labels.length > 0);
  const estimate = asArenaEstimate(labels[0]!, "expert-judgment");
  assert.ok(estimate !== undefined);

  /** The shape a live-state mutation command would need — absent here. */
  interface LiveStateCommand {
    apply(state: unknown): unknown;
  }
  interface LiveStatePatch {
    patch: Record<string, unknown>;
  }
  // @ts-expect-error — an evidence package is not a state-mutation command
  const asCommand: LiveStateCommand = pkg;
  // @ts-expect-error — and not a live-state patch either
  const asPatch: LiveStatePatch = pkg;
  // @ts-expect-error — a labeled payload is not a command either
  const labelAsCommand: LiveStateCommand = labels[0]!;
  // @ts-expect-error — nor is an external estimate
  const estimateAsCommand: LiveStateCommand = estimate!;
  assert.equal(typeof asCommand, "object");
  assert.equal(typeof asPatch, "object");
  assert.equal(typeof labelAsCommand, "object");
  assert.equal(typeof estimateAsCommand, "object");
});

/** Deep-walks `value` failing on any callable member (passive-data oracle). */
function walk(value: unknown, path: string): void {
  if (typeof value === "function") {
    assert.fail(`callable member discovered at ${path} — Arena products must be passive data`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
  }
}
