/**
 * DETERMINISTIC IN-MEMORY FAKES for the Lab simulation ports (PL-028).
 *
 * Everything here is deterministic and in-memory: no IO, no timers, no
 * randomness, no wall clock. Real persistence, suite resolution (the
 * package graph), evidence ledgers, observation ledgers and replay CAS
 * adapters are host concerns — the ports (ports.ts) are the seam. The
 * fake CONTENT vocabulary (fixtures) lives in fixtures.ts and is
 * re-exported here for the tests/harness import sites.
 */

import type {
  EvaluationSuiteResolver,
  LabEvaluationSuite,
  ObservedOutcomeRecord,
  ProjectEvidenceLedger,
  ProjectEvidenceRecord,
} from "@playliquid/lab-contracts";
import type { CalibrationConclusion, ObservationLedger } from "@playliquid/lab-contracts";
import { EMPTY_OBSERVATION_LEDGER, appendObservation, appendProjectEvidence } from "@playliquid/lab-contracts";
import type { ReplayRecord } from "@playliquid/replay";
import { replayRecordIdentity } from "@playliquid/replay";
import type { LabClockPort, LabEvaluationStore, LabServiceDocument, LabSimulationPorts } from "./ports.ts";
import type { LabObservationView } from "./calibration.ts";
import { appendLabCalibrationConclusion } from "./calibration.ts";
import type { LabReplaySink } from "./runner.ts";
import {
  labFixtureEvidenceRecords,
  labFixtureSuite,
} from "./fixtures.ts";

export * from "./fixtures.ts";

/** A fully caller-programmed clock (the no-wall-clock fake). */
export function createFixedClock(startAt = 1_000): {
  readonly clock: LabClockPort;
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

/** An in-memory suite directory implementing the resolver port. */
export function createSuiteDirectory(suites: readonly LabEvaluationSuite[] = []): {
  readonly resolver: EvaluationSuiteResolver;
  readonly add: (suite: LabEvaluationSuite) => void;
} {
  const table = new Map<string, LabEvaluationSuite>();
  for (const suite of suites) {
    table.set(String(suite.ref.suiteId), suite);
  }
  return {
    resolver: (ref) => {
      const suite = table.get(String(ref.suiteId));
      return suite !== undefined && suite.ref.contentDigest === ref.contentDigest ? suite : undefined;
    },
    add: (suite) => {
      table.set(String(suite.ref.suiteId), suite);
    },
  };
}

/** An in-memory evidence ledger: read view + host-side append fold. */
export function createEvidenceLedger(records: readonly ProjectEvidenceRecord[] = []): {
  readonly view: (recordId: string) => ProjectEvidenceRecord | undefined;
  readonly append: (record: ProjectEvidenceRecord) => void;
  readonly list: () => readonly ProjectEvidenceRecord[];
} {
  let ledger: ProjectEvidenceLedger = { records: [...records] };
  return {
    view: (recordId) => ledger.records.find((record) => String(record.evidenceId) === recordId),
    append: (record) => {
      const next = appendProjectEvidence(ledger, record);
      if (!next.ok) throw new RangeError(`evidence ledger append refused: ${next.code}`);
      ledger = next.ledger;
    },
    list: () => ledger.records,
  };
}

/** An in-memory observation ledger (E10): immutable + append-only folds. */
export function createObservationLedger(observations: readonly ObservedOutcomeRecord[] = []): {
  readonly view: LabObservationView;
  readonly ledger: () => ObservationLedger;
  readonly appendObservation: (record: ObservedOutcomeRecord) => void;
  readonly appendConclusion: (conclusion: CalibrationConclusion) => { readonly ok: boolean; readonly detail: string };
} {
  let ledger: ObservationLedger = EMPTY_OBSERVATION_LEDGER;
  for (const record of observations) {
    const next = appendObservation(ledger, record);
    if (!next.ok) throw new RangeError(`observation append refused: ${next.code}`);
    ledger = next.ledger;
  }
  return {
    view: (observationId) => ledger.observations.find((record) => String(record.observationId) === observationId),
    ledger: () => ledger,
    appendObservation: (record) => {
      const next = appendObservation(ledger, record);
      if (!next.ok) throw new RangeError(`observation append refused: ${next.code}`);
      ledger = next.ledger;
    },
    appendConclusion: (conclusion) => {
      const next = appendLabCalibrationConclusion(ledger, conclusion);
      if (next.ok) {
        ledger = next.ledger;
        return { ok: true, detail: String(conclusion.calibrationId) };
      }
      return { ok: false, detail: next.detail };
    },
  };
}

/** An in-memory content-addressed replay CAS implementing the sink port. */
export function createReplayStore(): {
  readonly sink: LabReplaySink;
  readonly records: () => readonly ReplayRecord[];
  readonly find: (replayId: string) => ReplayRecord | undefined;
} {
  const table = new Map<string, ReplayRecord>();
  return {
    sink: (record) => {
      // Content-addressed idempotency: the id IS the digest of the canonical
      // body, so a second write of the same id must be the same content
      // (E10 no-op), a mismatched id is a forgery, and a same-id/different-
      // content write is a digest collision — both refused.
      if (replayRecordIdentity(record) !== record.replayId) {
        throw new RangeError(`replay CAS: record id ${record.replayId} does not match its content`);
      }
      const existing = table.get(record.replayId);
      if (existing !== undefined && replayRecordIdentity(existing) !== record.replayId) {
        throw new RangeError(`replay CAS: digest collision on ${record.replayId}`);
      }
      table.set(record.replayId, record);
    },
    records: () => [...table.values()],
    find: (replayId) => table.get(replayId),
  };
}

/** An in-memory content-addressed service-document store (E6 fake). */
export function createEvaluationStore(): {
  readonly store: LabEvaluationStore;
  readonly documents: () => readonly LabServiceDocument[];
} {
  const saved: LabServiceDocument[] = [];
  return {
    store: {
      save: (document) => {
        const existing = saved.find((candidate) => candidate.stateDigest === document.stateDigest);
        if (existing !== undefined && existing !== document) {
          throw new RangeError(`evaluation store: digest collision on ${document.stateDigest}`);
        }
        saved.push(document);
      },
      load: () => saved[saved.length - 1],
    },
    documents: () => [...saved],
  };
}

/** Wires the full fake port bundle (tests + harness entry convenience). */
export function createLabSimulationFakes(options?: {
  readonly suites?: readonly LabEvaluationSuite[];
  readonly evidence?: readonly ProjectEvidenceRecord[];
  readonly observations?: readonly ObservedOutcomeRecord[];
}): {
  readonly ports: LabSimulationPorts;
  readonly clock: ReturnType<typeof createFixedClock>;
  readonly suites: ReturnType<typeof createSuiteDirectory>;
  readonly evidence: ReturnType<typeof createEvidenceLedger>;
  readonly observations: ReturnType<typeof createObservationLedger>;
  readonly replays: ReturnType<typeof createReplayStore>;
  readonly store: ReturnType<typeof createEvaluationStore>;
} {
  const clock = createFixedClock();
  const suites = createSuiteDirectory(options?.suites ?? [labFixtureSuite()]);
  const evidence = createEvidenceLedger(options?.evidence ?? labFixtureEvidenceRecords());
  const observations = createObservationLedger(options?.observations ?? []);
  const replays = createReplayStore();
  const store = createEvaluationStore();
  return {
    ports: {
      clock: clock.clock,
      suites: suites.resolver,
      evidence: evidence.view,
      observations: observations.view,
      replays: replays.sink,
      store: store.store,
    },
    clock,
    suites,
    evidence,
    observations,
    replays,
    store,
  };
}
