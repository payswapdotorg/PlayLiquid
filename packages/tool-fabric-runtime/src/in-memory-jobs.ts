/**
 * Module role: in-memory job observation doubles — a JobStorePort
 * implementation that records persist() calls and replays them through
 * loadAll(), plus a collecting JobEventSink. Both are TEST DOUBLES /
 * host conveniences, never production durability.
 *
 * TRUTHFUL LIMITATION (E11): process-local memory only. Real durability
 * is the host's JobStorePort implementation (E6: durable/queued/resumable
 * is the port contract, not this double).
 *
 * Implements: PL-019 E6 store/event sink doubles.
 */

import type { JobStoreRecord } from "./domain/job.ts";
import type { JobEvent, JobEventSink, JobStorePort } from "./domain/ports.ts";

export interface InMemoryJobStore extends JobStorePort {
  /** All records in persist order. */
  readonly records: readonly JobStoreRecord[];
  /** Drops all records (test reset). */
  clear(): void;
}

/** Creates an in-memory job store (records persist calls). */
export function createInMemoryJobStore(): InMemoryJobStore {
  const records: JobStoreRecord[] = [];
  return Object.freeze({
    async persist(record: JobStoreRecord): Promise<void> {
      records.push(record);
    },
    async loadAll(): Promise<readonly JobStoreRecord[]> {
      return Object.freeze([...records]);
    },
    get records(): readonly JobStoreRecord[] {
      return Object.freeze([...records]);
    },
    clear(): void {
      records.length = 0;
    },
  });
}

export interface CollectingJobEventSink extends JobEventSink {
  /** All events in emission order. */
  readonly events: readonly JobEvent[];
  /** Events for one job, in order. */
  forJob(jobId: string): readonly JobEvent[];
}

/** Creates an event sink that collects every emitted job event. */
export function createCollectingJobEventSink(): CollectingJobEventSink {
  const events: JobEvent[] = [];
  return Object.freeze({
    emit(event: JobEvent): void {
      events.push(event);
    },
    get events(): readonly JobEvent[] {
      return Object.freeze([...events]);
    },
    forJob(jobId: string): readonly JobEvent[] {
      return Object.freeze(events.filter((event) => event.jobId === jobId));
    },
  });
}
