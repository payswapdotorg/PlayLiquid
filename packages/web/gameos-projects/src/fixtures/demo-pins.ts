/**
 * DEMO COMPOSITION PINS (part of the demo fixture): REAL sealed
 * package-system records with REAL `checkReleaseGate` verdicts (R19
 * fail-closed) — including the one deliberately BLOCKED pin (license
 * declared but not verified). TEST-SUPPORT / DEMO FIXTURE ONLY (lock
 * rule 44).
 */

import {
  checkReleaseGate,
  parseSemver,
  sealPackageRecord,
} from "../../../../package-system/src/index.ts";
import type { PackageMetadata, PackageRecord } from "../../../../package-system/src/index.ts";
import type { CompositionPin } from "../view/projects-snapshot.ts";

/** Gate-passing metadata (the package-contract's minimal honest record). */
function gatePassingMetadata(overrides?: Partial<PackageMetadata>): PackageMetadata {
  return {
    dependencies: [],
    providedCapabilities: [],
    requiredCapabilities: [],
    permissions: [],
    license: { spdxExpression: "Apache-2.0", status: "verified" },
    provenance: {
      origin: { type: "original" },
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      transformationHistory: [{ kind: "author", description: "authored for the demo fixture" }],
      modelProvenance: [],
      generatedByAi: false,
    },
    lineage: { origin: null, parent: null },
    compatibility: { runtimes: ["simulation"], engines: ["native"], targets: [] },
    resources: {},
    evaluationSuites: [],
    artifacts: [],
    extensionPoints: [],
    overlay: null,
    ...overrides,
  };
}

export function sealedRecord(
  kind: PackageRecord["identity"]["kind"],
  id: string,
  version: string,
  metadata?: Partial<PackageMetadata>,
): PackageRecord {
  const version_ = parseSemver(version);
  if (version_ === null) throw new Error(`demo: bad semver literal ${version}`);
  return sealPackageRecord({ identity: { kind, id, version: version_ }, metadata: gatePassingMetadata(metadata) });
}

/** One composition pin: the sealed coordinate + the REAL gate verdict. */
export function pinOf(record: PackageRecord): CompositionPin {
  const gate = checkReleaseGate(record);
  return {
    coordinate: record.identity,
    releaseGate: gate.pass ? "pass" : "blocked",
    failureSummary: gate.pass
      ? null
      : gate.reasons.map((reason) => `${reason.code}: ${reason.message}`).join("; "),
  };
}

const harborWorld = sealedRecord("world", "harbor-world", "1.4.2");
const harborAssets = sealedRecord("assets", "harbor-assets", "0.9.0");
// The one BLOCKED pin: license declared but not verified (R19 fail-closed).
const harborDialogue = sealedRecord("system", "harbor-dialogue-rules", "2.1.0", {
  license: { spdxExpression: "CC-BY-4.0", status: "declared" },
});
const harborEvaluation = sealedRecord("evaluation-suite", "harbor-evaluation", "1.0.3");
const sparkWorld = sealedRecord("world", "spark-garden-world", "0.3.1");
const sparkPalette = sealedRecord("assets", "spark-garden-palette", "0.2.0");
const twinLayout = sealedRecord("world", "twin-factory-layout", "1.0.0");

export {
  harborAssets,
  harborDialogue,
  harborEvaluation,
  harborWorld,
  sparkPalette,
  sparkWorld,
  twinLayout,
};
