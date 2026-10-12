/**
 * TEST-SUPPORT FIXTURES (PL-044) — deterministic hostile doubles for the
 * deployment verifier's E8 negative corpus (lock rule 44: clearly labeled
 * TEST-SUPPORT, never a production integration — E11).
 *
 * These are the ADVERSARY'S tools, each honest about what it models:
 * - a RELAXED registry (package-registry's own documented
 *   `enforceReleaseGate: false` opt-out) that admits R19-gate-failing
 *   records — the verifier must catch what the registry's admission
 *   policy did not (provenance is a DEPLOYMENT gate, never a trust);
 * - a LYING registry door that returns a tampered record (content no
 *   longer matches its sealed digest) — a broken dependency is a typed
 *   DOWN-refusal, never a silent pass;
 * - immutable plan/unit copy helpers with one field tampered (the
 *   E8 tamper rows), and a deterministic single-hex-char digest flip.
 */

import type { PackageMetadata, PackageRecord } from "../../packages/package-system/src/index.ts";
import { createRegistryIndex } from "../../packages/package-registry/src/index.ts";
import { publishRecordToCas } from "../../packages/package-registry/src/index.ts";
import { createArtifactStore } from "../../packages/artifact-store/src/index.ts";
import { createMemoryProfileSource } from "../../packages/target-builds/src/index.ts";
import type { DeploymentDoors } from "./ports.ts";
import type { DeploymentPlan, DeploymentUnit } from "./model.ts";
import { createCorpusProfiles, honestTopologyUnits, sealCorpusRecord, honestTopologyPlan } from "./corpus.ts";
import type { TargetProfileBundle } from "../../packages/target-builds/src/index.ts";
import { asSubjectId } from "../../packages/platform-contracts/src/index.ts";

/**
 * A hostile door bundle over the given records: a RELAXED registry
 * (release-gate opt-out) + the CAS holding each record's blob + the
 * corpus profile source (or the caller's bundle table — `null` entries
 * model UNPUBLISHED profiles). Records that FAIL the R19 gate can be
 * admitted here (structural validation still applies — package-registry
 * never skips it), which is exactly the relaxed-index scenario the
 * deployment verifier must defend against.
 */
export function createHostileDoors(
  records: readonly PackageRecord[],
  bundles?: readonly (readonly ["web" | "dedicated-server", TargetProfileBundle | null])[],
): DeploymentDoors & { readonly registry: ReturnType<typeof createRegistryIndex> } {
  const registry = createRegistryIndex({ enforceReleaseGate: false });
  const cas = createArtifactStore();
  for (const record of records) {
    const published = registry.publish(record);
    if (!published.ok) throw new Error(`hostile record ${record.identity.id} refused even by the relaxed index: ${published.ok ? "" : published.message}`);
    const stored = publishRecordToCas(cas, record);
    if (!stored.ok) throw new Error(`hostile record ${record.identity.id} failed CAS publication: ${stored.ok ? "" : stored.message}`);
  }
  return { registry, cas, profiles: bundles === undefined ? createCorpusProfiles() : createMemoryProfileSource(bundles) };
}

/**
 * Hostile doors holding the WHOLE corpus PLUS one bad record: plans that
 * patch a later unit still verify their earlier units, so the bad
 * record's own refusal code must surface (not an early unknown-artifact
 * on an unpatched unit).
 */
export function hostileDoorsWithBadRecord(bad: PackageRecord): DeploymentDoors & { readonly registry: ReturnType<typeof createRegistryIndex> } {
  return createHostileDoors([...honestTopologyUnits().map((entry) => entry.record), bad]);
}

/** A record whose license state is present but NOT verified (R19). */
export function recordWithUnverifiedLicense(id: string): PackageRecord {
  return sealCorpusRecord(id, { license: { spdxExpression: "Proprietary", status: "declared" } });
}

/** A record with an EMPTY transformation history (provenance incomplete, R19). */
export function recordWithEmptyHistory(id: string): PackageRecord {
  return sealCorpusRecord(id, { provenance: { origin: { type: "original" }, sourceCommit: "0123456789abcdef0123456789abcdef01234567", transformationHistory: [], modelProvenance: [], generatedByAi: false } });
}

/** An AI-generated record with NO model provenance entries (R19). */
export function recordWithUndisclosedModel(id: string): PackageRecord {
  return sealCorpusRecord(id, { provenance: { origin: { type: "original" }, sourceCommit: "0123456789abcdef0123456789abcdef01234567", transformationHistory: [{ kind: "author", description: "authored for the negative corpus" }], modelProvenance: [], generatedByAi: true } });
}

/**
 * A record whose declared content digest does NOT match its content (a
 * hand-minted tamper: the metadata is edited AFTER sealing, so
 * package-system's own `verifyPackageDigest` fails). Only a LYING
 * registry door would ever resolve it — the tampered-artifact row.
 */
export function tamperedRecord(id: string, metadataOverride?: Partial<PackageMetadata>): PackageRecord {
  const sealed = sealCorpusRecord(id, metadataOverride);
  return { ...sealed, metadata: { ...sealed.metadata, resources: { minCpuCores: 999 } } };
}

/** A registry door that returns whatever the adversary pins (a lying door). */
export function lyingRegistryDoor(record: PackageRecord): { getByDigest(digest: string): PackageRecord | null } {
  return { getByDigest: (digest: string) => (digest === record.identity.contentDigest ? record : null) };
}

/** Deterministically flips one HEX character of a digest (the tamper row; `hexOffset` indexes the 64 hex chars). */
export function flipDigestChar(digest: string, hexOffset = 0): string {
  const prefix = digest.slice(0, digest.indexOf(":") + 1);
  const hex = digest.slice(prefix.length);
  const at = Math.min(hexOffset, hex.length - 1);
  const current = hex[at];
  if (current === undefined) throw new Error("digest has no hex part");
  const flipped = current === "a" ? "b" : "a";
  return `${prefix}${hex.slice(0, at)}${flipped}${hex.slice(at + 1)}`;
}

/** An immutable single-unit patch of a plan (copy + replace; E8 rows). */
export function withUnitPatched(plan: DeploymentPlan, unitId: string, patch: (unit: DeploymentUnit) => DeploymentUnit): DeploymentPlan {
  return { ...plan, units: plan.units.map((unit) => (unit.unitId === unitId ? patch(unit) : unit)) };
}

/** The honest-topology plan with one unit's artifact digest tampered. */
export function planWithTamperedArtifactDigest(unitId: string): DeploymentPlan {
  return withUnitPatched(honestTopologyPlan(), unitId, (unit) => ({ ...unit, artifactDigest: flipDigestChar(unit.artifactDigest) }));
}

/** The honest-topology plan with one unit carrying a foreign-tenant grant. */
export function planWithCrossTenantScope(unitId: string, foreignTenant: string): DeploymentPlan {
  return withUnitPatched(honestTopologyPlan(), unitId, (unit) => ({
    ...unit,
    rightsScope: [{ tenant: foreignTenant as DeploymentUnit["rightsScope"][number]["tenant"], subject: (unit.rightsScope[0]?.subject ?? asSubjectId("subject-x")!) as DeploymentUnit["rightsScope"][number]["subject"], capability: "social", permissions: ["read"] }],
  }));
}

/** The honest-topology plan with one unit citing an unknown readiness door. */
export function planWithUnknownHealthDoor(unitId: string): DeploymentPlan {
  return withUnitPatched(honestTopologyPlan(), unitId, (unit) => ({ ...unit, healthGates: ["not-a-door" as DeploymentUnit["healthGates"][number]] }));
}
