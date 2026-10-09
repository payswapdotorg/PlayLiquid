/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives the full PL-026 capability-broker story on the demo game:
 * 1. GameIR policy derivation (restrictions from the avatar binding,
 *    rule-coverage validation);
 * 2. grant admission incl. the R5/R20 denial and approval-required paths;
 * 3. broker evaluation: granted requests become broker-mediated canonical
 *    commands; every frozen denial reason fires; budgets gate replays;
 * 4. determinism: two independently constructed brokers driven by the same
 *    sequence produce identical resolutions, command ids and ledger bytes.
 *
 * Prints machine-readable JSON; exits non-zero on any unexpected outcome.
 * No IO beyond stdout; no clock reads (ManualBrokerClock); no randomness.
 */

import { asIntentId, asIntentKind, asSessionEpoch, asTick, asTimestamp } from "@playliquid/runtime-contracts";
import { CapabilityBroker } from "./broker.ts";
import { ManualBrokerClock, actionRequest, grantId, makeGrant } from "./fakes.ts";
import { deriveBrokerPolicy } from "./policy.ts";
import {
  DEMO_ACTOR,
  DEMO_MANIPULATION_CAPABILITY,
  DEMO_MOVEMENT_CAPABILITY,
  DEMO_SENSORY_OUTPUT_CAPABILITY,
  DEMO_SESSION,
  assertDemoDocumentValid,
  demoCoverage,
  demoGameDocument,
} from "./demo.ts";

interface Evidence {
  readonly policyDerived: boolean;
  readonly deniedCapabilities: readonly string[];
  readonly approvalRequired: readonly string[];
  readonly grantsAdmitted: number;
  readonly sensoryOutputGrantRefused: boolean;
  readonly manipulationWithoutApprovalRefused: boolean;
  readonly grantedCommands: readonly string[];
  readonly denialReasonsFired: readonly string[];
  readonly budgetReplayDenied: boolean;
  readonly deterministicReplay: boolean;
}

function buildBroker(): CapabilityBroker {
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) {
    throw new Error(`policy derivation failed: ${derived.detail}`);
  }
  return new CapabilityBroker({ policy: derived.policy, clock: new ManualBrokerClock(100) });
}

