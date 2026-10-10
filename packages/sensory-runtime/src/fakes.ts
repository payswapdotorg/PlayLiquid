/**
 * IN-MEMORY FAKES for the sensory runtime ports (TEST SUPPORT ONLY —
 * lock rule 44: no hidden mocks presented as production).
 *
 * STATUS (E11, stated plainly): this package ships NO real producers,
 * NO capture, NO device IO, NO physics. Producer ports are interfaces;
 * the seeded in-memory fakes below are the ONLY in-repo implementation.
 * Real adapters (cameras, microphones, engine simulation feeds) are
 * host concerns — the interactive host remains a host concern per the
 * work order; this package is the simulation/lab runtime.
 *
 * Determinism (E9): the fake producer is SEEDED — a small deterministic
 * xorshift* stream derives every payload value, so identical seeds
 * produce identical frame sequences on every machine. No Math.random,
 * no Date.now, no IO.
 */

import type { SensorCapabilityId } from "@playliquid/game-contracts";
import type { TenantId } from "@playliquid/platform-contracts";
import type { SessionEpoch, Tick } from "@playliquid/runtime-contracts";
import type { RawProducerFrame } from "./codec.ts";
import type { AppendOutcome, SensoryHistoryPort, SensoryHistoryRecord } from "./ports.ts";
import type { ServiceClock } from "./ports.ts";
import type { SensoryProducerPort } from "./ports.ts";
import type { ContentDigest } from "@playliquid/package-system";
import { asContentDigest } from "@playliquid/platform-contracts";

// ---------------------------------------------------------------------------
// Deterministic seeded stream (xorshift*; no Math.random)
// ---------------------------------------------------------------------------

/** A deterministic 53-bit-safe stream seeded by a caller-supplied seed. */
export class SeededStream {
  #state: number;

  constructor(seed: number) {
    // Spread arbitrary seeds into a non-zero state deterministically.
    this.#state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Next raw uint32. */
  nextUint32(): number {
    let x = this.#state;
    x ^= x >>> 12;
    x ^= x << 7;
    x >>>= 0;
    x ^= x >>> 5;
    this.#state = x >>> 0;
    return this.#state;
  }

  /** Next float in [0,1). */
  nextUnit(): number {
    return this.nextUint32() / 0x100000000;
  }
}

// ---------------------------------------------------------------------------
// Clock fake
// ---------------------------------------------------------------------------

/** A manual clock: stamps advance only when the caller says so. */
export class ManualClock implements ServiceClock {
  #now: number;

  constructor(start: number) {
    this.#now = start;
  }

  readonly now = (): number => this.#now;

  advance(ms: number): void {
    this.#now += ms;
  }

  set(now: number): void {
    this.#now = now;
  }
}

// ---------------------------------------------------------------------------
// Seeded producer fake
// ---------------------------------------------------------------------------

/** Construction options for {@link SeededProducer}. */
export interface SeededProducerOptions {
  readonly channel: string;
  readonly capability: SensorCapabilityId;
  readonly seed: number;
}

/**
 * A seeded per-channel producer fake. Each `emit()` call queues one
 * frame whose payload is derived entirely from the seed stream (E9);
 * `poll()` drains the queue. Frames carry the caller-supplied epoch and
 * tick — the host's injected clock discipline.
 */
export class SeededProducer implements SensoryProducerPort {
  readonly channel: string;
  readonly capability: SensorCapabilityId;
  readonly #stream: SeededStream;
  readonly #queue: RawProducerFrame[] = [];
  #frame = 0;

  constructor(options: SeededProducerOptions) {
    this.channel = options.channel;
    this.capability = options.capability;
    this.#stream = new SeededStream(options.seed);
  }

  readonly poll = (): readonly RawProducerFrame[] => this.#queue.splice(0, this.#queue.length);

