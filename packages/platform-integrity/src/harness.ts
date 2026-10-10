/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives one full competitive-integrity journey over the in-memory
 * fakes. Every step — happy AND negative — is recorded with an expected
 * and an actual outcome:
 *
 *  1. R11: claimed-human + human-like trace → consistent (evidence path)
 *  2. R11/E8: claimed-human + machine-like trace → pronounced deviation
 *  3. AI modes: declared autonomous-AI + machine-like trace → consistent
 *     (the declaration recalibrates evaluation; it is not a bypass)
 *  4. AI modes/E8: declared autonomous-AI + human-like trace → deviation
 *     (declaration/behavior mismatch surfaced as evidence)
 *  5. E11: proven re-execution divergence joins the signals → pronounced
 *  6. E10: re-submission of the same content → duplicate-evaluation +
 *     the recorded receipt (no second mutation)
 *  7. R20/E8: cross-tenant submission → tenant-mismatch
 *  8. E8: forged (mutated) command-stream artifact → stream-form-mismatch
 *  9. E8: misattributed re-execution verdict → observed-against mismatch
 * 10. E10: snapshot + fresh service (SHARED store) + restore → verdicts
 *     re-enter liveness
 * 11. R10 seam: the reward-integrity adapter HONESTLY WITHHOLDS the
 *     wide-band standing (an 8-command verdict spans too wide to
 *     summarize as one scalar), then — after a 60-command evaluation
 *     narrows the interval to a moderate band — surfaces the reading
 *
 * Prints deterministic machine-readable JSON and exits non-zero on any
 * unexpected outcome. No IO beyond stdout; no clock (fixed fake), no
 * randomness, no network.
 */

import { IntegrityService } from "./service.ts";
import {
  createFixedClock,
  createMemoryGrantDirectory,
  createMemoryIntegrityStore,
  divergenceObservation,
  humanLikeTrace,
  integrityAdminGrant,
  integritySubmitGrant,
  machineLikeTrace,
  matchObservation,
  demoOperator,
  demoSubject,
  demoTenant,
} from "./fakes.ts";
import { createRewardIntegrityAdapter } from "./adapter.ts";
import { asSubjectId, asTenantId, asTimestampMs } from "@playliquid/platform-contracts";

const tenantA = demoTenant;
const tenantB = asTenantId("tenant-beta")!;
const admin = demoOperator;
const operator = asSubjectId("oper-demo-operator")!;
const subject = demoSubject;

function makeService(shared?: ReturnType<typeof createMemoryIntegrityStore>) {
  const grants = createMemoryGrantDirectory();
  grants.grant(integrityAdminGrant(tenantA, admin));
  grants.grant(integritySubmitGrant(tenantA, operator));
  const store = shared ?? createMemoryIntegrityStore();
  const clock = createFixedClock();
  const service = new IntegrityService({ store: store.store, clock: clock.clock, grants: grants.grantsDirectory });
  return { grants, store, clock, service };
}

const steps: { readonly name: string; readonly expected: string; readonly actual: string }[] = [];
function record(name: string, expected: string, actual: string): void {
  steps.push({ name, expected, actual });
}

const { service, store } = makeService();

// 1. R11: human claim + human-like behavior → consistent.
const humanTrace = humanLikeTrace();
const honest = service.submitEvaluation(operator, {
  tenant: tenantA,
  subject,
  source: { replayId: "replay-demo-human", commandStream: humanTrace },
  claim: { claimKind: "unbacked", mode: "human" },
  capturedAt: asTimestampMs(1_000)!,
});
record(
  "honest-human-evaluation",
  "accepted:consistent-with-declared-mode",
  honest.accepted ? `accepted:${honest.verdict.kind}` : `refused:${honest.code}`,
);

// 2. R11/E8: human claim + machine-like behavior → pronounced deviation.
const botTrace = machineLikeTrace();
const botClaimedHuman = service.submitEvaluation(operator, {
  tenant: tenantA,
  subject,
  source: { replayId: "replay-demo-bot", commandStream: botTrace },
  claim: { claimKind: "unbacked", mode: "human" },
  capturedAt: asTimestampMs(1_100)!,
});
record(
  "machine-like-under-human-claim",
  "accepted:pronounced-deviation-observed",
  botClaimedHuman.accepted ? `accepted:${botClaimedHuman.verdict.kind}` : `refused:${botClaimedHuman.code}`,
);

