/**
 * THE DETERMINISTIC EVALUATION RUNNER (PL-028) — the simulation/evaluation
 * engine of the Lab loop (spec/architecture.md §Lab loop).
 *
 * One admitted evaluation (E1 intake record) + its resolved inputs → ONE
 * bounded, seeded, fully deterministic run (E9):
 *
 * 1. build the scenario (scenario.ts) from the input dimensions;
 * 2. compose the lab evaluation game binding (world.ts) and drive a
 *    @playliquid/simulation `SimulationSession` — `begin(seed)`, then
 *    `tickBudget` rounds of broker-mediated work commands, then
 *    `terminate`;
 * 3. @playliquid/capability-broker is THE action authority inside the
 *    simulated organization (R20): every agent intent passes
 *    `broker.evaluate`; granted intents become canonical command
 *    envelopes admitted through the session's single command gate
 *    (`submitRecordedCommand`, E2 — no second channel); agents without a
 *    work grant are DENIED and counted (`intent-denials` — the
 *    least-privilege denial surface);
 * 4. capture the run as immutable @playliquid/replay artifacts (R8):
 *    command stream + event witness + replay record, sealed and verified
 *    fail-closed, handed to the host CAS through {@link LabReplaySink};
 * 5. derive metric readings from the run statistics — ONLY for suite
 *    metrics the simulator models (`LAB_METRIC_IDS`), honestly refused
 *    otherwise (`unmeasurable-metric`);
 * 6. assemble the E11 result: an explicitly-labeled `SimulatorOutput`
 *    estimate, re-checked by the runtime guard before any record is
 *    built (simulator output is NEVER ground truth — lock 29).
 *
 * Pure domain: no IO, no clocks (run time is caller-supplied), no
 * globals; the only mutable state is the throwaway session + broker of
 * THIS run, discarded with the result.
 */

import type {
  EvaluationMetricReading,
  LabEvaluationSuite,
  OrganizationDescriptor,
  OrganizationSearchContext,
  ProjectEvidenceRecord,
} from "@playliquid/lab-contracts";
import { asTimestampMs } from "@playliquid/lab-contracts";
import type { ReplayRecord } from "@playliquid/replay";
import { sealCommandStream, sealEventWitness, sealReplayRecord } from "@playliquid/replay";
import type { RecordedCommand } from "@playliquid/replay";
import { verifyCommandStream, verifyEventWitness } from "@playliquid/replay";
import { CapabilityBroker, brokerPolicy } from "@playliquid/capability-broker";
import { FixedClock, InMemorySnapshotStore, SimulationSession, entityKeys, entityStateOf } from "@playliquid/simulation";
import type { SimulationGameBinding, WorldState } from "@playliquid/simulation";
import type { CapabilityGrantId, IntentKind } from "@playliquid/runtime-contracts";
import {
  asActionRequestId,
  asCapabilityGrantId,
  asCapabilityId,
  asDeterminismSeed,
  asIdempotencyNonce,
  asIntentId,
  asIntentKind,
  asSessionId,
  asTimestamp,
} from "@playliquid/runtime-contracts";
import { buildLabScenario } from "./scenario.ts";
import type { LabScenario, LabWorkItemSpec } from "./scenario.ts";
import { readingsOf } from "./metrics.ts";
import {
  LAB_SIMULATOR_ID,
  LAB_WORK_COMMAND_KIND,
  LAB_WORK_INTENT_KIND,
  asLabEstimateResult,
} from "./records.ts";
import type {
  LabEvaluationIntakeRecord,
  LabEvaluationRunRecord,
  LabRunRefusalCode,
  LabRunResult,
  LabRunStatistics,
} from "./records.ts";
import {
  WORK_UNITS_PER_COMMAND,
  labAgentActor,
  labAgentGrants,
  labGameRefOf,
  labWorldBlueprint,
  labWorldSystems,
  workCommandPayload,
  workItemEntityRef,
} from "./world.ts";

