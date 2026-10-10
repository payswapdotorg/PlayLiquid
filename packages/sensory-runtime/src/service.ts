/**
 * THE SENSORY SERVICE SEAM (PL-027) — the tenant-facing door over one
 * or more sensory runtime hosts. Owns:
 *
 * - HOST REGISTRATION: binding a composed avatar + producers into a
 *   {@link SensoryRuntimeHost} under a tenant (binding refusals are
 *   typed: unknown/duplicate/mismatched producer channels);
 * - TENANT-SCOPED POLLS: `poll(tenant, ...)` drives every host of that
 *   tenant; cross-tenant callers are refused via platform-contracts'
 *   `checkTenantIsolation` (R20 — the platform tenancy authority);
 * - TENANT-SCOPED READS: history reads, channel reads and content-key
 *   lookups are refused cross-tenant (`cross-tenant` typed refusal).
 *
 * One authority per concern: the service OWNS the host registry (its
 * single mutable state, E1); the codec owns admission; the host owns
 * the poll loop; the history port owns the records. The service is a
 * door, not a second runtime.
 *
 * Async/stateful documentation: see ports.ts. The service adds one
 * rule: hosts are registered per (tenant, avatarId) — a duplicate
 * registration for the same avatar under a tenant is a typed refusal
 * (`host-already-bound`), and the existing host is NEVER replaced (E10
 * spirit: registered execution bindings are stable).
 *
 * Pure domain: no IO, no timers, no globals; the clock arrives by
 * injection (E3/E9).
 */

import type { AvatarDefinition } from "@playliquid/avatar-runtime";
import type { HostRestriction } from "@playliquid/game-contracts";
import { asSubjectId, asTenantId, checkTenantIsolation } from "@playliquid/platform-contracts";
import type { SubjectId, TenantId } from "@playliquid/platform-contracts";
import type { ContentDigest } from "@playliquid/package-system";
import type { SessionEpoch, Tick } from "@playliquid/runtime-contracts";
import { bindSensoryHost } from "./runtime.ts";
import type { HostBindingResult, SensoryPollReport, SensoryRuntimeHost } from "./runtime.ts";
import type { SensoryHistoryPort, SensoryHistoryRecord, SensoryProducerPort, ServiceClock } from "./ports.ts";

/** Who is calling (tenant + subject claim; identity authority is elsewhere). */
export interface SensoryCaller {
  readonly tenant: TenantId;
  readonly subject: SubjectId;
}

/** Construction options for {@link SensoryService}. */
export interface SensoryServiceOptions {
  readonly history: SensoryHistoryPort;
  readonly clock: ServiceClock;
}

/** Typed refusal codes of the service door. */
export type SensoryServiceRefusalCode =
  | "invalid-tenant"
  | "invalid-subject"
  | "cross-tenant"
  | "host-already-bound"
  | "host-unknown"
  | "binding-refused";

/** Host registration result. */
export type RegisterHostResult =
  | { readonly ok: true; readonly host: SensoryRuntimeHost }
  | { readonly ok: false; readonly code: SensoryServiceRefusalCode; readonly detail: string };

/** Tenant-scoped poll result. */
export type ServicePollResult =
  | { readonly ok: true; readonly reports: readonly SensoryPollReport[] }
  | { readonly ok: false; readonly code: SensoryServiceRefusalCode; readonly detail: string };

/** Typed refusal codes of tenant-scoped reads. */
export type SensoryReadRefusalCode = "invalid-tenant" | "invalid-subject" | "cross-tenant";

/** Tenant-scoped read result. */
export type SensoryReadResult =
  | { readonly ok: true; readonly records: readonly SensoryHistoryRecord[] }
  | { readonly ok: false; readonly code: SensoryReadRefusalCode; readonly detail: string };

/** Tenant-scoped content-key lookup result. */
export type FindByKeyResult =
  | { readonly ok: true; readonly record: SensoryHistoryRecord }
  | { readonly ok: false; readonly code: SensoryReadRefusalCode | "key-unknown"; readonly detail: string };

/** One host registration request. */
export interface RegisterHostRequest {
  readonly tenant: TenantId;
  readonly avatarKey: string;
  readonly definition: AvatarDefinition;
  readonly restriction?: HostRestriction;
  readonly producers: readonly SensoryProducerPort[];
}

/**
 * The tenant-facing sensory service. One instance = one history + one
 * clock + the per-tenant host registry (its single mutable state).
 */
export class SensoryService {
  readonly #history: SensoryHistoryPort;
  readonly #clock: ServiceClock;
  readonly #hosts = new Map<string, { readonly tenant: TenantId; readonly host: SensoryRuntimeHost }>();

  constructor(options: SensoryServiceOptions) {
    this.#history = options.history;
    this.#clock = options.clock;
  }