// 3. AI modes: declared autonomous AI + machine-like behavior → consistent.
const declaredAi = service.submitEvaluation(operator, {
  tenant: tenantA,
  subject,
  source: { replayId: "replay-demo-bot", commandStream: botTrace },
  claim: {
    claimKind: "declared",
    declaration: {
      declarationKind: "participation.declared-ai",
      tenant: tenantA,
      subject,
      declaredAt: asTimestampMs(900)!,
      operator,
    },
  },
  capturedAt: asTimestampMs(1_200)!,
});
record(
  "machine-like-under-declared-ai",
  "accepted:consistent-with-declared-mode",
  declaredAi.accepted ? `accepted:${declaredAi.verdict.kind}` : `refused:${declaredAi.code}`,
);

// 4. AI modes/E8: declared autonomous AI + human-like behavior → deviation.
const aiMismatch = service.submitEvaluation(operator, {
  tenant: tenantA,
  subject,
  source: { replayId: "replay-demo-human", commandStream: humanTrace },
  claim: {
    claimKind: "declared",
    declaration: {
      declarationKind: "participation.declared-ai",
      tenant: tenantA,
      subject,
      declaredAt: asTimestampMs(900)!,
      operator,
    },
  },
  capturedAt: asTimestampMs(1_300)!,
});
record(
  "human-like-under-declared-ai",
  "accepted:deviation-observed",
  aiMismatch.accepted ? `accepted:${aiMismatch.verdict.kind}` : `refused:${aiMismatch.code}`,
);

// 5. E11: proven divergence joins the signals → pronounced deviation.
const divergent = service.submitEvaluation(operator, {
  tenant: tenantA,
  subject,
  source: { replayId: "replay-demo-divergent", commandStream: botTrace },
  reexecution: divergenceObservation(botTrace.streamDigest),
  claim: { claimKind: "unbacked", mode: "human" },
  capturedAt: asTimestampMs(1_400)!,
});
record(
  "proven-divergence-joins-signals",
  "accepted:pronounced-deviation-observed",
  divergent.accepted ? `accepted:${divergent.verdict.kind}` : `refused:${divergent.code}`,
);

// 6. E10: same content again → duplicate + recorded receipt, no mutation.
const replay = service.submitEvaluation(operator, {
  tenant: tenantA,
  subject,
  source: { replayId: "replay-demo-human", commandStream: humanTrace },
  claim: { claimKind: "unbacked", mode: "human" },
  capturedAt: asTimestampMs(1_000)!,
});
record(
  "duplicate-evaluation-idempotent",
  "refused:duplicate-evaluation+receipt",
  !replay.accepted && replay.recorded !== undefined
    ? `refused:${replay.code}+receipt`
    : replay.accepted
      ? `accepted:unexpected-second-mutation`
      : `refused:${replay.code}+no-receipt`,
);

// 7. R20/E8: cross-tenant submission → tenant-mismatch.
const crossTenant = service.submitEvaluation(operator, {
  tenant: tenantB,
  subject,
  source: { replayId: "replay-demo-human", commandStream: humanTrace },
  claim: { claimKind: "unbacked", mode: "human" },
  capturedAt: asTimestampMs(1_500)!,
});
record(
  "cross-tenant-submission-refused",
  "refused:tenant-mismatch",
  crossTenant.accepted ? "accepted:unexpected" : `refused:${crossTenant.code}`,
);

// 8. E8: forged (mutated) command stream → form mismatch.
const forgedEntries = botTrace.entries.map((entry, index) =>
  index === botTrace.entries.length - 1 ? { ...entry, dueTick: 99 } : entry,
);
const forged = service.submitEvaluation(operator, {
  tenant: tenantA,
  subject,
  source: {
    replayId: "replay-demo-forged",
    commandStream: { streamDigest: botTrace.streamDigest, form: botTrace.form, entries: forgedEntries },
  },
  claim: { claimKind: "unbacked", mode: "human" },
  capturedAt: asTimestampMs(1_600)!,
});
record(
  "forged-stream-refused",
  "refused:stream-form-mismatch",
  forged.accepted ? "accepted:unexpected" : `refused:${forged.code}`,
);