/** Host CAS sink for sealed replay records (content-addressed, idempotent). */
export type LabReplaySink = (record: ReplayRecord) => void;

/** Builds the typed refusal arm (kept local and simple). */
function refuse(code: LabRunRefusalCode, detail: string): LabRunResult {
  return { ok: false, code, detail };
}

/** First open work item of the scenario in deterministic entity order. */
function firstOpenItem(world: WorldState | undefined, scenario: LabScenario): LabWorkItemSpec | undefined {
  if (world === undefined) return scenario.workItems[0];
  return scenario.workItems.find((item) => {
    const state = entityStateOf(world, workItemEntityRef(item.entityId));
    if (state === undefined || state.kind !== "record") return true;
    const completed = state.fields.completed;
    return !(completed !== undefined && completed.kind === "bool" && completed.value);
  });
}

/** The grant an actor attempts work under (undefined = no authority, R20). */
function grantIdOf(actor: ReturnType<typeof labAgentActor>, byActor: ReadonlyMap<string, CapabilityGrantId>): CapabilityGrantId | undefined {
  return byActor.get(String(actor.actorId));
}

/** The grant id unprivileged agents attempt under (always absent — honest denial). */
const UNGRANTED_ID = asCapabilityGrantId("grant-lab-none");

/**
 * The deterministic sim epoch: the lab world has no wall clock, so every
 * in-world timestamp (command envelopes, broker clock, session clock) is
 * this constant — run-time NEVER enters the sealed artifacts (E9). The
 * caller-supplied run time survives only as bookkeeping (run record
 * `runAt`, replay `provenance.capturedAt`).
 */
const SIM_EPOCH_MS = 0;

/**
 * Runs one admitted evaluation. Deterministic (E9): the same intake
 * content + resolved inputs produce byte-identical ADDRESSED artifacts
 * (command stream, event witness, statistics, readings) regardless of
 * run time; the run time survives only as bookkeeping (run record
 * `runAt`, replay `provenance.capturedAt` — the replay RECORD id is the
 * capture event's address and legitimately varies with it).
 */
