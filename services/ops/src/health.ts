/**
 * THE HEALTH/READINESS SERVICE (PL-044) — typed UP/DOWN/DEGRADED gates
 * over REAL service doors.
 *
 * READINESS is dependency gates: each gate probes one real door of one
 * real dependency (a registry lookup, a CAS fetch, a build-orchestrator
 * snapshot verification, a rights-authority decision + snapshot, an
 * economy snapshot, an integrity standing read, the worker journal, the
 * web host composition) and classifies the door's typed answer:
 *
 * - UP — the door answered its healthy answer;
 * - DEGRADED — the door answered, but with an honest soft signal (e.g. an
 *   integrity standing that was never recorded — an absence, not a
 *   failure; E11 honesty, never a fake pass);
 * - DOWN — the door refused in a way that means the dependency is broken
 *   (tampered digests, corrupted logs, malformed documents). The
 *   dependency's refusal code surfaces VERBATIM in the gate result (E8:
 *   never swallowed, never a silent pass — tested).
 *
 * LIVENESS is the durable worker's own journal freshness (E10): the
 * runtime is alive when its append-only journal is advancing (age within
 * the host-declared bound under the injected clock).
 *
 * The gates are host-bound: this file owns the vocabulary, the rollup and
 * the typed report; health-bindings.ts binds the REAL packages' public
 * doors behind the gate probes. Purity: no IO, no timers — the clock is
 * injected.
 */

/** Every readiness door id (frozen vocabulary — deployment plans cite these). */
export const OPS_HEALTH_DOORS = Object.freeze([
  "package-registry",
  "artifact-cas",
  "build-orchestrator",
  "rights-authority",
  "platform-economy",
  "platform-integrity",
  "ops-worker-journal",
  "web-host-composition",
] as const);

/** One readiness door id. */
export type OpsHealthDoorId = (typeof OPS_HEALTH_DOORS)[number];

/** Type guard over {@link OpsHealthDoorId}. */
export function isOpsHealthDoor(value: unknown): value is OpsHealthDoorId {
  return typeof value === "string" && (OPS_HEALTH_DOORS as readonly string[]).includes(value);
}

/** One gate's status. */
export type GateStatus = "up" | "degraded" | "down";

/** All gate statuses (frozen). */
export const GATE_STATUSES: readonly GateStatus[] = Object.freeze(["up", "degraded", "down"]);

/** One readiness gate's typed result (refusal codes verbatim, E8). */
export interface GateResult {
  readonly door: OpsHealthDoorId;
  readonly status: GateStatus;
  readonly detail: string;
  /** The dependency's own refusal code, verbatim (E8). */
  readonly refusalCode?: string;
}

/** One host-bound gate: a named probe over one real door. */
export interface HealthGate {
  readonly door: OpsHealthDoorId;
  probe(): GateResult;
}

/** The readiness rollup report. */
export interface ReadinessReport {
  readonly status: GateStatus;
  readonly gates: readonly GateResult[];
  readonly at: number;
}

/** The liveness report (journal freshness, E10). */
export interface LivenessReport {
  readonly status: GateStatus;
  readonly entries: number;
  readonly lastEntryAt: number | undefined;
  readonly ageMs: number | undefined;
  readonly detail: string;
}

/** Construction options. */
export interface OpsHealthOptions {
  readonly gates: readonly HealthGate[];
  readonly clock: { now(): number };
}

/** The health/readiness service (read-only over the bound gates). */
export class OpsHealthService {
  private readonly gates: readonly HealthGate[];
  private readonly clock: { now(): number };

  constructor(options: OpsHealthOptions) {
    this.gates = options.gates;
    this.clock = options.clock;
  }

  /**
   * READINESS: probes every bound gate and rolls up — any DOWN ⇒ DOWN;
   * else any DEGRADED ⇒ DEGRADED; else UP. A gate that THROWS is a DOWN
   * gate with the throw's message (a dependency crash is never a silent
   * pass, E8) — total, never throws itself.
   */
  readiness(): ReadinessReport {
    const gates = this.gates.map((gate) => {
      try {
        return gate.probe();
      } catch (error) {
        return {
          door: gate.door,
          status: "down" as GateStatus,
          detail: `gate probe threw: ${error instanceof Error ? error.message : String(error)}`,
          refusalCode: "probe-threw",
        } satisfies GateResult;
      }
    });
    const status = gates.some((gate) => gate.status === "down")
      ? "down"
      : gates.some((gate) => gate.status === "degraded")
        ? "degraded"
        : "up";
    return { status, gates, at: this.clock.now() };
  }

  /**
   * LIVENESS: the durable worker's own journal freshness (E10). UP while
   * the journal is non-empty and its last entry is within `maxAgeMs` of
   * the injected now; DOWN when stale or empty (an empty journal means
   * the runtime has never durably done anything).
   */
  liveness(worker: { freshness(): { entries: number; lastEntryAt: number | undefined } }, maxAgeMs: number): LivenessReport {
    const freshness = worker.freshness();
    if (freshness.entries === 0) {
      return { status: "down", entries: 0, lastEntryAt: undefined, ageMs: undefined, detail: "the worker journal is empty (E10): the runtime has recorded no durable activity" };
    }
    const last = freshness.lastEntryAt ?? 0;
    const ageMs = this.clock.now() - last;
    if (ageMs > maxAgeMs) {
      return {
        status: "down",
        entries: freshness.entries,
        lastEntryAt: last,
        ageMs,
        detail: `the worker journal is stale: last entry at ${String(last)}, age ${String(ageMs)}ms > bound ${String(maxAgeMs)}ms`,
      };
    }
    return { status: "up", entries: freshness.entries, lastEntryAt: last, ageMs, detail: `journal fresh: ${String(freshness.entries)} entries, age ${String(ageMs)}ms` };
  }
}

/** Classifies a door answer into a gate status (the shared fold). */
export function gateResultOf(
  door: OpsHealthDoorId,
  outcome: { readonly ok: boolean; readonly code?: string; readonly detail: string; readonly degradedWhenAbsent?: boolean },
): GateResult {
  if (outcome.ok) return { door, status: "up", detail: outcome.detail };
  if (outcome.degradedWhenAbsent === true) {
    return { door, status: "degraded", detail: outcome.detail, refusalCode: outcome.code };
  }
  return { door, status: "down", detail: outcome.detail, refusalCode: outcome.code };
}
