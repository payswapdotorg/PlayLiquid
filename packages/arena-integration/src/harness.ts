/**
 * PL-007 HARNESS — an end-to-end composition sanity check over the whole
 * contract surface, runnable with `pnpm harness` (node src/harness.ts).
 *
 * Walks one escalation through every layer:
 * policy decision → audit append → lifecycle advance → send through the
 * in-memory fake transport → response validation → ingestion → evidence
 * package, then prints the resulting records. The harness is NOT a
 * substitute for the colocated tests; it is a human-readable demonstration
 * that the contracts compose exactly as architecture.md §Arena describes.
 *
 * The harness performs no IO beyond stdout and uses only fixture digests
 * (fragment-assembled, never secret-shaped).
 */

import { asArenaPolicyId } from "./authorization.ts";
import { appendArenaAuthorizationDecision, arenaAuthorizationScope, EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG } from "./authorization.ts";
import { checkArenaRequestEnvelopeCoherence } from "./request.ts";
import type { ArenaRequestEnvelope } from "./request.ts";
import { advanceArenaLifecycle, initialArenaLifecycle, settleArenaSend } from "./lifecycle.ts";
import { inMemoryArenaTransport } from "./transport.ts";
import { settleArenaIngest } from "./ingestion.ts";
import type { ArenaContentDigest, ArenaEndpointRef, ArenaTimestampMs } from "./primitives.ts";

function fixtureDigest(seed: string): ArenaContentDigest {
  const hex = (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
  return `sha256:${hex}` as ArenaContentDigest;
}

const endpoint: ArenaEndpointRef = { refKind: "arena-endpoint", endpointDigest: fixtureDigest("e1") };

// 1. Draft the wire request envelope (artifact.skill escalation).
const envelope: ArenaRequestEnvelope = {
  envelopeKind: "arena-request",
  requestKind: "artifact.skill" as const,
  cycle: {
    requestPayload: fixtureDigest("a1"),
    gapSummary: fixtureDigest("b1"),
    authorization: arenaAuthorizationScope(["skill"]),
  },
  endpoint,
};
const coherence = checkArenaRequestEnvelopeCoherence(envelope);
console.log("[1] request envelope coherence:", coherence);

// 2. Policy decision (Lab usage rules: deterministic fake).
const policy = {
  policyId: asArenaPolicyId("lab-usage-rules")!,
  decide: (candidate: typeof envelope) =>
    candidate.requestKind === "artifact.skill" ? { allowed: true } : { allowed: false as const, reason: "request-kind-not-permitted" as const },
};
const decision = policy.decide(envelope);
console.log("[2] policy decision:", decision);

// 3. Audit-track the authorization decision.
const audit = appendArenaAuthorizationDecision(EMPTY_ARENA_AUTHORIZATION_AUDIT_LOG, {
  decision: decision.allowed ? "allow" : "deny",
  policyId: policy.policyId,
  requestPayload: envelope.cycle.requestPayload,
  endpoint,
  recordDigest: fixtureDigest("d0"),
});
if (!audit.ok) throw new Error(`audit append refused: ${audit.reason}`);
console.log("[3] audit record seq", audit.record.seq, "decision", audit.record.decision);

// 4. Lifecycle: draft → authorized, then send (idempotency oracle).
const draft = initialArenaLifecycle(9_000 as ArenaTimestampMs);
const authorized = advanceArenaLifecycle(draft, "authorized", 1_000 as ArenaTimestampMs);
if (!authorized.ok) throw new Error("authorize advance refused");
const send = settleArenaSend(undefined, envelope);
if (send.status !== "sent") throw new Error(`send refused: ${send.status}`);
const replay = settleArenaSend(send.receipt, envelope);
const sent = advanceArenaLifecycle(authorized.record, "sent", 2_000 as ArenaTimestampMs);
if (!sent.ok) throw new Error("send advance refused");
console.log("[4] send:", send.status, "| replay:", replay.status);

// 5. Transport: send through the in-memory fake, get a response envelope.
const responseEnvelope = {
  envelopeKind: "arena-response" as const,
  requestPayload: envelope.cycle.requestPayload,
  respondent: endpoint,
  results: [{ recordKind: "arena-result" as const, origin: "arena-external" as const, content: fixtureDigest("c1") }],
  evidence: [
    { recordKind: "arena-evidence" as const, origin: "arena-external" as const, evidence: [fixtureDigest("50")], substantiates: [fixtureDigest("c1")] },
  ],
  artifacts: [{ recordKind: "arena-artifact" as const, origin: "arena-external" as const, artifactClass: "skill" as const, artifact: fixtureDigest("7a") }],
  responseDigest: fixtureDigest("9c"),
};
const transport = inMemoryArenaTransport({ endpoint, respond: () => ({ ok: true, response: responseEnvelope }) });
const transportResult = await transport.send(envelope);
if (!transportResult.ok) throw new Error(`transport error: ${transportResult.error.errorKind}`);
console.log("[5] transport:", transportResult.ok ? "response received" : "error", "| sent count:", transport.sentEnvelopes().length);

// 6. Responded → ingested via the pure ingest oracle.
const responded = advanceArenaLifecycle(sent.record, "responded", 3_000 as ArenaTimestampMs);
if (!responded.ok) throw new Error("respond advance refused");
const ingest = settleArenaIngest(undefined, transportResult.response, envelope, 4_000 as ArenaTimestampMs);
if (ingest.status !== "ingested") throw new Error(`ingest refused: ${ingest.status}`);
const ingested = advanceArenaLifecycle(responded.record, "ingested", 4_000 as ArenaTimestampMs);
if (!ingested.ok) throw new Error("ingest advance refused");

// 7. The Lab consumes the evidence package through its normal evidence path.
const pkg = ingest.receipt.evidencePackage;
console.log("[6] lifecycle:", ingested.record.state, "| history:", ingested.record.history.map((t) => `${t.from}->${t.to}`).join(" "));
console.log("[7] evidence package:", pkg.verdict, "| results:", pkg.results.length, "| evidence:", pkg.evidence.length, "| artifacts:", pkg.artifacts.length);
console.log("harness: OK — Arena escalation composed end-to-end, ingestion-only.");