function main(): Evidence {
  assertDemoDocumentValid();
  const broker = buildBroker();
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error("unreachable: derivation re-verified");

  // --- Grant admission (host side; avatar agents have no route here) ---
  broker.admit({
    grant: makeGrant({
      grantId: grantId("demo-move"),
      holder: DEMO_ACTOR,
      capability: DEMO_MOVEMENT_CAPABILITY,
      scope: { sessionId: DEMO_SESSION },
      constraints: [{ kind: "total-count", max: 2 }],
    }),
  });
  const sensoryRefused = broker.admit({
    grant: makeGrant({
      grantId: grantId("demo-signal"),
      holder: DEMO_ACTOR,
      capability: DEMO_SENSORY_OUTPUT_CAPABILITY,
      scope: { sessionId: DEMO_SESSION },
    }),
  });
  const manipulationRefused = broker.admit({
    grant: makeGrant({
      grantId: grantId("demo-grasp"),
      holder: DEMO_ACTOR,
      capability: DEMO_MANIPULATION_CAPABILITY,
      scope: { sessionId: DEMO_SESSION },
    }),
  });
  if (sensoryRefused.ok || manipulationRefused.ok) {
    throw new Error("host restriction did not refuse the grant as expected");
  }

  // --- Evaluation: grants, denials, budget ---
  const context = { sessionId: DEMO_SESSION, epoch: asSessionEpoch(1), tick: asTick(1) };
  const request = (nonce: string, over: { actor?: typeof DEMO_ACTOR; grant?: string } = {}) =>
    actionRequest(
      DEMO_SESSION,
      over.actor ?? DEMO_ACTOR,
      {
        intentId: asIntentId(`i-${nonce}`),
        kind: asIntentKind("move.to"),
        actor: over.actor ?? DEMO_ACTOR,
        payload: { to: [1, 1] },
        issuedAt: asTimestamp(10),
      },
      grantId(over.grant ?? "demo-move"),
      nonce,
    );

  const first = broker.evaluate(request("n-1"), context);
  const second = broker.evaluate(request("n-2"), context);
  const third = broker.evaluate(request("n-3"), context); // total-count max=2 -> exhausted
  if (first.status !== "granted" || second.status !== "granted") {
    throw new Error("valid requests were not granted");
  }
  if (third.status !== "denied") {
    throw new Error("budget exhaustion did not deny the third request");
  }

  const stranger = broker.evaluate(request("n-4", { actor: { actorClass: "avatar-agent", actorId: "other" as never } }), context);
  const unknownGrant = broker.evaluate(request("n-5", { grant: "missing" }), context);
  const exhaustedAgain = broker.evaluate(request("n-6"), context); // budget still exhausted
  const grantsBeforeRevoke = broker.grants.length;
  broker.revoke(grantId("demo-move"));
  const afterRevoke = broker.evaluate(request("n-7"), context);

  // --- Determinism: same inputs -> same outputs on a fresh broker ---
  const twin = buildBroker();
  twin.admit({
    grant: makeGrant({
      grantId: grantId("demo-move"),
      holder: DEMO_ACTOR,
      capability: DEMO_MOVEMENT_CAPABILITY,
      scope: { sessionId: DEMO_SESSION },
      constraints: [{ kind: "total-count", max: 2 }],
    }),
  });
  const twinFirst = twin.evaluate(request("n-1"), context);
  const twinSecond = twin.evaluate(request("n-2"), context);
  const twinThird = twin.evaluate(request("n-3"), context);
  const deterministic =
    JSON.stringify([first, second, third]) === JSON.stringify([twinFirst, twinSecond, twinThird]) &&
    JSON.stringify(broker.ledger) === JSON.stringify(twin.ledger);

  return {
    policyDerived: true,
    deniedCapabilities: derived.policy.restrictions.denied.map(String),
    approvalRequired: derived.policy.restrictions.approvalRequired.map(String),
    grantsAdmitted: grantsBeforeRevoke,
    sensoryOutputGrantRefused: !sensoryRefused.ok && sensoryRefused.code === "capability-denied",
    manipulationWithoutApprovalRefused: !manipulationRefused.ok && manipulationRefused.code === "approval-required",
    grantedCommands:
      first.status === "granted" && second.status === "granted"
        ? [String(first.command.commandId), String(second.command.commandId)]
        : [],
    denialReasonsFired: [
      third.status === "denied" ? third.reason : "",
      stranger.status === "denied" ? stranger.reason : "",
      unknownGrant.status === "denied" ? unknownGrant.reason : "",
      exhaustedAgain.status === "denied" ? exhaustedAgain.reason : "",
      afterRevoke.status === "denied" ? afterRevoke.reason : "",
    ].filter((reason) => reason !== ""),
    budgetReplayDenied: third.status === "denied" && third.reason === "budget-exhausted",
    deterministicReplay: deterministic,
  };
}

const evidence = main();
const ok =
  evidence.policyDerived &&
  evidence.sensoryOutputGrantRefused &&
  evidence.manipulationWithoutApprovalRefused &&
  evidence.budgetReplayDenied &&
  evidence.deterministicReplay &&
  evidence.denialReasonsFired.includes("grant-holder-mismatch") &&
  evidence.denialReasonsFired.includes("grant-not-found") &&
  evidence.denialReasonsFired.includes("budget-exhausted") &&
  evidence.grantedCommands.length === 2;

console.log(JSON.stringify({ workOrder: "PL-026", package: "capability-broker", ok, evidence }, null, 2));
if (!ok) {
  process.exitCode = 1;
}