export function runLabEvaluation(input: {
  readonly intake: LabEvaluationIntakeRecord;
  readonly organization: OrganizationDescriptor;
  readonly context: OrganizationSearchContext;
  readonly evidence: readonly ProjectEvidenceRecord[];
  readonly suite: LabEvaluationSuite;
  /** Caller-supplied run time, in ms (no clock authority here). */
  readonly runAt: number;
  /** Host CAS sink for the sealed replay record (R8). */
  readonly replaySink: LabReplaySink;
}): LabRunResult {
  const { intake, organization, context, evidence, suite, replaySink } = input;
  const runAt = asTimestampMs(Number(input.runAt));
  if (runAt === undefined) {
    return refuse("simulation-rejected", "runAt must be a safe integer millisecond value");
  }

  const scenario = buildLabScenario({ organization, context, evidence, tickBudget: intake.tickBudget });

  const sessionId = asSessionId(`lab-sim-${String(intake.identityDigest).slice(0, 16)}`);
  const binding: SimulationGameBinding = {
    game: labGameRefOf(scenario, sessionId),
    blueprint: labWorldBlueprint(scenario),
    systems: labWorldSystems(scenario.frictionProbability),
    commandPolicy: { [LAB_WORK_COMMAND_KIND]: ["ready", "running"] },
    capabilityIntentKinds: Object.fromEntries(
      scenario.capabilityCoverage.map((coverage) => [
        coverage.capability,
        coverage.intentKinds.map((kind) => asIntentKind(kind) as IntentKind),
      ]),
    ),
    grants: labAgentGrants(sessionId, 1, scenario),
  };

  const policy = brokerPolicy(
    scenario.capabilityCoverage.map((coverage) => ({
      capability: asCapabilityId(coverage.capability),
      intentKinds: coverage.intentKinds,
      commandKindByIntent: coverage.commandKindByIntent,
    })),
  );
  if (!policy.ok) {
    return refuse("simulation-rejected", `broker policy derivation failed: ${policy.code}: ${policy.detail}`);
  }
  const broker = new CapabilityBroker({
    policy: policy.policy,
    // Deterministic sim clock: the simulated world has NO wall-clock
    // authority — commands are issued at the sim epoch, so the sealed
    // stream/witness artifacts are functions of (request, seed, evidence)
    // only (E9). The caller's run time is bookkeeping (run record + replay
    // provenance), never artifact content.
    clock: { now: () => asTimestamp(SIM_EPOCH_MS) },
    grants: binding.grants,
    commandIdPrefix: "lab",
  });

  const session = new SimulationSession({
    sessionId,
    binding,
    ports: { clock: new FixedClock([SIM_EPOCH_MS]), snapshotStore: new InMemorySnapshotStore() },
  });
  const begun = session.begin(asDeterminismSeed(String(intake.seed)));
  if (begun.status === "rejected") {
    return refuse("simulation-rejected", `session begin rejected: ${begun.code}: ${begun.detail}`);
  }

  const grantIdsByActor = new Map<string, CapabilityGrantId>();
  for (const grant of binding.grants) {
    if (!grantIdsByActor.has(String(grant.holder.actorId))) {
      grantIdsByActor.set(String(grant.holder.actorId), grant.grantId);
    }
  }

  const recorded: RecordedCommand[] = [];
  let admissionSeq = 0;
  let brokerGrants = 0;
  let brokerDenials = 0;

  for (let round = 1; round <= scenario.tickBudget; round += 1) {
    const view = session.view();
    const openItem = firstOpenItem(session.worldState, scenario);
    if (openItem !== undefined) {
      for (const agent of scenario.agents) {
        const actor = labAgentActor(String(agent.agent));
        const intentId = `lab-intent-r${round}-${String(agent.agent)}`;
        const resolution = broker.evaluate(
          {
            requestId: asActionRequestId(`req-r${round}-${String(agent.agent)}`),
            sessionId,
            actor,
            intent: {
              intentId: asIntentId(intentId),
              kind: asIntentKind(LAB_WORK_INTENT_KIND),
              actor,
              payload: workCommandPayload(workItemEntityRef(openItem.entityId), WORK_UNITS_PER_COMMAND),
              issuedAt: asTimestamp(SIM_EPOCH_MS),
            },
            grantId: grantIdOf(actor, grantIdsByActor) ?? UNGRANTED_ID,
            idempotencyKey: { scope: "action", actor: actor.actorId, nonce: asIdempotencyNonce(intentId) },
          },
          { sessionId, epoch: view.epoch, tick: view.tick },
        );
        if (resolution.status === "granted") {
          brokerGrants += 1;
          const submit = session.submitRecordedCommand(resolution.command, round);
          if (submit.status === "rejected") {
            return refuse("simulation-rejected", `command admission rejected: ${submit.code}: ${submit.detail}`);
          }
          admissionSeq += 1;
          recorded.push({ admissionSeq, dueTick: round, envelope: resolution.command });
        } else {
          brokerDenials += 1;
        }
      }
    }
    const step = session.step({ op: "step", sessionId, ticks: 1 });
    if (step.status === "rejected") {
      return refuse("simulation-rejected", `session step rejected: ${step.code}: ${step.detail}`);
    }
  }

  const terminated = session.terminate({ op: "terminate", sessionId, reason: "lab-tick-budget-exhausted" });
  if (terminated.status === "rejected") {
    return refuse("simulation-rejected", `session terminate rejected: ${terminated.code}: ${terminated.detail}`);
  }

  const statistics = statisticsOf(session, scenario, brokerGrants, brokerDenials, admissionSeq);

  const stream = sealCommandStream(recorded);
  const streamCheck = verifyCommandStream(stream);
  if (!streamCheck.ok) {
    return refuse("replay-unverifiable", `command stream failed verification: ${streamCheck.code}`);
  }
  const events = [...session.eventLog];
  const witness = sealEventWitness(events);
  const witnessCheck = verifyEventWitness(witness);
  if (!witnessCheck.ok) {
    return refuse("replay-unverifiable", `event witness failed verification: ${witnessCheck.code}`);
  }
  const finalView = session.view();
  const replay = sealReplayRecord({
    sessionId,
    game: binding.game,
    determinism: asDeterminismSeed(String(intake.seed)),
    capture: {
      fromEventSeq: 1,
      toEventSeq: finalView.committedEventSeq,
      toTick: Number(finalView.tick),
    },
    commandStream: stream.streamDigest,
    eventWitness: witness.witnessDigest,
    provenance: {
      capturedBy: "lab-simulation",
      capturedAt: asTimestamp(Number(runAt)),
      runtimeRole: "simulation",
      tool: LAB_SIMULATOR_ID,
      consumers: ["lab", "simulation"],
    },
  });
  replaySink(replay);

  const readings = readingsOf(statistics, suite, scenario);
  if (!readings.ok) {
    return refuse(readings.code, readings.detail);
  }
  const estimate = {
    epistemic: "labeled-estimate" as const,
    method: "simulation" as const,
    simulator: LAB_SIMULATOR_ID,
    payload: readings.payload as readonly EvaluationMetricReading[],
  };
  const result = asLabEstimateResult(estimate);
  if (result === undefined) {
    return refuse("simulation-rejected", "internal invariant: estimate failed the E11 runtime guard");
  }

  const run: LabEvaluationRunRecord = {
    evaluationId: intake.evaluationId,
    tenant: intake.tenant,
    owner: intake.owner,
    cycleId: intake.cycleId,
    organization: intake.organization,
    suite: intake.suite,
    seed: intake.seed,
    simulator: LAB_SIMULATOR_ID,
    runAt,
    statistics,
    result,
    replay: {
      replayId: replay.replayId,
      commandStream: stream.streamDigest,
      eventWitness: witness.witnessDigest,
    },
  };
  return { ok: true, run };
}

