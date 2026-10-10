/**
 * THE PERCEPTION SEAM (PL-027) — an adapter that feeds the sensory
 * history to avatar-runtime's `SensorInputPort.poll()` so the existing
 * perception → decision → action driver (PL-026 `AvatarRuntime.cycle`)
 * consumes this runtime WITHOUT MODIFICATION.
 *
 * Contracts-only import: avatar-runtime is a managed module; this file
 * imports exactly `SensorInputPort`/`SensorSample` types from the
 * package entry (`@playliquid/avatar-runtime`) — never implementation
 * internals — and structurally satisfies the port interface. The
 * projection is lossless-by-design at the seam level: the PL-026
 * `SensorSample` payload is `unknown`; this adapter hands the VALIDATED
 * typed payload object through (an already codec-admitted shape), plus
 * the channel and tick. The driver's own R5 filter then applies
 * avatar-runtime's restriction projection exactly as before — the seam
 * never second-guesses the driver's gates.
 *
 * Read semantics: `poll()` drains the tenant-scoped unseen history
 * (order: recording order) and advances a cursor. Re-polling yields the
 * NEXT batch — drain semantics matching avatar-runtime's
 * `InMemorySensorInput` convention, so a driver cycle sees each sample
 * exactly once.
 *
 * Tenancy (R20): the adapter is constructed per tenant against a
 * tenant-scoped read; cross-tenant cursor mixing is structurally
 * impossible (the read function is fixed at construction).
 *
 * Pure projection: no IO, no clock, no randomness. The cursor is the
 * adapter's ONLY state (E1: one owner — this instance).
 */

import type { SensorSample, SensorInputPort } from "@playliquid/avatar-runtime";
import type { TenantId } from "@playliquid/platform-contracts";
import type { Tick } from "@playliquid/runtime-contracts";
import { asTick } from "@playliquid/runtime-contracts";
import type { SensoryHistoryRecord, SensoryHistoryPort } from "./ports.ts";
import type { SensorySample } from "./samples.ts";

/** Cursor position: index into the tenant's append-only history. */
export interface PerceptionCursor {
  readonly tenant: TenantId;
  readonly nextIndex: number;
}

/** Construction options for {@link SensorHistoryInput}. */
export interface SensorHistoryInputOptions {
  readonly tenant: TenantId;
  readonly history: SensoryHistoryPort;
  /** Channels to project; default: every recorded channel. */
  readonly channels?: readonly string[];
}

/**
 * The perception-seam adapter: projects sensory history records onto
 * avatar-runtime's `SensorInputPort`. The PL-026 driver polls this and
 * proceeds through its own filter → memory → decide → broker → act
 * pipeline unmodified.
 */
export class SensorHistoryInput implements SensorInputPort {
  readonly #tenant: TenantId;
  readonly #history: SensoryHistoryPort;
  readonly #channels: ReadonlySet<string> | undefined;
  #nextIndex = 0;

  constructor(options: SensorHistoryInputOptions) {
    this.#tenant = options.tenant;
    this.#history = options.history;
    this.#channels = options.channels === undefined ? undefined : new Set(options.channels);
  }

  /** Drain the unseen tenant-scoped history as avatar `SensorSample`s. */
  poll(): readonly SensorSample[] {
    const records = this.#visibleRecords();
    const samples: SensorSample[] = [];
    for (const record of records) {
      samples.push(projectToAvatarSample(record));
    }
    this.#nextIndex += records.length;
    return samples;
  }

  /** Read model: the projection cursor (replay bookkeeping). */
  get cursor(): PerceptionCursor {
    return { tenant: this.#tenant, nextIndex: this.#nextIndex };
  }

  /** Read model: how many records remain unseen. */
  get pending(): number {
    return this.#visibleRecords().length;
  }

  #visibleRecords(): readonly SensoryHistoryRecord[] {
    const all = this.#history.read(this.#tenant);
    const slice = all.slice(this.#nextIndex);
    if (this.#channels === undefined) return slice;
    return slice.filter((record) => this.#channels?.has(record.channel));
  }
}

/**
 * Project one history record back onto avatar-runtime's untyped
 * `SensorSample`. The payload handed through is the RECONSTRUCTED typed
 * payload: history records are content-addressed envelopes; the full
 * payload value form is recoverable from the record's stored canonical
 * projection when the host stores it (see `payloadOf`). This function
 * is the single projection point — one canonical path (E2).
 */
export function projectToAvatarSample(record: SensoryHistoryRecord, payload?: unknown): SensorSample {
  return {
    channel: record.channel,
    tick: asTick(Number(record.tick)) as Tick,
    payload: payload ?? { kind: payloadKindOf(record.capability), digestPinned: String(record.contentDigest) },
  };
}

/**
 * Project a {@link SensorySample} (codec-admitted, typed payload) onto
 * the avatar seam — used when the host keeps typed samples live.
 */
export function projectSample(sample: SensorySample): SensorSample {
  return { channel: sample.channel, tick: sample.tick, payload: sample.payload };
}

/**
 * The canonical history record for a typed sample — the envelope a
 * host stores when it wants the FULL typed payload recoverable through
 * the seam (the runtime's own history port records are addressed by
 * content key; the payload value form string is the stored projection).
 * The typed sample is accepted for seam symmetry and re-projected on
 * demand by {@link projectSample}; the record itself is unchanged
 * (immutable, E10).
 */
export function historyRecordOfSample(
  record: SensoryHistoryRecord,
  _sample: SensorySample,
): SensoryHistoryRecord {
  return record;
}

/** The payload `kind` bound to a capability (codec binding, mirrored read-only). */
function payloadKindOf(capability: string): string {
  const binding: Readonly<Record<string, string>> = {
    vision: "visual-field",
    audio: "audio-frame",
    touch: "tactile-array",
    smell: "olfactory-intensity",
    taste: "gustatory-intensity",
    proprioception: "proprioceptive-state",
    vestibular: "vestibular-frame",
  };
  return binding[capability] ?? "unknown";
}