// 9. E8: misattributed re-execution verdict → observed-against mismatch.
const misattributed = service.submitEvaluation(operator, {
  tenant: tenantA,
  subject,
  source: { replayId: "replay-demo-human", commandStream: humanTrace },
  reexecution: matchObservation(botTrace.streamDigest),
  claim: { claimKind: "unbacked", mode: "human" },
  capturedAt: asTimestampMs(1_700)!,
});
record(
  "misattributed-reexecution-refused",
  "refused:reexecution-observed-against-mismatch",
  misattributed.accepted ? "accepted:unexpected" : `refused:${misattributed.code}`,
);

// 10. E10: snapshot → fresh service → restore → the history re-enters.
const snapshot = service.snapshot(admin, tenantA);
const expectedStanding = divergent.accepted ? divergent.verdict.kind : "";
const restored = snapshot.ok
  ? (() => {
      const second = makeService(store);
      const outcome = second.service.restore(admin, tenantA, snapshot.snapshotId);
      const standing = second.service.standingFor(admin, tenantA, subject);
      const restoredKind = !outcome.ok
        ? `refused:${outcome.code}`
        : !standing.ok
          ? `refused:${standing.code}`
          : standing.verdict.kind;
      return { ok: restoredKind === expectedStanding, detail: `restored:${restoredKind}` };
    })()
  : { ok: false, detail: `refused:${snapshot.code}` };
record(
  "snapshot-restore-roundtrip",
  `restored:${expectedStanding}`,
  restored.detail,
);

// 11. R10 seam: the adapter honestly withholds a wide-band standing, then
//     surfaces the reading once a larger evidence base narrows the band.
const adapter = createRewardIntegrityAdapter({ service, reader: admin });
const query = {
  tenant: tenantA,
  subject,
  eventKind: "game.round.completed" as never,
  sourceEventDigest: "a".repeat(64) as never,
  outcomeEvidence: "b".repeat(64) as never,
};
// The standing at this point is the step-5 verdict: an 8-command
// divergence whose aggregate interval spans ~0.41 — too wide to honestly
// summarize as one scalar. The port returns undefined (truthful
// no-evidence-usable), NOT a fabricated point estimate.
const withheld = adapter.confidenceFor(query);
// A 60-command trace: the honest sampling margin shrinks with evidence,
// so the same divergence lands in a MODERATE band and becomes readable.
const largeTrace = machineLikeTrace(60);
const largeEval = service.submitEvaluation(operator, {
  tenant: tenantA,
  subject,
  source: { replayId: "replay-demo-large-divergent", commandStream: largeTrace },
  reexecution: divergenceObservation(largeTrace.streamDigest),
  claim: { claimKind: "unbacked", mode: "human" },
  capturedAt: asTimestampMs(1_800)!,
});
const reading = adapter.confidenceFor(query);
const adapterOutcome =
  withheld === undefined && reading !== undefined && typeof reading.confidence === "number"
    ? "withheld-then-reading-with-confidence"
    : `withheld:${withheld === undefined ? "yes" : "no"};reading:${reading === undefined ? "none" : typeof reading.confidence}`;
record(
  "reward-integrity-adapter-reading",
  "withheld-then-reading-with-confidence",
  adapterOutcome,
);
record(
  "large-evidence-narrows-band",
  "accepted:pronounced-deviation-observed:moderate",
  largeEval.accepted
    ? `accepted:${largeEval.verdict.kind}:${largeEval.verdict.band}`
    : `refused:${largeEval.code}`,
);

const failures = steps.filter((item) => item.expected !== item.actual);
console.log(
  JSON.stringify({ harness: "platform-integrity", ok: failures.length === 0, steps, failures }, null, 2),
);
if (failures.length > 0) process.exitCode = 1;