/** Reads the run statistics out of the final world state (deterministic). */
function statisticsOf(
  session: SimulationSession,
  scenario: LabScenario,
  brokerGrants: number,
  brokerDenials: number,
  commandsAdmitted: number,
): LabRunStatistics {
  const world = session.worldState;
  let completedWork = 0;
  let openWork = 0;
  let defects = 0;
  let progressUnits = 0;
  if (world !== undefined) {
    for (const key of entityKeys(world)) {
      const entity = key.split("/")[5];
      if (entity === undefined) continue;
      const state = entityStateOf(world, workItemEntityRef(entity));
      if (state === undefined || state.kind !== "record") continue;
      const progress = state.fields.progress;
      const itemDefects = state.fields.defects;
      const completed = state.fields.completed;
      if (progress === undefined || progress.kind !== "int") continue;
      if (completed !== undefined && completed.kind === "bool" && completed.value) {
        completedWork += 1;
      } else {
        openWork += 1;
      }
      progressUnits += Number(progress.value);
      if (itemDefects !== undefined && itemDefects.kind === "int") {
        defects += Number(itemDefects.value);
      }
    }
  }
  const privileged = scenario.agents.filter((agent) => !agent.unprivileged).length;
  const capabilityCoverage = scenario.agents.length > 0 ? privileged / scenario.agents.length : 0;
  return {
    ticks: Number(session.view().tick),
    commandsAdmitted,
    brokerGrants,
    brokerDenials,
    eventsEmitted: session.view().committedEventSeq,
    completedWork,
    openWork,
    defects,
    progressUnits,
    capabilityCoverage,
  };
}
