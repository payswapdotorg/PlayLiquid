/**
 * RUNTIME EVIDENCE HARNESS (pure check; run: `node src/harness.ts`).
 *
 * Drives the full PL-026 avatar-runtime story over the REAL capability
 * broker from the sibling package:
 * 1. compose the demo avatar (separately versioned sub-records, digest);
 * 2. apply a host restriction (vision denied — R5 perception gating);
 * 3. admit one movement grant with a budget (host side);
 * 4. drive cycles: perceptions flow (filtered), an intent claim becomes a
 *    broker-mediated canonical command on the actuator output, a claim
 *    with no grant is denied and fed back, budget exhaustion denies;
 * 5. replay determinism: a second identically-wired avatar/broker pair
 *    produces identical emitted commands and reports.
 *
 * Prints machine-readable JSON; exits non-zero on any unexpected outcome.
 * No IO beyond stdout; no clock reads (ManualBrokerClock); no randomness.
 */

import { asSessionEpoch, asSessionId, asTick } from "@playliquid/runtime-contracts";
import { CapabilityBroker, ManualBrokerClock, makeGrant } from "@playliquid/capability-broker";
import { deriveBrokerPolicy } from "@playliquid/capability-broker";
import {
  demoCoverage,
  demoGameDocument,
} from "@playliquid/capability-broker";
import { AvatarRuntime } from "./runtime.ts";
import {
  InMemoryActuatorOutput,
  InMemoryAvatarMemory,
  InMemorySensorInput,
  ScriptedIntelligence,
  demoAvatarDefinition,
} from "./fakes.ts";
import type { AvatarCycleReport } from "./runtime.ts";

const SESSION = asSessionId("avatar-harness");
const ACTOR = { actorClass: "avatar-agent" as const, actorId: "demo-avatar" as never };

interface Evidence {
  readonly composed: boolean;
  readonly definitionDigestLength: number;
  readonly visionDenied: boolean;
  readonly perceivedFiltered: readonly [number, number];
  readonly grantedEmitted: readonly string[];
  readonly missingGrantDenied: string;
  readonly budgetDenied: string;
  readonly wrongCapabilityDenied: string;
  readonly feedbackSources: readonly string[];
  readonly commandsAreBrokerMediated: boolean;
  readonly deterministicReplay: boolean;
}

interface Wiring {
  readonly runtime: AvatarRuntime;
  readonly actuators: InMemoryActuatorOutput;
  readonly intelligence: ScriptedIntelligence;
  readonly memory: InMemoryAvatarMemory;
  readonly broker: CapabilityBroker;
}

function wire(): Wiring {
  const derived = deriveBrokerPolicy(demoGameDocument(), demoCoverage());
  if (!derived.ok) throw new Error(derived.detail);
  const broker = new CapabilityBroker({ policy: derived.policy, clock: new ManualBrokerClock(10) });
  broker.admit({
    grant: makeGrant({
      grantId: "grant-move" as never,
      holder: ACTOR,
      scope: { sessionId: SESSION },
      constraints: [{ kind: "total-count", max: 1 }],
    }),
  });
  const sensors = new InMemorySensorInput();
  sensors.enqueue({ channel: "vision.main", tick: asTick(1), payload: { light: 0.4 } });
  sensors.enqueue({ channel: "audio.main", tick: asTick(1), payload: { level: 2 } });
  sensors.enqueue({ channel: "smell.main", tick: asTick(1), payload: { scent: "rain" } });
  const memory = new InMemoryAvatarMemory();
  const intelligence = new ScriptedIntelligence(ACTOR, [
    { intentKind: "move.to", nonce: "m-1", grantId: "grant-move", payload: { to: [3, 3] } },
    { intentKind: "move.to", nonce: "m-2", grantId: "grant-missing" },
    { intentKind: "move.to", nonce: "m-3", grantId: "grant-move" },
    { intentKind: "speak.say", nonce: "s-1", grantId: "grant-move" },
  ]);
  const actuators = new InMemoryActuatorOutput();
  const runtime = new AvatarRuntime({
    definition: demoAvatarDefinition(),
    restriction: { denied: ["vision"], approvalRequired: [], sandboxed: false },
    sessionId: SESSION,
    actor: ACTOR,
    broker,
    ports: { sensors, memory, intelligence, actuators },
  });
  return { runtime, actuators, intelligence, memory, broker };
}

function drive(wiring: Wiring): AvatarCycleReport {
  return wiring.runtime.cycle({ epoch: asSessionEpoch(1), tick: asTick(1) });
}

function main(): Evidence {
  const wiring = wire();
  const report = drive(wiring);
  const emitted = wiring.actuators.commands;

  const twin = wire();
  const twinReport = drive(twin);
  const deterministic =
    JSON.stringify(twinReport) === JSON.stringify(report) &&
    JSON.stringify(twin.actuators.commands.map((c) => [String(c.commandId), String(c.kind)])) ===
      JSON.stringify(emitted.map((c) => [String(c.commandId), String(c.kind)]));

  return {
    composed: true,
    definitionDigestLength: String(wiring.runtime.definition.definitionDigest).length,
    visionDenied: wiring.runtime.restriction.denied.includes("vision"),
    perceivedFiltered: [report.perceived, report.filtered],
    grantedEmitted: emitted.map((command) => String(command.kind)),
    missingGrantDenied: report.denials[0]?.reason ?? "none",
    budgetDenied: report.denials[1]?.reason ?? "none",
    wrongCapabilityDenied: report.denials[2]?.reason ?? "none",
    feedbackSources: wiring.intelligence.denials.map((feedback) => feedback.source),
    commandsAreBrokerMediated: emitted.every((command) => command.origin.kind === "broker-mediated"),
    deterministicReplay: deterministic,
  };
}

const evidence = main();
const ok =
  evidence.composed &&
  evidence.definitionDigestLength === 64 &&
  evidence.visionDenied &&
  JSON.stringify(evidence.perceivedFiltered) === "[1,2]" &&
  JSON.stringify(evidence.grantedEmitted) === '["world.move"]' &&
  evidence.missingGrantDenied === "grant-not-found" &&
  evidence.budgetDenied === "budget-exhausted" &&
  evidence.wrongCapabilityDenied === "intent-kind-outside-grant" &&
  JSON.stringify(evidence.feedbackSources) === '["broker","broker","broker"]' &&
  evidence.commandsAreBrokerMediated &&
  evidence.deterministicReplay;

console.log(JSON.stringify({ workOrder: "PL-026", package: "avatar-runtime", ok, evidence }, null, 2));
if (!ok) {
  process.exitCode = 1;
}
