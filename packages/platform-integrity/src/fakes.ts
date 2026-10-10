/**
 * DETERMINISTIC IN-MEMORY FAKES — TEST/HARNESS doubles (PL-018).
 *
 * The three service ports (store, clock, grants) get in-memory
 * implementations mirroring the platform-leaderboard/platform-economy
 * precedent: the store is content-addressed and REFUSES conflicting
 * rewrites of the same snapshot id (E10), the clock is fixed and
 * manually advanced, the grant directory is additive and revocable.
 *
 * Behavioral trace fixtures build VERIFIED replay artifacts: every trace
 * is sealed through @playliquid/replay's own `sealCommandStream` (so
 * admission verification passes on the honest path), with two canonical
 * shapes — human-like (irregular gaps, varied kinds, player-input
 * origins) and machine-like (constant gaps, one kind, broker-mediated
 * avatar origins) — plus re-execution observations (match at an explicit
 * coverage, proven divergence, honest inconclusive). All values are
 * fixed constants: no randomness anywhere (E9).
 *
 * Real persistence, time, grant directories, replay sources and
 * re-execution launchers are host concerns.
 */

import type {
  ScopedCapabilityGrant,
  SubjectId,
  TenantId,
  TimestampMs,
} from "@playliquid/platform-contracts";
import { asTimestampMs, asSubjectId, asTenantId } from "@playliquid/platform-contracts";
import type { CommandStreamArtifact, RecordedCommand, IntegrityVerdict } from "@playliquid/replay";
import { sealCommandStream } from "@playliquid/replay";
import type { RuntimeCommandEnvelope } from "@playliquid/runtime-contracts";
import { asTimestamp } from "@playliquid/runtime-contracts";
import type { ReplayReexecutionObservation } from "./admission.ts";
import type { StoredIntegritySnapshot } from "./ports.ts";
import type { IntegrityStore, GrantDirectory } from "./ports.ts";

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** In-memory content-addressed snapshot store (E10: immutable saves). */
export function createMemoryIntegrityStore(): {
  readonly store: IntegrityStore;
  readonly records: () => readonly StoredIntegritySnapshot[];
} {
  const saved = new Map<string, StoredIntegritySnapshot>();
  return {
    store: {
      save(snapshot: StoredIntegritySnapshot): void {
        const existing = saved.get(snapshot.snapshotId);
        if (existing !== undefined && existing.document !== snapshot.document) {
          throw new RangeError(
            `integrity-store: refusing rewrite of immutable snapshot ${snapshot.snapshotId}`,
          );
        }
        saved.set(snapshot.snapshotId, snapshot);
      },
      list(): readonly StoredIntegritySnapshot[] {
        return [...saved.values()].sort((a, b) => a.revision - b.revision);
      },
      load(snapshotId: StoredIntegritySnapshot["snapshotId"]): StoredIntegritySnapshot | undefined {
        return saved.get(snapshotId);
      },
    },
    records: () => [...saved.values()].sort((a, b) => a.revision - b.revision),
  };
}

/** Fixed manually-advanced clock (the only time the service ever sees). */
export function createFixedClock(startMs = 1_000): {
  readonly clock: { readonly now: () => TimestampMs };
  readonly advance: (ms: number) => void;
  readonly now: () => number;
} {
  let current = startMs;
  return {
    clock: { now: () => current as TimestampMs },
    advance: (ms: number): void => {
      current += ms;
    },
    now: () => current,
  };
}

/** In-memory additive/revocable grant directory (R20). */
export function createMemoryGrantDirectory(): {
  readonly grantsDirectory: GrantDirectory;
  readonly grant: (grant: ScopedCapabilityGrant) => void;
  readonly revokeAll: () => void;
} {
  const grants: ScopedCapabilityGrant[] = [];
  return {
    grantsDirectory: { grants: () => [...grants] },
    grant: (grant: ScopedCapabilityGrant): void => {
      grants.push(grant);
    },
    revokeAll: (): void => {
      grants.length = 0;
    },
  };
}

/** Full admin grant for the integrity capability (read+submit+administer). */
export function integrityAdminGrant(tenant: TenantId, subject: SubjectId): ScopedCapabilityGrant {
  return { tenant, subject, capability: "integrity", permissions: ["read", "submit", "administer"] };
}

/** Operator grant: read + submit evaluations. */
export function integritySubmitGrant(tenant: TenantId, subject: SubjectId): ScopedCapabilityGrant {
  return { tenant, subject, capability: "integrity", permissions: ["read", "submit"] };
}

// ---------------------------------------------------------------------------
// Behavioral trace fixtures (all deterministic constants)
// ---------------------------------------------------------------------------

const HUMAN_GAPS = [300, 700, 500, 900, 400, 800, 600] as const;
const HUMAN_KINDS = ["world.move", "world.look", "world.interact"] as const;
const MACHINE_GAP = 500;
const MACHINE_KIND = "world.move";

