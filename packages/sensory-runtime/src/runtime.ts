/**
 * THE SENSORY RUNTIME HOST (PL-027) — binds a COMPOSED avatar (from
 * avatar-runtime's composition, R5 restriction projection INCLUDED) to
 * per-channel producer ports, polls them under an injected
 * {@link ServiceClock}, and appends admitted samples to the
 * content-addressed history.
 *
 * Authority split (one authority per concern — this package hosts
 * EXECUTION, avatar-runtime owns the VOCABULARY):
 * - the composed {@link AvatarDefinition} arrives from avatar-runtime's
 *   `composeAvatar` (sub-records, definition digest) — never rebuilt or
 *   re-declared here;
 * - the R5 restriction projection uses avatar-runtime's own
 *   `effectiveSensorChannels` (perception gating at composition
 *   projection);
 * - sample admission is the codec's (codec.ts);
 * - history semantics are the history port's (ports.ts);
 * - THIS host owns only the poll loop bookkeeping.
 *
 * RESTRICTION FILTERING IS POLICY, NOT SILENCE: a restricted channel
 * produces NO sample, and every suppressed poll is RECORDED as a
 * {@link SensoryPolicyEvent} (`channel-restricted`) — the host never
 * silently drops a channel, mirroring "restricted channels produce
 * nothing, recorded as policy".
 *
 * EPOCH MONOTONICITY (E9): per channel, the host refuses frames whose
 * epoch regresses below the last admitted epoch (`epoch-regression`)
 * — clock-injected ordering violations are detected, not laundered.
 *
 * Determinism (E9): seeded producers (the fakes), no Math.random, no
 * wall-clock (ServiceClock), no IO, no timers, no globals (E3).
 *
 * Tenancy (R20): the host is constructed per tenant; every record and
 * poll report is tenant-scoped; cross-tenant reads are typed refusals
 * handled at the service seam (service.ts) via platform-contracts'
 * `checkTenantIsolation`.
 *
 * Async/stateful documentation: see ports.ts (the seam contract).
 * The host class owns ONLY its per-channel last-epoch ledger.
 */

import { effectiveSensorChannels } from "@playliquid/avatar-runtime";
import type { AvatarDefinition } from "@playliquid/avatar-runtime";
import type { HostRestriction } from "@playliquid/game-contracts";
import type { SensorCapabilityId } from "@playliquid/game-contracts";
import type { TenantId } from "@playliquid/platform-contracts";
import type { SessionEpoch, Tick } from "@playliquid/runtime-contracts";
import { admitFrame } from "./codec.ts";
import type { CodecAdmission, CodecRefusalCode } from "./codec.ts";
import { payloadValueForm } from "./digest.ts";
import { historyRecordIdOf, sampleContentKey } from "./digest.ts";
import type { SensorySample } from "./samples.ts";
import type { SensoryHistoryRecord, SensoryHistoryPort, SensoryProducerPort, ServiceClock } from "./ports.ts";

// ---------------------------------------------------------------------------
// Reports + policy events
// ---------------------------------------------------------------------------

/** A recorded policy decision (never a silent drop). */
export interface SensoryPolicyEvent {
  readonly kind: "channel-restricted" | "epoch-regression" | "codec-refusal" | "duplicate-receipt";
  readonly channel: string;
  readonly detail: string;
}

