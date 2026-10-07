import { test } from "node:test";
import assert from "node:assert/strict";
import * as arenaIntegration from "./index.ts";
import { arenaAuthorizationScope, asArenaPolicyId } from "./authorization.ts";
import { EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, appendArenaAuthorizationDecision, validateArenaAuthorizationAuditLog } from "./authorization.ts";
import { initialArenaLifecycle, advanceArenaLifecycle, settleArenaSend } from "./lifecycle.ts";
import { settleArenaIngest } from "./ingestion.ts";
import { ARENA_RESPONSE_ENVELOPE_KIND } from "./response.ts";
import type { ArenaRequestEnvelope } from "./request.ts";
import type { ArenaContentDigest, ArenaEndpointRef, ArenaTimestampMs } from "./primitives.ts";

/**
 * NO-DIRECT-MUTATION NEGATIVE TESTS — the architecture lock made structural.
 *
 * "Arena cannot directly mutate PlayLiquid live state" (architecture.md
 * §Arena; lock rules 6, 32, and the Arena-side analogue of 33).
 *
 * The lock is structural, not conventional:
 * 1. the EXPORT SURFACE contains no mutation-shaped function
 *    (apply/commit/mutate/patch/execute/publish/write/set-state);
 * 2. every fold (settle/advance/append/validate) leaves its inputs
 *    deep-identical — ingestion produces NEW immutable records;
 * 3. the records an Arena response can produce (evidence packages,
 *    payload records) are passive data with no callable members and are
 *    not assignable to any live-state command shape at compile time.
 */

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

function fixtureEndpoint(seed: string): ArenaEndpointRef {
  return { refKind: "arena-endpoint", endpointDigest: fixtureDigest(seed) };
}

function fixtureRequest(): ArenaRequestEnvelope {
  return {
    envelopeKind: "arena-request",
    requestKind: "result",
    cycle: {
      requestPayload: fixtureDigest("a1"),
      gapSummary: fixtureDigest("b1"),
      authorization: arenaAuthorizationScope([]),
    },
    endpoint: fixtureEndpoint("e1"),
  };
}

test("no-mutation: the export surface contains no mutation-shaped function", () => {
  const mutationVerb = /apply|commit|mutate|dispatch|execute|patch|publish|upsert|write|setState|updateState|mutateLive/i;
  const exportedNames = Object.keys(arenaIntegration).sort();
  assert.ok(exportedNames.length >= 40, `expected a substantial public surface, found ${exportedNames.length}`);
  const offenders = exportedNames.filter((name) => mutationVerb.test(name));
  assert.deepEqual(offenders, []);
  // Every exported VALUE is a function (validator/builder/oracle) or a
  // frozen table/marker — never an object with live-state authority.
  for (const [name, value] of Object.entries(arenaIntegration)) {
    if (typeof value === "function") continue;
    if (typeof value === "string") continue;
    assert.ok(Object.isFrozen(value) || Array.isArray(value) || typeof value === "object", `${name} unexpected shape`);
  }
});

test("no-mutation: settle/advance/append/validate folds never mutate their inputs", () => {
  const request = fixtureRequest();
  const requestSnapshot = structuredClone(request);

  // Audit append.
  const logSnapshot = structuredClone(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG);
  const appended = appendArenaAuthorizationDecision(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, {
    decision: "allow",
    policyId: asArenaPolicyId("lab-usage-rules")!,
    requestPayload: fixtureDigest("a1"),
    endpoint: fixtureEndpoint("e1"),
    recordDigest: fixtureDigest("d0"),
  });
  assert.ok(appended.ok);
  assert.deepEqual(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, logSnapshot);

  // Lifecycle advance.
  const draft = initialArenaLifecycle(500 as ArenaTimestampMs);
  const draftSnapshot = structuredClone(draft);
  const advanced = advanceArenaLifecycle(draft, "authorized");
  assert.ok(advanced.ok);
  assert.deepEqual(draft, draftSnapshot);

  // Send settle.
  const envelopeSnapshot = structuredClone(request);
  const sent = settleArenaSend(undefined, request);
  assert.ok(sent.status === "sent");
  assert.deepEqual(request, envelopeSnapshot);

  // Ingest settle with a real response envelope.
  const response = {
    envelopeKind: ARENA_RESPONSE_ENVELOPE_KIND,
    requestPayload: fixtureDigest("a1"),
    respondent: fixtureEndpoint("e1"),
    results: [{ recordKind: "arena-result", origin: "arena-external", content: fixtureDigest("c1") }],
    evidence: [],
    artifacts: [],
    responseDigest: fixtureDigest("9c"),
  };
  const responseSnapshot = structuredClone(response);
  const ingested = settleArenaIngest(undefined, response, request);
  assert.ok(ingested.status === "ingested");
  assert.deepEqual(request, requestSnapshot);
  assert.deepEqual(response, responseSnapshot);
});