interface TraceSpec {
  readonly nonce: string;
  readonly dueTick: number;
  readonly issuedAt: number;
  readonly kind: string;
  readonly actorClass: "player" | "avatar-agent";
}

function commandEnvelope(spec: TraceSpec): RuntimeCommandEnvelope<never> {
  return {
    commandId: `cmd-${spec.nonce}` as never,
    sessionId: "sess-demo-integrity" as never,
    kind: spec.kind as never,
    epoch: 1 as never,
    actor: { actorClass: spec.actorClass, actorId: "actr-demo-subject" as never },
    origin:
      spec.actorClass === "player"
        ? { kind: "player-input" as const }
        : { kind: "broker-mediated" as const, grantId: "grant-demo-locomotion" as never },
    idempotencyKey: {
      scope: "command" as const,
      actor: "actr-demo-subject" as never,
      nonce: spec.nonce as never,
    },
    issuedAt: asTimestamp(spec.issuedAt),
    payload: { kind: "unit" } as never,
  };
}

function entriesOf(specs: readonly TraceSpec[]): readonly RecordedCommand[] {
  return specs.map((spec, index) => ({
    admissionSeq: index + 1,
    dueTick: spec.dueTick,
    envelope: commandEnvelope(spec),
  }));
}

/**
 * Human-like trace: irregular gaps (CV ≈ 0.33), three command kinds
 * cycling, player-input origins. Sealed into a content-addressed
 * command-stream artifact through replay's own seal oracle.
 */
export function humanLikeTrace(): CommandStreamArtifact {
  const specs: TraceSpec[] = [];
  let issuedAt = 1_000;
  for (let index = 0; index < HUMAN_GAPS.length + 1; index += 1) {
    specs.push({
      nonce: `h-${index + 1}`,
      dueTick: 3 + Math.floor(index / 2),
      issuedAt,
      kind: HUMAN_KINDS[index % HUMAN_KINDS.length]!,
      actorClass: "player",
    });
    issuedAt += HUMAN_GAPS[index] ?? 0;
  }
  return sealCommandStream(entriesOf(specs));
}

/**
 * Machine-like trace: constant gaps (CV = 0, modal share = 1), a single
 * command kind repeated, broker-mediated avatar-agent origins. Sealed
 * the same way — the anti-case for claimed-human sessions. The optional
 * command count lets callers build LARGER evidence bases (the honest
 * sampling margin shrinks as traces grow); the default is the canonical
 * 8-command fixture.
 */
export function machineLikeTrace(commandCount = 8): CommandStreamArtifact {
  const specs: TraceSpec[] = [];
  for (let index = 0; index < commandCount; index += 1) {
    specs.push({
      nonce: `m-${index + 1}`,
      dueTick: 3 + index,
      issuedAt: 1_000 + index * MACHINE_GAP,
      kind: MACHINE_KIND,
      actorClass: "avatar-agent",
    });
  }
  return sealCommandStream(entriesOf(specs));
}

// ---------------------------------------------------------------------------
// Re-execution observation fixtures
// ---------------------------------------------------------------------------

/** A clean re-execution match at an explicit coverage. */
export function matchObservation(
  streamDigest: string,
  coverage = 1,
  totalEventCount = 10,
): ReplayReexecutionObservation {
  const verdict: IntegrityVerdict = {
    kind: "match",
    confidence: coverage,
    sampledEventSeqs: [1, 2, 3],
    verifiedCount: 3,
    totalEventCount,
  };
  return {
    observedAgainst: streamDigest,
    verdict,
    observedAt: asTimestampMs(5_000)!,
  };
}

/** A deterministically proven re-execution divergence. */
export function divergenceObservation(streamDigest: string): ReplayReexecutionObservation {
  const verdict: IntegrityVerdict = {
    kind: "divergence",
    confidence: 1,
    sampledEventSeqs: [2],
    divergences: [{ seq: 2, recordedForm: "e-old", reexecutedForm: "e-new" }],
    totalEventCount: 10,
  };
  return {
    observedAgainst: streamDigest,
    verdict,
    observedAt: asTimestampMs(5_000)!,
  };
}

/** An honest inconclusive re-execution (launcher failure). */
export function inconclusiveObservation(streamDigest: string): ReplayReexecutionObservation {
  const verdict: IntegrityVerdict = {
    kind: "inconclusive",
    confidence: 0,
    reason: { code: "launcher-rejected", detail: "target unavailable" },
  };
  return {
    observedAgainst: streamDigest,
    verdict,
    observedAt: asTimestampMs(5_000)!,
  };
}

// ---------------------------------------------------------------------------
// Convenience identifiers
// ---------------------------------------------------------------------------

/** Canonical tenant id for fixtures. */
export const demoTenant: TenantId = asTenantId("tenant-demo")!;

/** Canonical evaluated subject for fixtures. */
export const demoSubject: SubjectId = asSubjectId("actr-demo-subject")!;

/** Canonical submitting operator for fixtures. */
export const demoOperator: SubjectId = asSubjectId("oper-demo-admin")!;