/** The audit report of one poll batch (pure read model). */
export interface SensoryPollReport {
  readonly epoch: SessionEpoch;
  readonly producersPolled: number;
  readonly framesSeen: number;
  readonly admitted: number;
  readonly restrictedChannels: readonly string[];
  readonly refusals: readonly { readonly code: CodecRefusalCode; readonly detail: string }[];
  readonly policyEvents: readonly SensoryPolicyEvent[];
  readonly appended: number;
  readonly recordedReceipts: number;
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

/** Construction options for {@link SensoryRuntimeHost}. */
export interface SensoryRuntimeHostOptions {
  /** The composed avatar definition (avatar-runtime composition output). */
  readonly definition: AvatarDefinition;
  /** Host restriction applied to the avatar (R5); default: unrestricted. */
  readonly restriction?: HostRestriction;
  readonly tenant: TenantId;
  /** Per-channel producers; channel ids must bind to avatar channels. */
  readonly producers: readonly SensoryProducerPort[];
  readonly history: SensoryHistoryPort;
  readonly clock: ServiceClock;
  /** Whether codec refusals are also recorded as policy events (audit). */
  readonly recordRefusalsAsPolicy?: boolean;
}

/** A producer whose channel is not part of the composed avatar at all. */
export type HostBindingResult =
  | { readonly ok: true; readonly host: SensoryRuntimeHost }
  | { readonly ok: false; readonly code: "unknown-producer-channel" | "duplicate-producer-channel" | "producer-capability-mismatch"; readonly detail: string };

/**
 * Bind producers to a composed avatar and construct the host. The
 * producer binding must be coherent with the avatar's sensor channels:
 * a producer for a channel the avatar does not declare, a duplicate
 * channel, or a capability that disagrees with the declaration are all
 * typed refusals — the host never polls an unbound producer.
 */
export function bindSensoryHost(options: SensoryRuntimeHostOptions): HostBindingResult {
  const declared = new Map<string, SensorCapabilityId>();
  for (const channel of options.definition.sensors.channels) {
    declared.set(channel.channel, channel.capability);
  }
  const bound = new Set<string>();
  for (const producer of options.producers) {
    const capability = declared.get(producer.channel);
    if (capability === undefined) {
      return {
        ok: false,
        code: "unknown-producer-channel",
        detail: `producer channel ${producer.channel} is not declared by the avatar`,
      };
    }
    if (bound.has(producer.channel)) {
      return {
        ok: false,
        code: "duplicate-producer-channel",
        detail: `producer channel ${producer.channel} bound twice`,
      };
    }
    if (capability !== producer.capability) {
      return {
        ok: false,
        code: "producer-capability-mismatch",
        detail: `producer channel ${producer.channel} declares ${producer.capability}; the avatar declared ${capability}`,
      };
    }
    bound.add(producer.channel);
  }
  return { ok: true, host: new SensoryRuntimeHost(options) };
}

/**
 * The sensory runtime host. One instance = one tenant + one composed
 * (restricted) avatar + its producers + the history + the clock.
 */
export class SensoryRuntimeHost {
  readonly #definition: AvatarDefinition;
  readonly #restriction: HostRestriction;
  readonly #tenant: TenantId;
  readonly #producers: readonly SensoryProducerPort[];
  readonly #history: SensoryHistoryPort;
  readonly #clock: ServiceClock;
  readonly #auditRefusals: boolean;
  readonly #effectiveChannels: ReadonlySet<string>;
  readonly #lastEpoch = new Map<string, number>();

  /** Constructed only through {@link bindSensoryHost} (binding coherence enforced). */
  constructor(options: SensoryRuntimeHostOptions) {
    this.#definition = options.definition;
    this.#restriction = options.restriction ?? { denied: [], approvalRequired: [], sandboxed: false };
    this.#tenant = options.tenant;
    this.#producers = [...options.producers];
    this.#history = options.history;
    this.#clock = options.clock;
    this.#auditRefusals = options.recordRefusalsAsPolicy ?? true;
    this.#effectiveChannels = effectiveSensorChannels(options.definition, this.#restriction);
  }

  /** Read model: the composed definition being hosted. */
  get definition(): AvatarDefinition {
    return this.#definition;
  }

  /** Read model: the host restriction in force (R5). */
  get restriction(): HostRestriction {
    return this.#restriction;
  }

