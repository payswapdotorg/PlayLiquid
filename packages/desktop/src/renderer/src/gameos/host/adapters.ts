/**
 * DESKTOP HOST PORT ADAPTERS (RW-001): the app-side implementations of the
 * seams the PlayLiquid domain packages deliberately leave to the host —
 * "real persistence, clock, identity/tenancy composition, Lab gap facts
 * and package-registry qualification adapters are app concerns" (each
 * package's own ports docs). This file is that app side for the desktop
 * product shell.
 *
 * Honest scope (stated for the record): every adapter here is
 * session-scoped in-memory. Durable persistence (files, SQLite, the
 * platform services) is main-process work outside RW-001's frozen write
 * surface; the host records this as an explicit environment limitation,
 * never as a faked durable integration.
 *
 * No domain logic lives here: the adapters carry time, memory and lookup
 * facts across the typed seams; every decision stays with the
 * authoritative services behind them (E1/E5 verbatim).
 */

import type {
  LabClockPort,
  LabEvaluationStore,
  LabServiceDocument,
} from "../../../../../../lab-simulation/src/index.ts";
import type {
  LabOrganizationStore,
  LabOrganizationDocument,
} from "../../../../../../lab-organization/src/index.ts";
import type {
  LabLearningDocument,
  LabLearningStore,
} from "../../../../../../lab-learning/src/index.ts";
import type {
  CommunityStore,
  ServiceClock,
  StoredCommunitySnapshot,
  SubjectDirectory,
} from "../../../../../../community/src/index.ts";
import type { RegistryStore } from "../../../../../../package-registry/src/index.ts";
import type { PackageRecord } from "../../../../../../package-system/src/index.ts";
import type {
  ExecutorDispatch,
  ExecutorResult,
  ToolExecutorPort,
} from "../../../../../../tool-fabric-runtime/src/index.ts";
import { asTimestampMs } from "../../../../../../platform-contracts/src/index.ts";
import type { SubjectId, TenantId } from "../../../../../../platform-contracts/src/index.ts";

// ---------------------------------------------------------------------------
// Time (the host IS the time authority; the domains never read a clock)
// ---------------------------------------------------------------------------

/**
 * The wall clock of the desktop host: real time, supplied BY THE HOST
 * through every service's clock port (the domain services stay free of
 * ambient time, E9 — determinism is preserved because callers can still
 * reason over host-supplied timestamps).
 */
export interface DesktopHostClock {
  now(): number;
}

/** Creates the host wall clock (Date-backed, millisecond precision). */
export function createDesktopHostClock(): DesktopHostClock {
  return { now: () => Date.now() };
}

// ---------------------------------------------------------------------------
// Whole-document stores (content-addressed, latest-wins load; E6 shape)
// ---------------------------------------------------------------------------

/** An in-memory latest-document store over any content-addressed shape. */
export interface MemoryDocumentStore<T> {
  readonly save: (document: T) => void;
  readonly load: () => T | undefined;
}

/** Creates an in-memory store for one service document type. */
export function createMemoryDocumentStore<T>(): MemoryDocumentStore<T> {
  let latest: T | undefined;
  return {
    save: (document) => {
      latest = document;
    },
    load: () => latest,
  };
}

/** The Lab simulation persistence port (LabEvaluationStore). */
export function createLabEvaluationStore(): LabEvaluationStore {
  return createMemoryDocumentStore<LabServiceDocument>();
}

/** The Lab organization persistence port (LabOrganizationStore). */
export function createLabOrganizationStore(): LabOrganizationStore {
  return createMemoryDocumentStore<LabOrganizationDocument>();
}

/** The Lab learning persistence port (LabLearningStore). */
export function createLabLearningStore(): LabLearningStore {
  return createMemoryDocumentStore<LabLearningDocument>();
}

// ---------------------------------------------------------------------------
// Community ports (store, clock, subject directory)
// ---------------------------------------------------------------------------

/**
 * The community snapshot persistence adapter: a Map keyed by the
 * content-addressed snapshot id, preserving the port's integrity contract
 * (same id + different bytes is an error; identical re-saves are no-ops).
 */
