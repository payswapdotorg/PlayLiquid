/**
 * HEALTH GATE BINDINGS (PL-044) — host wiring that binds REAL package
 * doors behind the typed gate probes of the health/readiness service.
 *
 * Every binding takes the REAL public object (a package-registry index,
 * an artifact-store CAS, a build-orchestrator service, a
 * security-gameos rights authority, a platform-economy service, a
 * platform-integrity service, a durable worker runtime, a web host
 * composition document) plus the canary inputs the host pins, and returns
 * one {@link HealthGate}. The dependency's typed refusal codes surface
 * VERBATIM in the gate result (E8); a broken dependency is a typed DOWN,
 * never a silent pass (negative-tested in health.test.ts).
 */

import { verifyPackageDigest } from "../../../packages/package-system/src/index.ts";
import type { PackageRecord } from "../../../packages/package-system/src/index.ts";
import type { RegistryCoordinate } from "../../../packages/package-registry/src/index.ts";
import { asSubjectId, asTenantId } from "../../../packages/platform-contracts/src/index.ts";
import { verifySnapshot } from "../../../packages/build-orchestrator/src/index.ts";
import type { StoredBuildSnapshot } from "../../../packages/build-orchestrator/src/index.ts";
import type { RightsAuthority } from "../../../packages/security-gameos/src/index.ts";
import type { AdjudicationResult, RightsRequest } from "../../../packages/security-gameos/src/index.ts";
import type { EconomyService } from "../../../packages/platform-economy/src/index.ts";
import type { IntegrityService } from "../../../packages/platform-integrity/src/index.ts";
import { gateResultOf } from "./health.ts";
import type { HealthGate } from "./health.ts";
import type { DurableWorkerRuntime } from "./worker.ts";
import { verifyWebHostDocument } from "./web-host.ts";
import type { WebHostDocument } from "./web-host.ts";

/** The minimal registry read seam both the index and the facade satisfy. */
export interface RegistryReadDoor {
  get(coordinate: RegistryCoordinate): PackageRecord | null;
}

/** The minimal CAS read seam the artifact store satisfies (fail-closed fetch). */
export interface ArtifactFetchDoor {
  fetch(digest: string): { ok: true; bytes: Uint8Array } | { ok: false; code: string; message: string };
}

/** The minimal snapshot seam the build-orchestrator service satisfies. */
export interface BuildSnapshotDoor {
  snapshot(): StoredBuildSnapshot;
}

/**
 * Gate `package-registry`: the canary record must resolve at its pinned
 * coordinate AND its sealed content digest must still verify (E8).
 */
export function bindRegistryGate(deps: {
  readonly registry: RegistryReadDoor;
  readonly canary: RegistryCoordinate;
}): HealthGate {
  return {
    door: "package-registry",
    probe: () => {
      const record = deps.registry.get(deps.canary);
      if (record === null) {
        return gateResultOf("package-registry", {
          ok: false,
          code: "missing-canary",
          detail: `canary record ${deps.canary.kind}/${String(deps.canary.id)}@${String(deps.canary.version)} did not resolve in the registry`,
        });
      }
      if (!verifyPackageDigest(record)) {
        return gateResultOf("package-registry", {
          ok: false,
          code: "digest-mismatch",
          detail: `canary record ${String(record.identity.id)} no longer matches its sealed content digest (E8)`,
        });
      }
      return gateResultOf("package-registry", {
        ok: true,
        detail: `canary ${String(record.identity.id)}@${String(record.identity.version)} resolves and verifies`,
      });
    },
  };
}

/** Gate `artifact-cas`: the canary blob must fetch with fail-closed verification. */
export function bindArtifactCasGate(deps: {
  readonly artifacts: ArtifactFetchDoor;
  readonly canaryDigest: string;
}): HealthGate {
  return {
    door: "artifact-cas",
    probe: () => {
      const fetched = deps.artifacts.fetch(deps.canaryDigest);
      return gateResultOf("artifact-cas", {
        ok: fetched.ok,
        code: fetched.ok ? undefined : fetched.code,
        detail: fetched.ok
          ? `canary blob ${deps.canaryDigest.slice(0, 12)}… fetched and verified (${String(fetched.bytes.byteLength)} bytes)`
          : fetched.message,
      });
    },
  };
}

/**
 * Gate `build-orchestrator`: the service's own content-addressed snapshot
 * must verify (structure + content address + append-only event log).
 */
export function bindBuildOrchestratorGate(deps: {
  readonly builds: BuildSnapshotDoor;
}): HealthGate {
  return {
    door: "build-orchestrator",
    probe: () => {
      const snapshot = deps.builds.snapshot();
      const verification = verifySnapshot(snapshot);
      return gateResultOf("build-orchestrator", {
        ok: verification.ok,
        code: verification.ok ? undefined : verification.code,
        detail: verification.ok
          ? `build-orchestrator snapshot rev ${String(snapshot.revision)} verifies`
          : verification.message,
      });
    },
  };
}