  /** Read model: sensor channels that survive the restriction. */
  get effectiveChannels(): readonly string[] {
    return [...this.#effectiveChannels];
  }

  /** Read model: the tenant this host serves. */
  get tenant(): TenantId {
    return this.#tenant;
  }

  /**
   * Poll every producer once under `epoch`/`tick`, admit frames through
   * the codec, apply the R5 restriction projection (restricted channels
   * produce NOTHING, recorded as policy), enforce epoch monotonicity,
   * and append admitted samples to the history (E10 idempotent).
   */
  poll(epoch: SessionEpoch, tick: Tick): SensoryPollReport {
    const refusals: { code: CodecRefusalCode; detail: string }[] = [];
    const policyEvents: SensoryPolicyEvent[] = [];
    const restrictedChannels: string[] = [];
    let framesSeen = 0;
    let admitted = 0;
    let appended = 0;
    let recordedReceipts = 0;

    for (const producer of this.#producers) {
      if (!this.#effectiveChannels.has(producer.channel)) {
        const frames = producer.poll();
        framesSeen += frames.length;
        restrictedChannels.push(producer.channel);
        policyEvents.push({
          kind: "channel-restricted",
          channel: producer.channel,
          detail: `R5 restriction denied capability ${producer.capability}; ${frames.length} frame(s) produced nothing`,
        });
        continue;
      }
      for (const frame of producer.poll()) {
        framesSeen += 1;
        if (typeof frame !== "object" || frame === null) {
          // Untrusted producer edge: garbage frames are audited, never fatal.
          refusals.push({ code: "invalid-channel", detail: "producer emitted a non-object frame" });
          policyEvents.push({
            kind: "codec-refusal",
            channel: producer.channel,
            detail: "invalid-channel: producer emitted a non-object frame",
          });
          continue;
        }
        const lastEpoch = this.#lastEpoch.get(producer.channel) ?? 0;
        const frameEpoch = Number(frame.epoch);
        if (Number.isSafeInteger(frameEpoch) && frameEpoch < lastEpoch) {
          policyEvents.push({
            kind: "epoch-regression",
            channel: producer.channel,
            detail: `frame epoch ${frameEpoch} regressed below last admitted epoch ${lastEpoch}`,
          });
          continue;
        }
        const admission: CodecAdmission = admitFrame(frame, { epoch, tick });
        if (!admission.ok) {
          refusals.push({ code: admission.code, detail: admission.detail });
          if (this.#auditRefusals) {
            policyEvents.push({
              kind: "codec-refusal",
              channel: producer.channel,
              detail: `${admission.code}: ${admission.detail}`,
            });
          }
          continue;
        }
        const outcome = this.#append(admission.sample);
        admitted += 1;
        if (outcome.status === "appended") {
          appended += 1;
        } else {
          recordedReceipts += 1;
          policyEvents.push({
            kind: "duplicate-receipt",
            channel: producer.channel,
            detail: "identical content key returned the recorded receipt (E10)",
          });
        }
        this.#lastEpoch.set(producer.channel, Number(admission.sample.epoch));
      }
    }

    return {
      epoch,
      producersPolled: this.#producers.length,
      framesSeen,
      admitted,
      restrictedChannels,
      refusals,
      policyEvents,
      appended,
      recordedReceipts,
    };
  }

  /** Append one admitted sample (content-keyed, E10-idempotent). */
  #append(sample: SensorySample): { status: "appended" | "recorded-receipt" } {
    const contentKey = sampleContentKey({
      tenant: this.#tenant,
      channel: sample.channel,
      capability: sample.capability,
      contentDigest: sample.contentDigest,
      epoch: sample.epoch,
    });
    const recordedAt = this.#clock.now();
    const record: SensoryHistoryRecord = {
      recordId: historyRecordIdOf({ tenant: this.#tenant, contentKey, recordedAt }),
      contentKey,
      tenant: this.#tenant,
      channel: sample.channel,
      capability: sample.capability,
      epoch: sample.epoch,
      tick: sample.tick,
      contentDigest: String(sample.contentDigest),
      payloadValueForm: payloadValueForm(sample.payload).kind,
      recordedAt,
    };
    const outcome = this.#history.append(record);
    return { status: outcome.status };
  }
}