  /** Queue one well-formed frame for the capability (deterministic payload). */
  emit(epoch: SessionEpoch, tick: Tick): void {
    this.#queue.push({
      channel: this.channel,
      capability: this.capability,
      epoch,
      tick,
      payload: this.#nextPayload(),
    });
    this.#frame += 1;
  }

  /** Queue a RAW frame verbatim (negative tests: malformed/mismatched). */
  enqueueRaw(frame: RawProducerFrame): void {
    this.#queue.push(frame);
  }

  /** Frames emitted so far (bookkeeping). */
  get emitted(): number {
    return this.#frame;
  }

  #nextPayload(): unknown {
    const unit = this.#stream.nextUnit.bind(this.#stream);
    switch (this.capability) {
      case "vision":
        return { kind: "visual-field", width: 2, height: 2, cells: [unit(), unit(), unit(), unit()] };
      case "audio":
        return { kind: "audio-frame", frame: this.#frame, level: unit() };
      case "touch":
        return { kind: "tactile-array", rows: 2, columns: 2, pressures: [unit(), unit(), unit(), unit()] };
      case "smell":
        return { kind: "olfactory-intensity", entries: [{ odorant: "rain", intensity: unit() }] };
      case "taste":
        return { kind: "gustatory-intensity", entries: [{ taste: "sweet", intensity: unit() }] };
      case "proprioception":
        return {
          kind: "proprioceptive-state",
          joints: ["knee"],
          angles: [unit() * 360 - 180],
          positions: [unit() * 10],
        };
      case "vestibular":
        return {
          kind: "vestibular-frame",
          linearAcceleration: [unit() - 0.5, unit() - 0.5, unit() - 0.5],
          angularVelocity: [unit() - 0.5, unit() - 0.5, unit() - 0.5],
        };
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory history fake
// ---------------------------------------------------------------------------

/**
 * The in-memory append-only history: tenant-keyed ordered lists,
 * content-keyed idempotency (same key + same record id → recorded
 * receipt; same key + DIFFERENT record id → typed refusal carried as a
 * `conflict` outcome the service seam reports), immutable records.
 */
export class InMemorySensoryHistory implements SensoryHistoryPort {
  readonly #byTenant = new Map<string, SensoryHistoryRecord[]>();
  readonly #byKey = new Map<string, SensoryHistoryRecord>();
  readonly #conflicts: { readonly key: string; readonly recordId: string }[] = [];

  readonly append = (record: SensoryHistoryRecord): AppendOutcome => {
    const key = String(record.contentKey);
    const existing = this.#byKey.get(key);
    if (existing !== undefined) {
      if (String(existing.recordId) === String(record.recordId)) {
        return { status: "recorded-receipt", record: existing };
      }
      this.#conflicts.push({ key, recordId: String(record.recordId) });
      // Content-addressed discipline: a different record under the same
      // key is refused — modeled as a recorded-receipt of the EXISTING
      // record plus a visible conflict entry (never a second mutation).
      return { status: "recorded-receipt", record: existing };
    }
    this.#byKey.set(key, record);
    const list = this.#byTenant.get(String(record.tenant)) ?? [];
    list.push(record);
    this.#byTenant.set(String(record.tenant), list);
    return { status: "appended", record };
  };

  readonly read = (tenant: TenantId): readonly SensoryHistoryRecord[] => [
    ...(this.#byTenant.get(String(tenant)) ?? []),
  ];

  readonly readChannel = (tenant: TenantId, channel: string): readonly SensoryHistoryRecord[] =>
    this.read(tenant).filter((record) => record.channel === channel);

  readonly findByKey = (tenant: TenantId, contentKey: ContentDigest): SensoryHistoryRecord | undefined => {
    const record = this.#byKey.get(String(contentKey));
    return record !== undefined && record.tenant === tenant ? record : undefined;
  };

  /** Read model: content-key conflicts observed (audit, E10). */
  get conflicts(): readonly { readonly key: string; readonly recordId: string }[] {
    return [...this.#conflicts];
  }

  /** Read model: total record count across tenants. */
  get size(): number {
    return this.#byKey.size;
  }
}

/** Convenience: a fixed-epoch content digest helper for test fixtures. */
export function testContentDigest(seed: string): ContentDigest {
  // Deterministic 64-hex from a string seed (FNV-1a spread + padding).
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  return asContentDigest(`${hex.repeat(8)}`)!;
}
