/**
 * Pure-check harness (PL-008 evidence).
 *
 * Exercises the full contract path in-memory: fixture inputs → request
 * admission (first + duplicate + collision) → deterministic fake executor
 * → output validation → console vendor gate (fail-closed, then satisfied)
 * → provenance gate. Prints a canonical summary; exit code 0 only when
 * every check passes. Run: `node src/harness.ts`.
 */

import { fixtureAdmittedBuild, fixtureAdmissionContext, fixtureBuildRequest, fixtureConsoleInputs, fixturePackageRecord, fixtureVendorSdkEvidence, fixtureWebInputs, fakeBuildExecutor } from "./fixtures.ts";
import { admitBuildRequest, computeBuildRequestFingerprint } from "./commands.ts";
import { asBuildId } from "./primitives.ts";
import { computeBuildInputsDigest } from "./inputs.ts";
import { validateBuildOutputs } from "./validate.ts";
import { checkBuildProvenanceGate, checkVendorSdkGate } from "./verification.ts";
import { computeBuildManifestDigest } from "./outputs.ts";
import { BUILD_PHASES } from "./stages.ts";

const lines: string[] = [];
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failed += 1;
  lines.push(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` :: ${detail}`}`);
}

// 1. Web (non-gated) path end to end.
const webInputs = fixtureWebInputs();
const webRequest = fixtureBuildRequest(webInputs);
const webAdmission = admitBuildRequest(webRequest, fixtureAdmissionContext(webInputs));
check("web request admitted as first", webAdmission.ok && webAdmission.classification === "first");

const duplicate = admitBuildRequest(webRequest, {
  resolvableDigests: fixtureAdmissionContext(webInputs).resolvableDigests,
  firstEncounter: {
    key: webRequest.idempotency,
    fingerprint: computeBuildRequestFingerprint(webRequest),
    buildId: asBuildId("build-harness-duplicate"),
  },
});
check("repeated request classified duplicate", duplicate.ok && duplicate.classification === "duplicate");

const executor = fakeBuildExecutor();
const admitted = fixtureAdmittedBuild(webRequest, "build-harness-1");
const executed = executor.execute({ request: admitted });
check("fake executor succeeds for web target", executed.ok);
if (executed.ok) {
  const validation = validateBuildOutputs(executed.outputs, webInputs);
  check("web outputs validate against inputs", validation.ok, validation.ok ? "" : JSON.stringify(validation.reasons.map((r) => r.code)));
  lines.push(`INFO web inputs digest: ${computeBuildInputsDigest(webInputs)}`);
}

// 2. Console path: fails closed without vendor evidence, passes with it.
const consoleInputs = fixtureConsoleInputs();
const consoleRequest = fixtureBuildRequest(consoleInputs);
const consoleAdmitted = fixtureAdmittedBuild(consoleRequest, "build-harness-2");
const refused = executor.execute({ request: consoleAdmitted });
check(
  "console execution refused without vendor evidence",
  !refused.ok && refused.code === "vendor-evidence-required",
);

const satisfied = executor.execute({
  request: consoleAdmitted,
  vendorEvidence: [fixtureVendorSdkEvidence(consoleInputs)],
});
check("console execution succeeds with authorized vendor evidence", satisfied.ok);
if (satisfied.ok) {
  const manifestDigest = computeBuildManifestDigest(satisfied.outputs.manifest);
  const gate = checkVendorSdkGate({
    vendorGate: consoleInputs.targetProfile.vendorGate,
    manifestDigest,
    evidence: satisfied.outputs.verification,
  });
  check("console vendor gate passes over produced evidence", gate.pass);
  const validation = validateBuildOutputs(satisfied.outputs, consoleInputs);
  check("console outputs validate against inputs", validation.ok);
}

// 3. Provenance gate (R19): verified records pass, unverified fail closed.
const provenanceOk = checkBuildProvenanceGate([fixturePackageRecord("@demo/assets"), fixturePackageRecord("@demo/world")]);
check("provenance gate passes for verified records", provenanceOk.pass);
const provenanceFail = checkBuildProvenanceGate([fixturePackageRecord("@demo/bad", "declared")]);
check("provenance gate fails closed on unverified license", !provenanceFail.pass);

// 4. Phase machine sanity: the frozen stage chain is legal.
const expectedPhases = "queued,resolve,plan,emit,verify,package,succeeded,failed,cancelled";
check("frozen phase vocabulary", BUILD_PHASES.join(",") === expectedPhases, BUILD_PHASES.join(","));

lines.push(`SUMMARY ${failed === 0 ? "OK" : "FAILED"} checks=${lines.filter((line) => line.startsWith("PASS") || line.startsWith("FAIL")).length} failures=${failed}`);
for (const line of lines) {
  console.log(line);
}
process.exitCode = failed === 0 ? 0 : 1;
