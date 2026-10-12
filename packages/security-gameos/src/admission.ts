/**
 * PACKAGE/ARTIFACT ADMISSION GATES (PL-041 composing PL-011) — the pure
 * fail-closed verification a host runs before trusting package content.
 *
 * Composes the REAL authorities, never mirrors them:
 * - the registry must hold a record at the exact pinned coordinate
 *   (`missing-package`) whose content digest equals the pin
 *   (`digest-mismatch` — the PL-011 pin codes);
 * - the record content must resolve through the CAS
 *   (`fetchRecordFromCas`: fetch is integrity-verified by the store, then
 *   re-sealed and digest-checked) — failure codes VERBATIM
 *   (`unknown-digest`, `integrity`, `invalid-record-content`,
 *   `digest-mismatch`, `invalid-record`);
 * - the record must pass package-system's release gate (R19) — reason
 *   codes VERBATIM (`license-missing`, `license-unverified`,
 *   `provenance-incomplete`, `model-provenance-missing`, …): unsigned /
 *   unqualified records and provenance gaps fail closed;
 * - every declared CAS artifact must be present with the declared size
 *   and media type (`verifyRecordArtifacts`: `artifact-missing`,
 *   `artifact-size-mismatch`, `artifact-media-type-mismatch`).
 *
 * Purity: reads only, through the injected read ports. No mutation of
 * the registry, the store, or any sibling state (fail-closed oracle).
 */

import { fetchRecordFromCas, verifyRecordArtifacts } from "@playliquid/package-registry";
import type { RegistryCoordinate } from "@playliquid/package-registry";
import { checkReleaseGate, parseSemver } from "@playliquid/package-system";
import type { PackageRecord, ReleaseGateFailure } from "@playliquid/package-system";
import type { AdmissionRefusalCode } from "./vocabulary.ts";
import type { ArtifactsPort, RegistryReadPort } from "./ports.ts";

/** A tenant-scoped admission request over one pinned package coordinate. */
export interface PackageAdmissionRequest {
  readonly tenant: string;
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly contentDigest: string;
}

/** The typed admission verdict (E8: every refusal carries a frozen code). */
export type PackageAdmissionResult =
  | { readonly admitted: true; readonly record: PackageRecord; readonly verifiedArtifacts: number }
  | {
      readonly admitted: false;
      readonly code: AdmissionRefusalCode;
      readonly detail: string;
      readonly reasons?: readonly ReleaseGateFailure[];
    };

/** The package-system content-digest form: `sha256:<64 lowercase hex>`. */
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

/** THE admission fold (pure). Fail-closed on every gate, in fixed order. */
export function admitPackageRecord(
  request: PackageAdmissionRequest,
  deps: { readonly registry: RegistryReadPort; readonly artifacts: ArtifactsPort },
): PackageAdmissionResult {
  if (
    typeof request.tenant !== "string" ||
    request.tenant.length === 0 ||
    typeof request.id !== "string" ||
    request.id.length === 0 ||
    typeof request.kind !== "string" ||
    request.kind.length === 0
  ) {
    return refused("invalid-request", "admission request is missing tenant/kind/id");
  }
  if (typeof request.contentDigest !== "string" || !SHA256_DIGEST.test(request.contentDigest)) {
    return refused("invalid-request", "content digest is not a sha-256 package digest (`sha256:<hex>`)");
  }
  const version = parseSemver(request.version);
  if (version === null) {
    return refused("invalid-request", `version ${JSON.stringify(request.version)} is not valid semver`);
  }
  const coordinate = {
    kind: request.kind as RegistryCoordinate["kind"],
    id: request.id as RegistryCoordinate["id"],
    version,
  };
  const record = deps.registry.get(coordinate);
  if (record === null) {
    return refused("missing-package", `pin ${request.id}@${request.version} is not published in the registry`);
  }
  if (record.identity.contentDigest !== request.contentDigest) {
    return refused(
      "digest-mismatch",
      `pin ${request.id} expects digest ${request.contentDigest} but the registry records ${record.identity.contentDigest}`,
    );
  }
  const content = fetchRecordFromCas(deps.artifacts, record.identity.contentDigest);
  if (!content.ok) {
    return refused(content.code, content.message);
  }
  const gate = checkReleaseGate(record);
  if (!gate.pass) {
    return {
      admitted: false,
      code: gate.reasons[0]?.code ?? "invalid-record",
      detail: `release gate refused ${request.id}: ${gate.reasons.map((reason) => reason.code).join(", ")}`,
      reasons: gate.reasons,
    };
  }
  const artifacts = verifyRecordArtifacts(record, deps.artifacts);
  if (!artifacts.ok) {
    const problem = artifacts.problems[0]!;
    return refused(problem.code, problem.message);
  }
  return { admitted: true, record, verifiedArtifacts: artifacts.problems.length === 0 ? countArtifacts(record) : 0 };
}

function countArtifacts(record: PackageRecord): number {
  return record.metadata.artifacts.length;
}

function refused(code: AdmissionRefusalCode, detail: string): PackageAdmissionResult {
  return { admitted: false, code, detail };
}