/**
 * Gate `rights-authority`: the authority must DECIDE the canary request
 * (granted or refused — both are healthy typed answers) and its own
 * state snapshot door must answer.
 */
export function bindRightsAuthorityGate(deps: {
  readonly authority: RightsAuthority;
  readonly canaryRequest: RightsRequest;
  readonly actor: string;
  readonly tenant: string;
}): HealthGate {
  return {
    door: "rights-authority",
    probe: () => {
      const decision: AdjudicationResult = deps.authority.decide(deps.canaryRequest);
      if (decision.granted !== true && decision.granted !== false) {
        return gateResultOf("rights-authority", {
          ok: false,
          code: "malformed-decision",
          detail: "the rights authority returned a malformed decision",
        });
      }
      const snapshot = deps.authority.snapshot(deps.actor, deps.tenant);
      return gateResultOf("rights-authority", {
        ok: snapshot.ok,
        code: snapshot.ok ? undefined : snapshot.code,
        detail: snapshot.ok
          ? `rights authority decides (canary ${decision.granted ? "granted" : `refused: ${String(decision.code)}`}) and snapshot rev ${String(snapshot.revision)} answers`
          : snapshot.detail,
      });
    },
  };
}

/** Gate `platform-economy`: the economy service's snapshot door must answer. */
export function bindEconomyGate(deps: { readonly economy: EconomyService }): HealthGate {
  return {
    door: "platform-economy",
    probe: () => {
      const snapshot = deps.economy.snapshot();
      return gateResultOf("platform-economy", {
        ok: snapshot.ok,
        code: snapshot.ok ? undefined : snapshot.code,
        detail: snapshot.ok
          ? `economy snapshot rev ${String(snapshot.revision)} answers`
          : snapshot.detail,
      });
    },
  };
}

/**
 * Gate `platform-integrity`: a standing read must answer. `no-recorded-
 * verdict` is an honest ABSENCE (DEGRADED, E11 — never a fake pass);
 * every other refusal is a DOWN with the code verbatim.
 */
export function bindIntegrityGate(deps: {
  readonly integrity: IntegrityService;
  readonly reader: { readonly subject: string; readonly tenant: string };
  readonly canarySubject: string;
}): HealthGate {
  return {
    door: "platform-integrity",
    probe: () => {
      const standing = deps.integrity.standingFor(
        asSubjectId(deps.reader.subject)!,
        asTenantId(deps.reader.tenant)!,
        asSubjectId(deps.canarySubject)!,
      );
      return gateResultOf("platform-integrity", {
        ok: standing.ok,
        code: standing.ok ? undefined : standing.code,
        degradedWhenAbsent: !standing.ok && standing.code === "no-recorded-verdict",
        detail: standing.ok
          ? `integrity standing answers (${String(standing.verdict.kind)})`
          : standing.detail,
      });
    },
  };
}

/** Gate `ops-worker-journal`: the worker's own journal freshness (E10). */
export function bindWorkerJournalGate(deps: {
  readonly worker: DurableWorkerRuntime;
  readonly clock: { now(): number };
  readonly maxAgeMs: number;
}): HealthGate {
  return {
    door: "ops-worker-journal",
    probe: () => {
      const freshness = deps.worker.freshness();
      if (freshness.entries === 0) {
        return gateResultOf("ops-worker-journal", {
          ok: false,
          code: "empty-journal",
          detail: "the worker journal is empty (E10): no durable activity recorded",
        });
      }
      const ageMs = deps.clock.now() - (freshness.lastEntryAt ?? 0);
      const fresh = ageMs <= deps.maxAgeMs;
      return gateResultOf("ops-worker-journal", {
        ok: fresh,
        code: fresh ? undefined : "stale-journal",
        detail: fresh
          ? `journal fresh: ${String(freshness.entries)} entries, age ${String(ageMs)}ms`
          : `journal stale: age ${String(ageMs)}ms > bound ${String(deps.maxAgeMs)}ms (E10)`,
      });
    },
  };
}

/** Gate `web-host-composition`: the host document must verify (E11). */
export function bindWebHostGate(deps: { readonly host: WebHostDocument }): HealthGate {
  return {
    door: "web-host-composition",
    probe: () => {
      const verification = verifyWebHostDocument(deps.host);
      return gateResultOf("web-host-composition", {
        ok: verification.ok,
        code: verification.ok ? undefined : verification.code,
        detail: verification.ok
          ? `web host composition verifies (${String(verification.value.mounts)} mounts)`
          : verification.detail,
      });
    },
  };
}