  /**
   * Register a host: bind a composed avatar (restriction included) to
   * producers under a tenant. Binding coherence is enforced by the host
   * binder; duplicate (tenant, avatarKey) registrations are refused.
   */
  registerHost(caller: SensoryCaller, request: RegisterHostRequest): RegisterHostResult {
    const tenantCheck = this.#checkCallerTenant(caller, request.tenant);
    if (!tenantCheck.ok) return tenantCheck;
    const key = `${String(request.tenant)}:${request.avatarKey}`;
    if (this.#hosts.has(key)) {
      return refuse("host-already-bound", `avatar ${request.avatarKey} already has a host under this tenant`);
    }
    const binding: HostBindingResult = bindSensoryHost({
      definition: request.definition,
      ...(request.restriction === undefined ? {} : { restriction: request.restriction }),
      tenant: request.tenant,
      producers: request.producers,
      history: this.#history,
      clock: this.#clock,
    });
    if (!binding.ok) {
      return refuse("binding-refused", `${binding.code}: ${binding.detail}`);
    }
    this.#hosts.set(key, { tenant: request.tenant, host: binding.host });
    return { ok: true, host: binding.host };
  }

  /**
   * Poll every host of the caller's tenant (tenant-scoped; a caller
   * whose claim mismatches the host's tenant is refused — R20).
   */
  poll(caller: SensoryCaller, epoch: SessionEpoch, tick: Tick): ServicePollResult {
    const callerCheck = this.#checkCaller(caller);
    if (!callerCheck.ok) return callerCheck;
    const reports: SensoryPollReport[] = [];
    for (const entry of this.#hosts.values()) {
      if (entry.tenant !== caller.tenant) continue;
      reports.push(entry.host.poll(epoch, tick));
    }
    return { ok: true, reports };
  }

  /** Poll one registered host of the caller's tenant by avatar key. */
  pollHost(caller: SensoryCaller, avatarKey: string, epoch: SessionEpoch, tick: Tick): ServicePollResult {
    const callerCheck = this.#checkCaller(caller);
    if (!callerCheck.ok) return callerCheck;
    const entry = this.#hosts.get(`${String(caller.tenant)}:${avatarKey}`);
    if (entry === undefined) {
      return refuse("host-unknown", `no sensory host registered for avatar ${avatarKey} under this tenant`);
    }
    return { ok: true, reports: [entry.host.poll(epoch, tick)] };
  }

  /** Tenant-scoped full history read (R20: cross-tenant refused). */
  historyOf(caller: SensoryCaller, tenant: TenantId): SensoryReadResult {
    const tenantCheck = this.#checkCallerTenant(caller, tenant);
    if (!tenantCheck.ok) return tenantCheck;
    return { ok: true, records: this.#history.read(tenant) };
  }

  /** Tenant+channel-scoped history read. */
  channelHistoryOf(caller: SensoryCaller, tenant: TenantId, channel: string): SensoryReadResult {
    const tenantCheck = this.#checkCallerTenant(caller, tenant);
    if (!tenantCheck.ok) return tenantCheck;
    return { ok: true, records: this.#history.readChannel(tenant, channel) };
  }

  /** Tenant-scoped content-key lookup (cross-tenant probes refused). */
  findByKey(caller: SensoryCaller, tenant: TenantId, contentKey: ContentDigest): FindByKeyResult {
    const tenantCheck = this.#checkCallerTenant(caller, tenant);
    if (!tenantCheck.ok) return tenantCheck;
    const record = this.#history.findByKey(tenant, contentKey);
    if (record === undefined) {
      return refuse("key-unknown", "no record under this content key in this tenant");
    }
    return { ok: true, record };
  }

  // ---------------------------------------------------------------------------
  // Internal gates
  // ---------------------------------------------------------------------------

  #checkCaller(caller: SensoryCaller): { ok: true } | { ok: false; code: SensoryServiceRefusalCode; detail: string } {
    if (asTenantId(String(caller.tenant)) === undefined) {
      return { ok: false, code: "invalid-tenant", detail: "caller tenant claim is not a valid tenant id" };
    }
    if (asSubjectId(String(caller.subject)) === undefined) {
      return { ok: false, code: "invalid-subject", detail: "caller subject claim is not a valid subject id" };
    }
    return { ok: true };
  }

  #checkCallerTenant(
    caller: SensoryCaller,
    tenant: TenantId,
  ): { ok: true } | { ok: false; code: SensoryReadRefusalCode; detail: string } {
    const callerCheck = this.#checkCaller(caller);
    if (!callerCheck.ok) {
      return { ok: false, code: callerCheck.code as SensoryReadRefusalCode, detail: callerCheck.detail };
    }
    if (asTenantId(String(tenant)) === undefined) {
      return { ok: false, code: "invalid-tenant", detail: "resource tenant is not a valid tenant id" };
    }
    const isolation = checkTenantIsolation({ tenant: caller.tenant }, { tenant });
    if (!isolation.ok) {
      return { ok: false, code: "cross-tenant", detail: "cross-tenant access refused (R20)" };
    }
    return { ok: true };
  }
}

function refuse<C extends string>(code: C, detail: string): { ok: false; code: C; detail: string } {
  return { ok: false, code, detail };
}