export function createDesktopCommunityStore(): CommunityStore {
  const byId = new Map<string, StoredCommunitySnapshot>();
  const order: StoredCommunitySnapshot[] = [];
  return {
    save: (snapshot) => {
      const key = String(snapshot.snapshotId);
      const existing = byId.get(key);
      if (existing !== undefined) {
        if (existing.document !== snapshot.document) {
          throw new RangeError(`desktop community store: refusing rewrite of snapshot ${key}`);
        }
        return;
      }
      byId.set(key, snapshot);
      order.push(snapshot);
    },
    list: () => [...order],
    load: (snapshotId) => byId.get(String(snapshotId)),
  };
}

/** The community service clock adapter (host wall time). */
export function createDesktopCommunityClock(host: DesktopHostClock): ServiceClock {
  return { now: () => asTimestampMs(host.now())! };
}

/**
 * The local identity directory: the desktop product's single local
 * operator is both the registered subject AND the maintainer of the local
 * tenant (a single-operator local workspace; community moderation rights
 * belong to that operator by host composition, honestly declared here).
 */
export interface DesktopSubjectDirectory extends SubjectDirectory {
  /** Registers a subject of a tenant (contributor standing). */
  register(tenant: TenantId, subject: SubjectId): void;
  /** Grants the maintainer role to a subject within a tenant. */
  registerMaintainer(tenant: TenantId, subject: SubjectId): void;
}

/** Creates the local identity directory (the community SubjectDirectory seam). */
export function createDesktopSubjectDirectory(): DesktopSubjectDirectory {
  const members = new Set<string>();
  const owners = new Map<string, TenantId>();
  const maintainers = new Set<string>();
  return {
    exists: (tenant, subject) => members.has(`${String(tenant)}|${String(subject)}`),
    tenantOf: (subject) => owners.get(String(subject)),
    isMaintainer: (tenant, subject) => maintainers.has(`${String(tenant)}|${String(subject)}`),
    register: (tenant, subject) => {
      members.add(`${String(tenant)}|${String(subject)}`);
      owners.set(String(subject), tenant);
    },
    registerMaintainer: (tenant, subject) => {
      members.add(`${String(tenant)}|${String(subject)}`);
      owners.set(String(subject), tenant);
      maintainers.add(`${String(tenant)}|${String(subject)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Package registry persistence (the Studio registry's RegistryStore port)
// ---------------------------------------------------------------------------

/** An in-memory package-record store (idempotent per coordinate+digest). */
export function createDesktopRegistryStore(): RegistryStore & {
  readonly count: () => number;
} {
  const byKey = new Map<string, PackageRecord>();
  const keyOf = (record: PackageRecord) =>
    `${record.identity.kind}:${record.identity.id}@${String(record.identity.version)}:${record.identity.contentDigest}`;
  return {
    listRecords: async () => [...byKey.values()],
    putRecord: async (record) => {
      byKey.set(keyOf(record), record);
    },
    count: () => byKey.size,
  };
}

// ---------------------------------------------------------------------------
// Tool fabric executor (honest unavailability; never a fake success)
// ---------------------------------------------------------------------------

/**
 * The desktop tool-fabric executor adapter for the CURRENT host state: the
 * desktop product registers zero tool adapters today, so any dispatch is
 * refused with the executor's own typed refusal code — a loud, honest
 * "unavailable" (lock rule 44 discipline: no faked execution). When a
 * real adapter surface lands, the host swaps this seam for it.
 */
export function createUnavailableToolExecutor(): ToolExecutorPort {
  return {
    execute: async (dispatch: ExecutorDispatch): Promise<ExecutorResult> => {
      void dispatch;
      return {
        outcome: "refused",
        code: "executor/adapter-refused",
        message:
          "PlayLiquid GameOS desktop host: no tool adapters are registered in this host yet — tool execution is unavailable",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Casts host wall time onto the lab clock port shape. */
export function asLabClock(host: DesktopHostClock): LabClockPort {
  return { now: () => host.now() };
}
