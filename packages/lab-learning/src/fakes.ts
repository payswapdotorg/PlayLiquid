/**
 * DETERMINISTIC IN-MEMORY FAKES for the Lab learning ports (PL-030).
 *
 * STATUS: TEST SUPPORT ONLY (lock rule 44: no hidden mocks presented as
 * production). Everything here is deterministic and in-memory: no IO, no
 * timers, no randomness, no wall clock. Real durable persistence is a host
 * concern — the ports (ports.ts) are the seam.
 *
 * THE JOURNEY STACK IS REAL (the lab-organization graft precedent): the
 * evaluation port of the wired `LabOrganizationService` is a REAL
 * `LabSimulationService` (PL-028) over its own in-memory fakes, so tests
 * and the harness learn cycles whose artifacts were produced by the true
 * PL-029 search and PL-028 evaluation engines — never a mocked estimate.
 * The observation ledger is the real lab-simulation fold
 * (createObservationLedger); the body catalog is deliberately EMPTY (the
 * body axis collapses; real Agent Body catalogs are a host concern).
 */

import type { ObservedOutcomeRecord, ProjectEvidenceRecord } from "@playliquid/lab-contracts";
import { LabSimulationService } from "@playliquid/lab-simulation";
import {
  createLabSimulationFakes,
  createObservationLedger,
  labFixtureEvidenceRecords,
  labFixtureSuite,
} from "@playliquid/lab-simulation";
import { LabOrganizationService } from "@playliquid/lab-organization";
import type { LabLearningDocument, LabLearningStore } from "./ports.ts";
import { LabLearningService } from "./service.ts";
import type { LabLearningClockPort } from "./ports.ts";

/** A fully caller-programmed clock (the no-wall-clock fake). */
export function createFixedClock(startAt = 1_000): {
  readonly clock: LabLearningClockPort;
  readonly advance: (ms: number) => void;
  readonly now: () => number;
} {
  let cursor = startAt;
  return {
    clock: { now: () => cursor },
    advance: (ms) => {
      cursor += ms;
    },
    now: () => cursor,
  };
}

/** An in-memory content-addressed service-document store (E6 fake). */
export function createLearningStore(): {
  readonly store: LabLearningStore;
  readonly documents: () => readonly LabLearningDocument[];
} {
  const byDigest = new Map<string, LabLearningDocument>();
  return {
    store: {
      save: (document) => {
        // Content-addressed idempotency: the digest IS the content address,
        // so a same-digest save is a no-op (identical state re-snapshot).
        byDigest.set(document.stateDigest, document);
      },
      load: () => [...byDigest.values()].slice(-1)[0],
    },
    documents: () => [...byDigest.values()],
  };
}

/** The real-engine Lab journey stack tests and the harness drive (see module docs). */
export interface LabJourneyStack {
  readonly learning: LabLearningService;
  readonly organization: LabOrganizationService;
  readonly simulation: LabSimulationService;
  readonly clock: ReturnType<typeof createFixedClock>;
  readonly learningStore: ReturnType<typeof createLearningStore>;
  /** The host-side observation ledger the calibration conclusions append to. */
  readonly observations: ReturnType<typeof createObservationLedger>;
  /** The simulation fakes the PL-028 engine was wired over. */
  readonly simulationFakes: ReturnType<typeof createLabSimulationFakes>;
}

/**
 * Wires the full learning journey over the REAL engines: the PL-029
 * organization service (its evaluation port = the PL-028 simulation
 * service over its own in-memory fakes) plus this package's service.
 */
export function createLabLearningJourney(options?: {
  readonly observations?: readonly ObservedOutcomeRecord[];
  readonly evidence?: readonly ProjectEvidenceRecord[];
}): LabJourneyStack {
  const clock = createFixedClock();
  const learningStore = createLearningStore();
  const observations = createObservationLedger(options?.observations ?? []);
  const simulationFakes = createLabSimulationFakes({
    suites: [labFixtureSuite()],
    evidence: options?.evidence ?? labFixtureEvidenceRecords(),
    observations: [...observations.ledger().observations],
  });
  const simulation = new LabSimulationService({ ports: simulationFakes.ports });
  const organization = new LabOrganizationService({
    ports: {
      clock: clock.clock,
      // Deliberately EMPTY body catalog (the axis collapses; real Agent
      // Body catalogs are a host concern — see module docs).
      bodies: () => undefined,
      evaluation: simulation,
      store: { save: () => undefined, load: () => undefined },
    },
  });
  const learning = new LabLearningService({ ports: { clock: clock.clock, store: learningStore.store } });
  return { learning, organization, simulation, clock, learningStore, observations, simulationFakes };
}