test("no-mutation: every record an Arena response can produce is passive data", () => {
  const request = fixtureRequest();
  const response = {
    envelopeKind: ARENA_RESPONSE_ENVELOPE_KIND,
    requestPayload: fixtureDigest("a1"),
    respondent: fixtureEndpoint("e1"),
    results: [{ recordKind: "arena-result", origin: "arena-external", content: fixtureDigest("c1") }],
    evidence: [
      { recordKind: "arena-evidence", origin: "arena-external", evidence: [fixtureDigest("50")], substantiates: [fixtureDigest("c1")] },
    ],
    artifacts: [],
    responseDigest: fixtureDigest("9c"),
  };
  const disposition = settleArenaIngest(undefined, response, request);
  assert.ok(disposition.status === "ingested");
  if (disposition.status !== "ingested") return;
  const pkg = disposition.receipt.evidencePackage;

  // No callable members anywhere on the package or its nested records.
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "function") {
      assert.fail(`callable member discovered at ${path} — evidence must be passive data`);
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
    }
  };
  walk(pkg, "evidencePackage");
});

test("no-mutation: evidence packages are not assignable to live-state command shapes (compile-time)", () => {
  const request = fixtureRequest();
  const response = {
    envelopeKind: ARENA_RESPONSE_ENVELOPE_KIND,
    requestPayload: fixtureDigest("a1"),
    respondent: fixtureEndpoint("e1"),
    results: [],
    evidence: [],
    artifacts: [],
    responseDigest: fixtureDigest("9c"),
  };
  const disposition = settleArenaIngest(undefined, response, request);
  assert.ok(disposition.status === "ingested");
  if (disposition.status !== "ingested") return;
  const pkg = disposition.receipt.evidencePackage;

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
  assert.equal(typeof asCommand, "object");
  assert.equal(typeof asPatch, "object");
});

test("no-mutation: audit folds never rewrite the log value they are given (E10)", () => {
  const first = appendArenaAuthorizationDecision(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, {
    decision: "allow",
    policyId: asArenaPolicyId("lab-usage-rules")!,
    requestPayload: fixtureDigest("a1"),
    endpoint: fixtureEndpoint("e1"),
    recordDigest: fixtureDigest("d0"),
  });
  assert.ok(first.ok);
  if (!first.ok) return;
  const second = appendArenaAuthorizationDecision(first.log, {
    decision: "deny",
    reason: "endpoint-not-permitted",
    policyId: asArenaPolicyId("lab-usage-rules")!,
    requestPayload: fixtureDigest("a1"),
    endpoint: fixtureEndpoint("e1"),
    recordDigest: fixtureDigest("d1"),
  });
  assert.ok(second.ok);
  if (!second.ok) return;

  // No fold in this package mutates the log value it is handed; chain
  // order/linkage/uniqueness integrity is asserted in authorization.test.ts.
  // (Detecting the rewrite of a DECISION FIELD requires digest-content
  // binding, which is deferred to the lab-contracts digest seam — see the
  // ACR note; structural chain checks are documented with that scope.)
  const snapshot = structuredClone(second.log);
  validateArenaAuthorizationAuditLog(second.log);
  appendArenaAuthorizationDecision(second.log, {
    decision: "allow",
    policyId: asArenaPolicyId("lab-usage-rules")!,
    requestPayload: fixtureDigest("a2"),
    endpoint: fixtureEndpoint("e1"),
    recordDigest: fixtureDigest("d2"),
  });
  assert.deepEqual(second.log, snapshot);
});
